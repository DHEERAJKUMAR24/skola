// Coverage engine for master cards (ADR 0014). Pure: no Dexie, no React, no Node APIs, so the
// app and the MCP server give the same answer. Feed it a master's sections and the deck's cards.
import { State } from "ts-fsrs";
import type { MasterSection } from "./masterModel";

const DAY_MS = 86_400_000;

/** What the engine needs to know about a card. Map a Dexie card to it with `toCoverageCard`. */
export interface CoverageCard {
  id: string;
  /** FSRS state; `New` means never reviewed. */
  state?: State;
  due?: Date | number;
  lastReview?: Date | number | null;
  reps?: number;
  suspended?: boolean;
  /** A tombstoned or deleted card counts as missing. */
  deleted?: boolean;
}

export interface CoverageOptions {
  now?: Date | number;
  /** An entry is stale when its card is overdue by more than this many days. Default 30. */
  overdueDays?: number;
  /** Cards that are in the deck but never need an entry (the master cards' own cards). */
  ignoreCardIds?: Iterable<string>;
  /** Cards that exist outside this deck. Linking to them is allowed, so they are not dangling. */
  externalCardIds?: Iterable<string>;
  /** Word overlap (0 to 1) from which two entries count as near-identical. Default 0.8. */
  similarity?: number;
}

export interface EntryRef {
  sectionId: string;
  entryId: string;
}

export type StaleReason = "suspended" | "never_reviewed" | "overdue";

export interface CoverageReport {
  /** Deck cards that are in no entry. */
  orphanCards: string[];
  /** Entries whose card is gone, deleted or unknown. */
  danglingEntries: (EntryRef & { cardId: string })[];
  /** Sections with no usable entry. */
  emptySections: string[];
  /** Entries with text but no card yet. */
  unlinkedEntries: EntryRef[];
  /** Entries whose card needs attention. */
  staleEntries: (EntryRef & { cardId: string; reasons: StaleReason[] })[];
  duplicates: {
    /** One card used by several entries. */
    sameCard: { cardId: string; entries: EntryRef[] }[];
    /** Entries with the same or almost the same text, on different cards or none. */
    similarText: { entries: EntryRef[]; similarity: number }[];
  };
  stats: {
    entries: number;
    linked: number;
    deckCards: number;
    /** Deck cards (not ignored) that appear in at least one entry. */
    coveredCards: number;
    /** coveredCards / eligible deck cards, 1 when the deck has no eligible cards. */
    coverage: number;
  };
  /** Nothing missing: no orphans, no dangling, no empty sections, no unlinked entries. */
  complete: boolean;
}

const ms = (d: Date | number | null | undefined): number | undefined =>
  d === null || d === undefined
    ? undefined
    : typeof d === "number"
      ? d
      : d.getTime();

