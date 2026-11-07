import { ColorIdentifier } from "@/lib/ColorIdentifier";
import { db } from "../db";
import type { DeckOptions } from "./deck";
import { validateDeckName } from "./deckPath";

export async function updateDeck(
  id: string,
  name: string,
  description?: string,
  color?: ColorIdentifier,
  fsrs?: Partial<DeckOptions>
): Promise<void> {
  const nameError = validateDeckName(name);
  if (nameError) throw Error(nameError);
  const current = await db.decks.get(id);
  await db.decks.update(id, {
    name,
    description,
    color,
    // Merge so the unrelated option fields (daily limits, ratio) are kept.
    ...(fsrs && current
      ? { options: withoutUndefined({ ...current.options, ...fsrs }) }
      : {}),
  });
}

/** Saved options never carry empty keys; an unset exam date really is gone. */
function withoutUndefined<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined)
  ) as T;
}
