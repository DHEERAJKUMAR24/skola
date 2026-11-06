// Pure on purpose: the settings page, the master card builder and the MCP server share these rules.
// No Dexie, no Node APIs. See docs/adr/0014-master-card-design.md.

/** Synced setting that holds the user's knowledge hierarchy. `undefined` means the default. */
export const HIERARCHY_KEY = "#hierarchy";

/**
 * What a level maps to in Skola:
 * - `deck`: a (nested) deck. Several deck levels nest in order, top to bottom.
 * - `master`: a master card (optional level; most users leave it out and let masters live in
 *   the deepest deck).
 * - `section`: a top-level section inside a master card. Several section levels nest.
 * - `entry`: one entry of a master card (a concept or fact, linked to a card). Always last.
 */
export type HierarchyRole = "deck" | "master" | "section" | "entry";

export interface HierarchyLevel {
  /** Stable id, so renaming a level never breaks anything that points at it. */
  id: string;
  /** What the user calls it, for example "Domain". */
  name: string;
  role: HierarchyRole;
}

export const HIERARCHY_ROLES: HierarchyRole[] = [
  "deck",
  "master",
  "section",
  "entry",
];

export const HIERARCHY_ROLE_LABELS: Record<HierarchyRole, string> = {
  deck: "Deck",
  master: "Master card",
  section: "Section of a master card",
  entry: "Entry of a master card",
};

export const HIERARCHY_MAX_LEVELS = 8;
export const HIERARCHY_NAME_MAX = 40;

/** Domain and Subject are nested decks, a chapter is a section of a master card, a concept an entry. */
export const DEFAULT_HIERARCHY: HierarchyLevel[] = [
  { id: "domain", name: "Domain", role: "deck" },
  { id: "subject", name: "Subject", role: "deck" },
  { id: "chapter", name: "Chapter", role: "section" },
  { id: "concept", name: "Concept", role: "entry" },
];

const ROLE_ORDER: Record<HierarchyRole, number> = {
  deck: 0,
  master: 1,
  section: 2,
  entry: 3,
};

function isRole(x: unknown): x is HierarchyRole {
  return typeof x === "string" && x in ROLE_ORDER;
}

/** A fresh id that is not in `taken`, derived from a name when possible. */
export function newLevelId(taken: Iterable<string>, name = "level"): string {
  const used = new Set(taken);
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "level";
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * Cleans anything read from storage or sync into a list of levels: drops entries that are not
 * objects or have an unknown role, trims names, fills in missing ids and makes ids unique. It
 * does not enforce the ordering rules (see validateHierarchy), so a half-edited list survives.
 */
export function normalizeHierarchy(input: unknown): HierarchyLevel[] {
  if (!Array.isArray(input)) return [];
  const out: HierarchyLevel[] = [];
  const ids = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (!isRole(r.role)) continue;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    let id = typeof r.id === "string" ? r.id.trim() : "";
    if (!id || ids.has(id)) id = newLevelId(ids, name);
    ids.add(id);
    out.push({ id, name, role: r.role });
    if (out.length >= HIERARCHY_MAX_LEVELS) break;
  }
  return out;
}

/**
 * The rules: 1 to 8 levels with unique non-empty names; roles run deck (any number), then master
 * (at most one), then section (any number), and the last level is the one and only entry.
 * Returns the first problem or null.
 */
export function validateHierarchy(levels: HierarchyLevel[]): string | null {
  if (levels.length === 0) return "Add at least one level.";
  if (levels.length > HIERARCHY_MAX_LEVELS)
    return `At most ${HIERARCHY_MAX_LEVELS} levels.`;
  const names = new Set<string>();
  for (const l of levels) {
    if (!l.name.trim()) return "Every level needs a name.";
    if (l.name.length > HIERARCHY_NAME_MAX)
      return `A level name can be at most ${HIERARCHY_NAME_MAX} characters.`;
    const key = l.name.trim().toLowerCase();
    if (names.has(key)) return `Two levels are called "${l.name.trim()}".`;
    names.add(key);
  }
  if (levels.filter((l) => l.role === "entry").length !== 1)
    return "Exactly one level must be the entry (the concept or fact a card covers).";
  if (levels[levels.length - 1].role !== "entry")
    return "The entry must be the last (lowest) level.";
  for (let i = 1; i < levels.length; i++)
    if (ROLE_ORDER[levels[i].role] < ROLE_ORDER[levels[i - 1].role])
      return "Order the levels deck, then master card, then section, then entry.";
  if (levels.filter((l) => l.role === "master").length > 1)
    return "Only one level can be the master card.";
  return null;
}

/** The hierarchy in force: the saved one when it is valid, else the default. */
export function effectiveHierarchy(saved: unknown): {
  levels: HierarchyLevel[];
  isDefault: boolean;
} {
  if (saved === undefined || saved === null)
    return { levels: DEFAULT_HIERARCHY, isDefault: true };
  const levels = normalizeHierarchy(saved);
  if (validateHierarchy(levels))
    return { levels: DEFAULT_HIERARCHY, isDefault: true };
  return { levels, isDefault: sameLevels(levels, DEFAULT_HIERARCHY) };
}

export function sameLevels(a: HierarchyLevel[], b: HierarchyLevel[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (l, i) => l.id === b[i].id && l.name === b[i].name && l.role === b[i].role
    )
  );
}

/** Levels with the given role, top to bottom. */
export function levelsWithRole(
  levels: HierarchyLevel[],
  role: HierarchyRole
): HierarchyLevel[] {
  return levels.filter((l) => l.role === role);
}

/**
 * The name for the level at `depth` (0 = top) of nested decks: the deck levels in order. Decks
 * deeper than the defined levels get the last deck level's name; without deck levels, "Deck".
 */
export function deckLevelName(levels: HierarchyLevel[], depth: number): string {
  const decks = levelsWithRole(levels, "deck");
  if (decks.length === 0) return "Deck";
  return decks[Math.min(Math.max(depth, 0), decks.length - 1)].name;
}

/** Name of the entry level (a concept by default). */
export function entryName(levels: HierarchyLevel[]): string {
  return levelsWithRole(levels, "entry")[0]?.name ?? "Entry";
}

/** Name of the section level at `depth` (0 = top-level section), clamped like deckLevelName. */
export function sectionLevelName(
  levels: HierarchyLevel[],
  depth: number
): string {
  const s = levelsWithRole(levels, "section");
  if (s.length === 0) return "Section";
  return s[Math.min(Math.max(depth, 0), s.length - 1)].name;
}

/** One paragraph for assistants (the MCP server can append it to the profile instructions). */
export function hierarchyInstructions(levels: HierarchyLevel[]): string {
  const parts = levels.map((l) => {
    switch (l.role) {
      case "deck":
        return `${l.name} = a deck (nested in this order)`;
      case "master":
        return `${l.name} = a master card`;
      case "section":
        return `${l.name} = a section inside a master card`;
      case "entry":
        return `${l.name} = one entry of a master card, linked to one card`;
    }
  });
  return `My knowledge hierarchy, top to bottom: ${parts.join("; ")}. A master card lists every concept of its deck with nothing left out.`;
}
