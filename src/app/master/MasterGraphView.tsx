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
  type Graph,
  type GraphEdge,
  type Point,
  type View,
  buildGraph,
  fitView,
  forceLayout,
  panBy,
  zoomAt,
} from "@/logic/master/graph";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import CardPickerModal from "./CardPickerModal";
import "./MasterBuilder.css";

const W = 1000;
const H = 640;
const ALL = "all";

/**
 * Graph of masters, cards and the links between them: note-level links and master entry links.
 * Filter by deck, pan and zoom, select a node to open it or to add and remove links, also across
 * decks. Pure layout and graph building live in logic/master/graph.ts.
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
  const [neighbors, setNeighbors] = useState(true);
  const [selected, setSelected] = useState<string | null>(focus);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState("");

  const data = useLiveQuery(loadGraphData, []);
  const deckIds = useMemo(
    () =>
      deckParam === ALL || !decks ? null : descendantIds(deckParam, decks),
    [deckParam, decks]
  );
  const graph: Graph | undefined = useMemo(
    () =>
      data &&
      buildGraph(data.notes, data.cardToNote, {
        deckIds,
        includeNeighbors: neighbors,
        includeIsolated: isolated,
      }),
    [data, deckIds, neighbors, isolated]
  );

  // Layout only reruns when the set of nodes or edges changes; old positions seed the new one.
  const prev = useRef<Map<string, Point>>(new Map());
  const sig = graph
    ? `${graph.nodes.map((n) => n.id).join(",")}|${graph.edges.map((e) => e.id).join(",")}`
    : "";
  const pos = useMemo(() => {
    if (!graph) return new Map<string, Point>();
    const p = forceLayout(graph.nodes, graph.edges, { initial: prev.current });
    prev.current = p;
    return p;
  }, [sig]);

  const [view, setView] = useState<View>({ x: W / 2, y: H / 2, k: 1 });
  const fitted = useRef("");
  useEffect(() => {
    if (!graph || fitted.current === sig) return;
    fitted.current = sig;
    const focusPos = focus ? pos.get(focus) : undefined;
    if (focusPos)
      setView({
        k: 1.2,
        x: W / 2 - focusPos.x * 1.2,
        y: H / 2 - focusPos.y * 1.2,
      });
    else setView(fitView([...pos.values()], W, H));
  }, [sig, pos]);

  // ---- pan and zoom
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const toScreen = (e: { clientX: number; clientY: number }): Point => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - r.left) / r.width) * W,
      y: ((e.clientY - r.top) / r.height) * H,
    };
  };
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toScreen(e);
      setView((v) => zoomAt(v, p, e.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  const nodeById = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n] as const)),
    [graph]
  );
  const sel = selected ? nodeById.get(selected) : undefined;
  const around = useMemo(() => {
    const set = new Set<string>();
    if (!graph || !selected) return set;
    for (const e of graph.edges) {
      if (e.source === selected) set.add(e.target);
      if (e.target === selected) set.add(e.source);
    }
    return set;
  }, [graph, selected]);
  const selEdges = (graph?.edges ?? []).filter(
    (e) => e.source === selected || e.target === selected
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
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const deckOptions = [
    { value: ALL, label: t("graph.all-decks") },
    ...decksWithPaths(decks ?? []).map(({ deck, path }) => ({
      value: deck.id,
      label: path,
    })),
  ];
  const showLabels = view.k >= 0.55;

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
          checked={neighbors}
          onChange={(e) => setNeighbors(e.currentTarget.checked)}
          label={t("graph.neighbors")}
        />
        <Checkbox
          checked={isolated}
          onChange={(e) => setIsolated(e.currentTarget.checked)}
          label={t("graph.isolated")}
        />
        <Button
          size="sm"
          onClick={() => setView(fitView([...pos.values()], W, H))}
        >
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
        <svg
          ref={svg}
          className="master-graph__svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t("graph.title")}
          onPointerDown={(e) => {
            drag.current = { ...toScreen(e), moved: false };
            (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const p = toScreen(e);
            const dx = p.x - d.x;
            const dy = p.y - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
            drag.current = { ...p, moved: d.moved };
            setView((v) => panBy(v, dx, dy));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {graph?.edges.map((e) => {
              const a = pos.get(e.source);
              const b = pos.get(e.target);
              if (!a || !b) return null;
              const hot = e.source === selected || e.target === selected;
              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={`master-graph__edge${e.kind === "entry" ? " master-graph__edge--entry" : ""}${hot ? " master-graph__edge--hot" : ""}`}
                />
              );
            })}
            {graph?.nodes.map((n) => {
              const p = pos.get(n.id);
              if (!p) return null;
              const isSel = n.id === selected;
              const r = n.kind === "master" ? 11 : 6 + Math.min(n.degree, 6);
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x} ${p.y})`}
                  className={`master-graph__node master-graph__node--${n.kind}${isSel ? " is-selected" : ""}${n.inScope ? "" : " is-outside"}${selected && !isSel && !around.has(n.id) ? " is-dim" : ""}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setSelected(n.id)}
                  onDoubleClick={() => open(n.id)}
                  onKeyDown={(e) => e.key === "Enter" && open(n.id)}
                  tabIndex={0}
                  // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a button element
                  role="button"
                  aria-label={n.label}
                >
                  <circle r={r} />
                  {(showLabels || isSel || n.kind === "master") && (
                    <text y={r + 12} textAnchor="middle">
                      {n.label.length > 28
                        ? `${n.label.slice(0, 27)}…`
                        : n.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <aside className="master-graph__panel">
          {!graph && <Text variant="dimmed">{t("masterBuilder.loading")}</Text>}
          {graph && graph.nodes.length === 0 && (
            <Text variant="dimmed">{t("graph.empty")}</Text>
          )}
          {graph && graph.truncated > 0 && (
            <Text size="sm" variant="dimmed">
              {t("graph.truncated", { count: graph.truncated })}
            </Text>
          )}
          {graph && (
            <Text size="sm" variant="dimmed">
              {t("graph.counts", {
                nodes: graph.nodes.length,
                edges: graph.edges.length,
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
          {!sel && graph && graph.nodes.length > 0 && (
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
