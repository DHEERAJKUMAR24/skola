import { randomUUID } from "node:crypto";
import { type Card as FsrsCard, createEmptyCard } from "ts-fsrs";
import { default_w } from "ts-fsrs";
import { effectiveOptions } from "../logic/deck/effectiveOptions";
import { normalizeTags } from "../logic/note/tagNormalize";
import {
  addDays,
  isLeechLapse,
  logicalDayStart,
  resolveExam,
  scheduleCard,
  siblingsToBury,
} from "../logic/scheduling/policy";
import {
  type Args,
  type Ctx,
  type Row,
  type Tool,
  type WriteRow,
  decode,
  load,
  putRows,
  str,
} from "./mcpData";
import { CARD_TYPES, buildNote, editNote, hasContentEdit } from "./mcpNotes";

const MAX_NEW_CARDS = 50;
const MAX_TEXT = 10_000;
const DEFAULT_PRESET_ID = "default";

const need = <T>(v: T | undefined | null, msg: string): T => {
  if (v === undefined || v === null) throw new Error(msg);
  return v;
};

function text(a: Args, k: string, required = true): string | undefined {
  const v = a[k];
  if (v === undefined && !required) return undefined;
  if (typeof v !== "string" || !v.trim() || v.length > MAX_TEXT)
    throw new Error(`${k} must be a non-empty string under ${MAX_TEXT} chars`);
  return v;
}

async function one(
  ctx: Ctx,
  tbl: string,
  id: string
): Promise<Row | undefined> {
  const { rows } = await ctx.db.query<{ data: Row }>(
    "SELECT data FROM changes WHERE user_id = $1 AND tbl = $2 AND id = $3 AND NOT deleted",
    [ctx.userId, tbl, id]
  );
  return rows[0]?.data;
}

const create_deck: Tool = {
  name: "create_deck",
  write: true,
  description:
    "Create a deck, optionally inside a parent deck. Sub-decks follow the parent's study preset.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      parent_id: { type: "string" },
      description: { type: "string" },
    },
    required: ["name"],
  },
  async run(ctx, a) {
    const name = text(a, "name") as string;
    if (name.length > 100) throw new Error("name is too long");
    const parentId = str(a, "parent_id");
    const parent = parentId
      ? need(await one(ctx, "decks", parentId), "parent deck not found")
      : undefined;
    const id = randomUUID();
    const deck: Row = {
      id,
      name: name.trim(),
      cards: [],
      notes: [],
      subDecks: [],
      ...(parent
        ? { superDecks: [...(parent.superDecks ?? []), parent.id] }
        : {}),
      ...(str(a, "description") ? { description: str(a, "description") } : {}),
      options: {
        newToReviewRatio: 0.5,
        dailyNewCards: 25,
        presetId: parent?.options?.presetId ?? DEFAULT_PRESET_ID,
      },
    };
    const rows: WriteRow[] = [{ tbl: "decks", id, data: deck }];
    if (parent)
      rows.push({
        tbl: "decks",
        id: parent.id,
        data: { ...parent, subDecks: [...(parent.subDecks ?? []), id] },
      });
    await putRows(ctx, rows);
    return { id, name: deck.name };
  },
};

