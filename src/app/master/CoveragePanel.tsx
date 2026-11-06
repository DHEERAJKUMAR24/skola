import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Text } from "@/components/ui/Text";
import { cardTexts } from "@/logic/master/builderData";
import type { CoverageReport } from "@/logic/master/coverage";
import { useLiveQuery } from "dexie-react-hooks";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

const SHOWN_ORPHANS = 8;

interface Props {
  report: CoverageReport | undefined;
  stats: CoverageReport["stats"] | undefined;
  noteId: string;
  deckId: string;
  onAddOrphans: (groupByTags: boolean) => void | Promise<void>;
  onAddOrphan: (cardId: string) => void | Promise<void>;
  onFixDangling: () => void;
  onRemoveEmpty: () => void;
  onLinkUnlinked: () => void;
  onUnsuspend: () => void | Promise<void>;
  onDrill: () => void;
  onFixSameCard: () => void;
  onFixSimilar: () => void;
}

function Row({
  label,
  count,
  tip,
  children,
}: {
  label: string;
  count: number;
  tip: string;
  children?: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <li className="master-coverage-panel__row">
      <div className="master-coverage-panel__row-head">
        <span>
          <b>{count}</b> {label}
        </span>
        <InfoTip>{tip}</InfoTip>
      </div>
      <div className="master-coverage-panel__actions">{children}</div>
    </li>
  );
}

/** Coverage of the master with one fix action per kind of problem. */
export default function CoveragePanel({
  report,
  stats,
  deckId: _deckId,
  onAddOrphans,
  onAddOrphan,
  onFixDangling,
  onRemoveEmpty,
  onLinkUnlinked,
  onUnsuspend,
  onDrill,
  onFixSameCard,
  onFixSimilar,
}: Props) {
  const [t] = useTranslation();
  const [group, setGroup] = useState(true);
  const orphanIds = report?.orphanCards.slice(0, SHOWN_ORPHANS) ?? [];
  const orphanKey = orphanIds.join(",");
  const orphanTexts = useLiveQuery(
    () => cardTexts(orphanKey ? orphanKey.split(",") : []),
    [orphanKey]
  );

  if (!report || !stats)
    return (
      <div className="master-coverage-panel">
        <Text variant="dimmed">{t("masterBuilder.coverage-loading")}</Text>
      </div>
    );

  const pct = Math.round(stats.coverage * 100);
  const suspended = report.staleEntries.filter((e) =>
    e.reasons.includes("suspended")
  ).length;
  const needStudy = report.staleEntries.filter(
    (e) => !e.reasons.includes("suspended")
  ).length;
  const dupes = report.duplicates;

  return (
    <div className="master-coverage-panel" data-testid="coverage-panel">
      <div className="master-coverage-panel__head">
        <b>{t("masterBuilder.coverage")}</b>
        <InfoTip>{t("masterBuilder.coverage-tip")}</InfoTip>
      </div>
      <div
        className="master-coverage-panel__bar"
        role="progressbar"
        tabIndex={0}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${pct}%` }} />
      </div>
      <Text size="sm">
        {t("masterBuilder.coverage-line", {
          pct,
          covered: stats.coveredCards,
          total: stats.coveredCards + report.orphanCards.length,
        })}
      </Text>
      {report.complete &&
        report.staleEntries.length === 0 &&
        dupes.sameCard.length + dupes.similarText.length === 0 && (
          <Text size="sm" variant="dimmed">
            {t("masterBuilder.nothing-left-out")}
          </Text>
        )}
      <ul className="master-coverage-panel__list">
        <Row
          label={t("masterBuilder.orphans")}
          count={report.orphanCards.length}
          tip={t("masterBuilder.orphans-tip")}
        >
          <Checkbox
            checked={group}
            onChange={(e) => setGroup(e.currentTarget.checked)}
            label={t("masterBuilder.group-by-tags")}
          />
          <Button
            size="xs"
            variant="primary"
            onClick={() => onAddOrphans(group)}
          >
            {t("masterBuilder.add-all-orphans", {
              count: report.orphanCards.length,
            })}
          </Button>
          <ul className="master-coverage-panel__orphans">
            {orphanIds.map((id) => (
              <li key={id}>
                <span>{orphanTexts?.get(id)?.text ?? "…"}</span>
                <Button size="xs" onClick={() => onAddOrphan(id)}>
                  {t("masterBuilder.add")}
                </Button>
              </li>
            ))}
            {report.orphanCards.length > SHOWN_ORPHANS && (
              <li>
                <Text size="xs" variant="dimmed">
                  {t("masterBuilder.and-more", {
                    count: report.orphanCards.length - SHOWN_ORPHANS,
                  })}
                </Text>
              </li>
            )}
          </ul>
        </Row>
        <Row
          label={t("masterBuilder.dangling")}
          count={report.danglingEntries.length}
          tip={t("masterBuilder.dangling-tip")}
        >
          <Button size="xs" onClick={onFixDangling}>
            {t("masterBuilder.fix-dangling")}
          </Button>
        </Row>
        <Row
          label={t("masterBuilder.empty-sections")}
          count={report.emptySections.length}
          tip={t("masterBuilder.empty-tip")}
        >
          <Button size="xs" onClick={onRemoveEmpty}>
            {t("masterBuilder.remove-empty")}
          </Button>
        </Row>
        <Row
          label={t("masterBuilder.unlinked")}
          count={report.unlinkedEntries.length}
          tip={t("masterBuilder.unlinked-tip")}
        >
          <Button size="xs" onClick={onLinkUnlinked}>
            {t("masterBuilder.link-by-text")}
          </Button>
        </Row>
        <Row
          label={t("masterBuilder.suspended")}
          count={suspended}
          tip={t("masterBuilder.suspended-tip")}
        >
          <Button size="xs" onClick={() => void onUnsuspend()}>
            {t("masterBuilder.unsuspend")}
          </Button>
        </Row>
        <Row
          label={t("masterBuilder.needs-study")}
          count={needStudy}
          tip={t("masterBuilder.needs-study-tip")}
        >
          <Button size="xs" onClick={onDrill}>
            {t("masterBuilder.weak-drill")}
          </Button>
        </Row>
        <Row
          label={t("masterBuilder.dup-card")}
          count={dupes.sameCard.length}
          tip={t("masterBuilder.dup-card-tip")}
        >
          <Button size="xs" onClick={onFixSameCard}>
            {t("masterBuilder.keep-first")}
          </Button>
        </Row>
        <Row
          label={t("masterBuilder.dup-text")}
          count={dupes.similarText.length}
          tip={t("masterBuilder.dup-text-tip")}
        >
          <Button size="xs" onClick={onFixSimilar}>
            {t("masterBuilder.keep-first")}
          </Button>
        </Row>
      </ul>
    </div>
  );
}
