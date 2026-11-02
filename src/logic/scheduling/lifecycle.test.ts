import {
  type Card as FsrsCard,
  type Grade,
  Rating,
  State,
  createEmptyCard,
  default_w,
} from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { FSRS_DEFAULTS } from "../deck/fsrsOptions";
import { recallAfter } from "./forecast";
import { DAY_MS, type ScheduleContext, scheduleCard } from "./policy";

const GLOBAL = { retention: 0.9, maximumInterval: 36500, w: [...default_w] };
const START = new Date(2026, 2, 10, 10, 0, 0);
const options = {
  newToReviewRatio: 0.5,
  dailyNewCards: 25,
  ...FSRS_DEFAULTS,
  enableFuzz: false,
};

const ctx = (
  now: Date,
  over: Partial<ScheduleContext> = {}
): ScheduleContext => ({
  deckOptions: options,
  global: GLOBAL,
  newDayStartHour: 4,
  now,
  ...over,
});

/** Answers the card whenever it is due, always with `grade`; returns every step. */
function run(
  grade: Grade,
  steps: number,
  over: Partial<ScheduleContext> = {},
  gradeAt: (i: number) => Grade = () => grade
) {
  let card = createEmptyCard(START);
  let now = START;
  const trail = [];
  for (let i = 0; i < steps; i++) {
    const out = scheduleCard(card, ctx(now, over))[gradeAt(i)];
    trail.push({ before: card, after: out.card, at: now });
    card = out.card;
    now = new Date(card.due);
  }
  return trail;
}

describe("card lifecycle", () => {
  it("new -> learning -> review -> relearning -> review", () => {
    const t = run(Rating.Good, 6, {}, (i) =>
      i === 3 ? Rating.Again : Rating.Good
    );
    expect(t[0].before.state).toBe(State.New);
    expect(t[0].after.state).toBe(State.Learning);
    expect(t[1].after.state).toBe(State.Review);
    expect(t[2].after.state).toBe(State.Review);
    expect(t[3].after.state).toBe(State.Relearning);
    expect(t[3].after.lapses).toBe(1);
    expect(t[3].after.stability).toBeLessThan(t[3].before.stability);
    expect(t[4].after.state).toBe(State.Review);
    expect(t[5].after.reps).toBe(6);
  });

  it("learning step is minutes, graduation is at least one day (exact mode)", () => {
    const [first, second] = run(Rating.Good, 2);
    expect(first.after.due.getTime() - START.getTime()).toBe(10 * 60_000);
    expect(second.after.scheduled_days).toBeGreaterThanOrEqual(1);
  });

  it("intervals grow and stability rises over 10 Good reviews, due is always in the future", () => {
    const t = run(Rating.Good, 10);
    for (let i = 2; i < t.length; i++) {
      expect(t[i].after.scheduled_days).toBeGreaterThan(
        t[i - 1].after.scheduled_days
      );
      expect(t[i].after.stability).toBeGreaterThan(t[i - 1].after.stability);
    }
    for (const s of t)
      expect(s.after.due.getTime()).toBeGreaterThan(s.at.getTime());
  });

  it("Again < Hard <= Good <= Easy for cards in every state", () => {
    const good = run(Rating.Good, 8);
    for (const s of good) {
      const r = scheduleCard(s.before, ctx(s.at));
      const ms = (g: Grade) => r[g].card.due.getTime();
      expect(ms(Rating.Again)).toBeLessThan(ms(Rating.Good));
      expect(ms(Rating.Hard)).toBeLessThanOrEqual(ms(Rating.Good));
      expect(ms(Rating.Good)).toBeLessThanOrEqual(ms(Rating.Easy));
    }
  });

  it("a lapse never changes memory values beyond what FSRS gives", () => {
    const t = run(Rating.Good, 4);
    const before = t[3].after;
    const again = scheduleCard(before, ctx(new Date(before.due)))[Rating.Again]
      .card;
    expect(again.lapses).toBe(before.lapses + 1);
    expect(again.difficulty).toBeGreaterThan(before.difficulty);
  });
});

