import {
  type Card,
  FSRS,
  Rating,
  State,
  createEmptyCard,
  default_w,
  forgetting_curve,
  generatorParameters,
} from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { simulate } from "./simulate";

// Independent re-implementation: different RNG, repeat() instead of next(), averaged over seeds.
// If simulate() has a scheduling or bookkeeping bug, its single run drifts out of this band.
function reference(
  retention: number,
  perDay: number,
  days: number,
  seed: number
) {
  const f = new FSRS(
    generatorParameters({
      request_retention: retention,
      w: [...default_w],
      enable_fuzz: false,
      enable_short_term: false,
    })
  );
  let a = seed;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const day = (d: number) => new Date(2026, 0, 1 + d, 12);
  const cards: Card[] = [];
  const perDayReviews: number[] = [];
  for (let d = 0; d < days; d++) {
    const now = day(d);
    let n = 0;
    for (let i = 0; i < perDay; i++) {
      cards.push(f.repeat(createEmptyCard(now), now)[Rating.Good].card);
      n++;
    }
    cards.forEach((c, i) => {
      if (c.due > now) return;
      const t = (now.getTime() - (c.last_review as Date).getTime()) / 864e5;
      const ok = rand() < forgetting_curve([...default_w], t, c.stability);
      cards[i] = f.repeat(c, now)[ok ? Rating.Good : Rating.Again].card;
      n++;
    });
    perDayReviews.push(n);
  }
  const end = day(days);
  const known = cards.reduce<number>(
    (s, c) =>
      s +
      forgetting_curve(
        [...default_w],
        (end.getTime() - (c.last_review as Date).getTime()) / 864e5,
        c.stability
      ),
    0
  );
  const half = perDayReviews.slice(days >> 1);
  return {
    avg: half.reduce((x, y) => x + y, 0) / half.length,
    known,
    stateOk: cards.every((c) => c.state !== State.New),
  };
}

describe("workload simulator vs reference", () => {
  const days = 120;
  const perDay = 10;
  for (const r of [0.75, 0.9, 0.95]) {
    it(`matches the reference at ${r * 100}% retention`, () => {
      const runs = Array.from({ length: 30 }, (_, i) =>
        reference(r, perDay, days, 1000 + i)
      );
      const avg = runs.reduce((s, x) => s + x.avg, 0) / runs.length;
      const known = runs.reduce((s, x) => s + x.known, 0) / runs.length;
      const sim = simulate({
        desiredRetention: r,
        newCardsPerDay: perDay,
        days,
        maximumInterval: 36500,
        weights: [...default_w],
      });
      expect(runs.every((x) => x.stateOk)).toBe(true);
      expect(Math.abs(sim.avgReviewsPerDay - avg) / avg).toBeLessThan(0.1);
      expect(Math.abs(sim.cardsKnown - known) / known).toBeLessThan(0.05);
      // Realised knowledge should sit near the retention target for settled cards.
      expect(sim.cardsKnown / (perDay * days)).toBeGreaterThan(r - 0.15);
      expect(sim.cardsKnown / (perDay * days)).toBeLessThanOrEqual(1);
    });
  }
});
