import { Rating, State } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import {
  buildGapChecklist,
  combineSweepWithSuggestion,
  matchRecall,
  parseRecallInput,
  parseWeakDrillParam,
  pickWeakSpots,
  summarizeSweep,
  weakDrillParam,
} from "./activities";
import { analyzeCoverage } from "./coverage";
import type { MasterSection } from "./masterModel";

describe("recall sweep", () => {
  it("parses lines, commas and list markers", () => {
    expect(parseRecallInput("- closures\n2) hoisting, scope; \n\n")).toEqual([
      "closures",
      "hoisting",
      "scope",
    ]);
  });
  const entries = [
    { id: "1", text: "Closures and lexical scope" },
    { id: "2", text: "Hoisting" },
    { id: "3", text: "Event loop" },
  ];
  it("matches entries to typed items, one each", () => {
    const m = matchRecall(entries, [
      "lexical scope closures",
      "hoisting",
      "garbage",
    ]);
    expect(m.map((x) => !!x.typed)).toEqual([true, true, false]);
    expect(m[1].typed).toBe("hoisting");
  });
  it("a short entry is hit when the item holds all its words", () => {
    const m = matchRecall(entries, [
      "I remember the event loop and microtasks",
    ]);
    expect(m[2].typed).toBeDefined();
  });
  it("an item hits only one entry", () => {
    const m = matchRecall(
      [
        { id: "a", text: "hoisting" },
        { id: "b", text: "hoisting" },
      ],
      ["hoisting"]
    );
    expect(m.filter((x) => x.typed)).toHaveLength(1);
  });
  it("summarizes marks, unmarked count as not found", () => {
    const s = summarizeSweep(["1", "2", "3", "4"], {
      1: "found",
      2: "missed",
      3: "found",
    });
    expect(s).toMatchObject({
      total: 4,
      found: 2,
      missed: 1,
      unmarked: 1,
      recall: 0.5,
    });
    expect(s.missedEntryIds).toEqual(["2"]);
    expect(summarizeSweep([], {}).recall).toBe(0);
  });
  it("combines with the FSRS score; Easy needs everything found", () => {
    const all = summarizeSweep(["a", "b"], { a: "found", b: "found" });
    expect(combineSweepWithSuggestion(all, { score: 1 }).rating).toBe(
      Rating.Easy
    );
    const keys = "abcdefghijklmnopqrst".split("");
    const nineteen = summarizeSweep(
      keys,
      Object.fromEntries(keys.slice(0, 19).map((k) => [k, "found" as const]))
    );
    expect(combineSweepWithSuggestion(nineteen, { score: 1 }).rating).toBe(
      Rating.Good
    );
    const none = summarizeSweep(["a"], { a: "missed" });
    expect(combineSweepWithSuggestion(none, { score: 0.9 }).rating).toBe(
      Rating.Again
    );
    expect(combineSweepWithSuggestion(none, null).rating).toBe(Rating.Again);
    expect(
      combineSweepWithSuggestion(summarizeSweep([], {}), null).rating
    ).toBe(Rating.Again);
    expect(combineSweepWithSuggestion(all, null).reasons[0]).toContain(
      "2 of 2"
    );
  });
});

describe("gap checklist", () => {
  const sections: MasterSection[] = [
    {
      id: "s1",
      title: "Sec",
      entries: [
        { id: "e1", text: "linked", cardId: "c1" },
        { id: "e2", text: "dangling", cardId: "gone" },
        { id: "e3", text: "no card" },
      ],
    },
    { id: "s2", title: "Empty", entries: [] },
  ];
  const report = analyzeCoverage(
    sections,
    [
      { id: "c1", state: State.New },
      { id: "c9", state: State.Review },
    ],
    { now: 0 }
  );
  const labels = {
    card: (id: string) => `card ${id}`,
    entry: (id: string) => `entry ${id}`,
    section: (id: string) => `section ${id}`,
  };
  it("one item per problem with stable ids", () => {
    const items = buildGapChecklist(report, labels);
    expect(items.map((i) => i.kind)).toEqual(
      expect.arrayContaining([
        "orphan",
        "dangling",
        "empty",
        "unlinked",
        "stale",
      ])
    );
    expect(items.find((i) => i.kind === "orphan")?.cardId).toBe("c9");
    expect(items.find((i) => i.kind === "stale")?.detail).toContain(
      "never reviewed"
    );
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
  it("is empty for a complete master", () => {
    const r = analyzeCoverage(
      [{ id: "s", title: "S", entries: [{ id: "e", text: "x", cardId: "c" }] }],
      [{ id: "c", state: State.Review, due: 0, reps: 3 }],
      { now: 1000 }
    );
    expect(buildGapChecklist(r, labels)).toEqual([]);
  });
});

describe("weak spots", () => {
  const day = 86_400_000;
  const now = 100 * day;
  const review = (stability: number, daysAgo: number, extra = {}) => ({
    state: State.Review,
    stability,
    due: now - day,
    lastReview: now - daysAgo * day,
    lapses: 0,
    reps: 5,
    ...extra,
  });
  it("orders weakest first, new cards last, skips strong, suspended and repeats", () => {
    const out = pickWeakSpots(
      [
        { cardId: "strong", state: review(300, 1) },
        { cardId: "weak", state: review(2, 30, { lapses: 2 }) },
        { cardId: "meh", state: review(10, 20) },
        { cardId: "new", state: { state: State.New, stability: 0 } },
        { cardId: "susp", state: review(1, 50, { suspended: true }) },
        { cardId: "weak", state: review(2, 30) },
      ],
      now
    );
    expect(out.map((o) => o.cardId)).toEqual(["weak", "meh", "new"]);
    expect(out[0].reason).toBe("lapsed");
    expect(out[2].reason).toBe("new");
  });
  it("respects the limit", () => {
    const cards = Array.from({ length: 10 }, (_, i) => ({
      cardId: `c${i}`,
      state: review(1, 50),
    }));
    expect(pickWeakSpots(cards, now, { limit: 3 })).toHaveLength(3);
  });
  it("round trips the route param", () => {
    expect(parseWeakDrillParam(weakDrillParam("abc"))).toBe("abc");
    expect(parseWeakDrillParam("cram")).toBeNull();
    expect(parseWeakDrillParam(undefined)).toBeNull();
    expect(parseWeakDrillParam("weak.")).toBeNull();
  });
});
