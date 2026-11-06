import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import {
  type GapItem,
  type GapKind,
  buildGapChecklist,
} from "@/logic/master/activities";
import { cardTexts, unsuspendCards } from "@/logic/master/builderData";
import {
  addOrphanEntries,
  fixDangling,
  patchEntry,
  removeEntries,
  removeSections,
} from "@/logic/master/builderOps";
import type { CoverageReport } from "@/logic/master/coverage";
import type { MasterSection } from "@/logic/master/masterModel";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import CardPickerModal from "./CardPickerModal";

interface Props {
  opened: boolean;
  onClose: () => void;
  report: CoverageReport;
  sections: MasterSection[];
  cardLabels: Map<string, string | null>;
  deckId: string;
  edit: (fn: (s: MasterSection[]) => MasterSection[]) => void;
}

/**
 * The coverage report as a checklist: go through every gap, fix it or tick it as seen. Fixed
 * gaps leave the list on their own once the coverage is recomputed.
 */
export default function GapHuntModal({
  opened,
  onClose,
  report,
  sections,
  cardLabels,
  deckId,
  edit,
}: Props) {
  const [t] = useTranslation();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [pickFor, setPickFor] = useState<string | null>(null);
  const orphanKey = report.orphanCards.join(",");
  const orphanTexts = useLiveQuery(
    () => cardTexts(orphanKey ? orphanKey.split(",") : []),
    [orphanKey]
  );

  const entryById = useMemo(
    () =>
      new Map(
        sections.flatMap((s) => s.entries.map((e) => [e.id, e] as const))
      ),
    [sections]
  );
  const sectionById = useMemo(
    () => new Map(sections.map((s) => [s.id, s] as const)),
    [sections]
  );
  const items = useMemo(
    () =>
      buildGapChecklist(report, {
        card: (id) =>
          orphanTexts?.get(id)?.text ?? cardLabels.get(id) ?? id.slice(0, 8),
        entry: (id) => entryById.get(id)?.text || t("masterBuilder.untitled"),
        section: (id) =>
          sectionById.get(id)?.title || t("masterBuilder.untitled"),
      }),
    [report, orphanTexts, cardLabels, entryById, sectionById, t]
  );
  const open = items.filter((i) => !ticked.has(i.id));

  const fix = async (item: GapItem) => {
    switch (item.kind) {
      case "orphan": {
        const text = orphanTexts?.get(item.cardId ?? "")?.text ?? "";
        edit(
          (s) =>
            addOrphanEntries(s, [{ cardId: item.cardId ?? "", text }], {})
              .sections
        );
        break;
      }
      case "dangling":
        edit((s) =>
          fixDangling(s, {
            danglingEntries: [
              {
                sectionId: item.sectionId ?? "",
                entryId: item.entryIds[0],
                cardId: item.cardId ?? "",
              },
            ],
          })
        );
        break;
      case "empty":
        edit((s) => removeSections(s, [item.sectionId ?? ""]));
        break;
      case "unlinked":
        setPickFor(item.entryIds[0]);
        break;
      case "stale":
        if (item.cardId) await unsuspendCards([item.cardId]);
        break;
      case "duplicateCard":
      case "duplicateText":
        edit((s) => removeEntries(s, item.entryIds.slice(1)));
        break;
    }
  };

  const FIX_LABEL: Record<GapKind, string | null> = {
    orphan: t("masterBuilder.gap-fix-orphan"),
    dangling: t("masterBuilder.gap-fix-dangling"),
    empty: t("masterBuilder.gap-fix-empty"),
    unlinked: t("masterBuilder.gap-fix-unlinked"),
    stale: t("masterBuilder.unsuspend"),
    duplicateCard: t("masterBuilder.keep-first"),
    duplicateText: t("masterBuilder.keep-first"),
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <>
          {t("masterBuilder.gap-hunt")}
          <InfoTip>{t("masterBuilder.gap-tip")}</InfoTip>
        </>
      }
    >
      <Stack gap="md">
        <Text size="sm">
          {items.length === 0
            ? t("masterBuilder.gap-clear")
            : t("masterBuilder.gap-progress", {
                open: open.length,
                total: items.length,
              })}
        </Text>
        <ul className="master-gap">
          {items.map((i) => (
            <li
              key={i.id}
              className="master-gap__item"
              data-done={ticked.has(i.id) || undefined}
            >
              <Checkbox
                checked={ticked.has(i.id)}
                onChange={() =>
                  setTicked((cur) => {
                    const n = new Set(cur);
                    n.has(i.id) ? n.delete(i.id) : n.add(i.id);
                    return n;
                  })
                }
                aria-label={t("masterBuilder.gap-tick")}
              />
              <span className="master-gap__text">
                {i.title}
                {i.detail && (
                  <Text size="xs" variant="dimmed">
                    {i.detail}
                  </Text>
                )}
              </span>
              {(i.kind !== "stale" || i.detail?.includes("suspended")) && (
                <Button size="xs" onClick={() => void fix(i)}>
                  {FIX_LABEL[i.kind]}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Stack>
      {pickFor && (
        <CardPickerModal
          opened
          onClose={() => setPickFor(null)}
          deckId={deckId}
          orphanIds={new Set(report.orphanCards)}
          onPick={(cardId) => edit((s) => patchEntry(s, pickFor, { cardId }))}
        />
      )}
    </Modal>
  );
}
