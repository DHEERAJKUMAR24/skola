// Dexie side of the master builder, graph view and activities (ADR 0014). The rules are pure and
// live in builderOps, graph and activities. Nothing here touches FSRS memory (stability,
// difficulty): the only schedule change is `bringDueNow`, which moves a due date like the card
// scheduling modal does.
import { State } from "ts-fsrs";
import { Card } from "../card/card";
import { setDueDate, setSuspended } from "../card/cardControls";
import { db } from "../db";
import { linkNotes } from "../note/linkNotes";
import { Note, NoteType } from "../note/note";
import { type WeakSpot, pickWeakSpots } from "./activities";
import type { OrphanCard } from "./builderOps";
import { type GraphNoteInput } from "./graph";
import { linkedStatesOf } from "./masterCards";
import type { MasterNoteContent, MasterSection } from "./masterModel";

export type MasterNote = Note<NoteType.Master>;

export async function getMasterNote(
  noteId: string
): Promise<MasterNote | undefined> {
  const n = await db.notes.get(noteId);
  return n?.content?.type === NoteType.Master ? (n as MasterNote) : undefined;
}

/** Master notes of a deck (not its sub-decks), by title. */
export async function mastersOfDeck(deckId: string): Promise<MasterNote[]> {
  const notes = await db.notes.where("deck").equals(deckId).toArray();
  return (
    notes.filter((n) => n.content?.type === NoteType.Master) as MasterNote[]
  )
    .slice()
    .sort((a, b) => a.sortField.localeCompare(b.sortField));
}

/** Plain text of the notes behind some cards, keyed by card id. One bulk read per table. */
export async function cardTexts(
  cardIds: string[]
): Promise<Map<string, { text: string; deck: string; note: string }>> {
  const cards = (await db.cards.bulkGet([...new Set(cardIds)])).filter(
    (c): c is Card<NoteType> => !!c
  );
  const notes = await db.notes.bulkGet([...new Set(cards.map((c) => c.note))]);
  const byNote = new Map(notes.flatMap((n) => (n ? [[n.id, n] as const] : [])));
  return new Map(
    cards.map((c) => [
      c.id,
      {
        text: byNote.get(c.note)?.sortField || "(no text)",
        deck: c.deck,
        note: c.note,
      },
    ])
  );
}

/** Orphan cards with their note's text and tags, for "add all orphans as entries". */
export async function orphanCardInfos(
  cardIds: string[]
): Promise<OrphanCard[]> {
  const cards = (await db.cards.bulkGet(cardIds)).filter(
    (c): c is Card<NoteType> => !!c
  );
  const notes = await db.notes.bulkGet([...new Set(cards.map((c) => c.note))]);
  const byNote = new Map(notes.flatMap((n) => (n ? [[n.id, n] as const] : [])));
  const perNote = new Map<string, Card<NoteType>[]>();
  for (const c of cards)
    perNote.set(c.note, [...(perNote.get(c.note) ?? []), c]);
  return cards.map((c) => {
    const n = byNote.get(c.note);
    const siblings = perNote.get(c.note) ?? [];
    const base = n?.sortField || "(no text)";
    const i = siblings.indexOf(c);
    return {
      cardId: c.id,
      text:
        siblings.length > 1 ? `${base} (${i + 1}/${siblings.length})` : base,
      tags: n?.tags,
    };
  });
}

export async function unsuspendCards(cardIds: string[]) {
  for (const id of cardIds) await setSuspended(id, false);
}

/**
 * Makes cards due now so the next study session picks them up. FSRS memory (stability,
 * difficulty, reps, lapses) is kept; a new card has no schedule and is skipped. Returns how many
 * cards changed.
 */
export async function bringDueNow(cardIds: string[]): Promise<number> {
  const now = new Date();
  let n = 0;
  for (const id of new Set(cardIds)) {
    const c = await db.cards.get(id);
    if (!c || c.model.state === State.New || c.model.due <= now) continue;
    await setDueDate(id, now, now);
    n++;
  }
  return n;
}

