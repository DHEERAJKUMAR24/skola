// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, it } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";
import { decode } from "./mcpData";
import { pullRows, pushRows } from "./sync";

let db: Db;
const U = "w1";

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
  // A preset that buries review siblings and suspends leeches at 1 lapse.
  await pushRows(db, U, [
    {
      tbl: "presets",
      id: "default",
      updatedAt: 1,
      data: {
        id: "default",
        name: "Default",
        newCardsPerDay: 20,
        maxReviewsPerDay: 200,
        newCardOrder: "created",
        learningSteps: ["1m", "10m"],
        relearningSteps: ["10m"],
        schedulingMode: "exact",
        desiredRetention: 0.9,
        maximumInterval: 36500,
        enableFuzz: false,
        easyDays: [],
        buryNewSiblings: true,
        buryReviewSiblings: true,
        leechThreshold: 1,
        leechAction: "suspend",
      },
    },
  ]);
});

const call = async (name: string, args: object = {}, user = U) => {
  const r: any = await handleRpc(db, user, {
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const out = r.result.content[0].text;
  return r.result.isError ? { error: out } : JSON.parse(out);
};
const row = async (tbl: string, id: string) => {
  const { rows } = await db.query<{ data: any }>(
    "SELECT data FROM changes WHERE user_id = $1 AND tbl = $2 AND id = $3",
    [U, tbl, id]
  );
  return rows[0]?.data;
};

it("creates decks and sub-decks, keeping the parent's list and preset", async () => {
  const parent = await call("create_deck", { name: "Bio" });
  const child = await call("create_deck", {
    name: "Cells",
    parent_id: parent.id,
  });
  const p = await row("decks", parent.id);
  const c = await row("decks", child.id);
  expect(p.subDecks).toEqual([child.id]);
  expect(c.superDecks).toEqual([parent.id]);
  expect(c.options.presetId).toBe("default");
  expect((await call("list_decks")).map((d: any) => d.path)).toEqual(
    expect.arrayContaining(["Bio", "Bio / Cells"])
  );
  expect(await call("create_deck", { name: "x", parent_id: "nope" })).toEqual({
    error: "parent deck not found",
  });
});

it("adds cards as notes plus fresh cards, escaped, and the deck lists them", async () => {
  const { id } = await call("create_deck", { name: "Chem" });
  const res = await call("add_cards", {
    deck_id: id,
    cards: [
      { front: "H2O <b>", back: "Water\nliquid", tags: ["Basics!"] },
      { front: "NaCl", back: "Salt" },
    ],
  });
  expect(res.added).toBe(2);
  const deck = await row("decks", id);
  expect(deck.cards).toEqual(res.card_ids);
  expect(deck.notes).toHaveLength(2);
  const card = await row("cards", res.card_ids[0]);
  const note = await row("notes", card.note);
  expect(note.content).toEqual({
    type: "normal",
    front: "<p>H2O &lt;b&gt;</p>",
    back: "<p>Water</p><p>liquid</p>",
  });
  expect(note.tags).toEqual(["basics"]);
  expect(decode(card).model.state).toBe(0);
  expect(await call("add_cards", { deck_id: id, cards: [] })).toHaveProperty(
    "error"
  );
  // the new cards are visible to the read tools
  expect((await call("deck_stats", { deck_id: id })).new).toBe(2);
});

it("edits text, tags and suspension", async () => {
  const { id } = await call("create_deck", { name: "Edit" });
  const { card_ids } = await call("add_cards", {
    deck_id: id,
    cards: [{ front: "a", back: "b" }],
  });
  await call("edit_card", {
    card_id: card_ids[0],
    front: "new",
    tags: ["x y"],
    suspended: true,
  });
  const card = await row("cards", card_ids[0]);
  const note = await row("notes", card.note);
  expect(card.suspended).toBe(true);
  expect(note.content.front).toBe("<p>new</p>");
  expect(note.sortField).toBe("new");
  expect(note.tags).toEqual(["x-y"]);
  expect(await call("edit_card", { card_id: card_ids[0] })).toEqual({
    error: "nothing to change",
  });
});

it("grades a new card with FSRS, logs the review, and syncs to clients", async () => {
  const { id } = await call("create_deck", { name: "Grade" });
  const { card_ids } = await call("add_cards", {
    deck_id: id,
    cards: [{ front: "q", back: "a" }],
  });
  const before = (await pullRows(db, U, 0)).seq;
  const res = await call("grade_card", { card_id: card_ids[0], rating: 3 });
  expect(res.due).toBeGreaterThan(Date.now());
  expect(res.state).toBe(1); // Learning after the first Good
  const card = decode(await row("cards", card_ids[0]));
  expect(card.model.due).toBeInstanceOf(Date);
  expect(card.model.reps).toBe(1);
  const pulled = await pullRows(db, U, before);
  expect(pulled.rows.map((r) => r.tbl).sort()).toEqual(["cards", "reviewLogs"]);
  const log = pulled.rows.find((r) => r.tbl === "reviewLogs")!.data as any;
  expect(log).toMatchObject({ card: card_ids[0], rating: 3 });
  expect(log.review).toHaveProperty("$d");
  expect(await call("grade_card", { card_id: card_ids[0], rating: 9 })).toEqual(
    { error: "rating must be 1 to 4" }
  );
});

it("refuses suspended or not-yet-due cards", async () => {
  const { id } = await call("create_deck", { name: "Rules" });
  const { card_ids } = await call("add_cards", {
    deck_id: id,
    cards: [{ front: "q", back: "a" }],
  });
  await call("edit_card", { card_id: card_ids[0], suspended: true });
  expect(await call("grade_card", { card_id: card_ids[0], rating: 3 })).toEqual(
    { error: "card is suspended" }
  );
  await call("edit_card", { card_id: card_ids[0], suspended: false });
  // Review state, due far in the future.
  const card = await row("cards", card_ids[0]);
  await pushRows(db, U, [
    {
      tbl: "cards",
      id: card.id,
      updatedAt: Date.now() + 10_000,
      data: {
        ...card,
        model: {
          ...card.model,
          state: 2,
          due: { $d: Date.now() + 5 * 86_400_000 },
        },
      },
    },
  ]);
  expect(await call("grade_card", { card_id: card.id, rating: 3 })).toEqual({
    error: "card is not due yet",
  });
});

it("flags a lapse as a leech (tag + suspend) and buries siblings", async () => {
  const { id } = await call("create_deck", { name: "Leech" });
  const { card_ids } = await call("add_cards", {
    deck_id: id,
    cards: [{ front: "q", back: "a" }],
  });
  const card = await row("cards", card_ids[0]);
  const sibling = { ...card, id: "sib", model: { ...card.model } };
  const due = { $d: Date.now() - 1000 };
  await pushRows(db, U, [
    {
      tbl: "cards",
      id: card.id,
      updatedAt: Date.now() + 20_000,
      data: {
        ...card,
        model: {
          ...card.model,
          state: 2,
          due,
          stability: 5,
          difficulty: 5,
          reps: 3,
          last_review: { $d: Date.now() - 5 * 86_400_000 },
        },
      },
    },
    { tbl: "cards", id: "sib", updatedAt: 1, data: sibling },
  ]);
  const res = await call("grade_card", { card_id: card.id, rating: 1 });
  expect(res.leech).toBe(true);
  expect((await row("cards", card.id)).suspended).toBe(true);
  expect((await row("notes", card.note)).tags).toContain("leech");
  expect((await row("cards", "sib")).buriedUntil).toBeGreaterThan(Date.now());
});

it("marks tools read-only or not in tools/list", async () => {
  const r: any = await handleRpc(db, U, { id: 1, method: "tools/list" });
  const hint = Object.fromEntries(
    r.result.tools.map((t: any) => [t.name, t.annotations.readOnlyHint])
  );
  expect(hint).toMatchObject({
    list_decks: true,
    find_leeches: true,
    create_deck: false,
    add_cards: false,
    edit_card: false,
    grade_card: false,
  });
});

it("adds cloze, multiple-choice and list cards, with the same rules as the app", async () => {
  const { id } = await call("create_deck", { name: "Types" });
  const res = await call("add_cards", {
    deck_id: id,
    cards: [
      {
        type: "cloze",
        text: "{{c1::Paris}} is the capital of {{c2::France}}",
        tags: ["geo"],
      },
      {
        type: "multiple_choice",
        question: "Which are prime?",
        choices: ["2", "4", "5", "  "],
        correct: [0, 2],
        explanation: "4 is even",
      },
      {
        type: "list",
        front: "Steps of the cycle?",
        items: [">>> Plan", "- Do", "Check"],
        ordered: true,
      },
      { front: "plain", back: "basic" },
    ],
  });
  expect(res).toMatchObject({ notes_added: 4, added: 5 }); // cloze makes two cards
  const deck = await row("decks", id);
  expect(deck.cards).toHaveLength(5);
  expect(deck.notes).toHaveLength(4);

  const cards = await Promise.all(
    res.card_ids.map((c: string) => row("cards", c))
  );
  const byType = (t: string) => cards.filter((c) => c.content.type === t);
  expect(
    byType("cloze")
      .map((c) => c.content.occlusionNumber)
      .sort()
  ).toEqual([1, 2]);
  expect(byType("multipleChoice")).toHaveLength(1);

  const mc = await row("notes", byType("multipleChoice")[0].note);
  expect(mc.content.choices).toEqual([
    { text: "2", correct: true },
    { text: "4", correct: false },
    { text: "5", correct: true },
  ]);
  expect(mc.content.explanation).toBe("<p>4 is even</p>");
  const list = await row("notes", byType("list")[0].note);
  expect(list.content).toMatchObject({
    items: ["Plan", "Do", "Check"],
    ordered: true,
  });
  const cloze = await row("notes", byType("cloze")[0].note);
  expect(cloze.sortField).toBe("Paris is the capital of France");
  expect(cloze.tags).toEqual(["geo"]);

  // Readers see labeled fields, so a quiz can hide the answer.
  const found = await call("search_cards", { query: "prime", deck_id: id });
  expect(found[0].fields).toMatchObject({
    choices: ["2", "4", "5"],
    correct: ["2", "5"],
  });
  expect(found[0].fields.question).toBe("Which are prime?");
});

it("refuses bad cards of every type with a message naming the card", async () => {
  const { id } = await call("create_deck", { name: "Bad" });
  const bad = (card: object) =>
    call("add_cards", {
      deck_id: id,
      cards: [{ front: "ok", back: "ok" }, card],
    });
  expect(await bad({ type: "cloze", text: "no deletion here" })).toEqual({
    error: "card 2: cloze text needs at least one {{c1::hidden words}}",
  });
  expect((await bad({ type: "cloze", text: "{{c99::x}}" })).error).toMatch(
    /1 to 20/
  );
  expect(
    (
      await bad({
        type: "multiple_choice",
        question: "Q",
        choices: ["a"],
        correct: 0,
      })
    ).error
  ).toMatch(/two/);
  expect(
    (
      await bad({
        type: "multiple_choice",
        question: "Q",
        choices: ["a", "b"],
        correct: 5,
      })
    ).error
  ).toMatch(/0-based/);
  expect(
    (await bad({ type: "multiple_choice", question: "Q", choices: ["a", "b"] }))
      .error
  ).toMatch(/correct/);
  expect(
    (await bad({ type: "list", front: "Q", items: ["one"] })).error
  ).toMatch(/two/);
  expect((await bad({ type: "video" })).error).toMatch(/unknown card type/);
  // nothing was written, not even the valid first card
  expect((await row("decks", id)).cards).toHaveLength(0);
});
