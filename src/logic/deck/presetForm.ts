import { RETENTION_MAX, RETENTION_MIN, parseSteps } from "./fsrsOptions";
import type { StudyPreset } from "./presets";

/** Everything the preset editor edits, as strings so partial typing is allowed. */
export interface PresetForm {
  name: string;
  newCardsPerDay: string;
  maxReviewsPerDay: string;
  newCardOrder: StudyPreset["newCardOrder"];
  learningSteps: string;
  relearningSteps: string;
  schedulingMode: StudyPreset["schedulingMode"];
  retentionPct: string;
  maximumInterval: string;
  enableFuzz: boolean;
  easyDays: number[];
  buryNewSiblings: boolean;
  buryReviewSiblings: boolean;
  leechThreshold: string;
  leechAction: StudyPreset["leechAction"];
}

export type PresetFormErrors = Partial<
  Record<
    | "name"
    | "newCardsPerDay"
    | "maxReviewsPerDay"
    | "learningSteps"
    | "relearningSteps"
    | "retention"
    | "maximumInterval"
    | "leechThreshold"
    | "easyDays",
    string
  >
>;

export const toPresetForm = (p: StudyPreset): PresetForm => ({
  name: p.name,
  newCardsPerDay: String(p.newCardsPerDay),
  maxReviewsPerDay: String(p.maxReviewsPerDay),
  newCardOrder: p.newCardOrder,
  learningSteps: p.learningSteps.join(" "),
  relearningSteps: p.relearningSteps.join(" "),
  schedulingMode: p.schedulingMode,
  retentionPct: String(Math.round(p.desiredRetention * 100)),
  maximumInterval: String(p.maximumInterval),
  enableFuzz: p.enableFuzz,
  easyDays: p.easyDays,
  buryNewSiblings: p.buryNewSiblings,
  buryReviewSiblings: p.buryReviewSiblings,
  leechThreshold: String(p.leechThreshold),
  leechAction: p.leechAction,
});

const isWhole = (s: string, min: number, max: number) => {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
};

/** Validates the form and applies it over `base` (which keeps the id, weights and anything not on the form). */
export function fromPresetForm(
  f: PresetForm,
  base: StudyPreset
): { preset: StudyPreset } | { errors: PresetFormErrors } {
  const errors: PresetFormErrors = {};

  if (!f.name.trim()) errors.name = "Give the preset a name";
  if (!isWhole(f.newCardsPerDay, 0, 9999))
    errors.newCardsPerDay = "Whole number from 0 to 9999";
  if (!isWhole(f.maxReviewsPerDay, 0, 9999))
    errors.maxReviewsPerDay = "Whole number from 0 to 9999";

  const learning = parseSteps(f.learningSteps);
  if (!learning)
    errors.learningSteps = "Use steps like 1m 10m (m, h or d), up to 8";
  const relearning = parseSteps(f.relearningSteps);
  if (!relearning)
    errors.relearningSteps = "Use steps like 10m (m, h or d), up to 8";

  const pct = Number(f.retentionPct);
  if (
    f.retentionPct.trim() === "" ||
    !Number.isFinite(pct) ||
    pct < RETENTION_MIN * 100 ||
    pct > RETENTION_MAX * 100
  )
    errors.retention = "Enter a percentage from 70 to 99";

  if (!isWhole(f.maximumInterval, 1, 36500))
    errors.maximumInterval = "Whole days from 1 to 36500";
  if (!isWhole(f.leechThreshold, 0, 99))
    errors.leechThreshold = "Whole number from 0 to 99 (0 turns it off)";
  if (f.easyDays.length >= 7) errors.easyDays = "Leave at least one day open";

  if (Object.keys(errors).length || !learning || !relearning) return { errors };

  return {
    preset: {
      ...base,
      name: f.name.trim(),
      newCardsPerDay: Number(f.newCardsPerDay),
      maxReviewsPerDay: Number(f.maxReviewsPerDay),
      newCardOrder: f.newCardOrder,
      learningSteps: learning,
      relearningSteps: relearning,
      schedulingMode: f.schedulingMode,
      desiredRetention: Math.round(pct) / 100,
      maximumInterval: Number(f.maximumInterval),
      enableFuzz: f.enableFuzz,
      easyDays: [...f.easyDays].sort(),
      buryNewSiblings: f.buryNewSiblings,
      buryReviewSiblings: f.buryReviewSiblings,
      leechThreshold: Number(f.leechThreshold),
      leechAction: f.leechAction,
    },
  };
}
