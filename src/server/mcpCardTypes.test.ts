// @vitest-environment node
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, expect, it } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";
import {
  MAX_IMAGE_BYTES,
  checkImageUrl,
  parseImageInput,
  sniffImage,
  toDataUrl,
} from "./mcpImage";

let db: Db;
const U = "types-user";
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = Buffer.from(PNG_B64, "base64");
const PNG_URL = `data:image/png;base64,${PNG_B64}`;

beforeAll(async () => {
  const pg = new PGlite();
  await pg.exec(
    fs.readFileSync("supabase/migrations/20261101000000_init.sql", "utf8")
  );
  db = {
    query: (text, params) => pg.query(text, params) as never,
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn((text, params) => tx.query(text, params) as never)
      ),
  };
});

const call = async (name: string, args: object = {}) => {
  const r: any = await handleRpc(db, U, {
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const out = r.result.content[0].text;
  return r.result.isError ? { error: out } : JSON.parse(out);
};
const row = async (tbl: string, id: string) => {
  const { rows } = await db.query<{ data: any }>(
    "SELECT data FROM changes WHERE user_id = $1 AND tbl = $2 AND id = $3",
    [U, tbl, id]
  );
  return rows[0]?.data;
};
let decks = 0;
const deckOf = async () =>
  (await call("create_deck", { name: `T${++decks}` })).id as string;
const area = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };

it("recognises pictures by their bytes and enforces the size cap", () => {
  expect(sniffImage(PNG)).toBe("png");
  expect(sniffImage(Buffer.from("ffd8ffe000104a464946", "hex"))).toBe("jpeg");
  expect(sniffImage(Buffer.from("GIF89a....", "latin1"))).toBe("gif");
  expect(sniffImage(Buffer.from("RIFF1234WEBPVP8 ", "latin1"))).toBe("webp");
  expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  expect(toDataUrl(PNG)).toBe(PNG_URL);
  expect(() => toDataUrl(Buffer.from("hello world"))).toThrow(/PNG, JPEG/);
  expect(() =>
    toDataUrl(Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]))
  ).toThrow(/shrink/);
  expect(parseImageInput(PNG_URL).equals(PNG)).toBe(true);
  expect(parseImageInput(PNG_B64).equals(PNG)).toBe(true);
  expect(() => parseImageInput("not base64!!")).toThrow(/base64/);
});

it("accepts a plain https link and never fetches it", () => {
  expect(checkImageUrl("  https://example.com/a.png?x=1 ")).toBe(
    "https://example.com/a.png?x=1"
  );
  for (const bad of [
    "http://example.com/a.png",
    "https://user:pw@example.com/a.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "not a url",
    `https://example.com/${"a".repeat(2100)}`,
  ])
    expect(() => checkImageUrl(bad), bad).toThrow(/https link/);
});