const add_cards: Tool = {
  name: "add_cards",
  write: true,
  description: `Add flashcards to a deck (max ${MAX_NEW_CARDS} per call). Every item may have tags and a type, default "basic". Text is plain: line breaks become paragraphs and markup is escaped.
- basic: front, back.
- cloze: text with hidden parts written {{c1::answer}}; each number c1, c2, ... becomes its own card.
- multiple_choice: question, choices (list of strings), correct (0-based position or list of positions), optional explanation.
- list: front (the question) and items (the steps or points to recall, as a list; lines may start with >>> or a bullet), optional ordered (true when the order matters).
- image_occlusion: a picture plus the areas to hide. Give the picture as image_url (an https link; Skola does not download it, it is shown straight from the link, so the link must stay reachable) or as image (a data URL or base64 text of a PNG, JPEG, WebP or GIF; it is stored for you, up to 15 MB (but a single request is limited to about 4 MB on Vercel, so send big pictures as image_url), or 400 KB if picture storage is not set up). areas is a list of { x, y, w, h } as fractions of the picture from its top left corner (x, y is the corner, w, h the size, all between 0 and 1). Each area becomes its own card. Optional header, and hide_all (default true: every area is covered and one is asked; false: only the asked area is covered).`,
  inputSchema: {
    type: "object",
    properties: {
      deck_id: { type: "string" },
      cards: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...CARD_TYPES] },
            front: { type: "string" },
            back: { type: "string" },
            text: { type: "string" },
            question: { type: "string" },
            choices: { type: "array", items: { type: "string" } },
            correct: {
              oneOf: [
                { type: "integer" },
                { type: "array", items: { type: "integer" } },
              ],
            },
            explanation: { type: "string" },
            items: { type: "array", items: { type: "string" } },
            ordered: { type: "boolean" },
            image: { type: "string" },
            image_url: { type: "string" },
            header: { type: "string" },
            hide_all: { type: "boolean" },
            areas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  x: { type: "number" },
                  y: { type: "number" },
                  w: { type: "number" },
                  h: { type: "number" },
                },
                required: ["x", "y", "w", "h"],
              },
            },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    required: ["deck_id", "cards"],
  },
  async run(ctx, a) {
    const deck = need(
      await one(ctx, "decks", str(a, "deck_id") ?? ""),
      "deck not found"
    );
    const list = a.cards;
    if (!Array.isArray(list) || !list.length || list.length > MAX_NEW_CARDS)
      throw new Error(`cards must hold 1 to ${MAX_NEW_CARDS} items`);
    const when = new Date(ctx.now);
    const rows: WriteRow[] = [];
    const noteIds: string[] = [];
    const cardIds: string[] = [];
    for (const [n, item] of list.entries()) {
      let built: Awaited<ReturnType<typeof buildNote>>;
      try {
        built = await buildNote(item ?? {}, ctx);
      } catch (e) {
        throw new Error(`card ${n + 1}: ${(e as Error).message}`);
      }
      const tags = Array.isArray(item.tags)
        ? normalizeTags(item.tags.map(String))
        : [];
      const noteId = randomUUID();
      noteIds.push(noteId);
      rows.push({
        tbl: "notes",
        id: noteId,
        data: {
          id: noteId,
          deck: deck.id,
          creationDate: when,
          linkedNotes: [],
          content: built.content,
          sortField: built.sortField,
          ...(tags.length ? { tags } : {}),
        },
      });
      for (const content of built.cards) {
        const cardId = randomUUID();
        cardIds.push(cardId);
        rows.push({
          tbl: "cards",
          id: cardId,
          data: {
            id: cardId,
            deck: deck.id,
            note: noteId,
            creationDate: when,
            model: createEmptyCard(when),
            content,
          },
        });
      }
    }
    rows.push({
      tbl: "decks",
      id: deck.id,
      data: {
        ...deck,
        notes: [...(deck.notes ?? []), ...noteIds],
        cards: [...(deck.cards ?? []), ...cardIds],
      },
    });
    await putRows(ctx, rows);
    return {
      notes_added: noteIds.length,
      added: cardIds.length,
      card_ids: cardIds,
    };
  },
};

const edit_card: Tool = {
  name: "edit_card",
  write: true,
  description: `Edit a card's note, its tags, or suspend/unsuspend it. Only the fields you pass change. Fields by card type:
- basic: front, back.
- cloze: text (the full new text with {{c1::...}} parts). A new number gets a new card; a number you remove keeps its card, so suspend that card.
- multiple_choice: question, choices with correct (send both together), explanation.
- list: front, items, ordered.
- image_occlusion: header, hide_all, image or image_url (replaces the picture), and areas. Areas are added or moved: an area with an id (see the card's fields) moves that area, one without an id is new. Areas you leave out stay.
Any card also takes tags (replaces the note's tag list) and suspended.`,
  inputSchema: {
    type: "object",
    properties: {
      card_id: { type: "string" },
      front: { type: "string" },
      back: { type: "string" },
      text: { type: "string" },
      question: { type: "string" },
      choices: { type: "array", items: { type: "string" } },
      correct: {
        oneOf: [
          { type: "integer" },
          { type: "array", items: { type: "integer" } },
        ],
      },
      explanation: { type: "string" },
      items: { type: "array", items: { type: "string" } },
      ordered: { type: "boolean" },
      header: { type: "string" },
      hide_all: { type: "boolean" },
      image: { type: "string" },
      image_url: { type: "string" },
      areas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
          },
          required: ["x", "y", "w", "h"],
        },
      },
      tags: { type: "array", items: { type: "string" } },
      suspended: { type: "boolean" },
    },
    required: ["card_id"],
  },
  async run(ctx, a) {
    const card = need(
      await one(ctx, "cards", str(a, "card_id") ?? ""),
      "card not found"
    );
    const note = need(await one(ctx, "notes", card.note), "note not found");
    const rows: WriteRow[] = [];
    let nextNote: Row | undefined;
    let added = 0;

    if (hasContentEdit(a)) {
      const siblings = (await load(ctx.db, ctx.userId, "cards")).filter(
        (c) => c.note === note.id
      );
      const edit = await editNote(
        note.content ?? {},
        a,
        siblings
          .map((c) => c.content?.occlusionNumber)
          .filter((n): n is number => typeof n === "number"),
        ctx
      );
      nextNote = { ...note, content: edit.content, sortField: edit.sortField };
      if (edit.newCards.length) {
        const deck = need(await one(ctx, "decks", note.deck), "deck not found");
        const when = new Date(ctx.now);
        const ids = edit.newCards.map(() => randomUUID());
        edit.newCards.forEach((content, i) =>
          rows.push({
            tbl: "cards",
            id: ids[i],
            data: {
              id: ids[i],
              deck: deck.id,
              note: note.id,
              creationDate: when,
              model: createEmptyCard(when),
              content,
            },
          })
        );
        rows.push({
          tbl: "decks",
          id: deck.id,
          data: { ...deck, cards: [...(deck.cards ?? []), ...ids] },
        });
        added = ids.length;
      }
    }
    if (a.tags !== undefined) {
      if (!Array.isArray(a.tags)) throw new Error("tags must be an array");
      const tags = normalizeTags(a.tags.map(String));
      nextNote = {
        ...(nextNote ?? note),
        tags: tags.length ? tags : undefined,
      };
    }
    if (nextNote) rows.push({ tbl: "notes", id: note.id, data: nextNote });
    if (typeof a.suspended === "boolean")
      rows.push({
        tbl: "cards",
        id: card.id,
        data: { ...card, suspended: a.suspended },
      });
    if (!rows.length) throw new Error("nothing to change");
    await putRows(ctx, rows);
    return {
      ok: true,
      changed: [...new Set(rows.map((r) => r.tbl))],
      cards_added: added,
    };
  },
};

