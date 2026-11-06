import { AppHeaderContent } from "@/app/shell/Header/Header";
import { AppBreadcrumbs } from "@/components/AppBreadcrumbs";
import { InfoTip } from "@/components/InfoTip/InfoTip";
import NotFound from "@/components/NotFound";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Text } from "@/components/ui/Text";
import { TextInput } from "@/components/ui/TextInput";
import { useDocumentTitle } from "@/lib/hooks/useDocumentTitle";
import { db } from "@/logic/db";
import type { Deck } from "@/logic/deck/deck";
import { weakDrillParam } from "@/logic/master/activities";
import {
  cardTexts,
  getMasterNote,
  orphanCardInfos,
  unsuspendCards,
} from "@/logic/master/builderData";
import {
  addEntry,
  addOrphanEntries,
  fixDangling,
  fixSameCardDuplicates,
  fixSimilarDuplicates,
  linkEntries,
  moveEntry,
  moveEntryBy,
  moveSection,
  patchEntry,
  removeEntries,
  removeSections,
} from "@/logic/master/builderOps";
import { coverageOfMaster } from "@/logic/master/masterCards";
import {
  MASTER_MAX_ENTRIES,
  MASTER_STATUSES,
  type MasterSection,
  type MasterStatus,
  cleanMaster,
  countEntries,
  newMasterSection,
  validateMaster,
} from "@/logic/master/masterModel";
import {
  deckLevelName,
  effectiveHierarchy,
  entryName,
  sectionLevelName,
} from "@/logic/settings/hierarchy";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { MasterTypeAdapter } from "@/logic/type-implementations/master/MasterNote";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SectionBlock, type SectionHandlers } from "./BuilderRows";
import BulkLinkModal from "./BulkLinkModal";
import CardPickerModal from "./CardPickerModal";
import CoveragePanel from "./CoveragePanel";
import GapHuntModal from "./GapHuntModal";
import RecallSweepModal from "./RecallSweepModal";
import "./MasterBuilder.css";

const SAVE_DELAY = 700;
type Activity = "sweep" | "gap" | null;

export default function MasterBuilderView() {
  const noteId = useParams().noteId ?? "";
  const loaded = useLiveQuery(
    async () => (await getMasterNote(noteId)) ?? null,
    [noteId],
    undefined
  );
  if (loaded === undefined) return null;
  if (loaded === null) return <NotFound />;
  return <Builder key={noteId} noteId={noteId} />;
}

