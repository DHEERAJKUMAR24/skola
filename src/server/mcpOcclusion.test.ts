// @vitest-environment node
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db";
import { imageSize, isPrivateAddress, netDeps } from "./imageInfo";
import { TOOLS, handleRpc } from "./mcp";

// ---- fixtures -------------------------------------------------------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};
/** A real, decodable PNG. `noise` makes the bytes incompressible so the file gets big. */
function png(width: number, height: number, noise = false) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 8-bit RGB
  const row = noise ? randomBytes(width * 3) : Buffer.alloc(width * 3, 200);
  const raw = Buffer.concat(
    Array.from({ length: height }, () =>
      Buffer.concat([Buffer.from([0]), noise ? randomBytes(width * 3) : row])
    )
  );
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const dataUrl = (b: Buffer, mime = "image/png") =>
  `data:${mime};base64,${b.toString("base64")}`;

let pg: PGlite;
let db: Db;
let failOnInsert = 0;
let inserts = 0;
const mkDb = (): Db => ({
  query: (text, params) => pg.query(text, params) as never,
  transaction: (fn) =>
    pg.transaction((tx) =>
      fn((text, params) => {
        if (
          failOnInsert &&
          /INSERT INTO changes/.test(text) &&
          ++inserts === failOnInsert
        )
          throw new Error("disk full");
        return tx.query(text, params) as never;
      })
    ),
});

