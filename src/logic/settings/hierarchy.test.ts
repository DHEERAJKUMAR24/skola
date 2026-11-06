import { describe, expect, it } from "vitest";
import {
  DEFAULT_HIERARCHY,
  type HierarchyLevel,
  deckLevelName,
  effectiveHierarchy,
  entryName,
  hierarchyInstructions,
  newLevelId,
  normalizeHierarchy,
  sameLevels,
  sectionLevelName,
  validateHierarchy,
} from "./hierarchy";

const L = (name: string, role: HierarchyLevel["role"]): HierarchyLevel => ({
  id: name.toLowerCase(),
  name,
  role,
});

describe("hierarchy defaults", () => {
  it("is valid and maps Domain and Subject to nested decks", () => {
    expect(validateHierarchy(DEFAULT_HIERARCHY)).toBeNull();
    expect(DEFAULT_HIERARCHY.map((l) => l.role)).toEqual([
      "deck",
      "deck",
      "section",
      "entry",
    ]);
    expect(DEFAULT_HIERARCHY.map((l) => l.name)).toEqual([
      "Domain",
      "Subject",
      "Chapter",
      "Concept",
    ]);
  });
});

describe("validateHierarchy", () => {
  it("accepts a master level, several sections, or only an entry", () => {
    expect(
      validateHierarchy([L("A", "deck"), L("B", "master"), L("C", "entry")])
    ).toBeNull();
    expect(
      validateHierarchy([L("A", "section"), L("B", "section"), L("C", "entry")])
    ).toBeNull();
    expect(validateHierarchy([L("Fact", "entry")])).toBeNull();
  });
  it("rejects empty, too long and duplicate names", () => {
    expect(validateHierarchy([])).toMatch(/at least one/i);
    expect(validateHierarchy([L(" ", "deck"), L("C", "entry")])).toMatch(
      /name/i
    );
    expect(
      validateHierarchy([L("x".repeat(41), "deck"), L("C", "entry")])
    ).toMatch(/40/);
    expect(
      validateHierarchy([
        L("Same", "deck"),
        { ...L("same", "section"), id: "z" },
        L("C", "entry"),
      ])
    ).toMatch(/Two levels/);
  });
  it("needs exactly one entry, and it must be last", () => {
    expect(validateHierarchy([L("A", "deck")])).toMatch(/entry/i);
    expect(validateHierarchy([L("A", "entry"), L("B", "entry")])).toMatch(
      /Exactly one/
    );
    expect(validateHierarchy([L("A", "entry"), L("B", "deck")])).toMatch(
      /last/
    );
  });
  it("enforces role order and one master", () => {
    expect(
      validateHierarchy([L("A", "section"), L("B", "deck"), L("C", "entry")])
    ).toMatch(/Order/);
    expect(
      validateHierarchy([L("A", "master"), L("B", "deck"), L("C", "entry")])
    ).toMatch(/Order/);
    expect(
      validateHierarchy([L("A", "master"), L("B", "master"), L("C", "entry")])
    ).toMatch(/Only one/);
  });
  it("caps the number of levels", () => {
    const many = Array.from({ length: 9 }, (_, i) => L(`D${i}`, "deck"));
    expect(validateHierarchy([...many, L("E", "entry")])).toMatch(/At most/);
  });
});

describe("normalizeHierarchy", () => {
  it("returns [] for junk", () => {
    expect(normalizeHierarchy(undefined)).toEqual([]);
    expect(normalizeHierarchy("x")).toEqual([]);
    expect(normalizeHierarchy({})).toEqual([]);
  });
  it("drops bad rows, trims, fills and dedupes ids", () => {
    const out = normalizeHierarchy([
      null,
      5,
      { id: "a", name: " Domain ", role: "deck" },
      { id: "a", name: "Subject", role: "deck" },
      { name: "Chapter", role: "section" },
      { id: "q", name: "Nope", role: "galaxy" },
      { id: "c", name: "Concept", role: "entry" },
    ]);
    expect(out.map((l) => l.name)).toEqual([
      "Domain",
      "Subject",
      "Chapter",
      "Concept",
    ]);
    expect(new Set(out.map((l) => l.id)).size).toBe(4);
    expect(out[2].id).toBe("chapter");
  });
  it("caps at 8 levels", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `n${i}`,
      role: "deck",
    }));
    expect(normalizeHierarchy(many)).toHaveLength(8);
  });
  it("keeps a half-edited list (order is validate's job)", () => {
    expect(
      normalizeHierarchy([
        { id: "a", name: "", role: "entry" },
        { id: "b", name: "B", role: "deck" },
      ])
    ).toHaveLength(2);
  });
});

describe("effectiveHierarchy", () => {
  it("defaults when never saved or invalid", () => {
    expect(effectiveHierarchy(undefined)).toEqual({
      levels: DEFAULT_HIERARCHY,
      isDefault: true,
    });
    expect(
      effectiveHierarchy([{ id: "x", name: "X", role: "deck" }]).isDefault
    ).toBe(true);
  });
  it("uses a saved valid hierarchy", () => {
    const saved = [L("Field", "deck"), L("Point", "entry")];
    const e = effectiveHierarchy(saved);
    expect(e.isDefault).toBe(false);
    expect(e.levels).toEqual(saved);
  });
  it("sameLevels compares by id, name and role", () => {
    expect(sameLevels(DEFAULT_HIERARCHY, [...DEFAULT_HIERARCHY])).toBe(true);
    expect(sameLevels(DEFAULT_HIERARCHY, DEFAULT_HIERARCHY.slice(1))).toBe(
      false
    );
  });
});

describe("level names", () => {
  it("names nested decks by depth and clamps", () => {
    expect(deckLevelName(DEFAULT_HIERARCHY, 0)).toBe("Domain");
    expect(deckLevelName(DEFAULT_HIERARCHY, 1)).toBe("Subject");
    expect(deckLevelName(DEFAULT_HIERARCHY, 5)).toBe("Subject");
    expect(deckLevelName([L("C", "entry")], 0)).toBe("Deck");
  });
  it("names sections and entries", () => {
    expect(sectionLevelName(DEFAULT_HIERARCHY, 0)).toBe("Chapter");
    expect(sectionLevelName([L("C", "entry")], 0)).toBe("Section");
    expect(entryName(DEFAULT_HIERARCHY)).toBe("Concept");
  });
  it("makes unique ids", () => {
    expect(newLevelId(["a"], "A")).toBe("a-2");
    expect(newLevelId([], "  ")).toBe("level");
  });
});

describe("hierarchyInstructions", () => {
  it("mentions each level name", () => {
    const t = hierarchyInstructions(DEFAULT_HIERARCHY);
    for (const n of ["Domain", "Subject", "Chapter", "Concept"])
      expect(t).toContain(n);
  });
});
