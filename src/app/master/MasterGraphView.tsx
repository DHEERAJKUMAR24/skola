import { AppHeaderContent } from "@/app/shell/Header/Header";
import { AppBreadcrumbs } from "@/components/AppBreadcrumbs";
import { useDocumentTitle } from "@/lib/hooks/useDocumentTitle";
import { decksWithPaths, descendantIds } from "@/logic/deck/deckPath";
import { useDecks } from "@/logic/deck/hooks/useDecks";
import {
  linkAnyNotes,
  loadGraphData,
  noteOfCard,
  unlinkMasterEntriesTo,
  unlinkNotes,
} from "@/logic/master/builderData";
import {
  type GraphEdge,
  type GraphNode,
  type Point,
  type View,
  buildGraph,
  createSimulation,
  fitView,
  panBy,
  toWorld,
  zoomAt,
} from "@/logic/master/graph";
import { graphDemoExists, seedGraphDemo } from "@/logic/seed/graphDemo";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import CardPickerModal from "./CardPickerModal";
import "./MasterBuilder.css";

const ALL = "all";

// ── Obsidian-faithful color palette ──────────────────────────────────────────
const C = {
  bg: "#0d1117",
  node: "#555570",
  nodeMaster: "#c084fc",
  nodeScope: "#60a5fa",
  nodeSelected: "#f0e6ff",
  nodeHovered: "#c4b5fd",
  nodeOutScope: "#3d4049",
  edge: "rgba(100,110,140,0.22)",
  edgeEntry: "rgba(167,139,250,0.22)",
  edgeActive: "rgba(192,160,255,0.75)",
  edgeEntryActive: "rgba(220,180,255,0.9)",
  label: "rgba(255,255,255,0.88)",
  labelDimmed: "rgba(255,255,255,0.28)",
  minimap: {
    bg: "rgba(10,13,20,0.82)",
    border: "rgba(100,110,140,0.35)",
    viewport: "rgba(255,255,255,0.12)",
    node: "#6080b0",
    master: "#a060d0",
  },
};

function nodeBaseRadius(degree: number, isMaster: boolean): number {
  return isMaster
    ? Math.max(9, 5 + degree * 1.0)
    : Math.max(4, 3 + degree * 0.7);
}

function nodeBaseColor(node: GraphNode): string {
  if (!node.inScope) return C.nodeOutScope;
  if (node.kind === "master") return C.nodeMaster;
  return C.nodeScope;
}

// ── Group query matching ──────────────────────────────────────────────────────
export interface GraphGroup {
  id: string;
  query: string;
  color: string;
}

function matchesGroupQuery(node: GraphNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (q === "master") return node.kind === "master";
  if (q === "orphan") return node.degree === 0;
  if (q.startsWith("deck:")) {
    const target = q.slice(5).trim();
    return node.deck.toLowerCase().includes(target);
  }
  if (q.startsWith("tag:")) {
    const target = q.slice(4).trim();
    return (node.tags ?? []).some((t) => t.toLowerCase() === target);
  }
  if (q.startsWith("/") && q.endsWith("/") && q.length > 2) {
    try {
      return new RegExp(q.slice(1, -1), "i").test(node.label);
    } catch {
      return false;
    }
  }
  return node.label.toLowerCase().includes(q);
}

