// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, it } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";
import { pushRows } from "./sync";

let db: Db;
const d = (t: number) => ({ $d: t });
const NOW = Date.now();

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
  const row = (tbl: string, id: string, data: object) => ({
    tbl,
    id,
    data: { id, ...data },
    updatedAt: 1,
  });
  const card = (
    id: string,
    note: string,
    state: number,
    due: number,
    lapses = 0
  ) =>
    row("cards", id, {
      deck: "d1",
      note,
      model: { state, due: d(due), lapses },
    });
  await pushRows(db, "u1", [
    row("decks", "d1", { name: "Bio", subDecks: [], cards: [], notes: [] }),
    row("notes", "n1", {
      content: { type: "normal", front: "Mitosis", back: "Cell division" },
    }),
    row("notes", "n2", {
      content: { type: "normal", front: "mitosis", back: "cell  division" },
    }),
    card("c1", "n1", 2, NOW - 1000, 9),
    card("c2", "n2", 0, NOW),
    row("decks", "other", { name: "Other" }),
  ]);
});

const call = async (user: string, name: string, args = {}) => {
  const r: any = await handleRpc(db, user, {
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return JSON.parse(r.result.content[0].text);
};

it("lists tools and ignores notifications", async () => {
  const r: any = await handleRpc(db, "u1", { id: 1, method: "tools/list" });
  expect(r.result.tools.map((t: any) => t.name)).toContain("get_due_cards");
  expect(
    await handleRpc(db, "u1", { method: "notifications/initialized" })
  ).toBeNull();
});

it("returns due cards, stats, leeches and duplicates for the user only", async () => {
  expect((await call("u1", "get_due_cards")).map((c: any) => c.id)).toEqual([
    "c1",
  ]);
  expect(await call("u1", "deck_stats", { deck_id: "d1" })).toMatchObject({
    total: 2,
    new: 1,
    review: 1,
    due: 1,
  });
  expect((await call("u1", "find_leeches")).map((c: any) => c.id)).toEqual([
    "c1",
  ]);
  expect(await call("u1", "find_duplicates")).toHaveLength(1);
  expect((await call("u1", "search_cards", { query: "DIVISION" })).length).toBe(
    2
  );
  expect(await call("u2", "get_due_cards")).toEqual([]);
});

it("reports an unknown tool as an error", async () => {
  const r: any = await handleRpc(db, "u1", {
    id: 2,
    method: "tools/call",
    params: { name: "nope" },
  });
  expect(r.error.code).toBe(-32602);
});
