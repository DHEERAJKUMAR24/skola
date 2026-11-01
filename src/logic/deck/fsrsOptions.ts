import {
  FSRS,
  type FSRSParameters,
  default_w,
  generatorParameters,
} from "ts-fsrs";
import type { DeckOptions } from "./deck";

/** FSRS settings a deck can carry. Missing fields fall back to the global settings. */
export type DeckFsrsOptions = Pick<
  DeckOptions,
  | "desiredRetention"
  | "maximumInterval"
  | "learningSteps"
  | "relearningSteps"
  | "enableFuzz"
>;

export const RETENTION_MIN = 0.7;
export const RETENTION_MAX = 0.99;
export const MAX_INTERVAL_MIN = 1;
export const MAX_INTERVAL_MAX = 36500;

/** What a new deck starts with (matches Anki's defaults, with FSRS-6). */
export const FSRS_DEFAULTS = {
  desiredRetention: 0.9,
  maximumInterval: 36500,
  learningSteps: ["1m", "10m"],
  relearningSteps: ["10m"],
  enableFuzz: true,
} satisfies Required<DeckFsrsOptions>;

export const PRESETS = [
  {
    id: "relaxed",
    label: "Relaxed",
    retention: 0.85,
    hint: "Fewer reviews, you will forget a little more.",
  },
  {
    id: "balanced",
    label: "Balanced",
    retention: 0.9,
    hint: "A good default: about 9 in 10 cards remembered when due.",
  },
  {
    id: "intensive",
    label: "Intensive",
    retention: 0.95,
    hint: "More reviews, you will forget very little.",
  },
] as const;

export type PresetId = (typeof PRESETS)[number]["id"] | "custom";

/** Everything the form edits, as strings so partial typing is allowed. */
export interface FsrsFormState {
  preset: PresetId;
  retentionPct: string;
  maximumInterval: string;
  learningSteps: string;
  relearningSteps: string;
  enableFuzz: boolean;
}

export interface FsrsFormErrors {
  retention?: string;
  maximumInterval?: string;
  learningSteps?: string;
  relearningSteps?: string;
}

export const formatSteps = (steps: string[]) => steps.join(" ");

const STEP = /^[1-9]\d{0,3}[mhd]$/;

/** "1m 10m" or "1m, 10m" to ["1m","10m"]; an empty list turns learning steps off. */
export function parseSteps(text: string): string[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  if (parts.length > 8 || !parts.every((p) => STEP.test(p))) return null;
  return parts;
}

/** Fills in anything a deck does not set, so the form always shows real values. */
export function withDefaults(
  opts?: DeckFsrsOptions
): Required<DeckFsrsOptions> {
  return {
    desiredRetention: opts?.desiredRetention ?? FSRS_DEFAULTS.desiredRetention,
    maximumInterval: opts?.maximumInterval ?? FSRS_DEFAULTS.maximumInterval,
    learningSteps: opts?.learningSteps ?? FSRS_DEFAULTS.learningSteps,
    relearningSteps: opts?.relearningSteps ?? FSRS_DEFAULTS.relearningSteps,
    enableFuzz: opts?.enableFuzz ?? FSRS_DEFAULTS.enableFuzz,
  };
}

const sameSteps = (a: string[], b: string[]) => a.join() === b.join();

export function toFormState(opts?: DeckFsrsOptions): FsrsFormState {
  const o = withDefaults(opts);
  const matchesDefaultsExceptRetention =
    o.maximumInterval === FSRS_DEFAULTS.maximumInterval &&
    sameSteps(o.learningSteps, FSRS_DEFAULTS.learningSteps) &&
    sameSteps(o.relearningSteps, FSRS_DEFAULTS.relearningSteps) &&
    o.enableFuzz === FSRS_DEFAULTS.enableFuzz;
  const preset = PRESETS.find((p) => p.retention === o.desiredRetention);
  return {
    preset: preset && matchesDefaultsExceptRetention ? preset.id : "custom",
    retentionPct: String(Math.round(o.desiredRetention * 100)),
    maximumInterval: String(o.maximumInterval),
    learningSteps: formatSteps(o.learningSteps),
    relearningSteps: formatSteps(o.relearningSteps),
    enableFuzz: o.enableFuzz,
  };
}

export function applyPreset(id: Exclude<PresetId, "custom">): FsrsFormState {
  const p = PRESETS.find((x) => x.id === id) as (typeof PRESETS)[number];
  return toFormState({ ...FSRS_DEFAULTS, desiredRetention: p.retention });
}

/** Validates the form; returns the options to store, or the errors to show. */
export function fromFormState(
  s: FsrsFormState
): { options: Required<DeckFsrsOptions> } | { errors: FsrsFormErrors } {
  const errors: FsrsFormErrors = {};

  const pct = Number(s.retentionPct);
  if (
    !s.retentionPct.trim() ||
    !Number.isFinite(pct) ||
    pct < RETENTION_MIN * 100 ||
    pct > RETENTION_MAX * 100
  )
    errors.retention = "Enter a percentage from 70 to 99";

  const interval = Number(s.maximumInterval);
  if (
    !Number.isInteger(interval) ||
    interval < MAX_INTERVAL_MIN ||
    interval > MAX_INTERVAL_MAX
  )
    errors.maximumInterval = "Enter whole days from 1 to 36500";

  const learning = parseSteps(s.learningSteps);
  if (!learning)
    errors.learningSteps = "Use steps like 1m 10m (m, h or d), up to 8";

  const relearning = parseSteps(s.relearningSteps);
  if (!relearning)
    errors.relearningSteps = "Use steps like 10m (m, h or d), up to 8";

  if (Object.keys(errors).length || !learning || !relearning) return { errors };
  return {
    options: {
      desiredRetention: Math.round(pct) / 100,
      maximumInterval: interval,
      learningSteps: learning,
      relearningSteps: relearning,
      enableFuzz: s.enableFuzz,
    },
  };
}

export interface GlobalFsrs {
  retention: number;
  maximumInterval: number;
  w: number[];
}

/** Deck options layered over the global settings (used by decks created before per-deck options). */
export function resolveParams(
  opts: DeckFsrsOptions | undefined,
  g: GlobalFsrs
): FSRSParameters {
  return generatorParameters({
    request_retention: opts?.desiredRetention ?? g.retention,
    maximum_interval: opts?.maximumInterval ?? g.maximumInterval,
    // Weights saved for older FSRS versions have a different length; fall back.
    w: g.w.length === default_w.length ? g.w : default_w,
    // Old decks keep their old behavior: no fuzz, ts-fsrs default steps.
    enable_fuzz: opts?.enableFuzz ?? false,
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
