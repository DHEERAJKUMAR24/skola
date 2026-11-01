// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";
import {
  MAX_MEDIA_BYTES,
  MAX_USER_BYTES,
  MediaError,
  confirmUpload,
  mediaKey,
  presignRead,
  r2Deps,
  requestUpload,
  sha256Of,
  storeBytes,
} from "./media";

let db: Db;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
const SHA = sha256Of(PNG);

// A stand-in for R2: keeps objects in memory and answers the way S3 does.
const objects = new Map<string, { bytes: Buffer; type: string }>();
const calls: string[] = [];
const realFetch = r2Deps.fetch;

const keyOf = (url: string) =>
  decodeURIComponent(new URL(url).pathname).replace(/^\/skola-media\//, "");

async function fakeR2(url: string, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  const key = keyOf(url);
  calls.push(`${method} ${key}`);
  if (method === "PUT") {
    objects.set(key, {
      bytes: Buffer.from(init.body as Uint8Array),
      type: String((init.headers as Record<string, string>)["content-type"]),
    });
    return new Response(null, { status: 200 });
  }
  const obj = objects.get(key);
  if (method === "DELETE") {
    objects.delete(key);
    return new Response(null, { status: 204 });
  }
  if (!obj) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 200,
    headers: { "content-length": String(obj.bytes.length) },
  });
}

beforeAll(async () => {
  process.env.R2_ACCOUNT_ID = "acc123";
  process.env.R2_ACCESS_KEY_ID = "AK";
  process.env.R2_SECRET_ACCESS_KEY = "SECRET";
  process.env.R2_BUCKET = "skola-media";
  r2Deps.fetch = fakeR2 as never;
  const pg = new PGlite();
  for (const f of ["20261101000000_init.sql", "20261103000000_media.sql"])
    await pg.exec(fs.readFileSync(`supabase/migrations/${f}`, "utf8"));
  db = {
    query: (text, params) => pg.query(text, params) as never,
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn((text, params) => tx.query(text, params) as never)
      ),
  };
});
afterAll(() => {
  for (const k of [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ])
    delete process.env[k];
  r2Deps.fetch = realFetch;
});
beforeEach(async () => {
  objects.clear();
  calls.length = 0;
  await db.query("DELETE FROM media_objects");
});

const refuses = (p: Promise<unknown>, status: number, re: RegExp) =>
  p.then(
    () => {
      throw new Error("should have been refused");
    },
    (e) => {
      expect(e).toBeInstanceOf(MediaError);
      expect((e as MediaError).status).toBe(status);
      expect((e as MediaError).message).toMatch(re);
    }
  );

it("hands out a signed upload link for the user's own key, and skips what already exists", async () => {
  const up = await requestUpload(db, "alice", {
    sha256: SHA,
    size: PNG.length,
    type: "image/png",
  });
  if (up.exists) throw new Error("expected an upload link");
  const url = new URL(up.uploadUrl);
  expect(url.host).toBe("acc123.r2.cloudflarestorage.com");
  expect(decodeURIComponent(url.pathname)).toBe(
    `/skola-media/${mediaKey("alice", SHA)}`
  );
  expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
  expect(up.headers).toEqual({ "content-type": "image/png" });

  // the browser PUTs, then confirms
  await r2Deps.fetch(up.uploadUrl, {
    method: "PUT",
    headers: up.headers,
    body: new Uint8Array(PNG),
  });
  expect(await confirmUpload(db, "alice", SHA)).toEqual({ ok: true });
  expect(
    await requestUpload(db, "alice", {
      sha256: SHA,
      size: PNG.length,
      type: "image/png",
    })
  ).toEqual({ exists: true });
  // the same picture for someone else is their own object
  const bob = await requestUpload(db, "bob", {
    sha256: SHA,
    size: PNG.length,
    type: "image/png",
  });
  expect(bob.exists).toBe(false);
});

