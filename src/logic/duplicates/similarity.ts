/**
 * Semantic-ish duplicate detection with no embeddings and no network: normalised stems, token-set
 * Jaccard plus character trigram Dice, computed on the question side and the answer side
 * separately. Pure; the server tool `find_similar_cards` feeds it.
 *
 * Score guide (0 to 1, the geometric mean of the question and answer similarity):
 *   >= 0.90  same card with trivial wording changes (safe to delete one after a look)
 *   0.75-0.9 same fact asked again with other words (default threshold is 0.72)
 *   0.55-0.7 related cards; often one fact split or merged, review before acting
 *   < 0.5    mostly noise; not offered (the minimum threshold is 0.5)
 * The geometric mean means "same question, different answer" scores low on purpose: that is a
 * possible conflict, not a duplicate.
 */

export const DEFAULT_THRESHOLD = 0.72;
export const MIN_THRESHOLD = 0.5;

export interface Sides {
  question: string;
  answer: string;
  /** Reverse cards ask both ways, so their sides may be compared swapped. */
  symmetric?: boolean;
}

export interface DupItem {
  id: string;
  sides: Sides;
  /** How much review history the note has (reps); more history is kept first. */
  weight?: number;
  /** Creation time in ms; older is kept first on a tie. */
  created?: number;
}

const STOP = new Set(
  "a an the of to in on at for and or is are was were be been it its this that these those with as by from what which who whom how why when where does do did can could should would will not no into than then so such there their they them you your we our i me my he she his her".split(
    " "
  )
);

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
  "&quot;": '"',
  "&#39;": "'",
};

/** HTML to plain text: block ends become spaces, tags go, common entities decode. */
export function plain(html: string): string {
  return html
    .replace(/<\/(p|div|li)>|<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|nbsp|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips common English endings. Crude on purpose: both sides of a pair get the same treatment. */
export function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.endsWith("ies")) s = `${s.slice(0, -3)}y`;
  else if (s.length > 4 && /(ss|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !/(ss|us|is)$/.test(s))
    s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  if (s.length > 5 && s.endsWith("ly")) s = s.slice(0, -2);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  // "running" -> "runn" -> "run"
  if (s.length > 3 && /([^aeiou])\1$/.test(s) && !/(ss|ll)$/.test(s))
    s = s.slice(0, -1);
  return s;
}

/** Lowercase, no accents, stop words removed, stemmed. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  const words = plain(text)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  for (const w of words ?? []) {
    if (STOP.has(w)) continue;
    if (w.length < 2 && !/\d/.test(w)) continue;
    out.push(stem(w));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

export function trigrams(s: string): Map<string, number> {
  const t = ` ${s} `;
  const out = new Map<string, number>();
  for (let i = 0; i + 3 <= t.length; i++) {
    const g = t.slice(i, i + 3);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient over character trigram multisets. */
export function dice(a: Map<string, number>, b: Map<string, number>): number {
  let na = 0;
  let nb = 0;
  let both = 0;
  for (const v of a.values()) na += v;
  for (const v of b.values()) nb += v;
  if (!na || !nb) return 0;
  for (const [g, v] of a) both += Math.min(v, b.get(g) ?? 0);
  return (2 * both) / (na + nb);
}

/** Pre-computed features of one side of a card. */
export interface SideFeatures {
  toks: string[];
  set: Set<string>;
  grams: Map<string, number>;
}

export function sideFeatures(text: string): SideFeatures {
  const toks = tokens(text);
  return { toks, set: new Set(toks), grams: trigrams(toks.join(" ")) };
}

/** Similarity of two sides, 0 to 1: token Jaccard and trigram Dice, weighted. */
export function sideScore(a: SideFeatures, b: SideFeatures): number {
  if (!a.set.size || !b.set.size) return 0;
  return 0.55 * jaccard(a.set, b.set) + 0.45 * dice(a.grams, b.grams);
}

export interface Features {
  q: SideFeatures;
  a: SideFeatures;
  symmetric: boolean;
}

export function featuresOf(s: Sides): Features {
  return {
    q: sideFeatures(s.question),
    a: sideFeatures(s.answer),
    symmetric: !!s.symmetric,
  };
}

function oneWay(x: Features, y: Features, swap: boolean): number {
  const xq = swap ? x.a : x.q;
  const xa = swap ? x.q : x.a;
  const q = sideScore(xq, y.q);
  // A card without an answer side (a picture) is judged on its question alone.
  if (!xa.set.size && !y.a.set.size) return q;
  if (!xa.set.size || !y.a.set.size) return 0;
  return Math.sqrt(q * sideScore(xa, y.a));
}

/** Question and answer sides are scored separately and combined as a geometric mean. */
export function pairScore(x: Features, y: Features): number {
  const direct = oneWay(x, y, false);
  return x.symmetric || y.symmetric
    ? Math.max(direct, oneWay(x, y, true))
    : direct;
}

// ---- reading sides from note content ---------------------------------------------------------

const CLOZE = /\{\{c\d+::((?!\{\{|}}).*?)(?:::[^}]*)?\}\}/g;

