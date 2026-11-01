import { Rating, State, createEmptyCard, default_w } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { FSRS_DEFAULTS } from "../deck/fsrsOptions";
import {
  DAY_MS,
  addDays,
  applyRandomOrder,
  avoidEasyDays,
  isLeechLapse,
  scheduleCard,
  siblingsToBury,
} from "./policy";

const GLOBAL = { retention: 0.9, maximumInterval: 36500, w: [...default_w] };
const NOW = new Date(2026, 2, 10, 10, 0, 0); // Tuesday
const base = {
  newToReviewRatio: 0.5,
  dailyNewCards: 20,
  ...FSRS_DEFAULTS,
  enableFuzz: false,
};
const review = () => ({
  ...createEmptyCard(NOW),
  state: State.Review,
  stability: 20,
  difficulty: 5,
  reps: 5,
  last_review: new Date(NOW.getTime() - 20 * DAY_MS),
  due: NOW,
});

describe("easy days", () => {
  const earliest = addDays(NOW, 1);

  it("moves a due date earlier off an avoided weekday", () => {
    const sunday = new Date(2026, 2, 15, 10); // Sunday
    expect(avoidEasyDays(sunday, [0], earliest).getDay()).toBe(6); // Saturday
    expect(avoidEasyDays(sunday, [0, 6], earliest).getDay()).toBe(5); // Friday
  });

  it("never goes before the earliest allowed day or when every day is easy", () => {
    const wed = new Date(2026, 2, 11, 10);
    expect(avoidEasyDays(wed, [3, 2], earliest).getTime()).toBe(wed.getTime());
    expect(avoidEasyDays(wed, [0, 1, 2, 3, 4, 5, 6], earliest)).toBe(wed);
    expect(avoidEasyDays(wed, [], earliest)).toBe(wed);
  });

  it("is applied by scheduleCard to longer intervals only", () => {
    const ctx = (easyDays: number[]) => ({
      deckOptions: { ...base, easyDays },
      global: GLOBAL,
      newDayStartHour: 4,
      now: NOW,
    });
    const free = scheduleCard(review(), ctx([]))[Rating.Good].card.due;
    const avoided = scheduleCard(review(), ctx([free.getDay()]))[Rating.Good]
      .card.due;
    expect(avoided.getDay()).not.toBe(free.getDay());
    expect(avoided.getTime()).toBeLessThan(free.getTime());

    // a 1-day relearning interval is left alone
    const again = scheduleCard(
      review(),
      ctx([0, 1, 2, 3, 4, 5, 6].filter((d) => d !== 1))
    )[Rating.Again].card;
    expect(again.scheduled_days).toBeLessThan(3);
  });
});

describe("leeches", () => {
  it("triggers at the threshold, then every half threshold", () => {
    expect(isLeechLapse(7, 8, 8)).toBe(true);
    expect(isLeechLapse(8, 9, 8)).toBe(false);
    expect(isLeechLapse(11, 12, 8)).toBe(true); // 8 + 4
    expect(isLeechLapse(15, 16, 8)).toBe(true); // 8 + 8
  });

  it("does nothing when off, or when the card did not lapse", () => {
    expect(isLeechLapse(7, 8, 0)).toBe(false);
    expect(isLeechLapse(8, 8, 8)).toBe(false);
    expect(isLeechLapse(2, 3, 8)).toBe(false);
  });
});

describe("siblings", () => {
  const card = (id: string, note: string, state: number) => ({
    id,
    note,
    model: { state },
  });
  const all = [
    card("a", "n1", State.Review),
    card("b", "n1", State.New),
    card("c", "n1", State.Review),
    card("d", "n2", State.New),
  ];

  it("buries new and review siblings of the same note independently", () => {
    expect(
      siblingsToBury(all[0], all, { buryNewSiblings: true }).map((c) => c.id)
    ).toEqual(["b"]);
    expect(
      siblingsToBury(all[0], all, { buryReviewSiblings: true }).map((c) => c.id)
    ).toEqual(["c"]);
    expect(
      siblingsToBury(all[0], all, {
        buryNewSiblings: true,
        buryReviewSiblings: true,
      }).map((c) => c.id)
    ).toEqual(["b", "c"]);
    expect(siblingsToBury(all[0], all, {})).toEqual([]);
  });
});

describe("random new-card order", () => {
  const cards = [..."abcdef"].map((x, i) => ({
    id: x,
    deck: i < 3 ? "R" : "S",
  }));

  it("shuffles only random decks, keeps the others in place, and is stable for a seed", () => {
    const out = applyRandomOrder(cards, (d) => d === "R", "day1");
    expect(out.slice(3)).toEqual(cards.slice(3));
    expect(
      out
        .slice(0, 3)
        .map((c) => c.id)
        .sort()
    ).toEqual(["a", "b", "c"]);
    expect(applyRandomOrder(cards, (d) => d === "R", "day1")).toEqual(out);
    const orders = new Set(
      ["d1", "d2", "d3", "d4", "d5", "d6"].map((s) =>
        applyRandomOrder(cards, (d) => d === "R", s)
          .map((c) => c.id)
          .join("")
      )
    );
    expect(orders.size).toBeGreaterThan(1); // different days give different orders
  });

  it("returns the same order when nothing is random", () => {
    expect(applyRandomOrder(cards, () => false, "x")).toEqual(cards);
  });
});
