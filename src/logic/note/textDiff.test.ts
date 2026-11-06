import { describe, expect, it } from "vitest";
import { compareVersion } from "./historyView";
import { diffText } from "./textDiff";

describe("diffText", () => {
  it("marks added and removed words and keeps the rest", () => {
    expect(diffText("the cat sat", "the dog sat")).toEqual([
      { kind: "same", text: "the " },
      { kind: "removed", text: "cat" },
      { kind: "added", text: "dog" },
      { kind: "same", text: " sat" },
    ]);
  });

  it("returns one same run for equal text and handles empty sides", () => {
    expect(diffText("a b", "a b")).toEqual([{ kind: "same", text: "a b" }]);
    expect(diffText("", "new")).toEqual([{ kind: "added", text: "new" }]);
    expect(diffText("old", "")).toEqual([{ kind: "removed", text: "old" }]);
    expect(diffText("", "")).toEqual([]);
  });

  it("does not hang on very long texts", () => {
    const long = "word ".repeat(5000);
    expect(diffText(long, `${long}x`).length).toBeGreaterThan(0);
  });
});

describe("compareVersion", () => {
  const current = { fields: { front: "q", back: "now" }, tags: ["a"] };

  it("shows what restoring would change, per field, including tags", () => {
    const r = compareVersion(
      { fields: { front: "q", back: "before" }, tags: [] },
      current
    );
    expect(r.find((c) => c.name === "front")?.changed).toBe(false);
    const back = r.find((c) => c.name === "back");
    expect(back?.changed).toBe(true);
    expect(back?.parts.map((p) => p.kind)).toEqual(["removed", "added"]);
    expect(r.find((c) => c.name === "tags")?.changed).toBe(true);
  });

  it("joins list fields and survives a missing current note", () => {
    const r = compareVersion(
      { fields: { choices: ["x", "y"] }, tags: null },
      null
    );
    expect(r).toEqual([
      {
        name: "choices",
        parts: [{ kind: "same", text: "x\ny" }],
        changed: false,
      },
    ]);
  });
});
