import { describe, expect, it } from "vitest";
import {
  AI_INSTRUCTIONS_INLINE_MAX,
  AI_INSTRUCTIONS_MAX,
  DEFAULT_AI_INSTRUCTIONS,
  effectiveInstructions,
  inlineInstructions,
  normalizeInstructions,
  validateInstructions,
} from "./aiInstructions";

describe("AI instructions", () => {
  it("normalises line endings, trailing spaces and blank runs", () => {
    expect(normalizeInstructions("  a  \r\n\r\n\r\n\r\nb \n")).toBe("a\n\nb");
    expect(normalizeInstructions(undefined)).toBe("");
    expect(normalizeInstructions(42)).toBe("");
  });

  it("rejects text over the limit and accepts the limit itself", () => {
    expect(validateInstructions("x".repeat(AI_INSTRUCTIONS_MAX))).toBeNull();
    expect(validateInstructions("x".repeat(AI_INSTRUCTIONS_MAX + 1))).toContain(
      "at most"
    );
  });

  it("falls back to the default only when nothing was ever saved", () => {
    expect(effectiveInstructions(undefined)).toEqual({
      text: DEFAULT_AI_INSTRUCTIONS,
      isDefault: true,
    });
    expect(effectiveInstructions(null).isDefault).toBe(true);
    // cleared on purpose is a choice, not "unset"
    expect(effectiveInstructions("")).toEqual({ text: "", isDefault: false });
    expect(effectiveInstructions("  mine \r\n")).toEqual({
      text: "mine",
      isDefault: false,
    });
  });

  it("ships a default that fits the session start and the limit, one rule per line", () => {
    expect(DEFAULT_AI_INSTRUCTIONS.length).toBeLessThanOrEqual(
      AI_INSTRUCTIONS_INLINE_MAX
    );
    expect(validateInstructions(DEFAULT_AI_INSTRUCTIONS)).toBeNull();
    expect(normalizeInstructions(DEFAULT_AI_INSTRUCTIONS)).toBe(
      DEFAULT_AI_INSTRUCTIONS
    );
    expect(DEFAULT_AI_INSTRUCTIONS.split("\n").length).toBeGreaterThan(3);
  });

  it("sends short text whole and cuts long text at a line end", () => {
    expect(inlineInstructions("short")).toEqual({
      text: "short",
      truncated: false,
    });
    const long = Array.from(
      { length: 200 },
      (_, i) => `line ${i} of the rules`
    ).join("\n");
    const r = inlineInstructions(long);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(AI_INSTRUCTIONS_INLINE_MAX);
    expect(long.startsWith(r.text)).toBe(true);
    expect(r.text.endsWith("rules")).toBe(true);
    const oneLine = inlineInstructions("y".repeat(3000));
    expect(oneLine.text).toHaveLength(AI_INSTRUCTIONS_INLINE_MAX);
  });
});