/** Lowercase words without markup or punctuation, for comparing entries. */
export function entryWords(text: string): string[] {
  return text
    .replace(/<[^>]*>/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** 0 to 1: shared words over all words, ignoring order and repeats. */
export function textSimilarity(a: string, b: string): number {
  const A = new Set(entryWords(a));
  const B = new Set(entryWords(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

/** Why a card is stale for study, empty when it is fine. */
export function staleReasons(
  card: CoverageCard,
  now: number,
  overdueDays: number
): StaleReason[] {
  const out: StaleReason[] = [];
  if (card.suspended) out.push("suspended");
  const never =
    card.state === State.New ||
    (card.state === undefined &&
      !card.reps &&
      ms(card.lastReview) === undefined);
  if (never) out.push("never_reviewed");
  else {
    const due = ms(card.due);
    if (due !== undefined && now - due > overdueDays * DAY_MS)
      out.push("overdue");
  }
  return out;
}

export function analyzeCoverage(
  sections: MasterSection[],
  deckCards: CoverageCard[],
  opts: CoverageOptions = {}
): CoverageReport {
  const now = ms(opts.now) ?? Date.now();
  const overdueDays = opts.overdueDays ?? 30;
  const similarity = opts.similarity ?? 0.8;
  const ignore = new Set(opts.ignoreCardIds ?? []);
  const external = new Set(opts.externalCardIds ?? []);

  const live = new Map<string, CoverageCard>();
  for (const c of deckCards) if (!c.deleted) live.set(c.id, c);

  const linkedIds = new Set<string>();
  const usage = new Map<string, EntryRef[]>();
  const dangling: CoverageReport["danglingEntries"] = [];
  const unlinked: EntryRef[] = [];
  const stale: CoverageReport["staleEntries"] = [];
  const emptySections: string[] = [];
  const texts: { ref: EntryRef; text: string; cardId?: string }[] = [];
  let entries = 0;
  let linked = 0;

  for (const s of sections) {
    const usable = s.entries.filter((e) => e.text.trim() || e.cardId);
    if (usable.length === 0) emptySections.push(s.id);
    for (const e of usable) {
      entries++;
      const ref: EntryRef = { sectionId: s.id, entryId: e.id };
      if (e.text.trim()) texts.push({ ref, text: e.text, cardId: e.cardId });
      if (!e.cardId) {
        unlinked.push(ref);
        continue;
      }
      linked++;
      usage.set(e.cardId, [...(usage.get(e.cardId) ?? []), ref]);
      const card = live.get(e.cardId);
      if (!card) {
        if (!external.has(e.cardId))
          dangling.push({ ...ref, cardId: e.cardId });
        continue;
      }
      linkedIds.add(e.cardId);
      const reasons = staleReasons(card, now, overdueDays);
      if (reasons.length) stale.push({ ...ref, cardId: e.cardId, reasons });
    }
  }

  const eligible = [...live.keys()].filter((id) => !ignore.has(id));
  const orphanCards = eligible.filter((id) => !linkedIds.has(id));
  const coveredCards = eligible.length - orphanCards.length;

  const sameCard = [...usage.entries()]
    .filter(([, refs]) => refs.length > 1)
    .map(([cardId, refs]) => ({ cardId, entries: refs }));

  // Near-identical text: union entries whose similarity passes the bar, skipping pairs that are
  // already reported as the same card.
  const parent = texts.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const best = new Map<number, number>();
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      if (texts[i].cardId && texts[i].cardId === texts[j].cardId) continue;
      const sim = textSimilarity(texts[i].text, texts[j].text);
      if (sim < similarity) continue;
      parent[find(i)] = find(j);
      best.set(i, Math.max(best.get(i) ?? 0, sim));
      best.set(j, Math.max(best.get(j) ?? 0, sim));
    }
  const groups = new Map<number, number[]>();
  texts.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const similarText = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      entries: g.map((i) => texts[i].ref),
      similarity: Math.min(...g.map((i) => best.get(i) ?? 1)),
    }));

  return {
    orphanCards,
    danglingEntries: dangling,
    emptySections,
    unlinkedEntries: unlinked,
    staleEntries: stale,
    duplicates: { sameCard, similarText },
    stats: {
      entries,
      linked,
      deckCards: live.size,
      coveredCards,
      coverage: eligible.length === 0 ? 1 : coveredCards / eligible.length,
    },
    complete:
      orphanCards.length === 0 &&
      dangling.length === 0 &&
      emptySections.length === 0 &&
      unlinked.length === 0,
  };
}

/** One line per problem class, for the UI and for assistants. Empty when all is well. */
export function describeCoverage(r: CoverageReport): string[] {
  const out: string[] = [];
  const n = (x: number, one: string, many: string) => {
    if (x) out.push(`${x} ${x === 1 ? one : many}`);
  };
  n(r.orphanCards.length, "card is in no entry", "cards are in no entry");
  n(
    r.danglingEntries.length,
    "entry points at a missing card",
    "entries point at missing cards"
  );
  n(r.emptySections.length, "empty section", "empty sections");
  n(r.unlinkedEntries.length, "entry has no card", "entries have no card");
  n(
    r.staleEntries.length,
    "entry needs attention (suspended, never reviewed or long overdue)",
    "entries need attention (suspended, never reviewed or long overdue)"
  );
  n(
    r.duplicates.sameCard.length + r.duplicates.similarText.length,
    "group of duplicate entries",
    "groups of duplicate entries"
  );
  return out;
}
