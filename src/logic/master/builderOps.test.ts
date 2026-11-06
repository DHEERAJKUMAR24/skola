import { describe, expect, it } from "vitest";
import {
  addEntry,
  addOrphanEntries,
  fixDangling,
  fixSameCardDuplicates,
  fixSimilarDuplicates,
  linkEntries,
  locateEntry,
  moveEntry,
  moveEntryBy,
  moveSection,
  orphansFirst,
  patchEntry,
  removeEntries,
  suggestCards,
  suggestLinks,
} from "./builderOps";
import { analyzeCoverage } from "./coverage";
import type { MasterSection } from "./masterModel";

const mk = (): MasterSection[] => [
  {
    id: "s1",
    title: "A",
    entries: [
      { id: "a", text: "alpha" },
      { id: "b", text: "beta", cardId: "c2" },
      { id: "c", text: "gamma" },
    ],
  },
  { id: "s2", title: "B", entries: [{ id: "d", text: "delta" }] },
];
const ids = (s: MasterSection[]) => s.map((x) => x.entries.map((e) => e.id));

describe("moving", () => {
  it("moves within a section, forward and back", () => {
    expect(ids(moveEntry(mk(), "a", "s1", 2))).toEqual([
      ["b", "a", "c"],
      ["d"],
    ]);
    expect(ids(moveEntry(mk(), "c", "s1", 0))).toEqual([
      ["c", "a", "b"],
      ["d"],
    ]);
  });
  it("moves across sections and clamps the index", () => {
    expect(ids(moveEntry(mk(), "a", "s2", 99))).toEqual([
      ["b", "c"],
      ["d", "a"],
    ]);
  });
  it("moveEntryBy crosses section edges and stops at the ends", () => {
    expect(ids(moveEntryBy(mk(), "c", 1))).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(ids(moveEntryBy(mk(), "d", -1))).toEqual([["a", "b", "c", "d"], []]);
    expect(ids(moveEntryBy(mk(), "a", -1))).toEqual(ids(mk()));
    expect(ids(moveEntryBy(mk(), "d", 1))).toEqual(ids(mk()));
    expect(ids(moveEntryBy(mk(), "a", 1))).toEqual([["b", "a", "c"], ["d"]]);
  });
  it("unknown ids change nothing and the input is not mutated", () => {
    const s = mk();
    expect(moveEntry(s, "zzz", "s1", 0)).toBe(s);
    moveEntry(s, "a", "s2", 0);
    expect(ids(s)).toEqual(ids(mk()));
  });
  it("moves sections", () => {
    expect(moveSection(mk(), "s1", 1).map((s) => s.id)).toEqual(["s2", "s1"]);
    const s = mk();
    expect(moveSection(s, "s1", -1)).toBe(s);
  });
  it("keeps untouched sections by identity", () => {
    const s = mk();
    const n = moveEntry(s, "a", "s1", 2);
    expect(n[1]).toBe(s[1]);
  });
});

describe("editing", () => {
  it("patches, unlinks, adds and removes", () => {
    let s = patchEntry(mk(), "a", { text: "ALPHA", cardId: "c1" });
    expect(s[0].entries[0]).toMatchObject({ text: "ALPHA", cardId: "c1" });
    s = patchEntry(s, "a", { clearCard: true });
    expect("cardId" in s[0].entries[0]).toBe(false);
    const added = addEntry(s, "s2", "eps", "c9");
    expect(locateEntry(added.sections, added.entry.id)).toEqual({
      sectionIndex: 1,
      entryIndex: 1,
    });
    expect(ids(removeEntries(mk(), ["a", "d"]))).toEqual([["b", "c"], []]);
  });
});

