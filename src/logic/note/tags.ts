import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";

export const MAX_TAG_LENGTH = 40;

/** Lowercase, spaces become dashes, odd characters dropped: "Event Loop!" is "event-loop". */
export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_:/.-]/gu, "")
    .slice(0, MAX_TAG_LENGTH);
}

export function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

export async function setNoteTags(noteId: string, tags: string[]) {
  const clean = normalizeTags(tags);
  if (clean.length) await db.notes.update(noteId, { tags: clean });
  else
    await db.notes
      .where("id")
      .equals(noteId)
      .modify((n) => {
        n.tags = undefined;
      });
}

export async function addTag(noteId: string, tag: string) {
  const note = await db.notes.get(noteId);
  if (note) await setNoteTags(noteId, [...(note.tags ?? []), tag]);
}

export async function removeTag(noteId: string, tag: string) {
  const note = await db.notes.get(noteId);
  if (note)
    await setNoteTags(
      noteId,
      (note.tags ?? []).filter((t) => t !== normalizeTag(tag))
    );
}

/** Every tag in use with how many notes carry it, most used first. */
export async function getAllTags(): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>();
  for (const tag of (await db.notes.orderBy("tags").keys()) as string[])
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function useAllTags() {
  return useLiveQuery(getAllTags, []);
}
