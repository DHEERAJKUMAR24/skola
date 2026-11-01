import { Rating, State, createEmptyCard } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import {
  FSRS_DEFAULTS,
  applyPreset,
  fromFormState,
  parseSteps,
  resolveParams,
  schedulerFor,
  toFormState,
} from "./fsrsOptions";

const GLOBAL = { retention: 0.9, maximumInterval: 36500, w: [] as number[] };
const T0 = new Date("2026-01-01T00:00:00Z");
const minutes = (d: Date) => Math.round((d.getTime() - T0.getTime()) / 60_000);

describe("steps", () => {
  it("parses valid steps and rejects bad ones", () => {
    expect(parseSteps("1m 10m")).toEqual(["1m", "10m"]);
    expect(parseSteps("1m, 1h,1d")).toEqual(["1m", "1h", "1d"]);
    expect(parseSteps("")).toEqual([]); // turns short-term learning off
    expect(parseSteps("0m")).toBeNull();
    expect(parseSteps("abc")).toBeNull();
    expect(parseSteps("10")).toBeNull();
    expect(parseSteps("1m 2m 3m 4m 5m 6m 7m 8m 9m")).toBeNull();
  });
});

describe("form <-> options", () => {
  it("a new deck is the Balanced preset", () => {
    const s = toFormState();
    expect(s.preset).toBe("balanced");
    const r = fromFormState(s);
    expect("options" in r && r.options).toEqual(FSRS_DEFAULTS);
  });

  it("presets change only retention", () => {
    const r = fromFormState(applyPreset("intensive"));
    expect("options" in r && r.options).toEqual({
      ...FSRS_DEFAULTS,
      desiredRetention: 0.95,
    });
  });

  it("anything else shows as Custom", () => {
    expect(
      toFormState({ ...FSRS_DEFAULTS, desiredRetention: 0.93 }).preset
    ).toBe("custom");
    expect(toFormState({ ...FSRS_DEFAULTS, enableFuzz: false }).preset).toBe(
      "custom"
    );
    expect(
      toFormState({ ...FSRS_DEFAULTS, learningSteps: ["5m"] }).preset
    ).toBe("custom");
  });

  it("reports every invalid field", () => {
    const r = fromFormState({
      preset: "custom",
      retentionPct: "50",
      maximumInterval: "0",
      learningSteps: "x",
      relearningSteps: "y",
      enableFuzz: true,
    });
    expect("errors" in r && Object.keys(r.errors).sort()).toEqual([
      "learningSteps",
      "maximumInterval",
      "relearningSteps",
      "retention",
    ]);
  });
});

describe("scheduling with deck options", () => {
  const first = (opts: Parameters<typeof resolveParams>[0]) =>
    schedulerFor(resolveParams(opts, GLOBAL)).repeat(createEmptyCard(T0), T0);

  it("uses the deck's learning steps", () => {
    const r = first({ ...FSRS_DEFAULTS, learningSteps: ["2m", "20m"] });
    expect(minutes(r[Rating.Again].card.due)).toBe(2);
    expect(minutes(r[Rating.Good].card.due)).toBe(20);
    expect(r[Rating.Good].card.state).toBe(State.Learning);
  });

  it("empty learning steps skip short-term learning", () => {
    const r = first({ ...FSRS_DEFAULTS, learningSteps: [] });
    expect(r[Rating.Good].card.state).toBe(State.Review);
    expect(minutes(r[Rating.Good].card.due)).toBeGreaterThanOrEqual(24 * 60);
  });

  it("a higher desired retention schedules reviews sooner", () => {
    const reviewCard = {
      ...createEmptyCard(T0),
      state: State.Review,
      stability: 30,
      difficulty: 5,
      reps: 5,
      last_review: new Date(T0.getTime() - 30 * 864e5),
      due: T0,
    };
    const days = (retention: number) =>
      schedulerFor(
        resolveParams(
          { ...FSRS_DEFAULTS, desiredRetention: retention, enableFuzz: false },
          GLOBAL
        )
      ).repeat(reviewCard, T0)[Rating.Good].card.scheduled_days;
    expect(days(0.95)).toBeLessThan(days(0.9));
    expect(days(0.9)).toBeLessThan(days(0.8));
  });

  it("the maximum interval caps scheduling", () => {
    const r = first({
      ...FSRS_DEFAULTS,
      maximumInterval: 7,
      enableFuzz: false,
    });
    expect(r[Rating.Easy].card.scheduled_days).toBeLessThanOrEqual(7);
  });

  it("decks without options keep the global settings and old behavior", () => {
    const p = resolveParams(undefined, {
      ...GLOBAL,
      retention: 0.85,
      maximumInterval: 1000,
    });
    expect(p.request_retention).toBe(0.85);
    expect(p.maximum_interval).toBe(1000);
    expect(p.enable_fuzz).toBe(false);
  });

  it("reuses one scheduler per distinct parameter set", () => {
    const a = schedulerFor(resolveParams(FSRS_DEFAULTS, GLOBAL));
    const b = schedulerFor(resolveParams({ ...FSRS_DEFAULTS }, GLOBAL));
    const c = schedulerFor(
      resolveParams({ ...FSRS_DEFAULTS, desiredRetention: 0.8 }, GLOBAL)
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
