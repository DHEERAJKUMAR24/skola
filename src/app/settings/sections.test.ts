import { describe, expect, it } from "vitest";
import { SETTINGS_GROUPS } from "./sections";

describe("settings sidebar sections", () => {
  const ids = SETTINGS_GROUPS.flatMap((g) => g.sections.map((s) => s.id));

  it("lists every section once, with a label", () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of SETTINGS_GROUPS)
      for (const s of g.sections) expect(s.label.trim()).not.toBe("");
  });

  it("keeps the AI assistant pages together and the old links working", () => {
    const ai = SETTINGS_GROUPS.find((g) => g.title === "AI assistants");
    expect(ai?.sections.map((s) => s.id)).toEqual(["ai", "connect", "skills"]);
    // /settings/sync (account) and /settings/presets are linked from other screens
    expect(ids).toEqual(
      expect.arrayContaining(["sync", "presets", "database"])
    );
  });
});
