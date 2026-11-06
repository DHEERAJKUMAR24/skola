import { AppHeaderContent } from "@/app/shell/Header/Header";
import { AppBreadcrumbs } from "@/components/AppBreadcrumbs";
import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select } from "@/components/ui/Select";
import { Text } from "@/components/ui/Text";
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
  buildGraph,
} from "@/logic/master/graph";
import { useLiveQuery } from "dexie-react-hooks";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import Sigma from "sigma";
import CardPickerModal from "./CardPickerModal";
import "./MasterBuilder.css";

const ALL = "all";

// Node colours — same palette as the previous SVG renderer.
const COLOR_MASTER = "#16a34a";
const COLOR_NOTE = "#2563eb";
// Edge colours by kind (sigma WebGL doesn't support dashed lines natively).
const COLOR_EDGE_LINK = "#6b728055";
const COLOR_EDGE_ENTRY = "#7c3aed55";

// ForceAtlas2 parameters: good defaults for 50–500 nodes.
const FA2_SETTINGS = {
  gravity: 1,
  scalingRatio: 10,
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  slowDown: 5,
};
const FA2_ITERS_INIT = 100; // synchronous burst on first build (avoid all-at-origin)
const FA2_ITERS_PER_FRAME = 5;
const FA2_MAX_FRAMES = 120; // ~2 s at 60 fps then physics stops

/**
 * Graph of masters, notes and the links between them, rendered with Sigma.js (WebGL)
 * and laid out by ForceAtlas2 via graphology-layout-forceatlas2 (ADR 0014).
 * Pure graph building lives in logic/master/graph.ts; Dexie I/O in builderData.ts.
 */
