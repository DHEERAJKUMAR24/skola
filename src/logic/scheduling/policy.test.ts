import { Rating, State, createEmptyCard, default_w } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import type { Deck } from "../deck/deck";
import { FSRS_DEFAULTS } from "../deck/fsrsOptions";
import { forecastExam } from "./forecast";
import {
  DAY_MS,
  type ScheduleContext,
  effectiveRetention,
  isStudyable,
  limitNewCards,
  logicalDayStart,
  resolveExam,
  scheduleCard,
} from "./policy";

const GLOBAL = { retention: 0.9, maximumInterval: 36500, w: [...default_w] };
const NOW = new Date(2026, 2, 10, 10, 0, 0); // 10 Mar 2026, 10:00 local
const baseOptions = {
  newToReviewRatio: 0.5,
  dailyNewCards: 25,
  ...FSRS_DEFAULTS,
  enableFuzz: false,
};
const GRADES = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;

const ctx = (over: Partial<ScheduleContext> = {}): ScheduleContext => ({
  deckOptions: baseOptions,
  global: GLOBAL,
  newDayStartHour: 4,
  now: NOW,
  ...over,
});

const reviewCard = () => ({
  ...createEmptyCard(NOW),
  state: State.Review,
  stability: 40,
  difficulty: 5,
  reps: 6,
  last_review: new Date(NOW.getTime() - 40 * DAY_MS),
  due: NOW,
});

