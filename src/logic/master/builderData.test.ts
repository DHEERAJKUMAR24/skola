import "fake-indexeddb/auto";
import { State } from "ts-fsrs";
import { beforeEach, describe, expect, it } from "vitest";
import { getAdapterOfType } from "../NoteTypeAdapter";
import { Card } from "../card/card";
import { db } from "../db";
import { Deck } from "../deck/deck";
import { newDeck } from "../deck/newDeck";
import { linkNotes } from "../note/linkNotes";
import { NoteType } from "../note/note";
import { BasicNoteTypeAdapter } from "../type-implementations/normal/BasicNote";
import {
  bringDueNow,
  loadGraphData,
  mastersOfDeck,
  orphanCardInfos,
  unlinkMasterEntriesTo,
  unlinkNotes,
  weakCardsForStudy,
  weakSpotsOfMaster,
} from "./builderData";
import { buildGraph } from "./graph";
import { newMasterEntry, newMasterSection } from "./masterModel";

const DAY = 86_400_000;

describe("master builder data layer", () => {
  let deck: Deck;
  let other: Deck;
  const basic = async (d: Deck, front: string, tags?: string[]) => {
    const id = (await BasicNoteTypeAdapter.createNote(
      { front, back: "b" } as never,
      d
    )) as string;
    if (tags) await db.notes.update(id, { tags });
    const card = (await db.cards
      .where("note")
      .equals(id)
      .first()) as Card<NoteType>;
    return { noteId: id, cardId: card.id };
  };
  const reviewed = (cardId: string, stability: number, daysAgo: number) =>
    db.cards.update(cardId, {
      model: {
        state: State.Review,
        stability,
        difficulty: 5,
        due: new Date(Date.now() - DAY),
        last_review: new Date(Date.now() - daysAgo * DAY),
        reps: 5,
        lapses: 1,
        elapsed_days: 0,
        scheduled_days: 1,
        learning_steps: 0,
      } as never,
    });

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    deck = (await db.decks.get(await newDeck("A"))) as Deck;
    other = (await db.decks.get(await newDeck("B"))) as Deck;
  });

  it("lists masters of a deck and orphan infos with sibling suffix and tags", async () => {
    const a = await basic(deck, "alpha", ["js"]);
    const noteId = (await getAdapterOfType(NoteType.Master).createNote(
      {
        title: "M",
        sections: [newMasterSection("S", [newMasterEntry("x", a.cardId)])],
      },
      deck
    )) as string;
    expect((await mastersOfDeck(deck.id)).map((m) => m.id)).toEqual([noteId]);
    expect(await mastersOfDeck(other.id)).toEqual([]);
    const infos = await orphanCardInfos([a.cardId]);
    expect(infos).toEqual([{ cardId: a.cardId, text: "alpha", tags: ["js"] }]);
  });

  it("weak spots rank the master's weakest linked cards; study set follows", async () => {
    const weak = await basic(deck, "weak");
    const strong = await basic(deck, "strong");
    const fresh = await basic(deck, "fresh");
    await reviewed(weak.cardId, 2, 30);
    await reviewed(strong.cardId, 400, 1);
    const noteId = (await getAdapterOfType(NoteType.Master).createNote(
      {
        title: "M",
        sections: [
          newMasterSection("S", [
            newMasterEntry("w", weak.cardId),
            newMasterEntry("s", strong.cardId),
            newMasterEntry("f", fresh.cardId),
            newMasterEntry("no card"),
          ]),
        ],
      },
      deck
    )) as string;
    const spots = await weakSpotsOfMaster(noteId);
    expect(spots.map((s) => s.cardId)).toEqual([weak.cardId, fresh.cardId]);
    const cards = await weakCardsForStudy(noteId);
    expect(cards.map((c) => c.id)).toEqual([weak.cardId, fresh.cardId]);
    expect(await weakCardsForStudy("missing")).toEqual([]);
  });

  it("bringDueNow moves only the due date and skips new cards", async () => {
    const a = await basic(deck, "a");
    const b = await basic(deck, "b");
    await reviewed(a.cardId, 10, 3);
    await db.cards.update(a.cardId, {
      model: {
        ...((await db.cards.get(a.cardId)) as Card<NoteType>).model,
        due: new Date(Date.now() + 5 * DAY),
      },
    });
    const before = (await db.cards.get(a.cardId)) as Card<NoteType>;
    expect(await bringDueNow([a.cardId, b.cardId])).toBe(1);
    const after = (await db.cards.get(a.cardId)) as Card<NoteType>;
    expect(after.model.due.getTime()).toBeLessThanOrEqual(Date.now());
    expect(after.model.stability).toBe(before.model.stability);
    expect(after.model.difficulty).toBe(before.model.difficulty);
    expect(after.model.reps).toBe(before.model.reps);
    expect(after.model.lapses).toBe(before.model.lapses);
    expect(((await db.cards.get(b.cardId)) as Card<NoteType>).model.state).toBe(
      State.New
    );
  });

  it("graph data covers note links across decks and master entry links; unlink works", async () => {
    const a = await basic(deck, "a");
    const b = await basic(other, "b");
    const c = await basic(other, "c");
    await linkNotes(a.noteId, b.noteId);
    const masterId = (await getAdapterOfType(NoteType.Master).createNote(
      {
        title: "M",
        sections: [newMasterSection("S", [newMasterEntry("x", c.cardId)])],
      },
      deck
    )) as string;

    const data = await loadGraphData();
    const g = buildGraph(data.notes, data.cardToNote);
    expect(g.edges.map((e) => e.kind).sort()).toEqual(["entry", "link"]);
    const scoped = buildGraph(data.notes, data.cardToNote, {
      deckIds: new Set([deck.id]),
    });
    expect(scoped.nodes.map((n) => n.id).sort()).toEqual(
      [a.noteId, b.noteId, c.noteId, masterId].sort()
    );
    expect(scoped.nodes.find((n) => n.id === b.noteId)?.inScope).toBe(false);

    await unlinkNotes(a.noteId, b.noteId);
    expect((await db.notes.get(a.noteId))?.linkedNotes).toEqual([]);
    expect((await db.notes.get(b.noteId))?.linkedNotes).toEqual([]);
    expect(await unlinkMasterEntriesTo(masterId, c.noteId)).toBe(1);
    const after = await loadGraphData();
    expect(buildGraph(after.notes, after.cardToNote).edges).toEqual([]);
    expect(await unlinkMasterEntriesTo(masterId, c.noteId)).toBe(0);
  });
});
