import { ReviewLog } from "ts-fsrs";

/** One row per review. Append-only; card scheduling state can be rebuilt from these. */
export interface ReviewLogRecord extends ReviewLog {
  id: string;
  card: string;
  reviewedAt: number;
}

export function toReviewLogRecord(
  cardId: string,
  log: ReviewLog,
  id: string
): ReviewLogRecord {
  return { ...log, id, card: cardId, reviewedAt: log.review.getTime() };
}
