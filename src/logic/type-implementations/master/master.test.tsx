import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import { State } from "ts-fsrs";
import { beforeEach, describe, expect, it } from "vitest";
import { getAdapterOfType } from "../../NoteTypeAdapter";
import { Card } from "../../card/card";
import { db } from "../../db";
import { Deck } from "../../deck/deck";
import { newDeck } from "../../deck/newDeck";
import {
  coverageOfMaster,
  createMasterFromDeck,
  linkedStatesOf,
  masterCardIdsIn,
  syncMasterCards,
} from "../../master/masterCards";
import {
  type MasterSection,
  newMasterEntry,
  newMasterSection,
} from "../../master/masterModel";
import { suggestMasterRating } from "../../master/suggestRating";
import { NoteType } from "../../note/note";
import { BasicNoteTypeAdapter } from "../normal/BasicNote";

const adapter = getAdapterOfType(NoteType.Master);
const entries = (n: number, prefix = "e") =>
  Array.from({ length: n }, (_, i) => newMasterEntry(`${prefix}${i}`));

describe("master note type in the database", () => {
  let deck: Deck;
  const cardsOf = (noteId: string) =>
    db.cards.where("note").equals(noteId).toArray() as Promise<
      Card<NoteType.Master>[]
    >;
  const reload = async () => {
    deck = (await db.decks.get(deck.id)) as Deck;
    return deck;
  };

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    const id = await newDeck("Test");
    deck = (await db.decks.get(id)) as Deck;
  });

  it("a small master is one card and stores sections and entries", async () => {
    const noteId = (await adapter.createNote(
      {
        title: " Closures ",
        sections: [
          newMasterSection("A", [
            newMasterEntry("x", "c1"),
            newMasterEntry(" "),
          ]),
        ],
      },
      deck
    )) as string;
    const note = (await db.notes.get(noteId)) as never as {
      content: { type: string; title: string; sections: MasterSection[] };
      sortField: string;
    };
    expect(note.content.type).toBe("master");
    expect(note.content.title).toBe("Closures");
    expect(note.content.sections[0].entries).toHaveLength(1);
    expect(note.content.sections[0].entries[0].cardId).toBe("c1");
    expect(note.sortField).toBe("Closures");
    const cards = await cardsOf(noteId);
    expect(cards).toHaveLength(1);
    expect(cards[0].content.sectionId).toBeUndefined();
    expect((await reload()).cards).toContain(cards[0].id);
  });

  it("rejects an empty master", async () => {
    await expect(
      adapter.createNote({ title: "", sections: [] }, deck)
    ).rejects.toThrow(/name/);
    await expect(
      adapter.createNote(
        { title: "T", sections: [newMasterSection("A", [])] },
        deck
      )
    ).rejects.toThrow(/entry/);
  });

  it("above 12 entries: one card per top-level section", async () => {
    const s = [
      newMasterSection("A", entries(7)),
      newMasterSection("B", entries(6)),
    ];
    const noteId = (await adapter.createNote(
      { title: "Big", sections: s },
      deck
    )) as string;
    const cards = await cardsOf(noteId);
    expect(cards.map((c) => c.content.sectionId).sort()).toEqual(
      s.map((x) => x.id).sort()
    );
  });

  it("editing keeps cards that stay, adds new ones and deletes unreviewed leftovers", async () => {
    const a = newMasterSection("A", entries(5));
    const b = newMasterSection("B", entries(5));
    const noteId = (await adapter.createNote(
      { title: "T", sections: [a, b] },
      deck
    )) as string;
    expect(await cardsOf(noteId)).toHaveLength(1);
    const wholeId = (await cardsOf(noteId))[0].id;

    // grow past 12: the whole-master card was never reviewed, so it is replaced by 2 section cards
    const note = (await db.notes.get(noteId)) as never;
    await adapter.updateNote(
      { title: "T", sections: [{ ...a, entries: entries(8) }, b] },
      note
    );
    let cards = await cardsOf(noteId);
    expect(cards.map((c) => c.content.sectionId).sort()).toEqual(
      [a.id, b.id].sort()
    );
    expect(cards.find((c) => c.id === wholeId)).toBeUndefined();
    expect((await reload()).cards).not.toContain(wholeId);
    const aCard = cards.find((c) => c.content.sectionId === a.id)?.id;

    // shrink again: section cards are unreviewed, a whole card appears, ids of old ones go
    await adapter.updateNote(
      { title: "T", sections: [{ ...a, entries: entries(2) }, b] },
      (await db.notes.get(noteId)) as never
    );
    cards = await cardsOf(noteId);
    expect(cards).toHaveLength(1);
    expect(cards[0].content.sectionId).toBeUndefined();
    expect(cards.find((c) => c.id === aCard)).toBeUndefined();
  });

  it("a reviewed card that the plan drops is suspended and retired, and returns when wanted again", async () => {
    const a = newMasterSection("A", entries(7));
    const b = newMasterSection("B", entries(7));
    const noteId = (await adapter.createNote(
      { title: "T", sections: [a, b] },
      deck
    )) as string;
    const bCard = (await cardsOf(noteId)).find(
      (c) => c.content.sectionId === b.id
    ) as Card<NoteType.Master>;
    await db.cards.update(bCard.id, {
      model: { ...bCard.model, state: State.Review, reps: 3, stability: 5 },
    });

    // remove section B: its card has history, so it stays, suspended
    await adapter.updateNote(
      { title: "T", sections: [a] },
      (await db.notes.get(noteId)) as never
    );
    let kept = (await db.cards.get(bCard.id)) as Card<NoteType.Master>;
    expect(kept.suspended).toBe(true);
    expect(kept.content.retired).toBe(true);
    expect(kept.model.reps).toBe(3);

    // section A alone: single whole card exists; B's card is not touched again
    await syncMasterCards(noteId);
    kept = (await db.cards.get(bCard.id)) as Card<NoteType.Master>;
    expect(kept.suspended).toBe(true);

    // bring B back with enough entries: card returns, un-suspended, schedule intact
    await adapter.updateNote(
      { title: "T", sections: [a, b] },
      (await db.notes.get(noteId)) as never
    );
    kept = (await db.cards.get(bCard.id)) as Card<NoteType.Master>;
    expect(kept.suspended).toBe(false);
    expect(kept.content.retired).toBe(false);
    expect(kept.model.reps).toBe(3);
  });

  it("ignores a half-finished edit", async () => {
    const noteId = (await adapter.createNote(
      { title: "T", sections: [newMasterSection("A", entries(2))] },
      deck
    )) as string;
    await adapter.updateNote(
      { title: "", sections: [] },
      (await db.notes.get(noteId)) as never
    );
    const note = (await db.notes.get(noteId)) as never as {
      content: { title: string };
    };
    expect(note.content.title).toBe("T");
  });

  it("syncMasterCards is idempotent", async () => {
    const noteId = (await adapter.createNote(
      { title: "T", sections: [newMasterSection("A", entries(2))] },
      deck
    )) as string;
    await syncMasterCards(noteId);
    await syncMasterCards(noteId);
    expect(await cardsOf(noteId)).toHaveLength(1);
  });

  it("creates a master from a deck: one linked entry per card, siblings numbered", async () => {
    await BasicNoteTypeAdapter.createNote(
      { front: "<p>Alpha</p>", back: "<p>a</p>" },
      deck
    );
    await BasicNoteTypeAdapter.createNote(
      { front: "<p>Beta</p>", back: "<p>b</p>" },
      deck
    );
    const cloze = getAdapterOfType(NoteType.Cloze);
    await cloze.createNote(
      { text: "{{c1::one}} and {{c2::two}}", occlusionNumberSet: [1, 2] },
      deck
    );
    const noteId = await createMasterFromDeck(await reload());
    const note = (await db.notes.get(noteId)) as never as {
      content: { title: string; sections: MasterSection[] };
    };
    const texts = note.content.sections[0].entries.map((e) => e.text);
    expect(texts).toHaveLength(4);
    expect(texts).toContain("Alpha");
    expect(texts.filter((t) => /\(\d\/2\)$/.test(t))).toHaveLength(2);
    expect(note.content.sections[0].entries.every((e) => e.cardId)).toBe(true);
    expect(note.content.title).toBe("Test: master");

    const report = await coverageOfMaster(deck.id, note.content.sections);
    expect(report.orphanCards).toEqual([]);
    expect(report.danglingEntries).toEqual([]);
    expect(report.complete).toBe(true);
    // the master's own card is not an orphan of itself
    expect(await masterCardIdsIn(deck.id)).toHaveLength(1);
    // never reviewed cards are stale
    expect(report.staleEntries).toHaveLength(4);
  });

  it("coverage sees orphans, dangling links and cross-deck links", async () => {
    await BasicNoteTypeAdapter.createNote(
      { front: "<p>One</p>", back: "<p>1</p>" },
      deck
    );
    await BasicNoteTypeAdapter.createNote(
      { front: "<p>Two</p>", back: "<p>2</p>" },
      deck
    );
    const otherId = await newDeck("Other");
    const other = (await db.decks.get(otherId)) as Deck;
    await BasicNoteTypeAdapter.createNote(
      { front: "<p>Far</p>", back: "<p>f</p>" },
      other
    );
    const [first] = await db.cards.where("deck").equals(deck.id).toArray();
    const [far] = await db.cards.where("deck").equals(other.id).toArray();

    const sections = [
      newMasterSection("A", [
        newMasterEntry("one", first.id),
        newMasterEntry("far away", far.id),
        newMasterEntry("ghost", "does-not-exist"),
        newMasterEntry("loose idea"),
      ]),
      newMasterSection("Empty", []),
    ];
    const r = await coverageOfMaster(deck.id, sections);
    expect(r.orphanCards).toHaveLength(1);
    expect(r.danglingEntries.map((d) => d.cardId)).toEqual(["does-not-exist"]);
    expect(r.unlinkedEntries).toHaveLength(1);
    expect(r.emptySections).toEqual([sections[1].id]);
    expect(r.complete).toBe(false);
  });

  it("linkedStatesOf feeds the suggested rating, null for missing cards", async () => {
    await BasicNoteTypeAdapter.createNote(
      { front: "<p>One</p>", back: "<p>1</p>" },
      deck
    );
    const [c] = await db.cards.where("deck").equals(deck.id).toArray();
    const now = Date.now();
    await db.cards.update(c.id, {
      model: {
        ...c.model,
        state: State.Review,
        stability: 200,
        reps: 5,
        last_review: new Date(now - 86_400_000),
        due: new Date(now + 86_400_000),
      },
    });
    const sections = [
      newMasterSection("A", [
        newMasterEntry("one", c.id),
        newMasterEntry("gone", "nope"),
      ]),
    ];
    const states = await linkedStatesOf(sections);
    expect(states[0]?.stability).toBe(200);
    expect(states[1]).toBeNull();
    const s = suggestMasterRating(states, now);
    expect(s.counts.unlinked).toBe(1);
    expect(s.score).toBeCloseTo(0.5, 1);
  });

  it("shows the question and the answer", async () => {
    const s = [newMasterSection("Basics", [newMasterEntry("closures")])];
    const noteId = (await adapter.createNote(
      { title: "JS <core>", sections: s },
      deck
    )) as string;
    const note = (await db.notes.get(noteId)) as never;
    const [card] = await cardsOf(noteId);
    const q = render(
      adapter.displayQuestion(card, (note as { content: never }).content)
    );
    expect(q.container.textContent).toContain(
      "Recall everything in: JS <core>"
    );
    q.unmount();
    render(adapter.displayAnswer(card, (note as { content: never }).content));
    expect(await screen.findByText("closures")).toBeTruthy();
    expect(await screen.findByText("Suggested rating:")).toBeTruthy();
  });
});
