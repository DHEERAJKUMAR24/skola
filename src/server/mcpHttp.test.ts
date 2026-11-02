// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, it, vi } from "vitest";
import { GET as resourceMetadata } from "../../app/.well-known/oauth-protected-resource/[[...path]]/route";
import { OPTIONS, POST } from "../../app/mcp/route";
import type { Db } from "./db";
import { handleRpc } from "./mcp";

// The pool is created lazily and never connects: a request without a token is refused first.
vi.stubEnv("DATABASE_URL", "postgres://u:p@127.0.0.1:1/x");

const ASKED = [
  "content-type",
  "authorization",
  "accept",
  "mcp-protocol-version",
  "mcp-session-id",
];

it("preflight allows every header a browser MCP client sends", async () => {
  const res = await OPTIONS();
  expect(res.status).toBe(204);
  const allowed = (res.headers.get("access-control-allow-headers") ?? "")
    .split(",")
    .map((h) => h.trim());
  for (const h of ASKED) expect(allowed).toContain(h);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  expect(res.headers.get("access-control-allow-methods")).toContain("POST");
});

it("401 keeps the discovery challenge and is readable cross-origin", async () => {
  const res = await POST(
    new Request("https://skola.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
  );
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe(
    'Bearer resource_metadata="https://skola.example/.well-known/oauth-protected-resource/mcp"'
  );
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  const exposed = res.headers.get("access-control-expose-headers") ?? "";
  expect(exposed).toContain("www-authenticate");
  expect(exposed).toContain("mcp-session-id");
});

let db: Db;
beforeAll(async () => {
  const pg = new PGlite();
  for (const f of ["20261101000000_init", "20261102000000_skills"])
    await pg.exec(fs.readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  db = {
    query: (text, params) => pg.query(text, params) as never,
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn((text, params) => tx.query(text, params) as never)
      ),
  };
});

it("is stateless: initialize, notification, list and ping need no session id", async () => {
  const call = (m: object) => handleRpc(db, "u1", m);
  const init = (await call({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  })) as { result: { protocolVersion: string } };
  expect(init.result.protocolVersion).toBe("2025-06-18");
  expect(
    await call({ jsonrpc: "2.0", method: "notifications/initialized" })
  ).toBeNull();
  const list = (await call({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  })) as {
    result: { tools: unknown[] };
  };
  expect(list.result.tools.length).toBeGreaterThan(0);
  expect(await call({ jsonrpc: "2.0", id: 3, method: "ping" })).toEqual({
    jsonrpc: "2.0",
    id: 3,
    result: {},
  });
});

it("the 401 challenge leads to metadata for the mcp resource, so tokens get the mcp audience", async () => {
  const res = await POST(
    new Request("https://skola.example/mcp", { method: "POST", body: "{}" })
  );
  const url = /resource_metadata="([^"]+)"/.exec(
    res.headers.get("www-authenticate") ?? ""
  )?.[1] as string;
  const path = new URL(url).pathname.replace(
    "/.well-known/oauth-protected-resource",
    ""
  );
  const meta = await resourceMetadata(new Request(url), {
    params: Promise.resolve({ path: path.split("/").filter(Boolean) }),
  }).then((r) => r.json());
  expect(meta.resource).toBe("https://skola.example/mcp");
  expect(meta.scopes_supported).toEqual(["mcp"]);
});
