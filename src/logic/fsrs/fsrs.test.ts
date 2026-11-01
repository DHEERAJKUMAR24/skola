import { Rating, State, default_w } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import type { ReviewLogRecord } from "../card/reviewLog";
import {
  MIN_OPTIMIZE_REVIEWS,
  buildTrainingSet,
  optimizeWeights,
} from "./optimizer";
import { simulate } from "./simulate";

const DAY = 86_400_000;
const T0 = new Date(2026, 0, 1, 12).getTime();

const log = (
  card: string,
  day: number,
  rating: number,
  hours = 0
): ReviewLogRecord =>
  ({
    id: `${card}-${day}-${hours}`,
    card,
    reviewedAt: T0 + day * DAY + hours * 3_600_000,
    rating,
    state: State.Review,
  }) as ReviewLogRecord;

describe("training set", () => {
  it("groups by card, orders by time and measures gaps in whole days", () => {
    const set = buildTrainingSet([
      log("b", 5, Rating.Good),
      log("a", 3, Rating.Hard),
      log("a", 0, Rating.Good),
      log("a", 0, Rating.Again, 2), // same day, 2 hours later
    ]);
    expect(set).toMatchObject({ reviews: 4, cards: 2 });
    // cards appear in first-seen order: b first, then a
    expect(Array.from(set.lengths)).toEqual([1, 3]);
    expect(Array.from(set.ratings)).toEqual([
      Rating.Good,
      Rating.Good,
      Rating.Again,
      Rating.Hard,
    ]);
    // 14:00 on day 0 to 12:00 on day 3 is 3 study days, not 2.9
    expect(Array.from(set.deltas)).toEqual([0, 0, 0, 3]);
  });

  it("skips manual changes and invalid ratings", () => {
    const set = buildTrainingSet([
      log("a", 0, Rating.Good),
      log("a", 1, Rating.Manual),
      log("a", 2, 9),
    ]);
    expect(set.reviews).toBe(1);
  });

  it("refuses to train on too little data", async () => {
    await expect(
      optimizeWeights([log("a", 0, Rating.Good)], {
        shortTerm: true,
        relearningSteps: 1,
      })
    ).rejects.toThrow(`at least ${MIN_OPTIMIZE_REVIEWS}`);
  });
});

describe("workload simulator", () => {
  const base = {
    newCardsPerDay: 10,
    days: 120,
    maximumInterval: 36500,
    weights: [...default_w],
  };

  it("is deterministic and counts every new card as work on its first day", () => {
    const a = simulate({ ...base, desiredRetention: 0.9 });
    const b = simulate({ ...base, desiredRetention: 0.9 });
    expect(a).toEqual(b);
    expect(a.reviewsPerDay).toHaveLength(120);
    expect(a.reviewsPerDay[0]).toBe(10);
  });

  it("higher retention means more daily reviews and more cards known", () => {
    const low = simulate({ ...base, desiredRetention: 0.75 });
    const high = simulate({ ...base, desiredRetention: 0.95 });
    expect(high.avgReviewsPerDay).toBeGreaterThan(low.avgReviewsPerDay);
    expect(high.totalReviews).toBeGreaterThan(low.totalReviews);
    expect(high.cardsKnown).toBeGreaterThan(low.cardsKnown);
    expect(high.cardsKnown).toBeLessThanOrEqual(10 * 120);
  });

  it("does nothing without new cards", () => {
    const r = simulate({ ...base, newCardsPerDay: 0, desiredRetention: 0.9 });
    expect(r.totalReviews).toBe(0);
    expect(r.cardsKnown).toBe(0);
  });
});
