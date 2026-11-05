// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";
import { pushRows } from "./sync";

const DAY = 86_400_000;
let pg: PGlite;
let db: Db;
const mk = (p: PGlite): Db => ({
  query: (text, params) => p.query(text, params) as never,
  transaction: (fn) =>
    p.transaction((tx) =>
      fn((text, params) => tx.query(text, params) as never)
    ),
});

beforeAll(async () => {
  pg = new PGlite();
  for (const f of [
    "20261101000000_init",
    "20261102000000_skills",
    "20261104000000_image_assets",
    "20261105000000_study_sessions",
    "20261106000000_note_versions",
  ])
    await pg.exec(fs.readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  db = mk(pg);
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
const at = (ms: number) => vi.setSystemTime(ms);

let n = 0;
async function setup() {
  const user = `h-${++n}`;
  const { id: deck } = await call(user, "create_deck", { name: "D" });
  const { card_ids } = await call(user, "add_cards", {
    deck_id: deck,
    cards: [{ front: "q", back: "v0" }],
  });
  return { user, card: card_ids[0] as string };
}
const backs = async (user: string, card: string) =>
  (await call(user, "card_history", { card_id: card })).versions.map(
    (v: any) => v.fields.back
  );

describe("edit history", () => {
  it("keeps the text before each edit, newest first, and skips edits that change nothing", async () => {
    const { user, card } = await setup();
    expect(await backs(user, card)).toEqual([]);
    await call(user, "edit_card", { card_id: card, back: "v1" });
    await call(user, "edit_card", { card_id: card, back: "v2" });
    await call(user, "edit_card", { card_id: card, suspended: true });
    await call(user, "edit_card", { card_id: card, back: "v2" });
    expect(await backs(user, card)).toEqual(["v1", "v0"]);
    await call(user, "edit_card", { card_id: card, tags: ["x"] });
    expect(await backs(user, card)).toEqual(["v2", "v1", "v0"]);
  });

  it("never becomes empty: a note last edited a month ago still shows its previous version", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const t0 = Date.now();
    const { user, card } = await setup();
    await call(user, "edit_card", { card_id: card, back: "v1" });
    expect(await backs(user, card)).toEqual(["v0"]);

    at(t0 + 30 * DAY); // a month with no edit: nothing runs, nothing is deleted
    expect(await backs(user, card)).toEqual(["v0"]);

    await call(user, "edit_card", { card_id: card, back: "v2" });
    expect(await backs(user, card)).toEqual(["v1"]); // v0 is older than 7 days; v1 is kept
  });

  it("keeps every version of the last 7 days and drops older ones on the next edit", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const t0 = Date.now();
    const { user, card } = await setup();
    for (const [day, back] of [
      [0, "v1"],
      [3, "v2"],
      [6, "v3"],
    ] as const) {
      at(t0 + day * DAY);
      await call(user, "edit_card", { card_id: card, back });
    }
    expect(await backs(user, card)).toEqual(["v2", "v1", "v0"]);
    at(t0 + 8 * DAY);
    await call(user, "edit_card", { card_id: card, back: "v4" });
    // saved at day 0 (v0), day 3 (v1), day 6 (v2), day 8 (v3); day 0 is more than 7 days old
    expect(await backs(user, card)).toEqual(["v3", "v2", "v1"]);
  });

  it("restores an old version, keeps the schedule, and the restore can be undone", async () => {
    const { user, card } = await setup();
    await call(user, "grade_card", { card_id: card, rating: 3 });
    await call(user, "edit_card", { card_id: card, back: "v1" });
    await call(user, "edit_card", { card_id: card, back: "v2" });
    const h = await call(user, "card_history", { card_id: card });
    const v0 = h.versions.find((v: any) => v.fields.back === "v0");
    expect(
      (
        await call(user, "restore_card_version", {
          card_id: card,
          version_id: v0.version_id,
        })
      ).ok
    ).toBe(true);
    const found = await call(user, "search_cards", { query: "v0" });
    expect(found).toHaveLength(1);
    const det = await call(user, "get_card_details", { card_id: card });
    expect(det.reps).toBe(1);
    expect(await backs(user, card)).toEqual(["v2", "v1", "v0"]); // v2 was saved before the restore
    expect(
      (
        await call(user, "restore_card_version", {
          card_id: card,
          version_id: "ver_nope",
        })
      ).code
    ).toBe("version_not_found");
  });

  it("keeps histories private per user", async () => {
    const a = await setup();
    const b = await setup();
    await call(a.user, "edit_card", { card_id: a.card, back: "v1" });
    const h = await call(a.user, "card_history", { card_id: a.card });
    expect((await call(b.user, "card_history", { card_id: a.card })).code).toBe(
      "card_not_found"
    );
    expect(
      (
        await call(b.user, "restore_card_version", {
          card_id: b.card,
          version_id: h.versions[0].version_id,
        })
      ).code
    ).toBe("version_not_found");
  });

  it("does not store inline pictures and keeps the current one on restore", async () => {
    const user = `h-pic-${++n}`;
    const big = `data:image/png;base64,${"A".repeat(5000)}`;
    const note = (header: string, image: string) => ({
      tbl: "notes",
      id: "n1",
      updatedAt: Date.now() + (n += 1) * 1000,
      data: {
        id: "n1",
        deck: "d1",
        content: { type: "imageOcclusion", header, image, boxes: [] },
      },
    });
    await pushRows(db, user, [note("one", big)], { coalesceMs: 0 });
    await pushRows(db, user, [note("two", big)], { coalesceMs: 0 });
    const { rows } = await pg.query<{ content: any }>(
      "SELECT content FROM note_versions WHERE user_id = $1",
      [user]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content.header).toBe("one");
    expect(JSON.stringify(rows[0].content)).not.toContain("AAAA");
  });

  it("merges a burst of app saves into one version, and splits them after 5 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    const t0 = Date.now();
    const user = `h-app-${++n}`;
    let seq = 0;
    const save = (back: string) =>
      pushRows(db, user, [
        {
          tbl: "notes",
          id: "n1",
          updatedAt: t0 + ++seq * 1000,
          data: {
            id: "n1",
            deck: "d",
            content: { type: "normal", front: "q", back },
          },
        },
      ]);
    const count = async () =>
      Number(
        (
          await pg.query<{ c: string }>(
            "SELECT count(*) AS c FROM note_versions WHERE user_id = $1",
            [user]
          )
        ).rows[0].c
      );
    await save("a");
    await save("ab");
    await save("abc");
    await save("abcd");
    expect(await count()).toBe(1); // the first save has no earlier version; the burst is merged
    at(t0 + 6 * 60_000);
    await save("final");
    expect(await count()).toBe(2);
  });

  it("never blocks a sync when the history table does not exist yet", async () => {
    const old = new PGlite();
    await old.exec(
      fs.readFileSync("supabase/migrations/20261101000000_init.sql", "utf8")
    );
    const odb = mk(old);
    const note = (back: string, i: number) => ({
      tbl: "notes",
      id: "n1",
      updatedAt: 1000 + i,
      data: { id: "n1", content: { type: "normal", front: "q", back } },
    });
    await pushRows(odb, "u", [note("a", 1)]);
    const r = await pushRows(odb, "u", [note("b", 2)], { coalesceMs: 0 });
    expect(r.applied).toBe(1);
    const { rows } = await old.query<{ data: any }>(
      "SELECT data FROM changes WHERE user_id = 'u' AND id = 'n1'"
    );
    expect(rows[0].data.content.back).toBe("b");
  });
});
