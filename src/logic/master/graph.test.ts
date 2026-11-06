import { describe, expect, it } from "vitest";
import {
  type GraphNoteInput,
  buildGraph,
  clampZoom,
  fitView,
  forceLayout,
  mulberry32,
  panBy,
  toWorld,
  zoomAt,
} from "./graph";

const note = (
  id: string,
  deck: string,
  extra: Partial<GraphNoteInput> = {}
): GraphNoteInput => ({
  id,
  deck,
  label: id,
  isMaster: false,
  linkedNotes: [],
  ...extra,
});

describe("buildGraph", () => {
  const notes = [
    note("m", "d1", { isMaster: true, entryCardIds: ["c-a", "c-x", "c-gone"] }),
    note("a", "d1", { linkedNotes: ["b"] }),
    note("b", "d1", { linkedNotes: ["a"] }),
    note("x", "d2", { linkedNotes: ["a"] }),
    note("lonely", "d1"),
    note("far", "d3", { linkedNotes: ["x"] }),
  ];
  const cards = new Map([
    ["c-a", "a"],
    ["c-x", "x"],
  ]);

  it("dedupes links stored on both sides and maps entry links to notes", () => {
    const g = buildGraph(notes, cards);
    expect(g.edges.filter((e) => e.kind === "link")).toHaveLength(3);
    expect(g.edges.filter((e) => e.kind === "entry")).toHaveLength(2);
    expect(g.nodes.find((n) => n.id === "m")?.kind).toBe("master");
  });
  it("hides isolated notes unless asked, always shows masters", () => {
    expect(buildGraph(notes, cards).nodes.some((n) => n.id === "lonely")).toBe(
      false
    );
    expect(
      buildGraph(notes, cards, { includeIsolated: true }).nodes.some(
        (n) => n.id === "lonely"
      )
    ).toBe(true);
    const onlyMaster = buildGraph(
      [note("m", "d1", { isMaster: true })],
      new Map()
    );
    expect(onlyMaster.nodes).toHaveLength(1);
  });
  it("deck filter pulls in one-hop cross-deck neighbours, marked out of scope", () => {
    const g = buildGraph(notes, cards, { deckIds: new Set(["d1"]) });
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toContain("x");
    expect(ids).not.toContain("far");
    expect(g.nodes.find((n) => n.id === "x")?.inScope).toBe(false);
    expect(g.nodes.find((n) => n.id === "a")?.inScope).toBe(true);
    const strict = buildGraph(notes, cards, {
      deckIds: new Set(["d1"]),
      includeNeighbors: false,
    });
    expect(strict.nodes.map((n) => n.id)).not.toContain("x");
    for (const e of strict.edges)
      expect(strict.nodes.some((n) => n.id === e.source)).toBe(true);
  });
  it("ignores links to unknown notes and self links", () => {
    const g = buildGraph(
      [note("a", "d", { linkedNotes: ["a", "nope"] })],
      new Map(),
      { includeIsolated: true }
    );
    expect(g.edges).toEqual([]);
  });
  it("caps nodes keeping masters and the best connected", () => {
    const many = [
      note("m", "d", { isMaster: true }),
      ...Array.from({ length: 10 }, (_, i) =>
        note(`n${i}`, "d", { linkedNotes: i === 0 ? ["n1", "n2", "n3"] : [] })
      ),
    ];
    const g = buildGraph(many, new Map(), { maxNodes: 3 });
    expect(g.nodes).toHaveLength(3);
    expect(g.nodes[0].id).toBe("m");
    expect(g.nodes.map((n) => n.id)).toContain("n0");
    expect(g.truncated).toBe(2);
  });
});

describe("forceLayout", () => {
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}` }));
  const edges = [
    ...Array.from({ length: 5 }, (_, i) => ({
      source: `n${i}`,
      target: `n${i + 1}`,
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      source: `n${i + 6}`,
      target: `n${i + 7}`,
    })),
  ];
  const dist = (
    m: Map<string, { x: number; y: number }>,
    a: string,
    b: string
  ) => {
    const p = m.get(a) as { x: number; y: number };
    const q = m.get(b) as { x: number; y: number };
    return Math.hypot(p.x - q.x, p.y - q.y);
  };

  it("is deterministic and finite", () => {
    const a = forceLayout(nodes, edges, { seed: 3 });
    const b = forceLayout(nodes, edges, { seed: 3 });
    expect([...a]).toEqual([...b]);
    for (const p of a.values())
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
  it("handles empty and single node, and edges to unknown nodes", () => {
    expect(forceLayout([], []).size).toBe(0);
    const one = forceLayout([{ id: "a" }], [{ source: "a", target: "zz" }]);
    expect(one.get("a")).toEqual({ x: 0, y: 0 });
  });
  it("keeps linked nodes closer on average than unlinked ones", () => {
    const m = forceLayout(nodes, edges);
    const linked = new Set(edges.map((e) => `${e.source}|${e.target}`));
    let l = 0;
    let ln = 0;
    let u = 0;
    let un = 0;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const d = dist(m, nodes[i].id, nodes[j].id);
        if (linked.has(`${nodes[i].id}|${nodes[j].id}`)) {
          l += d;
          ln++;
        } else {
          u += d;
          un++;
        }
      }
    expect(l / ln).toBeLessThan(u / un);
  });
  it("separates nodes that start on the same spot", () => {
    const init = new Map([
      ["a", { x: 5, y: 5 }],
      ["b", { x: 5, y: 5 }],
    ]);
    const m = forceLayout([{ id: "a" }, { id: "b" }], [], { initial: init });
    expect(dist(m, "a", "b")).toBeGreaterThan(5);
  });
  it("is fast for 500 nodes", () => {
    const big = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}` }));
    const e = big.slice(1).map((n, i) => ({ source: big[i].id, target: n.id }));
    const t = Date.now();
    forceLayout(big, e);
    expect(Date.now() - t).toBeLessThan(3000);
  });
  it("prng is repeatable", () => {
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });
});

describe("view", () => {
  it("zoomAt keeps the point under the cursor fixed", () => {
    const v = { x: 10, y: 20, k: 1 };
    const p = { x: 200, y: 100 };
    const before = toWorld(v, p);
    const z = zoomAt(v, p, 2);
    const after = toWorld(z, p);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(z.k).toBe(2);
  });
  it("clamps zoom and pans", () => {
    expect(clampZoom(100)).toBe(6);
    expect(clampZoom(0)).toBe(0.1);
    expect(zoomAt({ x: 0, y: 0, k: 6 }, { x: 0, y: 0 }, 2).k).toBe(6);
    expect(panBy({ x: 1, y: 2, k: 1 }, 3, 4)).toEqual({ x: 4, y: 6, k: 1 });
  });
  it("fitView centres the points", () => {
    const v = fitView(
      [
        { x: -100, y: -50 },
        { x: 100, y: 50 },
      ],
      400,
      300
    );
    expect(v.x).toBeCloseTo(200);
    expect(v.y).toBeCloseTo(150);
    expect(fitView([], 400, 300)).toEqual({ x: 200, y: 150, k: 1 });
  });
});
