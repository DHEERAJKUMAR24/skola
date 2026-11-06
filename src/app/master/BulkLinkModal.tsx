import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Modal } from "@/components/ui/Modal";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { suggestLinks } from "@/logic/master/builderOps";
import type { MasterSection } from "@/logic/master/masterModel";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { listCardChoices } from "./CardPickerModal";

/**
 * Links many unlinked entries at once: each entry gets the card whose text is most like it
 * (cards no entry uses yet win ties). Untick what is wrong, then link the rest.
 */
export default function BulkLinkModal({
  opened,
  onClose,
  deckId,
  sections,
  orphanIds,
  onLink,
}: {
  opened: boolean;
  onClose: () => void;
  deckId: string;
  sections: MasterSection[];
  orphanIds: Set<string>;
  onLink: (pairs: { entryId: string; cardId: string }[]) => void;
}) {
  const [t] = useTranslation();
  const choices = useLiveQuery(() => listCardChoices(deckId), [deckId]);
  const suggestions = useMemo(
    () =>
      choices
        ? suggestLinks(
            sections,
            choices.map((c) => ({
              id: c.id,
              text: c.text,
              orphan: orphanIds.has(c.id),
            }))
          )
        : [],
    [choices, sections, orphanIds]
  );
  const [off, setOff] = useState<Set<string>>(new Set());
  useEffect(() => setOff(new Set()), [choices]);
  const entryText = useMemo(
    () =>
      new Map(
        sections.flatMap((s) => s.entries.map((e) => [e.id, e.text] as const))
      ),
    [sections]
  );
  const cardText = new Map((choices ?? []).map((c) => [c.id, c.text]));
  const chosen = suggestions.filter((s) => !off.has(s.entryId));

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <>
          {t("masterBuilder.bulk-title")}
          <InfoTip>{t("masterBuilder.bulk-tip")}</InfoTip>
        </>
      }
    >
      <Stack gap="md">
        {!choices && <Text variant="dimmed">{t("masterBuilder.loading")}</Text>}
        {choices && suggestions.length === 0 && (
          <Text variant="dimmed">{t("masterBuilder.bulk-none")}</Text>
        )}
        <div className="master-bulk">
          {suggestions.slice(0, 200).map((s) => (
            <div key={s.entryId} className="master-bulk__row">
              <Checkbox
                checked={!off.has(s.entryId)}
                onChange={() =>
                  setOff((cur) => {
                    const n = new Set(cur);
                    n.has(s.entryId) ? n.delete(s.entryId) : n.add(s.entryId);
                    return n;
                  })
                }
              />
              <span>
                <b>{entryText.get(s.entryId)}</b>
                <br />
                <Text size="sm" variant="dimmed">
                  {cardText.get(s.cardId)} ({Math.round(s.score * 100)}%)
                </Text>
              </span>
            </div>
          ))}
        </div>
        <Button
          variant="primary"
          disabled={chosen.length === 0}
          onClick={() => {
            onLink(chosen);
            onClose();
          }}
        >
          {t("masterBuilder.bulk-link-n", { count: chosen.length })}
        </Button>
      </Stack>
    </Modal>
  );
}
