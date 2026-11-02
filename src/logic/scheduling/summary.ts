import { type Card as FsrsCard, State } from "ts-fsrs";
import { recallAfter } from "./forecast";
import { DAY_MS, addDays, logicalDayStart } from "./policy";

export interface DeckSchedule {
  overdue: number;
  /** Cards due on each of the next `days` study days; index 0 is today (overdue excluded). */
  perDay: number[];
  /** Due after the window. */
  later: number;
  /** Studied cards (not New). */
  studied: number;
  newCards: number;
  /** Stability of 21+ days counts as mature, like Anki. */
  mature: number;
  avgStability: number;
  avgDifficulty: number;
  /** Average recall chance right now over studied cards, 0 to 1. */
  avgRecall: number;
  lapses: number;
}

/** Counts studied cards by the study day they fall due, plus memory averages. */
export function deckSchedule(
  cards: { model: FsrsCard; suspended?: boolean }[],
  now: Date,
  newDayStartHour: number,
  w: number[],
  days = 7
): DeckSchedule {
  const today = logicalDayStart(now, newDayStartHour);
  const edges = Array.from({ length: days + 1 }, (_, i) =>
    addDays(today, i).getTime()
  );
  const s: DeckSchedule = {
    overdue: 0,
    perDay: Array(days).fill(0),
    later: 0,
    studied: 0,
    newCards: 0,
    mature: 0,
    avgStability: 0,
    avgDifficulty: 0,
    avgRecall: 0,
    lapses: 0,
  };
  let stab = 0;
  let diff = 0;
  let recall = 0;
  for (const { model: m, suspended } of cards) {
    if (m.state === State.New) {
      s.newCards++;
      continue;
    }
    s.studied++;
    s.lapses += m.lapses;
    if (m.stability >= 21) s.mature++;
    stab += m.stability;
    diff += m.difficulty;
    const last = m.last_review
      ? new Date(m.last_review).getTime()
      : now.getTime();
    recall += recallAfter(m.stability, (now.getTime() - last) / DAY_MS, w);
    if (suspended) continue;
    const due = new Date(m.due).getTime();
    if (due < edges[0]) s.overdue++;
    else if (due >= edges[days]) s.later++;
    else s.perDay[edges.findIndex((e, i) => due >= e && due < edges[i + 1])]++;
  }
  if (s.studied) {
    s.avgStability = stab / s.studied;
    s.avgDifficulty = diff / s.studied;
    s.avgRecall = recall / s.studied;
  }
  return s;
}

/** `10m`, `3h`, `5d`, `2.4mo`, `1.3y` from a span in ms. */
export function formatSpan(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return "<1m";
  if (min < 60) return `${Math.round(min)}m`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${(d / 30.4).toFixed(1)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
