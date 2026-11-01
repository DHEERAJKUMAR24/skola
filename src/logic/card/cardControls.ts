import {
  type Card as FsrsCard,
  Rating,
  type ReviewLog,
  createEmptyCard,
} from "ts-fsrs";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { invalidateDeckStatsCacheForCard } from "../deck/deckStatsCacheManager";
import { addTag } from "../note/tags";
import { DAY_MS } from "../scheduling/policy";
import type { CardFsrsOverride } from "./card";
import { toReviewLogRecord } from "./reviewLog";

async function getCard(cardId: string) {
  const card = await db.cards.get(cardId);
  if (!card) throw new Error("Card not found");
  return card;
}

/** A log entry for a change made by hand rather than by answering the card. */
function manualLog(model: FsrsCard, now: Date): ReviewLog {
  return {
    rating: Rating.Manual,
    state: model.state,
    due: model.due,
    stability: model.stability,
    difficulty: model.difficulty,
    elapsed_days: 0,
    last_elapsed_days: 0,
    scheduled_days: model.scheduled_days,
    learning_steps: model.learning_steps ?? 0,
    review: now,
  };
}

/** Suspended cards are skipped in study. Their FSRS state is kept as is. */
export async function setSuspended(cardId: string, suspended: boolean) {
  await db.cards.update(cardId, { suspended });
  await invalidateDeckStatsCacheForCard(cardId);
}

/** Hides a card until `until` (ms epoch), or shows it again with `null`. */
export async function buryCard(cardId: string, until: number | null) {
  await db.cards.update(cardId, { buriedUntil: until ?? undefined });
  await invalidateDeckStatsCacheForCard(cardId);
}

export function validateOverride(o: CardFsrsOverride): string | null {
  if (
    o.desiredRetention !== undefined &&
    !(o.desiredRetention >= 0.7 && o.desiredRetention <= 0.99)
  )
    return "Retention must be between 70% and 99%";
  if (
    o.maximumInterval !== undefined &&
    !(
      Number.isInteger(o.maximumInterval) &&
      o.maximumInterval >= 1 &&
      o.maximumInterval <= 36500
    )
  )
    return "Maximum interval must be whole days from 1 to 36500";
  return null;
}

/** Gives one card its own retention and/or maximum interval; `undefined` returns it to its deck's settings. */
export async function setCardOverride(
  cardId: string,
  override: CardFsrsOverride | undefined
) {
  const clean: CardFsrsOverride = {};
  if (override?.desiredRetention !== undefined)
    clean.desiredRetention = override.desiredRetention;
  if (override?.maximumInterval !== undefined)
    clean.maximumInterval = override.maximumInterval;
  const error = validateOverride(clean);
  if (error) throw new Error(error);

  if (Object.keys(clean).length)
    await db.cards.update(cardId, { fsrsOverride: clean });
  else
    await db.cards
      .where("id")
      .equals(cardId)
      .modify((c) => {
        c.fsrsOverride = undefined;
      });
}

/**
 * Moves the due date by hand without changing what FSRS knows about the card
 * (stability, difficulty, reps, lapses). Adds a "Manual" entry to the review log.
 */
export async function setDueDate(
  cardId: string,
  due: Date,
  now: Date = new Date()
) {
  const card = await getCard(cardId);
  if (card.model.state === 0)
    throw new Error("A new card has no schedule yet; study it first");
  const model: FsrsCard = {
    ...card.model,
    due,
    scheduled_days: Math.max(
      0,
      Math.round((due.getTime() - now.getTime()) / DAY_MS)
    ),
  };
  await db.transaction("rw", db.cards, db.reviewLogs, async () => {
    await db.cards.update(cardId, { model });
    await db.reviewLogs.add(
      toReviewLogRecord(cardId, manualLog(card.model, now), uuidv4())
    );
  });
  await invalidateDeckStatsCacheForCard(cardId);
}

/** Back to a brand-new card. The review history stays, with a "Manual" entry marking the reset. */
export async function resetCard(cardId: string, now: Date = new Date()) {
  const card = await getCard(cardId);
  await db.transaction("rw", db.cards, db.reviewLogs, async () => {
    await db.reviewLogs.add(
      toReviewLogRecord(cardId, manualLog(card.model, now), uuidv4())
    );
    await db.cards.update(cardId, { model: createEmptyCard(now) });
  });
  await invalidateDeckStatsCacheForCard(cardId);
}

/** Hides several cards until `until` (ms epoch); used to bury siblings of an answered card. */
export async function buryCards(cardIds: string[], until: number) {
  await db.transaction("rw", db.cards, async () => {
    for (const id of cardIds) await db.cards.update(id, { buriedUntil: until });
  });
  for (const id of cardIds) await invalidateDeckStatsCacheForCard(id);
}

/** A leech: the note gets a "leech" tag, and the card is suspended if the preset says so. */
export async function applyLeech(
  card: { id: string; note: string },
  action: "suspend" | "tag"
) {
  await addTag(card.note, "leech");
  if (action === "suspend") await setSuspended(card.id, true);
}
