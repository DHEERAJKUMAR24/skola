import { createHash, randomUUID } from "node:crypto";
import {
  type Ctx,
  type Row,
  type Tool,
  ms,
  noteFieldMap,
  snapshot,
  str,
  studyable,
} from "./mcpData";
import { gradeCard } from "./mcpWrite";

const NEW = 0;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const DEFAULT_NEW = 5;

/** `[code] message` so a client can branch on the code and show the text. */
class StudyError extends Error {
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
  }
}

interface Sess {
  id: string;
  deck_id: string | null;
  card_limit: number;
  new_limit: number;
  /** Cards the learner skipped; they are not offered again in this session. */
  seen: string[];
  new_served: number;
  current_card_id: string | null;
  turn: number;
  phase: "asked" | "revealed" | "grading";
  pending_rating: number | null;
  reviewed: number;
  skipped: number;
  ratings: Record<string, number>;
  last_review: LastReview | null;
  started_at: number;
  updated_at: number;
  expires_at: number;
  ended_at: number | null;
}

interface LastReview {
  turn: number;
  card_id: string;
  rating: number;
  result: Record<string, unknown>;
}

const toSess = (r: Row): Sess => ({
  ...(r as Sess),
  started_at: Number(r.started_at),
  updated_at: Number(r.updated_at),
  expires_at: Number(r.expires_at),
  ended_at: r.ended_at === null ? null : Number(r.ended_at),
});

async function loadSession(
  ctx: Ctx,
  id: string | undefined,
  allow: { ended?: boolean; expired?: boolean } = {}
): Promise<Sess> {
  if (!id) throw new StudyError("session_not_found", "session_id is required");
  const { rows } = await ctx.db.query<Row>(
    "SELECT * FROM mcp_study_sessions WHERE user_id = $1 AND id = $2",
    [ctx.userId, id]
  );
  if (!rows[0])
    throw new StudyError("session_not_found", `no study session ${id}`);
  const s = toSess(rows[0]);
  if (!allow.ended && s.ended_at !== null)
    throw new StudyError(
      "session_ended",
      "this session is over; call start_study_session for a new one"
    );
  if (!allow.expired && s.ended_at === null && s.expires_at < ctx.now)
    throw new StudyError(
      "session_expired",
      "this session timed out after 2 hours without activity; call start_study_session again (nothing graded is lost)"
    );
  return s;
}

async function cardAndNote(ctx: Ctx, cardId: string) {
  const { rows } = await ctx.db.query<{ tbl: string; data: Row }>(
    "SELECT tbl, data FROM changes WHERE user_id = $1 AND NOT deleted AND tbl IN ('cards', 'notes') AND id = $2",
    [ctx.userId, cardId]
  );
  const card = rows.find((r) => r.tbl === "cards")?.data;
  if (!card)
    throw new StudyError(
      "card_unavailable",
      "that card no longer exists; call next_card with skip true"
    );
  const { rows: n } = await ctx.db.query<{ data: Row }>(
    "SELECT data FROM changes WHERE user_id = $1 AND tbl = 'notes' AND id = $2 AND NOT deleted",
    [ctx.userId, card.note]
  );
  if (!n[0])
    throw new StudyError(
      "card_unavailable",
      "the note of that card is gone; call next_card with skip true"
    );
  return { card, note: n[0].data };
}

// ---- what the learner may see before and after the answer -----------------------------------

