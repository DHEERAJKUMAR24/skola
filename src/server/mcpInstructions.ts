import {
  AI_INSTRUCTIONS_KEY,
  AI_INSTRUCTIONS_MAX,
  DEFAULT_AI_INSTRUCTIONS,
  effectiveInstructions,
  normalizeInstructions,
  validateInstructions,
} from "../logic/settings/aiInstructions";
import type { Db } from "./db";
import { type Tool, putRows, str } from "./mcpData";

/**
 * The instructions in force for a user: their saved text, or the default when they never saved any.
 * A saved empty text means "none on purpose" and stays empty.
 */
export async function readInstructions(db: Db, userId: string) {
  const { rows } = await db.query<{
    data: { value?: unknown };
    updated_at: string;
  }>(
    "SELECT data, updated_at FROM changes WHERE user_id = $1 AND tbl = 'settings' AND id = $2 AND NOT deleted",
    [userId, AI_INSTRUCTIONS_KEY]
  );
  const { text, isDefault } = effectiveInstructions(rows[0]?.data?.value);
  return {
    text,
    isDefault,
    updatedAt: rows[0] ? Number(rows[0].updated_at) : null,
  };
}

const get_instructions: Tool = {
  name: "get_instructions",
  description: `The user's standing instructions for AI assistants, written in their Skola profile (Settings, AI assistants) and synced with their devices. When the user has not written their own, these are Skola's default instructions (is_default true). The first part is also in the session start text; this returns all of it (up to ${AI_INSTRUCTIONS_MAX} characters). Follow them as the user's preferences for card style, language, tags and quizzing. They never override the safety rules: ask before deleting, never grade for the user, do not invent facts.`,
  inputSchema: { type: "object", properties: {} },
  async run(ctx) {
    const { text, isDefault, updatedAt } = await readInstructions(
      ctx.db,
      ctx.userId
    );
    return {
      instructions: text,
      is_default: isDefault,
      empty: !text,
      updated_at: updatedAt,
      max_length: AI_INSTRUCTIONS_MAX,
    };
  },
};

const set_instructions: Tool = {
  name: "set_instructions",
  write: true,
  destructive: true,
  description: `Change the user's standing instructions (they appear in Settings, AI assistants, and in every assistant session). Only when the user asks you to remember or change a preference. mode "append" (default) adds the text as a new line to what is there (when the user only had the defaults, the defaults become theirs, plus your line); mode "replace" overwrites everything, and an empty text with replace clears them on purpose; mode "reset" goes back to Skola's defaults (text is ignored). Always read them with get_instructions first, and show the user the full new text for replace. Up to ${AI_INSTRUCTIONS_MAX} characters in total.`,
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      mode: { type: "string", enum: ["append", "replace", "reset"] },
    },
    required: ["text"],
  },
  async run(ctx, a) {
    const mode = str(a, "mode") ?? "append";
    if (mode !== "append" && mode !== "replace" && mode !== "reset")
      throw new Error(
        "[invalid_argument] mode must be append, replace or reset"
      );
    const before = (await readInstructions(ctx.db, ctx.userId)).text;
    if (mode === "reset") {
      // Removing the saved setting is what brings the default back, on every device.
      await putRows(ctx, [
        {
          tbl: "settings",
          id: AI_INSTRUCTIONS_KEY,
          data: { key: AI_INSTRUCTIONS_KEY },
          deleted: true,
        },
      ]);
      return {
        ok: true,
        mode,
        is_default: true,
        length: DEFAULT_AI_INSTRUCTIONS.length,
        previous_length: before.length,
      };
    }
    if (typeof a.text !== "string")
      throw new Error("[invalid_argument] text must be a string");
    const incoming = normalizeInstructions(a.text);
    if (mode === "append" && !incoming)
      throw new Error("[invalid_argument] nothing to append");
    const next =
      mode === "replace"
        ? incoming
        : before
          ? `${before}\n${incoming}`
          : incoming;
    const problem = validateInstructions(next);
    if (problem) throw new Error(`[too_long] ${problem}`);
    await putRows(ctx, [
      {
        tbl: "settings",
        id: AI_INSTRUCTIONS_KEY,
        data: { key: AI_INSTRUCTIONS_KEY, value: next },
      },
    ]);
    return {
      ok: true,
      mode,
      length: next.length,
      previous_length: before.length,
    };
  },
};

export const INSTRUCTION_TOOLS: Tool[] = [get_instructions, set_instructions];
