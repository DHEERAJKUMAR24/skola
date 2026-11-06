// Pure graph building and layout for the master/link graph view (ADR 0014). No Dexie, no React.
// Nodes are notes (a card is its note); edges are note-level `linkedNotes` plus the card links of
// master entries mapped to the card's note.

export interface GraphNoteInput {
  id: string;
  deck: string;
  label: string;
  isMaster: boolean;
  linkedNotes: string[];
  /** Card ids linked from the entries of a master note. */
  entryCardIds?: string[];
}

export type NodeKind = "master" | "note";
export type EdgeKind = "link" | "entry";

export interface GraphNode {
  id: string;
  label: string;
  deck: string;
  kind: NodeKind;
  /** In the deck filter's scope; false for a neighbour pulled in from another deck. */
  inScope: boolean;
  degree: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Nodes left out because of `maxNodes`. */
  truncated: number;
}

export interface BuildOptions {
  /** Only these decks (null or absent: all). */
  deckIds?: Set<string> | null;
  /** With a deck filter, also show notes of other decks that are linked to a note in scope. */
  includeNeighbors?: boolean;
  /** Show notes with no link at all (masters are always shown). */
  includeIsolated?: boolean;
  maxNodes?: number;
}

export const GRAPH_MAX_NODES = 500;

/**
 * Builds the graph. `cardToNote` maps a card id to its note id (needed for master entry links).
 * Edges are deduplicated: a note-level link counts once whatever side stores it, and an entry
 * link counts once per (master, note) pair. A note-level link between a master and a note that
 * an entry also points at stays as two edges of different kind.
 */
export function buildGraph(
  notes: GraphNoteInput[],
  cardToNote: Map<string, string>,
  opts: BuildOptions = {}
): Graph {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const edgeMap = new Map<string, GraphEdge>();
  const add = (a: string, b: string, kind: EdgeKind) => {
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    const key =
      kind === "link" ? `link:${[a, b].sort().join("|")}` : `entry:${a}|${b}`;
    if (!edgeMap.has(key))
      edgeMap.set(key, {
        id: key,
        source: kind === "link" ? [a, b].sort()[0] : a,
        target: kind === "link" ? [a, b].sort()[1] : b,
        kind,
      });
  };
  for (const n of notes) {
    for (const l of n.linkedNotes ?? []) add(n.id, l, "link");
    for (const c of n.entryCardIds ?? []) {
      const target = cardToNote.get(c);
      if (target) add(n.id, target, "entry");
    }
  }

  const deckIds = opts.deckIds && opts.deckIds.size ? opts.deckIds : null;
  const inScope = (n: GraphNoteInput) => !deckIds || deckIds.has(n.deck);
  const keep = new Set<string>();
  for (const n of notes) if (inScope(n)) keep.add(n.id);
  if (deckIds && opts.includeNeighbors !== false) {
    // One hop only: read the scope as it was before any neighbour was added.
    const scope = new Set(keep);
    for (const e of edgeMap.values()) {
      if (scope.has(e.source)) keep.add(e.target);
      if (scope.has(e.target)) keep.add(e.source);
    }
  }

  const edges = [...edgeMap.values()].filter(
    (e) => keep.has(e.source) && keep.has(e.target)
  );
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }

  let nodes: GraphNode[] = [...keep].flatMap((id) => {
    const n = byId.get(id);
    if (!n) return [];
    const d = degree.get(id) ?? 0;
    if (d === 0 && !n.isMaster && !opts.includeIsolated) return [];
    return [
      {
        id,
        label: n.label,
        deck: n.deck,
        kind: (n.isMaster ? "master" : "note") as NodeKind,
        inScope: inScope(n),
        degree: d,
      },
    ];
  });

  const max = opts.maxNodes ?? GRAPH_MAX_NODES;
  let truncated = 0;
  if (nodes.length > max) {
    // Masters first, then the most connected.
    nodes.sort(
      (a, b) =>
        Number(b.kind === "master") - Number(a.kind === "master") ||
        b.degree - a.degree ||
        a.id.localeCompare(b.id)
    );
    truncated = nodes.length - max;
    nodes = nodes.slice(0, max);
  } else nodes.sort((a, b) => a.id.localeCompare(b.id));
  const shown = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: edges.filter((e) => shown.has(e.source) && shown.has(e.target)),
    truncated,
  };
}

// ---------------------------------------------------------------------------------------------
// Force layout

export interface Point {
  x: number;
  y: number;
}

