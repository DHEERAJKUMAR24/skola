import { createHash, randomUUID } from "node:crypto";
import { Rating, createEmptyCard, default_w } from "ts-fsrs";
import { effectiveOptions } from "../logic/deck/effectiveOptions";
import { normalizeTags } from "../logic/note/tagNormalize";
import { recallAfter } from "../logic/scheduling/forecast";
import { DAY_MS, addDays, logicalDayStart } from "../logic/scheduling/policy";
import { deckSchedule, formatSpan } from "../logic/scheduling/summary";
import {
  type Ctx,
  type Row,
  type Tool,
  type WriteRow,
  cardView,
  deckScope,
  decode,
  load,
  masterSections,
  ms,
  noteFieldMap,
  num,
  putRows,
  snapshot,
  str,
} from "./mcpData";
import { ManageError } from "./mcpErrors";
import { MASTER_TYPE, replanRows } from "./mcpMaster";
import { HISTORY_DAYS, pictureOmitted } from "./noteHistory";

export { ManageError };

const NEW = 0;
const MAX_IDS = 200;
const CONFIRM_HINT =
  "Nothing was deleted. Show the learner what will be removed and, only if they agree, repeat this call with the confirm_token.";

const confirmToken = (ctx: Ctx, ...parts: (string | number)[]) =>
  createHash("sha256")
    .update([ctx.userId, ...parts].join("/"))
    .digest("hex")
    .slice(0, 12);

/** Rows staged by id so one tool call writes each row once, whoever touches it. */
class Staged {
  private rows = new Map<string, WriteRow>();
  constructor(private base: Map<string, Row>) {}
  get(id: string): Row | undefined {
    return this.rows.get(id)?.data ?? this.base.get(id);
  }
  set(tbl: string, id: string, data: Row, deleted = false) {
    this.rows.set(id, { tbl, id, data, ...(deleted ? { deleted } : {}) });
  }
  list(): WriteRow[] {
    return [...this.rows.values()];
  }
}

const idList = (a: Row, key: string, max = MAX_IDS): string[] => {
  const v = a[key];
  if (
    !Array.isArray(v) ||
    !v.length ||
    v.length > max ||
    !v.every((x) => typeof x === "string" && x)
  )
    throw new ManageError(
      "invalid_argument",
      `${key} must be a list of 1 to ${max} ids`
    );
  return [...new Set(v as string[])];
};

async function cardsByIds(ctx: Ctx, ids: string[]) {
  const cards = await load(ctx.db, ctx.userId, "cards");
  const byId = new Map(cards.map((c) => [c.id, c]));
  const missing = ids.filter((i) => !byId.has(i));
  if (missing.length)
    throw new ManageError(
      "card_not_found",
      `unknown card ids: ${missing.slice(0, 5).join(", ")}`
    );
  return { all: cards, byId };
}

// ---- decks ----------------------------------------------------------------------------------

/** YYYY-MM-DD of the study day a boundary starts, read in the same local time the boundary was made in. */
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const isDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());

const get_deck: Tool = {
  name: "get_deck",
  description:
    "One deck with everything the app's deck page shows: name, description, parent, sub-deck ids, paused flag, exam date, the study preset and the settings that really apply (daily limits, retention, steps), and card counts.",
  inputSchema: {
    type: "object",
    properties: { deck_id: { type: "string" } },
    required: ["deck_id"],
  },
  async run(ctx, a) {
    const { decks, cards } = await snapshot(ctx, str(a, "deck_id"));
    const deck = decks.find((d) => d.id === str(a, "deck_id"));
    if (!deck) throw new ManageError("deck_not_found", "deck not found");
    const presets = new Map(
      (await load(ctx.db, ctx.userId, "presets")).map((p) => [p.id, p])
    );
    const eff = (effectiveOptions(deck as never, presets as never) ??
      {}) as Row;
    const own = cards.filter((c) => c.deck === deck.id);
    return {
      id: deck.id,
      name: deck.name,
      description: deck.description,
      parent_id: (deck.superDecks ?? []).slice(-1)[0] ?? null,
      sub_deck_ids: deck.subDecks ?? [],
      paused: deck.priority === "paused",
      preset_id: deck.options?.presetId ?? null,
      exam_date: deck.options?.examDate ?? null,
      exam_buffer_days: deck.options?.examBufferDays ?? 1,
      exam_ramp: deck.options?.examRamp !== false,
      settings: {
        daily_new_cards: eff.dailyNewCards,
        max_reviews_per_day: eff.maxReviewsPerDay,
        desired_retention: eff.desiredRetention,
        maximum_interval: eff.maximumInterval,
        learning_steps: eff.learningSteps,
        relearning_steps: eff.relearningSteps,
        scheduling_mode: eff.schedulingMode,
        leech_threshold: eff.leechThreshold,
        leech_action: eff.leechAction,
      },
      cards_in_deck: own.length,
      cards_with_sub_decks: cards.length,
    };
  },
};

