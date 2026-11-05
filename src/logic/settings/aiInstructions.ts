// Pure on purpose: the settings page and the MCP server share these rules. No Dexie, no Node APIs.

/** Synced setting that holds the user's standing instructions for AI assistants. */
export const AI_INSTRUCTIONS_KEY = "#aiInstructions";

/** What a user may save. Roughly a page of text. */
export const AI_INSTRUCTIONS_MAX = 4000;

/**
 * How much goes straight into the MCP session start. Clients keep that in context every time, so
 * the rest is read on demand with get_instructions.
 */
export const AI_INSTRUCTIONS_INLINE_MAX = 1500;

export function normalizeInstructions(text: unknown): string {
  if (typeof text !== "string") return "";
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateInstructions(text: string): string | null {
  if (text.length > AI_INSTRUCTIONS_MAX)
    return `Instructions can be at most ${AI_INSTRUCTIONS_MAX} characters (now ${text.length}).`;
  return null;
}

/** The part shown at session start, cut at a line end where possible. */
export function inlineInstructions(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= AI_INSTRUCTIONS_INLINE_MAX)
    return { text, truncated: false };
  const cut = text.slice(0, AI_INSTRUCTIONS_INLINE_MAX);
  const nl = cut.lastIndexOf("\n");
  return {
    text: (nl > AI_INSTRUCTIONS_INLINE_MAX / 2 ? cut.slice(0, nl) : cut).trim(),
    truncated: true,
  };
}

/**
 * What assistants follow when the user has not written their own. Only a setting that was never
 * saved falls back to this: text the user cleared on purpose stays empty (reset brings it back).
 * Keep it short and uncontroversial; it is sent at the start of every session.
 */
export const DEFAULT_AI_INSTRUCTIONS = [
  "Write cards in the language of the source material. One fact per card, with a short answer.",
  "Show me a draft before adding more than a few cards, and say how many cards were really saved.",
  "Quiz me one question at a time. Wait for my answer before showing the right one, and rate honestly, never to be kind.",
  "Ask before deleting anything. Suspend a card instead when unsure.",
  "Tag cards with short lowercase topic tags, and reuse tags I already have.",
  "Keep your replies short.",
].join("\n");

/** The instructions in force: what the user saved (even empty), else the default. */
export function effectiveInstructions(saved: unknown): {
  text: string;
  isDefault: boolean;
} {
  if (saved === undefined || saved === null)
    return { text: DEFAULT_AI_INSTRUCTIONS, isDefault: true };
  return { text: normalizeInstructions(saved), isDefault: false };
}

export const AI_INSTRUCTIONS_EXAMPLE = [
  "Write cards in English, with short answers.",
  "I study for the AWS exam: tag cards by service, for example s3 or iam.",
  "Quiz me in sets of 10 and ask a why question after each wrong answer.",
].join("\n");