export interface LayoutOptions {
  iterations?: number;
  /** Rest length of an edge. */
  linkDistance?: number;
  /** Repulsion strength between every pair of nodes. */
  repulsion?: number;
  /** Pull of every node towards the centre. */
  gravity?: number;
  seed?: number;
  /** Positions to start from (nodes not in it start on a spiral). */
  initial?: Map<string, Point>;
}

/** Small deterministic PRNG, so a layout is reproducible and testable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Force-directed layout (repulsion between all pairs, springs along edges, weak gravity,
 * cooling). O(n^2) per iteration; the iteration count shrinks with n so 500 nodes stay under a
 * fraction of a second. Returns positions centred on (0, 0).
 */
export function forceLayout(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
  opts: LayoutOptions = {}
): Map<string, Point> {
  const n = nodes.length;
  const out = new Map<string, Point>();
  if (n === 0) return out;
  const rand = mulberry32(opts.seed ?? 1);
  const k = opts.linkDistance ?? 70;
  const rep = opts.repulsion ?? 2400;
  const gravity = opts.gravity ?? 0.02;
  const iters = Math.max(
    20,
    Math.min(opts.iterations ?? 300, Math.floor(4_000_000 / (n * n + 1)))
  );

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const index = new Map(nodes.map((nd, i) => [nd.id, i] as const));
  nodes.forEach((nd, i) => {
    const start = opts.initial?.get(nd.id);
    if (start) {
      x[i] = start.x;
      y[i] = start.y;
    } else {
      const r = k * Math.sqrt(i + 1) * 0.6;
      const a = i * 2.399963 + rand() * 0.3;
      x[i] = r * Math.cos(a);
      y[i] = r * Math.sin(a);
    }
  });
  const links = edges.flatMap((e) => {
    const a = index.get(e.source);
    const b = index.get(e.target);
    return a === undefined || b === undefined || a === b
      ? []
      : [[a, b] as const];
  });

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    const temp = 1 - it / iters;
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j];
        let ey = y[i] - y[j];
        let d2 = ex * ex + ey * ey;
        if (d2 < 0.01) {
          // Same spot: nudge apart in a deterministic direction.
          ex = rand() - 0.5;
          ey = rand() - 0.5;
          d2 = ex * ex + ey * ey + 0.01;
        }
        const f = rep / d2;
        const d = Math.sqrt(d2);
        const fx = (ex / d) * f;
        const fy = (ey / d) * f;
        dx[i] += fx;
        dy[i] += fy;
        dx[j] -= fx;
        dy[j] -= fy;
      }
    for (const [a, b] of links) {
      const ex = x[b] - x[a];
      const ey = y[b] - y[a];
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      const f = (d - k) * 0.08;
      const fx = (ex / d) * f;
      const fy = (ey / d) * f;
      dx[a] += fx;
      dy[a] += fy;
      dx[b] -= fx;
      dy[b] -= fy;
    }
    const maxStep = 40 * temp + 1;
    for (let i = 0; i < n; i++) {
      dx[i] -= x[i] * gravity;
      dy[i] -= y[i] * gravity;
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      const s = len > maxStep ? maxStep / len : 1;
      x[i] += dx[i] * s;
      y[i] += dy[i] * s;
    }
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += x[i];
    cy += y[i];
  }
  cx /= n;
  cy /= n;
  nodes.forEach((nd, i) => out.set(nd.id, { x: x[i] - cx, y: y[i] - cy }));
  return out;
}

// ---------------------------------------------------------------------------------------------
// View transform (pan and zoom)

export interface View {
  /** Screen offset of the world origin, in px. */
  x: number;
  y: number;
  /** Scale. */
  k: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6;

export const clampZoom = (k: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Zooms by `factor` keeping the world point under the screen point `p` fixed. */
export function zoomAt(view: View, p: Point, factor: number): View {
  const k = clampZoom(view.k * factor);
  const f = k / view.k;
  return { k, x: p.x - (p.x - view.x) * f, y: p.y - (p.y - view.y) * f };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

export function toWorld(view: View, p: Point): Point {
  return { x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k };
}

/** A view that fits all points into a `width` x `height` screen with `pad` px around. */
export function fitView(
  points: Point[],
  width: number,
  height: number,
  pad = 40
): View {
  if (points.length === 0) return { x: width / 2, y: height / 2, k: 1 };
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const k = clampZoom(
    Math.min((width - 2 * pad) / w, (height - 2 * pad) / h, 1.5)
  );
  return {
    k,
    x: width / 2 - ((minX + maxX) / 2) * k,
    y: height / 2 - ((minY + maxY) / 2) * k,
  };
}
