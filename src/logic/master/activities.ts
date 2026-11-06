// Pure logic of the master-specific study activities (ADR 0014): recall sweep, gap hunt and
// weak-spot drill. No Dexie, no React. The activities never change FSRS state themselves.
import { Rating, State } from "ts-fsrs";
import { type CoverageReport, entryWords, textSimilarity } from "./coverage";
import type { MasterEntry } from "./masterModel";
import {
  type LinkedCardState,
  type SuggestedGrade,
  type SuggestedRating,
  cardRecall,
} from "./suggestRating";

// ---------------------------------------------------------------------------------------------
// Recall sweep: type what you remember, reveal, mark each entry found or missed.

/** Splits what the user typed into items: one per line or comma/semicolon, markers removed. */
export function parseRecallInput(text: string): string[] {
  return text
    .split(/\r?\n|[;,]/)
    .map((l) => l.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

export interface SweepMatch {
  entryId: string;
  /** The typed item that matched, if any. */
  typed?: string;
  similarity: number;
}

/**
 * Suggests which entries the typed items hit. Each typed item matches at most one entry (its
 * best), each entry at most one item. An item hits when its word overlap with the entry reaches
 * `minSimilarity`, or when it holds all words of a short entry. The user still marks every
 * entry by hand: this only pre-fills the reveal step.
 */
export function matchRecall(
  entries: Pick<MasterEntry, "id" | "text">[],
  typed: string[],
  minSimilarity = 0.5
): SweepMatch[] {
  const pairs: { e: number; t: number; sim: number }[] = [];
  entries.forEach((e, ei) => {
    const ew = new Set(entryWords(e.text));
    typed.forEach((t, ti) => {
      let sim = textSimilarity(e.text, t);
      const tw = entryWords(t);
      // "closures" for "Closures and scope" is not enough, but all words of a short entry are.
      if (
        ew.size > 0 &&
        ew.size <= 3 &&
        tw.length > 0 &&
        [...ew].every((w) => tw.includes(w))
      )
        sim = Math.max(sim, 1);
      if (sim >= minSimilarity) pairs.push({ e: ei, t: ti, sim });
    });
  });
  pairs.sort((a, b) => b.sim - a.sim);
  const usedE = new Set<number>();
  const usedT = new Set<number>();
  const hit = new Map<number, { t: number; sim: number }>();
  for (const p of pairs) {
    if (usedE.has(p.e) || usedT.has(p.t)) continue;
    usedE.add(p.e);
    usedT.add(p.t);
    hit.set(p.e, { t: p.t, sim: p.sim });
  }
  return entries.map((e, ei) => {
    const h = hit.get(ei);
    return h
      ? { entryId: e.id, typed: typed[h.t], similarity: h.sim }
      : { entryId: e.id, similarity: 0 };
  });
}

export type SweepMark = "found" | "missed";

export interface SweepSummary {
  total: number;
  found: number;
  missed: number;
  unmarked: number;
  /** found / total, 0 when empty. */
  recall: number;
  missedEntryIds: string[];
}

export function summarizeSweep(
  entryIds: string[],
  marks: Record<string, SweepMark | undefined>
): SweepSummary {
  let found = 0;
  let missed = 0;
  const missedEntryIds: string[] = [];
  for (const id of entryIds) {
    if (marks[id] === "found") found++;
    else if (marks[id] === "missed") {
      missed++;
      missedEntryIds.push(id);
    }
  }
  const total = entryIds.length;
  return {
    total,
    found,
    missed,
    unmarked: total - found - missed,
    recall: total === 0 ? 0 : found / total,
    missedEntryIds,
  };
}

export interface SweepRating {
  rating: SuggestedGrade;
  label: "Again" | "Hard" | "Good" | "Easy";
  score: number;
  reasons: string[];
}

const LABELS = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" } as const;
const SWEEP_WEIGHT = 0.6;

function gradeOf(score: number): SuggestedGrade {
  if (score < 0.5) return Rating.Again;
  if (score < 0.8) return Rating.Hard;
  if (score < 0.93) return Rating.Good;
  return Rating.Easy;
}

/**
 * Feeds a finished sweep into the suggested rating. The sweep is fresh evidence, so it weighs
 * 60% against 40% for the forgetting-curve score of the linked cards. Unmarked entries count as
 * missed (you did not show you know them). Easy needs every entry found. Advice only: nothing
 * about any card changes.
 */
export function combineSweepWithSuggestion(
  sweep: SweepSummary,
  fsrs: Pick<SuggestedRating, "score"> | null
): SweepRating {
  const sweepScore = sweep.recall;
  const score = fsrs
    ? SWEEP_WEIGHT * sweepScore + (1 - SWEEP_WEIGHT) * fsrs.score
    : sweepScore;
  let rating = gradeOf(score);
  if (rating === Rating.Easy && sweep.found < sweep.total) rating = Rating.Good;
  if (sweep.total === 0) rating = Rating.Again;
  const reasons = [
    `You recalled ${sweep.found} of ${sweep.total} entries (${Math.round(sweepScore * 100)}%).`,
  ];
  if (sweep.unmarked)
    reasons.push(`${sweep.unmarked} not marked (counted as missed).`);
  if (fsrs)
    reasons.push(
      `Linked cards expect about ${Math.round(fsrs.score * 100)}% recall, weighed 40%.`
    );
  return { rating, label: LABELS[rating], score, reasons };
}

// ---------------------------------------------------------------------------------------------
// Gap hunt: the coverage report as a checklist.

export type GapKind =
  | "orphan"
  | "dangling"
  | "empty"
  | "unlinked"
  | "stale"
  | "duplicateCard"
  | "duplicateText";

export interface GapItem {
  /** Stable across re-analysis, so checked state survives edits. */
  id: string;
  kind: GapKind;
  title: string;
  detail?: string;
  cardId?: string;
  entryIds: string[];
  sectionId?: string;
}

export interface GapLabels {
  card: (cardId: string) => string;
  entry: (entryId: string) => string;
  section: (sectionId: string) => string;
}

const STALE_TEXT = {
  suspended: "suspended",
  never_reviewed: "never reviewed",
  overdue: "long overdue",
} as const;

/** Turns a coverage report into one checklist item per problem, most serious first. */
export function buildGapChecklist(
  r: CoverageReport,
  labels: GapLabels
): GapItem[] {
  const items: GapItem[] = [];
  for (const id of r.orphanCards)
    items.push({
      id: `orphan:${id}`,
      kind: "orphan",
      title: `Not in any entry: ${labels.card(id)}`,
      cardId: id,
      entryIds: [],
    });
  for (const d of r.danglingEntries)
    items.push({
      id: `dangling:${d.entryId}`,
      kind: "dangling",
      title: `Points at a missing card: ${labels.entry(d.entryId)}`,
      detail: `In ${labels.section(d.sectionId)}`,
      cardId: d.cardId,
      entryIds: [d.entryId],
      sectionId: d.sectionId,
    });
  for (const id of r.emptySections)
    items.push({
      id: `empty:${id}`,
      kind: "empty",
      title: `Empty section: ${labels.section(id)}`,
      entryIds: [],
      sectionId: id,
    });
  for (const u of r.unlinkedEntries)
    items.push({
      id: `unlinked:${u.entryId}`,
      kind: "unlinked",
      title: `No card yet: ${labels.entry(u.entryId)}`,
      detail: `In ${labels.section(u.sectionId)}`,
      entryIds: [u.entryId],
      sectionId: u.sectionId,
    });
  for (const s of r.staleEntries)
    items.push({
      id: `stale:${s.entryId}`,
      kind: "stale",
      title: `Needs attention: ${labels.entry(s.entryId)}`,
      detail: s.reasons.map((x) => STALE_TEXT[x]).join(", "),
      cardId: s.cardId,
      entryIds: [s.entryId],
      sectionId: s.sectionId,
    });
  for (const g of r.duplicates.sameCard)
    items.push({
      id: `dupcard:${g.cardId}`,
      kind: "duplicateCard",
      title: `Same card used ${g.entries.length} times: ${labels.card(g.cardId)}`,
      cardId: g.cardId,
      entryIds: g.entries.map((e) => e.entryId),
    });
  for (const g of r.duplicates.similarText)
    items.push({
      id: `duptext:${g.entries
        .map((e) => e.entryId)
        .sort()
        .join("+")}`,
      kind: "duplicateText",
      title: `Near-identical: ${g.entries.map((e) => labels.entry(e.entryId)).join(" / ")}`,
      detail: `${Math.round(g.similarity * 100)}% the same words`,
      entryIds: g.entries.map((e) => e.entryId),
    });
  return items;
}

// ---------------------------------------------------------------------------------------------
// Weak-spot drill: which linked cards to study.

export interface WeakCandidate {
  cardId: string;
  state: LinkedCardState;
}

export interface WeakSpot {
  cardId: string;
  recall: number;
  reason: "lapsed" | "weak" | "overdue" | "new";
}

/**
 * The master's weakest linked cards, weakest first: forgotten before and still weak, low recall,
 * overdue, or never reviewed (those last). Suspended cards and repeats are skipped. Cards with
 * recall of `maxRecall` or more are left out.
 */
export function pickWeakSpots(
  cards: WeakCandidate[],
  now: number = Date.now(),
  opts: { limit?: number; maxRecall?: number } = {}
): WeakSpot[] {
  const limit = opts.limit ?? 25;
  const maxRecall = opts.maxRecall ?? 0.85;
  const seen = new Set<string>();
  const out: (WeakSpot & { lapses: number; rank: number })[] = [];
  for (const { cardId, state } of cards) {
    if (seen.has(cardId) || state.suspended) continue;
    seen.add(cardId);
    const recall = cardRecall(state, now);
    const isNew = state.state === State.New;
    if (!isNew && recall >= maxRecall) continue;
    const due = state.due instanceof Date ? state.due.getTime() : state.due;
    const reason: WeakSpot["reason"] = isNew
      ? "new"
      : (state.lapses ?? 0) > 0 && recall < 0.7
        ? "lapsed"
        : due !== undefined && due < now
          ? "overdue"
          : "weak";
    out.push({
      cardId,
      recall,
      reason,
      lapses: state.lapses ?? 0,
      // Reviewed weak cards first (lowest recall), never-reviewed ones after them.
      rank: isNew ? 2 : 0,
    });
  }
  out.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.recall - b.recall ||
      b.lapses - a.lapses ||
      a.cardId.localeCompare(b.cardId)
  );
  return out.slice(0, limit).map(({ cardId, recall, reason }) => ({
    cardId,
    recall,
    reason,
  }));
}

/** The study route params for a weak-spot drill of a master note (see LearnView). */
export const WEAK_PREFIX = "weak.";
export const weakDrillParam = (noteId: string) => `${WEAK_PREFIX}${noteId}`;
export function parseWeakDrillParam(p: string | undefined): string | null {
  return p?.startsWith(WEAK_PREFIX)
    ? p.slice(WEAK_PREFIX.length) || null
    : null;
}
