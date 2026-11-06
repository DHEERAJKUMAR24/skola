import MasterCardEditor from "@/app/editor/NoteEditor/MasterCardEditor";
import MasterActions from "@/app/master/MasterActions";
import {
  MasterCoverageSummary,
  MasterEntries,
  SuggestedRatingBadge,
} from "@/app/master/MasterReview";
import { Divider } from "@/components/ui";
import { NoteEditorProps, NoteTypeAdapter } from "@/logic/NoteTypeAdapter";
import { Card } from "@/logic/card/card";
import { deleteCard } from "@/logic/card/deleteCard";
import { db } from "@/logic/db";
import { Deck } from "@/logic/deck/deck";
import { syncMasterCards } from "@/logic/master/masterCards";
import {
  type MasterNoteContent,
  cleanMaster,
  masterSortField,
  sectionsForCard,
  validateMaster,
} from "@/logic/master/masterModel";
import { NoteContent } from "@/logic/note/NoteContent";
import { newNote } from "@/logic/note/newNote";
import { Note, NoteType } from "@/logic/note/note";
import { updateNoteContent } from "@/logic/note/updateNoteContent";
import { QuestionOnly } from "../shared/QuestionAnswerDisplay";

type Params = Pick<MasterNoteContent, "title" | "sections" | "status">;

function toContent(p: Params): NoteContent<NoteType.Master> {
  return { type: NoteType.Master, ...cleanMaster(p) };
}

/** What the card asks for: the master's name, plus the section when the card is one section. */
function questionHtml(
  card: Card<NoteType.Master> | undefined,
  content?: NoteContent<NoteType.Master>
) {
  const title = content?.title ?? "";
  const section = card?.content?.sectionId
    ? content?.sections.find((s) => s.id === card.content.sectionId)
    : undefined;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `Recall everything in: ${esc(title)}${section ? ` / ${esc(section.title)}` : ""}`;
}

export const MasterTypeAdapter: NoteTypeAdapter<NoteType.Master> = {
  async createNote(params: Params, deck: Deck) {
    const content = toContent(params);
    const problem = validateMaster(content);
    if (problem) throw new Error(problem);
    return db.transaction("rw", db.notes, db.decks, db.cards, async () => {
      const noteId = await newNote(deck, content);
      await syncMasterCards(noteId);
      return noteId;
    });
  },

  async updateNote(params: Params, existingNote: Note<NoteType.Master>) {
    // The simple editor does not know the status: keep the one the note has.
    const content = toContent({
      ...params,
      status: "status" in params ? params.status : existingNote.content?.status,
    });
    // A half-finished edit is not saved over a good note.
    if (validateMaster(content)) return;
    await db.transaction("rw", db.notes, db.decks, db.cards, async () => {
      await updateNoteContent(existingNote.id, content);
      await syncMasterCards(existingNote.id);
    });
  },

  displayQuestion(
    card: Card<NoteType.Master>,
    content?: NoteContent<NoteType.Master>
  ) {
    return <QuestionOnly html={questionHtml(card, content)} />;
  },

  displayAnswer(
    card: Card<NoteType.Master>,
    content?: NoteContent<NoteType.Master>
  ) {
    const sections = sectionsForCard(
      content?.sections ?? [],
      card.content?.sectionId
    );
    return (
      <div>
        <MasterEntries sections={sections} />
        <Divider />
        <SuggestedRatingBadge sections={sections} />
      </div>
    );
  },

  displayNote(
    note: Note<NoteType.Master>,
    showAllAnswers: "strict" | "optional" | "none"
  ) {
    return (
      <div>
        <QuestionOnly html={questionHtml(undefined, note.content)} />
        {showAllAnswers !== "none" && (
          <>
            <Divider />
            <MasterEntries sections={note.content?.sections ?? []} />
            <MasterCoverageSummary
              deckId={note.deck}
              sections={note.content?.sections ?? []}
            />
            <div style={{ padding: "0 var(--spacing-md) var(--spacing-md)" }}>
              <MasterActions noteId={note.id} deckId={note.deck} />
            </div>
          </>
        )}
      </div>
    );
  },

  getSortFieldFromNoteContent(content) {
    return masterSortField(content);
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
      <MasterCardEditor
        note={note as Note<NoteType.Master> | null}
        deck={deck}
        mode={mode}
        requestedFinish={requestedFinish}
        setRequestedFinish={setRequestedFinish}
        focusSelectNoteType={focusSelectNoteType}
      />
    );
  },

  async deleteCard(card: Card<NoteType.Master>) {
    await deleteCard(card);
  },
};
