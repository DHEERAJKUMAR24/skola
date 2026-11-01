import { Button, Checkbox, IconButton, TextInput } from "@/components/ui";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { EditMode } from "@/logic/NoteTypeAdapter";
import { Deck } from "@/logic/deck/deck";
import { Note, NoteType } from "@/logic/note/note";
import { MultipleChoiceTypeAdapter } from "@/logic/type-implementations/multiple-choice/MultipleChoiceNote";
import {
  MC_MAX_CHOICES,
  type MultipleChoiceOption,
  cleanChoices,
  validateMultipleChoice,
} from "@/logic/type-implementations/multiple-choice/types";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { t } from "i18next";
import { useCallback, useRef, useState } from "react";
import NoteEditor, { useNoteEditor } from "./NoteEditor";
import {
  useAutoSave,
  useAutoSaveOnChange,
  useClearEditors,
  useNoteCreation,
} from "./hooks";

const emptyChoices = (): MultipleChoiceOption[] => [
  { text: "", correct: false },
  { text: "", correct: false },
];

interface Props {
  note: Note<NoteType.MultipleChoice> | null;
  deck: Deck;
  mode: EditMode;
  requestedFinish?: boolean;
  setRequestedFinish?: (finish: boolean) => void;
  focusSelectNoteType?: () => void;
}

export default function MultipleChoiceEditor({
  note,
  deck,
  mode,
  requestedFinish,
  setRequestedFinish,
  focusSelectNoteType,
}: Props) {
  const initial = note?.content;
  const [choices, setChoices] = useState<MultipleChoiceOption[]>(
    initial?.choices?.length ? initial.choices : emptyChoices()
  );
  const questionRef = useRef(initial?.question ?? "");
  const explanationRef = useRef(initial?.explanation ?? "");
  const choicesRef = useRef(choices);
  choicesRef.current = choices;

  const getContent = useCallback(
    () => ({
      question: questionRef.current,
      choices: choicesRef.current,
      explanation: explanationRef.current,
    }),
    []
  );
  const debouncedAutoSave = useAutoSave(
    mode,
    note,
    getContent,
    MultipleChoiceTypeAdapter.updateNote
  );
  useAutoSaveOnChange(debouncedAutoSave, [choices]);

  const questionEditor = useNoteEditor({
    content: initial?.question ?? "",
    onUpdate: ({ editor }) => {
      questionRef.current = editor.getHTML();
      debouncedAutoSave();
    },
    focusSelectNoteType,
  });
  const explanationEditor = useNoteEditor({
    content: initial?.explanation ?? "",
    onUpdate: ({ editor }) => {
      explanationRef.current = editor.getHTML();
      debouncedAutoSave();
    },
    focusSelectNoteType,
  });

  const clearEditors = useClearEditors(questionEditor, explanationEditor);
  const clear = useCallback(() => {
    clearEditors();
    questionRef.current = "";
    explanationRef.current = "";
    setChoices(emptyChoices());
  }, [clearEditors]);

  useNoteCreation(
    mode,
    deck,
    getContent,
    MultipleChoiceTypeAdapter.createNote,
    clear,
    requestedFinish,
    setRequestedFinish
  );

  const update = (i: number, patch: Partial<MultipleChoiceOption>) =>
    setChoices((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  // The question text is checked on save; here only the choices can be judged live.
  const incomplete = validateMultipleChoice({
    question: "x",
    choices: cleanChoices(choices),
  });

  return (
    <Stack gap="xl">
      <Stack gap="xs">
        <Text size="sm" weight="semibold">
          {t("note.edit.type-specific.multiple-choice.question")}
        </Text>
        <NoteEditor editor={questionEditor} key="mc-question" />
      </Stack>

      <Stack gap="xs">
        <Text size="sm" weight="semibold">
          {t("note.edit.type-specific.multiple-choice.choices")}
        </Text>
        {choices.map((c, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id and are reordered only by delete
            key={i}
            style={{
              display: "flex",
              gap: "var(--spacing-sm)",
              alignItems: "center",
            }}
          >
            <Checkbox
              checked={c.correct}
              onChange={(e) => update(i, { correct: e.currentTarget.checked })}
              label={t("note.edit.type-specific.multiple-choice.correct")}
            />
            <div style={{ flex: 1 }}>
              <TextInput
                value={c.text}
                placeholder={t(
                  "note.edit.type-specific.multiple-choice.choice-placeholder"
                )}
                aria-label={`${String.fromCharCode(65 + i)}`}
                onChange={(e) => update(i, { text: e.currentTarget.value })}
              />
            </div>
            <IconButton
              variant="subtle"
              aria-label={t(
                "note.edit.type-specific.multiple-choice.remove-choice"
              )}
              disabled={choices.length <= 2}
              onClick={() => setChoices((cs) => cs.filter((_, k) => k !== i))}
            >
              <IconTrash />
            </IconButton>
          </div>
        ))}
        <div>
          <Button
            variant="default"
            leftSection={<IconPlus />}
            disabled={choices.length >= MC_MAX_CHOICES}
            onClick={() =>
              setChoices((cs) => [...cs, { text: "", correct: false }])
            }
          >
            {t("note.edit.type-specific.multiple-choice.add-choice")}
          </Button>
        </div>
        {incomplete && (
          <Text size="sm">
            {t("note.edit.type-specific.multiple-choice.hint")}
          </Text>
        )}
      </Stack>

      <Stack gap="xs">
        <Text size="sm" weight="semibold">
          {t("note.edit.type-specific.multiple-choice.explanation")}
        </Text>
        <NoteEditor editor={explanationEditor} key="mc-explanation" />
      </Stack>
    </Stack>
  );
}
