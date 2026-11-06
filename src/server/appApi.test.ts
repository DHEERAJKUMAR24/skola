// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type AssessmentInput,
  validateAssessment,
} from "../logic/learning/assessmentForm";
import { HISTORY_OPS, OBJECTIVE_OPS, runAppOp } from "./appApi";
import type { Db } from "./db";
import { handleRpc } from "./mcp";

let db: Db;
beforeAll(async () => {
  const pg = new PGlite();
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
async function mcp(user: string, name: string, args: object = {}) {
  const r: any = await handleRpc(db, user, {
    jsonrpc: "2.0",
    id: ++rpc,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return JSON.parse(r.result.content[0].text);
}
const hist = (u: string, body: object) => runAppOp(db, u, HISTORY_OPS, body);
const obj = (u: string, body: object) => runAppOp(db, u, OBJECTIVE_OPS, body);

let n = 0;
async function card(user: string) {
  const { id: deck } = await mcp(user, "create_deck", { name: "D" });
  const { card_ids } = await mcp(user, "add_cards", {
    deck_id: deck,
    cards: [{ front: "q", back: "v0" }],
  });
  return card_ids[0] as string;
}

describe("app history route", () => {
  it("lists versions with the current text and restores like the MCP tool", async () => {
    const u = `app-h-${++n}`;
    const c = await card(u);
    await mcp(u, "edit_card", { card_id: c, back: "v1" });
    await mcp(u, "edit_card", { card_id: c, back: "v2" });
    const h = await hist(u, { op: "history", card_id: c });
    expect(h.status).toBe(200);
    const body = h.body as any;
    expect(body.current.fields.back).toBe("v2");
    expect(body.versions.map((v: any) => v.fields.back)).toEqual(["v1", "v0"]);
    const r = await hist(u, {
      op: "restore",
      card_id: c,
      version_id: body.versions[1].version_id,
    });
    expect(r.status).toBe(200);
    const after = (await hist(u, { op: "history", card_id: c })).body as any;
    expect(after.current.fields.back).toBe("v0");
    expect(after.versions[0].fields.back).toBe("v2"); // saved before the restore
  });

  it("answers 404 for a missing version or card, and keeps users apart", async () => {
    const a = `app-h-${++n}`;
    const b = `app-h-${++n}`;
    const c = await card(a);
    expect(
      (await hist(a, { op: "restore", card_id: c, version_id: "ver_x" })).status
    ).toBe(404);
    expect((await hist(b, { op: "history", card_id: c })).status).toBe(404);
    expect((await hist(a, { op: "nope" })).status).toBe(400);
    expect((await runAppOp(db, a, HISTORY_OPS, null)).status).toBe(400);
  });

  it("cannot reach objective ops through the history route", async () => {
    expect((await hist(`app-h-${++n}`, { op: "list" })).status).toBe(400);
  });
});

describe("app objectives route", () => {
  it("creates, lists, assesses with the server's validation, links and deletes in two steps", async () => {
    const u = `app-o-${++n}`;
    const c = await card(u);
    const made = await obj(u, { op: "create", title: "Closures", track: "KS" });
    expect(made.status).toBe(200);
    const id = (made.body as any).objective_id;

    expect(((await obj(u, { op: "list" })).body as any).items).toHaveLength(1);
    expect(
      (await obj(u, { op: "create", title: " " })).body as any
    ).toMatchObject({ code: "invalid_argument" });

    const bad = await obj(u, {
      op: "assess",
      objective_id: id,
      domain: "K",
      dimension: "recall",
      rating: 4,
      hints: 1,
      evidence: "answered with a hint",
    });
    expect(bad.status).toBe(400);
    expect((bad.body as any).code).toBe("inconsistent_rating");

    const ok = await obj(u, {
      op: "assess",
      objective_id: id,
      domain: "K",
      dimension: "recall",
      rating: 3,
      evidence: "explained it unaided",
      idempotency_key: "k1",
    });
    expect(ok.status).toBe(200);
    const again = await obj(u, {
      op: "assess",
      objective_id: id,
      domain: "K",
      dimension: "recall",
      rating: 3,
      evidence: "explained it unaided",
      idempotency_key: "k1",
    });
    expect((again.body as any).duplicate).toBe(true);

    await obj(u, { op: "link", objective_id: id, add_card_ids: [c] });
    const got = (
      await obj(u, { op: "get", objective_id: id, evidence_limit: 50 })
    ).body as any;
    expect(got.card_ids).toEqual([c]);
    expect(got.evidence).toHaveLength(1);

    const first = (await obj(u, { op: "delete", objective_id: id }))
      .body as any;
    expect(first.deleted).toBe(false);
    expect(first.will_delete).toMatchObject({ evidence: 1, card_links: 1 });
    const done = await obj(u, {
      op: "delete",
      objective_id: id,
      confirm_token: first.confirm_token,
    });
    expect((done.body as any).deleted).toBe(true);
    expect((await obj(u, { op: "get", objective_id: id })).status).toBe(404);
  });

  it("does not show another user's objective", async () => {
    const a = `app-o-${++n}`;
    const id = ((await obj(a, { op: "create", title: "mine" })).body as any)
      .objective_id;
    expect(
      (await obj(`app-o-${++n}`, { op: "get", objective_id: id })).status
    ).toBe(404);
  });
});

describe("assessment form and server agree", () => {
  const base: AssessmentInput = {
    domain: "K",
    dimension: "recall",
    rating: 3,
    evidence: "explained closures unaided",
    hints: 0,
    independent: true,
  };
  const cases: Partial<AssessmentInput>[] = [
    {},
    { rating: 4 },
    { rating: 0 },
    { rating: 5 },
    { rating: -1 },
    { evidence: "abc" },
    { evidence: "x".repeat(4001) },
    { hints: 21 },
    { hints: 20 },
    { rating: 4, hints: 2 },
    { rating: 4, independent: false },
    { rating: 3, independent: false },
    { dimension: "debug" },
    { domain: "S", dimension: "debug" },
  ];
  it.each(["K", "KS"] as const)(
    "track %s: same verdict on every case",
    async (track) => {
      const u = `app-p-${++n}`;
      const id = (
        (await obj(u, { op: "create", title: "T", track })).body as any
      ).objective_id;
      for (const patch of cases) {
        const a = { ...base, ...patch };
        const r = await obj(u, { op: "assess", objective_id: id, ...a });
        expect(
          validateAssessment(track, a) === null,
          JSON.stringify([track, patch, r.body])
        ).toBe(r.status === 200);
      }
    }
  );
});
