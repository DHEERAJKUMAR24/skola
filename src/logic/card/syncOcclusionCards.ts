import { db } from "../db";
import { NoteType } from "../note/note";
import { createCardSkeleton } from "./createCardSkeleton";
import { deleteCard } from "./deleteCard";
import { newCard } from "./newCard";

/**
 * Makes a note's cards match its occlusion numbers (cloze numbers or image-occlusion area ids):
 * a card is created for every new number, and with `prune` cards whose number is gone are deleted.
 * Existing cards keep their schedule. Cloze text is saved while typing, when a number can vanish
 * for a moment ("{{c2::abc}" is not complete yet), so it must not prune; an image area is removed
 * by an explicit click, so it can.
 */
export async function syncOcclusionCards(
  noteId: string,
  type: NoteType.Cloze | NoteType.ImageOcclusion,
  numbers: number[],
  prune: boolean
) {
  const note = await db.notes.get(noteId);
  if (!note) return;
  const want = new Set(numbers);
  const existing = await db.cards.where("note").equals(noteId).toArray();
  const have = new Set<number>();

  for (const card of existing) {
    const n = (card.content as { occlusionNumber?: number }).occlusionNumber;
    if (n !== undefined && want.has(n) && !have.has(n)) have.add(n);
    else if (prune) await deleteCard(card);
    else if (n !== undefined) have.add(n);
  }

  // Read the deck after the deletions: they rewrite its card list.
  const deck = await db.decks.get(note.deck);
  if (!deck) return;
  for (const n of numbers) {
    if (have.has(n)) continue;
    await newCard(
      {
        ...createCardSkeleton(),
        note: noteId,
        content: { type, occlusionNumber: n },
      } as never,
      deck
    );
  }
}
