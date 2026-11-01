import {
  FSRS,
  type FSRSParameters,
  default_w,
  generatorParameters,
} from "ts-fsrs";
import type { DeckOptions } from "./deck";

/** The FSRS settings a deck can carry inline. Study presets hold the same values for many decks. */
export type DeckFsrsOptions = Pick<
  DeckOptions,
  | "desiredRetention"
  | "maximumInterval"
  | "learningSteps"
  | "relearningSteps"
  | "enableFuzz"
  | "schedulingMode"
  | "weights"
>;

export const RETENTION_MIN = 0.7;
export const RETENTION_MAX = 0.99;

/** Inline values for decks made without a preset (kept for tests and older callers). */
export const FSRS_DEFAULTS = {
  desiredRetention: 0.9,
  maximumInterval: 36500,
  learningSteps: ["1m", "10m"],
  relearningSteps: ["10m"],
  enableFuzz: true,
  schedulingMode: "exact",
} satisfies DeckFsrsOptions;

export const EXAM_DEFAULTS = { examBufferDays: 1, examRamp: true };
export const EXAM_BUFFER_MAX = 30;

const STEP = /^[1-9]\d{0,3}[mhd]$/;

/** "1m 10m" or "1m, 10m" to ["1m","10m"]; an empty list turns learning steps off. */
export function parseSteps(text: string): string[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (parts.length > 8 || !parts.every((p) => STEP.test(p))) return null;
  return parts;
}

/** A real calendar date written as YYYY-MM-DD (rejects 2026-02-31). */
export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

export interface GlobalFsrs {
  retention: number;
  maximumInterval: number;
  w: number[];
}

/** Deck or preset options layered over the global settings (which older decks still rely on). */
export function resolveParams(
  opts: DeckFsrsOptions | undefined,
  g: GlobalFsrs
): FSRSParameters {
  return generatorParameters({
    request_retention: opts?.desiredRetention ?? g.retention,
    maximum_interval: opts?.maximumInterval ?? g.maximumInterval,
    // Personal weights win; weights saved for older FSRS versions have a different length, so fall back.
    w:
      opts?.weights?.length === default_w.length
        ? opts.weights
        : g.w.length === default_w.length
          ? g.w
          : default_w,
    // Old decks keep their old behavior: no fuzz, ts-fsrs default steps.
    enable_fuzz: opts?.enableFuzz ?? false,
    // Whole-day scheduling has no minute steps at all.
    enable_short_term: opts?.schedulingMode !== "daily",
    ...(opts?.learningSteps
      ? { learning_steps: opts.learningSteps as never }
      : {}),
    ...(opts?.relearningSteps
      ? { relearning_steps: opts.relearningSteps as never }
      : {}),
  });
}

const cache = new Map<string, FSRS>();

/** One FSRS instance per distinct parameter set. */
export function schedulerFor(params: FSRSParameters): FSRS {
  const key = JSON.stringify(params);
  let f = cache.get(key);
  if (!f) {
    if (cache.size > 50) cache.clear();
    f = new FSRS(params);
    cache.set(key, f);
  }
  return f;
}