const update_deck: Tool = {
  name: "update_deck",
  write: true,
  description:
    "Change a deck like the app's deck menu: rename (name), description, pause or resume it (paused), exam date (exam_date as YYYY-MM-DD, or null to clear) with exam_buffer_days and exam_ramp, the study preset it follows (preset_id, see list_presets; limits and retention come from the preset), and move it under another deck (parent_id, or null for the top level). Only the fields you pass change.",
  inputSchema: {
    type: "object",
    properties: {
      deck_id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      paused: { type: "boolean" },
      exam_date: { type: ["string", "null"] },
      exam_buffer_days: { type: "integer", minimum: 0, maximum: 365 },
      exam_ramp: { type: "boolean" },
      preset_id: { type: "string" },
      parent_id: { type: ["string", "null"] },
    },
    required: ["deck_id"],
  },
  async run(ctx, a) {
    const decks = await load(ctx.db, ctx.userId, "decks");
    const stage = new Staged(new Map(decks.map((d) => [d.id, d])));
    const id = str(a, "deck_id") ?? "";
    const deck = stage.get(id);
    if (!deck) throw new ManageError("deck_not_found", "deck not found");
    const next: Row = { ...deck, options: { ...deck.options } };
    const changed: string[] = [];

    if (a.name !== undefined) {
      const name = typeof a.name === "string" ? a.name.trim() : "";
      if (!name || name.length > 100)
        throw new ManageError(
          "invalid_argument",
          "name must be 1 to 100 chars"
        );
      next.name = name;
      changed.push("name");
    }
    if (a.description !== undefined) {
      if (typeof a.description !== "string" || a.description.length > 2000)
        throw new ManageError("invalid_argument", "description is too long");
      next.description = a.description.trim() || undefined;
      changed.push("description");
    }
    if (typeof a.paused === "boolean") {
      next.priority = a.paused ? "paused" : "studying";
      changed.push("paused");
    }
    if (a.exam_date !== undefined) {
      if (a.exam_date === null) next.options.examDate = undefined;
      else if (typeof a.exam_date === "string" && isDate(a.exam_date))
        next.options.examDate = a.exam_date;
      else
        throw new ManageError(
          "invalid_argument",
          "exam_date must be YYYY-MM-DD or null"
        );
      changed.push("exam_date");
    }
    if (a.exam_buffer_days !== undefined) {
      const v = Number(a.exam_buffer_days);
      if (!Number.isInteger(v) || v < 0 || v > 365)
        throw new ManageError(
          "invalid_argument",
          "exam_buffer_days must be 0 to 365"
        );
      next.options.examBufferDays = v;
      changed.push("exam_buffer_days");
    }
    if (typeof a.exam_ramp === "boolean") {
      next.options.examRamp = a.exam_ramp;
      changed.push("exam_ramp");
    }
    if (a.preset_id !== undefined) {
      const pid = str(a, "preset_id") ?? "";
      const presets = await load(ctx.db, ctx.userId, "presets");
      if (!presets.some((p) => p.id === pid))
        throw new ManageError(
          "preset_not_found",
          "unknown preset_id; call list_presets"
        );
      next.options.presetId = pid;
      changed.push("preset_id");
    }
    stage.set("decks", id, next);

    if (a.parent_id !== undefined) {
      const newParentId = a.parent_id === null ? null : str(a, "parent_id");
      const oldParentId = (deck.superDecks ?? []).slice(-1)[0] ?? null;
      if (newParentId === undefined)
        throw new ManageError(
          "invalid_argument",
          "parent_id must be a deck id or null"
        );
      if (newParentId !== oldParentId) {
        const parent = newParentId ? stage.get(newParentId) : undefined;
        if (newParentId && !parent)
          throw new ManageError("deck_not_found", "parent deck not found");
        if (newParentId === id || (parent?.superDecks ?? []).includes(id))
          throw new ManageError(
            "invalid_move",
            "a deck cannot move into itself or one of its own sub-decks"
          );
        const oldParent = oldParentId ? stage.get(oldParentId) : undefined;
        if (oldParent)
          stage.set("decks", oldParent.id, {
            ...oldParent,
            subDecks: (oldParent.subDecks ?? []).filter(
              (s: string) => s !== id
            ),
          });
        if (parent)
          stage.set("decks", parent.id, {
            ...stage.get(parent.id),
            subDecks: [...(stage.get(parent.id)?.subDecks ?? []), id],
          });
        const prefix = parent ? [...(parent.superDecks ?? []), parent.id] : [];
        const moved = stage.get(id) as Row;
        stage.set("decks", id, {
          ...moved,
          superDecks: prefix.length ? prefix : undefined,
        });
        for (const d of decks) {
          const at = (d.superDecks ?? []).indexOf(id);
          if (at < 0) continue;
          stage.set("decks", d.id, {
            ...(stage.get(d.id) as Row),
            superDecks: [...prefix, ...d.superDecks.slice(at)],
          });
        }
        changed.push("parent_id");
      }
    }
    if (!changed.length)
      throw new ManageError("nothing_to_change", "nothing to change");
    await putRows(ctx, stage.list());
    return { ok: true, changed };
  },
};

