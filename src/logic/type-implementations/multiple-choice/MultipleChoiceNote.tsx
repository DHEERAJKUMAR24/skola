import MultipleChoiceEditor from "@/app/editor/NoteEditor/MultipleChoiceEditor";
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
import {
  MultipleChoiceNoteView,
  MultipleChoiceView,
} from "./MultipleChoiceView";
import {
  type MultipleChoiceNoteContent,
  cleanChoices,
  validateMultipleChoice,
} from "./types";

type Params = Omit<MultipleChoiceNoteContent, "choices"> & {
  choices: MultipleChoiceNoteContent["choices"];
};

function toContent(p: Params): NoteContent<NoteType.MultipleChoice> {
  return {
    type: NoteType.MultipleChoice,
    question: p.question,
    choices: cleanChoices(p.choices),
    ...(p.explanation?.replace(/<[^>]*>/g, "").trim()
      ? { explanation: p.explanation }
      : {}),
  };
}

export const MultipleChoiceTypeAdapter: NoteTypeAdapter<NoteType.MultipleChoice> =
  {
    async createNote(params: Params, deck: Deck) {
      const content = toContent(params);
      const problem = validateMultipleChoice(content);
      if (problem) throw new Error(problem);
      return db.transaction("rw", db.notes, db.decks, db.cards, async () => {
        const noteId = await newNote(deck, content);
        await newCard(
          {
            ...createCardSkeleton(),
            note: noteId,
            content: { type: NoteType.MultipleChoice },
          },
          deck
        );
        return noteId;
      });
    },

    async updateNote(
      params: Params,
      existingNote: Note<NoteType.MultipleChoice>
    ) {
      const content = toContent(params);
      // A half-finished edit (say, the second choice not typed yet) is not saved over a good note.
      if (validateMultipleChoice(content)) return;
      await updateNoteContent(existingNote.id, content);
    },

    displayQuestion(
      card: Card<NoteType.MultipleChoice>,
      content?: NoteContent<NoteType.MultipleChoice>
    ) {
      return (
        <MultipleChoiceView
          cardId={card.id}
          content={content}
          revealed={false}
        />
      );
    },

    displayAnswer(
      card: Card<NoteType.MultipleChoice>,
      content?: NoteContent<NoteType.MultipleChoice>
    ) {
      return <MultipleChoiceView cardId={card.id} content={content} revealed />;
    },

    displayNote(
      note: Note<NoteType.MultipleChoice>,
      showAllAnswers: "strict" | "optional" | "none"
    ) {
      return (
        <MultipleChoiceNoteView
          content={note.content}
          showAnswers={showAllAnswers !== "none"}
        />
      );
    },

    getSortFieldFromNoteContent(content) {
      return HTMLtoPreviewString(content?.question ?? "[error]");
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
        <MultipleChoiceEditor
          note={note as Note<NoteType.MultipleChoice> | null}
          deck={deck}
          mode={mode}
          requestedFinish={requestedFinish}
          setRequestedFinish={setRequestedFinish}
          focusSelectNoteType={focusSelectNoteType}
        />
      );
    },

    async deleteCard(card: Card<NoteType.MultipleChoice>) {
      await deleteCard(card);
    },
  };
