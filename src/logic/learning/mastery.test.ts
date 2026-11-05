import { describe, expect, it } from "vitest";
import { type Assessment, DIMENSIONS, evaluate } from "./mastery";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

const a = (
  domain: "K" | "S",
  dimension: string,
  rating: number,
  day = 0,
  extra: Partial<Assessment> = {}
): Assessment => ({
  domain,
  dimension,
  rating,
  hints: 0,
  independent: true,
  at: T0 + day * DAY,
  ...extra,
});
const all = (domain: "K" | "S", rating: number, day = 0) =>
  DIMENSIONS[domain].map((d) => a(domain, d, rating, day));

describe("K/S scoring", () => {
  it("gives no score until all four dimensions have evidence; untested is not zero", () => {
    const s = evaluate(
      "K",
      [a("K", "recall", 4), a("K", "explanation", 4)],
      T0
    );
    expect(s.K.score).toBeNull();
    expect(s.K.untested).toEqual(["discrimination", "transfer"]);
    expect(s.K.tested).toBe(2);
    expect(s.next).toMatchObject({ action: "assess", domain: "K" });
    expect(s.mastered).toBe(false);
  });

  it("scores the sum of the four ratings out of 16, per domain, and keeps K and S apart", () => {
    const s = evaluate("KS", [...all("K", 4), ...all("S", 2)], T0);
    expect(s.K.score).toBe(100);
    expect(s.S?.score).toBe(50);
    const mixed = evaluate(
      "K",
      [
        a("K", "recall", 4),
        a("K", "explanation", 3),
        a("K", "discrimination", 3),
        a("K", "transfer", 3),
      ],
      T0
    );
    expect(mixed.K.score).toBe(81.3);
    expect(mixed.S).toBeNull();
  });

  it("uses the latest rating of a dimension", () => {
    const s = evaluate(
      "K",
      [...all("K", 1, 0), a("K", "recall", 4, 5)],
      T0 + 6 * DAY
    );
    expect(s.K.dimensions.recall).toMatchObject({ rating: 4, assessments: 2 });
    expect(s.K.score).toBe(43.8);
  });
});

describe("mastery gates", () => {
  const good = [
    ...all("K", 4, 0),
    ...all("S", 4, 0),
    ...all("K", 4, 8),
    ...all("S", 4, 8),
  ];

  it("is reached with scores of 85+, no weak dimension, independent work and a retest 7+ days later", () => {
    const s = evaluate("KS", good, T0 + 9 * DAY);
    expect(s.blockers).toEqual([]);
    expect(s.mastered).toBe(true);
    expect(s.next.action).toBe("move_on");
  });

  it("needs the delayed retest: a perfect day-0 result is not mastery", () => {
    const s = evaluate("KS", [...all("K", 4), ...all("S", 4)], T0 + DAY);
    expect(s.mastered).toBe(false);
    expect(s.next).toMatchObject({ action: "retest", after: T0 + 7 * DAY });
    expect(
      evaluate("KS", [...all("K", 4), ...all("S", 4)], T0 + 6.9 * DAY).mastered
    ).toBe(false);
    // 6 days apart is not enough, 7 is
    const six = [
      ...all("K", 4, 0),
      ...all("S", 4, 0),
      ...all("K", 4, 6),
      ...all("S", 4, 6),
    ];
    expect(evaluate("KS", six, T0 + 7 * DAY).mastered).toBe(false);
    const seven = [
      ...all("K", 4, 0),
      ...all("S", 4, 0),
      ...all("K", 4, 7),
      ...all("S", 4, 7),
    ];
    expect(evaluate("KS", seven, T0 + 7 * DAY).mastered).toBe(true);
  });

  it("needs both K and S when the objective tracks both, but only K for a knowledge objective", () => {
    const konly = [...all("K", 4, 0), ...all("K", 4, 8)];
    expect(evaluate("KS", konly, T0 + 9 * DAY).mastered).toBe(false);
    expect(evaluate("KS", konly, T0 + 9 * DAY).next).toMatchObject({
      action: "assess",
      domain: "S",
    });
    expect(evaluate("K", konly, T0 + 9 * DAY).mastered).toBe(true);
  });

  it("blocks a dimension under 3 even when the score is above 85", () => {
    const list = [
      a("K", "recall", 4, 0),
      a("K", "explanation", 4, 0),
      a("K", "discrimination", 4, 0),
      a("K", "transfer", 2, 0),
      ...all("K", 4, 8).slice(0, 3),
      a("K", "transfer", 2, 8),
    ];
    const s = evaluate("K", list, T0 + 9 * DAY);
    expect(s.K.score).toBe(87.5);
    expect(s.mastered).toBe(false);
    expect(s.next).toMatchObject({ action: "revisit", dimension: "transfer" });
  });

  it("blocks a score under 85 and says to improve", () => {
    const list = [
      a("K", "recall", 3, 0),
      a("K", "explanation", 3, 0),
      a("K", "discrimination", 3, 0),
      a("K", "transfer", 3, 0),
      a("K", "recall", 3, 8),
      a("K", "explanation", 3, 8),
      a("K", "discrimination", 3, 8),
      a("K", "transfer", 3, 8),
    ];
    const s = evaluate("K", list, T0 + 9 * DAY);
    expect(s.K.score).toBe(75);
    expect(s.next.action).toBe("improve");
  });

  it("needs unaided recall and explanation, and independent skill work", () => {
    const hinted = [
      ...all("K", 4, 0),
      ...all("K", 4, 8).map((x) =>
        x.dimension === "recall" ? { ...x, hints: 2 } : x
      ),
    ];
    const s = evaluate("K", hinted, T0 + 9 * DAY);
    expect(s.mastered).toBe(false);
    expect(s.blockers.join()).toContain("hint");
    expect(s.next).toMatchObject({ action: "retest", dimension: "recall" });

    const helped = [
      ...all("K", 4, 0),
      ...all("K", 4, 8),
      ...all("S", 4, 0),
      ...all("S", 4, 8).map((x) =>
        x.dimension === "build" ? { ...x, independent: false } : x
      ),
    ];
    const s2 = evaluate("KS", helped, T0 + 9 * DAY);
    expect(s2.mastered).toBe(false);
    expect(s2.blockers.join()).toContain("independently");
    expect(s2.next).toMatchObject({ action: "retest", dimension: "build" });
  });

  it("falling back below 3 after being good blocks mastery again", () => {
    const list = [
      ...all("K", 4, 0),
      ...all("K", 4, 8),
      a("K", "transfer", 1, 20),
    ];
    const s = evaluate("K", list, T0 + 21 * DAY);
    expect(s.mastered).toBe(false);
    expect(s.next).toMatchObject({ action: "revisit", dimension: "transfer" });
  });
});