it("creates image-occlusion cards from base64, a data URL or a link, one card per area", async () => {
  const id = await deckOf();
  const res = await call("add_cards", {
    deck_id: id,
    cards: [
      {
        type: "image_occlusion",
        image: PNG_URL,
        header: "Heart",
        areas: [area, { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
        tags: ["anatomy"],
      },
      {
        type: "image_occlusion",
        image: PNG_B64,
        areas: [area],
        hide_all: false,
      },
      {
        type: "image_occlusion",
        image_url: "https://example.com/d.png",
        areas: [area],
      },
    ],
  });
  expect(res).toMatchObject({ notes_added: 3, added: 4 });
  const cards = await Promise.all(
    res.card_ids.map((c: string) => row("cards", c))
  );
  expect(cards.every((c) => c.content.type === "imageOcclusion")).toBe(true);
  expect(cards.slice(0, 2).map((c) => c.content.occlusionNumber)).toEqual([
    1, 2,
  ]);

  const note = await row("notes", cards[0].note);
  expect(note.content).toMatchObject({
    type: "imageOcclusion",
    image: PNG_URL,
    header: "Heart",
    hideAll: true,
  });
  expect(note.content.boxes.map((b: any) => b.id)).toEqual([1, 2]);
  expect(note.sortField).toBe("Heart");
  expect(note.tags).toEqual(["anatomy"]);
  expect((await row("notes", cards[2].note)).content.hideAll).toBe(false);
  // the link is kept as given: nothing was downloaded
  expect((await row("notes", cards[3].note)).content.image).toBe(
    "https://example.com/d.png"
  );
  expect((await row("decks", id)).cards).toHaveLength(4);
});

it("refuses bad picture cards and writes nothing", async () => {
  const id = await deckOf();
  const bad = (card: object) =>
    call("add_cards", {
      deck_id: id,
      cards: [{ front: "ok", back: "ok" }, card],
    });
  const io = (extra: object) =>
    bad({ type: "image_occlusion", image: PNG_URL, areas: [area], ...extra });

  expect((await bad({ type: "image_occlusion", areas: [area] })).error).toMatch(
    /card 2: give image/
  );
  expect(
    (await io({ image: Buffer.from("hello").toString("base64") })).error
  ).toMatch(/PNG, JPEG/);
  expect((await io({ image: "%%%" })).error).toMatch(/base64/);
  expect((await io({ areas: [] })).error).toMatch(/areas/);
  expect((await io({ areas: undefined })).error).toMatch(/areas/);
  expect(
    (await io({ areas: [{ x: 0.9, y: 0.1, w: 0.3, h: 0.1 }] })).error
  ).toMatch(/at most 1/);
  expect(
    (await io({ areas: [{ x: -0.1, y: 0, w: 0.2, h: 0.2 }] })).error
  ).toMatch(/fractions/);
  expect(
    (await io({ areas: [{ x: 0.1, y: 0.1, w: 0.001, h: 0.2 }] })).error
  ).toMatch(/1%/);
  expect((await io({ areas: [{ x: "a", y: 0, w: 1, h: 1 }] })).error).toMatch(
    /numbers/
  );
  expect(
    (await io({ areas: Array.from({ length: 31 }, () => area) })).error
  ).toMatch(/30/);
  expect(
    (await io({ image: undefined, image_url: "http://insecure.example/a.png" }))
      .error
  ).toMatch(/https/);
  expect((await row("decks", id)).cards).toHaveLength(0);
});

it("edits every card type, adding cards for new cloze numbers and picture areas", async () => {
  const id = await deckOf();
  const res = await call("add_cards", {
    deck_id: id,
    cards: [
      { front: "old q", back: "old a" },
      { type: "cloze", text: "{{c1::Paris}} is in {{c2::France}}" },
      {
        type: "multiple_choice",
        question: "Pick",
        choices: ["a", "b", "c"],
        correct: 0,
        explanation: "because",
      },
      { type: "list", front: "Steps", items: ["one", "two"] },
      { type: "image_occlusion", image: PNG_URL, areas: [area] },
    ],
  });
  const [basic, cloze1, , mc, list, io] = res.card_ids;
  void cloze1;
  const noteOf = async (cardId: string) =>
    row("notes", (await row("cards", cardId)).note);

  // basic
  await call("edit_card", { card_id: basic, front: "new q" });
  expect((await noteOf(basic)).content).toMatchObject({
    front: "<p>new q</p>",
    back: "<p>old a</p>",
  });
  expect((await noteOf(basic)).sortField).toBe("new q");

  // cloze: a new number gets a card, the others keep theirs
  const clozeCard = res.card_ids[1];
  const edited = await call("edit_card", {
    card_id: clozeCard,
    text: "{{c1::Paris}} is in {{c2::France}} on {{c3::Earth}}",
  });
  expect(edited).toMatchObject({ ok: true, cards_added: 1 });
  expect((await row("decks", id)).cards).toHaveLength(7);
  const numbers = (
    await Promise.all(
      (await row("decks", id)).cards.map((c: string) => row("cards", c))
    )
  )
    .filter((c: any) => c.content.type === "cloze")
    .map((c: any) => c.content.occlusionNumber)
    .sort();
  expect(numbers).toEqual([1, 2, 3]);
  // removing a number does not delete its card
  await call("edit_card", {
    card_id: clozeCard,
    text: "{{c1::Paris}} is in France",
  });
  expect((await row("decks", id)).cards).toHaveLength(7);

  // multiple choice: partial edits keep the rest; choices need correct
  await call("edit_card", { card_id: mc, question: "Pick one" });
  expect((await noteOf(mc)).content).toMatchObject({
    question: "<p>Pick one</p>",
    explanation: "<p>because</p>",
  });
  expect(
    (await call("edit_card", { card_id: mc, choices: ["x", "y"] })).error
  ).toMatch(/together/);
  await call("edit_card", {
    card_id: mc,
    choices: ["x", "y", "z"],
    correct: [1, 2],
    explanation: "",
  });
  const mcNote = await noteOf(mc);
  expect(mcNote.content.choices).toEqual([
    { text: "x", correct: false },
    { text: "y", correct: true },
    { text: "z", correct: true },
  ]);
  expect(mcNote.content.explanation).toBeUndefined();
  expect(
    (await call("edit_card", { card_id: mc, choices: ["x"], correct: 0 })).error
  ).toMatch(/two/);

  // list
  await call("edit_card", {
    card_id: list,
    items: [">>> first", "- second", "third"],
    ordered: true,
  });
  expect((await noteOf(list)).content).toMatchObject({
    items: ["first", "second", "third"],
    ordered: true,
    front: "<p>Steps</p>",
  });

  // picture: move area 1, add a new one (gets a card), change header and mode
  const moved = await call("edit_card", {
    card_id: io,
    header: "Diagram",
    hide_all: false,
    areas: [
      { id: 1, x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
      { x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
    ],
  });
  expect(moved).toMatchObject({ ok: true, cards_added: 1 });
  const ioNote = await noteOf(io);
  expect(ioNote.content.boxes).toEqual([
    { id: 1, x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
    { id: 2, x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
  ]);
  expect(ioNote.content).toMatchObject({
    header: "Diagram",
    hideAll: false,
    image: PNG_URL,
  });
  expect(ioNote.sortField).toBe("Diagram");
  expect(
    (await call("edit_card", { card_id: io, areas: [{ id: 9, ...area }] }))
      .error
  ).toMatch(/does not exist/);

  // wrong fields for the type, nothing to change, tags and suspend still work for all
  expect(
    (await call("edit_card", { card_id: basic, items: ["a"] })).error
  ).toMatch(/do not apply to a normal card/);
  expect((await call("edit_card", { card_id: io, front: "x" })).error).toMatch(
    /do not apply to a imageOcclusion card/
  );
  expect((await call("edit_card", { card_id: basic })).error).toMatch(
    /nothing to change/
  );
  await call("edit_card", {
    card_id: io,
    tags: ["Anatomy Heart"],
    suspended: true,
  });
  expect((await noteOf(io)).tags).toEqual(["anatomy-heart"]);
  expect((await row("cards", io)).suspended).toBe(true);
});

it("returns the picture of a card as an image block, and describes it in the card fields", async () => {
  const id = await deckOf();
  const { card_ids } = await call("add_cards", {
    deck_id: id,
    cards: [
      {
        type: "image_occlusion",
        image: PNG_URL,
        header: "Map",
        areas: [area, { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }],
      },
      { front: "plain", back: "card" },
    ],
  });
  const r: any = await handleRpc(db, U, {
    id: 1,
    method: "tools/call",
    params: { name: "get_card_image", arguments: { card_id: card_ids[1] } },
  });
  const [info, image] = r.result.content;
  expect(JSON.parse(info.text)).toMatchObject({
    header: "Map",
    hide_all: true,
    active_area: 2,
  });
  expect(image).toEqual({
    type: "image",
    data: PNG_B64,
    mimeType: "image/png",
  });

  expect(
    (await call("get_card_image", { card_id: card_ids[2] })).error
  ).toMatch(/no picture/);
  expect((await call("get_card_image", { card_id: "nope" })).error).toMatch(
    /not found/
  );

  const found = await call("search_cards", { query: "map", deck_id: id });
  expect(found[0].fields).toMatchObject({ header: "Map", hide_all: "true" });
  expect(found[0].fields.areas).toHaveLength(2);
  expect(found[0].fields.areas[0]).toMatch(
    /^1: x=0\.10 y=0\.10 w=0\.30 h=0\.30$/
  );
  expect(JSON.stringify(found[0])).not.toContain(PNG_B64); // the bytes never leak into text
  expect(found.map((c: any) => c.occlusion).sort()).toEqual([1, 2]);
});

it("creates reverse (double-sided) notes like the app and edits them", async () => {
  const deck = await deckOf();
  const r = await call("add_cards", {
    deck_id: deck,
    cards: [{ type: "reverse", front: "chat", back: "cat & <b>kitten</b>" }],
  });
  expect(r).toMatchObject({ notes_added: 1, added: 2 });
  const cards = await Promise.all(
    r.card_ids.map((id: string) => row("cards", id))
  );
  expect(cards.map((c: any) => c.content)).toEqual([
    { type: "doubleSided", frontIsField1: true },
    { type: "doubleSided", frontIsField1: false },
  ]);
  expect(cards.map((c: any) => c.preview)).toEqual([
    "chat",
    "cat &amp; &lt;b&gt;kitten&lt;/b&gt;",
  ]);
  const note = await row("notes", cards[0].note);
  expect(note.content).toEqual({
    type: "doubleSided",
    field1: "<p>chat</p>",
    field2: "<p>cat &amp; &lt;b&gt;kitten&lt;/b&gt;</p>",
  });
  expect(note.sortField).toBe("chat");

  const e = await call("edit_card", { card_id: r.card_ids[1], back: "cat" });
  expect(e.error).toBeUndefined();
  expect((await row("notes", cards[0].note)).content).toMatchObject({
    field1: "<p>chat</p>",
    field2: "<p>cat</p>",
  });
  expect(
    (await call("edit_card", { card_id: r.card_ids[0], text: "x" })).error
  ).toMatch(/do not apply to a doubleSided card/);
  expect(
    (
      await call("add_cards", {
        deck_id: deck,
        cards: [{ type: "reverse", front: "a" }],
      })
    ).error
  ).toMatch(/back must be/);
});