export default function MasterGraphView() {
  const [t] = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  useDocumentTitle(`${t("graph.title")} | Skola`);

  const [decks] = useDecks();
  const deckParam = params.get("deck") ?? ALL;
  const focus = params.get("focus");

  const [isolated, setIsolated] = useState(false);
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [selected, setSelected] = useState<string | null>(focus);
  // Hover is tracked only in hoveredRef (sigma handles it); no React state needed.
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState("");
  // Screen-space position of the selected node, used for the CSS pulsing ring.
  const [ringPos, setRingPos] = useState<{ x: number; y: number } | null>(null);

  // Sigma + graphology live in refs — React doesn't own the renderer lifecycle.
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const gRef = useRef<Graph | null>(null);
  const rafRef = useRef(0);

  // Refs that are readable inside sigma callbacks without stale closure issues.
  const selectedRef = useRef<string | null>(selected);
  const hoveredRef = useRef<string | null>(null);
  const neighborsRef = useRef<Set<string>>(new Set());

  // Keep selected ref in sync with React state.
  useEffect(() => {
    selectedRef.current = selected;
    sigmaRef.current?.scheduleRefresh();
    // Update ring position immediately on selection change.
    if (!selected || !sigmaRef.current || !gRef.current?.hasNode(selected)) {
      setRingPos(null);
      return;
    }
    const { x, y } = gRef.current.getNodeAttributes(selected);
    setRingPos(sigmaRef.current.graphToViewport({ x, y }));
  }, [selected]);

  // ----- Data pipeline -----

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

  // ----- Build / rebuild sigma whenever the logical graph changes -----

  useEffect(() => {
    if (!containerRef.current || !appGraph) return;

    // Tear down previous instance.
    cancelAnimationFrame(rafRef.current);
    sigmaRef.current?.kill();
    setRingPos(null);

    // Build the graphology graph that sigma renders.
    const g = new Graph({ type: "undirected", multi: false });
    gRef.current = g;

    // Initialise positions on a golden-angle spiral so nodes aren't all at (0,0).
    const K = 70;
    for (let i = 0; i < appGraph.nodes.length; i++) {
      const n = appGraph.nodes[i];
      const r = K * Math.sqrt(i + 1) * 0.6;
      const a = i * 2.399963;
      const size = n.kind === "master" ? 12 : 5 + Math.min(n.degree * 0.9, 5);
      g.addNode(n.id, {
        x: r * Math.cos(a),
        y: r * Math.sin(a),
        size,
        color: n.kind === "master" ? COLOR_MASTER : COLOR_NOTE,
        label: n.label,
        kind: n.kind,
        inScope: n.inScope,
        deck: n.deck,
      });
    }

    for (const edge of appGraph.edges) {
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
      try {
        g.addEdgeWithKey(edge.id, edge.source, edge.target, {
          size: edge.kind === "entry" ? 2 : 1.5,
          color: edge.kind === "entry" ? COLOR_EDGE_ENTRY : COLOR_EDGE_LINK,
          kind: edge.kind,
        });
      } catch {
        // duplicate key (should not happen with deduplicated buildGraph output)
      }
    }

    // Run an initial synchronous ForceAtlas2 burst so the first frame isn't
    // all-nodes-piled-at-the-origin.
    if (g.order > 1) {
      forceAtlas2.assign(g, {
        iterations: FA2_ITERS_INIT,
        settings: FA2_SETTINGS,
      });
    }

    // Create sigma renderer.
    const renderer = new Sigma(g, containerRef.current, {
      settings: {
        renderEdgeLabels: false,
        enableNodeDrag: true,
        // Keep all nodes in view while ForceAtlas2 is running.
        autoRescale: true,
      },
      nodeReducer: (node, data) => {
        const sel = selectedRef.current;
        const hov = hoveredRef.current;
        const nbrs = neighborsRef.current;

        // Dim nodes that are not selected / neighbours / hovered.
        if (
          (sel && node !== sel && !nbrs.has(node)) ||
          (!sel && hov && node !== hov && !nbrs.has(node))
        ) {
          return { ...data, color: `${data.color.slice(0, 7)}1f` };
        }
        return data;
      },
      edgeReducer: (edge, data) => {
        const sel = selectedRef.current;
        const hov = hoveredRef.current;
        if (!sel && !hov) return data;
        const src = g.source(edge);
        const tgt = g.target(edge);
        const hot = src === sel || tgt === sel || src === hov || tgt === hov;
        if (!hot) return { ...data, color: `${data.color.slice(0, 9)}18` };
        return {
          ...data,
          size: data.size * 1.6,
          color: `${data.color.slice(0, 7)}cc`,
        };
      },
    });
    sigmaRef.current = renderer;

    // Helpers.
    const updateNeighbors = (nodeId: string | null) => {
      const s = new Set<string>();
      if (nodeId && g.hasNode(nodeId)) {
        g.forEachNeighbor(nodeId, (n) => s.add(n));
      }
      neighborsRef.current = s;
    };

    // --- Sigma events ---

    renderer.on("clickNode", ({ node }) => {
      const isSel = selectedRef.current === node;
      const next = isSel ? null : node;
      selectedRef.current = next;
      setSelected(next);
      updateNeighbors(next);
      renderer.scheduleRefresh();
    });

    renderer.on("clickStage", () => {
      selectedRef.current = null;
      setSelected(null);
      neighborsRef.current = new Set();
      renderer.scheduleRefresh();
    });

    renderer.on("enterNode", ({ node }) => {
      hoveredRef.current = node;
      if (!selectedRef.current) updateNeighbors(node);
      renderer.scheduleRefresh();
    });

    renderer.on("leaveNode", ({ node }) => {
      if (hoveredRef.current === node) {
        hoveredRef.current = null;
        if (!selectedRef.current) neighborsRef.current = new Set();
        renderer.scheduleRefresh();
      }
    });

    renderer.on("doubleClickNode", ({ node }) => {
      if (!g.hasNode(node)) return;
      const attrs = g.getNodeAttributes(node);
      if (attrs.kind === "master") navigate(`/master/${node}`);
      else navigate(`/notes?deck=${attrs.deck}&note=${node}`);
    });

    // Stop FA2 as soon as the user starts dragging a node so the dragged
    // position isn't overwritten by the next animation frame.
    renderer.on("downNode", () => {
      cancelAnimationFrame(rafRef.current);
      renderer.setSetting("autoRescale", false);
    });

    // Update the pulsing-ring position after every render frame.
    renderer.on("afterRender", () => {
      const sel = selectedRef.current;
      if (sel && g.hasNode(sel)) {
        const { x, y } = g.getNodeAttributes(sel);
        setRingPos(renderer.graphToViewport({ x, y }));
      } else {
        setRingPos(null);
      }
    });

    // --- Animate ForceAtlas2 ---
    if (g.order > 1) {
      let frames = 0;
      const step = () => {
        if (frames++ >= FA2_MAX_FRAMES) {
          // Physics settled — stop auto-rescale so the user can pan freely.
          renderer.setSetting("autoRescale", false);
          return;
        }
        forceAtlas2.assign(g, {
          iterations: FA2_ITERS_PER_FRAME,
          settings: FA2_SETTINGS,
        });
        renderer.scheduleRefresh();
        rafRef.current = requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    } else {
      renderer.setSetting("autoRescale", false);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      renderer.kill();
    };
    // navigate is stable from react-router; appGraph identity changes on each
    // logical graph change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appGraph]);

  // ----- Panel helpers -----

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

  const fitView = () => {
    if (!sigmaRef.current) return;
    // "once" unfreezes autoRescaleFrozen → next refresh re-fits → re-freezes.
    sigmaRef.current.setSetting("autoRescale", "once");
    sigmaRef.current.refresh();
  };

  const deckOptions = [
    { value: ALL, label: t("graph.all-decks") },
    ...decksWithPaths(decks ?? []).map(({ deck, path }) => ({
      value: deck.id,
      label: path,
    })),
  ];

  return (
    <div className="master-graph" data-testid="master-graph">
      <AppHeaderContent>
        <AppBreadcrumbs segments={[{ label: t("graph.title") }]} />
      </AppHeaderContent>

      <div className="master-graph__bar">
        <Select
          label={
            <>
              {t("graph.deck")}
              <InfoTip>{t("graph.deck-tip")}</InfoTip>
            </>
          }
          value={deckParam}
          onChange={(v) =>
            setParams((p) => {
              const n = new URLSearchParams(p);
              if (v === ALL) n.delete("deck");
              else n.set("deck", v);
              return n;
            })
          }
          options={deckOptions}
        />
        <Checkbox
          checked={showNeighbors}
          onChange={(e) => setShowNeighbors(e.currentTarget.checked)}
          label={t("graph.neighbors")}
        />
        <Checkbox
          checked={isolated}
          onChange={(e) => setIsolated(e.currentTarget.checked)}
          label={t("graph.isolated")}
        />
        <Button size="sm" onClick={fitView}>
          {t("graph.fit")}
        </Button>
        <span className="master-graph__legend">
          <i className="master-graph__dot master-graph__dot--master" />{" "}
          {t("graph.master")}
          <i className="master-graph__dot" /> {t("graph.card")}
          <i className="master-graph__line" /> {t("graph.link")}
          <i className="master-graph__line master-graph__line--entry" />{" "}
          {t("graph.entry-link")}
          <InfoTip>{t("graph.legend-tip")}</InfoTip>
        </span>
      </div>

      <div className="master-graph__body">
        {/* Sigma canvas + visual overlays */}
        <div className="master-graph__canvas-wrap">
          <div ref={containerRef} className="master-graph__canvas" />
          {/* Dot-grid + vignette (pointer-events: none so sigma receives mouse) */}
          <div className="master-graph__overlay" aria-hidden="true" />
          {/* Pulsing ring on the selected node */}
          {ringPos && selected && (
            <div
              className="master-graph__ring"
              style={{ left: ringPos.x, top: ringPos.y }}
              aria-hidden="true"
            />
          )}
        </div>

        <aside className="master-graph__panel">
          {!appGraph && (
            <Text variant="dimmed">{t("masterBuilder.loading")}</Text>
          )}
          {appGraph && appGraph.nodes.length === 0 && (
            <Text variant="dimmed">{t("graph.empty")}</Text>
          )}
          {appGraph && appGraph.truncated > 0 && (
            <Text size="sm" variant="dimmed">
              {t("graph.truncated", { count: appGraph.truncated })}
            </Text>
          )}
          {appGraph && (
            <Text size="sm" variant="dimmed">
              {t("graph.counts", {
                nodes: appGraph.nodes.length,
                edges: appGraph.edges.length,
              })}
            </Text>
          )}
          {sel && (
            <div className="master-graph__sel">
              <Text weight="semibold">{sel.label}</Text>
              <div className="master-graph__sel-badges">
                <Badge
                  color={sel.kind === "master" ? "primary" : "neutral"}
                  size="sm"
                >
                  {sel.kind === "master" ? t("graph.master") : t("graph.card")}
                </Badge>
                {!sel.inScope && (
                  <Badge color="orange" size="sm">
                    {t("graph.other-deck")}
                  </Badge>
                )}
              </div>
              <div className="master-graph__sel-actions">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => open(sel.id)}
                >
                  {t("graph.open")}
                </Button>
                <Button size="sm" onClick={() => setPicking(true)}>
                  {t("graph.add-link")}
                </Button>
              </div>
              <ul className="master-graph__links">
                {selEdges.map((e) => {
                  const otherId = e.source === selected ? e.target : e.source;
                  const other = nodeById.get(otherId);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        className="master-graph__link-name"
                        onClick={() => setSelected(otherId)}
                      >
                        {other?.label ?? otherId}
                      </button>
                      <Text size="xs" variant="dimmed">
                        {e.kind === "entry"
                          ? t("graph.entry-link")
                          : t("graph.link")}
                      </Text>
                      <Button
                        size="xs"
                        variant="destructive"
                        onClick={() => void removeEdge(e)}
                      >
                        {t("graph.remove-link")}
                      </Button>
                    </li>
                  );
                })}
                {selEdges.length === 0 && (
                  <Text size="sm" variant="dimmed">
                    {t("graph.no-links")}
                  </Text>
                )}
              </ul>
            </div>
          )}
          {!sel && appGraph && appGraph.nodes.length > 0 && (
            <Text size="sm" variant="dimmed">
              {t("graph.hint")}
            </Text>
          )}
          {message && (
            <Text size="sm" variant="primary">
              {message}
            </Text>
          )}
        </aside>
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