const examIn = (days: number, bufferDays = 1, ramp = true) => {
  const d = new Date(NOW.getTime() + days * DAY_MS);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${month}-${day}`,
    bufferDays,
    ramp,
    sourceDeckId: "d",
  };
};

describe("exact vs whole-day scheduling", () => {
  it("exact mode counts from the moment you answer, with minute steps", () => {
    const r = scheduleCard(createEmptyCard(NOW), ctx());
    expect(r[Rating.Again].card.due.getTime() - NOW.getTime()).toBe(60_000);
    expect(r[Rating.Good].card.due.getTime() - NOW.getTime()).toBe(10 * 60_000);
  });

  it("daily mode has no minute steps and falls due when a day starts", () => {
    const r = scheduleCard(
      createEmptyCard(NOW),
      ctx({ deckOptions: { ...baseOptions, schedulingMode: "daily" } })
    );
    for (const g of GRADES) {
      const due = r[g].card.due;
      expect(due.getHours()).toBe(4);
      expect(due.getMinutes()).toBe(0);
      expect(due.getTime()).toBeGreaterThan(NOW.getTime() + 12 * 3_600_000);
    }
  });

  it("daily mode counts days from the study day, not the clock", () => {
    // 02:00 still belongs to the previous study day when days start at 04:00.
    const late = new Date(2026, 2, 10, 2, 0, 0);
    const card = {
      ...createEmptyCard(late),
      state: State.Review,
      stability: 5,
      difficulty: 5,
      reps: 3,
      last_review: new Date(late.getTime() - 5 * DAY_MS),
      due: late,
    };
    const r = scheduleCard(
      card,
      ctx({
        now: late,
        deckOptions: { ...baseOptions, schedulingMode: "daily" },
      })
    );
    const days = r[Rating.Good].card.scheduled_days;
    const expected = logicalDayStart(late, 4);
    expected.setDate(expected.getDate() + days);
    expect(r[Rating.Good].card.due.getTime()).toBe(expected.getTime());
  });
});

describe("exam date", () => {
  it("pulls a later due date back so the card is seen before the exam", () => {
    const exam = examIn(30);
    const r = scheduleCard(reviewCard(), ctx({ exam }));
    const examStart = new Date(`${exam.date}T00:00:00`).getTime();
    for (const g of GRADES)
      expect(r[g].card.due.getTime()).toBeLessThanOrEqual(examStart - DAY_MS);
    // without the exam, the Easy card would fall due long after it
    const free = scheduleCard(reviewCard(), ctx());
    expect(free[Rating.Easy].card.due.getTime()).toBeGreaterThan(examStart);
  });

  it("only moves the due date; FSRS memory values are untouched", () => {
    const capped = scheduleCard(
      reviewCard(),
      ctx({ exam: examIn(30, 1, false) })
    )[Rating.Easy].card;
    const free = scheduleCard(reviewCard(), ctx())[Rating.Easy].card;
    expect(capped.stability).toBe(free.stability);
    expect(capped.difficulty).toBe(free.difficulty);
    expect(capped.scheduled_days).toBe(free.scheduled_days);
    expect(capped.due.getTime()).toBeLessThan(free.due.getTime());
  });

  it("raises retention as the exam nears, never lowers it, and ignores far-off exams", () => {
    expect(effectiveRetention(0.9, 100)).toBe(0.9);
    expect(effectiveRetention(0.9, 0)).toBe(0.9);
    expect(effectiveRetention(0.9, 22.5)).toBeCloseTo(0.935, 3);
    expect(effectiveRetention(0.98, 10)).toBe(0.98);
    const near = scheduleCard(reviewCard(), ctx({ exam: examIn(20, 0) }))[
      Rating.Good
    ].card.scheduled_days;
    const none = scheduleCard(reviewCard(), ctx())[Rating.Good].card
      .scheduled_days;
    expect(near).toBeLessThan(none);
  });

  it("does nothing once the exam date has passed", () => {
    const past = scheduleCard(reviewCard(), ctx({ exam: examIn(-3) }));
    const none = scheduleCard(reviewCard(), ctx());
    expect(past[Rating.Good].card.due.getTime()).toBe(
      none[Rating.Good].card.due.getTime()
    );
  });

  it("whole-day decks keep exam due dates on a day boundary", () => {
    const r = scheduleCard(
      reviewCard(),
      ctx({
        exam: examIn(10),
        deckOptions: { ...baseOptions, schedulingMode: "daily" },
      })
    );
    expect(r[Rating.Easy].card.due.getHours()).toBe(4);
  });

  it("uses the nearest ancestor's exam date", () => {
    const mk = (id: string, supers: string[], examDate?: string): Deck => ({
      id,
      name: id,
      subDecks: [],
      superDecks: supers,
      cards: [],
      notes: [],
      options: {
        newToReviewRatio: 0.5,
        dailyNewCards: 25,
        ...(examDate ? { examDate } : {}),
      },
    });
    const all = [
      mk("domain", [], "2026-06-01"),
      mk("subject", ["domain"], "2026-05-01"),
      mk("concept", ["domain", "subject"]),
      mk("other", ["domain"]),
    ];
    const byId = new Map(all.map((d) => [d.id, d]));
    expect(resolveExam(byId.get("concept"), byId)?.date).toBe("2026-05-01");
    expect(resolveExam(byId.get("other"), byId)?.date).toBe("2026-06-01");
    expect(resolveExam(byId.get("domain"), byId)?.sourceDeckId).toBe("domain");
    expect(resolveExam(undefined, byId)).toBeUndefined();
  });
});

describe("card overrides", () => {
  it("a card's own retention beats the deck's", () => {
    const deck = scheduleCard(reviewCard(), ctx())[Rating.Good].card
      .scheduled_days;
    const strict = scheduleCard(
      reviewCard(),
      ctx({ cardOverride: { desiredRetention: 0.97 } })
    )[Rating.Good].card.scheduled_days;
    expect(strict).toBeLessThan(deck);
  });

  it("a card's own maximum interval caps it", () => {
    const r = scheduleCard(
      reviewCard(),
      ctx({ cardOverride: { maximumInterval: 10 } })
    );
    expect(r[Rating.Easy].card.scheduled_days).toBeLessThanOrEqual(10);
  });
});

describe("study eligibility and limits", () => {
  it("hides suspended and buried cards", () => {
    expect(isStudyable({}, NOW)).toBe(true);
    expect(isStudyable({ suspended: true }, NOW)).toBe(false);
    expect(isStudyable({ buriedUntil: NOW.getTime() + 1000 }, NOW)).toBe(false);
    expect(isStudyable({ buriedUntil: NOW.getTime() - 1000 }, NOW)).toBe(true);
  });

  it("applies each deck's daily new-card limit, counting what it already showed today", () => {
    const cards = [
      { id: "a0", deck: "A" },
      { id: "a1", deck: "A" },
      { id: "a2", deck: "A" },
      { id: "a3", deck: "A" },
      { id: "b0", deck: "B" },
      { id: "b1", deck: "B" },
    ];
    const kept = limitNewCards(
      cards,
      (d) => (d === "A" ? 3 : undefined),
      new Map([["A", 1]])
    );
    expect(kept.filter((c) => c.deck === "A").map((c) => c.id)).toEqual([
      "a0",
      "a1",
    ]);
    expect(kept.filter((c) => c.deck === "B")).toHaveLength(2); // no limit
  });
});

describe("exam forecast", () => {
  const input = {
    examDate: examIn(20).date,
    now: NOW,
    targetRetention: 0.9,
    bufferDays: 1,
    w: [...default_w],
  };

  it("counts new, learned and at-risk cards and recommends a pace", () => {
    const fresh = { model: createEmptyCard(NOW) };
    const strong = {
      model: {
        ...reviewCard(),
        stability: 400,
        due: new Date(NOW.getTime() + 300 * DAY_MS),
      },
    };
    const weak = {
      model: { ...reviewCard(), stability: 2, last_review: NOW, due: NOW },
    };
    const f = forecastExam([fresh, fresh, fresh, strong, weak], input);
    expect(f).toMatchObject({ total: 5, newCards: 3, learned: 2 });
    expect(f.atRisk).toBe(1);
    expect(f.dueBeforeExam).toBe(1);
    expect(f.avgRecall).toBeGreaterThan(0);
    expect(f.expectedScore).toBeLessThan(f.avgRecall); // unlearned cards drag it down
    expect(f.newPerDay).toBe(1); // 3 new cards over ~18 days
    expect(f.daysLeft).toBeGreaterThan(19);
  });

  it("handles an empty deck", () => {
    expect(forecastExam([], input)).toMatchObject({
      total: 0,
      expectedScore: 0,
      newPerDay: 0,
    });
  });
});

describe("deck schedule summary", () => {
  it("buckets due cards by study day and averages memory", async () => {
    const { deckSchedule } = await import("./summary");
    const mk = (days: number, extra = {}) => ({
      model: { ...reviewCard(), due: new Date(NOW.getTime() + days * DAY_MS) },
      ...extra,
    });
    const s = deckSchedule(
      [
        mk(-2),
        mk(0.1),
        mk(1),
        mk(30),
        mk(1, { suspended: true }),
        { model: createEmptyCard(NOW) },
      ],
      NOW,
      4,
      [...default_w]
    );
    expect(s.overdue).toBe(1);
    expect(s.perDay.reduce((a, b) => a + b, 0)).toBe(2);
    expect(s.later).toBe(1);
    expect(s.studied).toBe(5);
    expect(s.newCards).toBe(1);
    expect(s.mature).toBe(5);
    expect(s.avgStability).toBe(40);
  });
});
