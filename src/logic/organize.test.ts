import "fake-indexeddb/auto";
import { Rating, State, default_w } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import {
  buryCard,
  resetCard,
  setCardOverride,
  setDueDate,
  setSuspended,
} from "./card/cardControls";
import { updateCardModel } from "./card/updateCardModel";
import { db } from "./db";
import { newDeck } from "./deck/newDeck";
import { moveNote } from "./note/moveNote";
import { moveNotes } from "./note/moveNotes";
import {
  addTag,
  getAllTags,
  normalizeTag,
  removeTag,
  setNoteTags,
} from "./note/tags";
import { isStudyable, scheduleCard } from "./scheduling/policy";
import { BasicNoteTypeAdapter } from "./type-implementations/normal/BasicNote";

const GLOBAL = { retention: 0.9, maximumInterval: 36500, w: [...default_w] };

async function makeDeck(
  name: string,
  opts: Parameters<typeof newDeck>[4] = undefined
) {
  const id = await newDeck(name, undefined, undefined, undefined, opts);
  return id;
}

async function makeNote(deckId: string, front: string) {
  const deck = await db.decks.get(deckId);
  const noteId = (await BasicNoteTypeAdapter.createNote(
    { front, back: `${front} answer` },
    deck as never
  )) as string;
  const card = await db.cards.where("note").equals(noteId).first();
  return { noteId, cardId: (card as { id: string }).id };
}

async function study(cardId: string, rating: 1 | 2 | 3 | 4, at: Date) {
  const card = await db.cards.get(cardId);
  if (!card) throw new Error("no card");
  const rec = scheduleCard(card.model, {
    deckOptions: (await db.decks.get(card.deck))?.options,
    global: GLOBAL,
    newDayStartHour: 4,
    now: at,
  });
  await updateCardModel(card, rec[rating].card, rec[rating].log);
}

const T = (d: number) => new Date(Date.UTC(2026, 0, 1 + d, 12, 0, 0));

describe("moving and organizing keeps FSRS tracking", () => {
  it("moving a note keeps the card id, its FSRS state and its whole review history", async () => {
    const a = await makeDeck("A");
    const b = await makeDeck("B");
    const { noteId, cardId } = await makeNote(a, "What is a closure?");
    await study(cardId, Rating.Good, T(0));
    await study(cardId, Rating.Good, T(3));
    await study(cardId, Rating.Hard, T(9));

    const before = await db.cards.get(cardId);
    const logsBefore = await db.reviewLogs
      .where("card")
      .equals(cardId)
      .toArray();
    expect(logsBefore).toHaveLength(3);
    expect(before?.model.reps).toBeGreaterThanOrEqual(3);

    await moveNote({ note: noteId, newDeck: b });

    const after = await db.cards.get(cardId);
    expect(after?.deck).toBe(b);
    expect(after?.id).toBe(cardId);
    expect(after?.model).toEqual(before?.model); // stability, difficulty, due, reps, lapses, state
    const logsAfter = await db.reviewLogs
      .where("card")
      .equals(cardId)
      .toArray();
    expect(logsAfter.map((l) => l.id).sort()).toEqual(
      logsBefore.map((l) => l.id).sort()
    );

    expect((await db.decks.get(a))?.cards).not.toContain(cardId);
    expect((await db.decks.get(b))?.cards).toContain(cardId);
    expect((await db.notes.get(noteId))?.deck).toBe(b);
  });

  it("moves several notes at once without touching any card's state", async () => {
    const a = await makeDeck("Bulk A");
    const b = await makeDeck("Bulk B");
    const items = [
      await makeNote(a, "q1"),
      await makeNote(a, "q2"),
      await makeNote(a, "q3"),
    ];
    for (const [i, it] of items.entries())
      await study(it.cardId, Rating.Good, T(i));
    const before = await Promise.all(items.map((i) => db.cards.get(i.cardId)));

    await moveNotes(
      items.map((i) => i.noteId),
      b
    );

    const after = await Promise.all(items.map((i) => db.cards.get(i.cardId)));
    expect(after.map((c) => c?.model)).toEqual(before.map((c) => c?.model));
    expect(after.every((c) => c?.deck === b)).toBe(true);
    expect((await db.decks.get(a))?.notes).toHaveLength(0);
    expect((await db.decks.get(b))?.notes).toHaveLength(3);
  });

  it("the new deck's settings apply to future reviews, not to the stored state", async () => {
    const exact = await makeDeck("Exact", {
      schedulingMode: "exact",
      enableFuzz: false,
    });
    const daily = await makeDeck("Daily", {
      schedulingMode: "daily",
      enableFuzz: false,
    });
    const { noteId, cardId } = await makeNote(exact, "q");
    await study(cardId, Rating.Good, T(0));
    const stored = (await db.cards.get(cardId))?.model;

    await moveNote({ note: noteId, newDeck: daily });
    expect((await db.cards.get(cardId))?.model).toEqual(stored);

    const card = await db.cards.get(cardId);
    const next = scheduleCard(card!.model, {
      deckOptions: (await db.decks.get(daily))?.options,
      global: GLOBAL,
      newDayStartHour: 4,
      now: T(1),
    });
    expect(next[Rating.Good].card.due.getHours()).toBe(4); // whole-day rule of the new deck
  });
});

