import { describe, expect, it } from "vitest";
import {
  type DupItem,
  featuresOf,
  findDuplicateGroups,
  pairScore,
  sidesOfContent,
  stem,
  tokens,
} from "./similarity";

const item = (
  id: string,
  question: string,
  answer: string,
  x: Partial<DupItem> = {}
): DupItem => ({ id, sides: { question, answer }, ...x });
const score = (a: [string, string], b: [string, string]) =>
  pairScore(
    featuresOf({ question: a[0], answer: a[1] }),
    featuresOf({ question: b[0], answer: b[1] })
  );

describe("tokens", () => {
  it("normalises case, accents, markup, stop words and endings", () => {
    expect(tokens("<p>The Cafés &amp; Running</p>")).toEqual(["caf", "run"]);
    expect(stem("making")).toBe(stem("make"));
    expect(stem("cities")).toBe("city");
    expect(stem("class")).toBe("class");
  });
});

describe("pairScore", () => {
  it("is 1 for identical, high for rewording, low for different", () => {
    expect(
      score(
        ["Powerhouse of the cell?", "Mitochondria"],
        ["Powerhouse of the cell?", "Mitochondria"]
      )
    ).toBeCloseTo(1);
    expect(
      score(
        ["What do mitochondria produce?", "ATP energy"],
        ["What do the mitochondria produce?", "Energy (ATP)"]
      )
    ).toBeGreaterThan(0.75);
    expect(
      score(["Capital of France", "Paris"], ["Largest planet", "Jupiter"])
    ).toBeLessThan(0.2);
  });
  it("scores the same question with another answer low (conflict, not duplicate)", () => {
    expect(
      score(
        ["Boiling point of water", "100 C"],
        ["Boiling point of water", "Mount Everest"]
      )
    ).toBeLessThan(0.5);
  });
  it("is symmetric for reverse notes but not for basic ones", () => {
    const rev = featuresOf({
      question: "chat",
      answer: "cat",
      symmetric: true,
    });
    const flip = featuresOf({ question: "cat", answer: "chat" });
    expect(pairScore(rev, flip)).toBeCloseTo(1);
    expect(
      pairScore(featuresOf({ question: "chat", answer: "cat" }), flip)
    ).toBeLessThan(0.3);
  });
  it("judges a card with no answer side on its question", () => {
    expect(score(["Heart diagram", ""], ["Heart diagram", ""])).toBeCloseTo(1);
    expect(score(["Heart diagram", ""], ["Heart diagram", "ventricle"])).toBe(
      0
    );
  });
});

describe("sidesOfContent", () => {
  it("reads each note type by its own parts", () => {
    expect(
      sidesOfContent({ type: "normal", front: "<p>a</p>", back: "<p>b</p>" })
    ).toEqual({ question: "a", answer: "b" });
    expect(
      sidesOfContent({
        type: "cloze",
        text: "<p>The {{c1::sun}} is {{c2::hot::hint}}</p>",
      })
    ).toEqual({ question: "The is", answer: "sun hot" });
    expect(
      sidesOfContent({
        type: "multipleChoice",
        question: "q",
        choices: [
          { text: "x", correct: true },
          { text: "y", correct: false },
        ],
      })
    ).toEqual({ question: "q", answer: "x" });
    expect(
      sidesOfContent({ type: "list", front: "f", items: ["a", "b"] })
    ).toEqual({ question: "f", answer: "a b" });
    expect(
      sidesOfContent({ type: "doubleSided", field1: "a", field2: "b" })
        ?.symmetric
    ).toBe(true);
    expect(sidesOfContent({ type: "imageOcclusion" })).toBeNull();
  });
});

describe("findDuplicateGroups", () => {
  const items = [
    item("old", "What is the powerhouse of the cell?", "Mitochondria", {
      weight: 5,
      created: 1,
    }),
    item(
      "new",
      "Which organelle is the cell's powerhouse?",
      "The mitochondria, makes ATP",
      { weight: 0, created: 2 }
    ),
    item("x", "Capital of France", "Paris"),
    item("y", "Largest planet", "Jupiter"),
  ];
  it("groups, picks the keeper by reviews, and lists terms to merge", () => {
    const r = findDuplicateGroups(items, { threshold: 0.5 });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].ids).toEqual(["old", "new"]);
    expect(r.groups[0].keep).toBe("old");
    expect(r.groups[0].suggestion).toBe("merge_then_delete");
    expect(r.groups[0].missing_from_keep).toContain("atp");
    expect(r.truncated).toBe(false);
  });
  it("suggests plain deletion when the copy adds nothing", () => {
    const r = findDuplicateGroups([
      item("a", "Define entropy", "Disorder", { weight: 2 }),
      item("b", "Define entropy.", "disorder"),
    ]);
    expect(r.groups[0]).toMatchObject({
      keep: "a",
      suggestion: "delete_duplicates",
      missing_from_keep: [],
    });
  });
  it("clamps the threshold to the documented minimum", () => {
    expect(
      findDuplicateGroups(items, { threshold: 0 }).groups.every(
        (g) => g.min_score >= 0.5
      )
    ).toBe(true);
  });
  it("stops at the item cap and the time budget and says so", () => {
    expect(findDuplicateGroups(items, { maxItems: 2 })).toMatchObject({
      truncated: true,
      reason: "items",
      items_searched: 2,
    });
    let t = 0;
    const r = findDuplicateGroups(items, { budgetMs: 5, now: () => (t += 10) });
    expect(r).toMatchObject({ truncated: true, reason: "time" });
  });
  it("handles a large collection within the budget", () => {
    const many = Array.from({ length: 1500 }, (_, i) =>
      item(
        `n${i}`,
        `question number ${i} about topic ${i % 50}`,
        `answer ${i * 7} unique${i}`
      )
    );
    const start = Date.now();
    const r = findDuplicateGroups(many, { threshold: 0.9 });
    expect(Date.now() - start).toBeLessThan(4000);
    expect(r.items_searched).toBe(1500);
  });
});
