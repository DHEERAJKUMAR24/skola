import { FSRS, Rating, State, default_w, generatorParameters } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { createCardSkeleton } from "./createCardSkeleton";

describe("ts-fsrs scheduling", () => {
  it("uses FSRS-6 weights (21 values)", () => {
    expect(default_w).toHaveLength(21);
  });

  it("schedules a new card and moves it out of New", () => {
    const scheduler = new FSRS(generatorParameters());
    const { model } = createCardSkeleton();
    const result = scheduler.repeat(model, new Date());
    expect(result[Rating.Good].card.state).not.toBe(State.New);
    expect(result[Rating.Good].log.rating).toBe(Rating.Good);
  });

  it("schedules a card stored by old fsrs.js (no learning_steps)", () => {
    const scheduler = new FSRS(generatorParameters());
    const now = new Date();
    const legacy = {
      due: now,
      stability: 5,
      difficulty: 5,
      elapsed_days: 5,
      scheduled_days: 5,
      reps: 3,
      lapses: 0,
      state: State.Review,
      last_review: new Date(now.getTime() - 5 * 864e5),
    };
    const result = scheduler.repeat(
      { ...legacy, learning_steps: (legacy as any).learning_steps ?? 0 },
      now
    );
    expect(result[Rating.Good].card.scheduled_days).toBeGreaterThan(0);
  });
});