/** The weakest linked cards of a master, weakest first. */
export async function weakSpotsOfMaster(
  noteId: string,
  limit = 25
): Promise<WeakSpot[]> {
  const note = await getMasterNote(noteId);
  if (!note) return [];
  return weakSpotsOfSections(note.content.sections, limit);
}

export async function weakSpotsOfSections(
  sections: MasterSection[],
  limit = 25
): Promise<WeakSpot[]> {
  const entries = sections.flatMap((s) => s.entries);
  const states = await linkedStatesOf(sections);
  const cands = entries.flatMap((e, i) => {
    const st = states[i];
    return e.cardId && st ? [{ cardId: e.cardId, state: st }] : [];
  });
  return pickWeakSpots(cands, Date.now(), { limit });
}

/** Cards for a weak-spot study session (see LearnView); empty when the master is gone. */
export async function weakCardsForStudy(
  noteId: string
): Promise<Card<NoteType>[]> {
  const spots = await weakSpotsOfMaster(noteId);
  const cards = await db.cards.bulkGet(spots.map((s) => s.cardId));
  return cards.filter((c): c is Card<NoteType> => !!c);
}

// ---------------------------------------------------------------------------------------------
// Graph

export interface GraphData {
  notes: GraphNoteInput[];
  cardToNote: Map<string, string>;
}

/** Everything the graph needs, in two table reads. */
export async function loadGraphData(): Promise<GraphData> {
  const [notes, cards] = await Promise.all([
    db.notes.toArray(),
    db.cards.toArray(),
  ]);
  const cardToNote = new Map(cards.map((c) => [c.id, c.note] as const));
  return {
    cardToNote,
    notes: notes.map((n) => {
      const master = n.content?.type === NoteType.Master;
      return {
        id: n.id,
        deck: n.deck,
        label: n.sortField || "(no text)",
        isMaster: master,
        linkedNotes: n.linkedNotes ?? [],
        entryCardIds: master
          ? (n.content as MasterNoteContent).sections.flatMap((s) =>
              s.entries.flatMap((e) => (e.cardId ? [e.cardId] : []))
            )
          : undefined,
      };
    }),
  };
}

/** Removes a note-level link from both sides. */
export async function unlinkNotes(noteId1: string, noteId2: string) {
  await db.transaction("rw", db.notes, async () => {
    for (const [a, b] of [
      [noteId1, noteId2],
      [noteId2, noteId1],
    ]) {
      const n = await db.notes.get(a);
      if (n?.linkedNotes?.includes(b))
        await db.notes.update(a, {
          linkedNotes: n.linkedNotes.filter((x) => x !== b),
        });
    }
  });
}

/** Clears every entry of a master that points at a card of `targetNoteId`. */
export async function unlinkMasterEntriesTo(
  masterNoteId: string,
  targetNoteId: string
): Promise<number> {
  const master = await getMasterNote(masterNoteId);
  if (!master) return 0;
  const cards = await db.cards.where("note").equals(targetNoteId).primaryKeys();
  const ids = new Set(cards);
  let changed = 0;
  const sections = master.content.sections.map((s) => ({
    ...s,
    entries: s.entries.map((e) => {
      if (!e.cardId || !ids.has(e.cardId)) return e;
      changed++;
      const { cardId: _x, ...rest } = e;
      return rest;
    }),
  }));
  if (changed)
    await db.notes.update(masterNoteId, {
      content: { ...master.content, sections },
    });
  return changed;
}

/** Links two notes (note level), whatever their decks. Throws for the same note. */
export async function linkAnyNotes(a: string, b: string) {
  if (a === b) throw new Error("A card cannot link to itself");
  await linkNotes(a, b);
}

/** The note a card belongs to. */
export async function noteOfCard(cardId: string): Promise<string | undefined> {
  return (await db.cards.get(cardId))?.note;
}
