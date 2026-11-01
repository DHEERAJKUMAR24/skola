import type { Deck } from "./deck";

/** A deck is paused when it or any ancestor is; paused decks sit out of spaced-repetition sessions. */
export function isPausedDeck(
  deck: Deck | undefined,
  decksById: Map<string, Deck>
): boolean {
  if (!deck) return false;
  return [deck.id, ...(deck.superDecks ?? [])].some(
    (id) => decksById.get(id)?.priority === "paused"
  );
}

/** Drops cards of paused decks, unless that would leave nothing (studying a paused deck directly). */
export function withoutPaused<T extends { deck: string }>(
  cards: T[],
  isPaused: (deckId: string) => boolean
): T[] {
  const active = cards.filter((c) => !isPaused(c.deck));
  return active.length ? active : cards;
}
