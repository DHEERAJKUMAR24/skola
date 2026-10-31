import { Card as Model, ReviewLog } from "ts-fsrs";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { invalidateDeckStatsCacheForCard } from "../deck/deckStatsCacheManager";
import { NoteType } from "../note/note";
import { Card } from "./card";
import { toReviewLogRecord } from "./reviewLog";

export async function updateCardModel(
  card: Card<NoteType>,
  model: Model,
  log: ReviewLog
) {
  await db.transaction("rw", db.cards, db.reviewLogs, async () => {
    await db.cards.update(card.id, { model: model });
    await db.reviewLogs.add(toReviewLogRecord(card.id, log, uuidv4()));
  });

  await invalidateDeckStatsCacheForCard(card.id);
}
