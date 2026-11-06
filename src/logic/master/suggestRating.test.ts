import { Rating, State } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import {
  type LinkedCardState,
  cardRecall,
  suggestMasterRating,
} from "./suggestRating";

const NOW = Date.UTC(2026, 10, 6);
const DAY = 86_400_000;

/** A reviewed card: stability in days, last seen `ago` days back. */
const rev = (
  stability: number,
  ago: number,
  extra: Partial<LinkedCardState> = {}
): LinkedCardState => ({
  state: State.Review,
  stability,
  lastReview: NOW - ago * DAY,
  due: NOW + DAY,
  lapses: 0,
  reps: 4,
  ...extra,
});

describe("cardRecall", () => {
  it("is 0 for a new card or zero stability", () => {
    expect(cardRecall({ state: State.New, stability: 5 }, NOW)).toBe(0);
    expect(cardRecall(rev(0, 1), NOW)).toBe(0);
  });
  it("is about 0.9 when elapsed equals stability", () => {
    expect(cardRecall(rev(10, 10), NOW)).toBeCloseTo(0.9, 2);
  });
  it("falls with time and rises with stability", () => {
    expect(cardRecall(rev(10, 30), NOW)).toBeLessThan(
      cardRecall(rev(10, 3), NOW)
    );
    expect(cardRecall(rev(50, 10), NOW)).toBeGreaterThan(
      cardRecall(rev(10, 10), NOW)
    );
  });
  it("treats a missing last review as just seen", () => {
    expect(
      cardRecall({ state: State.Review, stability: 5, lastReview: null }, NOW)
    ).toBeCloseTo(1, 5);
  });
});

describe("suggestMasterRating", () => {
  it("Easy when everything is fresh and strong", () => {
    const r = suggestMasterRating([rev(60, 1), rev(80, 2), rev(90, 1)], NOW);
    expect(r.rating).toBe(Rating.Easy);
    expect(r.label).toBe("Easy");
    expect(r.score).toBeGreaterThan(0.93);
  });
  it("Good when recall is around 85 to 93 percent", () => {
    const r = suggestMasterRating([rev(10, 12), rev(10, 12)], NOW);
    expect(r.rating).toBe(Rating.Good);
  });
  it("Hard when recall is around 65 to 80 percent", () => {
    const r = suggestMasterRating([rev(10, 40), rev(10, 40)], NOW);
    expect(r.score).toBeLessThan(0.8);
    expect(r.score).toBeGreaterThanOrEqual(0.5);
    expect(r.rating).toBe(Rating.Hard);
  });
  it("Again when recall is poor", () => {
    const r = suggestMasterRating([rev(1, 300), rev(1, 400)], NOW);
    expect(r.rating).toBe(Rating.Again);
  });
  it("Again with nothing to judge from", () => {
    expect(suggestMasterRating([], NOW).rating).toBe(Rating.Again);
    const onlySuspended = suggestMasterRating(
      [rev(60, 1, { suspended: true })],
      NOW
    );
    expect(onlySuspended.rating).toBe(Rating.Again);
    expect(onlySuspended.reasons[0]).toMatch(/No active/);
  });
  it("unlinked entries count as not known", () => {
    const r = suggestMasterRating([rev(90, 1), null, undefined, null], NOW);
    expect(r.counts.unlinked).toBe(3);
    expect(r.score).toBeLessThan(0.3);
    expect(r.rating).toBe(Rating.Again);
    expect(r.reasons.join(" ")).toMatch(/3 not linked/);
  });
  it("never reviewed cards count as 0", () => {
    const r = suggestMasterRating(
      [rev(90, 1), { state: State.New, stability: 0 }],
      NOW
    );
    expect(r.counts.neverReviewed).toBe(1);
    expect(r.score).toBeLessThan(0.55);
  });
  it("suspended cards are left out of the score but reported", () => {
    const withSusp = suggestMasterRating(
      [rev(90, 1), rev(90, 1, { suspended: true })],
      NOW
    );
    const without = suggestMasterRating([rev(90, 1)], NOW);
    expect(withSusp.score).toBeCloseTo(without.score);
    expect(withSusp.counts.suspended).toBe(1);
  });
  it("Easy drops to Good when something is overdue", () => {
    const r = suggestMasterRating(
      [rev(900, 1), rev(900, 1, { due: NOW - DAY })],
      NOW
    );
    expect(r.score).toBeGreaterThan(0.93);
    expect(r.counts.overdue).toBe(1);
    expect(r.rating).toBe(Rating.Good);
  });
  it("Easy drops to Good when an entry has no card", () => {
    const r = suggestMasterRating(
      Array.from({ length: 30 }, () => rev(900, 0.5)).concat([null as never]),
      NOW
    );
    expect(r.rating).toBe(Rating.Good);
  });
  it("counts weak lapsed cards", () => {
    const r = suggestMasterRating([rev(1, 100, { lapses: 2 })], NOW);
    expect(r.counts.weak).toBe(1);
  });
  it("accepts Date objects", () => {
    const r = suggestMasterRating(
      [
        rev(60, 1, {
          lastReview: new Date(NOW - DAY),
          due: new Date(NOW + DAY),
        }),
      ],
      new Date(NOW)
    );
    expect(r.rating).toBe(Rating.Easy);
  });
  it("always gives a grade between 1 and 4 and a score between 0 and 1", () => {
    for (let s = 1; s < 400; s *= 3)
      for (let ago = 0; ago < 400; ago += 37) {
        const r = suggestMasterRating([rev(s, ago), null], NOW);
        expect([1, 2, 3, 4]).toContain(r.rating);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
  });
});
