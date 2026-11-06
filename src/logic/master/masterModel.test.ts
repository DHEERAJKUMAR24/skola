import { describe, expect, it } from "vitest";
import {
  MASTER_SPLIT_THRESHOLD,
  type MasterSection,
  cleanMaster,
  countEntries,
  linkedCardIds,
  masterSortField,
  masterToText,
  newMasterEntry,
  newMasterSection,
  parseMasterText,
  planMasterCards,
  sectionsForCard,
  validateMaster,
} from "./masterModel";

const entries = (n: number) =>
  Array.from({ length: n }, (_, i) => newMasterEntry(`e${i}`));

describe("planMasterCards", () => {
  it("one card for a small master", () => {
    const s = [
      newMasterSection("a", entries(6)),
      newMasterSection("b", entries(6)),
    ];
    expect(countEntries(s)).toBe(MASTER_SPLIT_THRESHOLD);
    expect(planMasterCards(s)).toEqual([null]);
  });
  it("one card per top-level section above 12 entries", () => {
    const s = [
      newMasterSection("a", entries(7)),
      newMasterSection("b", entries(6)),
      newMasterSection("c", []),
    ];
    expect(planMasterCards(s)).toEqual(s.map((x) => x.id));
  });
  it("one section stays one card however big", () => {
    expect(planMasterCards([newMasterSection("a", entries(40))])).toEqual([
      null,
    ]);
  });
  it("no sections: still one card", () => {
    expect(planMasterCards([])).toEqual([null]);
  });
});

describe("sectionsForCard", () => {
  const s = [
    newMasterSection("a", entries(1)),
    newMasterSection("b", entries(1)),
  ];
  it("shows everything for the whole-master card", () => {
    expect(sectionsForCard(s, null)).toBe(s);
    expect(sectionsForCard(s, undefined)).toBe(s);
  });
  it("shows one section", () => {
    expect(sectionsForCard(s, s[1].id)).toEqual([s[1]]);
  });
  it("falls back to everything for a deleted section", () => {
    expect(sectionsForCard(s, "gone")).toBe(s);
  });
});

describe("cleanMaster and validateMaster", () => {
  it("trims, drops blank entries, names untitled sections, keeps card-only entries", () => {
    const c = cleanMaster({
      title: "  Closures ",
      sections: [
        {
          id: "s1",
          title: " ",
          entries: [
            { id: "a", text: "  x  " },
            { id: "b", text: " " },
            { id: "c", text: "", cardId: "card" },
          ],
        },
      ],
    });
    expect(c.title).toBe("Closures");
    expect(c.sections[0].title).toBe("Section 1");
    expect(c.sections[0].entries).toEqual([
      { id: "a", text: "x" },
      { id: "c", text: "", cardId: "card" },
    ]);
  });
  it("validates", () => {
    const ok = {
      title: "T",
      sections: [newMasterSection("a", entries(1))],
    };
    expect(validateMaster(ok)).toBeNull();
    expect(validateMaster({ ...ok, title: " " })).toMatch(/name/);
    expect(validateMaster({ title: "T", sections: [] })).toMatch(/section/);
    expect(
      validateMaster({ title: "T", sections: [newMasterSection("a")] })
    ).toMatch(/entry/);
  });
  it("masterSortField strips markup and caps length", () => {
    expect(masterSortField({ title: "<b>Hi</b>" })).toBe("Hi");
    expect(masterSortField({ title: "" })).toBe("Master card");
    expect(masterSortField({ title: "x".repeat(300) })).toHaveLength(100);
  });
  it("linkedCardIds keeps repeats in order", () => {
    const s: MasterSection[] = [
      newMasterSection("a", [newMasterEntry("x", "c1"), newMasterEntry("y")]),
      newMasterSection("b", [newMasterEntry("z", "c1")]),
    ];
    expect(linkedCardIds(s)).toEqual(["c1", "c1"]);
  });
});

describe("parseMasterText / masterToText", () => {
  const text = [
    "# Basics",
    "- closures {{card:c1}}",
    "- hoisting",
    "",
    "# Async",
    "1. promises {{card:c2}}",
    ">>> event loop",
  ].join("\n");

  it("parses sections, bullets and card tags", () => {
    const s = parseMasterText(text);
    expect(s.map((x) => x.title)).toEqual(["Basics", "Async"]);
    expect(s[0].entries.map((e) => [e.text, e.cardId])).toEqual([
      ["closures", "c1"],
      ["hoisting", undefined],
    ]);
    expect(s[1].entries.map((e) => [e.text, e.cardId])).toEqual([
      ["promises", "c2"],
      ["event loop", undefined],
    ]);
  });
  it("puts lines before the first heading in General", () => {
    const s = parseMasterText("- a\n- b\n# X\n- c");
    expect(s.map((x) => x.title)).toEqual(["General", "X"]);
    expect(s[0].entries).toHaveLength(2);
  });
  it("drops empty lines and empty bullets", () => {
    const s = parseMasterText("# A\n-\n\n- \n- real");
    expect(s[0].entries.map((e) => e.text)).toEqual(["real"]);
  });
  it("a bare card tag makes an entry with no text", () => {
    const s = parseMasterText("# A\n- {{card:c9}}");
    expect(s[0].entries[0]).toMatchObject({ text: "", cardId: "c9" });
  });
  it("round-trips", () => {
    const s = parseMasterText(text);
    expect(
      parseMasterText(masterToText(s)).map((x) =>
        x.entries.map((e) => [e.text, e.cardId])
      )
    ).toEqual(s.map((x) => x.entries.map((e) => [e.text, e.cardId])));
  });
  it("keeps section and entry ids when the text is edited", () => {
    const first = parseMasterText(text);
    const edited = parseMasterText(
      text
        .replace("# Async", "# async")
        .replace("- hoisting", "- hoisting rules"),
      first
    );
    expect(edited[0].id).toBe(first[0].id);
    expect(edited[1].id).toBe(first[1].id);
    expect(edited[0].entries[0].id).toBe(first[0].entries[0].id);
    // the renamed text has no card tag and a new text: new id
    expect(edited[0].entries[1].id).not.toBe(first[0].entries[1].id);
  });
  it("does not reuse one id twice", () => {
    const first = parseMasterText("# A\n- same\n- same");
    const again = parseMasterText("# A\n- same\n- same", first);
    expect(new Set(again[0].entries.map((e) => e.id)).size).toBe(2);
    expect(again[0].entries[0].id).toBe(first[0].entries[0].id);
    expect(again[0].entries[1].id).toBe(first[0].entries[1].id);
  });
});
