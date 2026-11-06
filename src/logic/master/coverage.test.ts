import { State } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import {
  type CoverageCard,
  analyzeCoverage,
  describeCoverage,
  entryWords,
  staleReasons,
  textSimilarity,
} from "./coverage";
import type { MasterSection } from "./masterModel";

const NOW = Date.UTC(2026, 10, 6);
const DAY = 86_400_000;

const card = (id: string, extra: Partial<CoverageCard> = {}): CoverageCard => ({
  id,
  state: State.Review,
  due: NOW + DAY,
  lastReview: NOW - DAY,
  reps: 3,
  ...extra,
});
const sec = (
  id: string,
  entries: { id: string; text?: string; cardId?: string }[]
): MasterSection => ({
  id,
  title: id,
  entries: entries.map((e) => ({
    id: e.id,
    text: e.text ?? "",
    cardId: e.cardId,
  })),
});

describe("analyzeCoverage: clean master", () => {
  it("reports nothing when every card has exactly one entry", () => {
    const r = analyzeCoverage(
      [
        sec("s1", [
          { id: "e1", text: "closures", cardId: "c1" },
          { id: "e2", text: "hoisting", cardId: "c2" },
        ]),
      ],
      [card("c1"), card("c2")],
      { now: NOW }
    );
    expect(r.complete).toBe(true);
    expect(r.orphanCards).toEqual([]);
    expect(r.danglingEntries).toEqual([]);
    expect(r.emptySections).toEqual([]);
    expect(r.staleEntries).toEqual([]);
    expect(r.duplicates).toEqual({ sameCard: [], similarText: [] });
    expect(r.stats).toMatchObject({ entries: 2, linked: 2, coverage: 1 });
    expect(describeCoverage(r)).toEqual([]);
  });
  it("an empty deck and a master without sections are complete", () => {
    const r = analyzeCoverage([], [], { now: NOW });
    expect(r.complete).toBe(true);
    expect(r.stats.coverage).toBe(1);
  });
});

describe("orphan cards", () => {
  const sections = [sec("s", [{ id: "e", text: "a", cardId: "c1" }])];
  it("lists deck cards that are in no entry", () => {
    const r = analyzeCoverage(sections, [card("c1"), card("c2"), card("c3")], {
      now: NOW,
    });
    expect(r.orphanCards).toEqual(["c2", "c3"]);
    expect(r.complete).toBe(false);
    expect(r.stats.coverage).toBeCloseTo(1 / 3);
    expect(describeCoverage(r)[0]).toBe("2 cards are in no entry");
  });
  it("ignores cards on the ignore list (the masters' own cards)", () => {
    const r = analyzeCoverage(sections, [card("c1"), card("m1")], {
      now: NOW,
      ignoreCardIds: ["m1"],
    });
    expect(r.orphanCards).toEqual([]);
    expect(r.stats.coveredCards).toBe(1);
    expect(r.stats.deckCards).toBe(2);
  });
  it("does not count deleted cards as orphans", () => {
    const r = analyzeCoverage(
      sections,
      [card("c1"), card("c2", { deleted: true })],
      {
        now: NOW,
      }
    );
    expect(r.orphanCards).toEqual([]);
  });
  it("a card linked twice is still covered once", () => {
    const r = analyzeCoverage(
      [
        sec("s", [
          { id: "e1", text: "x one", cardId: "c1" },
          { id: "e2", text: "totally different", cardId: "c1" },
        ]),
      ],
      [card("c1")],
      { now: NOW }
    );
    expect(r.stats.coveredCards).toBe(1);
  });
});

describe("dangling entries", () => {
  it("flags a card id that is not in the deck", () => {
    const r = analyzeCoverage(
      [sec("s", [{ id: "e", text: "a", cardId: "gone" }])],
      [card("c1")],
      { now: NOW }
    );
    expect(r.danglingEntries).toEqual([
      { sectionId: "s", entryId: "e", cardId: "gone" },
    ]);
    expect(r.complete).toBe(false);
  });
  it("flags a deleted card", () => {
    const r = analyzeCoverage(
      [sec("s", [{ id: "e", text: "a", cardId: "c1" }])],
      [card("c1", { deleted: true })],
      { now: NOW }
    );
    expect(r.danglingEntries).toHaveLength(1);
  });
  it("accepts a card of another deck when it is listed as external", () => {
    const r = analyzeCoverage(
      [sec("s", [{ id: "e", text: "a", cardId: "other" }])],
      [],
      { now: NOW, externalCardIds: ["other"] }
    );
    expect(r.danglingEntries).toEqual([]);
    expect(r.stats.linked).toBe(1);
  });
});

describe("empty sections and unlinked entries", () => {
  it("flags sections without entries or with only blank ones", () => {
    const r = analyzeCoverage(
      [
        sec("a", []),
        sec("b", [{ id: "e", text: "  " }]),
        sec("c", [{ id: "f", text: "x", cardId: "c1" }]),
      ],
      [card("c1")],
      { now: NOW }
    );
    expect(r.emptySections).toEqual(["a", "b"]);
    expect(r.stats.entries).toBe(1);
  });
  it("an entry with only a card id is not blank", () => {
    const r = analyzeCoverage(
      [sec("a", [{ id: "e", cardId: "c1" }])],
      [card("c1")],
      { now: NOW }
    );
    expect(r.emptySections).toEqual([]);
  });
  it("lists entries with text but no card", () => {
    const r = analyzeCoverage([sec("a", [{ id: "e", text: "idea" }])], [], {
      now: NOW,
    });
    expect(r.unlinkedEntries).toEqual([{ sectionId: "a", entryId: "e" }]);
    expect(r.complete).toBe(false);
  });
});

