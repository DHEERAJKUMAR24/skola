import { Checkbox, Textarea } from "@/components/ui";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { EditMode } from "@/logic/NoteTypeAdapter";
import { Deck } from "@/logic/deck/deck";
import { Note, NoteType } from "@/logic/note/note";
import { ListTypeAdapter } from "@/logic/type-implementations/list/ListNote";
import {
  LIST_MIN_ITEMS,
  listToText,
  parseListText,
} from "@/logic/type-implementations/list/types";
import { t } from "i18next";
import { useCallback, useRef, useState } from "react";
import NoteEditor, { useNoteEditor } from "./NoteEditor";
import {
  useAutoSave,
  useAutoSaveOnChange,
  useClearEditors,
  useNoteCreation,
} from "./hooks";

interface Props {
  note: Note<NoteType.List> | null;
  deck: Deck;
  mode: EditMode;
  requestedFinish?: boolean;
  setRequestedFinish?: (finish: boolean) => void;
  focusSelectNoteType?: () => void;
}

export default function ListCardEditor({
  note,
  deck,
  mode,
  requestedFinish,
  setRequestedFinish,
  focusSelectNoteType,
}: Props) {
  const initial = note?.content;
  const [text, setText] = useState(listToText(initial?.items ?? []));
  const [ordered, setOrdered] = useState(initial?.ordered ?? false);
  const frontRef = useRef(initial?.front ?? "");
  const textRef = useRef(text);
  const orderedRef = useRef(ordered);
  textRef.current = text;
  orderedRef.current = ordered;

  const getContent = useCallback(
    () => ({
      front: frontRef.current,
      items: parseListText(textRef.current),
      ordered: orderedRef.current,
    }),
    []
  );
  const debouncedAutoSave = useAutoSave(
    mode,
    note,
    getContent,
    ListTypeAdapter.updateNote
  );
  useAutoSaveOnChange(debouncedAutoSave, [text, ordered]);

  const frontEditor = useNoteEditor({
    content: initial?.front ?? "",
    onUpdate: ({ editor }) => {
      frontRef.current = editor.getHTML();
      debouncedAutoSave();
    },
    focusSelectNoteType,
  });

  const clearEditors = useClearEditors(frontEditor);
  const clear = useCallback(() => {
    clearEditors();
    frontRef.current = "";
    setText("");
  }, [clearEditors]);

  useNoteCreation(
    mode,
    deck,
    getContent,
    ListTypeAdapter.createNote,
    clear,
    requestedFinish,
    setRequestedFinish
  );

  const count = parseListText(text).length;

  return (
    <Stack gap="xl">
      <Stack gap="xs">
        <Text size="sm" weight="semibold">
          {t("note.edit.type-specific.list.front")}
        </Text>
        <NoteEditor editor={frontEditor} key="list-front" />
      </Stack>
      <Stack gap="xs">
        <Textarea
          label={t("note.edit.type-specific.list.items")}
          description={t("note.edit.type-specific.list.hint")}
          placeholder={t("note.edit.type-specific.list.placeholder")}
          minRows={5}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <Checkbox
          checked={ordered}
          onChange={(e) => setOrdered(e.currentTarget.checked)}
          label={t("note.edit.type-specific.list.ordered")}
        />
        {count < LIST_MIN_ITEMS && (
          <Text size="sm">{t("note.edit.type-specific.list.too-few")}</Text>
        )}
      </Stack>
    </Stack>
  );
}
