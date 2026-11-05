// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";

const DAY = 86_400_000;
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
afterEach(() => vi.useRealTimers());

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
const newUser = () => `e-${++n}`;
async function objective(user: string, args: object = {}) {
  return (await call(user, "create_objective", { title: "Closures", ...args }))
    .objective_id as string;
}
const K = ["recall", "explanation", "discrimination", "transfer"];
const S = ["build", "debug", "test", "adapt"];
async function rateAll(
  user: string,
  id: string,
  domain: "K" | "S",
  rating: number,
  tag: string
) {
  let last: any;
  for (const dimension of domain === "K" ? K : S)
    last = await call(user, "record_assessment", {
      objective_id: id,
      domain,
      dimension,
      rating,
      evidence: `learner answer for ${dimension}`,
      idempotency_key: `${tag}-${domain}-${dimension}`,
    });
  return last;
}

describe("objectives", () => {
  it("creates, lists P0 first, updates and parks", async () => {
    const u = newUser();
    const { id: deck } = await call(u, "create_deck", { name: "JS" });
    const p1 = await objective(u, {
      title: "later",
      priority: "P2",
      deck_id: deck,
    });
    const p0 = await objective(u, {
      title: "now",
      priority: "P0",
      track: "K",
      deck_id: deck,
    });
    const list = await call(u, "list_objectives", { deck_id: deck });
    expect(list.map((o: any) => o.title)).toEqual(["now", "later"]);
    expect(list[0]).toMatchObject({
      track: "K",
      k_score: null,
      s_score: null,
      mastered: false,
    });
    expect(list[0].next.action).toBe("assess");
    await call(u, "update_objective", {
      objective_id: p1,
      status: "parked",
      title: "later!",
    });
    expect(await call(u, "list_objectives", { status: "active" })).toHaveLength(
      1
    );
    expect(
      (await call(u, "list_objectives", { status: "parked" }))[0].title
    ).toBe("later!");
    expect((await call(u, "update_objective", { objective_id: p0 })).code).toBe(
      "nothing_to_change"
    );
    expect(
      (await call(u, "update_objective", { objective_id: p0, priority: "P9" }))
        .code
    ).toBe("invalid_argument");
    expect(
      (await call(u, "create_objective", { title: "x", deck_id: "ghost" })).code
    ).toBe("deck_not_found");
    expect((await call(u, "create_objective", { title: " " })).code).toBe(
      "invalid_argument"
    );
  });
});

