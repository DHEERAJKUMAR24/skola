// @vitest-environment node
import fs from "node:fs";
import zlib from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { type Db, getDb } from "./db";
import { handleRpc } from "./mcp";
import { createUser } from "./users";

/**
 * Demo data: one account with a deck of every card type. It runs against an in-memory database
 * as an ordinary test. To seed a real database run `pnpm db:seed` (needs SEED_DATABASE=1 and
 * DATABASE_URL, e.g. from .env.local); it is safe to repeat, an existing account is reused.
 */
export const SEED_EMAIL = "test@skola.test";
export const SEED_PASSWORD = "SkolaDemo-2026!";

/** A small solid-colour PNG with two light blocks to hide, so image occlusion has something to show. */
function demoPng(w = 240, h = 140) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const block =
        (x > 20 && x < 100 && y > 30 && y < 80) ||
        (x > 140 && x < 220 && y > 60 && y < 120);
      raw.set(block ? [250, 204, 21] : [59, 130, 246], o + 1 + x * 3);
    }
  }
  const crc = (b: Buffer) => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const body = Buffer.concat([Buffer.from(t), d]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

export async function seed(db: Db) {
  const found = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [SEED_EMAIL]
  );
  const user =
    found.rows[0] ?? (await createUser(db, SEED_EMAIL, SEED_PASSWORD));
  const call = async (name: string, args: object) => {
    const r: any = await handleRpc(db, user.id, {
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (r.result.isError)
      throw new Error(`${name}: ${r.result.content[0].text}`);
    return JSON.parse(r.result.content[0].text);
  };
  const { rows } = await db.query<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM changes WHERE user_id = $1 AND tbl = 'decks'",
    [user.id]
  );
  if (rows[0].n > 0) return { email: SEED_EMAIL, created: false };

  const deck = async (name: string, cards: object[], parent_id?: string) => {
    const d = await call("create_deck", { name, parent_id });
    await call("add_cards", { deck_id: d.id, cards });
    return d.id as string;
  };
  const root = (await call("create_deck", { name: "Demo" })).id as string;
  await deck(
    "Basic and reverse",
    [
      { front: "Capital of France?", back: "Paris", tags: ["geography"] },
      { front: "H2O is?", back: "Water", tags: ["chemistry"] },
      { front: "2 + 2", back: "4" },
    ],
    root
  );
  await deck(
    "Cloze",
    [
      {
        type: "cloze",
        text: "{{c1::Paris}} is the capital of {{c2::France}}.",
      },
      {
        type: "cloze",
        text: "The mitochondria is the {{c1::powerhouse}} of the cell.",
      },
    ],
    root
  );
  await deck(
    "Multiple choice",
    [
      {
        type: "multiple_choice",
        question: "Which planet is closest to the Sun?",
        choices: ["Venus", "Mercury", "Mars", "Earth"],
        correct: 1,
        explanation: "Mercury orbits closest to the Sun.",
      },
      {
        type: "multiple_choice",
        question: "Which are prime numbers?",
        choices: ["2", "4", "7", "9"],
        correct: [0, 2],
      },
    ],
    root
  );
  await deck(
    "List recall",
    [
      {
        type: "list",
        front: "Name the three states of matter",
        items: ["Solid", "Liquid", "Gas"],
      },
      {
        type: "list",
        front: "Steps of the scientific method, in order",
        items: ["Observe", "Hypothesise", "Experiment", "Conclude"],
        ordered: true,
      },
    ],
    root
  );
  await deck(
    "Image occlusion",
    [
      {
        type: "image_occlusion",
        image: demoPng(),
        header: "Which block is hidden?",
        areas: [
          { x: 0.08, y: 0.22, w: 0.33, h: 0.36 },
          { x: 0.58, y: 0.43, w: 0.33, h: 0.43 },
        ],
      },
    ],
    root
  );
  return { email: SEED_EMAIL, created: true };
}

it(
  "seeds a demo account with every card type",
  { timeout: 60_000 },
  async () => {
    const pg = new PGlite();
    await pg.exec(
      fs.readFileSync("supabase/migrations/20261101000000_init.sql", "utf8")
    );
    const db: Db = {
      query: (text, params) => pg.query(text, params) as never,
      transaction: (fn) =>
        pg.transaction((tx) =>
          fn((text, params) => tx.query(text, params) as never)
        ),
    };
    expect(await seed(db)).toEqual({ email: SEED_EMAIL, created: true });
    expect(await seed(db)).toEqual({ email: SEED_EMAIL, created: false });
    const { rows } = await db.query<{ t: string; n: number }>(
      "SELECT data->'content'->>'type' AS t, COUNT(*)::int AS n FROM changes WHERE tbl = 'cards' GROUP BY 1 ORDER BY 1"
    );
    expect(rows.map((r) => r.t).sort()).toEqual(
      ["cloze", "imageOcclusion", "list", "multipleChoice", "normal"].sort()
    );
  }
);

it.skipIf(!process.env.SEED_DATABASE)("seeds the real database", async () => {
  console.log(await seed(getDb()));
});
