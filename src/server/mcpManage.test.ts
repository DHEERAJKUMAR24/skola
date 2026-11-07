// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";
import { pullRows, pushRows } from "./sync";

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  for (const f of [
    "20261101000000_init",
    "20261102000000_skills",
    "20261104000000_image_assets",
    "20261105000000_study_sessions",
  ])
    await pg.exec(fs.readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  db = {
    query: (text, params) => pg.query(text, params) as never,
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn((text, params) => tx.query(text, params) as never)
      ),
  };
});

let rpc = 0;
async function call(user: string, name: string, args: object = {}) {
  const r: any = await handleRpc(db, user, {
    jsonrpc: "2.0",
    id: ++rpc,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const text = r.result.content[0].text as string;
  return r.result.isError
    ? { error: text, code: /^\[(\w+)\]/.exec(text)?.[1] }
    : JSON.parse(text);
}

let n = 0;
async function setup() {
  const user = `m-${++n}`;
  await pushRows(db, user, [
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
        buryNewSiblings: false,
        buryReviewSiblings: false,
        leechThreshold: 8,
        leechAction: "tag",
      },
    },
  ]);
  return user;
}
async function row(user: string, tbl: string, id: string) {
  const { rows } = await pg.query<{ data: any; deleted: boolean }>(
    "SELECT data, deleted FROM changes WHERE user_id = $1 AND tbl = $2 AND id = $3",
    [user, tbl, id]
  );
  return rows[0];
}
const deckOf = async (u: string, name: string, parent?: string) =>
  (await call(u, "create_deck", { name, parent_id: parent })).id as string;
const cardsIn = async (u: string, deck: string, pairs: string[][]) =>
  (
    await call(u, "add_cards", {
      deck_id: deck,
      cards: pairs.map(([front, back]) => ({ front, back })),
    })
  ).card_ids as string[];

