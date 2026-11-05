// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AI_INSTRUCTIONS_MAX,
  DEFAULT_AI_INSTRUCTIONS,
} from "../logic/settings/aiInstructions";
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
const instructionsOf = async (user: string) =>
  (
    (await handleRpc(db, user, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    })) as any
  ).result.instructions as string;

let n = 0;
const newUser = () => `i-${++n}`;
/** What the app writes when the user saves the setting (Dexie row key and value). */
const savedInApp = (user: string, value: string, updatedAt = Date.now()) =>
  pushRows(db, user, [
    {
      tbl: "settings",
      id: "#aiInstructions",
      updatedAt,
      data: { key: "#aiInstructions", value, updatedAt },
    },
  ]);

describe("profile instructions over MCP", () => {
  it("gives a new user the default instructions, and their own text once they save it", async () => {
    const u = newUser();
    const first = await instructionsOf(u);
    expect(first).toContain(
      `<user_instructions>\n${DEFAULT_AI_INSTRUCTIONS}\n</user_instructions>`
    );
    expect(first).toContain("default standing instructions");
    expect(await call(u, "get_instructions")).toMatchObject({
      instructions: DEFAULT_AI_INSTRUCTIONS,
      is_default: true,
      empty: false,
    });
    await savedInApp(u, "Write cards in German.\nTag by chapter.");
    const text = await instructionsOf(u);
    expect(text).toContain(
      "<user_instructions>\nWrite cards in German.\nTag by chapter.\n</user_instructions>"
    );
    expect(text).toContain("never override");
    expect(text).toContain("The user's own standing instructions");
    expect(text).not.toContain(DEFAULT_AI_INSTRUCTIONS);
    expect(await call(u, "get_instructions")).toMatchObject({
      instructions: "Write cards in German.\nTag by chapter.",
      is_default: false,
      empty: false,
      max_length: AI_INSTRUCTIONS_MAX,
    });
  });

  it("keeps text the user cleared on purpose empty, and brings the default back on reset", async () => {
    const u = newUser();
    await savedInApp(u, "");
    expect(await instructionsOf(u)).not.toContain("user_instructions");
    expect(await call(u, "get_instructions")).toMatchObject({
      instructions: "",
      is_default: false,
      empty: true,
    });
    expect(
      await call(u, "set_instructions", { text: "", mode: "reset" })
    ).toMatchObject({ ok: true, mode: "reset", is_default: true });
    expect(await call(u, "get_instructions")).toMatchObject({
      instructions: DEFAULT_AI_INSTRUCTIONS,
      is_default: true,
    });
    // the removal travels to devices as a deleted settings row
    const pulled = await pullRows(db, u, 0);
    const row = pulled.rows.find((r) => r.id === "#aiInstructions") as any;
    expect(row.deleted).toBe(true);
    // and a later save from a device works again
    await savedInApp(u, "mine again", Date.now() + 120_000);
    expect((await call(u, "get_instructions")).instructions).toBe("mine again");
  });

  it("makes the defaults the user's own when something is appended", async () => {
    const u = newUser();
    await call(u, "set_instructions", { text: "Always add a source tag." });
    const got = await call(u, "get_instructions");
    expect(got.is_default).toBe(false);
    expect(got.instructions).toBe(
      `${DEFAULT_AI_INSTRUCTIONS}\nAlways add a source tag.`
    );
  });

  it("cuts long text in the session start and points to get_instructions for the rest", async () => {
    const u = newUser();
    const long = Array.from(
      { length: 150 },
      (_, i) => `rule ${i}: keep it short`
    ).join("\n");
    await savedInApp(u, long);
    const text = await instructionsOf(u);
    expect(text).toContain("call get_instructions for all");
    expect(text).not.toContain("rule 149");
    expect((await call(u, "get_instructions")).instructions).toContain(
      "rule 149"
    );
  });

  it("appends, replaces and clears, and the app's synced row follows", async () => {
    const u = newUser();
    await call(u, "set_instructions", { text: "only", mode: "replace" });
    expect(
      await call(u, "set_instructions", { text: "Be brief." })
    ).toMatchObject({ ok: true, mode: "append", previous_length: 4 });
    await call(u, "set_instructions", { text: "Use English." });
    expect((await call(u, "get_instructions")).instructions).toBe(
      "only\nBe brief.\nUse English."
    );
    const pulled = await pullRows(db, u, 0);
    const row = pulled.rows.find(
      (r) => r.tbl === "settings" && r.id === "#aiInstructions"
    ) as any;
    expect(row.data).toMatchObject({
      key: "#aiInstructions",
      value: "only\nBe brief.\nUse English.",
    });
    await call(u, "set_instructions", { text: "Only this.", mode: "replace" });
    expect((await call(u, "get_instructions")).instructions).toBe("Only this.");
    await call(u, "set_instructions", { text: "", mode: "replace" });
    expect((await call(u, "get_instructions")).empty).toBe(true);
    expect(await instructionsOf(u)).not.toContain("user_instructions");
  });

  it("picks up an edit made in the app after one made over MCP", async () => {
    const u = newUser();
    await call(u, "set_instructions", { text: "from the assistant" });
    await savedInApp(u, "from the app", Date.now() + 60_000);
    expect((await call(u, "get_instructions")).instructions).toBe(
      "from the app"
    );
  });

  it("validates input and enforces the length limit", async () => {
    const u = newUser();
    expect((await call(u, "set_instructions", { text: 5 })).code).toBe(
      "invalid_argument"
    );
    expect(
      (await call(u, "set_instructions", { text: "x", mode: "merge" })).code
    ).toBe("invalid_argument");
    expect((await call(u, "set_instructions", { text: "   " })).code).toBe(
      "invalid_argument"
    );
    expect(
      (
        await call(u, "set_instructions", {
          text: "x".repeat(AI_INSTRUCTIONS_MAX + 1),
        })
      ).code
    ).toBe("too_long");
    await call(u, "set_instructions", {
      text: "x".repeat(AI_INSTRUCTIONS_MAX - 5),
      mode: "replace",
    });
    expect((await call(u, "set_instructions", { text: "123456" })).code).toBe(
      "too_long"
    );
    expect((await call(u, "get_instructions")).instructions).toHaveLength(
      AI_INSTRUCTIONS_MAX - 5
    );
  });

  it("keeps every user's instructions private and flags the write tool as destructive", async () => {
    const a = newUser();
    const b = newUser();
    await call(a, "set_instructions", { text: "secret preference" });
    expect(await call(b, "get_instructions")).toMatchObject({
      instructions: DEFAULT_AI_INSTRUCTIONS,
      is_default: true,
    });
    expect(await instructionsOf(b)).not.toContain("secret preference");
    const list: any = await handleRpc(db, a, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const set = list.result.tools.find(
      (t: any) => t.name === "set_instructions"
    );
    expect(set.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });
});