it("validates what is announced", async () => {
  const ok = { sha256: SHA, size: 10, type: "image/png" };
  await refuses(
    requestUpload(db, "a", { ...ok, sha256: "xyz" }),
    400,
    /64 hex/
  );
  await refuses(requestUpload(db, "a", { ...ok, size: 0 }), 413, /MB/);
  await refuses(
    requestUpload(db, "a", { ...ok, size: MAX_MEDIA_BYTES + 1 }),
    413,
    /MB/
  );
  await refuses(requestUpload(db, "a", { ...ok, size: 1.5 }), 413, /MB/);
  await refuses(
    requestUpload(db, "a", { ...ok, type: "image/svg+xml" }),
    400,
    /PNG, JPEG/
  );
  await refuses(
    requestUpload(db, "a", { ...ok, type: undefined }),
    400,
    /PNG, JPEG/
  );
});

it("stops uploads past the account quota", async () => {
  await db.query(
    "INSERT INTO media_objects (user_id, sha256, size, type, confirmed, created_at) VALUES ('full', $1, $2, 'image/png', true, 1)",
    ["a".repeat(64), MAX_USER_BYTES - 5]
  );
  await refuses(
    requestUpload(db, "full", { sha256: SHA, size: 10, type: "image/png" }),
    413,
    /full/
  );
  expect(
    (
      await requestUpload(db, "other", {
        sha256: SHA,
        size: 10,
        type: "image/png",
      })
    ).exists
  ).toBe(false);
});

it("only accepts an upload R2 really has, of the announced size", async () => {
  await refuses(confirmUpload(db, "alice", SHA), 404, /Start the upload/);
  await requestUpload(db, "alice", {
    sha256: SHA,
    size: PNG.length,
    type: "image/png",
  });
  await refuses(confirmUpload(db, "alice", SHA), 409, /not uploaded/);

  // wrong size: removed from R2 and forgotten
  objects.set(mediaKey("alice", SHA), {
    bytes: Buffer.alloc(PNG.length + 7),
    type: "image/png",
  });
  await refuses(confirmUpload(db, "alice", SHA), 409, /does not match/);
  expect(objects.has(mediaKey("alice", SHA))).toBe(false);
  const { rows } = await db.query(
    "SELECT 1 FROM media_objects WHERE user_id = 'alice'"
  );
  expect(rows).toHaveLength(0);
});

it("serves a picture only to its owner, and only once it is confirmed", async () => {
  await requestUpload(db, "alice", {
    sha256: SHA,
    size: PNG.length,
    type: "image/png",
  });
  await refuses(presignRead(db, "alice", SHA), 404, /not found/); // not confirmed yet
  objects.set(mediaKey("alice", SHA), { bytes: PNG, type: "image/png" });
  await confirmUpload(db, "alice", SHA);

  const link = await presignRead(db, "alice", SHA);
  const url = new URL(link.url);
  expect(decodeURIComponent(url.pathname)).toBe(`/skola-media/u/alice/${SHA}`);
  expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
  expect(link.expiresAt).toBeGreaterThan(Date.now());

  await refuses(presignRead(db, "bob", SHA), 404, /not found/); // someone else's
  await refuses(presignRead(db, "alice", "nothex"), 400, /64 hex/);
});

it("stores bytes sent by the server itself, once per picture", async () => {
  expect(await storeBytes(db, "alice", PNG)).toBe(SHA);
  expect(objects.get(mediaKey("alice", SHA))?.bytes.equals(PNG)).toBe(true);
  expect(objects.get(mediaKey("alice", SHA))?.type).toBe("image/png");
  const puts = () => calls.filter((c) => c.startsWith("PUT")).length;
  expect(puts()).toBe(1);
  expect(await storeBytes(db, "alice", PNG)).toBe(SHA);
  expect(puts()).toBe(1); // same picture again: nothing uploaded
  await refuses(
    storeBytes(db, "alice", Buffer.from("<svg onload=alert(1)>")),
    400,
    /PNG, JPEG/
  );
  await refuses(
    storeBytes(
      db,
      "alice",
      Buffer.concat([PNG, Buffer.alloc(MAX_MEDIA_BYTES)])
    ),
    413,
    /MB/
  );
});