describe("deck management", () => {
  it("renames, describes, pauses and sets an exam date, then reads it back", async () => {
    const u = await setup();
    const d = await deckOf(u, "Old");
    const r = await call(u, "update_deck", {
      deck_id: d,
      name: " New ",
      description: "about",
      paused: true,
      exam_date: "2027-03-01",
      exam_buffer_days: 3,
      preset_id: "default",
    });
    expect(r.changed).toEqual([
      "name",
      "description",
      "paused",
      "exam_date",
      "exam_buffer_days",
      "preset_id",
    ]);
    const g = await call(u, "get_deck", { deck_id: d });
    expect(g).toMatchObject({
      name: "New",
      description: "about",
      paused: true,
      exam_date: "2027-03-01",
      exam_buffer_days: 3,
      preset_id: "default",
      parent_id: null,
    });
    expect(g.settings.daily_new_cards).toBe(20);
    await call(u, "update_deck", {
      deck_id: d,
      exam_date: null,
      paused: false,
    });
    expect((await call(u, "get_deck", { deck_id: d })).exam_date).toBeNull();
  });

  it("rejects bad input", async () => {
    const u = await setup();
    const d = await deckOf(u, "A");
    for (const [args, code] of [
      [{ name: "  " }, "invalid_argument"],
      [{ exam_date: "03/01/2027" }, "invalid_argument"],
      [{ exam_date: "2027-13-45" }, "invalid_argument"],
      [{ preset_id: "nope" }, "preset_not_found"],
      [{}, "nothing_to_change"],
      [{ parent_id: "ghost" }, "deck_not_found"],
    ] as [object, string][])
      expect((await call(u, "update_deck", { deck_id: d, ...args })).code).toBe(
        code
      );
    expect(
      (await call(u, "update_deck", { deck_id: "x", name: "y" })).code
    ).toBe("deck_not_found");
  });

  it("moves a deck with its sub-decks, to the top level and back, and blocks cycles", async () => {
    const u = await setup();
    const a = await deckOf(u, "A");
    const b = await deckOf(u, "B", a);
    const c = await deckOf(u, "C", b);
    const x = await deckOf(u, "X");
    await call(u, "update_deck", { deck_id: b, parent_id: x });
    expect((await row(u, "decks", a)).data.subDecks).toEqual([]);
    expect((await row(u, "decks", x)).data.subDecks).toEqual([b]);
    expect((await row(u, "decks", b)).data.superDecks).toEqual([x]);
    expect((await row(u, "decks", c)).data.superDecks).toEqual([x, b]);
    await call(u, "update_deck", { deck_id: b, parent_id: null });
    expect((await row(u, "decks", b)).data.superDecks).toBeUndefined();
    expect((await row(u, "decks", c)).data.superDecks).toEqual([b]);
    expect((await row(u, "decks", x)).data.subDecks).toEqual([]);
    expect(
      (await call(u, "update_deck", { deck_id: b, parent_id: c })).code
    ).toBe("invalid_move");
    expect(
      (await call(u, "update_deck", { deck_id: b, parent_id: b })).code
    ).toBe("invalid_move");
  });

  it("deletes a deck only after confirmation, with sub-decks, notes and cards", async () => {
    const u = await setup();
    const a = await deckOf(u, "A");
    const b = await deckOf(u, "B", a);
    const keep = await deckOf(u, "Keep");
    const ids = await cardsIn(u, a, [["1", "1"]]);
    const sub = await cardsIn(u, b, [["2", "2"]]);
    const kept = await cardsIn(u, keep, [["3", "3"]]);
    const preview = await call(u, "delete_deck", { deck_id: a });
    expect(preview).toMatchObject({
      deleted: false,
      will_delete: { decks: ["A", "B"], cards: 2, notes: 2 },
    });
    expect((await row(u, "decks", a)).deleted).toBe(false);
    expect(
      (await call(u, "delete_deck", { deck_id: a, confirm_token: "bad" })).code
    ).toBe("confirm_token_mismatch");
    await cardsIn(u, a, [["extra", "x"]]); // contents changed: old token is stale
    expect(
      (
        await call(u, "delete_deck", {
          deck_id: a,
          confirm_token: preview.confirm_token,
        })
      ).code
    ).toBe("confirm_token_mismatch");
    const again = await call(u, "delete_deck", { deck_id: a });
    const done = await call(u, "delete_deck", {
      deck_id: a,
      confirm_token: again.confirm_token,
    });
    expect(done).toEqual({ deleted: true, decks: 2, cards: 3, notes: 3 });
    for (const [t, i] of [
      ["decks", a],
      ["decks", b],
      ["cards", ids[0]],
      ["cards", sub[0]],
    ])
      expect((await row(u, t, i)).deleted).toBe(true);
    expect((await row(u, "cards", kept[0])).deleted).toBe(false);
    const { rows } = await pullRows(db, u, 0);
    expect(rows.filter((r: any) => r.deleted).length).toBeGreaterThanOrEqual(8);
  });

  it("removes a deleted sub-deck from its parent", async () => {
    const u = await setup();
    const a = await deckOf(u, "A");
    const b = await deckOf(u, "B", a);
    const t = (await call(u, "delete_deck", { deck_id: b })).confirm_token;
    await call(u, "delete_deck", { deck_id: b, confirm_token: t });
    expect((await row(u, "decks", a)).data.subDecks).toEqual([]);
  });
});

describe("presets and limits", () => {
  it("lists presets and updates daily limits with validation", async () => {
    const u = await setup();
    const d = await deckOf(u, "A");
    await call(u, "update_deck", { deck_id: d, preset_id: "default" });
    const list = await call(u, "list_presets");
    expect(list[0]).toMatchObject({ id: "default", new_cards_per_day: 20 });
    expect(list[0].decks).toEqual(["A"]);
    const r = await call(u, "update_preset", {
      preset_id: "default",
      new_cards_per_day: 5,
      desired_retention: 0.85,
      learning_steps: ["2m", "1d"],
      easy_days: [0, 6, 6],
    });
    expect(r.changed).toHaveLength(4);
    const g = await call(u, "get_deck", { deck_id: d });
    expect(g.settings).toMatchObject({
      daily_new_cards: 5,
      desired_retention: 0.85,
      learning_steps: ["2m", "1d"],
    });
    expect((await call(u, "list_presets"))[0].easy_days).toEqual([0, 6]);
    for (const args of [
      { new_cards_per_day: -1 },
      { desired_retention: 0.2 },
      { learning_steps: ["soon"] },
      { easy_days: [7] },
      { scheduling_mode: "weekly" },
    ])
      expect(
        (await call(u, "update_preset", { preset_id: "default", ...args })).code
      ).toBe("invalid_argument");
    expect(
      (await call(u, "update_preset", { preset_id: "zzz", enable_fuzz: true }))
        .code
    ).toBe("preset_not_found");
  });
});