/** Question and answer text of a note, by the type of its content. Null for types with no text. */
export function sidesOfContent(c: Record<string, any>): Sides | null {
  switch (c.type) {
    case "normal":
      return { question: plain(c.front ?? ""), answer: plain(c.back ?? "") };
    case "doubleSided":
      return {
        question: plain(c.field1 ?? ""),
        answer: plain(c.field2 ?? ""),
        symmetric: true,
      };
    case "cloze": {
      const raw = String(c.text ?? "");
      const hidden = [...raw.matchAll(CLOZE)].map((m) => plain(m[1]));
      return {
        question: plain(raw.replace(CLOZE, " ").replace(/\{\{|}}/g, "")),
        answer: hidden.join(" "),
      };
    }
    case "multipleChoice": {
      const choices = Array.isArray(c.choices) ? c.choices : [];
      return {
        question: plain(c.question ?? ""),
        answer: choices
          .filter((x: any) => x?.correct)
          .map((x: any) => String(x.text ?? ""))
          .join(" "),
      };
    }
    case "list":
      return {
        question: plain(c.front ?? ""),
        answer: (Array.isArray(c.items) ? c.items : []).map(String).join(" "),
      };
    case "imageOcclusion":
      return c.header ? { question: String(c.header), answer: "" } : null;
    case "master":
      // A master only restates other cards; comparing it with them would flag every one of them.
      return null;
    default:
      return null;
  }
}

// ---- grouping --------------------------------------------------------------------------------

export interface DupGroup {
  /** Mean of the pair scores inside the group. */
  score: number;
  /** Lowest linked pair score; far below `score` means a chain, look closer. */
  min_score: number;
  /** Ids ordered with the suggested keeper first. */
  ids: string[];
  keep: string;
  /** Answer terms a non-kept member has that the kept one lacks; fold these in before deleting. */
  missing_from_keep: string[];
  /** `delete_duplicates` when no other member adds anything, otherwise `merge_then_delete`. */
  suggestion: "delete_duplicates" | "merge_then_delete";
}

export interface FindOptions {
  threshold?: number;
  /** Wall-clock budget in ms; the search stops and says `truncated`. */
  budgetMs?: number;
  /** Items beyond this are not searched. */
  maxItems?: number;
  now?: () => number;
}

export interface FindResult {
  groups: DupGroup[];
  truncated: boolean;
  /** Why it was cut short, if it was. */
  reason?: "time" | "items";
  items_searched: number;
  pairs_compared: number;
}

export const MAX_ITEMS = 5000;
export const BUDGET_MS = 4000;
/** A token in more notes than this is too common to pair on (unless a note has nothing else). */
const POSTING_CAP = 200;

/** Keeper order: most review history, then oldest, then the longest text. */
function keepOrder(a: DupItem, b: DupItem): number {
  const len = (i: DupItem) => i.sides.answer.length + i.sides.question.length;
  return (
    (b.weight ?? 0) - (a.weight ?? 0) ||
    (a.created ?? 0) - (b.created ?? 0) ||
    len(b) - len(a) ||
    a.id.localeCompare(b.id)
  );
}

