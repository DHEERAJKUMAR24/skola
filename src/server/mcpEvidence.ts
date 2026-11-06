import { createHash, randomUUID } from "node:crypto";
import {
  type Assessment,
  DIMENSIONS,
  type Domain,
  MASTERY,
  RATING_LABELS,
  type Track,
  evaluate,
  isDimension,
} from "../logic/learning/mastery";
import { recallAfter } from "../logic/scheduling/forecast";
import {
  type Ctx,
  type Row,
  type Tool,
  load,
  ms,
  noteText,
  str,
} from "./mcpData";
import { settingsOf } from "./mcpManage";

const MAX_OBJECTIVES = 200;
const MAX_LINK = 200;
const PRIORITIES = ["P0", "P1", "P2"];
const STATUSES = ["active", "parked", "done"];

/** `[code] message` so a client can branch on the code and show the text. */
class EvidenceError extends Error {
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
  }
}
const bad = (m: string) => new EvidenceError("invalid_argument", m);

function pick(a: Row, key: string, list: string[], d?: string) {
  const v = a[key] ?? d;
  if (typeof v !== "string" || !list.includes(v))
    throw bad(`${key} must be one of ${list.join(", ")}`);
  return v;
}

function text(a: Row, key: string, max: number, required = true) {
  const v = a[key];
  if (v === undefined && !required) return undefined;
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw bad(`${key} must be a non-empty string under ${max} chars`);
  return v.trim();
}

async function objective(ctx: Ctx, id: string | undefined) {
  const { rows } = await ctx.db.query<Row>(
    "SELECT * FROM learning_objectives WHERE user_id = $1 AND id = $2",
    [ctx.userId, id ?? ""]
  );
  if (!rows[0])
    throw new EvidenceError(
      "objective_not_found",
      "no such objective; call list_objectives"
    );
  return rows[0];
}

async function assessments(ctx: Ctx, objectiveId: string) {
  const { rows } = await ctx.db.query<Row>(
    "SELECT * FROM objective_assessments WHERE user_id = $1 AND objective_id = $2 ORDER BY assessed_at, id",
    [ctx.userId, objectiveId]
  );
  return rows;
}

const toAssessment = (r: Row): Assessment => ({
  domain: r.domain,
  dimension: r.dimension,
  rating: Number(r.rating),
  hints: Number(r.hints),
  independent: !!r.independent,
  at: Number(r.assessed_at),
});

const brief = (o: Row, list: Row[], ctx: Ctx) => {
  const s = evaluate(o.track as Track, list.map(toAssessment), ctx.now);
  return {
    objective_id: o.id,
    title: o.title,
    deck_id: o.deck_id,
    priority: o.priority,
    track: o.track,
    status: o.status,
    k_score: s.K.score,
    s_score: s.S?.score ?? null,
    mastered: s.mastered,
    next: s.next,
    // Latest rating per dimension (null = untested), so a list can show all eight without a call each.
    dimensions: {
      K: ratings(s.K),
      S: s.S ? ratings(s.S) : null,
    },
  };
};

const ratings = (d: {
  dimensions: Record<string, { rating: number } | null>;
}) =>
  Object.fromEntries(
    Object.entries(d.dimensions).map(([k, v]) => [k, v?.rating ?? null])
  );