const delete_deck: Tool = {
  name: "delete_deck",
  write: true,
  destructive: true,
  description:
    "Delete a deck with its sub-decks, notes and cards (review history is kept). Two steps: call without confirm_token to see what would be deleted and get a token; ask the learner; then repeat with that confirm_token. The token only fits the exact deck contents it was made for.",
  inputSchema: {
    type: "object",
    properties: {
      deck_id: { type: "string" },
      confirm_token: { type: "string" },
    },
    required: ["deck_id"],
  },
  async run(ctx, a) {
    const id = str(a, "deck_id") ?? "";
    const [decks, cards, notes] = await Promise.all([
      load(ctx.db, ctx.userId, "decks"),
      load(ctx.db, ctx.userId, "cards"),
      load(ctx.db, ctx.userId, "notes"),
    ]);
    const deck = decks.find((d) => d.id === id);
    if (!deck) throw new ManageError("deck_not_found", "deck not found");
    const scope = deckScope(decks, id);
    const gone = {
      // Parents first, so the preview reads top down.
      decks: decks
        .filter((d) => scope.has(d.id))
        .sort(
          (x, y) =>
            (x.superDecks ?? []).length - (y.superDecks ?? []).length ||
            x.name.localeCompare(y.name)
        ),
      cards: cards.filter((c) => scope.has(c.deck)),
      notes: notes.filter((n) => scope.has(n.deck)),
    };
    const token = confirmToken(
      ctx,
      "deck",
      id,
      gone.decks.length,
      gone.cards.length,
      gone.notes.length
    );
    if (a.confirm_token !== token) {
      if (a.confirm_token !== undefined)
        throw new ManageError(
          "confirm_token_mismatch",
          `the deck changed or the token is wrong. ${CONFIRM_HINT}`
        );
      return {
        deleted: false,
        will_delete: {
          decks: gone.decks.map((d) => d.name),
          cards: gone.cards.length,
          notes: gone.notes.length,
        },
        confirm_token: token,
        message: CONFIRM_HINT,
      };
    }
    const stage = new Staged(new Map(decks.map((d) => [d.id, d])));
    for (const d of gone.decks) stage.set("decks", d.id, d, true);
    for (const c of gone.cards) stage.set("cards", c.id, c, true);
    for (const n of gone.notes) stage.set("notes", n.id, n, true);
    const parentId = (deck.superDecks ?? []).slice(-1)[0];
    const parent = parentId ? stage.get(parentId) : undefined;
    if (parent && !scope.has(parent.id))
      stage.set("decks", parent.id, {
        ...parent,
        subDecks: (parent.subDecks ?? []).filter((s: string) => s !== id),
      });
    await putRows(ctx, stage.list());
    return {
      deleted: true,
      decks: gone.decks.length,
      cards: gone.cards.length,
      notes: gone.notes.length,
    };
  },
};

// ---- presets and limits ---------------------------------------------------------------------

const PRESET_FIELDS: Record<string, (v: unknown) => unknown> = {
  new_cards_per_day: (v) => int(v, 0, 9999),
  max_reviews_per_day: (v) => int(v, 0, 99999),
  new_card_order: (v) => oneOf(v, ["created", "random"]),
  scheduling_mode: (v) => oneOf(v, ["exact", "daily"]),
  desired_retention: (v) => {
    const n = Number(v);
    if (!(n >= 0.7 && n <= 0.99)) throw bad("desired_retention is 0.7 to 0.99");
    return n;
  },
  maximum_interval: (v) => int(v, 1, 36500),
  enable_fuzz: (v) => bool(v),
  learning_steps: (v) => steps(v),
  relearning_steps: (v) => steps(v),
  easy_days: (v) => {
    if (
      !Array.isArray(v) ||
      !v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    )
      throw bad("easy_days is a list of weekdays 0 (Sunday) to 6");
    return [...new Set(v as number[])];
  },
  bury_new_siblings: (v) => bool(v),
  bury_review_siblings: (v) => bool(v),
  leech_threshold: (v) => int(v, 0, 100),
  leech_action: (v) => oneOf(v, ["suspend", "tag"]),
};
const PRESET_KEYS: Record<string, string> = {
  new_cards_per_day: "newCardsPerDay",
  max_reviews_per_day: "maxReviewsPerDay",
  new_card_order: "newCardOrder",
  scheduling_mode: "schedulingMode",
  desired_retention: "desiredRetention",
  maximum_interval: "maximumInterval",
  enable_fuzz: "enableFuzz",
  learning_steps: "learningSteps",
  relearning_steps: "relearningSteps",
  easy_days: "easyDays",
  bury_new_siblings: "buryNewSiblings",
  bury_review_siblings: "buryReviewSiblings",
  leech_threshold: "leechThreshold",
  leech_action: "leechAction",
};
const bad = (m: string) => new ManageError("invalid_argument", m);
function int(v: unknown, min: number, max: number) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max)
    throw bad(`must be a whole number from ${min} to ${max}`);
  return n;
}
function bool(v: unknown) {
  if (typeof v !== "boolean") throw bad("must be true or false");
  return v;
}
function oneOf(v: unknown, list: string[]) {
  if (typeof v !== "string" || !list.includes(v))
    throw bad(`must be one of ${list.join(", ")}`);
  return v;
}
function steps(v: unknown) {
  if (
    !Array.isArray(v) ||
    v.length > 10 ||
    !v.every((s) => typeof s === "string" && /^\d+(\.\d+)?[mhd]$/.test(s))
  )
    throw bad('steps are a list like ["1m", "10m", "1h", "1d"]');
  return v as string[];
}

