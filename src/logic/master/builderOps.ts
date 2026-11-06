// Pure edit operations of the master builder (ADR 0014). No Dexie, no React, so they are unit
// tested and the MCP server can reuse them. Every function returns new arrays and never mutates
// its input; untouched sections and entries keep their object identity, so memoized rows skip
// re-rendering on a 300 entry master.
import { type CoverageReport, textSimilarity } from "./coverage";
import {
  type MasterEntry,
  type MasterSection,
  newMasterEntry,
  newMasterSection,
} from "./masterModel";

export interface Located {
  sectionIndex: number;
  entryIndex: number;
}

export function locateEntry(
  sections: MasterSection[],
  entryId: string
): Located | null {
  for (let s = 0; s < sections.length; s++) {
    const e = sections[s].entries.findIndex((x) => x.id === entryId);
    if (e >= 0) return { sectionIndex: s, entryIndex: e };
  }
  return null;
}

/** Moves an entry to `toIndex` of another (or the same) section; the index is clamped. */
export function moveEntry(
  sections: MasterSection[],
  entryId: string,
  toSectionId: string,
  toIndex: number
): MasterSection[] {
  const from = locateEntry(sections, entryId);
  const target = sections.findIndex((s) => s.id === toSectionId);
  if (!from || target < 0) return sections;
  const entry = sections[from.sectionIndex].entries[from.entryIndex];
  return sections.map((s, i) => {
    if (i !== from.sectionIndex && i !== target) return s;
    let list = s.entries;
    if (i === from.sectionIndex)
      list = list.filter((_, k) => k !== from.entryIndex);
    if (i === target) {
      let at = Math.max(0, Math.min(toIndex, list.length));
      // Removing an earlier item of the same list shifts the target slot up by one.
      if (from.sectionIndex === target && from.entryIndex < toIndex)
        at = Math.max(0, Math.min(toIndex - 1, list.length));
      list = [...list.slice(0, at), entry, ...list.slice(at)];
    }
    return { ...s, entries: list };
  });
}

/**
 * Moves an entry one place up (-1) or down (+1). At the edge of a section it crosses into the
 * neighbouring section, so repeated presses walk an entry through the whole master.
 */
export function moveEntryBy(
  sections: MasterSection[],
  entryId: string,
  delta: -1 | 1
): MasterSection[] {
  const at = locateEntry(sections, entryId);
  if (!at) return sections;
  const { sectionIndex: s, entryIndex: e } = at;
  const len = sections[s].entries.length;
  const ni = e + delta;
  if (ni >= 0 && ni < len)
    return moveEntry(
      sections,
      entryId,
      sections[s].id,
      delta > 0 ? ni + 1 : ni
    );
  const ns = s + delta;
  if (ns < 0 || ns >= sections.length) return sections;
  return moveEntry(
    sections,
    entryId,
    sections[ns].id,
    delta > 0 ? 0 : sections[ns].entries.length
  );
}