export function findDuplicateGroups(
  all: DupItem[],
  opts: FindOptions = {}
): FindResult {
  const threshold = Math.max(
    MIN_THRESHOLD,
    Math.min(1, opts.threshold ?? DEFAULT_THRESHOLD)
  );
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.budgetMs ?? BUDGET_MS);
  const cap = opts.maxItems ?? MAX_ITEMS;
  let truncated = false;
  let reason: FindResult["reason"];
  const items = all.length > cap ? all.slice(0, cap) : all;
  if (all.length > cap) {
    truncated = true;
    reason = "items";
  }

  const feats = items.map((i) => featuresOf(i.sides));
  const keysOf = feats.map((f) => new Set([...f.q.set, ...f.a.set]));
  const index = new Map<string, number[]>();
  keysOf.forEach((keys, i) => {
    for (const k of keys) {
      const p = index.get(k);
      if (p) p.push(i);
      else index.set(k, [i]);
    }
  });
  const df = (k: string) => index.get(k)?.length ?? 0;

  const edges: [number, number, number][] = [];
  let compared = 0;
  outer: for (let i = 0; i < items.length; i++) {
    if (now() > deadline) {
      truncated = true;
      reason = "time";
      break;
    }
    if (!keysOf[i].size) continue;
    let keys = [...keysOf[i]].filter((k) => df(k) <= POSTING_CAP);
    if (!keys.length)
      keys = [...keysOf[i]].sort((x, y) => df(x) - df(y)).slice(0, 3);
    const seen = new Set<number>();
    for (const k of keys)
      for (const j of index.get(k) ?? []) {
        if (j <= i || seen.has(j)) continue;
        seen.add(j);
        compared++;
        const s = pairScore(feats[i], feats[j]);
        if (s >= threshold) edges.push([i, j, s]);
        if ((compared & 1023) === 0 && now() > deadline) {
          truncated = true;
          reason = "time";
          break outer;
        }
      }
  }

  // Union-find: linked pairs form groups.
  const parent = items.map((_, i) => i);
  const find = (start: number): number => {
    let x = start;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const [i, j] of edges) parent[find(i)] = find(j);
  const members = new Map<number, Set<number>>();
  const linked = new Map<number, [number, number, number][]>();
  for (const e of edges) {
    const r = find(e[0]);
    const m = members.get(r) ?? new Set<number>();
    m.add(e[0]).add(e[1]);
    members.set(r, m);
    linked.set(r, [...(linked.get(r) ?? []), e]);
  }

  const groups: DupGroup[] = [];
  for (const [root, set] of members) {
    const es = linked.get(root) ?? [];
    const ordered = [...set].map((i) => items[i]).sort(keepOrder);
    const keeper = ordered[0];
    const have = new Set([
      ...tokens(keeper.sides.answer),
      ...(keeper.sides.symmetric ? tokens(keeper.sides.question) : []),
    ]);
    const missing = new Set<string>();
    for (const o of ordered.slice(1))
      for (const t of [
        ...tokens(o.sides.answer),
        ...(o.sides.symmetric ? tokens(o.sides.question) : []),
      ])
        if (!have.has(t)) missing.add(t);
    const mean = es.reduce((n, e) => n + e[2], 0) / es.length;
    groups.push({
      score: Math.round(mean * 1000) / 1000,
      min_score: Math.round(Math.min(...es.map((e) => e[2])) * 1000) / 1000,
      ids: ordered.map((o) => o.id),
      keep: keeper.id,
      missing_from_keep: [...missing].slice(0, 12),
      suggestion: missing.size ? "merge_then_delete" : "delete_duplicates",
    });
  }
  groups.sort((a, b) => b.score - a.score || a.keep.localeCompare(b.keep));
  return {
    groups,
    truncated,
    ...(reason ? { reason } : {}),
    items_searched: items.length,
    pairs_compared: compared,
  };
}
