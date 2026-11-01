import ImageOcclusionEditor from "@/app/editor/NoteEditor/ImageOcclusionEditor";
import { NoteEditorProps, NoteTypeAdapter } from "@/logic/NoteTypeAdapter";
import { Card } from "@/logic/card/card";
import { createCardSkeleton } from "@/logic/card/createCardSkeleton";
import { deleteCard } from "@/logic/card/deleteCard";
import { newCard } from "@/logic/card/newCard";
import { syncOcclusionCards } from "@/logic/card/syncOcclusionCards";
import { db } from "@/logic/db";
import { Deck } from "@/logic/deck/deck";
import { NoteContent } from "@/logic/note/NoteContent";
import { newNote } from "@/logic/note/newNote";
import { Note, NoteType } from "@/logic/note/note";
import { updateNoteContent } from "@/logic/note/updateNoteContent";
import { OcclusionImage } from "./OcclusionView";
import {
  type ImageOcclusionNoteContent,
  validateImageOcclusion,
} from "./types";

type Params = ImageOcclusionNoteContent;

function toContent(p: Params): NoteContent<NoteType.ImageOcclusion> {
  return {
    type: NoteType.ImageOcclusion,
    image: p.image,
    boxes: p.boxes,
    hideAll: !!p.hideAll,
    ...(p.header?.trim() ? { header: p.header.trim() } : {}),
  };
}

export const ImageOcclusionTypeAdapter: NoteTypeAdapter<NoteType.ImageOcclusion> =
  {
    /** One card per covered area. */
    async createNote(params: Params, deck: Deck) {
      const content = toContent(params);
      const problem = validateImageOcclusion(content);
      if (problem) throw new Error(problem);
      return db.transaction("rw", db.notes, db.decks, db.cards, async () => {
        const noteId = await newNote(deck, content);
        for (const box of content.boxes)
          await newCard(
            {
              ...createCardSkeleton(),
              note: noteId,
              content: {
                type: NoteType.ImageOcclusion,
                occlusionNumber: box.id,
              },
            },
            deck
          );
        return noteId;
      });
    },

    async updateNote(
      params: Params,
      existingNote: Note<NoteType.ImageOcclusion>
    ) {
      const content = toContent(params);
      // A half-finished edit is not saved over a good note.
      if (validateImageOcclusion(content)) return;
      await db.transaction("rw", db.notes, db.cards, db.decks, async () => {
        await updateNoteContent(existingNote.id, content);
        // Removing an area is a deliberate click, so its card goes too.
        await syncOcclusionCards(
          existingNote.id,
          NoteType.ImageOcclusion,
          content.boxes.map((b) => b.id),
          true
        );
      });
    },

    displayQuestion(
      card: Card<NoteType.ImageOcclusion>,
      content?: NoteContent<NoteType.ImageOcclusion>
    ) {
      return (
        <OcclusionImage
          content={content}
          activeId={card.content.occlusionNumber}
        />
      );
    },

    displayAnswer(
      card: Card<NoteType.ImageOcclusion>,
      content?: NoteContent<NoteType.ImageOcclusion>
    ) {
      return (
        <OcclusionImage
          content={content}
          activeId={card.content.occlusionNumber}
          revealed
        />
      );
    },

    displayNote(
      note: Note<NoteType.ImageOcclusion>,
      showAllAnswers: "strict" | "optional" | "none"
    ) {
      return (
        <OcclusionImage
          content={note.content}
          coverAll={showAllAnswers === "none"}
        />
      );
    },

    getSortFieldFromNoteContent(content) {
      return content?.header?.trim() || "Image occlusion";
    },

    editor({
      note,
      deck,
      mode,
      requestedFinish,
      setRequestedFinish,
    }: NoteEditorProps) {
      return (
        <ImageOcclusionEditor
          note={note as Note<NoteType.ImageOcclusion> | null}
          deck={deck}
          mode={mode}
          requestedFinish={requestedFinish}
          setRequestedFinish={setRequestedFinish}
        />
      );
    },

    /** Deleting one card removes its area from the picture. */
    async deleteCard(card: Card<NoteType.ImageOcclusion>) {
      await db.transaction("rw", db.decks, db.cards, db.notes, async () => {
        const note = await db.notes.get(card.note);
        const content = note?.content as ImageOcclusionNoteContent | undefined;
        if (note && content)
          await updateNoteContent(note.id, {
            type: NoteType.ImageOcclusion,
            ...content,
            boxes: content.boxes.filter(
              (b) => b.id !== card.content.occlusionNumber
            ),
          });
        await deleteCard(card);
      });
    },
  };