const list_presets: Tool = {
  name: "list_presets",
  description:
    "Study presets (the settings decks share): daily new and review limits, learning steps, retention, scheduling mode, easy days, sibling burying and leech handling, with the decks that use each.",
  inputSchema: { type: "object", properties: {} },
  async run(ctx) {
    const [presets, decks] = await Promise.all([
      load(ctx.db, ctx.userId, "presets"),
      load(ctx.db, ctx.userId, "decks"),
    ]);
    return presets.map((p) => ({
      id: p.id,
      name: p.name,
      new_cards_per_day: p.newCardsPerDay,
      max_reviews_per_day: p.maxReviewsPerDay,
      new_card_order: p.newCardOrder,
      scheduling_mode: p.schedulingMode,
      desired_retention: p.desiredRetention,
      maximum_interval: p.maximumInterval,
      enable_fuzz: p.enableFuzz,
      learning_steps: p.learningSteps,
      relearning_steps: p.relearningSteps,
      easy_days: p.easyDays,
      bury_new_siblings: p.buryNewSiblings,
      bury_review_siblings: p.buryReviewSiblings,
      leech_threshold: p.leechThreshold,
      leech_action: p.leechAction,
      personal_weights: !!p.weights?.length,
      decks: decks
        .filter((d) => d.options?.presetId === p.id)
        .map((d) => d.name),
    }));
  },
};

const update_preset: Tool = {
  name: "update_preset",
  write: true,
  description:
    "Change a study preset: daily limits (new_cards_per_day, max_reviews_per_day), new_card_order, scheduling_mode, desired_retention (0.7 to 0.99), maximum_interval, enable_fuzz, learning_steps, relearning_steps, easy_days, bury_new_siblings, bury_review_siblings, leech_threshold, leech_action. Every deck that follows the preset changes with it. Only the fields you pass change.",
  inputSchema: {
    type: "object",
    properties: {
      preset_id: { type: "string" },
      ...Object.fromEntries(Object.keys(PRESET_FIELDS).map((k) => [k, {}])),
    },
    required: ["preset_id"],
  },
  async run(ctx, a) {
    const presets = await load(ctx.db, ctx.userId, "presets");
    const preset = presets.find((p) => p.id === str(a, "preset_id"));
    if (!preset)
      throw new ManageError(
        "preset_not_found",
        "unknown preset_id; call list_presets"
      );
    const next: Row = { ...preset };
    const changed: string[] = [];
    for (const [k, check] of Object.entries(PRESET_FIELDS)) {
      if (a[k] === undefined) continue;
      try {
        next[PRESET_KEYS[k]] = check(a[k]);
      } catch (e) {
        throw bad(`${k} ${(e as Error).message.replace(/^\[\w+\] /, "")}`);
      }
      changed.push(k);
    }
    if (!changed.length)
      throw new ManageError("nothing_to_change", "nothing to change");
    await putRows(ctx, [{ tbl: "presets", id: preset.id, data: next }]);
    return { ok: true, changed };
  },
};

// ---- listing, tags, details, schedule -------------------------------------------------------

const STATUS = ["new", "learning", "review", "due", "suspended", "buried"];

const list_cards: Tool = {
  name: "list_cards",
  description: `List cards page by page, like the app's notes explorer. Filters: deck_id (with sub-decks), tag, status (${STATUS.join(", ")}), query (text or tag contains). limit default 50, max 100; offset to continue (next_offset is null on the last page). Each card has fields, state, due, tags and note_id.`,
  inputSchema: {
    type: "object",
    properties: {
      deck_id: { type: "string" },
      tag: { type: "string" },
      status: { type: "string", enum: STATUS },
      query: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    },
  },
  async run(ctx, a) {
    const status = str(a, "status");
    if (status && !STATUS.includes(status))
      throw bad(`status must be one of ${STATUS.join(", ")}`);
    const tag = str(a, "tag")?.toLowerCase();
    const q = str(a, "query")?.toLowerCase();
    const { cards, notes } = await snapshot(ctx, str(a, "deck_id"));
    const matches = cards
      .filter((c) => {
        const n = notes.get(c.note);
        if (!n) return false;
        if (tag && !(n.tags ?? []).some((t: string) => t.toLowerCase() === tag))
          return false;
        if (q) {
          const hay = JSON.stringify([n.content, n.tags]).toLowerCase();
          if (!hay.includes(q)) return false;
        }
        const st = c.model?.state;
        switch (status) {
          case "new":
            return st === NEW;
          case "learning":
            return st === 1 || st === 3;
          case "review":
            return st === 2;
          case "due":
            return st !== NEW && ms(c.model?.due) <= ctx.now;
          case "suspended":
            return !!c.suspended;
          case "buried":
            return !!c.buriedUntil && c.buriedUntil > ctx.now;
          default:
            return true;
        }
      })
      .sort(
        (x, y) =>
          ms(x.creationDate) - ms(y.creationDate) || x.id.localeCompare(y.id)
      );
    const offset = Math.max(0, Number(a.offset) || 0);
    const limit = num(a, "limit", 50, 100);
    const page = matches.slice(offset, offset + limit);
    return {
      total: matches.length,
      offset,
      next_offset: offset + limit < matches.length ? offset + limit : null,
      cards: page.map((c) => ({
        ...cardView(c, notes),
        note_id: c.note,
        tags: notes.get(c.note)?.tags ?? [],
        buried: !!c.buriedUntil && c.buriedUntil > ctx.now,
      })),
    };
  },
};