function Builder({ noteId }: { noteId: string }) {
  const [t] = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [hierarchy] = useSetting("#hierarchy");
  const levels = effectiveHierarchy(hierarchy).levels;
  const entryNoun = entryName(levels);
  const sectionNoun = sectionLevelName(levels, 0);

  // Local copy being edited; the note in Dexie is rewritten from it (debounced).
  const [title, setTitle] = useState<string | null>(null);
  const [status, setStatus] = useState<MasterStatus>("active");
  const [sections, setSections] = useState<MasterSection[]>([]);
  const dirty = useRef(false);
  const noteRef = useRef<Awaited<ReturnType<typeof getMasterNote>>>(undefined);
  const latest = useRef({ title: "", status, sections });
  const [saved, setSaved] = useState<"saved" | "pending">("saved");

  useEffect(() => {
    void getMasterNote(noteId).then((n) => {
      if (!n) return;
      noteRef.current = n;
      setTitle(n.content.title);
      setStatus(n.content.status ?? "active");
      setSections(n.content.sections);
      void db.decks.get(n.deck).then(setDeck);
    });
  }, [noteId]);

  const [deck, setDeck] = useState<Deck | undefined>(undefined);
  const superDecks = useLiveQuery(
    async () =>
      deck?.superDecks?.length
        ? (await db.decks.bulkGet(deck.superDecks)).flatMap((d) =>
            d ? [d] : []
          )
        : [],
    [deck?.id],
    []
  );

  const problem = useMemo(
    () =>
      title === null
        ? null
        : validateMaster(cleanMaster({ title, status, sections })),
    [title, status, sections]
  );

  latest.current = { title: title ?? "", status, sections };
  const flush = useCallback(async () => {
    const note = noteRef.current;
    if (!note || !dirty.current) return;
    dirty.current = false;
    const c = latest.current;
    await MasterTypeAdapter.updateNote(
      { title: c.title, status: c.status, sections: c.sections },
      note
    );
    setSaved("saved");
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    setSaved("pending");
    const id = window.setTimeout(() => void flush(), SAVE_DELAY);
    return () => window.clearTimeout(id);
  }, [title, status, sections, flush]);
  // Leaving the page saves what is pending.
  useEffect(() => () => void flush(), [flush]);

  const edit = useCallback((fn: (s: MasterSection[]) => MasterSection[]) => {
    dirty.current = true;
    setSections(fn);
  }, []);

  // ---- card labels (one bulk read, reused while the linked ids stay the same)
  const linkedKey = sections
    .flatMap((s) => s.entries.map((e) => e.cardId ?? ""))
    .filter(Boolean)
    .join(",");
  const labelsRaw = useLiveQuery(
    async () => {
      const ids = linkedKey ? linkedKey.split(",") : [];
      const found = await cardTexts(ids);
      return new Map<string, string | null>(
        ids.map((id) => [id, found.get(id)?.text ?? null])
      );
    },
    [linkedKey],
    undefined
  );
  const labelsRef = useRef<Map<string, string | null>>(new Map());
  const cardLabels = useMemo(() => {
    if (!labelsRaw) return labelsRef.current;
    const prev = labelsRef.current;
    const same =
      prev.size === labelsRaw.size &&
      [...labelsRaw].every(([k, v]) => prev.get(k) === v);
    if (!same) labelsRef.current = labelsRaw;
    return labelsRef.current;
  }, [labelsRaw]);

  // ---- coverage (debounced: similar-text detection is quadratic)
  const [covSections, setCovSections] = useState(sections);
  useEffect(() => {
    const id = window.setTimeout(() => setCovSections(sections), 600);
    return () => window.clearTimeout(id);
  }, [sections]);
  const report = useLiveQuery(
    () => (deck ? coverageOfMaster(deck.id, covSections) : undefined),
    [deck?.id, covSections]
  );
  const orphanSet = useMemo(() => new Set(report?.orphanCards ?? []), [report]);

  // ---- selection, collapse, drag
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const dragId = useRef<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const activity: Activity =
    params.get("do") === "sweep"
      ? "sweep"
      : params.get("do") === "gap"
        ? "gap"
        : null;
  const setActivity = (a: Activity) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (a) n.set("do", a);
        else n.delete("do");
        return n;
      },
      { replace: true }
    );

  const handlers: SectionHandlers = useMemo(
    () => ({
      onText: (id, text) => edit((s) => patchEntry(s, id, { text })),
      onMove: (id, d) => edit((s) => moveEntryBy(s, id, d)),
      onRemove: (id) => edit((s) => removeEntries(s, [id])),
      onPickCard: (id) => setPicking(id),
      onUnlink: (id) => edit((s) => patchEntry(s, id, { clearCard: true })),
      onToggle: (id) =>
        setSelected((cur) => {
          const n = new Set(cur);
          n.has(id) ? n.delete(id) : n.add(id);
          return n;
        }),
      onDragStart: (id) => {
        dragId.current = id;
      },
      onDropOnEntry: (target) => {
        const id = dragId.current;
        dragId.current = null;
        if (!id || id === target) return;
        edit((s) => {
          const sec = s.find((x) => x.entries.some((e) => e.id === target));
          if (!sec) return s;
          return moveEntry(
            s,
            id,
            sec.id,
            sec.entries.findIndex((e) => e.id === target)
          );
        });
      },
      onDropOnSection: (sectionId) => {
        const id = dragId.current;
        dragId.current = null;
        if (id)
          edit((s) =>
            moveEntry(
              s,
              id,
              sectionId,
              s.find((x) => x.id === sectionId)?.entries.length ?? 0
            )
          );
      },
      onSectionTitle: (id, ttl) =>
        edit((s) => s.map((x) => (x.id === id ? { ...x, title: ttl } : x))),
      onSectionMove: (id, d) => edit((s) => moveSection(s, id, d)),
      onSectionRemove: (id) => edit((s) => removeSections(s, [id])),
      onAddEntry: (id) => edit((s) => addEntry(s, id).sections),
      onToggleCollapsed: (id) =>
        setCollapsed((cur) => {
          const n = new Set(cur);
          n.has(id) ? n.delete(id) : n.add(id);
          return n;
        }),
    }),
    [edit]
  );

  const total = countEntries(sections);

  const addSection = () => {
    edit((s) => [...s, newMasterSection("")]);
  };

  const [moveTarget, setMoveTarget] = useState("");
  const moveSelected = () => {
    if (!moveTarget || selected.size === 0) return;
    edit((s) => {
      let cur = s;
      for (const id of [...selected]) {
        const sec = cur.find((x) => x.id === moveTarget);
        cur = moveEntry(cur, id, moveTarget, sec?.entries.length ?? 0);
      }
      return cur;
    });
    setSelected(new Set());
  };

  const addOrphans = async (groupByTags: boolean) => {
    if (!report) return;
    const infos = await orphanCardInfos(report.orphanCards);
    edit((s) => addOrphanEntries(s, infos, { groupByTags }).sections);
  };
  const addOneOrphan = async (cardId: string) => {
    const infos = await orphanCardInfos([cardId]);
    edit((s) => addOrphanEntries(s, infos, {}).sections);
  };

  const pickingEntry = picking
    ? sections.flatMap((s) => s.entries).find((e) => e.id === picking)
    : undefined;

  useDocumentTitle(`${title || t("masterBuilder.title")} | Skola`);
  if (title === null || !deck) return null;

  const stats = report?.stats;
  return (
    <div className="master-builder" data-testid="master-builder">
      <AppHeaderContent>
        <AppBreadcrumbs
          segments={[
            ...(superDecks ?? []).map((d) => ({
              label: d.name,
              path: `/deck/${d.id}`,
            })),
            { label: deck.name, path: `/deck/${deck.id}` },
            { label: title || t("masterBuilder.title") },
          ]}
        />
      </AppHeaderContent>

      <div className="master-builder__bar">
        <div className="master-builder__title">
          <TextInput
            label={
              <>
                {t("masterBuilder.name")}
                <InfoTip>{t("masterBuilder.name-tip")}</InfoTip>
              </>
            }
            value={title}
            onChange={(e) => {
              dirty.current = true;
              setTitle(e.currentTarget.value);
            }}
          />
          <Select<MasterStatus>
            label={
              <>
                {t("masterBuilder.status")}
                <InfoTip>{t("masterBuilder.status-tip")}</InfoTip>
              </>
            }
            value={status}
            onChange={(v) => {
              dirty.current = true;
              setStatus(v);
            }}
            options={MASTER_STATUSES.map((s) => ({
              value: s,
              label: t(`masterBuilder.status-${s}`),
            }))}
          />
        </div>
        <div className="master-builder__levels">
          {[...(superDecks ?? []), deck].map((d, i) => (
            <Badge key={d.id} color="neutral" variant="outline">
              {deckLevelName(levels, i)}: {d.name}
            </Badge>
          ))}
          <Badge color="primary" variant="outline">
            {sectionNoun}: {sections.length}
          </Badge>
          <Badge color="primary" variant="outline">
            {entryNoun}: {total}
          </Badge>
          <InfoTip>{t("masterBuilder.levels-tip")}</InfoTip>
        </div>
        <Text size="sm" variant="dimmed" className="master-builder__save">
          {problem
            ? t("masterBuilder.not-saved", { problem })
            : saved === "pending"
              ? t("masterBuilder.saving")
              : t("masterBuilder.saved")}
        </Text>
      </div>

      <div className="master-builder__tools">
        <Button size="sm" onClick={addSection}>
          {t("masterBuilder.add-section", { noun: sectionNoun.toLowerCase() })}
        </Button>
        <Button
          size="sm"
          onClick={() => setBulkOpen(true)}
          disabled={!report?.unlinkedEntries.length}
        >
          {t("masterBuilder.bulk-link")}
        </Button>
        <Button size="sm" onClick={() => setActivity("sweep")}>
          {t("masterBuilder.recall-sweep")}
        </Button>
        <Button size="sm" onClick={() => setActivity("gap")}>
          {t("masterBuilder.gap-hunt")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void flush();
            navigate(`/learn/${deck.id}/${weakDrillParam(noteId)}`);
          }}
        >
          {t("masterBuilder.weak-drill")}
        </Button>
        <InfoTip>{t("masterBuilder.activities-tip")}</InfoTip>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate(`/graph?focus=${noteId}`)}
        >
          {t("masterBuilder.open-graph")}
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="master-builder__selection" role="toolbar">
          <Text size="sm">
            {t("masterBuilder.selected", { count: selected.size })}
          </Text>
          <Select
            value={moveTarget}
            onChange={setMoveTarget}
            options={[
              { value: "", label: t("masterBuilder.move-to") },
              ...sections.map((s) => ({
                value: s.id,
                label: s.title || sectionNoun,
              })),
            ]}
          />
          <Button size="sm" onClick={moveSelected} disabled={!moveTarget}>
            {t("masterBuilder.move")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              edit((s) => removeEntries(s, selected));
              setSelected(new Set());
            }}
          >
            {t("masterBuilder.delete-selected")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Set())}
          >
            {t("masterBuilder.clear-selection")}
          </Button>
        </div>
      )}

      <div className="master-builder__layout">
        <div className="master-builder__main">
          {sections.map((s, i) => (
            <SectionBlock
              key={s.id}
              section={s}
              index={i}
              count={sections.length}
              handlers={handlers}
              selected={selected}
              cardLabels={cardLabels}
              collapsed={collapsed.has(s.id)}
              sectionNoun={sectionNoun}
              entryNoun={entryNoun}
            />
          ))}
          {sections.length === 0 && (
            <Text variant="dimmed">{t("masterBuilder.empty")}</Text>
          )}
          {total >= MASTER_MAX_ENTRIES && (
            <Text size="sm" variant="dimmed">
              {t("masterBuilder.limit", { max: MASTER_MAX_ENTRIES })}
            </Text>
          )}
        </div>
        <aside className="master-builder__side">
          <CoveragePanel
            report={report}
            stats={stats}
            noteId={noteId}
            deckId={deck.id}
            onAddOrphans={addOrphans}
            onAddOrphan={addOneOrphan}
            onFixDangling={() => report && edit((s) => fixDangling(s, report))}
            onRemoveEmpty={() =>
              report && edit((s) => removeSections(s, report.emptySections))
            }
            onLinkUnlinked={() => setBulkOpen(true)}
            onUnsuspend={async () => {
              if (!report) return;
              await unsuspendCards(
                report.staleEntries
                  .filter((e) => e.reasons.includes("suspended"))
                  .map((e) => e.cardId)
              );
            }}
            onDrill={() => {
              void flush();
              navigate(`/learn/${deck.id}/${weakDrillParam(noteId)}`);
            }}
            onFixSameCard={() =>
              report && edit((s) => fixSameCardDuplicates(s, report.duplicates))
            }
            onFixSimilar={() =>
              report && edit((s) => fixSimilarDuplicates(s, report.duplicates))
            }
          />
        </aside>
      </div>

      {picking && (
        <CardPickerModal
          opened
          onClose={() => setPicking(null)}
          deckId={deck.id}
          orphanIds={orphanSet}
          title={t("masterBuilder.picker-title", {
            text: pickingEntry?.text || entryNoun,
          })}
          onPick={(cardId) => edit((s) => patchEntry(s, picking, { cardId }))}
        />
      )}
      {bulkOpen && (
        <BulkLinkModal
          opened
          onClose={() => setBulkOpen(false)}
          deckId={deck.id}
          sections={sections}
          orphanIds={orphanSet}
          onLink={(pairs) => edit((s) => linkEntries(s, pairs))}
        />
      )}
      {activity === "sweep" && (
        <RecallSweepModal
          opened
          onClose={() => setActivity(null)}
          sections={sections}
          sectionNoun={sectionNoun}
          entryNoun={entryNoun}
        />
      )}
      {activity === "gap" && report && (
        <GapHuntModal
          opened
          onClose={() => setActivity(null)}
          report={report}
          sections={sections}
          cardLabels={cardLabels}
          deckId={deck.id}
          edit={edit}
        />
      )}
    </div>
  );
}