describe("evidence", () => {
  it("records evidence, keeps untested separate from zero, and scores K and S apart", async () => {
    const u = newUser();
    const id = await objective(u);
    const first = await call(u, "record_assessment", {
      objective_id: id,
      domain: "K",
      dimension: "recall",
      rating: 4,
      evidence: "stated the definition unaided",
    });
    expect(first).toMatchObject({
      duplicate: false,
      k_score: null,
      s_score: null,
      mastered: false,
    });
    for (const d of K.slice(1))
      await call(u, "record_assessment", {
        objective_id: id,
        domain: "K",
        dimension: d,
        rating: 3,
        evidence: `did ${d}`,
      });
    const o = await call(u, "get_objective", { objective_id: id });
    expect(o.K.score).toBe(81.3);
    expect(o.S.score).toBeNull();
    expect(o.S.untested).toEqual(S);
    expect(o.evidence).toHaveLength(4);
    expect(o.evidence[0].evidence).toBe("did transfer");
    expect(o.next).toMatchObject({ action: "assess", domain: "S" });
  });

  it("validates input and cannot overstate unaided work", async () => {
    const u = newUser();
    const id = await objective(u);
    const base = {
      objective_id: id,
      domain: "K",
      dimension: "recall",
      rating: 3,
      evidence: "said it",
    };
    for (const [patch, code] of [
      [{ dimension: "build" }, "invalid_argument"],
      [{ domain: "X" }, "invalid_argument"],
      [{ rating: 5 }, "invalid_argument"],
      [{ rating: 1.5 }, "invalid_argument"],
      [{ evidence: "" }, "invalid_argument"],
      [{ evidence: "no" }, "invalid_argument"],
      [{ hints: -1 }, "invalid_argument"],
      [{ rating: 4, hints: 1 }, "inconsistent_rating"],
      [{ rating: 4, independent: false }, "inconsistent_rating"],
      [{ objective_id: "obj_ghost" }, "objective_not_found"],
    ] as [object, string][])
      expect(
        (await call(u, "record_assessment", { ...base, ...patch })).code
      ).toBe(code);
    const knowledgeOnly = await objective(u, { track: "K" });
    expect(
      (
        await call(u, "record_assessment", {
          ...base,
          objective_id: knowledgeOnly,
          domain: "S",
          dimension: "build",
        })
      ).code
    ).toBe("wrong_track");
    expect(
      (await call(u, "get_objective", { objective_id: id })).evidence
    ).toHaveLength(0);
  });

  it("saves a retried assessment once and refuses a reused key with other evidence", async () => {
    const u = newUser();
    const id = await objective(u);
    const args = {
      objective_id: id,
      domain: "K",
      dimension: "recall",
      rating: 3,
      evidence: "answered correctly",
      idempotency_key: "k1",
    };
    expect((await call(u, "record_assessment", args)).duplicate).toBe(false);
    expect((await call(u, "record_assessment", args)).duplicate).toBe(true);
    expect(
      (await call(u, "record_assessment", { ...args, rating: 1 })).code
    ).toBe("idempotency_conflict");
    expect(
      (await call(u, "get_objective", { objective_id: id })).evidence
    ).toHaveLength(1);
  });

  it("reaches mastery only after a delayed retest, with the date set by the server", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const t0 = Date.now();
    const u = newUser();
    const id = await objective(u);
    await rateAll(u, id, "K", 4, "a");
    const day0 = await rateAll(u, id, "S", 4, "a");
    expect(day0).toMatchObject({ k_score: 100, s_score: 100, mastered: false });
    expect(day0.next).toMatchObject({ action: "retest" });
    expect(day0.next.after).toBe(t0 + 7 * DAY);

    vi.setSystemTime(t0 + 3 * DAY);
    await rateAll(u, id, "K", 4, "b");
    expect((await rateAll(u, id, "S", 4, "b")).mastered).toBe(false);

    vi.setSystemTime(t0 + 8 * DAY);
    await rateAll(u, id, "K", 4, "c");
    const done = await rateAll(u, id, "S", 4, "c");
    expect(done).toMatchObject({ mastered: true, blockers: [] });
    expect(done.next.action).toBe("move_on");

    vi.setSystemTime(t0 + 20 * DAY);
    await call(u, "record_assessment", {
      objective_id: id,
      domain: "K",
      dimension: "transfer",
      rating: 1,
      evidence: "failed a changed variant",
    });
    const after = await call(u, "get_objective", { objective_id: id });
    expect(after.mastered).toBe(false);
    expect(after.next).toMatchObject({
      action: "revisit",
      dimension: "transfer",
    });
  });

  it("links cards and reports coverage", async () => {
    const u = newUser();
    const { id: deck } = await call(u, "create_deck", { name: "D" });
    const { card_ids } = await call(u, "add_cards", {
      deck_id: deck,
      cards: [
        { front: "a", back: "1" },
        { front: "b", back: "2" },
      ],
    });
    const id = await objective(u, { deck_id: deck });
    expect(
      await call(u, "link_cards", { objective_id: id, add_card_ids: card_ids })
    ).toMatchObject({ linked: 2 });
    expect(
      await call(u, "link_cards", { objective_id: id, add_card_ids: card_ids })
    ).toMatchObject({ linked: 2 });
    let o = await call(u, "get_objective", { objective_id: id });
    expect(o.cards).toMatchObject({
      linked: 2,
      new: 2,
      due_now: 0,
      missing: 0,
    });
    await call(u, "link_cards", {
      objective_id: id,
      remove_card_ids: [card_ids[0]],
    });
    o = await call(u, "get_objective", { objective_id: id });
    expect(o.cards.linked).toBe(1);
    expect(
      (
        await call(u, "link_cards", {
          objective_id: id,
          add_card_ids: ["ghost"],
        })
      ).code
    ).toBe("card_not_found");
    expect((await call(u, "link_cards", { objective_id: id })).code).toBe(
      "nothing_to_change"
    );
  });

  it("deletes an objective only after confirmation", async () => {
    const u = newUser();
    const id = await objective(u);
    await call(u, "record_assessment", {
      objective_id: id,
      domain: "K",
      dimension: "recall",
      rating: 2,
      evidence: "needed the answer shown",
    });
    const p = await call(u, "delete_objective", { objective_id: id });
    expect(p).toMatchObject({ deleted: false, will_delete: { evidence: 1 } });
    expect(
      (
        await call(u, "delete_objective", {
          objective_id: id,
          confirm_token: "x",
        })
      ).code
    ).toBe("confirm_token_mismatch");
    expect(await call(u, "list_objectives")).toHaveLength(1);
    expect(
      await call(u, "delete_objective", {
        objective_id: id,
        confirm_token: p.confirm_token,
      })
    ).toMatchObject({
      deleted: true,
      evidence: 1,
    });
    expect(await call(u, "list_objectives")).toHaveLength(0);
    const { rows } = await pg.query(
      "SELECT 1 FROM objective_assessments WHERE user_id = $1",
      [u]
    );
    expect(rows).toHaveLength(0);
  });

  it("keeps every user's objectives and evidence private", async () => {
    const a = newUser();
    const b = newUser();
    const id = await objective(a);
    for (const [tool, args] of [
      ["get_objective", {}],
      ["update_objective", { title: "x" }],
      ["delete_objective", {}],
      ["link_cards", { add_card_ids: ["c"] }],
      [
        "record_assessment",
        {
          domain: "K",
          dimension: "recall",
          rating: 3,
          evidence: "hello there",
        },
      ],
    ] as [string, object][])
      expect((await call(b, tool, { objective_id: id, ...args })).code).toBe(
        "objective_not_found"
      );
    expect(await call(b, "list_objectives")).toEqual([]);
  });
});