const grade_card: Tool = {
  name: "grade_card",
  write: true,
  description:
    "Record an answer for a card that is new or due: rating 1 Again, 2 Hard, 3 Good, 4 Easy. Schedules it with the deck's FSRS settings, exactly like the app, and logs the review.",
  inputSchema: {
    type: "object",
    properties: {
      card_id: { type: "string" },
      rating: { type: "integer", minimum: 1, maximum: 4 },
    },
    required: ["card_id", "rating"],
  },
  async run(ctx, a) {
    const rating = Number(a.rating);
    if (![1, 2, 3, 4].includes(rating))
      throw new Error("rating must be 1 to 4");
    const raw = need(
      await one(ctx, "cards", str(a, "card_id") ?? ""),
      "card not found"
    );
    const card = decode(raw) as Row;
    const now = new Date(ctx.now);
    if (card.suspended) throw new Error("card is suspended");
    if (card.buriedUntil && card.buriedUntil > ctx.now)
      throw new Error("card is buried until tomorrow");
    const model = card.model as FsrsCard;
    if (model.state === 2 && model.due.getTime() > ctx.now)
      throw new Error("card is not due yet");

    const [decks, presetRows, settings, siblings] = await Promise.all([
      load(ctx.db, ctx.userId, "decks"),
      load(ctx.db, ctx.userId, "presets"),
      load(ctx.db, ctx.userId, "settings"),
      load(ctx.db, ctx.userId, "cards"),
    ]);
    const decksById = new Map(decks.map((d) => [d.id, decode(d) as never]));
    const deck = need(decksById.get(card.deck), "deck not found") as never;
    const presets = new Map(presetRows.map((p) => [p.id, p as never]));
    const setting = <T>(key: string, d: T): T =>
      (settings.find((s) => s.key === key)?.value as T) ?? d;
    const hour = setting("#newDayStartHour", 4);
    const options = effectiveOptions(deck, presets);

    const chosen = scheduleCard(model, {
      deckOptions: options,
      exam: resolveExam(deck, decksById as never),
      cardOverride: card.fsrsOverride,
      global: {
        retention: setting("#globalScheduler_requestRetention", 0.9),
        maximumInterval: setting("#globalScheduler_maximumInterval", 36500),
        w: String(setting("#globalScheduler_w", default_w.join(",")))
          .split(",")
          .map(Number),
      },
      newDayStartHour: hour,
      now,
    })[rating as 1 | 2 | 3 | 4];

    const next: Row = { ...card, model: chosen.card };
    const rows: WriteRow[] = [];
    const logId = randomUUID();
    rows.push({
      tbl: "reviewLogs",
      id: logId,
      at: chosen.log.review.getTime(),
      data: {
        ...chosen.log,
        id: logId,
        card: card.id,
        reviewedAt: chosen.log.review.getTime(),
      },
    });

    // Same follow-ups as the app: leech handling and burying siblings.
    let leech = false;
    const threshold = options?.leechThreshold;
    if (
      threshold &&
      isLeechLapse(model.lapses, chosen.card.lapses, threshold)
    ) {
      leech = true;
      const note = await one(ctx, "notes", card.note);
      if (note)
        rows.push({
          tbl: "notes",
          id: note.id,
          data: {
            ...note,
            tags: [...new Set([...(note.tags ?? []), "leech"])],
          },
        });
      if (options?.leechAction === "suspend") next.suspended = true;
    }
    const tomorrow = addDays(logicalDayStart(now, hour), 1).getTime();
    for (const s of siblingsToBury(
      card as never,
      siblings.filter((c) => c.note === card.note) as never[],
      options ?? {}
    ) as Row[])
      rows.push({
        tbl: "cards",
        id: s.id,
        data: { ...s, buriedUntil: tomorrow },
      });

    rows.push({ tbl: "cards", id: card.id, data: next });
    await putRows(ctx, rows);
    return {
      due: chosen.card.due.getTime(),
      state: chosen.card.state,
      scheduled_days: chosen.card.scheduled_days,
      lapses: chosen.card.lapses,
      leech,
    };
  },
};

export const WRITE_TOOLS: Tool[] = [
  create_deck,
  add_cards,
  edit_card,
  grade_card,
];
