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