describe("master card", () => {
  it("summarises an objective: mastery, card progress, weakest cards and gaps", async () => {
    const u = newUser();
    const { id: deck } = await call(u, "create_deck", { name: "D" });
    const { card_ids } = await call(u, "add_cards", {
      deck_id: deck,
      cards: [
        { front: "alpha", back: "1" },
        { front: "beta", back: "2" },
        { front: "gamma", back: "3" },
      ],
    });
    const id = await objective(u, { deck_id: deck });
    const empty = await call(u, "get_master_card", { objective_id: id });
    expect(empty.cards).toMatchObject({ linked: 0, avg_recall_now: null });
    expect(empty.gaps.join()).toContain("no cards are linked");

    await call(u, "link_cards", { objective_id: id, add_card_ids: card_ids });
    const fresh = await call(u, "get_master_card", { objective_id: id });
    expect(fresh.gaps.join()).toContain("every linked card is still new");
    expect(fresh.weakest).toEqual([]);

    await call(u, "grade_card", { card_id: card_ids[0], rating: 1 });
    await call(u, "grade_card", { card_id: card_ids[1], rating: 4 });
    await call(u, "edit_card", { card_id: card_ids[2], suspended: true });
    await call(u, "record_assessment", {
      objective_id: id,
      domain: "K",
      dimension: "recall",
      rating: 3,
      evidence: "said it from memory",
    });
    const m = await call(u, "get_master_card", { objective_id: id });
    expect(m.objective).toMatchObject({ title: "Closures", track: "KS" });
    expect(m.mastery).toMatchObject({ k_score: null, mastered: false });
    expect(m.mastery.next.action).toBe("assess");
    expect(m.cards).toMatchObject({
      linked: 3,
      new: 1,
      suspended: 1,
      lapses: 0,
    });
    expect(m.cards.learning + m.cards.review).toBe(2);
    expect(m.cards.avg_recall_now).toBeGreaterThan(0);
    expect(m.weakest).toHaveLength(2);
    expect(m.weakest[0].text).toContain("alpha"); // rated Again: weakest first
    expect(m.gaps.join()).toContain("suspended");
    expect(m.gaps.join()).toContain("K untested: explanation");
    expect(
      (await call(u, "get_master_card", { objective_id: "obj_ghost" })).code
    ).toBe("objective_not_found");
    expect(
      (await call(newUser(), "get_master_card", { objective_id: id })).code
    ).toBe("objective_not_found");
  });
});
