import { describe, expect, it } from "vitest";
import { fromPresetForm, toPresetForm } from "./presetForm";
import { PRESET_DEFAULTS, type StudyPreset } from "./presets";

const base: StudyPreset = {
  id: "p",
  name: "Mine",
  ...PRESET_DEFAULTS,
  weights: Array(21).fill(0.5),
};

describe("preset form", () => {
  it("round-trips a preset and keeps what the form does not edit", () => {
    const r = fromPresetForm(toPresetForm(base), base);
    expect("preset" in r && r.preset).toEqual({ ...base, easyDays: [] });
    expect("preset" in r && r.preset.weights).toEqual(base.weights);
    expect("preset" in r && r.preset.id).toBe("p");
  });

  it("reads edited values and sorts easy days", () => {
    const f = {
      ...toPresetForm(base),
      name: "  Cram  ",
      newCardsPerDay: "5",
      maxReviewsPerDay: "0",
      retentionPct: "95",
      learningSteps: "1m, 5m 1h",
      easyDays: [6, 0],
      leechThreshold: "0",
    };
    const r = fromPresetForm(f, base);
    expect("preset" in r && r.preset).toMatchObject({
      name: "Cram",
      newCardsPerDay: 5,
      maxReviewsPerDay: 0,
      desiredRetention: 0.95,
      learningSteps: ["1m", "5m", "1h"],
      easyDays: [0, 6],
      leechThreshold: 0,
    });
  });

  it("reports every invalid field", () => {
    const r = fromPresetForm(
      {
        ...toPresetForm(base),
        name: " ",
        newCardsPerDay: "-1",
        maxReviewsPerDay: "1.5",
        learningSteps: "x",
        relearningSteps: "0m",
        retentionPct: "100",
        maximumInterval: "0",
        leechThreshold: "abc",
        easyDays: [0, 1, 2, 3, 4, 5, 6],
      },
      base
    );
    expect("errors" in r && Object.keys(r.errors).sort()).toEqual([
      "easyDays",
      "learningSteps",
      "leechThreshold",
      "maxReviewsPerDay",
      "maximumInterval",
      "name",
      "newCardsPerDay",
      "relearningSteps",
      "retention",
    ]);
  });
});
