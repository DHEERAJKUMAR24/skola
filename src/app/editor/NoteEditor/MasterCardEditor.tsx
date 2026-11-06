import CardPickerModal from "@/app/master/CardPickerModal";
import { MasterCoverageSummary } from "@/app/master/MasterReview";
import { InfoTip, LabelWithTip } from "@/components/InfoTip/InfoTip";
import {
  Button,
  Checkbox,
  IconButton,
  TextInput,
  Textarea,
} from "@/components/ui";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { EditMode } from "@/logic/NoteTypeAdapter";
import { Deck } from "@/logic/deck/deck";
import {
  MASTER_SPLIT_THRESHOLD,
  type MasterSection,
  cleanMaster,
  countEntries,
  masterToText,
  newMasterEntry,
  newMasterSection,
  parseMasterText,
  validateMaster,
} from "@/logic/master/masterModel";
import { Note, NoteType } from "@/logic/note/note";
import {
  effectiveHierarchy,
  entryName,
  sectionLevelName,
} from "@/logic/settings/hierarchy";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { MasterTypeAdapter } from "@/logic/type-implementations/master/MasterNote";
import {
  IconLink,
  IconLinkOff,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { t } from "i18next";
import { useCallback, useRef, useState } from "react";
import { useAutoSave, useAutoSaveOnChange, useNoteCreation } from "./hooks";

interface Props {
  note: Note<NoteType.Master> | null;
  deck: Deck;
  mode: EditMode;
  requestedFinish?: boolean;
  setRequestedFinish?: (finish: boolean) => void;
  focusSelectNoteType?: () => void;
}

const BASE = "master-editor";

/**
 * Editor of a master card: a name and sections of entries. Each entry is a short line, optionally
 * linked to a card (picker). A text mode edits the same data as one compact list. The full
 * builder (graph, bulk linking, generated drafts) is a later feature; this is the minimum.
 */
export default function MasterCardEditor({
  note,
  deck,
  mode,
  requestedFinish,
  setRequestedFinish,
}: Props) {
  const initial = note?.content;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [sections, setSections] = useState<MasterSection[]>(
    initial?.sections?.length
      ? initial.sections
      : [newMasterSection("", [newMasterEntry()])]
  );
  const [asText, setAsText] = useState(false);
  const [text, setText] = useState("");
  const [picking, setPicking] = useState<{
    sectionId: string;
    entryId: string;
  } | null>(null);
  const [hierarchy] = useSetting("#hierarchy");
  const levels = effectiveHierarchy(hierarchy).levels;
  const noun = entryName(levels).toLowerCase();
  const sectionNoun = sectionLevelName(levels, 0).toLowerCase();

  const titleRef = useRef(title);
  const sectionsRef = useRef(sections);
  titleRef.current = title;
  sectionsRef.current = sections;

  const getContent = useCallback(
    () => ({ title: titleRef.current, sections: sectionsRef.current }),
    []
  );
  const debouncedAutoSave = useAutoSave(
    mode,
    note,
    getContent,
    MasterTypeAdapter.updateNote
  );
  useAutoSaveOnChange(debouncedAutoSave, [title, sections]);

  const clear = useCallback(() => {
    setTitle("");
    setText("");
    setSections([newMasterSection("", [newMasterEntry()])]);
  }, []);

  useNoteCreation(
    mode,
    deck,
    getContent,
    MasterTypeAdapter.createNote,
    clear,
    requestedFinish,
    setRequestedFinish
  );

  const patchSection = (id: string, fn: (s: MasterSection) => MasterSection) =>
    setSections((ss) => ss.map((s) => (s.id === id ? fn(s) : s)));

  const cleaned = cleanMaster({ title, sections });
  const problem = validateMaster(cleaned);
  const total = countEntries(cleaned.sections);

  const toggleText = (on: boolean) => {
    if (on) setText(masterToText(cleaned.sections));
    else
      setSections((prev) => {
        const next = parseMasterText(text, prev);
        return next.length ? next : [newMasterSection("", [newMasterEntry()])];
      });
    setAsText(on);
  };

  return (
    <Stack gap="xl" className={BASE}>
      <TextInput
        label={t("note.edit.type-specific.master.title")}
        placeholder={t("note.edit.type-specific.master.title-placeholder")}
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--spacing-xs)",
        }}
      >
        <Checkbox
          checked={asText}
          onChange={(e) => toggleText(e.currentTarget.checked)}
          label={t("note.edit.type-specific.master.as-text")}
        />
        <InfoTip>
          The same list as plain text, handy to paste. A line starting with # is
          a {sectionNoun}; other lines are {noun}s. Add {"{{card:ID}}"} at the
          end of a line to link it to a card.
        </InfoTip>
      </div>

      {asText ? (
        <Textarea
          label={t("note.edit.type-specific.master.title")}
          description={t("note.edit.type-specific.master.text-hint")}
          minRows={12}
          value={text}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setText(v);
            setSections((prev) => parseMasterText(v, prev));
          }}
        />
      ) : (
        <Stack gap="lg">
          {sections.map((s, si) => (
            <Stack gap="xs" key={s.id}>
              <div
                style={{
                  display: "flex",
                  gap: "var(--spacing-sm)",
                  alignItems: "flex-end",
                }}
              >
                <div style={{ flex: 1 }}>
                  <TextInput
                    label={`${sectionLevelName(levels, 0)} ${si + 1}`}
                    placeholder={t("note.edit.type-specific.master.section")}
                    value={s.title}
                    onChange={(e) =>
                      patchSection(s.id, (x) => ({
                        ...x,
                        title: e.currentTarget.value,
                      }))
                    }
                  />
                </div>
                <IconButton
                  variant="subtle"
                  aria-label={t(
                    "note.edit.type-specific.master.remove-section"
                  )}
                  disabled={sections.length <= 1}
                  onClick={() =>
                    setSections((ss) => ss.filter((x) => x.id !== s.id))
                  }
                >
                  <IconTrash />
                </IconButton>
              </div>
              {s.entries.map((e) => (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    gap: "var(--spacing-sm)",
                    alignItems: "center",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <TextInput
                      aria-label={t("note.edit.type-specific.master.entry")}
                      placeholder={t("note.edit.type-specific.master.entry")}
                      value={e.text}
                      onChange={(ev) =>
                        patchSection(s.id, (x) => ({
                          ...x,
                          entries: x.entries.map((y) =>
                            y.id === e.id
                              ? { ...y, text: ev.currentTarget.value }
                              : y
                          ),
                        }))
                      }
                    />
                  </div>
                  <IconButton
                    variant={e.cardId ? "default" : "subtle"}
                    aria-label={
                      e.cardId
                        ? t("note.edit.type-specific.master.unlink")
                        : t("note.edit.type-specific.master.link")
                    }
                    title={
                      e.cardId
                        ? t("note.edit.type-specific.master.unlink")
                        : t("note.edit.type-specific.master.link")
                    }
                    onClick={() =>
                      e.cardId
                        ? patchSection(s.id, (x) => ({
                            ...x,
                            entries: x.entries.map((y) =>
                              y.id === e.id ? { ...y, cardId: undefined } : y
                            ),
                          }))
                        : setPicking({ sectionId: s.id, entryId: e.id })
                    }
                  >
                    {e.cardId ? <IconLink /> : <IconLinkOff />}
                  </IconButton>
                  <IconButton
                    variant="subtle"
                    aria-label={t(
                      "note.edit.type-specific.master.remove-entry"
                    )}
                    onClick={() =>
                      patchSection(s.id, (x) => ({
                        ...x,
                        entries: x.entries.filter((y) => y.id !== e.id),
                      }))
                    }
                  >
                    <IconTrash />
                  </IconButton>
                </div>
              ))}
              <div>
                <Button
                  leftSection={<IconPlus />}
                  onClick={() =>
                    patchSection(s.id, (x) => ({
                      ...x,
                      entries: [...x.entries, newMasterEntry()],
                    }))
                  }
                >
                  {t("note.edit.type-specific.master.add-entry")}
                </Button>
              </div>
            </Stack>
          ))}
          <div>
            <Button
              leftSection={<IconPlus />}
              onClick={() =>
                setSections((ss) => [
                  ...ss,
                  newMasterSection("", [newMasterEntry()]),
                ])
              }
            >
              {t("note.edit.type-specific.master.add-section")}
            </Button>
          </div>
        </Stack>
      )}

      <Text size="sm" variant="dimmed">
        <LabelWithTip
          tip={`A master card lists every ${noun} of the deck, nothing left out. Up to ${MASTER_SPLIT_THRESHOLD} entries it is one study card; above that each ${sectionNoun} gets its own card, so a review stays short. Link an entry to the card that tests it and Skola shows what is left out.`}
        >
          {total} {total === 1 ? noun : `${noun}s`}.{" "}
          {total > MASTER_SPLIT_THRESHOLD && cleaned.sections.length >= 2
            ? t("note.edit.type-specific.master.split-hint")
            : ""}
        </LabelWithTip>
      </Text>
      {problem && mode === "new" && <Text size="sm">{problem}</Text>}

      {note && (
        <MasterCoverageSummary deckId={deck.id} sections={cleaned.sections} />
      )}

      <CardPickerModal
        opened={picking !== null}
        onClose={() => setPicking(null)}
        deckId={deck.id}
        onPick={(cardId) => {
          if (!picking) return;
          patchSection(picking.sectionId, (x) => ({
            ...x,
            entries: x.entries.map((y) =>
              y.id === picking.entryId ? { ...y, cardId } : y
            ),
          }));
        }}
      />
    </Stack>
  );
}
