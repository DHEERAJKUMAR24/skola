import type { Deck } from "./deck";

/** "Programming Languages / JavaScript / Async JavaScript" for a deck in the hierarchy. */
export function deckPath(deck: Deck, byId: Map<string, Deck>): string {
  const parents = (deck.superDecks ?? [])
    .map((id) => byId.get(id)?.name)
    .filter((n): n is string => !!n);
  return [...parents, deck.name].join(" / ");
}

/** The deck itself plus every deck below it. */
export function descendantIds(deckId: string, decks: Deck[]): Set<string> {
  const ids = new Set([deckId]);
  for (const d of decks) if (d.superDecks?.includes(deckId)) ids.add(d.id);
  return ids;
}

/** All decks with their full path, sorted so a parent is followed by its children. */
export function decksWithPaths(decks: Deck[]) {
  const byId = new Map(decks.map((d) => [d.id, d]));
  return decks
    .map((d) => ({ deck: d, path: deckPath(d, byId) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** "::" is the deck path separator used by the MCP tools. Pure: shared with the server. */
export function validateDeckName(name: string): string | null {
  if (name.includes("::")) return 'A deck name cannot contain "::"';
  if (name.length < 1 || name.length > 100)
    return "A deck name must be 1 to 100 characters";
  return null;
}