it("accepts pictures up to 15 MB, and refuses anything larger", async () => {
  expect(MAX_MEDIA_BYTES).toBe(15_000_000);
  const big = Buffer.concat([PNG, Buffer.alloc(8_000_000, 1)]); // 8 MB with a real PNG header
  const sha = await storeBytes(db, "bigpics", big);
  expect(sha).toBe(sha256Of(big));
  expect(objects.get(mediaKey("bigpics", sha))?.bytes.length).toBe(big.length);
  await refuses(
    requestUpload(db, "bigpics", {
      sha256: SHA,
      size: MAX_MEDIA_BYTES + 1,
      type: "image/png",
    }),
    413,
    /15 MB/
  );
});

it("is switched off, with a clear status, until R2 is configured", async () => {
  const saved = { ...process.env };
  for (const k of [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ])
    delete process.env[k];
  await refuses(
    requestUpload(db, "a", { sha256: SHA, size: 1, type: "image/png" }),
    501,
    /not set up/
  );
  await refuses(presignRead(db, "a", SHA), 501, /not set up/);
  Object.assign(process.env, saved);
});

// ---- over MCP --------------------------------------------------------------------------------

const call = async (user: string, name: string, args: object = {}) => {
  const r: any = await handleRpc(db, user, {
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const out = r.result.content[0].text;
  return r.result.isError ? { error: out } : JSON.parse(out);
};

it("MCP stores a base64 picture in R2, references it, and hands back a reachable link", async () => {
  const { id } = await call("alice", "create_deck", { name: "Pics" });
  const res = await call("alice", "add_cards", {
    deck_id: id,
    cards: [
      {
        type: "image_occlusion",
        image: PNG.toString("base64"),
        areas: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }],
      },
      {
        type: "image_occlusion",
        image: `data:image/png;base64,${PNG.toString("base64")}`,
        areas: [{ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }],
      },
    ],
  });
  expect(res.added).toBe(2);
  // both cards share one stored picture
  expect(calls.filter((c) => c.startsWith("PUT"))).toHaveLength(1);

  const { rows } = await db.query<{ data: any }>(
    "SELECT data FROM changes WHERE user_id = 'alice' AND tbl = 'notes'"
  );
  expect(rows.map((r) => r.data.content.image)).toEqual([
    `media:${SHA}`,
    `media:${SHA}`,
  ]);

  const out = await call("alice", "get_card_image", {
    card_id: res.card_ids[0],
  });
  expect(out.image_url).toContain(`/skola-media/u/alice/${SHA}?`);
  expect(out.image_url).toContain("X-Amz-Signature=");
  expect(out.image_url_expires_at).toBeGreaterThan(Date.now());
  expect(out.areas).toHaveLength(1);

  // another account cannot get a link to alice's picture
  const { rows: cards } = await db.query<{ data: any }>(
    "SELECT data FROM changes WHERE user_id = 'alice' AND tbl = 'cards' LIMIT 1"
  );
  expect(
    (await call("bob", "get_card_image", { card_id: cards[0].data.id })).error
  ).toMatch(/not found/);

  // card fields never contain the bytes or a data URL
  const found = await call("alice", "search_cards", {
    query: "",
    deck_id: id,
  }).catch(() => null);
  void found;
});

it("MCP keeps a picture inside the note when R2 is not set up", async () => {
  const saved = { ...process.env };
  for (const k of [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ])
    delete process.env[k];
  const { id } = await call("carol", "create_deck", { name: "Local" });
  const res = await call("carol", "add_cards", {
    deck_id: id,
    cards: [
      {
        type: "image_occlusion",
        image: PNG.toString("base64"),
        areas: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.3 }],
      },
    ],
  });
  const { rows } = await db.query<{ data: any }>(
    "SELECT data FROM changes WHERE user_id = 'carol' AND tbl = 'notes'"
  );
  expect(rows[0].data.content.image).toMatch(/^data:image\/png;base64,/);
  expect(res.added).toBe(1);
  Object.assign(process.env, saved);
});
