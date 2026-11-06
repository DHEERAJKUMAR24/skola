// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";
import { pushRows } from "./sync";

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  for (const f of [
    "20261101000000_init",
    "20261102000000_skills",
    "20261104000000_image_assets",
    "20261105000000_study_sessions",
    "20261106000000_note_versions",
    "20261107000000_learning_evidence",
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
  const user = `ms-${++n}`;
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
const deckOf = async (u: string, name = "JS") =>
  (await call(u, "create_deck", { name })).id as string;
async function cards(
  u: string,
  deck: string,
  fronts: string[],
  tags?: string[]
) {
  return (
    await call(u, "add_cards", {
      deck_id: deck,
      cards: fronts.map((front) => ({ front, back: `${front} answer`, tags })),
    })
  ).card_ids as string[];
}
const live = async (u: string, id: string) => {
  const r = await row(u, "cards", id);
  return r && !r.deleted ? r.data : undefined;
};
const sections = (title: string, entries: unknown[]) => [{ title, entries }];

describe("create_master_card", () => {
  it("writes a master with its study card and names follow the hierarchy", async () => {
    const u = await setup();
    const d = await deckOf(u);
    const [a, b] = await cards(u, d, ["closure", "hoisting"]);
    const r = await call(u, "create_master_card", {
      deck_id: d,
      title: "JS core",
      sections: [
        {
          title: "Scope",
          entries: [{ text: "closure", card_id: a }, "hoisting"],
        },
        { title: "Types", entries: [{ card_id: b }] },
      ],
    });
    expect(r).toMatchObject({
      created: true,
      replayed: false,
      title: "JS core",
    });
    expect(r.card_ids).toHaveLength(1);
    expect(r.summary).toBe("2 Chapters, 3 Concepts");
    expect(r.labels).toMatchObject({ section: "Chapter", entry: "Concept" });
    const note = (await row(u, "notes", r.master_id)).data;
    expect(note.content.type).toBe("master");
    expect(note.sortField).toBe("JS core");
    // entry text defaulted from the linked card's note
    expect(note.content.sections[1].entries[0].text).toBe("hoisting");
    const card = (await row(u, "cards", r.card_ids[0])).data;
    expect(card).toMatchObject({
      deck: d,
      note: r.master_id,
      content: { type: "master" },
    });
    const deck = (await row(u, "decks", d)).data;
    expect(deck.notes).toContain(r.master_id);
    expect(deck.cards).toContain(r.card_ids[0]);

    await pushRows(db, u, [
      {
        tbl: "settings",
        id: "#hierarchy",
        updatedAt: Date.now(),
        data: {
          key: "#hierarchy",
          value: [
            { id: "d", name: "Course", role: "deck" },
            { id: "s", name: "Topic", role: "section" },
            { id: "e", name: "Fact", role: "entry" },
          ],
        },
      },
    ]);
    const g = await call(u, "get_master_card", { master_id: r.master_id });
    expect(g.summary).toBe("2 Topics, 3 Facts");
    expect(g.labels).toMatchObject({
      deck: "Course",
      section: "Topic",
      entry: "Fact",
    });
  });

  it("rejects bad input with codes and creates nothing", async () => {
    const u = await setup();
    const d = await deckOf(u);
    const [a] = await cards(u, d, ["x"]);
    const run = (args: object) =>
      call(u, "create_master_card", { deck_id: d, title: "T", ...args });
    expect(
      (
        await call(u, "create_master_card", {
          deck_id: "nope",
          title: "T",
          sections: [],
        })
      ).code
    ).toBe("deck_not_found");
    expect(
      (await run({ sections: sections("S", [{ card_id: "ghost" }]) })).code
    ).toBe("card_not_found");
    expect((await run({ sections: sections("S", []) })).code).toBe(
      "invalid_master"
    );
    expect((await run({})).code).toBe("invalid_argument");
    expect((await run({ from_deck: true, sections: [] })).code).toBe(
      "invalid_argument"
    );
    const ok = await run({ sections: sections("S", [{ card_id: a }]) });
    // another master's study card cannot be linked
    expect(
      (await run({ sections: sections("S", [{ card_id: ok.card_ids[0] }]) }))
        .code
    ).toBe("invalid_link");
  });

  it("is idempotent with a key and conflicts on different content", async () => {
    const u = await setup();
    const d = await deckOf(u);
    const [a] = await cards(u, d, ["x"]);
    const args = {
      deck_id: d,
      title: "T",
      idempotency_key: "k1",
      sections: sections("S", [{ card_id: a }]),
    };
    const first = await call(u, "create_master_card", args);
    const again = await call(u, "create_master_card", args);
    expect(again).toMatchObject({
      replayed: true,
      created: false,
      master_id: first.master_id,
    });
    expect(again.card_ids).toEqual(first.card_ids);
    expect(
      (await call(u, "create_master_card", { ...args, title: "Other" })).code
    ).toBe("idempotency_conflict");
    expect(
      (await call(u, "list_master_cards", { deck_id: d })).masters
    ).toHaveLength(1);
    expect(
      (await call(u, "create_master_card", { ...args, idempotency_key: "" }))
        .code
    ).toBe("invalid_idempotency_key");
  });

  it("generates from the deck by tag with a dry run that saves nothing", async () => {
    const u = await setup();
    const d = await deckOf(u);
    await cards(u, d, ["a1", "a2"], ["scope"]);
    await cards(u, d, ["b1"], ["types"]);
    await cards(u, d, ["c1"]);
    const preview = await call(u, "create_master_card", {
      deck_id: d,
      from_deck: true,
      dry_run: true,
    });
    expect(preview.dry_run).toBe(true);
    expect(preview.would_create.sections.map((s: any) => s.title)).toEqual([
      "scope",
      "types",
      "Untagged",
    ]);
    expect(preview.summary).toBe("3 Chapters, 4 Concepts");
    expect((await call(u, "list_master_cards")).masters).toHaveLength(0);

    const made = await call(u, "create_master_card", {
      deck_id: d,
      from_deck: true,
      title: "Auto",
      idempotency_key: "auto-1",
    });
    expect(made.coverage).toMatchObject({
      complete: true,
      coverage: 1,
      orphan_cards: 0,
    });
    const flat = await call(u, "create_master_card", {
      deck_id: d,
      from_deck: true,
      group_by: "none",
      title: "Flat",
    });
    // the first master's study card is not an entry of the second
    expect(flat.summary).toBe("1 Chapter, 4 Concepts");
    const replay = await call(u, "create_master_card", {
      deck_id: d,
      from_deck: true,
      title: "Auto",
      idempotency_key: "auto-1",
    });
    expect(replay.replayed).toBe(true);
  });

  it("refuses more entries than a master holds", async () => {
    const u = await setup();
    const d = await deckOf(u);
    const r = await call(u, "create_master_card", {
      deck_id: d,
      title: "Big",
      sections: sections(
        "S",
        Array.from({ length: 501 }, (_, i) => `e${i}`)
      ),
    });
    expect(r.code).toBe("invalid_master");
  });
});

describe("get, list and the renamed tool", () => {
  it("reads a master back with card state and the text form", async () => {
    const u = await setup();
    const d = await deckOf(u);
    const [a] = await cards(u, d, ["closure"]);
    const m = await call(u, "create_master_card", {
      deck_id: d,
      title: "JS",
      sections: sections("Scope", [{ card_id: a }, "no card yet"]),
    });
    const g = await call(u, "get_master_card", { card_id: m.card_ids[0] });
    expect(g.master_id).toBe(m.master_id);
    expect(g.sections[0].entries[0]).toMatchObject({
      card_id: a,
      card: { state: "new", suspended: false },
    });
    expect(g.sections[0].entries[1].card_id).toBeNull();
    expect(g.text).toContain(`- closure {{card:${a}}}`);
    expect(g.study_cards).toHaveLength(1);
    expect(g.coverage.unlinked_entries).toBe(1);
    expect(g.problems.join()).toContain("no card");

    const l = await call(u, "list_master_cards", { deck_id: d });
    expect(l.masters[0]).toMatchObject({
      master_id: m.master_id,
      entries: 2,
      sections: 1,
    });
    expect(l.masters[0].coverage.complete).toBe(false);

    expect(
      (await call(u, "get_master_card", { master_id: "ghost" })).code
    ).toBe("master_not_found");
    expect((await call(u, "get_master_card", { master_id: a })).code).toBe(
      "not_a_master"
    );
    expect((await call(u, "get_master_card", {})).code).toBe(
      "invalid_argument"
    );
  });

  it("gives old callers a clear hint and lists the new tools", async () => {
    const u = await setup();
    const old = await call(u, "get_master_card", { objective_id: "obj_1" });
    expect(old.code).toBe("renamed_tool");
    expect(old.error).toContain("get_objective_overview");
    const list: any = await handleRpc(db, u, { id: 1, method: "tools/list" });
    const tool = list.result.tools.find(
      (t: any) => t.name === "get_master_card"
    );
    expect(tool.description).toContain("RENAMED TOOL");
    expect(tool.annotations.readOnlyHint).toBe(true);
    const names = list.result.tools.map((t: any) => t.name);
    for (const t of [
      "create_master_card",
      "list_master_cards",
      "update_master_card",
      "master_coverage",
      "suggest_master_rating",
      "delete_master_card",
      "get_objective_overview",
    ])
      expect(names).toContain(t);
    expect(
      list.result.tools.find((t: any) => t.name === "delete_master_card")
        .annotations.destructiveHint
    ).toBe(true);
  });

  it("scopes list_master_cards to a deck and its sub-decks", async () => {
    const u = await setup();
    const top = await deckOf(u, "Top");
    const sub = (await call(u, "create_deck", { name: "Sub", parent_id: top }))
      .id as string;
    const mk = async (deck: string, title: string) =>
      call(u, "create_master_card", {
        deck_id: deck,
        title,
        sections: sections("S", ["x"]),
      });
    await mk(top, "T");
    await mk(sub, "S");
    expect(
      (await call(u, "list_master_cards", { deck_id: top })).masters
    ).toHaveLength(1);
    expect(
      (
        await call(u, "list_master_cards", {
          deck_id: top,
          include_sub_decks: true,
        })
      ).masters
    ).toHaveLength(2);
    expect((await call(u, "list_master_cards")).masters).toHaveLength(2);
    expect((await call(u, "list_master_cards", { deck_id: "x" })).code).toBe(
      "deck_not_found"
    );
  });
});

describe("update_master_card", () => {
  async function fixture() {
    const u = await setup();
    const d = await deckOf(u);
    const ids = await cards(u, d, ["one", "two", "three"]);
    const m = await call(u, "create_master_card", {
      deck_id: d,
      title: "T",
      sections: [
        { title: "A", entries: [{ card_id: ids[0] }] },
        { title: "B", entries: [{ card_id: ids[1] }] },
      ],
    });
    const g = await call(u, "get_master_card", { master_id: m.master_id });
    return { u, d, ids, m, g };
  }

  it("adds, renames, moves, links, unlinks and removes", async () => {
    const { u, ids, m, g } = await fixture();
    const [A, B] = g.sections;
    const r = await call(u, "update_master_card", {
      master_id: m.master_id,
      title: "Renamed",
      ops: [
        { op: "rename_section", section_id: A.id, title: "Alpha" },
        {
          op: "add_section",
          title: "C",
          entries: ["loose", { card_id: ids[2] }],
          position: 0,
        },
        {
          op: "move_entry",
          entry_id: B.entries[0].id,
          section_id: A.id,
          position: 0,
        },
        { op: "add_entry", section_id: B.id, text: "extra" },
        { op: "unlink_entry", entry_id: A.entries[0].id },
        { op: "link_entry", entry_id: A.entries[0].id, card_id: ids[0] },
      ],
    });
    expect(r).toMatchObject({
      changed: true,
      title: "Renamed",
      replayed: false,
    });
    const after = await call(u, "get_master_card", {
      master_id: m.master_id,
    });
    expect(after.title).toBe("Renamed");
    expect(after.sections.map((s: any) => s.title)).toEqual([
      "C",
      "Alpha",
      "B",
    ]);
    expect(after.sections[1].entries.map((e: any) => e.text)).toEqual([
      "two",
      "one",
    ]);
    expect(after.sections[2].entries[0].text).toBe("extra");
    expect(after.sections[0].entries[1]).toMatchObject({ card_id: ids[2] });

    const r2 = await call(u, "update_master_card", {
      master_id: m.master_id,
      ops: [
        { op: "remove_entry", entry_id: after.sections[0].entries[0].id },
        { op: "remove_section", section_id: after.sections[2].id },
        {
          op: "update_entry",
          entry_id: after.sections[1].entries[0].id,
          text: "TWO",
        },
      ],
    });
    expect(r2.changed).toBe(true);
    const fin = await call(u, "get_master_card", { master_id: m.master_id });
    expect(fin.sections.map((s: any) => s.title)).toEqual(["C", "Alpha"]);
    expect(fin.sections[1].entries[0].text).toBe("TWO");
    // removed entries never delete the ordinary cards they linked
    expect(await live(u, ids[1])).toBeDefined();
  });

  it("validates ops with codes and writes nothing on failure", async () => {
    const { u, m, g } = await fixture();
    const upd = (ops: object[]) =>
      call(u, "update_master_card", { master_id: m.master_id, ops });
    const first = g.sections[0].entries[0].id;
    expect((await upd([{ op: "nope" }])).code).toBe("invalid_op");
    expect(
      (await upd([{ op: "rename_section", section_id: "x", title: "T" }])).code
    ).toBe("section_not_found");
    expect((await upd([{ op: "remove_entry", entry_id: "x" }])).code).toBe(
      "entry_not_found"
    );
    expect(
      (await upd([{ op: "add_entry", section_id: g.sections[0].id }])).code
    ).toBe("invalid_op");
    expect(
      (await upd([{ op: "link_entry", entry_id: first, card_id: "ghost" }]))
        .code
    ).toBe("card_not_found");
    expect(
      (
        await upd([
          { op: "link_entry", entry_id: first, card_id: m.card_ids[0] },
        ])
      ).code
    ).toBe("invalid_link");
    // a valid first op followed by a bad one: all or nothing
    expect(
      (
        await upd([
          { op: "rename_title", title: "X" },
          { op: "remove_entry", entry_id: "x" },
        ])
      ).code
    ).toBe("entry_not_found");
    expect(
      (await call(u, "get_master_card", { master_id: m.master_id })).title
    ).toBe("T");
    expect(
      (
        await upd([
          { op: "remove_section", section_id: g.sections[0].id },
          { op: "remove_section", section_id: g.sections[1].id },
        ])
      ).code
    ).toBe("invalid_master");
    expect(
      (await call(u, "update_master_card", { master_id: m.master_id })).code
    ).toBe("invalid_argument");
  });

  it("follows the plan: one card up to 12 entries, a card per section above, retiring reviewed ones", async () => {
    const { u, d, m, g } = await fixture();
    const first = m.card_ids[0];
    // review the whole-master card so it has history
    const s = await call(u, "start_study_session", {
      deck_id: d,
      limit: 50,
      new_limit: 50,
    });
    let cur: any = s;
    while (!cur.done && cur.card_id !== first)
      cur = await call(u, "next_card", {
        session_id: s.session_id,
        skip: true,
      });
    expect(cur.card_id).toBe(first);
    await call(u, "show_answer", { session_id: s.session_id, card_id: first });
    await call(u, "submit_review", {
      session_id: s.session_id,
      card_id: first,
      rating: 3,
    });
    await call(u, "end_session", { session_id: s.session_id });

    const many = Array.from({ length: 13 }, (_, i) => `fact ${i}`);
    const up = await call(u, "update_master_card", {
      master_id: m.master_id,
      ops: [
        { op: "add_entry", section_id: g.sections[0].id, text: "x" },
        ...many.map((t) => ({
          op: "add_entry",
          section_id: g.sections[1].id,
          text: t,
        })),
      ],
    });
    // 15 entries and two sections: one card per section, the reviewed whole-master card is retired
    expect(up.study_cards.created).toHaveLength(2);
    expect(up.study_cards.retired).toEqual([first]);
    expect(up.study_cards.deleted).toEqual([]);
    expect(await live(u, first)).toMatchObject({
      suspended: true,
      content: { retired: true },
    });
    const gg = await call(u, "get_master_card", { master_id: m.master_id });
    expect(gg.study_cards.filter((c: any) => !c.retired)).toHaveLength(2);

    // back to few entries: the unreviewed section cards are deleted, the retired card returns
    const back = await call(u, "update_master_card", {
      master_id: m.master_id,
      ops: gg.sections[1].entries
        .slice(1)
        .map((e: any) => ({ op: "remove_entry", entry_id: e.id })),
    });
    expect(back.study_cards.restored).toEqual([first]);
    expect(back.study_cards.deleted).toHaveLength(2);
    expect(await live(u, first)).toMatchObject({
      suspended: false,
      content: { retired: false },
    });
    for (const id of back.study_cards.deleted)
      expect(await live(u, id)).toBeUndefined();
    const deck = (await row(u, "decks", d)).data;
    expect(deck.cards).not.toContain(back.study_cards.deleted[0]);
    expect(deck.cards).toContain(first);
  });

  it("keeps 7-day history of every change and restores study cards with the text", async () => {
    const { u, m, g } = await fixture();
    await call(u, "update_master_card", {
      master_id: m.master_id,
      ops: [
        {
          op: "rename_section",
          section_id: g.sections[0].id,
          title: "Changed",
        },
      ],
    });
    const h = await call(u, "card_history", { card_id: m.card_ids[0] });
    expect(h.versions.length).toBeGreaterThanOrEqual(1);
    expect(h.versions[0].fields.text).toContain("# A");
    expect(h.current.fields.text).toContain("# Changed");
    // grow beyond the split threshold, then restore the small version
    await call(u, "update_master_card", {
      master_id: m.master_id,
      ops: Array.from({ length: 13 }, (_, i) => ({
        op: "add_entry",
        section_id: g.sections[1].id,
        text: `f${i}`,
      })),
    });
    const active = async () =>
      (
        await call(u, "get_master_card", { master_id: m.master_id })
      ).study_cards.filter((c: any) => !c.retired);
    const grown = await active();
    expect(grown).toHaveLength(2);
    const small = (
      await call(u, "card_history", { card_id: grown[0].card_id })
    ).versions.find((v: any) => !v.fields.text.includes("f12"));
    const r = await call(u, "restore_card_version", {
      card_id: grown[0].card_id,
      version_id: small.version_id,
    });
    expect(r.study_cards_adjusted).toBeGreaterThan(0);
    expect(await active()).toHaveLength(1);
  });

  it("is idempotent with a key", async () => {
    const { u, m, g } = await fixture();
    const args = {
      master_id: m.master_id,
      idempotency_key: "u1",
      ops: [{ op: "add_section", title: "New", entries: ["e"] }],
    };
    expect((await call(u, "update_master_card", args)).replayed).toBe(false);
    const again = await call(u, "update_master_card", args);
    expect(again).toMatchObject({ replayed: true, changed: false });
    const g2 = await call(u, "get_master_card", { master_id: m.master_id });
    expect(g2.sections).toHaveLength(g.sections.length + 1);
    expect(
      (
        await call(u, "update_master_card", {
          ...args,
          ops: [{ op: "rename_title", title: "Z" }],
        })
      ).code
    ).toBe("idempotency_conflict");
  });
});

describe("master_coverage", () => {
  it("finds orphans and dangling entries and the fix ops repair them", async () => {
    const u = await setup();
    const d = await deckOf(u);
    const ids = await cards(u, d, ["alpha", "beta"]);
    const tagged = (
      await call(u, "add_cards", {
        deck_id: d,
        cards: [{ front: "gamma", back: "g", tags: ["scope"] }],
      })
    ).card_ids[0];
    const m = await call(u, "create_master_card", {
      deck_id: d,
      title: "T",
      sections: sections(
        "Scope",
        ids.map((card_id) => ({ card_id }))
      ),
    });
    // beta is deleted (dangling); gamma and a late card are orphans
    await cards(u, d, ["late"]);
    const del = await call(u, "delete_cards", { card_ids: [ids[1]] });
    expect(del.will_delete.linked_from_masters).toEqual([
      { master_id: m.master_id, title: "T", entries: 1 },
    ]);
    await call(u, "delete_cards", {
      card_ids: [ids[1]],
      confirm_token: del.confirm_token,
    });

    const c = await call(u, "master_coverage", { master_id: m.master_id });
    expect(c.complete).toBe(false);
    expect(c.orphan_cards.items.map((o: any) => o.text).sort()).toEqual([
      "gamma",
      "late",
    ]);
    expect(
      c.orphan_cards.items.find((o: any) => o.card_id === tagged)
    ).toMatchObject({ suggested_section_title: "Scope" });
    expect(c.dangling_entries.items).toHaveLength(1);
    expect(c.dangling_entries.items[0]).toMatchObject({
      card_id: ids[1],
      section_title: "Scope",
    });
    expect(c.fix_ops.map((o: any) => o.op)).toEqual([
      "add_entry",
      "add_orphan_cards",
      "remove_dangling_entries",
    ]);
    expect(c.problems.length).toBeGreaterThan(0);

    const fixed = await call(u, "update_master_card", {
      master_id: m.master_id,
      ops: c.fix_ops,
    });
    expect(fixed.coverage).toMatchObject({
      complete: true,
      orphan_cards: 0,
      dangling_entries: 0,
    });
    const g = await call(u, "get_master_card", { master_id: m.master_id });
    expect(g.sections.map((s: any) => s.title)).toEqual(["Scope", "Unsorted"]);
    expect(
      (await call(u, "master_coverage", { master_id: m.master_id })).complete
    ).toBe(true);
  });

  it("reports empty sections, unlinked and stale entries and same-card duplicates", async () => {
    const u = await setup();
    const d = await deckOf(u);
    const [a] = await cards(u, d, ["alpha"]);
    await call(u, "edit_card", { card_id: a, suspended: true });
    const m = await call(u, "create_master_card", {
      deck_id: d,
      title: "T",
      sections: [
        {
          title: "S",
          entries: [
            { text: "one", card_id: a },
            { text: "two", card_id: a },
            "nothing",
          ],
        },
        { title: "E", entries: [] },
      ],
    });
    const c = await call(u, "master_coverage", { master_id: m.master_id });
    expect(c.empty_sections).toHaveLength(1);
    expect(c.unlinked_entries.items).toHaveLength(1);
    expect(c.stale_entries.items[0].reasons).toContain("suspended");
    expect(c.duplicates.same_card).toHaveLength(1);
    expect(c.fix_ops.some((o: any) => o.op === "remove_section")).toBe(true);
  });
});

describe("suggest_master_rating", () => {
  it("is Again for untested cards and says it is only a suggestion", async () => {
    const u = await setup();
    const d = await deckOf(u);
    const ids = await cards(u, d, ["a", "b"]);
    const m = await call(u, "create_master_card", {
      deck_id: d,
      title: "T",
      sections: sections(
        "S",
        ids.map((card_id) => ({ card_id }))
      ),
    });
    const s = await call(u, "suggest_master_rating", {
      master_id: m.master_id,
    });
    expect(s).toMatchObject({
      rating: 1,
      label: "Again",
      scope: "whole master",
    });
    expect(s.counts.neverReviewed).toBe(2);
    expect(s.note).toContain("never record");
    expect(
      (
        await call(u, "suggest_master_rating", {
          master_id: m.master_id,
          section_id: "x",
        })
      ).code
    ).toBe("section_not_found");
  });

  it("rises after the linked cards are reviewed well, and can judge one section", async () => {
    const u = await setup();
    const d = await deckOf(u);
    const ids = await cards(u, d, ["a", "b"]);
    for (const id of ids)
      await call(u, "grade_card", { card_id: id, rating: 4 });
    const m = await call(u, "create_master_card", {
      deck_id: d,
      title: "T",
      sections: [
        { title: "S1", entries: [{ card_id: ids[0] }] },
        { title: "S2", entries: [{ card_id: ids[1] }, "unlinked"] },
      ],
    });
    const whole = await call(u, "suggest_master_rating", {
      master_id: m.master_id,
    });
    const g = await call(u, "get_master_card", { master_id: m.master_id });
    const s1 = await call(u, "suggest_master_rating", {
      master_id: m.master_id,
      section_id: g.sections[0].id,
    });
    expect(s1.score).toBeGreaterThan(whole.score);
    expect(whole.counts.unlinked).toBe(1);
  });
});

describe("delete_master_card", () => {
  it("needs a confirm token, removes only the master and keeps linked cards", async () => {
    const u = await setup();
    const d = await deckOf(u);
    const [a] = await cards(u, d, ["alpha"]);
    const m = await call(u, "create_master_card", {
      deck_id: d,
      title: "Doomed",
      sections: sections("S", [{ card_id: a }]),
    });
    const prev = await call(u, "delete_master_card", {
      master_id: m.master_id,
    });
    expect(prev).toMatchObject({
      deleted: false,
      will_delete: { title: "Doomed", study_cards: 1 },
    });
    expect((await row(u, "notes", m.master_id)).deleted).toBe(false);
    expect(
      (
        await call(u, "delete_master_card", {
          master_id: m.master_id,
          confirm_token: "bad",
        })
      ).code
    ).toBe("confirm_token_mismatch");
    // the token only fits this exact master: a change invalidates it
    const sec = (await call(u, "get_master_card", { master_id: m.master_id }))
      .sections[0].id;
    await call(u, "update_master_card", {
      master_id: m.master_id,
      ops: [{ op: "add_entry", section_id: sec, text: "more" }],
    });
    expect(
      (
        await call(u, "delete_master_card", {
          master_id: m.master_id,
          confirm_token: prev.confirm_token,
        })
      ).code
    ).toBe("confirm_token_mismatch");
    const prev2 = await call(u, "delete_master_card", {
      master_id: m.master_id,
    });
    const done = await call(u, "delete_master_card", {
      master_id: m.master_id,
      confirm_token: prev2.confirm_token,
    });
    expect(done).toMatchObject({ deleted: true, study_cards: 1 });
    expect((await row(u, "notes", m.master_id)).deleted).toBe(true);
    expect((await row(u, "cards", m.card_ids[0])).deleted).toBe(true);
    expect(await live(u, a)).toBeDefined();
    const deck = (await row(u, "decks", d)).data;
    expect(deck.notes).not.toContain(m.master_id);
    expect(deck.cards).not.toContain(m.card_ids[0]);
    expect(deck.cards).toContain(a);
    expect(
      (await call(u, "get_master_card", { master_id: m.master_id })).code
    ).toBe("master_not_found");
  });

  it("is not available to another user", async () => {
    const u = await setup();
    const other = await setup();
    const d = await deckOf(u);
    const m = await call(u, "create_master_card", {
      deck_id: d,
      title: "T",
      sections: sections("S", ["x"]),
    });
    expect(
      (await call(other, "get_master_card", { master_id: m.master_id })).code
    ).toBe("master_not_found");
    expect(
      (await call(other, "delete_master_card", { master_id: m.master_id })).code
    ).toBe("master_not_found");
  });
});

describe("other tools know the master type", () => {
  async function master() {
    const u = await setup();
    const d = await deckOf(u);
    const [a] = await cards(u, d, ["closure"]);
    const m = await call(u, "create_master_card", {
      deck_id: d,
      title: "JS core",
      tags: ["Core"],
      sections: sections("Scope", [{ card_id: a }, "event loop"]),
    });
    return { u, d, a, m, card: m.card_ids[0] as string };
  }

  it("search_cards, list_cards and find_duplicates read master text", async () => {
    const { u, d, m, card } = await master();
    const hit = await call(u, "search_cards", { query: "event loop" });
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({
      id: card,
      type: "master",
      master: { master_id: m.master_id, section_id: null, retired: false },
    });
    expect(hit[0].fields.title).toBe("JS core");
    expect(hit[0].fields.text).toContain("# Scope");
    const l = await call(u, "list_cards", {
      query: "event loop",
      status: "new",
    });
    expect(l.total).toBe(1);
    expect(l.cards[0].tags).toEqual(["core"]);
    expect(await call(u, "find_duplicates")).toEqual([]);
    // two identical masters are real duplicates
    for (const _ of [1, 2])
      await call(u, "create_master_card", {
        deck_id: d,
        title: "Same",
        sections: sections("Scope", ["closure", "event loop"]),
      });
    expect((await call(u, "find_duplicates")).length).toBe(1);
    expect((await call(u, "find_similar_cards")).groups).toEqual([]);
  });

  it("edit_card, delete_cards, get_card_details and move_cards handle a master", async () => {
    const { u, d, m, card } = await master();
    expect(
      (await call(u, "edit_card", { card_id: card, front: "x" })).error
    ).toContain("update_master_card");
    expect(
      (await call(u, "edit_card", { card_id: card, tags: ["new"] })).ok
    ).toBe(true);
    expect(
      (await call(u, "edit_card", { card_id: card, suspended: false })).ok
    ).toBe(true);
    expect((await call(u, "delete_cards", { card_ids: [card] })).code).toBe(
      "master_card"
    );
    const det = await call(u, "get_card_details", { card_id: card });
    expect(det).toMatchObject({
      type: "master",
      master: { master_id: m.master_id, title: "JS core", retired: false },
    });
    const other = await deckOf(u, "Other");
    const mv = await call(u, "move_cards", {
      card_ids: [card],
      deck_id: other,
    });
    expect(mv).toMatchObject({ moved: 1, notes: 1 });
    expect(
      (await call(u, "get_master_card", { master_id: m.master_id })).deck_id
    ).toBe(other);
    expect((await row(u, "decks", d)).data.notes).not.toContain(m.master_id);
  });

  it("a study session asks the recall question and shows the entries plus a suggested rating", async () => {
    const { u, d, a, card } = await master();
    await call(u, "grade_card", { card_id: a, rating: 3 });
    const s = await call(u, "start_study_session", {
      deck_id: d,
      limit: 10,
      new_limit: 10,
    });
    let cur: any = s;
    while (!cur.done && cur.card_id !== card)
      cur = await call(u, "next_card", {
        session_id: s.session_id,
        skip: true,
      });
    expect(cur.type).toBe("master");
    expect(cur.question).toMatchObject({
      master: "JS core",
      recall_everything_in: ["Scope"],
      entries_to_recall: 2,
    });
    expect(JSON.stringify(cur.question)).not.toContain("event loop");
    const ans = await call(u, "show_answer", {
      session_id: s.session_id,
      card_id: card,
    });
    expect(ans.answer.sections[0].entries).toEqual(["closure", "event loop"]);
    expect(ans.suggested_rating).toMatchObject({
      counts: { entries: 2, unlinked: 1 },
    });
    expect(ans.suggestion_note).toContain("never pick");
    // the learner's own rating is what gets recorded
    const r = await call(u, "submit_review", {
      session_id: s.session_id,
      card_id: card,
      rating: 2,
    });
    expect(r.error).toBeUndefined();
  });
});
