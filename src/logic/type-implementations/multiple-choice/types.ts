export interface MultipleChoiceOption {
  text: string;
  correct: boolean;
}

export interface MultipleChoiceNoteContent {
  /** HTML, like the front of a basic card. */
  question: string;
  choices: MultipleChoiceOption[];
  /** HTML shown after the answer is revealed. */
  explanation?: string;
}

export type MultipleChoiceCardContent = {};

export const MC_MIN_CHOICES = 2;
export const MC_MAX_CHOICES = 8;

const plain = (html: string) => html.replace(/<[^>]*>/g, "").trim();

/** Returns what is wrong with a multiple-choice note, or null when it is fine to save. */
export function validateMultipleChoice(
  c: Pick<MultipleChoiceNoteContent, "question" | "choices">
): string | null {
  if (!plain(c.question)) return "The question is empty";
  const filled = c.choices.filter((o) => o.text.trim());
  if (filled.length < MC_MIN_CHOICES) return "Add at least two choices";
  if (c.choices.length > MC_MAX_CHOICES)
    return `At most ${MC_MAX_CHOICES} choices`;
  if (!filled.some((o) => o.correct)) return "Mark at least one correct choice";
  return null;
}

/** Drops empty choices, so a half-typed row never reaches the saved note. */
export function cleanChoices(choices: MultipleChoiceOption[]) {
  return choices
    .map((o) => ({ text: o.text.trim(), correct: !!o.correct }))
    .filter((o) => o.text);
}

/**
 * A stable shuffle seeded by the card id, so the choices keep their order between the question and
 * the answer side but differ from card to card.
 */
export function shuffledOrder(count: number, seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