beforeAll(async () => {
  pg = new PGlite();
  for (const f of [
    "20261101000000_init",
    "20261102000000_skills",
    "20261104000000_image_assets",
  ])
    await pg.exec(fs.readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  db = mkDb();
});
afterEach(() => {
  failOnInsert = 0;
  inserts = 0;
});

let rpcId = 0;
/** One tools/call through the real JSON-RPC handler, the way a client sends it. */
async function call(user: string, name: string, args: object) {
  const r = (await handleRpc(db, user, {
    jsonrpc: "2.0",
    id: ++rpcId,
    method: "tools/call",
    params: { name, arguments: args },
  })) as {
    result: { isError?: boolean; content: { type: string; text?: string }[] };
  };
  const block = r.result.content[0];
  return {
    isError: !!r.result.isError,
    text: block.text ?? "",
    json: () => JSON.parse(block.text ?? "null"),
    content: r.result.content,
  };
}
const ok = async (user: string, name: string, args: object) => {
  const r = await call(user, name, args);
  expect(r.isError, r.text).toBe(false);
  return r.json();
};

let n = 0;
const newUser = () => `user-${++n}`;
async function deckFor(user: string) {
  return (await ok(user, "create_deck", { name: "JS" })).id as string;
}
async function count(user: string, tbl: string) {
  const { rows } = await pg.query<{ n: string }>(
    "SELECT count(*) AS n FROM changes WHERE user_id = $1 AND tbl = $2 AND NOT deleted",
    [user, tbl]
  );
  return Number(rows[0].n);
}

const AREAS = [
  { x: 0.1, y: 0.2, w: 0.3, h: 0.15, label: "Call Stack" },
  { x: 0.5, y: 0.5, w: 0.25, h: 0.2, label: "Task Queue" },
];

// ---- image helpers -------------------------------------------------------------------------

describe("image headers and addresses", () => {
  it("reads the pixel size of PNG, GIF, JPEG and WebP", () => {
    expect(imageSize(png(37, 21), "png")).toEqual({ width: 37, height: 21 });
    const gif = Buffer.from(
      "474946383961" + "2500" + "1500" + "00000000",
      "hex"
    );
    expect(imageSize(gif, "gif")).toEqual({ width: 37, height: 21 });
    const jpeg = Buffer.from(
      `ffd8ffe000104a46494600010100000100010000ffc0001108${(21).toString(16).padStart(4, "0")}${(37).toString(16).padStart(4, "0")}03`,
      "hex"
    );
    expect(imageSize(jpeg, "jpeg")).toEqual({ width: 37, height: 21 });
    const x = Buffer.alloc(30);
    x.write("RIFF", 0);
    x.write("WEBP", 8);
    x.write("VP8X", 12);
    x.writeUIntLE(36, 24, 3);
    x.writeUIntLE(20, 27, 3);
    expect(imageSize(x, "webp")).toEqual({ width: 37, height: 21 });
    expect(imageSize(Buffer.alloc(30), "png")).toBeNull();
  });

  it("flags private, loopback, link-local and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.9",
      "172.20.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

// ---- upload ----------------------------------------------------------------------------------

describe("upload_image_asset", () => {
  it("takes base64 and a data URL, returns a stable id with the real size", async () => {
    const u = newUser();
    const file = png(120, 80);
    const a = await ok(u, "upload_image_asset", {
      image_base64: file.toString("base64"),
    });
    const b = await ok(u, "upload_image_asset", {
      image_base64: dataUrl(file),
    });
    expect(a).toMatchObject({
      mime_type: "image/png",
      width: 120,
      height: 80,
      size_bytes: file.length,
    });
    expect(a.image_asset_id).toMatch(/^asset_[0-9a-f]{32}$/);
    expect(b.image_asset_id).toBe(a.image_asset_id);
    const { rows } = await pg.query(
      "SELECT 1 FROM mcp_image_assets WHERE user_id = $1",
      [u]
    );
    expect(rows).toHaveLength(1);
    const info = await ok(u, "get_image_asset", {
      image_asset_id: a.image_asset_id,
    });
    expect(info).toMatchObject({ width: 120, height: 80 });
  });

  it("returns the picture itself when asked", async () => {
    const u = newUser();
    const up = await ok(u, "upload_image_asset", {
      image_base64: png(10, 10).toString("base64"),
    });
    const r = await call(u, "get_image_asset", {
      image_asset_id: up.image_asset_id,
      include_image: true,
    });
    expect(r.content.map((c) => c.type)).toEqual(["text", "image"]);
  });

  it("rejects corrupt, non-image and oversized input with a code and a way forward", async () => {
    const u = newUser();
    const text = await call(u, "upload_image_asset", {
      image_base64: Buffer.from("hello world, not a picture").toString(
        "base64"
      ),
    });
    expect(text.isError).toBe(true);
    expect(text.text).toMatch(/^\[invalid_image\]/);
    const damaged = png(5, 5).subarray(0, 20);
    expect(
      (
        await call(u, "upload_image_asset", {
          image_base64: damaged.toString("base64"),
        })
      ).text
    ).toMatch(/^\[invalid_image\]/);
    const huge = Buffer.concat([png(2, 2), Buffer.alloc(8_100_000)]);
    const big = await call(u, "upload_image_asset", {
      image_base64: huge.toString("base64"),
    });
    expect(big.text).toMatch(/^\[image_too_large\]/);
    expect(big.text).toMatch(/Shrink|shrink/);
    expect((await call(u, "upload_image_asset", {})).text).toMatch(
      /^\[missing_image\]/
    );
    expect(
      (
        await call(u, "upload_image_asset", {
          image_base64: "%%%not base64%%%",
        })
      ).text
    ).toMatch(/^\[invalid_image_data\]/);
  });

  describe("from a link or a file reference", () => {
    const original = { fetch: netDeps.fetch, lookup: netDeps.lookup };
    afterEach(() => Object.assign(netDeps, original));
    const serve = (body: Buffer | null, status = 200) => {
      netDeps.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
      netDeps.fetch = async () =>
        new Response(body ? new Uint8Array(body) : null, { status });
    };

    it("downloads an https image_url and a file reference with download_url", async () => {
      const u = newUser();
      serve(png(64, 48));
      const viaUrl = await ok(u, "upload_image_asset", {
        image_url: "https://files.example/d.png",
      });
      const viaRef = await ok(u, "upload_image_asset", {
        image: {
          download_url: "https://files.example/d.png",
          file_id: "file-123",
        },
      });
      expect(viaUrl).toMatchObject({ width: 64, height: 48 });
      expect(viaRef.image_asset_id).toBe(viaUrl.image_asset_id);
    });

    it("explains a file reference it cannot read instead of failing generically", async () => {
      const r = await call(newUser(), "upload_image_asset", {
        image: { file_id: "file-123" },
      });
      expect(r.text).toMatch(/^\[unsupported_image_reference\]/);
      expect(r.text).toMatch(/image_base64/);
    });

    it("refuses private addresses, plain http, logins, redirects and bad status", async () => {
      const u = newUser();
      netDeps.lookup = async () => [{ address: "10.0.0.5", family: 4 }];
      expect(
        (
          await call(u, "upload_image_asset", {
            image_url: "https://internal.example/a.png",
          })
        ).text
      ).toMatch(/^\[blocked_address\]/);
      expect(
        (
          await call(u, "upload_image_asset", {
            image_url: "https://127.0.0.1/a.png",
          })
        ).text
      ).toMatch(/^\[blocked_address\]/);
      expect(
        (
          await call(u, "upload_image_asset", {
            image_url: "http://files.example/a.png",
          })
        ).text
      ).toMatch(/^\[invalid_url\]/);
      expect(
        (
          await call(u, "upload_image_asset", {
            image_url: "https://user:pw@files.example/a.png",
          })
        ).text
      ).toMatch(/^\[invalid_url\]/);
      serve(null, 403);
      expect(
        (
          await call(u, "upload_image_asset", {
            image_url: "https://files.example/a.png",
          })
        ).text
      ).toMatch(/^\[download_failed\].*403/);
      netDeps.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
      netDeps.fetch = async () => {
        throw new TypeError("redirect mode is set to error");
      };
      expect(
        (
          await call(u, "upload_image_asset", {
            image_url: "https://files.example/a.png",
          })
        ).text
      ).toMatch(/redirects are not followed/);
    });
  });
});

// ---- areas -----------------------------------------------------------------------------------

describe("area validation", () => {
  it("names the bad area and what is wrong", async () => {
    const u = newUser();
    const deck = await deckFor(u);
    const up = await ok(u, "upload_image_asset", {
      image_base64: png(100, 100).toString("base64"),
    });
    const bad = async (areas: object[]) =>
      (
        await call(u, "create_image_occlusion_cards", {
          deck_id: deck,
          image_asset_id: up.image_asset_id,
          areas,
        })
      ).text;
    expect(
      await bad([
        { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        { x: 0.9, y: 0.1, w: 0.3, h: 0.2 },
      ])
    ).toMatch(/\[invalid_areas\] area 2 leaves the picture: x\+w=1\.2/);
    expect(await bad([{ x: -0.1, y: 0.1, w: 0.2, h: 0.2 }])).toMatch(
      /area 1: x and y must be 0 or more/
    );
    expect(await bad([{ x: 0.1, y: 0.1, w: 0, h: 0.2 }])).toMatch(
      /area 1: w and h must be greater than 0/
    );
    expect(await bad([{ x: 0.1, y: 0.1, w: 0.001, h: 0.2 }])).toMatch(
      /at least 1%/
    );
    expect(await bad([{ x: 0.1, y: "a", w: 0.2, h: 0.2 }])).toMatch(
      /area 1: x, y, w and h must all be numbers/
    );
    expect(await bad([])).toMatch(/\[invalid_areas\]/);
    expect(
      await bad([
        { x: 0, y: 0, w: 0.2, h: 0.2, id: 1 },
        { x: 0.5, y: 0.5, w: 0.2, h: 0.2, id: 1 },
      ])
    ).toMatch(/area 2: id must be a unique/);
    expect(
      await bad(
        Array.from({ length: 31 }, () => ({ x: 0, y: 0, w: 0.1, h: 0.1 }))
      )
    ).toMatch(/\[too_many_areas\]/);
    expect(await count(u, "cards")).toBe(0);
  });
});

// ---- creating cards ---------------------------------------------------------------------------

describe("create_image_occlusion_cards", () => {
  it("makes one card per area, keeps coordinates exact and reads back", async () => {
    const u = newUser();
    const deck = await deckFor(u);
    const up = await ok(u, "upload_image_asset", {
      image_base64: png(300, 200).toString("base64"),
    });
    const made = await ok(u, "create_image_occlusion_cards", {
      deck_id: deck,
      image_asset_id: up.image_asset_id,
      header: "Event Loop",
      areas: AREAS,
      tags: ["js"],
    });
    expect(made.cards_created).toBe(2);
    expect(made.card_ids).toHaveLength(2);
    expect(made.cards.map((c: { label: string }) => c.label)).toEqual([
      "Call Stack",
      "Task Queue",
    ]);
    expect(await count(u, "cards")).toBe(2);
    expect(await count(u, "notes")).toBe(1);

    const deckRow = (
      await pg.query<{ data: { cards: string[]; notes: string[] } }>(
        "SELECT data FROM changes WHERE user_id = $1 AND tbl = 'decks' AND id = $2",
        [u, deck]
      )
    ).rows[0].data;
    expect(deckRow.cards).toEqual(expect.arrayContaining(made.card_ids));
    expect(deckRow.notes).toContain(made.note_id);

    for (const [i, id] of made.card_ids.entries()) {
      const r = await call(u, "get_card_image", { card_id: id });
      expect(r.isError, r.text).toBe(false);
      expect(r.content.map((c) => c.type)).toEqual(["text", "image"]);
      const info = JSON.parse(r.content[0].text as string);
      expect(info.active_area).toBe(i + 1);
      expect(info.header).toBe("Event Loop");
      expect(info.hide_all).toBe(true);
      expect(info.areas).toEqual([
        { id: 1, ...AREAS[0] },
        { id: 2, ...AREAS[1] },
      ]);
    }
  });

  it("stores hide_all false, and the same areas are exact for pictures of any size", async () => {
    const u = newUser();
    const deck = await deckFor(u);
    const small = await ok(u, "upload_image_asset", {
      image_base64: png(50, 40).toString("base64"),
    });
    const large = await ok(u, "upload_image_asset", {
      image_base64: png(800, 600).toString("base64"),
    });
    const boxesOf = async (assetId: string, hide: boolean) => {
      const made = await ok(u, "create_image_occlusion_cards", {
        deck_id: deck,
        image_asset_id: assetId,
        hide_all: hide,
        areas: AREAS,
      });
      const note = (
        await pg.query<{
          data: { content: { boxes: object[]; hideAll: boolean } };
        }>(
          "SELECT data FROM changes WHERE user_id = $1 AND tbl = 'notes' AND id = $2",
          [u, made.note_id]
        )
      ).rows[0].data.content;
      return note;
    };
    const a = await boxesOf(small.image_asset_id, false);
    const b = await boxesOf(large.image_asset_id, true);
    expect(a.hideAll).toBe(false);
    expect(b.hideAll).toBe(true);
    expect(a.boxes).toEqual(b.boxes);
    const p = await ok(u, "preview_image_occlusion", {
      image_asset_id: large.image_asset_id,
      areas: AREAS,
    });
    expect(p.areas[0].pixels).toEqual({ x: 80, y: 120, w: 240, h: 90 });
  });

  it("works straight from base64 or a data URL without a separate upload", async () => {
    const u = newUser();
    const deck = await deckFor(u);
    const made = await ok(u, "create_image_occlusion_cards", {
      deck_id: deck,
      image_base64: dataUrl(png(40, 40)),
      areas: [AREAS[0]],
    });
    expect(made).toMatchObject({ cards_created: 1, image_storage: "inline" });
  });

  it("keeps an https image_url as a link", async () => {
    const u = newUser();
    const deck = await deckFor(u);
    const made = await ok(u, "create_image_occlusion_cards", {
      deck_id: deck,
      image_url: "https://img.example/e.png",
      areas: [AREAS[0]],
    });
    expect(made.image_storage).toBe("link");
    const info = await ok(u, "get_card_image", { card_id: made.card_ids[0] });
    expect(info.image_url).toBe("https://img.example/e.png");
  });

  it("a retry with the same idempotency_key returns the same cards and creates no duplicates", async () => {
    const u = newUser();
    const deck = await deckFor(u);
    const up = await ok(u, "upload_image_asset", {
      image_base64: png(60, 60).toString("base64"),
    });
    const args = {
      deck_id: deck,
      image_asset_id: up.image_asset_id,
      areas: AREAS,
      idempotency_key: "event-loop-v1",
    };
    const first = await ok(u, "create_image_occlusion_cards", args);
    const again = await ok(u, "create_image_occlusion_cards", args);
    expect(first.replayed).toBe(false);
    expect(again).toMatchObject({
      replayed: true,
      cards_created: 0,
      note_id: first.note_id,
    });
    expect(again.card_ids).toEqual(first.card_ids);
    expect(await count(u, "cards")).toBe(2);
    expect(await count(u, "notes")).toBe(1);

    const clash = await call(u, "create_image_occlusion_cards", {
      ...args,
      areas: [AREAS[0]],
    });
    expect(clash.text).toMatch(/^\[idempotency_conflict\]/);
    expect(await count(u, "cards")).toBe(2);
  });

  it("saves nothing when the write fails halfway, and the same key then succeeds", async () => {
    const u = newUser();
    const deck = await deckFor(u);
    const up = await ok(u, "upload_image_asset", {
      image_base64: png(60, 60).toString("base64"),
    });
    const args = {
      deck_id: deck,
      image_asset_id: up.image_asset_id,
      areas: AREAS,
      idempotency_key: "retry-me",
    };
    failOnInsert = 2;
    const failed = await call(u, "create_image_occlusion_cards", args);
    expect(failed.text).toMatch(/^\[save_failed\].*nothing was created/);
    expect(await count(u, "cards")).toBe(0);
    expect(await count(u, "notes")).toBe(0);
    failOnInsert = 0;
    const retry = await ok(u, "create_image_occlusion_cards", args);
    expect(retry).toMatchObject({ replayed: false, cards_created: 2 });
    expect(await count(u, "cards")).toBe(2);
  });

  it("explains an unknown deck, a missing asset and a picture too big to keep inline", async () => {
    const u = newUser();
    const deck = await deckFor(u);
    expect(
      (
        await call(u, "create_image_occlusion_cards", {
          deck_id: "nope",
          image_base64: png(9, 9).toString("base64"),
          areas: [AREAS[0]],
        })
      ).text
    ).toMatch(/^\[deck_not_found\]/);
    expect(
      (
        await call(u, "create_image_occlusion_cards", {
          deck_id: deck,
          image_asset_id: `asset_${"0".repeat(32)}`,
          areas: [AREAS[0]],
        })
      ).text
    ).toMatch(/^\[asset_not_found\].*upload_image_asset/);
    expect(
      (
        await call(u, "create_image_occlusion_cards", {
          deck_id: deck,
          image_asset_id: "bogus",
          areas: [AREAS[0]],
        })
      ).text
    ).toMatch(/^\[invalid_asset_id\]/);
    const big = png(700, 220, true);
    expect(big.length).toBeGreaterThan(400_000);
    const up = await ok(u, "upload_image_asset", {
      image_base64: big.toString("base64"),
    });
    const tooBig = await call(u, "create_image_occlusion_cards", {
      deck_id: deck,
      image_asset_id: up.image_asset_id,
      areas: [AREAS[0]],
    });
    expect(tooBig.text).toMatch(/^\[image_too_large_for_inline\]/);
    expect(await count(u, "cards")).toBe(0);
  });

  it("another user cannot see or use someone else's asset", async () => {
    const owner = newUser();
    const other = newUser();
    const up = await ok(owner, "upload_image_asset", {
      image_base64: png(30, 30).toString("base64"),
    });
    const deck = await deckFor(other);
    expect(
      (
        await call(other, "get_image_asset", {
          image_asset_id: up.image_asset_id,
        })
      ).text
    ).toMatch(/^\[asset_not_found\]/);
    expect(
      (
        await call(other, "create_image_occlusion_cards", {
          deck_id: deck,
          image_asset_id: up.image_asset_id,
          areas: [AREAS[0]],
        })
      ).text
    ).toMatch(/^\[asset_not_found\]/);
    expect(await count(other, "cards")).toBe(0);
  });

  it("add_cards also accepts an asset id", async () => {
    const u = newUser();
    const deck = await deckFor(u);
    const up = await ok(u, "upload_image_asset", {
      image_base64: png(30, 30).toString("base64"),
    });
    const r = await ok(u, "add_cards", {
      deck_id: deck,
      cards: [
        {
          type: "image_occlusion",
          image_asset_id: up.image_asset_id,
          areas: [AREAS[0]],
        },
      ],
    });
    expect(r.added).toBe(1);
  });
});

// ---- preview, discovery, protocol ------------------------------------------------------------

describe("preview and discovery", () => {
  it("previews without storing anything and reports overlaps", async () => {
    const u = newUser();
    const p = await ok(u, "preview_image_occlusion", {
      image_base64: png(200, 100).toString("base64"),
      areas: [
        { x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
        { x: 0.3, y: 0.3, w: 0.4, h: 0.4 },
      ],
    });
    expect(p).toMatchObject({
      valid: true,
      cards_that_would_be_created: 2,
      image: { width: 200, height: 100 },
      overlapping_areas: [[1, 2]],
    });
    expect(p.preview_svg).toContain('viewBox="0 0 200 100"');
    expect(await count(u, "cards")).toBe(0);
    const { rows } = await pg.query(
      "SELECT 1 FROM mcp_image_assets WHERE user_id = $1",
      [u]
    );
    expect(rows).toHaveLength(0);
    expect(
      (
        await call(u, "preview_image_occlusion", {
          areas: [{ x: 0.9, y: 0, w: 0.5, h: 0.1 }],
        })
      ).text
    ).toMatch(/area 1 leaves the picture/);
  });

  it("get_capabilities reports formats, limits and the workflow", async () => {
    const c = await ok(newUser(), "get_capabilities", {});
    expect(c.image.formats).toEqual(["png", "jpeg", "webp", "gif"]);
    expect(c.image_occlusion_workflow[0]).toMatch(/upload_image_asset/);
    expect(c.card_types).toContain("image_occlusion");
  });

  it("tools/list advertises the tools with valid schemas and ChatGPT file parameters", async () => {
    const r = (await handleRpc(db, newUser(), {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    })) as {
      result: {
        tools: {
          name: string;
          inputSchema: {
            type: string;
            properties: Record<string, unknown>;
            required?: string[];
          };
          _meta?: Record<string, unknown>;
          annotations: { readOnlyHint: boolean };
        }[];
      };
    };
    const byName = new Map(r.result.tools.map((t) => [t.name, t]));
    for (const name of [
      "get_capabilities",
      "upload_image_asset",
      "get_image_asset",
      "preview_image_occlusion",
      "create_image_occlusion_cards",
    ])
      expect(byName.has(name), name).toBe(true);
    expect(byName.get("upload_image_asset")?._meta).toEqual({
      "openai/fileParams": ["image"],
    });
    expect(
      byName.get("create_image_occlusion_cards")?.annotations.readOnlyHint
    ).toBe(false);
    expect(
      byName.get("preview_image_occlusion")?.annotations.readOnlyHint
    ).toBe(true);
    for (const t of TOOLS) {
      expect(t.inputSchema).toMatchObject({ type: "object" });
      const s = JSON.stringify(t.inputSchema);
      expect(s).not.toMatch(/"oneOf"|"anyOf"|"allOf"/);
      for (const req of (
        t.inputSchema as { required?: string[]; properties: object }
      ).required ?? [])
        expect(
          Object.keys((t.inputSchema as { properties: object }).properties)
        ).toContain(req);
    }
  });
});
