import type { Deck, DeckOptions } from "./deck";
import type { StudyPreset } from "./presets";

// Pure on purpose: the MCP server imports this without pulling in Dexie.
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
