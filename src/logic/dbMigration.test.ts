import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, it, vi } from "vitest";

it("v23 moves card.history into reviewLogs and strips the field", async () => {
  const legacy = new Dexie("skola_db");
  legacy.version(22).stores({
    cards: "id, note, deck",
    decks: "id, *cards, *notes, *subDecks, *superDecks",
    notes: "id, deck, sortField, *linkedNotes",
    statistics: "[deck+day], day",
    settings: "key",
  });
  const review = new Date("2026-01-01T00:00:00Z");
  await legacy.table("cards").add({
    id: "c1",
    deck: "d",
    note: "n",
    history: [{ rating: 3, state: 0, review, elapsed_days: 0 }],
  });
  legacy.close();

  const { db } = await import("./db");
  await db.open();
  const logs = await db.reviewLogs.toArray();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ card: "c1", rating: 3 });
  expect(logs[0].reviewedAt).toBe(review.getTime());
  expect(await db.cards.get("c1")).not.toHaveProperty("history");
});

it("v27 turns old per-day statistics into synced sessions without double counting", async () => {
  const { db: current } = await import("./db");
  current.close();
  await Dexie.delete("skola_db");

  const legacy = new Dexie("skola_db");
  legacy.version(22).stores({
    cards: "id, note, deck",
    decks: "id, *cards, *notes, *subDecks, *superDecks",
    notes: "id, deck, sortField, *linkedNotes",
    statistics: "[deck+day], day",
    settings: "key",
  });
  const totals = {
    time: { total: 90, forNew: 0, forReview: 90, forLearning: 0 },
    cards: { 0: 0, 1: 0, 2: 5, 3: 0 },
    ratingsList: [3, 3, 3, 3, 3],
  };
  await legacy
    .table("statistics")
    .add({ deck: "d1", day: "2026-10-31", ...totals });
  legacy.close();

  vi.resetModules();
  const { db: fresh } = await import("./db");
  await fresh.open();
  const sessions = await fresh.studySessions.toArray();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({
    id: "legacy-d1-2026-10-31",
    deck: "d1",
    day: "2026-10-31",
    time: { total: 90 },
  });
  expect(sessions[0].updatedAt).toBeGreaterThan(0); // stamped, so it uploads once
  expect(await fresh.statistics.count()).toBe(1); // the old table is left untouched
});
