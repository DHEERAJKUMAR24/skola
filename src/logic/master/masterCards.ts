// Dexie side of master cards (ADR 0014): keep a master note's study cards in step with its
// sections, build the coverage input for a deck, and create a master from a deck. The rules
// themselves are pure and live next to this file (masterModel, coverage, suggestRating).
import { State } from "ts-fsrs";
import { Card } from "../card/card";
import { createCardSkeleton } from "../card/createCardSkeleton";
import { deleteCard } from "../card/deleteCard";
import { newCard } from "../card/newCard";
import { db } from "../db";
import { Deck } from "../deck/deck";
import { newNote } from "../note/newNote";
import { Note, NoteType } from "../note/note";
import { type CoverageCard, analyzeCoverage } from "./coverage";
import {
  type MasterNoteContent,
  type MasterSection,
  linkedCardIds,
  newMasterEntry,
  newMasterSection,
  planMasterCards,
} from "./masterModel";
import type { LinkedCardState } from "./suggestRating";

type MasterNote = Note<NoteType.Master>;

/** Dexie card to the plain shape the pure engines take. */
export function toCoverageCard(c: Card<NoteType>): CoverageCard {
  return {
    id: c.id,
    state: c.model.state,
    due: c.model.due,
    lastReview: c.model.last_review ?? null,
    reps: c.model.reps,
    suspended: c.suspended,
  };
}

export function toLinkedState(c: Card<NoteType>): LinkedCardState {
  return {
    state: c.model.state,
    stability: c.model.stability,
    due: c.model.due,
    lastReview: c.model.last_review ?? null,
    lapses: c.model.lapses,
    reps: c.model.reps,
    suspended: c.suspended,
  };
}

/**
 * Makes the master note's cards match its sections (see planMasterCards): missing cards are
 * created. A card the plan no longer wants is deleted when it was never reviewed, else suspended
 * and marked `retired` so its history survives. A retired card the plan wants again comes back.
 * Safe to call after every save.
 */
export async function syncMasterCards(noteId: string): Promise<void> {
  await db.transaction("rw", db.notes, db.decks, db.cards, async () => {
    const note = (await db.notes.get(noteId)) as MasterNote | undefined;
    if (!note || note.content?.type !== NoteType.Master) return;
    const want = planMasterCards(note.content.sections);
    const wantKeys = new Set(want.map((k) => k ?? ""));
    const existing = (await db.cards
      .where("note")
      .equals(noteId)
      .toArray()) as Card<NoteType.Master>[];
    const keyOf = (c: Card<NoteType.Master>) => c.content.sectionId ?? "";
    const have = new Set<string>();

    for (const c of existing) {
      const k = keyOf(c);
      if (wantKeys.has(k) && !have.has(k)) {
        have.add(k);
        if (c.content.retired)
          await db.cards.update(c.id, {
            content: { ...c.content, retired: false },
            suspended: false,
          });
      } else if (c.model.state === State.New && !c.model.reps) {
        await deleteCard(c);
      } else if (!c.content.retired) {
        await db.cards.update(c.id, {
          content: { ...c.content, retired: true },
          suspended: true,
        });
      }
    }

    // Read the deck after the deletions: they rewrite its card list.
    const deck = await db.decks.get(note.deck);
    if (!deck) return;
    for (const key of want) {
      if (have.has(key ?? "")) continue;
      await newCard(
        {
          ...createCardSkeleton(),
          note: noteId,
          content: {
            type: NoteType.Master,
            ...(key ? { sectionId: key } : {}),
          },
        } as never,
        deck
      );
    }
  });
}

/** Every master note in a deck, plus the ids of their cards (never orphans of each other). */
export async function masterCardIdsIn(deckId: string): Promise<string[]> {
  const notes = await db.notes.where("deck").equals(deckId).toArray();
  const masters = new Set(
    notes.filter((n) => n.content?.type === NoteType.Master).map((n) => n.id)
  );
  if (masters.size === 0) return [];
  const cards = await db.cards.where("deck").equals(deckId).toArray();
  return cards.filter((c) => masters.has(c.note)).map((c) => c.id);
}

/**
 * Coverage of a master: the pure engine fed from Dexie. The deck's cards are the ones directly
 * in `deckId` (sub-decks have their own masters); links to cards of other decks are allowed and
 * not reported as dangling when the card exists.
 */
export async function coverageOfMaster(
  deckId: string,
  sections: MasterSection[],
  now: number = Date.now()
) {
  const deckCards = await db.cards.where("deck").equals(deckId).toArray();
  const inDeck = new Set(deckCards.map((c) => c.id));
  const outside = linkedCardIds(sections).filter((id) => !inDeck.has(id));
  const external = outside.length
    ? (await db.cards.bulkGet(outside)).flatMap((c) => (c ? [c.id] : []))
    : [];
  return analyzeCoverage(sections, deckCards.map(toCoverageCard), {
    now,
    ignoreCardIds: await masterCardIdsIn(deckId),
    externalCardIds: external,
  });
}

/** Linked cards' FSRS state, one item per entry in order, `null` where a card is missing. */
export async function linkedStatesOf(
  sections: MasterSection[]
): Promise<(LinkedCardState | null)[]> {
  const entries = sections.flatMap((s) => s.entries);
  const ids = entries.map((e) => e.cardId).filter((x): x is string => !!x);
  const cards = await db.cards.bulkGet(ids);
  const byId = new Map(cards.flatMap((c) => (c ? [[c.id, c] as const] : [])));
  return entries.map((e) => {
    const c = e.cardId ? byId.get(e.cardId) : undefined;
    return c ? toLinkedState(c) : null;
  });
}

/**
 * Minimal builder: a new master note in `deck` with one entry per card of the deck (not counting
 * other masters' cards), linked to it. Entry text is the note's sort text; sibling cards of one
 * note get " (2/3)" so they can be told apart. One section called "Cards"; the user then groups
 * the entries. Returns the note id.
 */
export async function createMasterFromDeck(
  deck: Deck,
  title?: string
): Promise<string> {
  const cards = (await db.cards
    .where("deck")
    .equals(deck.id)
    .toArray()) as Card<NoteType>[];
  const noteIds = [...new Set(cards.map((c) => c.note))];
  const notes = await db.notes.bulkGet(noteIds);
  const noteById = new Map(
    notes.flatMap((n) => (n ? [[n.id, n] as const] : []))
  );
  const perNote = new Map<string, Card<NoteType>[]>();
  for (const c of cards) {
    if (noteById.get(c.note)?.content?.type === NoteType.Master) continue;
    perNote.set(c.note, [...(perNote.get(c.note) ?? []), c]);
  }
  const entries = [...perNote.entries()].flatMap(([noteId, list]) => {
    const text = noteById.get(noteId)?.sortField ?? "";
    return list.map((c, i) =>
      newMasterEntry(
        list.length > 1 ? `${text} (${i + 1}/${list.length})` : text,
        c.id
      )
    );
  });
  const content: MasterNoteContent = {
    title: title?.trim() || `${deck.name}: master`,
    sections: [newMasterSection("Cards", entries)],
  };
  const noteId = await newNote(deck, { type: NoteType.Master, ...content });
  await syncMasterCards(noteId);
  return noteId;
}