export function moveSection(
  sections: MasterSection[],
  sectionId: string,
  delta: -1 | 1
): MasterSection[] {
  const i = sections.findIndex((s) => s.id === sectionId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sections.length) return sections;
  const next = [...sections];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function patchEntry(
  sections: MasterSection[],
  entryId: string,
  patch: Partial<Pick<MasterEntry, "text" | "cardId">> & {
    clearCard?: boolean;
  }
): MasterSection[] {
  const at = locateEntry(sections, entryId);
  if (!at) return sections;
  return sections.map((s, i) =>
    i !== at.sectionIndex
      ? s
      : {
          ...s,
          entries: s.entries.map((e) => {
            if (e.id !== entryId) return e;
            const { clearCard, ...rest } = patch;
            if (clearCard) {
              const { cardId: _drop, ...noCard } = { ...e, ...rest };
              return noCard;
            }
            return { ...e, ...rest };
          }),
        }
  );
}

export function removeEntries(
  sections: MasterSection[],
  entryIds: Iterable<string>
): MasterSection[] {
  const drop = new Set(entryIds);
  if (drop.size === 0) return sections;
  return sections.map((s) =>
    s.entries.some((e) => drop.has(e.id))
      ? { ...s, entries: s.entries.filter((e) => !drop.has(e.id)) }
      : s
  );
}

export function addEntry(
  sections: MasterSection[],
  sectionId: string,
  text = "",
  cardId?: string
): { sections: MasterSection[]; entry: MasterEntry } {
  const entry = newMasterEntry(text, cardId);
  return {
    entry,
    sections: sections.map((s) =>
      s.id === sectionId ? { ...s, entries: [...s.entries, entry] } : s
    ),
  };
}

export function removeSections(
  sections: MasterSection[],
  sectionIds: Iterable<string>
): MasterSection[] {
  const drop = new Set(sectionIds);
  return sections.filter((s) => !drop.has(s.id));
}

export interface OrphanCard {
  cardId: string;
  text: string;
  tags?: string[];
}

export const UNTAGGED_SECTION = "Untagged";

/**
 * One entry per orphan card. With `groupByTags` each card goes to a section named after its
 * first tag (an existing section with that title, any case, is reused; untagged cards go to
 * "Untagged"); without it they all go to `fallbackTitle`. Cards already linked are skipped.
 */
export function addOrphanEntries(
  sections: MasterSection[],
  orphans: OrphanCard[],
  opts: { groupByTags?: boolean; fallbackTitle?: string } = {}
): { sections: MasterSection[]; added: number } {
  const linked = new Set(
    sections.flatMap((s) => s.entries.flatMap((e) => e.cardId ?? []))
  );
  const fallback = opts.fallbackTitle || "Cards";
  const sectionOf = (o: OrphanCard) =>
    opts.groupByTags ? (o.tags?.[0] ?? UNTAGGED_SECTION) : fallback;

  const next = sections.map((s) => ({ ...s }));
  const byTitle = new Map(
    next.map((s) => [s.title.trim().toLowerCase(), s] as const)
  );
  const touched = new Set<MasterSection>();
  let added = 0;
  for (const o of orphans) {
    if (linked.has(o.cardId)) continue;
    linked.add(o.cardId);
    const title = sectionOf(o);
    const key = title.trim().toLowerCase();
    let sec = byTitle.get(key);
    if (!sec) {
      sec = newMasterSection(title, []);
      byTitle.set(key, sec);
      next.push(sec);
    }
    if (!touched.has(sec)) {
      sec.entries = [...sec.entries];
      touched.add(sec);
    }
    sec.entries.push(newMasterEntry(o.text, o.cardId));
    added++;
  }
  // Sections we did not touch keep their original object.
  const result = next.map((s, i) =>
    i < sections.length && !touched.has(s) ? sections[i] : s
  );
  return { sections: result, added };
}

export interface LinkChoice {
  id: string;
  text: string;
  /** True when no entry of the master links to it yet. */
  orphan: boolean;
}

/** Orphans first, then by text. Does not mutate. */
export function orphansFirst<T extends { orphan: boolean; text: string }>(
  choices: T[]
): T[] {
  return [...choices].sort(
    (a, b) =>
      Number(b.orphan) - Number(a.orphan) || a.text.localeCompare(b.text)
  );
}

/** Best matching cards for an entry text: similarity, with orphans winning ties and a small edge. */
export function suggestCards(
  text: string,
  choices: LinkChoice[],
  limit = 5,
  minSimilarity = 0.2
): (LinkChoice & { score: number })[] {
  if (!text.trim()) return [];
  return choices
    .map((c) => ({
      ...c,
      score: textSimilarity(text, c.text) + (c.orphan ? 0.05 : 0),
    }))
    .filter((c) => c.score >= minSimilarity)
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
    .slice(0, limit);
}

/** One suggestion per unlinked entry with text; a card is suggested to one entry only. */
export function suggestLinks(
  sections: MasterSection[],
  choices: LinkChoice[],
  minSimilarity = 0.4
): { entryId: string; cardId: string; score: number }[] {
  const taken = new Set<string>();
  const pairs: { entryId: string; cardId: string; score: number }[] = [];
  for (const s of sections)
    for (const e of s.entries) {
      if (e.cardId || !e.text.trim()) continue;
      pairs.push(
        ...suggestCards(e.text, choices, 3, minSimilarity).map((c) => ({
          entryId: e.id,
          cardId: c.id,
          score: c.score,
        }))
      );
    }
  pairs.sort((a, b) => b.score - a.score);
  const doneEntry = new Set<string>();
  const out: typeof pairs = [];
  for (const p of pairs) {
    if (doneEntry.has(p.entryId) || taken.has(p.cardId)) continue;
    doneEntry.add(p.entryId);
    taken.add(p.cardId);
    out.push(p);
  }
  return out;
}

export function linkEntries(
  sections: MasterSection[],
  pairs: { entryId: string; cardId: string }[]
): MasterSection[] {
  const byEntry = new Map(pairs.map((p) => [p.entryId, p.cardId]));
  if (byEntry.size === 0) return sections;
  return sections.map((s) =>
    s.entries.some((e) => byEntry.has(e.id))
      ? {
          ...s,
          entries: s.entries.map((e) =>
            byEntry.has(e.id) ? { ...e, cardId: byEntry.get(e.id) } : e
          ),
        }
      : s
  );
}

/** Dangling entries lose their card; an entry left with no text is removed. */
export function fixDangling(
  sections: MasterSection[],
  report: Pick<CoverageReport, "danglingEntries">
): MasterSection[] {
  const ids = new Set(report.danglingEntries.map((d) => d.entryId));
  return sections.map((s) =>
    s.entries.some((e) => ids.has(e.id))
      ? {
          ...s,
          entries: s.entries.flatMap((e) => {
            if (!ids.has(e.id)) return [e];
            const { cardId: _drop, ...rest } = e;
            return rest.text.trim() ? [rest] : [];
          }),
        }
      : s
  );
}

/** For each group of entries on one card, keeps the first and removes the rest. */
export function fixSameCardDuplicates(
  sections: MasterSection[],
  report: Pick<CoverageReport["duplicates"], "sameCard">
): MasterSection[] {
  return removeEntries(
    sections,
    report.sameCard.flatMap((g) => g.entries.slice(1).map((r) => r.entryId))
  );
}

/** For each group of near-identical entries, keeps the first and removes the rest. */
export function fixSimilarDuplicates(
  sections: MasterSection[],
  report: Pick<CoverageReport["duplicates"], "similarText">
): MasterSection[] {
  return removeEntries(
    sections,
    report.similarText.flatMap((g) => g.entries.slice(1).map((r) => r.entryId))
  );
}

/** A section name that a user sees for a coverage item: first non-empty line of the entry. */
export function entryLabel(e: MasterEntry | undefined, fallback = ""): string {
  return e?.text.trim() || fallback;
}
