export interface ListNoteContent {
  /** HTML question, like the front of a basic card. */
  front: string;
  /** The steps or points to recall, one string each. */
  items: string[];
  /** True when the order matters (shown as 1, 2, 3). */
  ordered: boolean;
}

export const LIST_MIN_ITEMS = 2;
export const LIST_MAX_ITEMS = 40;

// ">>>", "-", "*", "•" or "1." / "1)" at the start of a line.
const MARKER = /^\s*(?:>{2,}|[-*•–]|\d+[.)])\s*/;

/**
 * Turns typed text into list items: one item per line, with a leading `>>>`, bullet or number
 * removed, and empty lines dropped. Pasted bullet lists therefore work as they are.
 */
export function parseListText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(MARKER, "").trim())
    .filter(Boolean)
    .slice(0, LIST_MAX_ITEMS);
}

export function listToText(items: string[]) {
  return items.join("\n");
}

export function validateList(
  c: Pick<ListNoteContent, "front" | "items">
): string | null {
  if (!c.front.replace(/<[^>]*>/g, "").trim()) return "The question is empty";
  if (c.items.length < LIST_MIN_ITEMS) return "Add at least two items";
  return null;
}
