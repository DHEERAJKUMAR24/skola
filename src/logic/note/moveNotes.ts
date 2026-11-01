import { db } from "../db";
import { moveNote } from "./moveNote";

/**
 * Moves several notes, with all their cards, to another deck in one step.
 * Cards keep their FSRS state and review history.
 */
export async function moveNotes(noteIds: string[], newDeckId: string) {
  await db.transaction("rw", db.notes, db.cards, db.decks, async () => {
    for (const id of noteIds) await moveNote({ note: id, newDeck: newDeckId });
  });
}
