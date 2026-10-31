import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, it } from "vitest";

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