describe("cards", () => {
  it("lists cards with filters, pages and tags", async () => {
    const u = await setup();
    const d = await deckOf(u, "A");
    await call(u, "add_cards", {
      deck_id: d,
      cards: [
        { front: "alpha", back: "1", tags: ["x"] },
        { front: "beta", back: "2", tags: ["x", "y"] },
        { front: "gamma", back: "3" },
      ],
    });
    const all = await call(u, "list_cards", { deck_id: d, limit: 2 });
    expect(all).toMatchObject({ total: 3, offset: 0, next_offset: 2 });
    expect(all.cards).toHaveLength(2);
    const p2 = await call(u, "list_cards", { deck_id: d, limit: 2, offset: 2 });
    expect(p2.next_offset).toBeNull();
    expect(p2.cards).toHaveLength(1);
    expect((await call(u, "list_cards", { tag: "y" })).total).toBe(1);
    expect((await call(u, "list_cards", { query: "gam" })).total).toBe(1);
    expect((await call(u, "list_cards", { status: "new" })).total).toBe(3);
    expect((await call(u, "list_cards", { status: "due" })).total).toBe(0);
    expect((await call(u, "list_cards", { status: "bogus" })).code).toBe(
      "invalid_argument"
    );
    expect(await call(u, "list_tags")).toEqual([
      { tag: "x", notes: 2 },
      { tag: "y", notes: 1 },
    ]);
  });

  it("buries, sets a due date, resets and overrides, logging manual changes", async () => {
    const u = await setup();
    const d = await deckOf(u, "A");
    const [id] = await cardsIn(u, d, [["q", "a"]]);
    expect(
      (
        await call(u, "set_card_schedule", {
          card_id: id,
          action: "set_due",
          due: "2030-01-01",
        })
      ).code
    ).toBe("new_card");
    await call(u, "grade_card", { card_id: id, rating: 3 });
    const b = await call(u, "set_card_schedule", {
      card_id: id,
      action: "bury",
    });
    expect(b.buried_until).toBeGreaterThan(Date.now());
    expect((await call(u, "list_cards", { status: "buried" })).total).toBe(1);
    await call(u, "set_card_schedule", { card_id: id, action: "unbury" });
    expect((await call(u, "list_cards", { status: "buried" })).total).toBe(0);

    const due = await call(u, "set_card_schedule", {
      card_id: id,
      action: "set_due",
      due: "2030-01-01",
    });
    expect(due.due).toBe(new Date("2030-01-01").getTime());
    const det = await call(u, "get_card_details", { card_id: id });
    expect(det.due).toBe(due.due);
    expect(det.stability).toBeGreaterThan(0);
    expect(det.reviews.map((r: any) => r.rating)).toEqual(["manual", "good"]);

    expect(
      (
        await call(u, "set_card_schedule", {
          card_id: id,
          action: "set_override",
          desired_retention: 0.95,
          maximum_interval: 30,
        })
      ).retention_override
    ).toEqual({ desiredRetention: 0.95, maximumInterval: 30 });
    expect(
      (
        await call(u, "set_card_schedule", {
          card_id: id,
          action: "set_override",
          desired_retention: 0.1,
        })
      ).code
    ).toBe("invalid_argument");
    await call(u, "set_card_schedule", {
      card_id: id,
      action: "set_override",
      desired_retention: null,
      maximum_interval: null,
    });
    expect(
      (await call(u, "get_card_details", { card_id: id })).retention_override
    ).toBeNull();

    await call(u, "set_card_schedule", { card_id: id, action: "reset" });
    const after = await call(u, "get_card_details", { card_id: id });
    expect(after).toMatchObject({ state: 0, reps: 0, due: null });
    expect(after.reviews).toHaveLength(3);
  });

  it("moves whole notes, keeping schedules", async () => {
    const u = await setup();
    const a = await deckOf(u, "A");
    const b = await deckOf(u, "B");
    const c = await call(u, "add_cards", {
      deck_id: a,
      cards: [
        { type: "cloze", text: "{{c1::x}} {{c2::y}}" },
        { front: "q", back: "a" },
      ],
    });
    const [c1, c2, basic] = c.card_ids as string[];
    await call(u, "grade_card", { card_id: c1, rating: 3 });
    const r = await call(u, "move_cards", { card_ids: [c1], deck_id: b });
    expect(r).toEqual({ moved: 2, notes: 1 });
    expect((await row(u, "cards", c2)).data.deck).toBe(b);
    expect((await row(u, "cards", basic)).data.deck).toBe(a);
    expect((await row(u, "cards", c1)).data.model.reps).toBe(1);
    const da = (await row(u, "decks", a)).data;
    const db_ = (await row(u, "decks", b)).data;
    expect(da.cards).toEqual([basic]);
    expect(db_.cards.sort()).toEqual([c1, c2].sort());
    expect(db_.notes).toHaveLength(1);
    expect(
      (await call(u, "move_cards", { card_ids: [c1], deck_id: b })).moved
    ).toBe(0);
    expect(
      (await call(u, "move_cards", { card_ids: ["nope"], deck_id: b })).code
    ).toBe("card_not_found");
    expect(
      (await call(u, "move_cards", { card_ids: [c1], deck_id: "nope" })).code
    ).toBe("deck_not_found");
  });

  it("deletes cards after confirmation and drops emptied notes", async () => {
    const u = await setup();
    const a = await deckOf(u, "A");
    const c = await call(u, "add_cards", {
      deck_id: a,
      cards: [
        { type: "cloze", text: "{{c1::x}} {{c2::y}}" },
        { front: "q", back: "a" },
      ],
    });
    const [c1, c2, basic] = c.card_ids as string[];
    const p = await call(u, "delete_cards", { card_ids: [c1, basic] });
    expect(p.will_delete).toMatchObject({ cards: 2, notes: 1 });
    expect((await row(u, "cards", c1)).deleted).toBe(false);
    expect(
      (
        await call(u, "delete_cards", {
          card_ids: [c1, basic],
          confirm_token: "x",
        })
      ).code
    ).toBe("confirm_token_mismatch");
    expect(
      (
        await call(u, "delete_cards", {
          card_ids: [c1],
          confirm_token: p.confirm_token,
        })
      ).code
    ).toBe("confirm_token_mismatch");
    const done = await call(u, "delete_cards", {
      card_ids: [basic, c1],
      confirm_token: p.confirm_token,
    });
    expect(done).toEqual({ deleted: true, cards: 2, notes: 1 });
    expect((await row(u, "cards", c1)).deleted).toBe(true);
    expect((await row(u, "cards", c2)).deleted).toBe(false);
    const deck = (await row(u, "decks", a)).data;
    expect(deck.cards).toEqual([c2]);
    expect(deck.notes).toHaveLength(1);
  });

  it("bulk-tags and suspends, with shared note tags", async () => {
    const u = await setup();
    const a = await deckOf(u, "A");
    const ids = await cardsIn(u, a, [
      ["1", "1"],
      ["2", "2"],
    ]);
    const r = await call(u, "bulk_update_cards", {
      card_ids: ids,
      add_tags: ["Exam", "week 1"],
      suspended: true,
    });
    expect(r).toMatchObject({ ok: true, cards: 2, notes_changed: 2 });
    expect((await call(u, "list_cards", { status: "suspended" })).total).toBe(
      2
    );
    const tags = (await call(u, "list_tags")).map((t: any) => t.tag);
    expect(tags).toHaveLength(2);
    await call(u, "bulk_update_cards", {
      card_ids: [ids[0]],
      remove_tags: [tags[0]],
      suspended: false,
    });
    expect((await call(u, "list_cards", { status: "suspended" })).total).toBe(
      1
    );
    expect((await call(u, "bulk_update_cards", { card_ids: ids })).code).toBe(
      "nothing_to_change"
    );
    expect(
      (await call(u, "bulk_update_cards", { card_ids: [], suspended: true }))
        .code
    ).toBe("invalid_argument");
  });

  it("shows the schedule: overdue, per day, later, new", async () => {
    const u = await setup();
    const a = await deckOf(u, "A");
    const ids = await cardsIn(u, a, [
      ["1", "1"],
      ["2", "2"],
      ["3", "3"],
    ]);
    await call(u, "grade_card", { card_id: ids[0], rating: 3 });
    await call(u, "grade_card", { card_id: ids[1], rating: 4 });
    await call(u, "set_card_schedule", {
      card_id: ids[1],
      action: "set_due",
      due: new Date(Date.now() + 40 * 86_400_000).toISOString(),
    });
    const s = await call(u, "deck_schedule", { deck_id: a, days: 3 });
    expect(s.studied).toBe(2);
    expect(s.newCards).toBe(1);
    expect(s.later).toBeGreaterThanOrEqual(1);
    expect(s.days).toHaveLength(3);
    // The first label is the study day that contains now (the day starts at 04:00 local time).
    const d = new Date(Date.now() - 4 * 3_600_000);
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(s.days[0].date).toBe(today);
    expect(s.avgStability).toBeGreaterThan(0);
    expect(s.avgRecall).toBeGreaterThan(0);
  });

  it("keeps every user's data private", async () => {
    const a = await setup();
    const b = await setup();
    const d = await deckOf(a, "A");
    const [id] = await cardsIn(a, d, [["q", "a"]]);
    expect((await call(b, "get_deck", { deck_id: d })).code).toBe(
      "deck_not_found"
    );
    expect((await call(b, "delete_deck", { deck_id: d })).code).toBe(
      "deck_not_found"
    );
    expect((await call(b, "get_card_details", { card_id: id })).code).toBe(
      "card_not_found"
    );
    expect((await call(b, "delete_cards", { card_ids: [id] })).code).toBe(
      "card_not_found"
    );
    expect((await call(b, "list_cards")).total).toBe(0);
  });
});

