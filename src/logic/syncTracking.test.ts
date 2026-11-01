import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { db } from "./db";

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
