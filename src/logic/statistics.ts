import { useLiveQuery } from "dexie-react-hooks";
import { Rating, State } from "ts-fsrs";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db";

export interface DeckStatistics {
  deck: string;
  day: string;
  time: {
    total: number;
    forNew: number;
    forReview: number;
    forLearning: number;
  };
  cards: {
    [State.New]: number;
    [State.Review]: number;
    [State.Learning]: number;
    [State.Relearning]: number;
  };
  ratingsList: Rating[];
}

/**
 * One finished study session. Sessions are only ever added, never edited, and each has its own id,
 * so two devices that studied the same deck on the same day both keep their counts when synced.
 * The per-day totals are added up when read (see getStatistics).
 */
export interface StudySession extends DeckStatistics {
  id: string;
  updatedAt?: number;
}

export function newStatistics(): DeckStatistics {
  return {
    deck: "[not set]",
    day: new Date().toISOString().split("T")[0],
    time: {
      total: 0,
      forNew: 0,
      forReview: 0,
      forLearning: 0,
    },
    cards: {
      [State.New]: 0,
      [State.Review]: 0,
      [State.Learning]: 0,
      [State.Relearning]: 0,
    },
    ratingsList: [],
  };
}
export async function writeStatistics(statistics: DeckStatistics) {
  // A session with no answers has nothing to report.
  if (statistics.ratingsList.length === 0 && statistics.time.total === 0)
    return;
  await db.studySessions.add({ ...statistics, id: uuidv4() });
}

/** Adds sessions of the same deck and day into one per-day total. */
export function totalsByDay(sessions: DeckStatistics[]): DeckStatistics[] {
  const out = new Map<string, DeckStatistics>();
  for (const s of sessions) {
    const key = `${s.deck}|${s.day}`;
    const t = out.get(key);
    if (!t) {
      out.set(key, {
        deck: s.deck,
        day: s.day,
        time: { ...s.time },
        cards: { ...s.cards },
        ratingsList: [...s.ratingsList],
      });
      continue;
    }
    t.time.total += s.time.total;
    t.time.forNew += s.time.forNew;
    t.time.forReview += s.time.forReview;
    t.time.forLearning += s.time.forLearning;
    for (const state of [
      State.New,
      State.Review,
      State.Learning,
      State.Relearning,
    ] as const)
      t.cards[state] += s.cards[state];
    t.ratingsList.push(...s.ratingsList);
  }
  return [...out.values()];
}

export async function getStatistics(deck?: string, day?: string) {
  const sessions = deck
    ? await db.studySessions.where("deck").equals(deck).toArray()
    : day
      ? await db.studySessions.where("day").equals(day).toArray()
      : await db.studySessions.toArray();
  const totals = totalsByDay(
    sessions.filter(
      (s) => (!deck || s.deck === deck) && (!day || s.day === day)
    )
  );
  // Same shapes as before: one total for a deck and day, a list otherwise.
  return deck && day ? totals[0] : totals;
}

export function useStatistics(deck?: string, day?: string) {
  return useLiveQuery(() => getStatistics(deck, day), [deck, day]);
}
