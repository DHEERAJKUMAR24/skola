import {
  type Card as FsrsCard,
  type Grade,
  Rating,
  type RecordLog,
} from "ts-fsrs";
import type { CardFsrsOverride } from "../card/card";
import type { Deck, DeckOptions } from "../deck/deck";
import {
  type GlobalFsrs,
  resolveParams,
  schedulerFor,
} from "../deck/fsrsOptions";

export const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

/** Retention climbs toward this in the weeks before an exam. */
export const EXAM_RETENTION_TARGET = 0.97;
/** The climb starts this many days before the exam. */
export const EXAM_RAMP_DAYS = 45;

export interface ExamInfo {
  /** `YYYY-MM-DD`, local. */
  date: string;
  bufferDays: number;
  ramp: boolean;
  /** The deck that set the date (it may be an ancestor). */
  sourceDeckId: string;
}

export interface ScheduleContext {
  deckOptions?: DeckOptions;
  exam?: ExamInfo;
  cardOverride?: CardFsrsOverride;
  global: GlobalFsrs;
  /** Hour at which a new study day begins (the app's "#newDayStartHour" setting). */
  newDayStartHour: number;
  now: Date;
}

/** Start of the study day that `date` falls in; the day rolls over at `hour`, not midnight. */
export function logicalDayStart(date: Date, hour: number): Date {
  const d = new Date(date.getTime() - hour * HOUR_MS);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Local midnight at the start of the exam day. */
export function examMoment(examDate: string): Date {
  const [y, m, d] = examDate.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Desired retention rises linearly from `base` to 97% over the last 45 days before the exam,
 * so cards are reviewed a little more often as the date nears. Never lowers it.
 */
export function effectiveRetention(base: number, daysLeft: number): number {
  if (
    daysLeft <= 0 ||
    daysLeft >= EXAM_RAMP_DAYS ||
    base >= EXAM_RETENTION_TARGET
  )
    return base;
  const progress = 1 - daysLeft / EXAM_RAMP_DAYS;
  return base + (EXAM_RETENTION_TARGET - base) * progress;
}

/** The exam that applies to a deck: its own date, else the nearest ancestor's. */
export function resolveExam(
  deck: Deck | undefined,
  decksById: Map<string, Deck>
): ExamInfo | undefined {
  if (!deck) return undefined;
  const nearestFirst = [...(deck.superDecks ?? [])]
    .reverse()
    .map((id) => decksById.get(id));
  for (const d of [deck, ...nearestFirst]) {
    if (d?.options?.examDate)
      return {
        date: d.options.examDate,
        bufferDays: d.options.examBufferDays ?? 1,
        ramp: d.options.examRamp ?? true,
        sourceDeckId: d.id,
      };
  }
  return undefined;
}

/** Latest time a card may fall due so it is seen again before the exam. */
function examCap(examMs: number, bufferDays: number, nowMs: number): number {
  // Never hand back an instant review (min 6 h out), and never later than an hour before the exam.
  const latest = Math.max(examMs - bufferDays * DAY_MS, nowMs + 6 * HOUR_MS);
  return Math.min(latest, examMs - HOUR_MS);
}

/**
 * The four possible outcomes of answering a card, with this app's rules on top of FSRS:
 * - whole-day decks count days from the start of the study day and fall due when a day starts;
 * - a pending exam raises retention and pulls any later due date back before the exam.
 * Only `due` is adjusted. Stability, difficulty and every other memory value stay exactly what
 * FSRS computed, so these rules never distort what the algorithm has learned about the card.
 */
export function scheduleCard(model: FsrsCard, ctx: ScheduleContext): RecordLog {
  const o = ctx.deckOptions;
  const nowMs = ctx.now.getTime();
  const examMs = ctx.exam ? examMoment(ctx.exam.date).getTime() : null;
  const examActive = examMs !== null && examMs > nowMs;

  const base =
    ctx.cardOverride?.desiredRetention ??
    o?.desiredRetention ??
    ctx.global.retention;
  const retention =
    examActive && ctx.exam?.ramp !== false
      ? effectiveRetention(base, ((examMs as number) - nowMs) / DAY_MS)
      : base;

  const params = resolveParams(
    {
      ...o,
      desiredRetention: retention,
      maximumInterval: ctx.cardOverride?.maximumInterval ?? o?.maximumInterval,
    },
    ctx.global
  );
  // Cards stored by the old fsrs.js lack learning_steps.
  const preview = schedulerFor(params).repeat(
    { ...model, learning_steps: model.learning_steps ?? 0 },
    ctx.now
  );

  const daily = o?.schedulingMode === "daily";
  const today = logicalDayStart(ctx.now, ctx.newDayStartHour);
  const maxDays =
    ctx.cardOverride?.maximumInterval ??
    o?.maximumInterval ??
    ctx.global.maximumInterval;
  const out = {} as RecordLog;
  for (const g of GRADES) {
    const r = preview[g];
    let due = r.card.due;
    let scheduledDays = r.card.scheduled_days;
    // ts-fsrs keeps Hard < Good < Easy apart, which can push Easy past the maximum. Hold the cap.
    if (scheduledDays > maxDays) {
      scheduledDays = maxDays;
      due = addDays(ctx.now, maxDays);
    }
    if (daily) due = addDays(today, Math.max(1, Math.round(scheduledDays)));
    // Easy days: keep longer intervals off the weekdays the user wants quiet.
    if (o?.easyDays?.length && scheduledDays >= EASY_DAYS_MIN_INTERVAL)
      due = avoidEasyDays(due, o.easyDays, addDays(today, 1));
    if (examActive && ctx.exam) {
      const cap = examCap(examMs as number, ctx.exam.bufferDays, nowMs);
      if (due.getTime() > cap)
        due = daily
          ? logicalDayStart(new Date(cap), ctx.newDayStartHour)
          : new Date(cap);
    }
    out[g] = { ...r, card: { ...r.card, due, scheduled_days: scheduledDays } };
  }
  return out;
}

/** Easy days only apply to intervals of at least this many days. */
export const EASY_DAYS_MIN_INTERVAL = 3;

/**
 * Moves a due date earlier, by up to 3 days, off the weekdays to avoid (0 = Sunday).
 * Earlier is always safe for memory, and it never lands before `earliest`.
 */
export function avoidEasyDays(
  due: Date,
  easyDays: number[],
  earliest: Date
): Date {
  if (!easyDays.length || easyDays.length >= 7) return due;
  for (let back = 0; back <= 3; back++) {
    const d = addDays(due, -back);
    if (d.getTime() < earliest.getTime()) break;
    if (!easyDays.includes(d.getDay())) return d;
  }
  return due;
}

/**
 * True when a lapse should mark the card as a leech: at the threshold, then every
 * half threshold after it (like Anki). A threshold of 0 turns leeches off.
 */
export function isLeechLapse(
  previousLapses: number,
  lapses: number,
  threshold: number
): boolean {
  if (threshold <= 0 || lapses <= previousLapses || lapses < threshold)
    return false;
  return (lapses - threshold) % Math.max(1, Math.ceil(threshold / 2)) === 0;
}

/** Siblings (cards of the same note) to hide until the next day after answering a card. */
export function siblingsToBury<
  T extends { id: string; note: string; model: { state: number } },
>(
  answered: { id: string; note: string },
  cards: T[],
  rules: { buryNewSiblings?: boolean; buryReviewSiblings?: boolean }
): T[] {
  return cards.filter(
    (c) =>
      c.note === answered.note &&
      c.id !== answered.id &&
      ((c.model.state === 0 && rules.buryNewSiblings) ||
        (c.model.state === 2 && rules.buryReviewSiblings))
  );
}

function fnv(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Shuffles, within a stable per-day seed, only the cards whose deck asks for random order;
 * other cards keep their places.
 */
export function applyRandomOrder<T extends { id: string; deck: string }>(
  cards: T[],
  randomOf: (deckId: string) => boolean,
  seed: string
): T[] {
  const slots = cards.flatMap((c, i) => (randomOf(c.deck) ? [i] : []));
  const shuffled = slots
    .map((i) => cards[i])
    .sort((a, b) => fnv(seed + a.id) - fnv(seed + b.id));
  const out = [...cards];
  slots.forEach((slot, k) => {
    out[slot] = shuffled[k];
  });
  return out;
}

/** Suspended and buried cards stay out of study. */
export function isStudyable(
  card: { suspended?: boolean; buriedUntil?: number },
  now: Date
) {
  return (
    !card.suspended && !(card.buriedUntil && card.buriedUntil > now.getTime())
  );
}

/**
 * Applies each deck's daily new-card limit. `seenToday` counts new cards a deck already
 * introduced today; the rest of the limit is what may still be shown.
 */
export function limitNewCards<T extends { deck: string }>(
  newCards: T[],
  limitOf: (deckId: string) => number | undefined,
  seenToday: Map<string, number>
): T[] {
  const shown = new Map<string, number>();
  return newCards.filter((c) => {
    const limit = limitOf(c.deck);
    if (limit === undefined) return true;
    const used = (seenToday.get(c.deck) ?? 0) + (shown.get(c.deck) ?? 0);
    if (used >= limit) return false;
    shown.set(c.deck, (shown.get(c.deck) ?? 0) + 1);
    return true;
  });
}
