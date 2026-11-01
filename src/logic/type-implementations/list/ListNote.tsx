import ListCardEditor from "@/app/editor/NoteEditor/ListCardEditor";
import { Divider } from "@/components/ui";
import { NoteEditorProps, NoteTypeAdapter } from "@/logic/NoteTypeAdapter";
import { Card, HTMLtoPreviewString } from "@/logic/card/card";
import { createCardSkeleton } from "@/logic/card/createCardSkeleton";
import { deleteCard } from "@/logic/card/deleteCard";
import { newCard } from "@/logic/card/newCard";
import { db } from "@/logic/db";
import { Deck } from "@/logic/deck/deck";
import { NoteContent } from "@/logic/note/NoteContent";
import { newNote } from "@/logic/note/newNote";
import { Note, NoteType } from "@/logic/note/note";
import { updateNoteContent } from "@/logic/note/updateNoteContent";
import { QuestionContent, QuestionOnly } from "../shared/QuestionAnswerDisplay";
import { type ListNoteContent, validateList } from "./types";

type Params = Omit<ListNoteContent, "items"> & { items: string[] };

function toContent(p: Params): NoteContent<NoteType.List> {
  return {
    type: NoteType.List,
    front: p.front,
    items: p.items.map((i) => i.trim()).filter(Boolean),
    ordered: !!p.ordered,
  };
}

/** The items to recall, shown one under the other. */
export function ListItems({
  items,
  ordered,
}: Pick<ListNoteContent, "items" | "ordered">) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      style={{
        margin: 0,
        padding:
          "var(--spacing-md) var(--spacing-md) var(--spacing-md) var(--spacing-xl)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--spacing-xs)",
        fontSize: "var(--font-size-md)",
      }}
    >
      {items.map((item, i) => (
        <li key={`${i}-${item}`}>{item}</li>
      ))}
    </Tag>
  );
}

export const ListTypeAdapter: NoteTypeAdapter<NoteType.List> = {
  async createNote(params: Params, deck: Deck) {
    const content = toContent(params);
    const problem = validateList(content);
    if (problem) throw new Error(problem);
    return db.transaction("rw", db.notes, db.decks, db.cards, async () => {
      const noteId = await newNote(deck, content);
      await newCard(
        {
          ...createCardSkeleton(),
          note: noteId,
          content: { type: NoteType.List },
        },
        deck
      );
      return noteId;
    });
  },

  async updateNote(params: Params, existingNote: Note<NoteType.List>) {
    const content = toContent(params);
    // A half-finished edit is not saved over a good note.
    if (validateList(content)) return;
    await updateNoteContent(existingNote.id, content);
  },

  displayQuestion(
    _: Card<NoteType.List>,
    content?: NoteContent<NoteType.List>
  ) {
    return <QuestionOnly html={content?.front ?? ""} />;
  },

  displayAnswer(_: Card<NoteType.List>, content?: NoteContent<NoteType.List>) {
    return (
      <div>
        <QuestionContent html={content?.front ?? ""} />
        <Divider />
        <ListItems
          items={content?.items ?? []}
          ordered={content?.ordered ?? false}
        />
      </div>
    );
  },

  displayNote(
    note: Note<NoteType.List>,
    showAllAnswers: "strict" | "optional" | "none"
  ) {
    return (
      <div>
        <QuestionContent html={note.content?.front ?? ""} />
        {showAllAnswers !== "none" && (
          <>
            <Divider />
            <ListItems
              items={note.content?.items ?? []}
              ordered={note.content?.ordered ?? false}
            />
          </>
        )}
      </div>
    );
  },

  getSortFieldFromNoteContent(content) {
    return HTMLtoPreviewString(content?.front ?? "[error]");
  },

  editor({
    note,
    deck,
    mode,
    requestedFinish,
    setRequestedFinish,
    focusSelectNoteType,
  }: NoteEditorProps) {
    return (
      <ListCardEditor
        note={note as Note<NoteType.List> | null}
        deck={deck}
        mode={mode}
        requestedFinish={requestedFinish}
        setRequestedFinish={setRequestedFinish}
        focusSelectNoteType={focusSelectNoteType}
      />
    );
  },

  async deleteCard(card: Card<NoteType.List>) {
    await deleteCard(card);
  },
};
