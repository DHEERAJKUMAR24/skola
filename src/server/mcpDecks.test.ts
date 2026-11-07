// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { type Ctx, type Row, load } from "./mcpData";
import { deckPathOf, resolveDeckPath, splitDeckPath } from "./mcpDecks";
import { pushRows } from "./sync";

let db: Db;

beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(
    fs.readFileSync("supabase/migrations/20261101000000_init.sql", "utf8")
  );
  db = {
    query: (text, params) => pg.query(text, params) as never,
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn((text, params) => tx.query(text, params) as never)
      ),
  };
});

let n = 0;
const deck = (id: string, name: string, superDecks?: string[]): Row => ({
  id,
  name,
  cards: [],
  notes: [],
  subDecks: [],
  ...(superDecks ? { superDecks } : {}),
  options: { presetId: "p1" },
});

async function setup(decks: Row[] = []) {
  const user = `d-${++n}`;
  for (const d of decks)
    if (d.superDecks?.length) {
      const p = decks.find((x) => x.id === d.superDecks.at(-1));
      p?.subDecks.push(d.id);
    }
  await pushRows(
    db,
    user,
    decks.map((d) => ({ tbl: "decks", id: d.id, updatedAt: 1, data: d }))
  );
  const ctx: Ctx = { db, userId: user, now: 1000 };
  return ctx;
}
const med = () => [
  deck("m", "Med"),
  deck("c", "Cardiology", ["m"]),
  deck("x", "Other"),
];
const fail = async (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toThrow(`[${code}]`);

describe("splitDeckPath", () => {
  it("splits on :: and ' / ' and trims", () => {
    expect(splitDeckPath(" A :: B / C ")).toEqual(["A", "B", "C"]);
  });
  it("rejects empty segments", () => {
    expect(() => splitDeckPath("A::::B")).toThrow("[invalid_argument]");
    expect(() => splitDeckPath("::A")).toThrow("[invalid_argument]");
    expect(() => splitDeckPath("  ")).toThrow("[invalid_argument]");
  });
});

describe("resolveDeckPath", () => {
  it("resolves ids and paths, case-insensitively", async () => {
    const ctx = await setup(med());
    for (const p of [
      "c",
      "Med::Cardiology",
      "Med / Cardiology",
      "med::CARDIOLOGY",
      " Med :: Cardiology ",
    ]) {
      const r = await resolveDeckPath(ctx, p);
      expect(r.deck.id).toBe("c");
      expect(r.created).toEqual([]);
    }
    const decks = await load(db, ctx.userId, "decks");
    expect(deckPathOf(decks, decks.find((d) => d.id === "c") as Row)).toBe(
      "Med::Cardiology"
    );
  });

  it("reports ambiguity with ids and missing paths", async () => {
    const ctx = await setup([deck("a", "Med"), deck("b", "med")]);
    await expect(resolveDeckPath(ctx, "Med")).rejects.toThrow(
      /\[deck_ambiguous\].*a.*b/
    );
    await fail(resolveDeckPath(ctx, "Nope::X"), "deck_not_found");
    await fail(resolveDeckPath(ctx, "A::::B"), "invalid_argument");
  });

  it("creates missing levels with parents, presets and subDecks, once per row", async () => {
    const ctx = await setup(med());
    const r = await resolveDeckPath(ctx, "Med::Cardiology::Valves::Mitral", {
      createMissing: true,
    });
    expect(r.created.map((d) => d.name)).toEqual(["Valves", "Mitral"]);
    const decks = await load(db, ctx.userId, "decks");
    const by = new Map(decks.map((d) => [d.id, d]));
    const [valves, mitral] = r.created;
    expect(by.get(valves.id)?.superDecks).toEqual(["m", "c"]);
    expect(by.get(mitral.id)?.superDecks).toEqual(["m", "c", valves.id]);
    expect(by.get(mitral.id)?.options.presetId).toBe("p1");
    expect(by.get("c")?.subDecks).toEqual([valves.id]);
    expect(by.get(valves.id)?.subDecks).toEqual([mitral.id]);
    expect(r.deck.id).toBe(mitral.id);
  });

  it("creates a new root with the default preset", async () => {
    const ctx = await setup();
    const r = await resolveDeckPath(ctx, "New", { createMissing: true });
    expect(r.deck.superDecks ?? []).toEqual([]);
    expect(r.deck.options.presetId).toBe("default");
  });

  it("refuses names that are too long and case-only duplicates among siblings", async () => {
    const ctx = await setup(med());
    await fail(
      resolveDeckPath(ctx, "x".repeat(101), { createMissing: true }),
      "invalid_argument"
    );
    // Existing "Other" matches case-insensitively, so no duplicate is created.
    const r = await resolveDeckPath(ctx, "OTHER", { createMissing: true });
    expect(r.created).toEqual([]);
    expect(r.deck.id).toBe("x");
  });
});
