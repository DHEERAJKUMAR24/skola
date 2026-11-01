import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { db } from "./db";
import { LOCAL_CHANGE_EVENT } from "./syncTracking";

it("stamps updatedAt on create/update and tombstones deletes", async () => {
  await db.decks.add({ id: "d1" } as never);
  const created = (await db.decks.get("d1")) as unknown as {
    updatedAt?: number;
  };
  expect(created.updatedAt).toBeGreaterThan(0);

  await new Promise((r) => setTimeout(r, 5));
  await db.decks.update("d1", { name: "x" } as never);
  const updated = (await db.decks.get("d1")) as unknown as {
    updatedAt: number;
  };
  expect(updated.updatedAt).toBeGreaterThan(created.updatedAt as number);

  await db.decks.delete("d1");
  await new Promise((r) => setTimeout(r, 20));
  expect(await db.tombstones.get("d1")).toMatchObject({ table: "decks" });
});

it("flags every synced table as a local change, settings and presets included", async () => {
  let events = 0;
  const count = () => events++;
  window.addEventListener(LOCAL_CHANGE_EVENT, count);
  const step = async (fn: () => Promise<unknown>) => {
    const before = events;
    await fn();
    expect(events).toBeGreaterThan(before);
  };

  await step(() => db.notes.add({ id: "n1" } as never));
  await step(() => db.cards.add({ id: "c1" } as never));
  await step(() => db.presets.add({ id: "p1", name: "P" } as never));
  await step(() => db.settings.put({ key: "#language", value: "en" } as never));
  // A second put on an existing key is an update, which must also be flagged and re-stamped.
  const first = (await db.settings.get("#language")) as unknown as {
    updatedAt: number;
  };
  await new Promise((r) => setTimeout(r, 5));
  await step(() => db.settings.put({ key: "#language", value: "de" } as never));
  const second = (await db.settings.get("#language")) as unknown as {
    updatedAt: number;
  };
  expect(second.updatedAt).toBeGreaterThan(first.updatedAt);

  await step(() => db.notes.delete("n1"));
  await step(() => db.settings.delete("#language"));
  await new Promise((r) => setTimeout(r, 20));
  expect(await db.tombstones.get("n1")).toMatchObject({ table: "notes" });
  expect(await db.tombstones.get("#language")).toMatchObject({
    table: "settings",
  });
  window.removeEventListener(LOCAL_CHANGE_EVENT, count);
});