describe("deck paths", () => {
  it("accepts a path for list_cards, move_cards and update_deck parent_id", async () => {
    const u = await setup();
    const med = await deckOf(u, "Med");
    const cardio = await deckOf(u, "Cardiology", med);
    const other = await deckOf(u, "Other");
    const [c1] = await cardsIn(u, cardio, [["q", "a"]]);
    const listed = await call(u, "list_cards", { deck_id: "med::cardiology" });
    expect(listed.cards.map((c: any) => c.id)).toEqual([c1]);
    expect(
      (await call(u, "move_cards", { card_ids: [c1], deck_id: "Other" })).moved
    ).toBe(1);
    expect((await row(u, "cards", c1)).data.deck).toBe(other);
    expect(
      (await call(u, "update_deck", { deck_id: cardio, parent_id: "Other" }))
        .changed
    ).toEqual(["parent_id"]);
    expect((await row(u, "decks", cardio)).data.superDecks).toEqual([other]);
    expect(
      (
        await call(u, "update_deck", {
          deck_id: other,
          parent_id: "Other::Cardiology",
        })
      ).code
    ).toBe("invalid_move");
    expect((await call(u, "list_cards", { deck_id: "Nope::Deck" })).code).toBe(
      "deck_not_found"
    );
  });

  it("refuses '::' and case-only sibling duplicates in create_deck and update_deck", async () => {
    const u = await setup();
    const a = await deckOf(u, "Med");
    const b = await deckOf(u, "Cardiology", a);
    await deckOf(u, "Renal", a);
    expect((await call(u, "create_deck", { name: "A::B" })).code).toBe(
      "invalid_argument"
    );
    expect(
      (await call(u, "create_deck", { name: "cardiology", parent_id: "Med" }))
        .code
    ).toBe("deck_name_taken");
    expect(
      (await call(u, "update_deck", { deck_id: b, name: "A::B" })).code
    ).toBe("invalid_argument");
    expect(
      (await call(u, "update_deck", { deck_id: b, name: "RENAL" })).code
    ).toBe("deck_name_taken");
    // renaming a deck to a case change of itself is fine
    expect(
      (await call(u, "update_deck", { deck_id: b, name: "CARDIOLOGY" })).ok
    ).toBe(true);
  });
});
