// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, it } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";

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

const call = async (u: string, name: string, args: object = {}) => {
  const r: any = await handleRpc(db, u, {
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const out = r.result.content[0].text;
  return r.result.isError ? { error: out } : JSON.parse(out);
};

it("find_similar_cards groups by meaning, suggests a keeper, pages, and deletes nothing", async () => {
  const u = "dup-1";
  const parent = (await call(u, "create_deck", { name: "Bio" })).id;
  const sub = (
    await call(u, "create_deck", { name: "Cells", parent_id: parent })
  ).id;
  const other = (await call(u, "create_deck", { name: "Other" })).id;
  const a = await call(u, "add_cards", {
    deck_id: parent,
    cards: [
      {
        front: "What does the mitochondria produce?",
        back: "ATP, the energy of the cell",
      },
      { front: "What is the nucleus?", back: "Contains DNA" },
      { type: "reverse", front: "ribosome", back: "makes proteins" },
      {
        type: "list",
        front: "Phases of mitosis",
        items: ["prophase", "metaphase", "anaphase", "telophase"],
      },
    ],
  });
  const b = await call(u, "add_cards", {
    deck_id: sub,
    cards: [
      {
        front: "What do mitochondria produce?",
        back: "ATP - the cell's energy",
      },
      { type: "cloze", text: "Ribosomes {{c1::make proteins}}" },
      {
        type: "list",
        front: "Mitosis phases",
        items: ["telophase", "anaphase", "metaphase", "prophase"],
      },
      {
        front: "What does the mitochondria produce?",
        back: "Water and salt",
      },
    ],
  });
  await call(u, "add_cards", {
    deck_id: other,
    cards: [{ front: "Capital of France", back: "Paris" }],
  });
  await call(u, "grade_card", { card_id: b.card_ids[0], rating: 3 });

  const r = await call(u, "find_similar_cards");
  expect(r.truncated).toBe(false);
  const mito = r.groups.find((g: any) =>
    g.notes.some((n: any) => n.answer.includes("energy"))
  );
  expect(mito.notes).toHaveLength(2); // the conflicting answer is not grouped
  expect(mito.notes[0]).toMatchObject({
    role: "keep",
    reviews: 1,
    deck_path: "Bio / Cells",
  });
  expect(mito.notes[1]).toMatchObject({
    role: "duplicate",
    deck_path: "Bio",
  });
  expect(mito.notes[1].card_ids).toEqual([a.card_ids[0]]);
  const list = r.groups.find((g: any) => g.notes[0].type === "list");
  expect(list.score).toBeGreaterThan(0.8);
  expect(
    r.groups.some((g: any) =>
      g.notes.some((n: any) => n.question.includes("France"))
    )
  ).toBe(false);

  const p1 = await call(u, "find_similar_cards", { limit: 1 });
  expect(p1.groups).toHaveLength(1);
  expect(p1.next_offset).toBe(1);
  const p2 = await call(u, "find_similar_cards", { limit: 1, offset: 1 });
  expect(p2.groups[0].keep_note_id).not.toBe(p1.groups[0].keep_note_id);

  expect(
    (await call(u, "find_similar_cards", { deck_id: other })).groups
  ).toEqual([]);
  const same = await call(u, "find_similar_cards", { same_deck_only: true });
  expect(
    same.groups.every(
      (g: any) => new Set(g.notes.map((n: any) => n.deck_id)).size === 1
    )
  ).toBe(true);

  // read-only: every card is still there; other users see nothing
  const all = await call(u, "list_cards", { limit: 100 });
  expect(all.cards ?? all).toHaveLength(9 + 1);
  expect((await call("dup-2", "find_similar_cards")).groups).toEqual([]);
});
