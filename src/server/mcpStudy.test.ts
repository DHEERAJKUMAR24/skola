// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "./db";
import { handleRpc } from "./mcp";
import { pushRows } from "./sync";

let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  for (const f of [
    "20261101000000_init",
    "20261102000000_skills",
    "20261104000000_image_assets",
    "20261105000000_study_sessions",
  ])
    await pg.exec(fs.readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
  db = {
    query: (text, params) => pg.query(text, params) as never,
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn((text, params) => tx.query(text, params) as never)
      ),
  };
});
afterEach(() => vi.useRealTimers());

let rpc = 0;
async function call(user: string, name: string, args: object = {}) {
  const r: any = await handleRpc(db, user, {
    jsonrpc: "2.0",
    id: ++rpc,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const text = r.result.content[0].text as string;
  return r.result.isError
    ? { error: text, code: /^\[(\w+)\]/.exec(text)?.[1] }
    : JSON.parse(text);
}

let n = 0;
async function setup(user = `s-${++n}`) {
  await pushRows(db, user, [
    {
      tbl: "presets",
      id: "default",
      updatedAt: 1,
      data: {
        id: "default",
        name: "Default",
        newCardsPerDay: 20,
        maxReviewsPerDay: 200,
        newCardOrder: "created",
        learningSteps: ["1m", "10m"],
        relearningSteps: ["10m"],
        schedulingMode: "exact",
        desiredRetention: 0.9,
        maximumInterval: 36500,
        enableFuzz: false,
        easyDays: [],
      },
    },
  ]);
  const { id } = await call(user, "create_deck", { name: "Study" });
  return { user, deck: id as string };
}

async function row(user: string, tbl: string, id: string) {
  const { rows } = await pg.query<{ data: any }>(
    "SELECT data FROM changes WHERE user_id = $1 AND tbl = $2 AND id = $3",
    [user, tbl, id]
  );
  return rows[0]?.data;
}
async function logs(user: string) {
  const { rows } = await pg.query<{ n: string }>(
    "SELECT count(*) AS n FROM changes WHERE user_id = $1 AND tbl = 'reviewLogs'",
    [user]
  );
  return Number(rows[0].n);
}
async function sessionRow(user: string, id: string) {
  const { rows } = await pg.query<any>(
    "SELECT * FROM mcp_study_sessions WHERE user_id = $1 AND id = $2",
    [user, id]
  );
  return rows[0];
}

let stamp = Date.now() + 1_000_000;
/** Turns an added (new) card into a review card that was due `agoMs` ago. */
async function makeDue(user: string, cardId: string, agoMs = 1000) {
  const card = await row(user, "cards", cardId);
  await pushRows(db, user, [
    {
      tbl: "cards",
      id: cardId,
      updatedAt: (stamp += 1000),
      data: {
        ...card,
        model: {
          ...card.model,
          state: 2,
          due: { $d: Date.now() - agoMs },
          stability: 5,
          difficulty: 5,
          reps: 3,
          last_review: { $d: Date.now() - 5 * 86_400_000 },
        },
      },
    },
  ]);
}

async function addBasic(user: string, deck: string, pairs: string[][]) {
  const r = await call(user, "add_cards", {
    deck_id: deck,
    cards: pairs.map(([front, back]) => ({ front, back })),
  });
  return r.card_ids as string[];
}

describe("study sessions", () => {
  it("lists the five session tools as write tools", async () => {
    const r: any = await handleRpc(db, "x", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const hint = Object.fromEntries(
      r.result.tools.map((t: any) => [t.name, t.annotations.readOnlyHint])
    );
    for (const t of [
      "start_study_session",
      "next_card",
      "show_answer",
      "submit_review",
      "end_session",
    ])
      expect(hint[t]).toBe(false);
  });

  it("asks due cards first, then new ones, and never shows the answer with the question", async () => {
    const { user, deck } = await setup();
    const ids = await addBasic(user, deck, [
      ["new one", "SECRET-NEW"],
      ["due one", "SECRET-DUE"],
    ]);
    await makeDue(user, ids[1]);
    const s = await call(user, "start_study_session", { deck_id: deck });
    expect(s.card_id).toBe(ids[1]);
    expect(s.question).toEqual({ front: "due one" });
    expect(JSON.stringify(s)).not.toContain("SECRET");
    expect(s.is_new).toBe(false);
    const shown = await call(user, "show_answer", {
      session_id: s.session_id,
      card_id: ids[1],
    });
    expect(shown.answer.back).toBe("SECRET-DUE");
    const graded = await call(user, "submit_review", {
      session_id: s.session_id,
      card_id: ids[1],
      rating: 3,
    });
    expect(graded.review.due).toBeGreaterThan(Date.now());
    expect(graded.next.card_id).toBe(ids[0]);
    expect(graded.next.is_new).toBe(true);
  });

  it("hides the asked cloze and the choices' correct flags", async () => {
    const { user, deck } = await setup();
    const r = await call(user, "add_cards", {
      deck_id: deck,
      cards: [
        { type: "cloze", text: "{{c1::Paris}} is in {{c2::France}}" },
        {
          type: "multiple_choice",
          question: "Pick",
          choices: ["a", "b"],
          correct: [1],
          explanation: "EXPLAIN",
        },
      ],
    });
    const s = await call(user, "start_study_session", {
      deck_id: deck,
      new_limit: 10,
    });
    const seen: any[] = [s];
    for (let i = 0; i < 2; i++) {
      const cur = seen[seen.length - 1];
      const a = await call(user, "show_answer", {
        session_id: s.session_id,
        card_id: cur.card_id,
      });
      expect(a.answer).toBeDefined();
      const g = await call(user, "submit_review", {
        session_id: s.session_id,
        card_id: cur.card_id,
        rating: 3,
      });
      seen.push(g.next);
    }
    const texts = seen.slice(0, 3).map((x) => JSON.stringify(x.question));
    const all = texts.join("\n");
    expect(r.card_ids).toHaveLength(3);
    expect(all).toContain("[...] is in France");
    expect(all).toContain("Paris is in [...]");
    expect(all).not.toContain("EXPLAIN");
    expect(all).toContain('"choices":["a","b"]');
    expect(all).not.toContain("correct");
  });

  it("reports an empty queue and a queue with only future cards", async () => {
    const { user, deck } = await setup();
    const empty = await call(user, "start_study_session", { deck_id: deck });
    expect(empty).toMatchObject({ done: true, reason: "no_cards" });

    const [id] = await addBasic(user, deck, [["q", "a"]]);
    await makeDue(user, id, -3 * 86_400_000);
    const later = await call(user, "start_study_session", {
      deck_id: deck,
      new_limit: 0,
    });
    expect(later.reason).toBe("nothing_due_now");
    expect(later.next_due).toBeGreaterThan(Date.now());
  });

  it("refuses to grade before the answer was shown, or the wrong card, and writes nothing", async () => {
    const { user, deck } = await setup();
    const ids = await addBasic(user, deck, [
      ["a", "1"],
      ["b", "2"],
    ]);
    const s = await call(user, "start_study_session", { deck_id: deck });
    const other = ids.find((i) => i !== s.card_id) as string;
    const early = await call(user, "submit_review", {
      session_id: s.session_id,
      card_id: s.card_id,
      rating: 3,
    });
    expect(early.code).toBe("answer_not_shown");
    await call(user, "show_answer", {
      session_id: s.session_id,
      card_id: s.card_id,
    });
    const wrong = await call(user, "submit_review", {
      session_id: s.session_id,
      card_id: other,
      rating: 3,
    });
    expect(wrong.code).toBe("wrong_card");
    expect(
      (
        await call(user, "show_answer", {
          session_id: s.session_id,
          card_id: other,
        })
      ).code
    ).toBe("wrong_card");
    expect(
      (
        await call(user, "submit_review", {
          session_id: s.session_id,
          card_id: s.card_id,
          rating: 7,
        })
      ).code
    ).toBe("invalid_rating");
    expect(await logs(user)).toBe(0);
    expect((await row(user, "cards", other)).model.reps).toBe(0);
  });

  it("answers a retried submit with the saved result and one review log", async () => {
    const { user, deck } = await setup();
    await addBasic(user, deck, [
      ["a", "1"],
      ["b", "2"],
    ]);
    const s = await call(user, "start_study_session", { deck_id: deck });
    const args = { session_id: s.session_id, card_id: s.card_id, rating: 3 };
    await call(user, "show_answer", args);
    const first = await call(user, "submit_review", args);
    const again = await call(user, "submit_review", args);
    expect(again.duplicate).toBe(true);
    expect(again.review).toEqual(first.review);
    expect(again.next.card_id).toBe(first.next.card_id);
    expect(await logs(user)).toBe(1);
    expect(
      (await call(user, "submit_review", { ...args, rating: 1 })).code
    ).toBe("duplicate_review");
    expect(await logs(user)).toBe(1);
    expect((await row(user, "cards", s.card_id)).model.reps).toBe(1);
  });

  it("finishes a grade whose session update was lost, without grading twice", async () => {
    const { user, deck } = await setup();
    await addBasic(user, deck, [
      ["a", "1"],
      ["b", "2"],
    ]);
    const s = await call(user, "start_study_session", { deck_id: deck });
    await call(user, "show_answer", {
      session_id: s.session_id,
      card_id: s.card_id,
    });
    // The server saved the grade (same log id) and then died before it moved the session on.
    const logId = createHash("sha256")
      .update(`${user}/${s.session_id}/1`)
      .digest("hex")
      .slice(0, 32);
    await call(user, "grade_card", { card_id: s.card_id, rating: 3 });
    const { rows } = await pg.query<{ data: any }>(
      "SELECT data FROM changes WHERE user_id = $1 AND tbl = 'reviewLogs'",
      [user]
    );
    await pushRows(db, user, [
      {
        tbl: "reviewLogs",
        id: logId,
        updatedAt: rows[0].data.reviewedAt,
        data: { ...rows[0].data, id: logId },
      },
    ]);
    await pg.query(
      "UPDATE mcp_study_sessions SET phase = 'grading', pending_rating = 3 WHERE user_id = $1 AND id = $2",
      [user, s.session_id]
    );
    const before = await logs(user);
    const r = await call(user, "submit_review", {
      session_id: s.session_id,
      card_id: s.card_id,
      rating: 3,
    });
    expect(r.review.recovered).toBe(true);
    expect(r.next.card_id).not.toBe(s.card_id);
    expect(await logs(user)).toBe(before);
    expect((await row(user, "cards", s.card_id)).model.reps).toBe(1);
  });

  it("rejects a different rating while a review is being saved", async () => {
    const { user, deck } = await setup();
    await addBasic(user, deck, [["a", "1"]]);
    const s = await call(user, "start_study_session", { deck_id: deck });
    await call(user, "show_answer", {
      session_id: s.session_id,
      card_id: s.card_id,
    });
    await pg.query(
      "UPDATE mcp_study_sessions SET phase = 'grading', pending_rating = 3 WHERE user_id = $1 AND id = $2",
      [user, s.session_id]
    );
    const r = await call(user, "submit_review", {
      session_id: s.session_id,
      card_id: s.card_id,
      rating: 1,
    });
    expect(r.code).toBe("review_in_progress");
  });

  it("resumes the open card after a lost reply and skips on request", async () => {
    const { user, deck } = await setup();
    await addBasic(user, deck, [
      ["a", "1"],
      ["b", "2"],
    ]);
    const s = await call(user, "start_study_session", { deck_id: deck });
    const resumed = await call(user, "next_card", {
      session_id: s.session_id,
    });
    expect(resumed.card_id).toBe(s.card_id);
    const skipped = await call(user, "next_card", {
      session_id: s.session_id,
      skip: true,
    });
    expect(skipped.card_id).not.toBe(s.card_id);
    expect(skipped.progress.skipped).toBe(1);
    await call(user, "show_answer", {
      session_id: s.session_id,
      card_id: skipped.card_id,
    });
    const last = await call(user, "submit_review", {
      session_id: s.session_id,
      card_id: skipped.card_id,
      rating: 4,
    });
    expect(last.next.done).toBe(true); // the skipped card is not offered again
    expect(await logs(user)).toBe(1);
    expect((await row(user, "cards", s.card_id)).model.reps).toBe(0);
  });

  it("shows an edited card's new text and refuses a card that was suspended mid-session", async () => {
    const { user, deck } = await setup();
    const [id] = await addBasic(user, deck, [["old", "old-back"]]);
    const s = await call(user, "start_study_session", { deck_id: deck });
    await call(user, "edit_card", { card_id: id, back: "new-back" });
    const a = await call(user, "show_answer", {
      session_id: s.session_id,
      card_id: id,
    });
    expect(a.answer.back).toBe("new-back");
    await call(user, "edit_card", { card_id: id, suspended: true });
    const r = await call(user, "submit_review", {
      session_id: s.session_id,
      card_id: id,
      rating: 3,
    });
    expect(r.code).toBe("card_unavailable");
    expect(await logs(user)).toBe(0);
    const moved = await call(user, "next_card", {
      session_id: s.session_id,
      skip: true,
    });
    expect(moved.done).toBe(true);
  });

  it("stops at the card limit", async () => {
    const { user, deck } = await setup();
    await addBasic(user, deck, [
      ["a", "1"],
      ["b", "2"],
    ]);
    const s = await call(user, "start_study_session", {
      deck_id: deck,
      limit: 1,
    });
    await call(user, "show_answer", {
      session_id: s.session_id,
      card_id: s.card_id,
    });
    const r = await call(user, "submit_review", {
      session_id: s.session_id,
      card_id: s.card_id,
      rating: 3,
    });
    expect(r.next).toMatchObject({ done: true, reason: "limit_reached" });
  });

  it("expires after two idle hours but still lets the learner end it", async () => {
    const { user, deck } = await setup();
    await addBasic(user, deck, [["a", "1"]]);
    const s = await call(user, "start_study_session", { deck_id: deck });
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 3 * 3_600_000 });
    const args = { session_id: s.session_id, card_id: s.card_id, rating: 3 };
    expect((await call(user, "show_answer", args)).code).toBe(
      "session_expired"
    );
    expect((await call(user, "submit_review", args)).code).toBe(
      "session_expired"
    );
    expect((await call(user, "next_card", args)).code).toBe("session_expired");
    expect(await logs(user)).toBe(0);
    expect((await call(user, "end_session", args)).ended).toBe(true);
  });

  it("ends with a summary, repeats safely, and then refuses new answers", async () => {
    const { user, deck } = await setup();
    await addBasic(user, deck, [
      ["a", "1"],
      ["b", "2"],
    ]);
    const s = await call(user, "start_study_session", { deck_id: deck });
    const args = { session_id: s.session_id, card_id: s.card_id, rating: 3 };
    await call(user, "show_answer", args);
    const g = await call(user, "submit_review", args);
    const done = await call(user, "end_session", {
      session_id: s.session_id,
    });
    expect(done).toMatchObject({
      reviewed: 1,
      ratings: { good: 1, again: 0, hard: 0, easy: 0 },
    });
    const twice = await call(user, "end_session", {
      session_id: s.session_id,
    });
    expect(twice.reviewed).toBe(1);
    expect(twice.duration_ms).toBe(done.duration_ms);
    expect(
      (await call(user, "show_answer", { ...args, card_id: g.next.card_id }))
        .code
    ).toBe("session_ended");
    // a late retry of the saved answer still gets its saved result
    expect((await call(user, "submit_review", args)).duplicate).toBe(true);
    expect(await logs(user)).toBe(1);
  });

  it("keeps sessions private to their user and validates input", async () => {
    const a = await setup();
    const b = await setup();
    await addBasic(a.user, a.deck, [["a", "1"]]);
    const s = await call(a.user, "start_study_session", { deck_id: a.deck });
    const args = { session_id: s.session_id, card_id: s.card_id, rating: 3 };
    for (const tool of [
      "show_answer",
      "submit_review",
      "next_card",
      "end_session",
    ])
      expect((await call(b.user, tool, args)).code).toBe("session_not_found");
    expect(
      (await call(b.user, "start_study_session", { deck_id: a.deck })).code
    ).toBe("deck_not_found");
    expect((await call(a.user, "start_study_session", { limit: 0 })).code).toBe(
      "invalid_argument"
    );
    expect((await sessionRow(a.user, s.session_id)).turn).toBe(1);
  });
});
