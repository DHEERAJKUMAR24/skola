import { Blob as NodeBlob } from "node:buffer";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "../db";
import {
  migrateInlineImages,
  resetMediaEnabledCache,
  resolveMedia,
  saveMedia,
  sha256Hex,
  storeImage,
  uploadPending,
} from "./media";

const PNG = new NodeBlob(
  [
    Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
      ),
      (c) => c.charCodeAt(0)
    ),
  ],
  { type: "image/png" }
) as unknown as Blob;
const PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
let routes: Record<string, Route> = {};
let calls: string[] = [];

function signIn() {
  localStorage.setItem(
    "auth.tokens",
    JSON.stringify({ access: "a", refresh: "r", expiresAt: Date.now() + 3.6e6 })
  );
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
  resetMediaEnabledCache();
  routes = {};
  calls = [];
  signIn();
  let n = 0;
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => `blob:test-${n++}` })
  );
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    calls.push(`${init?.method ?? "GET"} ${url.replace(/\?.*/, "")}`);
    if (!key) return new Response("no route", { status: 404 });
    return routes[key](url, init);
  });
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
});
afterEach(() => vi.unstubAllGlobals());

const enabled = (on = true) => {
  routes["/media/config"] = () => Response.json({ enabled: on });
};

it("saves bytes on the device under their fingerprint, once", async () => {
  enabled();
  const ref = await saveMedia(PNG);
  const sha = await sha256Hex(PNG);
  expect(ref).toBe(`media:${sha}`);
  expect(sha).toMatch(/^[0-9a-f]{64}$/);
  expect(await db.media.get(sha)).toMatchObject({
    id: sha,
    type: "image/png",
    uploaded: 0,
  });
  await saveMedia(PNG); // the same picture again
  expect(await db.media.count()).toBe(1);
});

it("keeps a picture in the note as a data URL unless picture storage is on and reachable", async () => {
  enabled();
  expect(await storeImage(PNG)).toMatch(/^media:[0-9a-f]{64}$/);

  resetMediaEnabledCache();
  enabled(false); // the server has no R2
  expect(await storeImage(PNG)).toBe(`data:image/png;base64,${PNG_B64}`);

  resetMediaEnabledCache();
  routes = {}; // server unreachable
  expect(await storeImage(PNG)).toMatch(/^data:image\/png;base64,/);

  localStorage.clear(); // not signed in
  resetMediaEnabledCache();
  calls = [];
  expect(await storeImage(PNG)).toMatch(/^data:image\/png;base64,/);
  expect(calls).toEqual([]); // and it did not even ask
});

it("uploads straight to R2 in the background, then marks the picture done", async () => {
  enabled();
  const sha = await sha256Hex(PNG);
  const puts: { headers: unknown; body: unknown }[] = [];
  routes["/media/upload"] = async (_u, init) => {
    expect(JSON.parse(String(init?.body))).toEqual({
      sha256: sha,
      size: PNG.size,
      type: "image/png",
    });
    return Response.json({
      exists: false,
      uploadUrl:
        "https://r2.example/skola/u/me/" + sha + "?X-Amz-Signature=abc",
      headers: { "content-type": "image/png" },
    });
  };
  routes["r2.example"] = (_u, init) => {
    puts.push({ headers: init?.headers, body: init?.body });
    return new Response(null, { status: 200 });
  };
  routes["/media/confirm"] = () => Response.json({ ok: true });

  await saveMedia(PNG);
  await vi.waitFor(async () =>
    expect((await db.media.get(sha))?.uploaded).toBe(1)
  );
  expect(puts).toHaveLength(1);
  expect(puts[0].headers).toEqual({ "content-type": "image/png" });
  expect((puts[0].body as Blob).size).toBe(PNG.size); // the picture's own bytes
  // order: ask, put, confirm
  expect(
    calls
      .filter((c) => !c.includes("config"))
      .map(
        (c) =>
          c.split(" ")[0] + " " + new URL(c.split(" ")[1], "http://x").pathname
      )
  ).toEqual([
    "POST /api/media/upload",
    "PUT /skola/u/me/" + sha,
    "POST /api/media/confirm",
  ]);
});