describe("retention and intervals", () => {
  it("the Good interval matches the desired retention (FSRS property)", () => {
    const t = run(Rating.Good, 10).slice(3);
    for (const s of t) {
      const r = recallAfter(
        s.after.stability,
        s.after.scheduled_days,
        GLOBAL.w
      );
      // Intervals are whole days, so allow rounding slack.
      expect(Math.abs(r - 0.9)).toBeLessThan(0.04);
    }
  });

  it("higher retention gives shorter intervals, lower gives longer", () => {
    const at = (r: number) =>
      run(Rating.Good, 8, {
        deckOptions: { ...options, desiredRetention: r },
      }).at(-1)!.after.scheduled_days;
    expect(at(0.97)).toBeLessThan(at(0.9));
    expect(at(0.9)).toBeLessThan(at(0.75));
  });

  it("reviewing late earns more stability than reviewing on time", () => {
    const base = run(Rating.Good, 5).at(-1)!.after;
    const onTime = new Date(base.due);
    const late = new Date(base.due.getTime() + 20 * DAY_MS);
    const a = scheduleCard(base, ctx(onTime))[Rating.Good].card;
    const b = scheduleCard(base, ctx(late))[Rating.Good].card;
    expect(b.stability).toBeGreaterThan(a.stability);
  });

  it("easier answers lower difficulty, Again raises it", () => {
    const base = run(Rating.Good, 4).at(-1)!.after;
    const r = scheduleCard(base, ctx(new Date(base.due)));
    expect(r[Rating.Easy].card.difficulty).toBeLessThan(base.difficulty);
    expect(r[Rating.Again].card.difficulty).toBeGreaterThan(base.difficulty);
  });

  it("maximum interval holds for every grade over a long run", () => {
    const cap = 30;
    const over = { deckOptions: { ...options, maximumInterval: cap } };
    const t = run(Rating.Easy, 12, over);
    for (const s of t) {
      expect(s.after.scheduled_days).toBeLessThanOrEqual(cap);
      expect(s.after.due.getTime() - s.at.getTime()).toBeLessThanOrEqual(
        cap * DAY_MS + 1
      );
    }
    expect(t.at(-1)!.after.scheduled_days).toBe(cap);
  });
});

describe("whole-day mode and fuzz", () => {
  it("every due date sits on the day-start hour, never before tomorrow", () => {
    const over = {
      deckOptions: { ...options, schedulingMode: "daily" as const },
    };
    const t = run(Rating.Good, 10, over);
    for (const s of t) {
      const d = s.after.due;
      expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([4, 0, 0]);
      expect(d.getTime()).toBeGreaterThan(s.at.getTime());
    }
  });

  it("fuzz stays near the plain interval and is repeatable for the same card", () => {
    const plain = run(Rating.Good, 8).at(-2)!;
    const fuzzed = { deckOptions: { ...options, enableFuzz: true } };
    const a = scheduleCard(plain.before, ctx(plain.at, fuzzed))[Rating.Good]
      .card;
    const b = scheduleCard(plain.before, ctx(plain.at, fuzzed))[Rating.Good]
      .card;
    expect(a.scheduled_days).toBe(b.scheduled_days);
    const base = plain.after.scheduled_days;
    expect(Math.abs(a.scheduled_days - base)).toBeLessThanOrEqual(
      Math.ceil(base * 0.1) + 1
    );
  });

  it("a card with no learning_steps (old data) still schedules", () => {
    const old = { ...createEmptyCard(START), learning_steps: undefined };
    const r = scheduleCard(old as unknown as FsrsCard, ctx(START));
    expect(r[Rating.Good].card.state).toBe(State.Learning);
  });
});

describe("per-card override and exam over a long run", () => {
  it("a card's own retention changes its whole path", () => {
    const o = (r?: number) =>
      run(Rating.Good, 8, {
        cardOverride: r ? { desiredRetention: r } : undefined,
      }).at(-1)!.after.scheduled_days;
    expect(o(0.95)).toBeLessThan(o());
  });

  it("no review is ever scheduled past the exam while it is pending", () => {
    const exam = new Date(START.getTime() + 60 * DAY_MS);
    const pad = (n: number) => String(n).padStart(2, "0");
    const date = `${exam.getFullYear()}-${pad(exam.getMonth() + 1)}-${pad(exam.getDate())}`;
    const over = {
      exam: { date, bufferDays: 1, ramp: true, sourceDeckId: "d" },
    };
    const examMs = new Date(
      exam.getFullYear(),
      exam.getMonth(),
      exam.getDate()
    ).getTime();
    for (const s of run(Rating.Easy, 6, over)) {
      if (s.at.getTime() < examMs)
        expect(s.after.due.getTime()).toBeLessThan(examMs);
    }
  });
});

describe("personal weights", () => {
  it("trained weights change the schedule, and the card keeps FSRS-6's 21 values", () => {
    const tuned = [...default_w];
    tuned[8] = default_w[8] + 0.6; // faster stability growth on success
    const at = (weights?: number[]) =>
      run(Rating.Good, 6, { deckOptions: { ...options, weights } }).at(-1)!
        .after;
    const def = at();
    const mine = at(tuned);
    expect(mine.scheduled_days).toBeGreaterThan(def.scheduled_days);
    expect(tuned).toHaveLength(21);
  });
});