const list_tags: Tool = {
  name: "list_tags",
  description:
    "All tags with the number of notes that carry each, most used first. Optional deck_id (with sub-decks).",
  inputSchema: { type: "object", properties: { deck_id: { type: "string" } } },
  async run(ctx, a) {
    const { decks } = await snapshot(ctx, str(a, "deck_id"));
    const scope = deckScope(decks, str(a, "deck_id"));
    const notes = await load(ctx.db, ctx.userId, "notes");
    const count = new Map<string, number>();
    for (const n of notes)
      if (scope.has(n.deck))
        for (const t of n.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .map(([tag, notes]) => ({ tag, notes }));
  },
};

export async function settingsOf(ctx: Ctx) {
  const settings = await load(ctx.db, ctx.userId, "settings");
  const setting = <T>(key: string, d: T): T =>
    (settings.find((s) => s.key === key)?.value as T) ?? d;
  return {
    hour: setting("#newDayStartHour", 4),
    w: String(setting("#globalScheduler_w", default_w.join(",")))
      .split(",")
      .map(Number),
  };
}

const get_card_details: Tool = {
  name: "get_card_details",
  description:
    "Everything the app's View details shows for one card: state, due date, scheduled days, stability, difficulty, recall chance now, reps, lapses, suspended or buried, per-card retention override, tags, and the last 30 reviews (rating, time, interval).",
  inputSchema: {
    type: "object",
    properties: { card_id: { type: "string" } },
    required: ["card_id"],
  },
  async run(ctx, a) {
    const id = str(a, "card_id") ?? "";
    const { byId } = await cardsByIds(ctx, [id]);
    const c = byId.get(id) as Row;
    const notes = await load(ctx.db, ctx.userId, "notes");
    const note = notes.find((n) => n.id === c.note);
    const m = c.model ?? {};
    const { w } = await settingsOf(ctx);
    const last = ms(m.last_review);
    const { rows: logs } = await ctx.db.query<{ data: Row }>(
      `SELECT data FROM changes WHERE user_id = $1 AND tbl = 'reviewLogs' AND NOT deleted
         AND data->>'card' = $2 ORDER BY updated_at DESC LIMIT 30`,
      [ctx.userId, id]
    );
    const NAMES = ["manual", "again", "hard", "good", "easy"];
    return {
      card_id: id,
      deck: c.deck,
      note_id: c.note,
      type: note?.content?.type,
      ...(note?.content?.type === MASTER_TYPE
        ? {
            master: {
              master_id: note.id,
              title: note.content.title,
              section_id: c.content?.sectionId ?? null,
              retired: !!c.content?.retired,
              hint: "Use get_master_card, master_coverage and update_master_card.",
            },
          }
        : {}),
      tags: note?.tags ?? [],
      state: m.state,
      due: m.state === NEW ? null : ms(m.due),
      due_in:
        m.state === NEW ? null : formatSpan(Math.abs(ms(m.due) - ctx.now)),
      overdue: m.state !== NEW && ms(m.due) < ctx.now,
      scheduled_days: m.scheduled_days,
      stability: m.stability,
      difficulty: m.difficulty,
      recall_now:
        m.state === NEW || !last
          ? null
          : recallAfter(m.stability, (ctx.now - last) / DAY_MS, w),
      reps: m.reps,
      lapses: m.lapses,
      last_review: last || null,
      suspended: !!c.suspended,
      buried_until: c.buriedUntil ?? null,
      retention_override: c.fsrsOverride ?? null,
      reviews: logs.map(({ data: l }) => ({
        at: l.reviewedAt ?? ms(l.review),
        rating: NAMES[l.rating] ?? l.rating,
        state: l.state,
        scheduled_days: l.scheduled_days,
        due_after: ms(l.due) || null,
      })),
    };
  },
};

const deck_schedule: Tool = {
  name: "deck_schedule",
  description:
    "The schedule view of the app: cards overdue, due on each of the next days (default 7, max 30), due later, studied and new counts, mature cards, average stability, difficulty and recall chance, and lapses. Optional deck_id (with sub-decks); suspended cards are left out of the due counts.",
  inputSchema: {
    type: "object",
    properties: { deck_id: { type: "string" }, days: { type: "integer" } },
  },
  async run(ctx, a) {
    const { cards } = await snapshot(ctx, str(a, "deck_id"));
    const { hour, w } = await settingsOf(ctx);
    const days = num(a, "days", 7, 30);
    const s = deckSchedule(
      cards.map((c) => decode(c) as never),
      new Date(ctx.now),
      hour,
      w,
      days
    );
    const today = logicalDayStart(new Date(ctx.now), hour);
    return {
      ...s,
      days: s.perDay.map((n, i) => ({
        date: localDate(addDays(today, i)),
        due: n,
      })),
    };
  },
};

// ---- changing cards -------------------------------------------------------------------------

const set_card_schedule: Tool = {
  name: "set_card_schedule",
  write: true,
  description: `Change one card's schedule by hand, like the app's card scheduling dialog. action:
- bury: hide until tomorrow's study day (or until the date in until, YYYY-MM-DD).
- unbury: show a buried card again.
- set_due: move the due date to due (YYYY-MM-DD or ISO time). Not for new cards. Memory (stability, difficulty) is unchanged; a Manual entry is added to the history.
- reset: turn the card back into a brand-new card (history is kept, with a Manual entry). Destructive: confirm with the learner first.
- set_override: give this card its own desired_retention (0.7 to 0.99) and/or maximum_interval (days); send null for both to return to the deck's settings.
Suspend and unsuspend are done with edit_card.`,
  inputSchema: {
    type: "object",
    properties: {
      card_id: { type: "string" },
      action: {
        type: "string",
        enum: ["bury", "unbury", "set_due", "reset", "set_override"],
      },
      until: { type: "string" },
      due: { type: "string" },
      desired_retention: { type: ["number", "null"] },
      maximum_interval: { type: ["integer", "null"] },
    },
    required: ["card_id", "action"],
  },
  destructive: true,
  async run(ctx, a) {
    const id = str(a, "card_id") ?? "";
    const { byId } = await cardsByIds(ctx, [id]);
    const card = decode(byId.get(id)) as Row;
    const now = new Date(ctx.now);
    const rows: WriteRow[] = [];
    const manual = (model: Row) => {
      const logId = randomUUID();
      rows.push({
        tbl: "reviewLogs",
        id: logId,
        at: ctx.now,
        data: {
          id: logId,
          card: id,
          rating: Rating.Manual,
          state: model.state,
          due: model.due,
          stability: model.stability,
          difficulty: model.difficulty,
          elapsed_days: 0,
          last_elapsed_days: 0,
          scheduled_days: model.scheduled_days,
          learning_steps: model.learning_steps ?? 0,
          review: now,
          reviewedAt: ctx.now,
        },
      });
    };
    let result: Row = {};
    switch (a.action) {
      case "bury": {
        let until: number;
        if (a.until !== undefined) {
          if (typeof a.until !== "string" || !isDate(a.until))
            throw bad("until must be YYYY-MM-DD");
          until = new Date(`${a.until}T00:00:00`).getTime();
          if (until <= ctx.now) throw bad("until must be in the future");
        } else {
          const { hour } = await settingsOf(ctx);
          until = addDays(logicalDayStart(now, hour), 1).getTime();
        }
        rows.push({ tbl: "cards", id, data: { ...card, buriedUntil: until } });
        result = { buried_until: until };
        break;
      }
      case "unbury":
        rows.push({
          tbl: "cards",
          id,
          data: { ...card, buriedUntil: undefined },
        });
        break;
      case "set_due": {
        if (card.model.state === NEW)
          throw new ManageError(
            "new_card",
            "a new card has no schedule yet; study it first"
          );
        const due = new Date(String(a.due ?? ""));
        if (Number.isNaN(due.getTime()))
          throw bad("due must be YYYY-MM-DD or an ISO time");
        manual(card.model);
        const model = {
          ...card.model,
          due,
          scheduled_days: Math.max(
            0,
            Math.round((due.getTime() - ctx.now) / DAY_MS)
          ),
        };
        rows.push({ tbl: "cards", id, data: { ...card, model } });
        result = { due: due.getTime(), scheduled_days: model.scheduled_days };
        break;
      }
      case "reset":
        manual(card.model);
        rows.push({
          tbl: "cards",
          id,
          data: { ...card, model: createEmptyCard(now) },
        });
        break;
      case "set_override": {
        const o: Row = {};
        const r = a.desired_retention;
        const mi = a.maximum_interval;
        if (r !== undefined && r !== null) {
          if (!(Number(r) >= 0.7 && Number(r) <= 0.99))
            throw bad("desired_retention is 0.7 to 0.99");
          o.desiredRetention = Number(r);
        }
        if (mi !== undefined && mi !== null) {
          if (
            !Number.isInteger(mi) ||
            (mi as number) < 1 ||
            (mi as number) > 36500
          )
            throw bad("maximum_interval is whole days from 1 to 36500");
          o.maximumInterval = mi;
        }
        const clearing = r === null && mi === null;
        if (!clearing && !Object.keys(o).length)
          throw bad(
            "give desired_retention and/or maximum_interval, or null for both"
          );
        rows.push({
          tbl: "cards",
          id,
          data: { ...card, fsrsOverride: clearing ? undefined : o },
        });
        result = { retention_override: clearing ? null : o };
        break;
      }
      default:
        throw bad("unknown action");
    }
    await putRows(ctx, rows);
    return { ok: true, action: a.action, ...result };
  },
};

const move_cards: Tool = {
  name: "move_cards",
  write: true,
  description:
    "Move cards to another deck. Like the app, the whole note moves, so sibling cards (other clozes or sides of the same note) go along. Schedules and history are kept. Up to 200 card_ids.",
  inputSchema: {
    type: "object",
    properties: {
      card_ids: { type: "array", items: { type: "string" } },
      deck_id: { type: "string" },
    },
    required: ["card_ids", "deck_id"],
  },
  async run(ctx, a) {
    const ids = idList(a, "card_ids");
    const [decks, notes, { all, byId }] = await Promise.all([
      load(ctx.db, ctx.userId, "decks"),
      load(ctx.db, ctx.userId, "notes"),
      cardsByIds(ctx, ids),
    ]);
    const target = decks.find((d) => d.id === str(a, "deck_id"));
    if (!target)
      throw new ManageError("deck_not_found", "target deck not found");
    const noteIds = new Set(ids.map((i) => (byId.get(i) as Row).note));
    const moving = all.filter(
      (c) => noteIds.has(c.note) && c.deck !== target.id
    );
    const stage = new Staged(new Map(decks.map((d) => [d.id, d])));
    const movedNotes = new Set<string>();
    for (const c of moving) {
      const from = stage.get(c.deck);
      if (from)
        stage.set("decks", from.id, {
          ...from,
          cards: (from.cards ?? []).filter((x: string) => x !== c.id),
          notes: movedNotes.has(c.note)
            ? from.notes
            : (from.notes ?? []).filter((x: string) => x !== c.note),
        });
      stage.set("cards", c.id, { ...c, deck: target.id });
      movedNotes.add(c.note);
    }
    const to = stage.get(target.id) as Row;
    stage.set("decks", target.id, {
      ...to,
      cards: [...(to.cards ?? []), ...moving.map((c) => c.id)],
      notes: [...(to.notes ?? []), ...movedNotes],
    });
    for (const n of notes)
      if (movedNotes.has(n.id))
        stage.set("notes", n.id, { ...n, deck: target.id });
    if (!moving.length) return { moved: 0, notes: 0 };
    await putRows(ctx, stage.list());
    return { moved: moving.length, notes: movedNotes.size };
  },
};

const delete_cards: Tool = {
  name: "delete_cards",
  write: true,
  destructive: true,
  description:
    "Delete cards (up to 200 card_ids). A note whose last card is deleted is deleted too. Review history is kept. Two steps: call without confirm_token to see what would go and get a token; ask the learner; then repeat with that confirm_token.",
  inputSchema: {
    type: "object",
    properties: {
      card_ids: { type: "array", items: { type: "string" } },
      confirm_token: { type: "string" },
    },
    required: ["card_ids"],
  },
  async run(ctx, a) {
    const ids = idList(a, "card_ids").sort();
    const [decks, notes, { all, byId }] = await Promise.all([
      load(ctx.db, ctx.userId, "decks"),
      load(ctx.db, ctx.userId, "notes"),
      cardsByIds(ctx, ids),
    ]);
    const gone = new Set(ids);
    const noteIds = new Set(ids.map((i) => (byId.get(i) as Row).note));
    // A master's study cards follow its sections; deleting one by hand would only be undone.
    const masterNotes = new Map(
      notes.filter((n) => n.content?.type === MASTER_TYPE).map((n) => [n.id, n])
    );
    const own = ids.filter((i) => masterNotes.has((byId.get(i) as Row).note));
    if (own.length)
      throw new ManageError(
        "master_card",
        `${own.slice(0, 5).join(", ")} ${own.length === 1 ? "is a study card" : "are study cards"} of a master card. Use delete_master_card to delete the master, or update_master_card to change its sections.`
      );
    const emptied = [...noteIds].filter(
      (n) => !all.some((c) => c.note === n && !gone.has(c.id))
    );
    const token = confirmToken(ctx, "cards", ...ids);
    if (a.confirm_token !== token) {
      if (a.confirm_token !== undefined)
        throw new ManageError(
          "confirm_token_mismatch",
          `the token does not match these cards. ${CONFIRM_HINT}`
        );
      const nmap = new Map(notes.map((n) => [n.id, n]));
      return {
        deleted: false,
        will_delete: {
          cards: ids.length,
          notes: emptied.length,
          // Entries of master cards that point at these cards will dangle afterwards.
          linked_from_masters: [...masterNotes.values()].flatMap((m) => {
            const n = masterSections(m.content).reduce(
              (t, s) =>
                t +
                s.entries.filter((e) => e.cardId && gone.has(e.cardId)).length,
              0
            );
            return n
              ? [{ master_id: m.id, title: m.content.title, entries: n }]
              : [];
          }),
          examples: ids.slice(0, 5).map((i) => {
            const n = nmap.get((byId.get(i) as Row).note);
            return {
              card_id: i,
              text: JSON.stringify(n?.content ?? {}).slice(0, 120),
            };
          }),
        },
        confirm_token: token,
        message: CONFIRM_HINT,
      };
    }
    const stage = new Staged(new Map(decks.map((d) => [d.id, d])));
    for (const i of ids) {
      const c = byId.get(i) as Row;
      stage.set("cards", i, c, true);
      const d = stage.get(c.deck);
      if (d)
        stage.set("decks", d.id, {
          ...d,
          cards: (d.cards ?? []).filter((x: string) => x !== i),
        });
    }
    for (const nid of emptied) {
      const n = notes.find((x) => x.id === nid);
      if (!n) continue;
      stage.set("notes", nid, n, true);
      const d = stage.get(n.deck);
      if (d)
        stage.set("decks", d.id, {
          ...d,
          notes: (d.notes ?? []).filter((x: string) => x !== nid),
        });
    }
    await putRows(ctx, stage.list());
    return { deleted: true, cards: ids.length, notes: emptied.length };
  },
};

const bulk_update_cards: Tool = {
  name: "bulk_update_cards",
  write: true,
  description:
    "Change many cards at once, like the notes explorer's bulk bar (up to 200 card_ids): add_tags, remove_tags (note tags, shared by sibling cards) and suspended (true or false).",
  inputSchema: {
    type: "object",
    properties: {
      card_ids: { type: "array", items: { type: "string" } },
      add_tags: { type: "array", items: { type: "string" } },
      remove_tags: { type: "array", items: { type: "string" } },
      suspended: { type: "boolean" },
    },
    required: ["card_ids"],
  },
  async run(ctx, a) {
    const ids = idList(a, "card_ids");
    const add = Array.isArray(a.add_tags)
      ? normalizeTags(a.add_tags.map(String))
      : [];
    const remove = Array.isArray(a.remove_tags)
      ? normalizeTags(a.remove_tags.map(String))
      : [];
    const susp = typeof a.suspended === "boolean" ? a.suspended : undefined;
    if (!add.length && !remove.length && susp === undefined)
      throw new ManageError("nothing_to_change", "nothing to change");
    const [notes, { byId }] = await Promise.all([
      load(ctx.db, ctx.userId, "notes"),
      cardsByIds(ctx, ids),
    ]);
    const rows: WriteRow[] = [];
    const noteIds = new Set<string>();
    for (const i of ids) {
      const c = byId.get(i) as Row;
      noteIds.add(c.note);
      if (susp !== undefined && !!c.suspended !== susp)
        rows.push({ tbl: "cards", id: i, data: { ...c, suspended: susp } });
    }
    if (add.length || remove.length)
      for (const n of notes) {
        if (!noteIds.has(n.id)) continue;
        const tags = [...new Set([...(n.tags ?? []), ...add])].filter(
          (t) => !remove.includes(t)
        );
        rows.push({
          tbl: "notes",
          id: n.id,
          data: { ...n, tags: tags.length ? tags : undefined },
        });
      }
    if (rows.length) await putRows(ctx, rows);
    return {
      ok: true,
      cards: ids.length,
      notes_changed: rows.filter((r) => r.tbl === "notes").length,
    };
  },
};

// ---- edit history ---------------------------------------------------------------------------

const card_history: Tool = {
  name: "card_history",
  description: `The earlier versions of a card's note from the last ${HISTORY_DAYS} days, newest first (each is the content before an edit). A note that was last edited longer ago still shows its previous version. Edits made in the app and over MCP are both kept. Inline pictures are not kept. Use restore_card_version with a version_id to go back.`,
  inputSchema: {
    type: "object",
    properties: { card_id: { type: "string" } },
    required: ["card_id"],
  },
  async run(ctx, a) {
    const id = str(a, "card_id") ?? "";
    const { byId } = await cardsByIds(ctx, [id]);
    const noteId = (byId.get(id) as Row).note;
    const { rows } = await ctx.db.query<Row>(
      `SELECT id, content, tags, replaced_at FROM note_versions
       WHERE user_id = $1 AND note_id = $2 ORDER BY replaced_at DESC`,
      [ctx.userId, noteId]
    );
    // The app's History view compares each version with the text as stored now.
    const now = (await load(ctx.db, ctx.userId, "notes")).find(
      (n) => n.id === noteId
    );
    return {
      note_id: noteId,
      keeps_days: HISTORY_DAYS,
      current: now ? { fields: noteFieldMap(now), tags: now.tags ?? [] } : null,
      versions: rows.map((v) => ({
        version_id: v.id,
        replaced_at: Number(v.replaced_at),
        fields: noteFieldMap({ content: v.content }),
        tags: v.tags,
      })),
    };
  },
};

const restore_card_version: Tool = {
  name: "restore_card_version",
  write: true,
  description:
    "Put a card's note back to an earlier version from card_history. The current text is saved as a new version first, so the restore can be undone. Only the note text and tags change: schedules and review history are untouched, and cards are not added or removed (a restored cloze with different numbers does not create cards).",
  inputSchema: {
    type: "object",
    properties: { card_id: { type: "string" }, version_id: { type: "string" } },
    required: ["card_id", "version_id"],
  },
  async run(ctx, a) {
    const id = str(a, "card_id") ?? "";
    const { byId } = await cardsByIds(ctx, [id]);
    const noteId = (byId.get(id) as Row).note;
    const notes = await load(ctx.db, ctx.userId, "notes");
    const note = notes.find((n) => n.id === noteId);
    if (!note)
      throw new ManageError("card_not_found", "the note of that card is gone");
    const { rows } = await ctx.db.query<Row>(
      `SELECT content, tags, sort_field FROM note_versions
       WHERE user_id = $1 AND note_id = $2 AND id = $3`,
      [ctx.userId, noteId, str(a, "version_id") ?? ""]
    );
    const v = rows[0];
    if (!v)
      throw new ManageError(
        "version_not_found",
        "no such version for this card; call card_history (versions older than 7 days are gone)"
      );
    const content = { ...v.content };
    if (pictureOmitted(content)) content.image = note.content?.image;
    const restored = {
      ...note,
      content,
      tags: v.tags?.length ? v.tags : undefined,
      sortField: v.sort_field ?? note.sortField,
    };
    // A master's study cards follow its sections: bring them in step with the restored text.
    const extra =
      content.type === MASTER_TYPE
        ? replanRows(
            restored,
            await load(ctx.db, ctx.userId, "cards"),
            (await load(ctx.db, ctx.userId, "decks")).find(
              (d) => d.id === note.deck
            ),
            ctx.now
          )
        : [];
    await putRows(ctx, [
      { tbl: "notes", id: noteId, data: restored },
      ...extra,
    ]);
    return {
      ok: true,
      note_id: noteId,
      restored: str(a, "version_id"),
      ...(extra.length ? { study_cards_adjusted: extra.length } : {}),
    };
  },
};

export const MANAGE_TOOLS: Tool[] = [
  card_history,
  restore_card_version,
  get_deck,
  update_deck,
  delete_deck,
  list_presets,
  update_preset,
  list_cards,
  list_tags,
  get_card_details,
  deck_schedule,
  set_card_schedule,
  move_cards,
  delete_cards,
  bulk_update_cards,
];