describe("addOrphanEntries", () => {
  const orphans = [
    { cardId: "x1", text: "one", tags: ["js", "x"] },
    { cardId: "x2", text: "two", tags: ["js"] },
    { cardId: "x3", text: "three" },
    { cardId: "c2", text: "already linked", tags: ["js"] },
  ];
  it("groups by first tag, reuses sections case-insensitively, skips linked", () => {
    const base: MasterSection[] = [
      { id: "t", title: "JS", entries: [] },
      ...mk(),
    ];
    const r = addOrphanEntries(base, orphans, { groupByTags: true });
    expect(r.added).toBe(3);
    expect(r.sections[0].entries.map((e) => e.cardId)).toEqual(["x1", "x2"]);
    const untagged = r.sections.find((s) => s.title === "Untagged");
    expect(untagged?.entries.map((e) => e.cardId)).toEqual(["x3"]);
    expect(r.sections[2]).toBe(base[2]);
  });
  it("without grouping uses one section", () => {
    const r = addOrphanEntries(mk(), orphans, { fallbackTitle: "Cards" });
    expect(r.sections).toHaveLength(3);
    expect(r.sections[2].title).toBe("Cards");
    expect(r.sections[2].entries).toHaveLength(3);
  });
  it("is idempotent", () => {
    const once = addOrphanEntries(mk(), orphans, { groupByTags: true });
    expect(
      addOrphanEntries(once.sections, orphans, { groupByTags: true }).added
    ).toBe(0);
  });
});

describe("linking suggestions", () => {
  const choices = [
    { id: "k1", text: "closures capture variables", orphan: false },
    { id: "k2", text: "closures capture scope variables", orphan: true },
    { id: "k3", text: "prototype chain", orphan: true },
  ];
  it("orphansFirst sorts without mutating", () => {
    const sorted = orphansFirst(choices);
    expect(sorted.map((c) => c.id)).toEqual(["k2", "k3", "k1"]);
    expect(choices[0].id).toBe("k1");
  });
  it("suggests the best match", () => {
    const hits = suggestCards("closures capture variables", choices);
    expect(hits[0].id).toBe("k1");
    expect(suggestCards("   ", choices)).toEqual([]);
    expect(suggestCards("zzz", choices)).toEqual([]);
  });
  it("suggestLinks gives each card to one entry", () => {
    const s: MasterSection[] = [
      {
        id: "s",
        title: "S",
        entries: [
          { id: "e1", text: "closures capture variables" },
          { id: "e2", text: "closures capture variables" },
          { id: "e3", text: "the prototype chain" },
          { id: "e4", text: "linked", cardId: "k3" },
        ],
      },
    ];
    const out = suggestLinks(s, choices);
    expect(new Set(out.map((o) => o.cardId)).size).toBe(out.length);
    expect(out.find((o) => o.entryId === "e3")?.cardId).toBe("k3");
    expect(out.some((o) => o.entryId === "e4")).toBe(false);
    const linked = linkEntries(
      s,
      out.map(({ entryId, cardId }) => ({ entryId, cardId }))
    );
    expect(linked[0].entries[2].cardId).toBe("k3");
  });
});

describe("coverage fixes", () => {
  it("dangling: unlink, drop when no text", () => {
    const s: MasterSection[] = [
      {
        id: "s",
        title: "S",
        entries: [
          { id: "a", text: "keep text", cardId: "gone" },
          { id: "b", text: "", cardId: "gone2" },
        ],
      },
    ];
    const r = analyzeCoverage(s, []);
    expect(fixDangling(s, r)[0].entries).toEqual([
      { id: "a", text: "keep text" },
    ]);
  });
  it("duplicates keep the first of each group", () => {
    const s: MasterSection[] = [
      {
        id: "s",
        title: "S",
        entries: [
          { id: "a", text: "same", cardId: "c1" },
          { id: "b", text: "other words here", cardId: "c1" },
          { id: "c", text: "the quick brown fox" },
          { id: "d", text: "the quick brown fox" },
        ],
      },
    ];
    const r = analyzeCoverage(s, [{ id: "c1" }]);
    const a = fixSameCardDuplicates(s, r.duplicates);
    expect(a[0].entries.map((e) => e.id)).toEqual(["a", "c", "d"]);
    const b = fixSimilarDuplicates(a, r.duplicates);
    expect(b[0].entries.map((e) => e.id)).toEqual(["a", "c"]);
  });
});