function nodeGroupColor(
  node: GraphNode,
  groups: GraphGroup[]
): string | undefined {
  for (const g of groups) {
    if (g.query && matchesGroupQuery(node, g.query)) return g.color;
  }
  return undefined;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Forces {
  repulsion: number;
  linkDistance: number;
  gravity: number;
  nodeScale: number;
}

interface Display {
  nodeScale: number;
  linkThickness: number;
  textFadeThreshold: number;
  showArrows: boolean;
  searchQuery: string;
  groups: GraphGroup[];
}

interface DragState {
  kind: "pan" | "node";
  nodeId?: string;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

interface PanelSections {
  filters: boolean;
  groups: boolean;
  display: boolean;
  forces: boolean;
}

export default function MasterGraphView() {
  const [t] = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  useDocumentTitle(`${t("graph.title")} | Skola`);

  const [decks] = useDecks();
  const deckParam = params.get("deck") ?? ALL;
  const focus = params.get("focus");

  // Dev: seed demo data
  const [seeding, setSeeding] = useState(false);
  const [seedDone, setSeedDone] = useState(false);
  const handleSeedDemo = async () => {
    if (await graphDemoExists()) {
      setSeedDone(true);
      return;
    }
    setSeeding(true);
    try {
      await seedGraphDemo();
      setSeedDone(true);
    } finally {
      setSeeding(false);
    }
  };

  // Filter state
  const [isolated, setIsolated] = useState(false);
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [selected, setSelected] = useState<string | null>(focus);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState("");

  // Panel UI state
  const [showPanel, setShowPanel] = useState(true);
  const [panelSections, setPanelSections] = useState<PanelSections>({
    filters: true,
    groups: false,
    display: true,
    forces: false,
  });
  const [searchQuery, setSearchQuery] = useState("");

  // Groups
  const [groups, setGroups] = useState<GraphGroup[]>([]);

  // Display params
  const [showArrows, setShowArrows] = useState(false);
  const [textFadeThreshold, setTextFadeThreshold] = useState(0.3);
  const [linkThickness, setLinkThickness] = useState(1.0);
  const [nodeScale, setNodeScale] = useState(1.0);

  // Force simulation params
  const [repulsion, setRepulsion] = useState(2400);
  const [linkDistance, setLinkDistance] = useState(70);
  const [gravity, setGravity] = useState(2);

  // Mutable state lives in refs — no React re-renders for canvas operations.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ x: 0, y: 0, k: 1 });
  const posRef = useRef<Map<string, Point>>(new Map());
  const simRef = useRef<ReturnType<typeof createSimulation> | null>(null);
  const rafRef = useRef(0);
  const selectedRef = useRef<string | null>(selected);
  const hoveredRef = useRef<string | null>(null);
  const appGraphRef = useRef<ReturnType<typeof buildGraph> | null>(null);
  const forcesRef = useRef<Forces>({
    repulsion,
    linkDistance,
    gravity: gravity / 100,
    nodeScale,
  });
  const displayRef = useRef<Display>({
    nodeScale,
    linkThickness,
    textFadeThreshold,
    showArrows,
    searchQuery,
    groups,
  });
  const cssSizeRef = useRef({ width: 0, height: 0 });
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    forcesRef.current = {
      repulsion,
      linkDistance,
      gravity: gravity / 100,
      nodeScale,
    };
  }, [repulsion, linkDistance, gravity, nodeScale]);

  useEffect(() => {
    displayRef.current = {
      nodeScale,
      linkThickness,
      textFadeThreshold,
      showArrows,
      searchQuery,
      groups,
    };
  }, [
    nodeScale,
    linkThickness,
    textFadeThreshold,
    showArrows,
    searchQuery,
    groups,
  ]);

  // ── Data pipeline ─────────────────────────────────────────────────────────

  const data = useLiveQuery(loadGraphData, []);
  const deckIds = useMemo(
    () =>
      deckParam === ALL || !decks ? null : descendantIds(deckParam, decks),
    [deckParam, decks]
  );
  const appGraph = useMemo(
    () =>
      data &&
      buildGraph(data.notes, data.cardToNote, {
        deckIds,
        includeNeighbors: showNeighbors,
        includeIsolated: isolated,
      }),
    [data, deckIds, showNeighbors, isolated]
  );

  // ── Canvas draw ───────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const graph = appGraphRef.current;
    if (!canvas || !graph) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = cssSizeRef.current;
    if (width === 0 || height === 0) return;

    const view = viewRef.current;
    const positions = posRef.current;
    const sel = selectedRef.current;
    const hov = hoveredRef.current;
    const {
      nodeScale: ns,
      linkThickness: lt,
      textFadeThreshold: tft,
      showArrows: arrows,
      searchQuery: sq,
      groups: grps,
    } = displayRef.current;
    const hasSearch = sq.trim().length > 0;

    // Build neighbor set for dimming.
    const neighbors = new Set<string>();
    const focus2 = sel ?? hov;
    if (focus2) {
      for (const e of graph.edges) {
        if (e.source === focus2) neighbors.add(e.target);
        if (e.target === focus2) neighbors.add(e.source);
      }
    }

    // Build search match set.
    const matchingSearch = hasSearch
      ? new Set(
          graph.nodes
            .filter((n) =>
              n.label.toLowerCase().includes(sq.trim().toLowerCase())
            )
            .map((n) => n.id)
        )
      : null;

    // ── Background ──
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, height);

    // Dot grid (scrolls with the view — Obsidian style)
    const spacing = 32;
    const offX = ((view.x % spacing) + spacing) % spacing;
    const offY = ((view.y % spacing) + spacing) % spacing;
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let x = offX - spacing; x < width + spacing; x += spacing) {
      for (let y = offY - spacing; y < height + spacing; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Edges ──
    ctx.save();
    for (const edge of graph.edges) {
      const src = positions.get(edge.source);
      const tgt = positions.get(edge.target);
      if (!src || !tgt) continue;
      const sx = src.x * view.k + view.x;
      const sy = src.y * view.k + view.y;
      const tx = tgt.x * view.k + view.x;
      const ty = tgt.y * view.k + view.y;
      const isActive =
        edge.source === sel ||
        edge.target === sel ||
        edge.source === hov ||
        edge.target === hov;
      const isDimmedFocus = focus2 !== null && !isActive;
      const isDimmedSearch =
        matchingSearch !== null &&
        !matchingSearch.has(edge.source) &&
        !matchingSearch.has(edge.target);

      ctx.globalAlpha =
        isDimmedFocus || isDimmedSearch ? 0.08 : isActive ? 1 : 0.9;
      ctx.strokeStyle = isActive
        ? edge.kind === "entry"
          ? C.edgeEntryActive
          : C.edgeActive
        : edge.kind === "entry"
          ? C.edgeEntry
          : C.edge;
      ctx.lineWidth = (isActive ? 2 : 1) * lt;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      // Arrowhead towards target
      if (arrows && !isDimmedFocus && !isDimmedSearch) {
        const angle = Math.atan2(ty - sy, tx - sx);
        const tgtNode = graph.nodes.find((n) => n.id === edge.target);
        const tgtR = tgtNode
          ? nodeBaseRadius(tgtNode.degree, tgtNode.kind === "master") *
            ns *
            view.k
          : 6;
        const ax = tx - Math.cos(angle) * tgtR;
        const ay = ty - Math.sin(angle) * tgtR;
        const aw = 7 * lt;
        ctx.globalAlpha = isActive ? 1 : 0.6;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(
          ax - aw * Math.cos(angle - 0.4),
          ay - aw * Math.sin(angle - 0.4)
        );
        ctx.lineTo(
          ax - aw * Math.cos(angle + 0.4),
          ay - aw * Math.sin(angle + 0.4)
        );
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();

    // ── Nodes ──
    for (const node of graph.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const sx = pos.x * view.k + view.x;
      const sy = pos.y * view.k + view.y;
      const r = nodeBaseRadius(node.degree, node.kind === "master") * ns;
      const isSel = node.id === sel;
      const isHov = node.id === hov;

      // Color: selected/hovered > group > base
      let color: string;
      if (isSel) color = C.nodeSelected;
      else if (isHov) color = C.nodeHovered;
      else {
        const gc = nodeGroupColor(node, grps);
        color = gc ?? nodeBaseColor(node);
      }

      const isDimmedFocus =
        focus2 !== null && !isSel && !isHov && !neighbors.has(node.id);
      const isDimmedSearch =
        matchingSearch !== null && !matchingSearch.has(node.id) && !isSel;
      const isDimmed = isDimmedFocus || isDimmedSearch;

      ctx.save();
      ctx.globalAlpha = isDimmed ? 0.14 : 1;

      if (isSel || isHov) {
        ctx.shadowBlur = isSel ? 28 : 18;
        ctx.shadowColor = color;
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, r * view.k, 0, Math.PI * 2);
      ctx.fill();

      if (isSel) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `${color}55`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, (r + 5) * view.k, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      // Label
      if (!isDimmed) {
        const zoom = view.k;
        const showLabel =
          zoom > tft || node.kind === "master" || isSel || isHov;
        if (showLabel) {
          const fontSize = Math.min(13, Math.max(9, 11 * zoom));
          ctx.font = `${fontSize}px system-ui, sans-serif`;
          ctx.fillStyle = C.label;
          ctx.fillText(node.label, sx + r * view.k + 5, sy + fontSize * 0.35);
        }
      }
    }

    // Vignette
    const vig = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.3,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.75
    );
    vig.addColorStop(0, "transparent");
    vig.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);

    // ── Minimap ──
    const mmW = 140;
    const mmH = 90;
    const mmX = width - mmW - 10;
    const mmY = height - mmH - 10;
    const mmPad = 8;

    let minWX = Number.POSITIVE_INFINITY;
    let maxWX = Number.NEGATIVE_INFINITY;
    let minWY = Number.POSITIVE_INFINITY;
    let maxWY = Number.NEGATIVE_INFINITY;
    for (const p of positions.values()) {
      if (p.x < minWX) minWX = p.x;
      if (p.x > maxWX) maxWX = p.x;
      if (p.y < minWY) minWY = p.y;
      if (p.y > maxWY) maxWY = p.y;
    }
    if (positions.size > 0) {
      const wRange = Math.max(maxWX - minWX, 1);
      const hRange = Math.max(maxWY - minWY, 1);
      const mmScale =
        Math.min((mmW - mmPad * 2) / wRange, (mmH - mmPad * 2) / hRange) * 0.9;
      const toCX = (wx: number) =>
        mmX +
        mmPad +
        (wx - minWX) * mmScale +
        (mmW - mmPad * 2 - wRange * mmScale) / 2;
      const toCY = (wy: number) =>
        mmY +
        mmPad +
        (wy - minWY) * mmScale +
        (mmH - mmPad * 2 - hRange * mmScale) / 2;

      ctx.save();
      ctx.fillStyle = C.minimap.bg;
      ctx.strokeStyle = C.minimap.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(mmX, mmY, mmW, mmH, 6);
      ctx.fill();
      ctx.stroke();

      const vLeft = toCX(toWorld(view, { x: 0, y: 0 }).x);
      const vTop = toCY(toWorld(view, { x: 0, y: 0 }).y);
      const vRight = toCX(toWorld(view, { x: width, y: height }).x);
      const vBot = toCY(toWorld(view, { x: width, y: height }).y);
      ctx.fillStyle = C.minimap.viewport;
      ctx.fillRect(
        Math.max(mmX, vLeft),
        Math.max(mmY, vTop),
        Math.min(vRight - vLeft, mmW),
        Math.min(vBot - vTop, mmH)
      );

      for (const node of graph.nodes) {
        const p = positions.get(node.id);
        if (!p) continue;
        const gc = nodeGroupColor(node, grps);
        ctx.fillStyle =
          gc ?? (node.kind === "master" ? C.minimap.master : C.minimap.node);
        ctx.beginPath();
        ctx.arc(
          toCX(p.x),
          toCY(p.y),
          node.kind === "master" ? 2.5 : 1.5,
          0,
          Math.PI * 2
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }, []);

  // ── Simulation lifecycle ──────────────────────────────────────────────────

  useEffect(() => {
    if (!appGraph) return;
    appGraphRef.current = appGraph;

    cancelAnimationFrame(rafRef.current);

    const {
      repulsion: rep,
      linkDistance: ld,
      gravity: grav,
    } = forcesRef.current;
    const sim = createSimulation(appGraph.nodes, appGraph.edges, {
      repulsion: rep,
      linkDistance: ld,
      gravity: grav,
      initial: posRef.current.size > 0 ? posRef.current : undefined,
    });
    simRef.current = sim;

    if (posRef.current.size === 0) {
      for (let i = 0; i < 60; i++) sim.tick(10);
      posRef.current = sim.positions();
      const { width, height } = cssSizeRef.current;
      if (width > 0 && height > 0) {
        viewRef.current = fitView([...posRef.current.values()], width, height);
      }
    }

    let running = true;
    const step = () => {
      if (!running) return;
      const alpha = sim.tick(3);
      posRef.current = sim.positions();
      draw();
      if (alpha > 0.001) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [appGraph, repulsion, linkDistance, gravity, draw]);

  // Redraw only when visual-only params change.
  useEffect(() => {
    displayRef.current = {
      nodeScale,
      linkThickness,
      textFadeThreshold,
      showArrows,
      searchQuery,
      groups,
    };
    draw();
  }, [
    nodeScale,
    linkThickness,
    textFadeThreshold,
    showArrows,
    searchQuery,
    groups,
    draw,
  ]);

  // ── Canvas resize observer ────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = (w: number, h: number) => {
      cssSizeRef.current = { width: w, height: h };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      resize(width, height);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  // ── Animate (timelapse) ───────────────────────────────────────────────────

  const animate = useCallback(() => {
    const graph = appGraphRef.current;
    if (!graph) return;
    posRef.current = new Map();
    const {
      repulsion: rep,
      linkDistance: ld,
      gravity: grav,
    } = forcesRef.current;
    const sim = createSimulation(graph.nodes, graph.edges, {
      repulsion: rep,
      linkDistance: ld,
      gravity: grav,
    });
    simRef.current = sim;
    cancelAnimationFrame(rafRef.current);
    const running = true;
    const step = () => {
      if (!running) return;
      const alpha = sim.tick(2);
      posRef.current = sim.positions();
      draw();
      if (alpha > 0.0005) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [draw]);

  // ── Hit testing ───────────────────────────────────────────────────────────

  const hitNode = useCallback((wx: number, wy: number): string | null => {
    const graph = appGraphRef.current;
    if (!graph) return null;
    const ns = forcesRef.current.nodeScale;
    for (let i = graph.nodes.length - 1; i >= 0; i--) {
      const node = graph.nodes[i];
      const pos = posRef.current.get(node.id);
      if (!pos) continue;
      const r = nodeBaseRadius(node.degree, node.kind === "master") * ns;
      const dx = wx - pos.x;
      const dy = wy - pos.y;
      if (dx * dx + dy * dy <= r * r) return node.id;
    }
    return null;
  }, []);

  // ── Pointer events ────────────────────────────────────────────────────────

  const screenToWorld = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return toWorld(viewRef.current, {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = toWorld(viewRef.current, { x: sx, y: sy });
      const hit = hitNode(world.x, world.y);
      dragRef.current = {
        kind: hit ? "node" : "pan",
        nodeId: hit ?? undefined,
        startX: sx,
        startY: sy,
        lastX: sx,
        lastY: sy,
        moved: false,
      };
    },
    [hitNode]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const drag = dragRef.current;
      if (drag) {
        const dx = sx - drag.lastX;
        const dy = sy - drag.lastY;
        drag.lastX = sx;
        drag.lastY = sy;
        if (Math.abs(sx - drag.startX) > 3 || Math.abs(sy - drag.startY) > 3) {
          drag.moved = true;
        }
        if (drag.kind === "pan") {
          viewRef.current = panBy(viewRef.current, dx, dy);
          draw();
        } else if (drag.kind === "node" && drag.nodeId) {
          cancelAnimationFrame(rafRef.current);
          posRef.current.set(
            drag.nodeId,
            toWorld(viewRef.current, { x: sx, y: sy })
          );
          draw();
        }
      } else {
        const world = toWorld(viewRef.current, { x: sx, y: sy });
        const hit = hitNode(world.x, world.y);
        if (hit !== hoveredRef.current) {
          hoveredRef.current = hit;
          draw();
        }
      }
    },
    [hitNode, draw]
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;

      if (!drag.moved) {
        const world = screenToWorld(e);
        const hit = hitNode(world.x, world.y);
        const next = hit === selectedRef.current ? null : hit;
        selectedRef.current = next;
        setSelected(next);
        draw();
      } else if (drag.kind === "node") {
        const sim = simRef.current;
        if (!sim || !appGraphRef.current) return;
        const running = true;
        const step = () => {
          if (!running) return;
          const alpha = sim.tick(3);
          posRef.current = sim.positions();
          draw();
          if (alpha > 0.001) rafRef.current = requestAnimationFrame(step);
        };
        rafRef.current = requestAnimationFrame(step);
      }
    },
    [hitNode, draw, screenToWorld]
  );

  const onMouseLeave = useCallback(() => {
    dragRef.current = null;
    hoveredRef.current = null;
    draw();
  }, [draw]);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      viewRef.current = zoomAt(viewRef.current, { x: sx, y: sy }, factor);
      draw();
    },
    [draw]
  );

  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const world = screenToWorld(e);
      const hit = hitNode(world.x, world.y);
      if (!hit) return;
      const graph = appGraphRef.current;
      const node = graph?.nodes.find((n) => n.id === hit);
      if (!node) return;
      if (node.kind === "master") navigate(`/master/${hit}`);
      else navigate(`/notes?deck=${node.deck}&note=${hit}`);
    },
    [hitNode, navigate, screenToWorld]
  );

  const fitViewBtn = useCallback(() => {
    const { width, height } = cssSizeRef.current;
    if (posRef.current.size === 0 || width === 0) return;
    viewRef.current = fitView([...posRef.current.values()], width, height);
    draw();
  }, [draw]);

  // ── Panel helpers ─────────────────────────────────────────────────────────

  const nodeById = useMemo<Map<string, GraphNode>>(() => {
    const m = new Map<string, GraphNode>();
    for (const n of appGraph?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [appGraph]);

  const sel: GraphNode | undefined = selected
    ? nodeById.get(selected)
    : undefined;

  const selEdges = useMemo<GraphEdge[]>(
    () =>
      (appGraph?.edges ?? []).filter(
        (e) => e.source === selected || e.target === selected
      ),
    [selected, appGraph]
  );

  const open = useCallback(
    (id: string) => {
      const n = nodeById.get(id);
      if (!n) return;
      navigate(
        n.kind === "master"
          ? `/master/${id}`
          : `/notes?deck=${n.deck}&note=${id}`
      );
    },
    [nodeById, navigate]
  );

  const removeEdge = async (e: GraphEdge) => {
    if (e.kind === "link") await unlinkNotes(e.source, e.target);
    else await unlinkMasterEntriesTo(e.source, e.target);
    setMessage(t("graph.removed"));
  };

  const addLink = async (cardId: string) => {
    if (!selected) return;
    const other = await noteOfCard(cardId);
    if (!other) return;
    try {
      await linkAnyNotes(selected, other);
      setMessage(t("graph.linked"));
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const deckOptions = [
    { value: ALL, label: t("graph.all-decks") },
    ...decksWithPaths(decks ?? []).map(({ deck, path }) => ({
      value: deck.id,
      label: path,
    })),
  ];

  const toggleSection = (s: keyof PanelSections) =>
    setPanelSections((prev) => ({ ...prev, [s]: !prev[s] }));

  const addGroup = () =>
    setGroups((g) => [
      ...g,
      {
        id: `${Date.now()}-${Math.random()}`,
        query: "",
        color: `hsl(${Math.round(Math.random() * 360)},70%,55%)`,
      },
    ]);

  const updateGroup = (i: number, patch: Partial<GraphGroup>) =>
    setGroups((g) => g.map((grp, j) => (j === i ? { ...grp, ...patch } : grp)));

  const removeGroup = (i: number) =>
    setGroups((g) => g.filter((_, j) => j !== i));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="master-graph" data-testid="master-graph">
      <AppHeaderContent>
        <AppBreadcrumbs segments={[{ label: t("graph.title") }]} />
      </AppHeaderContent>

      {/* Full-page canvas area */}
      <div className="master-graph__canvas-wrap">
        <canvas
          ref={canvasRef}
          className="master-graph__canvas"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
        />

        {/* Toolbar — top-left */}
        <div className="mgraph-toolbar">
          <button
            type="button"
            className="mgraph-toolbar__btn"
            title={t("graph.fit")}
            onClick={fitViewBtn}
          >
            ⊡
          </button>
          <button
            type="button"
            className={`mgraph-toolbar__btn${showPanel ? " mgraph-toolbar__btn--active" : ""}`}
            title="Filters"
            onClick={() => setShowPanel((s) => !s)}
          >
            ≡
          </button>
          {process.env.NODE_ENV === "development" && (
            <button
              type="button"
              className="mgraph-toolbar__btn"
              title={
                seedDone
                  ? "Graph demo already seeded"
                  : "Seed graph demo (20 notes)"
              }
              onClick={() => void handleSeedDemo()}
              disabled={seeding}
              style={{ fontSize: 13 }}
            >
              {seeding ? "…" : seedDone ? "✓" : "🌱"}
            </button>
          )}
        </div>

        {/* Stats badge */}
        {appGraph && (
          <div className="mgraph-stats">
            {t("graph.counts", {
              nodes: appGraph.nodes.length,
              edges: appGraph.edges.length,
            })}
            {appGraph.truncated > 0 &&
              ` · +${appGraph.truncated} ${t("graph.truncated-suffix", "more hidden")}`}
          </div>
        )}

        {/* Floating filter / settings panel — top-right */}
        {showPanel && (
          <div className="mgraph-panel">
            {/* ── Filters ─────────────────────────────────────── */}
            <div className="mgraph-panel__section">
              <div className="mgraph-panel__section-head">
                <button
                  type="button"
                  className="mgraph-panel__section-toggle"
                  onClick={() => toggleSection("filters")}
                >
                  <span className="mgraph-panel__chevron">
                    {panelSections.filters ? "▾" : "▸"}
                  </span>
                  Filters
                </button>
                <button
                  type="button"
                  className="mgraph-panel__icon-btn"
                  title="Reset filters"
                  onClick={() => {
                    setSearchQuery("");
                    setIsolated(false);
                    setShowNeighbors(true);
                    setParams((p) => {
                      const n = new URLSearchParams(p);
                      n.delete("deck");
                      return n;
                    });
                  }}
                >
                  ↺
                </button>
                <button
                  type="button"
                  className="mgraph-panel__icon-btn"
                  title="Close panel"
                  onClick={() => setShowPanel(false)}
                >
                  ✕
                </button>
              </div>
              {panelSections.filters && (
                <div className="mgraph-panel__section-body">
                  <div className="mgraph-panel__search-wrap">
                    <span className="mgraph-panel__search-icon">🔍</span>
                    <input
                      type="search"
                      className="mgraph-panel__search"
                      placeholder="Search nodes…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <label className="mgraph-panel__toggle-row">
                    Deck
                    <select
                      className="mgraph-panel__select"
                      value={deckParam}
                      onChange={(e) =>
                        setParams((p) => {
                          const n = new URLSearchParams(p);
                          if (e.target.value === ALL) n.delete("deck");
                          else n.set("deck", e.target.value);
                          return n;
                        })
                      }
                    >
                      {deckOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mgraph-panel__toggle-row">
                    Neighbours
                    <input
                      type="checkbox"
                      className="mgraph-panel__checkbox"
                      checked={showNeighbors}
                      onChange={(e) => setShowNeighbors(e.target.checked)}
                    />
                  </label>
                  <label className="mgraph-panel__toggle-row">
                    Orphans
                    <input
                      type="checkbox"
                      className="mgraph-panel__checkbox"
                      checked={isolated}
                      onChange={(e) => setIsolated(e.target.checked)}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* ── Groups ──────────────────────────────────────── */}
            <div className="mgraph-panel__section">
              <div className="mgraph-panel__section-head">
                <button
                  type="button"
                  className="mgraph-panel__section-toggle"
                  onClick={() => toggleSection("groups")}
                >
                  <span className="mgraph-panel__chevron">
                    {panelSections.groups ? "▾" : "▸"}
                  </span>
                  Groups
                </button>
              </div>
              {panelSections.groups && (
                <div className="mgraph-panel__section-body">
                  {groups.map((g, i) => (
                    <div key={g.id} className="mgraph-panel__group-row">
                      <input
                        type="text"
                        className="mgraph-panel__group-query"
                        placeholder="Enter query…"
                        value={g.query}
                        onChange={(e) =>
                          updateGroup(i, { query: e.target.value })
                        }
                      />
                      <input
                        type="color"
                        className="mgraph-panel__group-color"
                        value={g.color}
                        onChange={(e) =>
                          updateGroup(i, { color: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="mgraph-panel__icon-btn"
                        onClick={() => removeGroup(i)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="mgraph-panel__new-group-btn"
                    onClick={addGroup}
                  >
                    New group
                  </button>
                  <p className="mgraph-panel__hint">
                    Queries: <code>master</code> · <code>orphan</code> ·{" "}
                    <code>deck:name</code> · <code>tag:name</code> ·{" "}
                    <code>/regex/</code> · plain text
                  </p>
                </div>
              )}
            </div>

            {/* ── Display ─────────────────────────────────────── */}
            <div className="mgraph-panel__section">
              <div className="mgraph-panel__section-head">
                <button
                  type="button"
                  className="mgraph-panel__section-toggle"
                  onClick={() => toggleSection("display")}
                >
                  <span className="mgraph-panel__chevron">
                    {panelSections.display ? "▾" : "▸"}
                  </span>
                  Display
                </button>
              </div>
              {panelSections.display && (
                <div className="mgraph-panel__section-body">
                  <label className="mgraph-panel__toggle-row">
                    Arrows
                    <input
                      type="checkbox"
                      className="mgraph-panel__checkbox"
                      checked={showArrows}
                      onChange={(e) => setShowArrows(e.target.checked)}
                    />
                  </label>
                  <label className="mgraph-panel__slider-row">
                    <span>
                      Text fade threshold{" "}
                      <strong>{textFadeThreshold.toFixed(2)}</strong>
                    </span>
                    <input
                      type="range"
                      min={0.05}
                      max={2}
                      step={0.05}
                      value={textFadeThreshold}
                      onChange={(e) => setTextFadeThreshold(+e.target.value)}
                    />
                  </label>
                  <label className="mgraph-panel__slider-row">
                    <span>
                      Node size <strong>{nodeScale.toFixed(2)}</strong>
                    </span>
                    <input
                      type="range"
                      min={0.2}
                      max={3}
                      step={0.05}
                      value={nodeScale}
                      onChange={(e) => setNodeScale(+e.target.value)}
                    />
                  </label>
                  <label className="mgraph-panel__slider-row">
                    <span>
                      Link thickness <strong>{linkThickness.toFixed(2)}</strong>
                    </span>
                    <input
                      type="range"
                      min={0.5}
                      max={5}
                      step={0.1}
                      value={linkThickness}
                      onChange={(e) => setLinkThickness(+e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="mgraph-panel__animate-btn"
                    onClick={animate}
                  >
                    ✦ Animate
                  </button>
                </div>
              )}
            </div>

            {/* ── Forces ──────────────────────────────────────── */}
            <div className="mgraph-panel__section">
              <div className="mgraph-panel__section-head">
                <button
                  type="button"
                  className="mgraph-panel__section-toggle"
                  onClick={() => toggleSection("forces")}
                >
                  <span className="mgraph-panel__chevron">
                    {panelSections.forces ? "▾" : "▸"}
                  </span>
                  Forces
                </button>
              </div>
              {panelSections.forces && (
                <div className="mgraph-panel__section-body">
                  <label className="mgraph-panel__slider-row">
                    <span>
                      Center force <strong>{gravity}%</strong>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={0.5}
                      value={gravity}
                      onChange={(e) => setGravity(+e.target.value)}
                    />
                  </label>
                  <label className="mgraph-panel__slider-row">
                    <span>
                      Repel force <strong>{repulsion}</strong>
                    </span>
                    <input
                      type="range"
                      min={300}
                      max={8000}
                      step={100}
                      value={repulsion}
                      onChange={(e) => setRepulsion(+e.target.value)}
                    />
                  </label>
                  <label className="mgraph-panel__slider-row">
                    <span>
                      Link distance <strong>{linkDistance}</strong>
                    </span>
                    <input
                      type="range"
                      min={20}
                      max={300}
                      step={5}
                      value={linkDistance}
                      onChange={(e) => setLinkDistance(+e.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Node info panel — bottom-right overlay */}
        {sel && (
          <div className="mgraph-node-info">
            <div className="mgraph-node-info__head">
              <span className="mgraph-node-info__title">{sel.label}</span>
              <button
                type="button"
                className="mgraph-panel__icon-btn"
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>
            <div className="mgraph-node-info__badges">
              <span
                className={`mgraph-badge mgraph-badge--${sel.kind === "master" ? "primary" : "neutral"}`}
              >
                {sel.kind === "master" ? t("graph.master") : t("graph.card")}
              </span>
              {!sel.inScope && (
                <span className="mgraph-badge mgraph-badge--orange">
                  {t("graph.other-deck")}
                </span>
              )}
            </div>
            <div className="mgraph-node-info__actions">
              <button
                type="button"
                className="mgraph-node-info__btn mgraph-node-info__btn--primary"
                onClick={() => open(sel.id)}
              >
                {t("graph.open")}
              </button>
              <button
                type="button"
                className="mgraph-node-info__btn"
                onClick={() => setPicking(true)}
              >
                {t("graph.add-link")}
              </button>
            </div>
            {selEdges.length > 0 && (
              <ul className="mgraph-node-info__links">
                {selEdges.map((e) => {
                  const otherId = e.source === selected ? e.target : e.source;
                  const other = nodeById.get(otherId);
                  return (
                    <li key={e.id} className="mgraph-node-info__link-row">
                      <button
                        type="button"
                        className="mgraph-node-info__link-name"
                        onClick={() => setSelected(otherId)}
                      >
                        {other?.label ?? otherId}
                      </button>
                      <span className="mgraph-node-info__link-kind">
                        {e.kind === "entry"
                          ? t("graph.entry-link")
                          : t("graph.link")}
                      </span>
                      <button
                        type="button"
                        className="mgraph-node-info__link-remove"
                        onClick={() => void removeEdge(e)}
                      >
                        {t("graph.remove-link")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {sel.tags && sel.tags.length > 0 && (
              <div className="mgraph-node-info__tags">
                {sel.tags.map((tag) => (
                  <span
                    key={tag}
                    className="mgraph-badge mgraph-badge--neutral"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            {sel.sourceLinks && sel.sourceLinks.length > 0 && (
              <ul className="mgraph-node-info__sources">
                {sel.sourceLinks.map((link) => (
                  <li key={link}>
                    {link.startsWith("http") ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mgraph-node-info__source-link"
                      >
                        {link}
                      </a>
                    ) : (
                      <span className="mgraph-node-info__source-link">
                        {link}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {message && (
              <span className="mgraph-node-info__msg">{message}</span>
            )}
          </div>
        )}
      </div>

      {picking && sel && (
        <CardPickerModal
          opened
          onClose={() => setPicking(false)}
          deckId={sel.deck}
          defaultAllDecks
          title={t("graph.pick-title", { text: sel.label })}
          onPick={(id) => void addLink(id)}
        />
      )}
    </div>
  );
}
