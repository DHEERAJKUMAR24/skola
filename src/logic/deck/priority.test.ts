import { describe, expect, it } from "vitest";
import type { Deck } from "./deck";
import { isPausedDeck, withoutPaused } from "./priority";

const deck = (id: string, extra: Partial<Deck> = {}) =>
  ({ id, superDecks: [], ...extra }) as Deck;

describe("deck priority", () => {
  const parent = deck("p", { priority: "paused" });
  const child = deck("c", { superDecks: ["p"] });
  const other = deck("o");
  const byId = new Map([parent, child, other].map((d) => [d.id, d]));

  it("pauses sub-decks of a paused deck", () => {
    expect(isPausedDeck(child, byId)).toBe(true);
    expect(isPausedDeck(other, byId)).toBe(false);
  });

  it("filters paused cards but keeps them when nothing else is left", () => {
    const paused = (id: string) => isPausedDeck(byId.get(id), byId);
    expect(withoutPaused([{ deck: "c" }, { deck: "o" }], paused)).toEqual([
      { deck: "o" },
    ]);
    expect(withoutPaused([{ deck: "c" }], paused)).toEqual([{ deck: "c" }]);
  });
});