describe("card-level controls", () => {
  it("suspending and burying hide a card but keep its state", async () => {
    const d = await makeDeck("Controls");
    const { cardId } = await makeNote(d, "q");
    await study(cardId, Rating.Good, T(0));
    const model = (await db.cards.get(cardId))?.model;
    const now = new Date();

    await setSuspended(cardId, true);
    expect(isStudyable((await db.cards.get(cardId))!, now)).toBe(false);
    await setSuspended(cardId, false);
    expect(isStudyable((await db.cards.get(cardId))!, now)).toBe(true);

    await buryCard(cardId, now.getTime() + 86_400_000);
    expect(isStudyable((await db.cards.get(cardId))!, now)).toBe(false);
    await buryCard(cardId, null);
    expect(isStudyable((await db.cards.get(cardId))!, now)).toBe(true);
    expect((await db.cards.get(cardId))?.model).toEqual(model);
  });

  it("rescheduling by hand moves only the due date and logs it", async () => {
    const d = await makeDeck("Resched");
    const { cardId } = await makeNote(d, "q");
    await study(cardId, Rating.Good, T(0));
    await study(cardId, Rating.Good, T(2));
    const before = (await db.cards.get(cardId))!.model;
    const logs = await db.reviewLogs.where("card").equals(cardId).count();
    const newDue = new Date(T(2).getTime() + 30 * 86_400_000);

    await setDueDate(cardId, newDue, T(2));

    const after = (await db.cards.get(cardId))!.model;
    expect(after.due.getTime()).toBe(newDue.getTime());
    expect(after.stability).toBe(before.stability);
    expect(after.difficulty).toBe(before.difficulty);
    expect(after.reps).toBe(before.reps);
    expect(after.lapses).toBe(before.lapses);
    const all = await db.reviewLogs.where("card").equals(cardId).toArray();
    expect(all).toHaveLength(logs + 1);
    expect(all.filter((l) => l.rating === Rating.Manual)).toHaveLength(1);
  });

  it("a new card cannot be rescheduled; resetting a card keeps its history", async () => {
    const d = await makeDeck("Reset");
    const { cardId } = await makeNote(d, "q");
    await expect(setDueDate(cardId, new Date())).rejects.toThrow("new card");

    await study(cardId, Rating.Good, T(0));
    await study(cardId, Rating.Easy, T(1));
    const logs = await db.reviewLogs.where("card").equals(cardId).count();

    await resetCard(cardId, T(5));

    const m = (await db.cards.get(cardId))!.model;
    expect(m.state).toBe(State.New);
    expect(m.reps).toBe(0);
    expect(await db.reviewLogs.where("card").equals(cardId).count()).toBe(
      logs + 1
    );
  });

  it("per-card retention override is validated, stored and clearable", async () => {
    const d = await makeDeck("Override");
    const { cardId } = await makeNote(d, "q");
    await expect(
      setCardOverride(cardId, { desiredRetention: 0.5 })
    ).rejects.toThrow("between 70%");
    await expect(
      setCardOverride(cardId, { maximumInterval: 0 })
    ).rejects.toThrow("whole days");

    await setCardOverride(cardId, {
      desiredRetention: 0.97,
      maximumInterval: 30,
    });
    expect((await db.cards.get(cardId))?.fsrsOverride).toEqual({
      desiredRetention: 0.97,
      maximumInterval: 30,
    });
    await setCardOverride(cardId, undefined);
    expect((await db.cards.get(cardId))?.fsrsOverride).toBeUndefined();
  });
});

describe("tags", () => {
  it("normalizes tags", () => {
    expect(normalizeTag("  Event Loop! ")).toBe("event-loop");
    expect(normalizeTag("Async/Await")).toBe("async/await");
    expect(normalizeTag("###")).toBe("");
  });

  it("sets, adds, removes, counts and finds notes by tag", async () => {
    const d = await makeDeck("Tags");
    const n1 = await makeNote(d, "t1");
    const n2 = await makeNote(d, "t2");

    await setNoteTags(n1.noteId, ["Closures", "closures", "Hard Mode"]);
    await addTag(n1.noteId, "async");
    await setNoteTags(n2.noteId, ["async"]);

    expect((await db.notes.get(n1.noteId))?.tags).toEqual([
      "closures",
      "hard-mode",
      "async",
    ]);
    expect(await getAllTags()).toEqual([
      { tag: "async", count: 2 },
      { tag: "closures", count: 1 },
      { tag: "hard-mode", count: 1 },
    ]);
    expect(
      (await db.notes.where("tags").equals("async").toArray())
        .map((n) => n.id)
        .sort()
    ).toEqual([n1.noteId, n2.noteId].sort());

    await removeTag(n1.noteId, "Async");
    await setNoteTags(n2.noteId, []);
    expect((await db.notes.get(n2.noteId))?.tags).toBeUndefined();
    expect((await getAllTags()).find((t) => t.tag === "async")).toBeUndefined();
  });

  it("tags survive moving a note", async () => {
    const a = await makeDeck("Tag A");
    const b = await makeDeck("Tag B");
    const n = await makeNote(a, "t3");
    await setNoteTags(n.noteId, ["keepme"]);
    await moveNote({ note: n.noteId, newDeck: b });
    expect((await db.notes.get(n.noteId))?.tags).toEqual(["keepme"]);
  });
});