const plain = (v: string) =>
  v
    .replace(/<\/p>\s*<p>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .trim();
const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

function questionOf(card: Row, note: Row): Record<string, unknown> {
  const c = note.content ?? {};
  switch (c.type) {
    case "cloze": {
      const target = card.content?.occlusionNumber;
      const text = String(c.text ?? "").replace(
        CLOZE,
        (_m, n: string, ans: string, hint?: string) =>
          Number(n) === target ? `[${hint ?? "..."}]` : ans
      );
      return { text: plain(text) };
    }
    case "multipleChoice":
      return {
        question: plain(String(c.question ?? "")),
        choices: (c.choices ?? []).map((x: Row) => String(x.text ?? "")),
        multiple_answers:
          (c.choices ?? []).filter((x: Row) => x.correct).length > 1,
      };
    case "list":
      return {
        front: plain(String(c.front ?? "")),
        items_to_recall: (c.items ?? []).length,
        ordered: !!c.ordered,
      };
    case "imageOcclusion":
      return {
        header: c.header ? plain(String(c.header)) : undefined,
        picture: "call get_card_image with this card_id to see the picture",
      };
    default:
      return { front: plain(String(c.front ?? "")) };
  }
}

function answerOf(card: Row, note: Row): Record<string, unknown> {
  const c = note.content ?? {};
  if (c.type === "cloze") {
    const target = card.content?.occlusionNumber;
    const text = String(c.text ?? "").replace(
      CLOZE,
      (_m, n: string, ans: string) => (Number(n) === target ? `«${ans}»` : ans)
    );
    return { text: plain(text) };
  }
  const f = noteFieldMap(note);
  if (c.type === "normal") return { back: f.back, front: f.front };
  return f;
}

async function present(ctx: Ctx, s: Sess, card: Row | null) {
  const progress = {
    reviewed: s.reviewed,
    skipped: s.skipped,
    limit: s.card_limit,
  };
  if (!card) return { done: true, ...(await emptyReason(ctx, s)), progress };
  const { note } = await cardAndNote(ctx, card.id);
  return {
    done: false,
    turn: s.turn,
    card_id: card.id,
    type: note.content?.type,
    is_new: card.model?.state === NEW,
    question: questionOf(card, note),
    progress,
    next_step:
      "Ask the learner this question and wait for THEIR answer. Then call show_answer, judge the real answer, and call submit_review with card_id and a rating from 1 to 4.",
  };
}

async function emptyReason(ctx: Ctx, s: Sess) {
  if (s.reviewed + s.skipped >= s.card_limit)
    return {
      reason: "limit_reached",
      message: `The ${s.card_limit} card limit of this session is reached. Call end_session.`,
    };
  const { cards } = await snapshot(ctx, s.deck_id ?? undefined);
  const upcoming = cards
    .filter((c) => studyable(c, ctx.now) && c.model?.state !== NEW)
    .map((c) => ms(c.model?.due))
    .filter((d) => d > ctx.now)
    .sort((a, b) => a - b);
  return upcoming.length
    ? {
        reason: "nothing_due_now",
        next_due: upcoming[0],
        message:
          "Nothing is due right now. Call end_session, or next_card after next_due.",
      }
    : {
        reason: "no_cards",
        message: "No cards to study here. Add cards or pick another deck.",
      };
}

async function pickNext(ctx: Ctx, s: Sess): Promise<Row | null> {
  if (s.reviewed + s.skipped >= s.card_limit) return null;
  const { cards } = await snapshot(ctx, s.deck_id ?? undefined);
  const skipped = new Set(s.seen);
  const live = cards.filter((c) => studyable(c, ctx.now) && !skipped.has(c.id));
  const due = live
    .filter((c) => c.model?.state !== NEW && ms(c.model?.due) <= ctx.now)
    .sort((x, y) => ms(x.model.due) - ms(y.model.due));
  if (due[0]) return due[0];
  if (s.new_served < s.new_limit)
    return live.find((c) => c.model?.state === NEW) ?? null;
  return null;
}

/** Points the session at `card` (or at nothing) in one guarded update. */
async function serve(
  ctx: Ctx,
  s: Sess,
  card: Row | null,
  extra: { sql: string; params: unknown[] } = { sql: "", params: [] }
) {
  const base = [
    card?.id ?? null,
    ctx.now,
    ctx.now + SESSION_TTL_MS,
    card?.model?.state === NEW ? 1 : 0,
    ctx.userId,
    s.id,
    s.turn,
  ];
  const { rows } = await ctx.db.query<Row>(
    `UPDATE mcp_study_sessions SET current_card_id = $1, updated_at = $2, expires_at = $3,
       turn = turn + 1, phase = 'asked', pending_rating = NULL, new_served = new_served + $4${extra.sql}
     WHERE user_id = $5 AND id = $6 AND turn = $7 RETURNING *`,
    [...base, ...extra.params]
  );
  if (!rows[0])
    throw new StudyError(
      "review_in_progress",
      "another call changed this session at the same time; call next_card to resume"
    );
  return toSess(rows[0]);
}

const touch = (ctx: Ctx, s: Sess) =>
  ctx.db.query(
    "UPDATE mcp_study_sessions SET updated_at = $1, expires_at = $2 WHERE user_id = $3 AND id = $4",
    [ctx.now, ctx.now + SESSION_TTL_MS, ctx.userId, s.id]
  );

// ---- tools ----------------------------------------------------------------------------------

const start_study_session: Tool = {
  name: "start_study_session",
  write: true,
  description: `Start a study session and get the first card (question side only). Due cards come first, then up to new_limit new cards (default ${DEFAULT_NEW}). Optional deck_id (includes sub-decks) and limit (cards per session, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}). The session remembers which card is being asked, so a review can only be recorded for that card, once. Sessions expire after 2 hours without activity. Use this for every quiz instead of grade_card.`,
  inputSchema: {
    type: "object",
    properties: {
      deck_id: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      new_limit: { type: "integer", minimum: 0, maximum: MAX_LIMIT },
    },
  },
  async run(ctx, a) {
    const deckId = str(a, "deck_id");
    if (deckId) {
      const { decks } = await snapshot(ctx, deckId);
      if (!decks.some((d) => d.id === deckId))
        throw new StudyError("deck_not_found", "deck not found");
    }
    const bound = (k: string, d: number, max: number, min: number) => {
      if (a[k] === undefined) return d;
      const v = Number(a[k]);
      if (!Number.isInteger(v) || v < min || v > max)
        throw new StudyError(
          "invalid_argument",
          `${k} must be a whole number from ${min} to ${max}`
        );
      return v;
    };
    const s: Sess = {
      id: `sess_${randomUUID().replace(/-/g, "")}`,
      deck_id: deckId ?? null,
      card_limit: bound("limit", DEFAULT_LIMIT, MAX_LIMIT, 1),
      new_limit: bound("new_limit", DEFAULT_NEW, MAX_LIMIT, 0),
      seen: [],
      new_served: 0,
      current_card_id: null,
      turn: 1,
      phase: "asked",
      pending_rating: null,
      reviewed: 0,
      skipped: 0,
      ratings: {},
      last_review: null,
      started_at: ctx.now,
      updated_at: ctx.now,
      expires_at: ctx.now + SESSION_TTL_MS,
      ended_at: null,
    };
    const card = await pickNext(ctx, s);
    s.current_card_id = card?.id ?? null;
    if (card?.model?.state === NEW) s.new_served = 1;
    await ctx.db.query(
      `INSERT INTO mcp_study_sessions (user_id, id, deck_id, card_limit, new_limit, new_served,
         current_card_id, started_at, updated_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
      [
        ctx.userId,
        s.id,
        s.deck_id,
        s.card_limit,
        s.new_limit,
        s.new_served,
        s.current_card_id,
        ctx.now,
        s.expires_at,
      ]
    );
    return { session_id: s.id, ...(await present(ctx, s, card)) };
  },
};

const next_card: Tool = {
  name: "next_card",
  write: true,
  description:
    "Get the card of the session that is being asked (safe to repeat after a lost reply or a closed chat), or pick the next one when nothing is open. With skip true the open card is skipped without grading and will not be offered again in this session.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      skip: { type: "boolean" },
    },
    required: ["session_id"],
  },
  async run(ctx, a) {
    let s = await loadSession(ctx, str(a, "session_id"));
    if (s.phase === "grading")
      throw new StudyError(
        "review_in_progress",
        "a review is being saved; call submit_review again with the same arguments"
      );
    if (s.current_card_id && a.skip !== true) {
      await touch(ctx, s);
      try {
        const { card } = await cardAndNote(ctx, s.current_card_id);
        return { session_id: s.id, ...(await present(ctx, s, card)) };
      } catch (e) {
        if (!(e instanceof StudyError)) throw e;
        a.skip = true; // the open card vanished: move on
      }
    }
    const skipping = !!s.current_card_id;
    if (skipping) {
      s = { ...s, seen: [...s.seen, s.current_card_id as string] };
      s.skipped += 1;
    }
    const card = await pickNext(ctx, s);
    s = await serve(
      ctx,
      s,
      card,
      skipping
        ? {
            sql: ", seen = $8, skipped = skipped + 1",
            params: [JSON.stringify(s.seen)],
          }
        : undefined
    );
    return { session_id: s.id, ...(await present(ctx, s, card)) };
  },
};

const show_answer: Tool = {
  name: "show_answer",
  write: true,
  description:
    "Reveal the answer of the card being asked. Call it only after the learner has answered (or given up). submit_review is refused until this was called. card_id must be the card the session is asking.",
  inputSchema: {
    type: "object",
    properties: { session_id: { type: "string" }, card_id: { type: "string" } },
    required: ["session_id", "card_id"],
  },
  async run(ctx, a) {
    const s = await loadSession(ctx, str(a, "session_id"));
    const cardId = str(a, "card_id");
    if (!s.current_card_id || cardId !== s.current_card_id)
      throw new StudyError(
        "wrong_card",
        s.current_card_id
          ? `this session is asking card ${s.current_card_id}, not ${cardId}`
          : "this session has no open card; call next_card"
      );
    const { card, note } = await cardAndNote(ctx, s.current_card_id);
    if (s.phase === "asked")
      await ctx.db.query(
        "UPDATE mcp_study_sessions SET phase = 'revealed', updated_at = $1, expires_at = $2 WHERE user_id = $3 AND id = $4 AND phase = 'asked'",
        [ctx.now, ctx.now + SESSION_TTL_MS, ctx.userId, s.id]
      );
    else await touch(ctx, s);
    return {
      session_id: s.id,
      card_id: card.id,
      question: questionOf(card, note),
      answer: answerOf(card, note),
      next_step:
        "Compare with the learner's own answer, then call submit_review (1 Again, 2 Hard, 3 Good, 4 Easy).",
    };
  },
};

const submit_review: Tool = {
  name: "submit_review",
  write: true,
  description:
    "Record the learner's real answer to the card being asked: rating 1 Again, 2 Hard, 3 Good, 4 Easy. Needs session_id and card_id of the open card, and show_answer first. Safe to retry after a timeout: the same call returns the saved result with duplicate true and never grades twice. Returns the schedule and the next card.",
  inputSchema: {
    type: "object",
    properties: {
      session_id: { type: "string" },
      card_id: { type: "string" },
      rating: { type: "integer", minimum: 1, maximum: 4 },
    },
    required: ["session_id", "card_id", "rating"],
  },
  async run(ctx, a) {
    let s = await loadSession(ctx, str(a, "session_id"), { ended: true });
    const cardId = str(a, "card_id") ?? "";
    const rating = Number(a.rating);
    if (![1, 2, 3, 4].includes(rating))
      throw new StudyError("invalid_rating", "rating must be 1, 2, 3 or 4");

    // A retry of the answer that was just saved.
    const last = s.last_review;
    if (last && last.card_id === cardId && cardId !== s.current_card_id) {
      if (last.rating !== rating)
        throw new StudyError(
          "duplicate_review",
          `card ${cardId} was already graded ${last.rating} in this session; a review is recorded once`
        );
      const next =
        s.ended_at === null
          ? await present(
              ctx,
              s,
              s.current_card_id
                ? (await cardAndNote(ctx, s.current_card_id)).card
                : null
            )
          : { done: true, reason: "session_ended" };
      return {
        session_id: s.id,
        duplicate: true,
        review: last.result,
        next,
      };
    }
    if (s.ended_at !== null)
      throw new StudyError("session_ended", "this session is over");
    if (s.expires_at < ctx.now)
      throw new StudyError(
        "session_expired",
        "this session timed out; call start_study_session again"
      );
    if (!s.current_card_id || cardId !== s.current_card_id)
      throw new StudyError(
        "wrong_card",
        s.current_card_id
          ? `this session is asking card ${s.current_card_id}, not ${cardId}; nothing was graded`
          : "this session has no open card; nothing was graded"
      );
    if (s.phase === "asked")
      throw new StudyError(
        "answer_not_shown",
        "call show_answer for this card first, after the learner has answered"
      );
    if (s.phase === "grading") {
      if (s.pending_rating !== rating)
        throw new StudyError(
          "review_in_progress",
          `a review with rating ${s.pending_rating} is being saved; repeat that call`
        );
    } else {
      const claim = await ctx.db.query<Row>(
        `UPDATE mcp_study_sessions SET phase = 'grading', pending_rating = $1
         WHERE user_id = $2 AND id = $3 AND turn = $4 AND phase = 'revealed' RETURNING id`,
        [rating, ctx.userId, s.id, s.turn]
      );
      if (!claim.rows[0])
        throw new StudyError(
          "review_in_progress",
          "this card is already being graded; call next_card to resume"
        );
    }

    const logId = createHash("sha256")
      .update(`${ctx.userId}/${s.id}/${s.turn}`)
      .digest("hex")
      .slice(0, 32);
    const { rows: logged } = await ctx.db.query(
      "SELECT 1 FROM changes WHERE user_id = $1 AND tbl = 'reviewLogs' AND id = $2 AND NOT deleted",
      [ctx.userId, logId]
    );
    let result: Record<string, unknown>;
    try {
      if (logged.length) {
        // The grade was saved but the session update was lost: finish without grading again.
        const { card } = await cardAndNote(ctx, cardId);
        result = {
          due: ms(card.model?.due),
          state: card.model?.state,
          scheduled_days: card.model?.scheduled_days,
          lapses: card.model?.lapses,
          leech: false,
          recovered: true,
        };
      } else {
        result = await gradeCard(ctx, cardId, rating, logId);
      }
    } catch (e) {
      await ctx.db.query(
        "UPDATE mcp_study_sessions SET phase = 'revealed', pending_rating = NULL WHERE user_id = $1 AND id = $2 AND phase = 'grading'",
        [ctx.userId, s.id]
      );
      const msg = (e as Error).message;
      if (/not due|suspended|buried|not found/.test(msg))
        throw new StudyError(
          "card_unavailable",
          `${msg}; nothing was graded. Call next_card with skip true.`
        );
      throw e;
    }

    const ratings = { ...s.ratings, [rating]: (s.ratings[rating] ?? 0) + 1 };
    const record: LastReview = {
      turn: s.turn,
      card_id: cardId,
      rating,
      result,
    };
    s = { ...s, reviewed: s.reviewed + 1, ratings };
    const card = await pickNext(ctx, s);
    s = await serve(ctx, s, card, {
      sql: ", reviewed = reviewed + 1, ratings = $8, last_review = $9",
      params: [JSON.stringify(ratings), JSON.stringify(record)],
    });
    return {
      session_id: s.id,
      duplicate: false,
      review: result,
      next: await present(ctx, s, card),
    };
  },
};

const end_session: Tool = {
  name: "end_session",
  write: true,
  description:
    "End a study session and get its summary (cards reviewed, skipped, rating counts, cards still due). Safe to repeat. Call it when the learner stops or the queue is empty. Only graded answers count; questions that were asked but never graded are not recorded.",
  inputSchema: {
    type: "object",
    properties: { session_id: { type: "string" } },
    required: ["session_id"],
  },
  async run(ctx, a) {
    const s = await loadSession(ctx, str(a, "session_id"), {
      ended: true,
      expired: true,
    });
    let endedAt = s.ended_at;
    if (endedAt === null) {
      endedAt = ctx.now;
      await ctx.db.query(
        "UPDATE mcp_study_sessions SET ended_at = $1, current_card_id = NULL, phase = 'asked', pending_rating = NULL WHERE user_id = $2 AND id = $3 AND ended_at IS NULL",
        [endedAt, ctx.userId, s.id]
      );
    }
    const { cards } = await snapshot(ctx, s.deck_id ?? undefined);
    return {
      session_id: s.id,
      ended: true,
      reviewed: s.reviewed,
      skipped: s.skipped,
      ratings: {
        again: s.ratings[1] ?? 0,
        hard: s.ratings[2] ?? 0,
        good: s.ratings[3] ?? 0,
        easy: s.ratings[4] ?? 0,
      },
      duration_ms: endedAt - s.started_at,
      still_due: cards.filter(
        (c) =>
          studyable(c, ctx.now) &&
          c.model?.state !== NEW &&
          ms(c.model?.due) <= ctx.now
      ).length,
    };
  },
};

export const STUDY_TOOLS: Tool[] = [
  start_study_session,
  next_card,
  show_answer,
  submit_review,
  end_session,
];
