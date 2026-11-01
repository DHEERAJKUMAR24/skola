import { Rating, default_w } from "ts-fsrs";
import { updateCardModel } from "../card/updateCardModel";
import { db } from "../db";
import type { Deck } from "../deck/deck";
import { newDeck } from "../deck/newDeck";
import {
  DEFAULT_PRESET_ID,
  createPreset,
  effectiveOptions,
  ensureDefaultPreset,
  savePreset,
} from "../deck/presets";
import { setNoteTags } from "../note/tags";
import { DAY_MS, resolveExam, scheduleCard } from "../scheduling/policy";
import { BasicNoteTypeAdapter } from "../type-implementations/normal/BasicNote";
import { CONCEPTS, DOMAIN, SUBJECT } from "./jsInterviewData";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Turns the seed markup (`code`, fenced blocks, blank-line paragraphs) into HTML. */
export function markup(text: string): string {
  return text
    .split(/(```[\s\S]*?```)/g)
    .filter((part) => part.trim())
    .map((part) => {
      if (part.startsWith("```"))
        return `<pre><code>${escapeHtml(part.slice(3, -3).trim())}</code></pre>`;
      return part
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map(
          (p) =>
            `<p>${escapeHtml(p.trim()).replace(/`([^`]+)`/g, "<code>$1</code>")}</p>`
        )
        .join("");
    })
    .join("");
}

export function formatLocalDate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export interface SeedOptions {
  /** Simulate a few past study sessions for about half of the cards, so stats and the forecast have data. */
  withHistory?: boolean;
  /** Days from now until the sample exam. Default 21. */
  examInDays?: number;
  now?: Date;
}

export interface SeedResult {
  created: boolean;
  domainId: string;
  decks: number;
  notes: number;
}

const GLOBAL = { retention: 0.9, maximumInterval: 36500, w: [...default_w] };

/**
 * Creates the sample hierarchy: Programming Languages > JavaScript > 7 concepts, each with
 * 6 interview cards, tags, FSRS options per deck and an exam date on JavaScript.
 * Does nothing if a top-level "Programming Languages" deck already exists.
 */
export async function seedJsInterview(
  opts: SeedOptions = {}
): Promise<SeedResult> {
  const now = opts.now ?? new Date();
  const existing = await db.decks
    .filter((d) => d.name === DOMAIN.name && !d.superDecks?.length)
    .first();
  if (existing)
    return { created: false, domainId: existing.id, decks: 0, notes: 0 };

  const fresh = async (id: string) => (await db.decks.get(id)) as Deck;

  await ensureDefaultPreset();
  const examPrepId = await createPreset("Exam prep");
  const wholeDaysId = await createPreset("Whole days");
  const base = await db.presets.get(DEFAULT_PRESET_ID);
  const examPrep = await db.presets.get(examPrepId);
  const wholeDays = await db.presets.get(wholeDaysId);
  if (base && examPrep && wholeDays) {
    await savePreset({ ...examPrep, desiredRetention: 0.95 });
    await savePreset({ ...wholeDays, schedulingMode: "daily" });
  }

  const domainId = await newDeck(
    DOMAIN.name,
    undefined,
    DOMAIN.description,
    "sky",
    { presetId: DEFAULT_PRESET_ID }
  );
  const examDate = formatLocalDate(
    new Date(now.getTime() + (opts.examInDays ?? 21) * DAY_MS)
  );
  const subjectId = await newDeck(
    SUBJECT.name,
    await fresh(domainId),
    SUBJECT.description,
    "sky",
    { presetId: examPrepId, examDate, examBufferDays: 1, examRamp: true }
  );

  let decks = 2;
  let notes = 0;
  const cardIds: string[] = [];
  for (const concept of CONCEPTS) {
    const conceptId = await newDeck(
      concept.name,
      await fresh(subjectId),
      concept.description,
      concept.color,
      { presetId: concept.daily ? wholeDaysId : examPrepId }
    );
    decks++;
    for (const card of concept.cards) {
      const noteId = (await BasicNoteTypeAdapter.createNote(
        { front: markup(card.q), back: markup(card.a) },
        await fresh(conceptId)
      )) as string;
      await setNoteTags(noteId, ["interview", ...card.tags]);
      const created = await db.cards.where("note").equals(noteId).toArray();
      cardIds.push(...created.map((c) => c.id));
      notes++;
    }
  }

  if (opts.withHistory) await simulateHistory(cardIds, now);
  return { created: true, domainId, decks, notes };
}

/** Roughly 55% of the cards get 1 to 3 reviews spread over the last two weeks. */
async function simulateHistory(cardIds: string[], now: Date) {
  const decksById = new Map(
    (await db.decks.toArray()).map((d) => [d.id, d] as const)
  );
  const presets = new Map((await db.presets.toArray()).map((p) => [p.id, p]));
  const SESSIONS = [[-6], [-9, -4], [-14, -8, -2]];
  for (const [i, id] of cardIds.entries()) {
    if ((i * 7) % 20 >= 11) continue; // leave the rest as new cards
    const days = SESSIONS[i % 3];
    const ratings =
      i % 9 === 0
        ? [Rating.Good, Rating.Again, Rating.Good]
        : [Rating.Good, Rating.Good, Rating.Hard];
    for (const [step, offset] of days.entries()) {
      const card = await db.cards.get(id);
      if (!card) break;
      const at = new Date(now.getTime() + offset * DAY_MS);
      const deck = decksById.get(card.deck);
      const rec = scheduleCard(card.model, {
        deckOptions: effectiveOptions(deck, presets),
        exam: resolveExam(deck, decksById),
        global: GLOBAL,
        newDayStartHour: 4,
        now: at,
      });
      const rating = ratings[step] as 1 | 2 | 3 | 4;
      await updateCardModel(card, rec[rating].card, rec[rating].log);
    }
  }
}