describe("stale entries", () => {
  const run = (c: CoverageCard) =>
    analyzeCoverage([sec("s", [{ id: "e", text: "a", cardId: c.id }])], [c], {
      now: NOW,
    }).staleEntries;

  it("suspended", () => {
    expect(run(card("c", { suspended: true }))[0].reasons).toEqual([
      "suspended",
    ]);
  });
  it("never reviewed", () => {
    expect(
      run(card("c", { state: State.New, reps: 0, lastReview: null }))[0].reasons
    ).toEqual(["never_reviewed"]);
  });
  it("never reviewed when state is missing and no reps or review", () => {
    expect(run({ id: "c" })[0].reasons).toEqual(["never_reviewed"]);
  });
  it("long overdue only past the limit (default 30 days)", () => {
    expect(run(card("c", { due: NOW - 29 * DAY }))).toEqual([]);
    expect(run(card("c", { due: NOW - 31 * DAY }))[0].reasons).toEqual([
      "overdue",
    ]);
  });
  it("custom overdue limit", () => {
    const r = analyzeCoverage(
      [sec("s", [{ id: "e", text: "a", cardId: "c" }])],
      [card("c", { due: NOW - 10 * DAY })],
      { now: NOW, overdueDays: 7 }
    );
    expect(r.staleEntries).toHaveLength(1);
  });
  it("combines suspended and overdue", () => {
    expect(
      run(card("c", { suspended: true, due: NOW - 60 * DAY }))[0].reasons
    ).toEqual(["suspended", "overdue"]);
  });
  it("accepts dates as Date objects", () => {
    expect(
      staleReasons(card("c", { due: new Date(NOW - 90 * DAY) }), NOW, 30)
    ).toEqual(["overdue"]);
  });
  it("a healthy card is not stale", () => {
    expect(run(card("c"))).toEqual([]);
  });
});

describe("duplicates", () => {
  it("same card in two entries, also across sections", () => {
    const r = analyzeCoverage(
      [
        sec("a", [{ id: "e1", text: "alpha", cardId: "c1" }]),
        sec("b", [{ id: "e2", text: "omega", cardId: "c1" }]),
      ],
      [card("c1")],
      { now: NOW }
    );
    expect(r.duplicates.sameCard).toEqual([
      {
        cardId: "c1",
        entries: [
          { sectionId: "a", entryId: "e1" },
          { sectionId: "b", entryId: "e2" },
        ],
      },
    ]);
    expect(r.duplicates.similarText).toEqual([]);
  });
  it("identical text on different cards", () => {
    const r = analyzeCoverage(
      [
        sec("a", [
          { id: "e1", text: "Event loop", cardId: "c1" },
          { id: "e2", text: "event  loop!", cardId: "c2" },
        ]),
      ],
      [card("c1"), card("c2")],
      { now: NOW }
    );
    expect(r.duplicates.similarText).toHaveLength(1);
    expect(r.duplicates.similarText[0].similarity).toBe(1);
  });
  it("near-identical text (4 of 5 words)", () => {
    const r = analyzeCoverage(
      [
        sec("a", [
          { id: "e1", text: "the call stack grows downward" },
          { id: "e2", text: "the call stack grows" },
        ]),
      ],
      [],
      { now: NOW, similarity: 0.8 }
    );
    expect(r.duplicates.similarText).toHaveLength(1);
  });
  it("different entries are not duplicates", () => {
    const r = analyzeCoverage(
      [
        sec("a", [
          { id: "e1", text: "closures capture variables" },
          { id: "e2", text: "hoisting moves declarations" },
        ]),
      ],
      [],
      { now: NOW }
    );
    expect(r.duplicates.similarText).toEqual([]);
  });
  it("groups three similar entries into one group", () => {
    const r = analyzeCoverage(
      [
        sec("a", [
          { id: "e1", text: "promise resolves" },
          { id: "e2", text: "Promise resolves" },
          { id: "e3", text: "promise  resolves." },
        ]),
      ],
      [],
      { now: NOW }
    );
    expect(r.duplicates.similarText).toHaveLength(1);
    expect(r.duplicates.similarText[0].entries).toHaveLength(3);
  });
  it("two entries on the same card with the same text are reported once, as same card", () => {
    const r = analyzeCoverage(
      [
        sec("a", [
          { id: "e1", text: "same", cardId: "c1" },
          { id: "e2", text: "same", cardId: "c1" },
        ]),
      ],
      [card("c1")],
      { now: NOW }
    );
    expect(r.duplicates.sameCard).toHaveLength(1);
    expect(r.duplicates.similarText).toEqual([]);
  });
});

describe("helpers", () => {
  it("entryWords strips markup and punctuation, keeps unicode", () => {
    expect(entryWords("<b>Größe</b>, und: Zahl 42!")).toEqual([
      "größe",
      "und",
      "zahl",
      "42",
    ]);
  });
  it("textSimilarity is 0 for empty and 1 for equal sets", () => {
    expect(textSimilarity("", "x")).toBe(0);
    expect(textSimilarity("a b", "b a")).toBe(1);
    expect(textSimilarity("a b", "b c")).toBeCloseTo(1 / 3);
  });
  it("describeCoverage speaks singular and plural", () => {
    const r = analyzeCoverage([sec("a", []), sec("b", [])], [card("c1")], {
      now: NOW,
    });
    expect(describeCoverage(r)).toEqual([
      "1 card is in no entry",
      "2 empty sections",
    ]);
  });
});
