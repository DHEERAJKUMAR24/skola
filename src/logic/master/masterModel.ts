// Pure model of a master card (ADR 0014): sections of entries, each entry text plus an optional
// card id. No Dexie, no React, so the server (MCP) can reuse it. The note type that stores this
// lives in src/logic/type-implementations/master/.
import { v4 as uuidv4 } from "uuid";

export interface MasterEntry {
  id: string;
  /** The concept or fact, short. */
  text: string;
  /** The card that tests it. Any card of any deck may be linked. Absent = not linked yet. */
  cardId?: string;
}

export interface MasterSection {
  id: string;
  title: string;
  entries: MasterEntry[];
}

/** Where a master is in its life; shown in the builder and on the deck page. */
export type MasterStatus = "draft" | "active" | "archived";
export const MASTER_STATUSES: MasterStatus[] = ["draft", "active", "archived"];

export interface MasterNoteContent {
  /** Plain-text name of the master card, e.g. "Chapter 3: Closures". */
  title: string;
  sections: MasterSection[];
  /** Absent means "active". */
  status?: MasterStatus;
}

/** Above this many entries in total a master card gets one study card per top-level section. */
export const MASTER_SPLIT_THRESHOLD = 12;

export const MASTER_MAX_SECTIONS = 60;
export const MASTER_MAX_ENTRIES = 500;

export function newMasterId(): string {
  return uuidv4();
}

export function newMasterEntry(text = "", cardId?: string): MasterEntry {
  return { id: newMasterId(), text, ...(cardId ? { cardId } : {}) };
}

export function newMasterSection(
  title = "",
  entries: MasterEntry[] = []
): MasterSection {
  return { id: newMasterId(), title, entries };
}

export function countEntries(sections: MasterSection[]): number {
  return sections.reduce((n, s) => n + s.entries.length, 0);
}

/** An entry with no text and no card is a leftover of editing. */
export function isBlankEntry(e: MasterEntry): boolean {
  return !e.text.trim() && !e.cardId;
}

/** All linked card ids, in order, with repeats. */
export function linkedCardIds(sections: MasterSection[]): string[] {
  return sections.flatMap((s) =>
    s.entries.flatMap((e) => (e.cardId ? [e.cardId] : []))
  );
}

/**
 * Trims text, drops blank entries, keeps sections (even empty ones: the coverage engine reports
 * them) and names untitled sections. Used before every save, so a half-typed note never stores
 * junk. Ids are kept, so section cards keep their schedule.
 */
export function cleanMaster(c: MasterNoteContent): MasterNoteContent {
  return {
    title: (c.title ?? "").trim(),
    ...(c.status && MASTER_STATUSES.includes(c.status) && c.status !== "active"
      ? { status: c.status }
      : {}),
    sections: (c.sections ?? []).map((s, i) => ({
      id: s.id || newMasterId(),
      title: (s.title ?? "").trim() || `Section ${i + 1}`,
      entries: (s.entries ?? [])
        .map((e) => ({
          id: e.id || newMasterId(),
          text: (e.text ?? "").trim(),
          ...(e.cardId ? { cardId: e.cardId } : {}),
        }))
        .filter((e) => !isBlankEntry(e)),
    })),
  };
}

export function validateMaster(c: MasterNoteContent): string | null {
  if (!c.title.trim()) return "Give the master card a name.";
  if (c.sections.length === 0) return "Add at least one section.";
  if (c.sections.length > MASTER_MAX_SECTIONS)
    return `At most ${MASTER_MAX_SECTIONS} sections.`;
  const n = countEntries(c.sections);
  if (n === 0) return "Add at least one entry.";
  if (n > MASTER_MAX_ENTRIES) return `At most ${MASTER_MAX_ENTRIES} entries.`;
  return null;
}

/**
 * Which study cards a master card has. `null` is the one card for the whole master; a string is
 * the id of a top-level section that gets its own card. More than MASTER_SPLIT_THRESHOLD entries
 * and at least two sections: one card per section. Otherwise one card.
 */
export type MasterCardKey = string | null;

export function planMasterCards(sections: MasterSection[]): MasterCardKey[] {
  if (sections.length >= 2 && countEntries(sections) > MASTER_SPLIT_THRESHOLD)
    return sections.map((s) => s.id);
  return [null];
}

/** The sections a card with this key shows (all of them for the whole-master card). */
export function sectionsForCard(
  sections: MasterSection[],
  key: MasterCardKey | undefined
): MasterSection[] {
  if (key === null || key === undefined) return sections;
  const hit = sections.filter((s) => s.id === key);
  // A card whose section was deleted still shows something useful: the whole master.
  return hit.length ? hit : sections;
}

// ">>>", "-", "*", bullet or "1." / "1)" at the start of a line.
const MARKER = /^\s*(?:>{2,}|[-*•–]|\d+[.)])\s*/;
const CARD_TAG = /\s*\{\{card:([^}\s]+)\}\}\s*$/;
const SECTION_LINE = /^\s*#{1,6}\s+(.*)$/;

/**
 * The compact hand-written form of a master card:
 *
 *     # Section title
 *     - entry text
 *     - entry text {{card:<card id>}}
 *
 * Lines before the first `#` go in a section called "General". Blank lines are ignored.
 * Pass `previous` to keep ids: a section keeps its id when a section with the same title existed,
 * an entry when an entry with the same card id (else the same text) existed. That keeps study
 * cards and their schedule stable when the text is edited.
 */
export function parseMasterText(
  text: string,
  previous: MasterSection[] = []
): MasterSection[] {
  const prevSections = [...previous];
  const prevEntries = previous.flatMap((s) => s.entries);
  const usedEntry = new Set<string>();
  const sections: MasterSection[] = [];

  const takeSection = (title: string): string => {
    const i = prevSections.findIndex(
      (s) => s.title.trim().toLowerCase() === title.trim().toLowerCase()
    );
    if (i < 0) return newMasterId();
    return prevSections.splice(i, 1)[0].id;
  };
  const takeEntry = (t: string, cardId?: string): string => {
    const hit = prevEntries.find(
      (e) =>
        !usedEntry.has(e.id) &&
        (cardId ? e.cardId === cardId : !e.cardId && e.text === t)
    );
    if (!hit) return newMasterId();
    usedEntry.add(hit.id);
    return hit.id;
  };

  let current: MasterSection | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const head = SECTION_LINE.exec(raw);
    if (head) {
      const title = head[1].trim();
      current = { id: takeSection(title), title, entries: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { id: takeSection("General"), title: "General", entries: [] };
      sections.push(current);
    }
    let line = raw.replace(MARKER, "").trim();
    let cardId: string | undefined;
    const tag = CARD_TAG.exec(line);
    if (tag) {
      cardId = tag[1];
      line = line.slice(0, tag.index).trim();
    }
    if (!line && !cardId) continue;
    current.entries.push({
      id: takeEntry(line, cardId),
      text: line,
      ...(cardId ? { cardId } : {}),
    });
  }
  return sections;
}

/** Inverse of parseMasterText. */
export function masterToText(sections: MasterSection[]): string {
  return sections
    .map((s) =>
      [
        `# ${s.title}`,
        ...s.entries.map(
          (e) => `- ${e.text}${e.cardId ? ` {{card:${e.cardId}}}` : ""}`
        ),
      ].join("\n")
    )
    .join("\n\n");
}

/** A plain-text name for the sort field and notes explorer. */
export function masterSortField(c: Pick<MasterNoteContent, "title">): string {
  return (c.title || "Master card").replace(/<[^>]*>/g, "").slice(0, 100);
}
