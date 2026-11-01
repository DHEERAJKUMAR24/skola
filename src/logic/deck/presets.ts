import { useLiveQuery } from "dexie-react-hooks";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import type { Deck, DeckOptions } from "./deck";

/** The preset every deck starts with. It cannot be deleted. */
export const DEFAULT_PRESET_ID = "default";

/**
 * A named group of study settings that many decks can share, like an Anki options preset.
 * Change a preset once and every deck that uses it follows.
 */
export interface StudyPreset {
  id: string;
  name: string;

  // Daily limits (per deck)
  newCardsPerDay: number;
  maxReviewsPerDay: number;
  newCardOrder: "created" | "random";

  // Learning and lapses
  learningSteps: string[];
  relearningSteps: string[];
  /** Exact time, or whole days that start at the new-day hour. */
  schedulingMode: "exact" | "daily";

  // FSRS
  desiredRetention: number;
  maximumInterval: number;
  enableFuzz: boolean;
  /** Personalised FSRS parameters from the optimizer; empty means the defaults. */
  weights?: number[];
  weightsInfo?: { trainedAt: number; reviews: number };

  /** Weekdays (0 = Sunday) that reviews should avoid when the interval is 3 days or more. */
  easyDays: number[];

  // Siblings: other cards made from the same note
  buryNewSiblings: boolean;
  buryReviewSiblings: boolean;

  // Leeches: cards you keep forgetting
  /** 0 turns leech handling off. */
  leechThreshold: number;
  leechAction: "suspend" | "tag";

  updatedAt?: number;
}

export const PRESET_DEFAULTS: Omit<StudyPreset, "id" | "name"> = {
  newCardsPerDay: 20,
  maxReviewsPerDay: 200,
  newCardOrder: "created",
  learningSteps: ["1m", "10m"],
  relearningSteps: ["10m"],
  schedulingMode: "exact",
  desiredRetention: 0.9,
  maximumInterval: 36500,
  enableFuzz: true,
  easyDays: [],
  buryNewSiblings: false,
  buryReviewSiblings: false,
  leechThreshold: 8,
  leechAction: "tag",
};

export const FSRS_WEIGHT_COUNT = 21;

export function isValidWeights(w: unknown): w is number[] {
  return (
    Array.isArray(w) &&
    w.length === FSRS_WEIGHT_COUNT &&
    w.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

/**
 * The options that really apply to a deck: its preset's settings laid over the deck's own fields
 * (exam date, preset link). Decks made before presets, with no preset, use their own inline values.
 */
export function effectiveOptions(
  deck: Deck | undefined,
  presets: Map<string, StudyPreset>
): DeckOptions | undefined {
  if (!deck) return undefined;
  const preset = deck.options?.presetId
    ? presets.get(deck.options.presetId)
    : undefined;
  if (!preset) return deck.options;
  return {
    ...deck.options,
    dailyNewCards: preset.newCardsPerDay,
    maxReviewsPerDay: preset.maxReviewsPerDay,
    newCardOrder: preset.newCardOrder,
    learningSteps: preset.learningSteps,
    relearningSteps: preset.relearningSteps,
    schedulingMode: preset.schedulingMode,
    desiredRetention: preset.desiredRetention,
    maximumInterval: preset.maximumInterval,
    enableFuzz: preset.enableFuzz,
    weights: preset.weights,
    easyDays: preset.easyDays,
    buryNewSiblings: preset.buryNewSiblings,
    buryReviewSiblings: preset.buryReviewSiblings,
    leechThreshold: preset.leechThreshold,
    leechAction: preset.leechAction,
  };
}

/** Creates the Default preset if it is missing. Safe to call every start. */
export async function ensureDefaultPreset() {
  if (await db.presets.get(DEFAULT_PRESET_ID)) return;
  // Two callers can race on first run; the loser's duplicate add is harmless.
  await db.presets
    .add({ id: DEFAULT_PRESET_ID, name: "Default", ...PRESET_DEFAULTS })
    .catch(() => {});
}

export async function createPreset(
  name: string,
  from?: StudyPreset
): Promise<string> {
  const id = uuidv4();
  await db.presets.add({
    ...(from ?? { ...PRESET_DEFAULTS, id, name }),
    id,
    name: name.trim() || "Untitled preset",
  });
  return id;
}

export async function savePreset(preset: StudyPreset) {
  if (preset.weights && !isValidWeights(preset.weights))
    throw new Error("FSRS parameters need 21 numbers");
  await db.presets.put(preset);
}

/** Decks using a deleted preset fall back to Default. The Default preset itself cannot be deleted. */
export async function deletePreset(id: string) {
  if (id === DEFAULT_PRESET_ID)
    throw new Error("The Default preset cannot be deleted");
  await db.transaction("rw", db.presets, db.decks, async () => {
    await db.decks
      .filter((d) => d.options?.presetId === id)
      .modify((d) => {
        d.options.presetId = DEFAULT_PRESET_ID;
      });
    await db.presets.delete(id);
  });
}

/** Points the given decks at a preset. */
export async function assignPreset(presetId: string, deckIds: string[]) {
  await db.transaction("rw", db.decks, async () => {
    for (const id of deckIds)
      await db.decks
        .where("id")
        .equals(id)
        .modify((d) => {
          d.options.presetId = presetId;
        });
  });
}

export function usePresets() {
  return useLiveQuery(
    async () => (await db.presets.toArray()).sort(byName),
    []
  );
}

const byName = (a: StudyPreset, b: StudyPreset) =>
  a.id === DEFAULT_PRESET_ID
    ? -1
    : b.id === DEFAULT_PRESET_ID
      ? 1
      : a.name.localeCompare(b.name);
