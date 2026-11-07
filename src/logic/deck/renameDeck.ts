import { db } from "../db";
import { validateDeckName } from "./deckPath";

export async function renameDeck(id: string, newName: string) {
  const nameError = validateDeckName(newName);
  if (nameError) throw Error(nameError);
  return db.decks.update(id, { name: newName });
}