const create_objective: Tool = {
  name: "create_objective",
  write: true,
  description:
    "Record a learning objective: what the learner should be able to do or know, before cards or practice are made for it. priority P0 (must), P1 (default) or P2 (nice to have). track K tracks Knowledge only; KS (default) tracks Knowledge and Skill. Optional deck_id links it to a deck. One objective usually needs several cards and some practice; link cards with link_cards.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      deck_id: { type: "string" },
      priority: { type: "string", enum: PRIORITIES },
      track: { type: "string", enum: ["K", "KS"] },
    },
    required: ["title"],
  },
  async run(ctx, a) {
    const title = text(a, "title", 200) as string;
    const description = text(a, "description", 4000, false);
    const priority = pick(a, "priority", PRIORITIES, "P1");
    const track = pick(a, "track", ["K", "KS"], "KS");
    const deckId = str(a, "deck_id");
    if (
      deckId &&
      !(await load(ctx.db, ctx.userId, "decks")).some((d) => d.id === deckId)
    )
      throw new EvidenceError("deck_not_found", "deck not found");
    const { rows } = await ctx.db.query<{ n: string }>(
      "SELECT count(*) AS n FROM learning_objectives WHERE user_id = $1",
      [ctx.userId]
    );
    if (Number(rows[0].n) >= MAX_OBJECTIVES)
      throw new EvidenceError(
        "limit_reached",
        `at most ${MAX_OBJECTIVES} objectives; park or delete some`
      );
    const id = `obj_${randomUUID().replace(/-/g, "")}`;
    await ctx.db.query(
      `INSERT INTO learning_objectives (user_id, id, deck_id, title, description, priority, track, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [
        ctx.userId,
        id,
        deckId ?? null,
        title,
        description ?? null,
        priority,
        track,
        ctx.now,
      ]
    );
    return { objective_id: id, title, priority, track, status: "active" };
  },
};

const update_objective: Tool = {
  name: "update_objective",
  write: true,
  description:
    "Change an objective: title, description, priority, track, or status (active, parked when it is not worth more time now, done). Evidence is never changed or removed by this.",
  inputSchema: {
    type: "object",
    properties: {
      objective_id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      priority: { type: "string", enum: PRIORITIES },
      track: { type: "string", enum: ["K", "KS"] },
      status: { type: "string", enum: STATUSES },
    },
    required: ["objective_id"],
  },
  async run(ctx, a) {
    const o = await objective(ctx, str(a, "objective_id"));
    const next = {
      title: a.title === undefined ? o.title : text(a, "title", 200),
      description:
        a.description === undefined
          ? o.description
          : text(a, "description", 4000),
      priority:
        a.priority === undefined ? o.priority : pick(a, "priority", PRIORITIES),
      track: a.track === undefined ? o.track : pick(a, "track", ["K", "KS"]),
      status: a.status === undefined ? o.status : pick(a, "status", STATUSES),
    };
    if (Object.entries(next).every(([k, v]) => v === o[k]))
      throw new EvidenceError("nothing_to_change", "nothing to change");
    await ctx.db.query(
      `UPDATE learning_objectives SET title = $3, description = $4, priority = $5, track = $6,
         status = $7, updated_at = $8 WHERE user_id = $1 AND id = $2`,
      [
        ctx.userId,
        o.id,
        next.title,
        next.description,
        next.priority,
        next.track,
        next.status,
        ctx.now,
      ]
    );
    return { ok: true, objective_id: o.id, ...next };
  },
};

const list_objectives: Tool = {
  name: "list_objectives",
  description:
    "Learning objectives, P0 first, each with its K score, S score (null until all four dimensions of that track have evidence), whether it is mastered, and the next action. Optional deck_id and status (active, parked, done).",
  inputSchema: {
    type: "object",
    properties: {
      deck_id: { type: "string" },
      status: { type: "string", enum: STATUSES },
    },
  },
  async run(ctx, a) {
    const status =
      a.status === undefined ? undefined : pick(a, "status", STATUSES);
    const { rows } = await ctx.db.query<Row>(
      `SELECT * FROM learning_objectives WHERE user_id = $1
         AND ($2::text IS NULL OR deck_id = $2) AND ($3::text IS NULL OR status = $3)
       ORDER BY priority, created_at`,
      [ctx.userId, str(a, "deck_id") ?? null, status ?? null]
    );
    const { rows: ev } = await ctx.db.query<Row>(
      "SELECT * FROM objective_assessments WHERE user_id = $1 ORDER BY assessed_at, id",
      [ctx.userId]
    );
    return rows.map((o) =>
      brief(
        o,
        ev.filter((e) => e.objective_id === o.id),
        ctx
      )
    );
  },
};

const get_objective: Tool = {
  name: "get_objective",
  description:
    "One objective in full: every dimension's latest rating and date, K and S scores, what still blocks mastery, the recommended next action, the last 10 pieces of evidence, and the linked cards (count, due now, lapses). Use this before claiming anything about mastery.",
  inputSchema: {
    type: "object",
    properties: {
      objective_id: { type: "string" },
      evidence_limit: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        description:
          "How many pieces of evidence to return, newest first (default 10).",
      },
    },
    required: ["objective_id"],
  },
  async run(ctx, a) {
    const o = await objective(ctx, str(a, "objective_id"));
    const ev = await assessments(ctx, o.id);
    const limit = Math.min(
      Math.max(Math.trunc(Number(a.evidence_limit)) || 10, 1),
      200
    );
    const status = evaluate(o.track as Track, ev.map(toAssessment), ctx.now);
    const { rows: links } = await ctx.db.query<{ card_id: string }>(
      "SELECT card_id FROM objective_cards WHERE user_id = $1 AND objective_id = $2",
      [ctx.userId, o.id]
    );
    const cards = await load(ctx.db, ctx.userId, "cards");
    const linked = cards.filter((c) => links.some((l) => l.card_id === c.id));
    return {
      objective_id: o.id,
      title: o.title,
      description: o.description,
      deck_id: o.deck_id,
      priority: o.priority,
      status: o.status,
      ...status,
      mastery_rules: {
        min_score: MASTERY.minScore,
        min_rating: MASTERY.minRating,
        retest_days: MASTERY.retestDays,
      },
      evidence: ev
        .slice(-limit)
        .reverse()
        .map((e) => ({
          assessment_id: e.id,
          at: Number(e.assessed_at),
          domain: e.domain,
          dimension: e.dimension,
          rating: Number(e.rating),
          hints: Number(e.hints),
          independent: !!e.independent,
          evidence: e.evidence,
          source: e.source,
        })),
      card_ids: links.map((l) => l.card_id),
      cards: {
        linked: links.length,
        missing: links.length - linked.length,
        due_now: linked.filter(
          (c) => c.model?.state !== 0 && ms(c.model?.due) <= ctx.now
        ).length,
        new: linked.filter((c) => c.model?.state === 0).length,
        lapses: linked.reduce((n, c) => n + (c.model?.lapses ?? 0), 0),
      },
    };
  },
};

const record_assessment: Tool = {
  name: "record_assessment",
  write: true,
  description: `Save dated evidence for one dimension of an objective. domain K (Knowledge): ${DIMENSIONS.K.join(", ")}. domain S (Skill): ${DIMENSIONS.S.join(", ")}. rating 0 to 4: ${RATING_LABELS.map((l, i) => `${i} ${l}`).join("; ")}. evidence is required: what the learner actually answered or produced, and how it was judged. hints: how many hints the learner needed (a 4 must have 0). independent: false if the learner was coached through it (a 4 must be independent). The time is set by the server, so a delayed retest cannot be faked. Pass an idempotency_key so a retry is saved once. Only real learner work counts: never record an assessment for something the learner did not do.`,
  inputSchema: {
    type: "object",
    properties: {
      objective_id: { type: "string" },
      domain: { type: "string", enum: ["K", "S"] },
      dimension: { type: "string" },
      rating: { type: "integer", minimum: 0, maximum: 4 },
      evidence: { type: "string" },
      hints: { type: "integer", minimum: 0, maximum: 20 },
      independent: { type: "boolean" },
      source: { type: "string" },
      idempotency_key: { type: "string" },
    },
    required: ["objective_id", "domain", "dimension", "rating", "evidence"],
  },
  async run(ctx, a) {
    const o = await objective(ctx, str(a, "objective_id"));
    const domain = pick(a, "domain", ["K", "S"]) as Domain;
    const dimension = String(a.dimension ?? "");
    if (!isDimension(domain, dimension))
      throw bad(
        `dimension for ${domain} must be one of ${DIMENSIONS[domain].join(", ")}`
      );
    if (domain === "S" && o.track === "K")
      throw new EvidenceError(
        "wrong_track",
        "this objective tracks Knowledge only; update_objective with track KS first"
      );
    const rating = Number(a.rating);
    if (!Number.isInteger(rating) || rating < 0 || rating > 4)
      throw bad("rating must be a whole number from 0 to 4");
    const evidence = text(a, "evidence", 4000) as string;
    if (evidence.length < 5)
      throw bad(
        "evidence must say what the learner did, in at least 5 characters"
      );
    const hints = a.hints === undefined ? 0 : Number(a.hints);
    if (!Number.isInteger(hints) || hints < 0 || hints > 20)
      throw bad("hints must be a whole number from 0 to 20");
    const independent = a.independent === undefined ? true : a.independent;
    if (typeof independent !== "boolean")
      throw bad("independent must be true or false");
    if (rating === 4 && (hints > 0 || !independent))
      throw new EvidenceError(
        "inconsistent_rating",
        "a 4 means strong and unaided: it needs hints 0 and independent true. Rate 3 or lower, or fix hints."
      );
    const key = str(a, "idempotency_key");
    const id = key
      ? `asm_${createHash("sha256").update(`${ctx.userId}/${o.id}/${key}`).digest("hex").slice(0, 32)}`
      : `asm_${randomUUID().replace(/-/g, "")}`;
    const ins = await ctx.db.query(
      `INSERT INTO objective_assessments
         (user_id, id, objective_id, domain, dimension, rating, evidence, hints, independent, source, assessed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id`,
      [
        ctx.userId,
        id,
        o.id,
        domain,
        dimension,
        rating,
        evidence,
        hints,
        independent,
        str(a, "source") ?? null,
        ctx.now,
      ]
    );
    const fresh = ins.rows.length > 0;
    if (!fresh) {
      const { rows } = await ctx.db.query<Row>(
        "SELECT objective_id, domain, dimension, rating FROM objective_assessments WHERE user_id = $1 AND id = $2",
        [ctx.userId, id]
      );
      const old = rows[0];
      if (
        old.objective_id !== o.id ||
        old.domain !== domain ||
        old.dimension !== dimension ||
        Number(old.rating) !== rating
      )
        throw new EvidenceError(
          "idempotency_conflict",
          "that idempotency_key was already used for different evidence"
        );
    }
    const s = evaluate(
      o.track as Track,
      (await assessments(ctx, o.id)).map(toAssessment),
      ctx.now
    );
    return {
      assessment_id: id,
      duplicate: !fresh,
      objective_id: o.id,
      k_score: s.K.score,
      s_score: s.S?.score ?? null,
      mastered: s.mastered,
      blockers: s.blockers,
      next: s.next,
    };
  },
};

const link_cards: Tool = {
  name: "link_cards",
  write: true,
  description: `Link cards to an objective (add_card_ids) or unlink them (remove_card_ids), up to ${MAX_LINK} each. This records which cards practise the objective, so coverage can be checked. Cards are not changed.`,
  inputSchema: {
    type: "object",
    properties: {
      objective_id: { type: "string" },
      add_card_ids: { type: "array", items: { type: "string" } },
      remove_card_ids: { type: "array", items: { type: "string" } },
    },
    required: ["objective_id"],
  },
  async run(ctx, a) {
    const o = await objective(ctx, str(a, "objective_id"));
    const list = (k: string) => {
      const v = a[k];
      if (v === undefined) return [];
      if (
        !Array.isArray(v) ||
        v.length > MAX_LINK ||
        !v.every((x) => typeof x === "string" && x)
      )
        throw bad(`${k} must be a list of up to ${MAX_LINK} card ids`);
      return [...new Set(v as string[])];
    };
    const add = list("add_card_ids");
    const remove = list("remove_card_ids");
    if (!add.length && !remove.length)
      throw new EvidenceError(
        "nothing_to_change",
        "give add_card_ids or remove_card_ids"
      );
    if (add.length) {
      const cards = new Set(
        (await load(ctx.db, ctx.userId, "cards")).map((c) => c.id)
      );
      const missing = add.filter((i) => !cards.has(i));
      if (missing.length)
        throw new EvidenceError(
          "card_not_found",
          `unknown card ids: ${missing.slice(0, 5).join(", ")}`
        );
      await ctx.db.query(
        `INSERT INTO objective_cards (user_id, objective_id, card_id, linked_at)
         SELECT $1, $2, c, $4 FROM unnest($3::text[]) AS c ON CONFLICT DO NOTHING`,
        [ctx.userId, o.id, add, ctx.now]
      );
    }
    if (remove.length)
      await ctx.db.query(
        "DELETE FROM objective_cards WHERE user_id = $1 AND objective_id = $2 AND card_id = ANY($3)",
        [ctx.userId, o.id, remove]
      );
    const { rows } = await ctx.db.query<{ n: string }>(
      "SELECT count(*) AS n FROM objective_cards WHERE user_id = $1 AND objective_id = $2",
      [ctx.userId, o.id]
    );
    return { ok: true, objective_id: o.id, linked: Number(rows[0].n) };
  },
};

const delete_objective: Tool = {
  name: "delete_objective",
  write: true,
  destructive: true,
  description:
    "Delete an objective with all its evidence and card links (cards are kept). Prefer update_objective with status parked or done: evidence is the proof of learning. Two steps: call without confirm_token to see what would go and get a token; ask the learner; repeat with the token.",
  inputSchema: {
    type: "object",
    properties: {
      objective_id: { type: "string" },
      confirm_token: { type: "string" },
    },
    required: ["objective_id"],
  },
  async run(ctx, a) {
    const o = await objective(ctx, str(a, "objective_id"));
    const ev = await assessments(ctx, o.id);
    const { rows: links } = await ctx.db.query<{ card_id: string }>(
      "SELECT card_id FROM objective_cards WHERE user_id = $1 AND objective_id = $2",
      [ctx.userId, o.id]
    );
    const token = createHash("sha256")
      .update(`${ctx.userId}/objective/${o.id}/${ev.length}/${links.length}`)
      .digest("hex")
      .slice(0, 12);
    if (a.confirm_token !== token) {
      if (a.confirm_token !== undefined)
        throw new EvidenceError(
          "confirm_token_mismatch",
          "the evidence changed or the token is wrong. Nothing was deleted."
        );
      return {
        deleted: false,
        will_delete: {
          objective: o.title,
          evidence: ev.length,
          card_links: links.length,
        },
        confirm_token: token,
        message:
          "Nothing was deleted. Show the learner what will be removed and, only if they agree, repeat this call with the confirm_token.",
      };
    }
    await ctx.db.transaction(async (q) => {
      for (const t of ["objective_assessments", "objective_cards"])
        await q(`DELETE FROM ${t} WHERE user_id = $1 AND objective_id = $2`, [
          ctx.userId,
          o.id,
        ]);
      await q(
        "DELETE FROM learning_objectives WHERE user_id = $1 AND id = $2",
        [ctx.userId, o.id]
      );
    });
    return { deleted: true, evidence: ev.length, card_links: links.length };
  },
};

const get_objective_overview: Tool = {
  name: "get_objective_overview",
  description:
    "The overview of an objective: one summary of where the learner stands on it. Combines the objective, its K and S status and next action with the progress of its linked cards (new, learning, review, mature, due now, lapses, average recall chance now), the weakest cards, and coverage gaps (no cards, all cards new, untested dimensions). Read-only; nothing is stored. Use it to open a session on an objective and to decide what to practise next.",
  inputSchema: {
    type: "object",
    properties: { objective_id: { type: "string" } },
    required: ["objective_id"],
  },
  async run(ctx, a) {
    const o = await objective(ctx, str(a, "objective_id"));
    const status = evaluate(
      o.track as Track,
      (await assessments(ctx, o.id)).map(toAssessment),
      ctx.now
    );
    const { rows: links } = await ctx.db.query<{ card_id: string }>(
      "SELECT card_id FROM objective_cards WHERE user_id = $1 AND objective_id = $2",
      [ctx.userId, o.id]
    );
    const [cards, notes] = await Promise.all([
      load(ctx.db, ctx.userId, "cards"),
      load(ctx.db, ctx.userId, "notes"),
    ]);
    const ids = new Set(links.map((l) => l.card_id));
    const linked = cards.filter((c) => ids.has(c.id));
    const noteById = new Map(notes.map((n) => [n.id, n]));
    const { w } = await settingsOf(ctx);
    const studied = linked.filter((c) => c.model?.state !== 0);
    const recall = (c: Row) => {
      const last = ms(c.model?.last_review);
      return last
        ? recallAfter(c.model.stability, (ctx.now - last) / 86_400_000, w)
        : 0;
    };
    const rec = studied.map((c) => ({ c, r: recall(c) }));
    const avg = (xs: number[]) =>
      xs.length
        ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 1000) / 1000
        : null;
    const dueNow = studied.filter(
      (c) => !c.suspended && ms(c.model?.due) <= ctx.now
    );
    const progress = {
      linked: ids.size,
      missing: ids.size - linked.length,
      new: linked.filter((c) => c.model?.state === 0).length,
      learning: linked.filter(
        (c) => c.model?.state === 1 || c.model?.state === 3
      ).length,
      review: linked.filter((c) => c.model?.state === 2).length,
      mature: studied.filter((c) => c.model?.stability >= 21).length,
      suspended: linked.filter((c) => c.suspended).length,
      due_now: dueNow.length,
      lapses: linked.reduce((n, c) => n + (c.model?.lapses ?? 0), 0),
      avg_recall_now: avg(rec.map((x) => x.r)),
      next_due:
        studied
          .filter((c) => !c.suspended)
          .map((c) => ms(c.model?.due))
          .filter((d) => d > ctx.now)
          .sort((x, y) => x - y)[0] ?? null,
    };
    const gaps: string[] = [];
    if (!ids.size)
      gaps.push("no cards are linked to this objective; use link_cards");
    else if (progress.new === ids.size)
      gaps.push("every linked card is still new");
    if (progress.missing)
      gaps.push(`${progress.missing} linked card(s) no longer exist`);
    if (progress.suspended)
      gaps.push(`${progress.suspended} linked card(s) are suspended`);
    for (const [d, ds] of [
      ["K", status.K],
      ["S", status.S],
    ] as const)
      if (ds?.untested.length)
        gaps.push(`${d} untested: ${ds.untested.join(", ")}`);
    return {
      objective: {
        objective_id: o.id,
        title: o.title,
        description: o.description,
        priority: o.priority,
        track: o.track,
        status: o.status,
      },
      mastery: {
        k_score: status.K.score,
        s_score: status.S?.score ?? null,
        mastered: status.mastered,
        blockers: status.blockers,
        next: status.next,
      },
      cards: progress,
      weakest: rec
        .sort(
          (x, y) =>
            x.r - y.r || (y.c.model?.lapses ?? 0) - (x.c.model?.lapses ?? 0)
        )
        .slice(0, 5)
        .map(({ c, r }) => ({
          card_id: c.id,
          text: noteText(noteById.get(c.note) ?? {}).slice(0, 120),
          recall_now: Math.round(r * 1000) / 1000,
          lapses: c.model?.lapses ?? 0,
          due: ms(c.model?.due),
        })),
      gaps,
    };
  },
};

export const EVIDENCE_TOOLS: Tool[] = [
  get_objective_overview,
  create_objective,
  update_objective,
  list_objectives,
  get_objective,
  record_assessment,
  link_cards,
  delete_objective,
];
