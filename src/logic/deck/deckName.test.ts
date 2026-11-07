import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { db } from "../db";
import { validateDeckName } from "./deckPath";
import { newDeck } from "./newDeck";
import { renameDeck } from "./renameDeck";
import { updateDeck } from "./updateDeck";

describe("deck names", () => {
  it("validateDeckName accepts and rejects", () => {
    expect(validateDeckName("Biology")).toBeNull();
    expect(validateDeckName("a".repeat(100))).toBeNull();
    expect(validateDeckName("A::B")).toContain("::");
    expect(validateDeckName("")).toEqual(expect.any(String));
    expect(validateDeckName("a".repeat(101))).toEqual(expect.any(String));
  });

  it("newDeck, renameDeck and updateDeck reject '::'", async () => {
    await expect(newDeck("A::B")).rejects.toThrow("::");
    const id = await newDeck("Ok");
    await expect(renameDeck(id, "A::B")).rejects.toThrow("::");
    await expect(updateDeck(id, "A::B")).rejects.toThrow("::");
    expect((await db.decks.get(id))?.name).toBe("Ok");
  });

  it("updateDeck validates only when the name changes", async () => {
    const id = await newDeck("Ok");
    await db.decks.update(id, { name: "A::B" }); // legacy name
    await updateDeck(id, "A::B", "new description");
    const d = await db.decks.get(id);
    expect(d?.name).toBe("A::B");
    expect(d?.description).toBe("new description");
    await expect(updateDeck(id, "C::D")).rejects.toThrow("::");
  });
});
