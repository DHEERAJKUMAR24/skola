import { ColorIdentifier } from "@/lib/ColorIdentifier";
import { db } from "../db";
import type { DeckFsrsOptions } from "./fsrsOptions";

export async function updateDeck(
  id: string,
  name: string,
  description?: string,
  color?: ColorIdentifier,
  fsrs?: DeckFsrsOptions
): Promise<void> {
  const current = await db.decks.get(id);
  await db.decks.update(id, {
    name,
    description,
    color,
    // Merge so the unrelated option fields (daily limits, ratio) are kept.
    ...(fsrs && current ? { options: { ...current.options, ...fsrs } } : {}),
  });
}
