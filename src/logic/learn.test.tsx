import "fake-indexeddb/auto";
import { renderHook, waitFor } from "@testing-library/react";
import { State, createEmptyCard } from "ts-fsrs";
import { beforeEach, expect, it } from "vitest";
import { db } from "./db";
import { useLearning } from "./learn";

const DAY = 86_400_000;

async function seed(opts: { cards: object[]; maxReviewsPerDay?: number }) {
  await db.decks.add({
    id: "d1",
    name: "D",
    subDecks: [],
    cards: [],
    notes: [],
    options: {
      newToReviewRatio: 0.5,
      dailyNewCards: 20,
      maxReviewsPerDay: opts.maxReviewsPerDay,
    },
  } as never);
  await db.cards.bulkAdd(
    opts.cards.map((c, i) => ({
      id: `c${i}`,
      deck: "d1",
      note: `n${i}`,
      content: { type: "normal" },
      creationDate: new Date(),
      ...c,
    })) as never
  );
}

const study = () =>
  renderHook(() =>
    useLearning(
      {
        querier: (cards) => cards.where("deck").equals("d1").toArray(),
        dependencies: [],
      },
      { learnAll: false, newToReviewRatio: 0.5 }
    )
  );

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

// These used to loop forever ("Maximum update depth exceeded"): the effect set four new empty
// lists, which re-ran the effect with the same empty input.
it("finishes at once for a deck with no cards", async () => {
  await seed({ cards: [] });
  const { result } = study();
  await waitFor(() => expect(result.current.isFinished).toBe(true));
});

it("finishes when the daily review limit hides every due card", async () => {
  const past = new Date(Date.now() - 2 * DAY);
  await seed({
    maxReviewsPerDay: 0,
    cards: [
      { model: { ...createEmptyCard(past), state: State.Review, due: past } },
    ],
  });
  const { result } = study();
  await waitFor(() => expect(result.current.isFinished).toBe(true));
});

it("finishes when every card is suspended", async () => {
  await seed({
    cards: [{ model: createEmptyCard(new Date()), suspended: true }],
  });
  const { result } = study();
  await waitFor(() => expect(result.current.isFinished).toBe(true));
});

it("still serves a new card, and a due card, normally", async () => {
  const past = new Date(Date.now() - 2 * DAY);
  await seed({
    cards: [
      { model: createEmptyCard(new Date()) },
      { model: { ...createEmptyCard(past), state: State.Review, due: past } },
    ],
  });
  const { result } = study();
  await waitFor(() => expect(result.current.currentCard).not.toBeNull());
  expect(result.current.isFinished).toBe(false);
});
