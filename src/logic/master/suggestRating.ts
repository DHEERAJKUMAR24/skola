// Suggested rating for a master card (ADR 0014). Pure: no Dexie, no React. The user always
// self-rates; this only says what the linked cards' FSRS state suggests, with the reasons.
import { Rating, State, default_w, forgetting_curve } from "ts-fsrs";

const DAY_MS = 86_400_000;

/** The FSRS facts about a linked card. */
export interface LinkedCardState {
  state: State;
  stability: number;
  due?: Date | number;
  lastReview?: Date | number | null;
  lapses?: number;
  reps?: number;
  suspended?: boolean;
}

export type SuggestedGrade =
  | Rating.Again
  | Rating.Hard
  | Rating.Good
  | Rating.Easy;

export interface SuggestedRating {
  rating: SuggestedGrade;
  label: "Again" | "Hard" | "Good" | "Easy";
  /** Mean recall chance (0 to 1) over the counted entries; untested entries count as 0. */
  score: number;
  counts: {
    entries: number;
    /** No card linked, or the card does not exist. */
    unlinked: number;
    /** Linked card never reviewed. */
    neverReviewed: number;
    suspended: number;
    /** Reviewed cards whose due date has passed. */
    overdue: number;
    /** Reviewed cards that were forgotten at least once and are still weak (recall under 0.7). */
    weak: number;
  };
  /** Short sentences saying why, for display. */
  reasons: string[];
}

const LABELS = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" } as const;

const ms = (d: Date | number | null | undefined): number | undefined =>
  d === null || d === undefined
    ? undefined
    : typeof d === "number"
      ? d
      : d.getTime();

/** Recall chance now of one card: 0 when never reviewed. */
export function cardRecall(
  c: LinkedCardState,
  now: number,
  w: readonly number[] = default_w
): number {
  if (c.state === State.New || c.stability <= 0) return 0;
  const last = ms(c.lastReview);
  const elapsed = last === undefined ? 0 : Math.max(0, (now - last) / DAY_MS);
  return forgetting_curve(w as number[], elapsed, c.stability);
}

/**
 * Suggests Again, Hard, Good or Easy for one review of a master card (or one section of it).
 *
 * `cards` has one item per entry: the linked card's state, or `null`/`undefined` when the entry
 * has no card or the card is missing. Rules:
 * - the score is the mean recall chance; an entry with no card or a never-reviewed card counts 0,
 *   because nothing about it has been tested; suspended cards are left out (reported only);
 * - score under 0.5: Again; under 0.8: Hard; under 0.93: Good; else Easy;
 * - Easy needs every entry linked and reviewed and nothing overdue, otherwise it drops to Good;
 * - nothing countable at all: Again.
 */
export function suggestMasterRating(
  cards: (LinkedCardState | null | undefined)[],
  now: Date | number = Date.now(),
  w: readonly number[] = default_w
): SuggestedRating {
  const t = ms(now) ?? Date.now();
  const counts = {
    entries: cards.length,
    unlinked: 0,
    neverReviewed: 0,
    suspended: 0,
    overdue: 0,
    weak: 0,
  };
  let sum = 0;
  let counted = 0;
  for (const c of cards) {
    if (!c) {
      counts.unlinked++;
      counted++;
      continue;
    }
    if (c.suspended) {
      counts.suspended++;
      continue;
    }
    counted++;
    if (c.state === State.New) {
      counts.neverReviewed++;
      continue;
    }
    const r = cardRecall(c, t, w);
    sum += r;
    const due = ms(c.due);
    if (due !== undefined && due < t) counts.overdue++;
    if ((c.lapses ?? 0) > 0 && r < 0.7) counts.weak++;
  }

  const score = counted === 0 ? 0 : sum / counted;
  let rating: SuggestedGrade;
  if (counted === 0 || score < 0.5) rating = Rating.Again;
  else if (score < 0.8) rating = Rating.Hard;
  else if (score < 0.93) rating = Rating.Good;
  else rating = Rating.Easy;
  if (
    rating === Rating.Easy &&
    (counts.unlinked || counts.neverReviewed || counts.overdue)
  )
    rating = Rating.Good;

  const reasons: string[] = [];
  const pct = Math.round(score * 100);
  if (counted === 0) reasons.push("No active linked cards to judge from.");
  else reasons.push(`Expected recall across the entries is about ${pct}%.`);
  if (counts.unlinked)
    reasons.push(
      `${counts.unlinked} not linked to a card (counted as not known).`
    );
  if (counts.neverReviewed)
    reasons.push(
      `${counts.neverReviewed} linked card${counts.neverReviewed === 1 ? " was" : "s were"} never reviewed.`
    );
  if (counts.overdue) reasons.push(`${counts.overdue} overdue.`);
  if (counts.weak)
    reasons.push(`${counts.weak} forgotten before and still weak.`);
  if (counts.suspended)
    reasons.push(`${counts.suspended} suspended (left out).`);

  return { rating, label: LABELS[rating], score, counts, reasons };
}
