// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, it } from "vitest";
import type { Db } from "./db";
import { pullRows, pushRows, validateRows } from "./sync";

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

const row = (id: string, updatedAt: number, extra = {}) => ({
  tbl: "decks",
  id,
  data: { id, name: `n${updatedAt}` },
  updatedAt,
  ...extra,
});

it("pushes, pulls in seq order, and ignores older or equal writes", async () => {
  await pushRows(db, "u1", [row("a", 100), row("b", 100)]);
  const stale = await pushRows(db, "u1", [row("a", 50), row("b", 100)]);
  expect(stale).toEqual({ seq: 2, applied: 0 }); // both older or equal: nothing applied

  const pulled = await pullRows(db, "u1", 0);
  expect(pulled.rows.map((r) => r.id)).toEqual(["a", "b"]);
  expect(pulled.rows[0]).toMatchObject({ updatedAt: 100, deleted: false });
  expect((pulled.rows[0].data as { name: string }).name).toBe("n100");

  await pushRows(db, "u1", [row("a", 200)]);
  const next = await pullRows(db, "u1", pulled.seq);
  expect(next.rows.map((r) => r.id)).toEqual(["a"]);
  expect(next.seq).toBe(3);
});

it("records deletes and keeps users isolated", async () => {
  await pushRows(db, "u1", [row("a", 300, { data: null, deleted: true })]);
  const all = await pullRows(db, "u1", 0);
  expect(all.rows.find((r) => r.id === "a")).toMatchObject({ deleted: true });

  const other = await pullRows(db, "u2", 0);
  expect(other).toEqual({ rows: [], seq: 0, more: false });
});

it("validates rows", () => {
  expect(validateRows([row("a", 1)])).not.toBeNull();
  expect(validateRows([{ tbl: "evil", id: "x", updatedAt: 1 }])).toBeNull();
  expect(validateRows("nope")).toBeNull();
});

it("accepts settings and presets rows", () => {
  expect(
    validateRows([
      {
        tbl: "settings",
        id: "#language",
        data: { key: "#language" },
        updatedAt: 1,
      },
      { tbl: "presets", id: "default", data: {}, updatedAt: 1 },
    ])
  ).not.toBeNull();
});

it("accepts study sessions as a synced table", () => {
  expect(
    validateRows([{ tbl: "studySessions", id: "s1", updatedAt: 1, data: {} }])
  ).toHaveLength(1);
  expect(
    validateRows([{ tbl: "notATable", id: "s1", updatedAt: 1, data: {} }])
  ).toBeNull();
});