it("does not upload what the server already has, and keeps a failed upload for later", async () => {
  enabled();
  routes["/media/upload"] = () => Response.json({ exists: true });
  await db.media.put({
    id: "a".repeat(64),
    blob: PNG,
    type: "image/png",
    size: PNG.size,
    uploaded: 0,
  });
  await uploadPending();
  expect((await db.media.get("a".repeat(64)))?.uploaded).toBe(1);
  expect(calls.some((c) => c.startsWith("PUT"))).toBe(false);

  routes["/media/upload"] = () =>
    Response.json({
      exists: false,
      uploadUrl: "https://r2.example/x?s=1",
      headers: {},
    });
  routes["r2.example"] = () => new Response("boom", { status: 500 });
  await db.media.put({
    id: "b".repeat(64),
    blob: PNG,
    type: "image/png",
    size: PNG.size,
    uploaded: 0,
  });
  await uploadPending();
  expect((await db.media.get("b".repeat(64)))?.uploaded).toBe(0); // tried again next time
});

it("makes no request at all when there is nothing to upload", async () => {
  calls = [];
  await uploadPending();
  expect(calls).toEqual([]);
});

it("downloads a picture it does not have, checks its fingerprint, and keeps it for offline", async () => {
  const sha = await sha256Hex(PNG);
  routes["/media/url"] = (u) => {
    expect(new URL(u, "http://x").searchParams.get("sha")).toBe(sha);
    return Response.json({
      url: "https://r2.example/get/" + sha,
      expiresAt: 1,
    });
  };
  routes["r2.example"] = () =>
    new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-type": "image/png" },
    });

  const url = await resolveMedia(`media:${sha}`);
  expect(url).toMatch(/^blob:test-/);
  expect(await db.media.get(sha)).toMatchObject({
    uploaded: 1,
    type: "image/png",
  });

  // second time: from memory, no requests
  calls = [];
  expect(await resolveMedia(`media:${sha}`)).toBe(url);
  expect(calls).toEqual([]);
});

it("refuses a downloaded file whose fingerprint does not match", async () => {
  const wrong = "c".repeat(64);
  routes["/media/url"] = () =>
    Response.json({ url: "https://r2.example/get/x", expiresAt: 1 });
  routes["r2.example"] = () =>
    new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  expect(await resolveMedia(`media:${wrong}`)).toBeNull();
  expect(await db.media.get(wrong)).toBeUndefined();
});

it("shows nothing for a missing picture when offline or signed out, and ignores other references", async () => {
  const sha = "d".repeat(64);
  Object.defineProperty(navigator, "onLine", {
    value: false,
    configurable: true,
  });
  expect(await resolveMedia(`media:${sha}`)).toBeNull();
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  localStorage.clear();
  expect(await resolveMedia(`media:${"e".repeat(64)}`)).toBeNull();
  expect(await resolveMedia("https://example.com/a.png")).toBeNull();
  expect(await resolveMedia("media:short")).toBeNull();
  expect(calls).toEqual([]);
});

it("moves pictures out of old notes into media references, and asks nothing when there are none", async () => {
  const data = `data:image/png;base64,${PNG_B64}`;
  await db.notes.bulkAdd([
    {
      id: "io",
      deck: "d",
      content: {
        type: "imageOcclusion",
        image: data,
        boxes: [],
        hideAll: true,
      },
    },
    {
      id: "basic",
      deck: "d",
      content: {
        type: "normal",
        front: `<p>x</p><img src="${data}" alt="">`,
        back: "<p>plain</p>",
      },
    },
    {
      id: "text",
      deck: "d",
      content: { type: "normal", front: "no picture", back: "here" },
    },
  ] as never);

  // R2 off: nothing moves
  enabled(false);
  expect(await migrateInlineImages()).toBe(0);
  expect(((await db.notes.get("io")) as any).content.image).toBe(data);

  resetMediaEnabledCache();
  enabled();
  expect(await migrateInlineImages()).toBe(2);
  const sha = await sha256Hex(PNG);
  expect(((await db.notes.get("io")) as any).content.image).toBe(
    `media:${sha}`
  );
  expect(((await db.notes.get("basic")) as any).content.front).toBe(
    `<p>x</p><img src="media:${sha}" alt="">`
  );
  expect(((await db.notes.get("basic")) as any).content.back).toBe(
    "<p>plain</p>"
  );
  expect(((await db.notes.get("text")) as any).content.front).toBe(
    "no picture"
  );
  expect(await db.media.count()).toBe(1);

  calls = [];
  expect(await migrateInlineImages()).toBe(0);
  expect(calls).toEqual([]); // nothing inline any more: no request
});
