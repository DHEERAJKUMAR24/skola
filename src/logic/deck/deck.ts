import { ColorIdentifier } from "@/lib/ColorIdentifier";
import { SimplifiedState } from "../card/getSimplifiedStatesOf";

export interface DeckStatCache {
  counts: Record<SimplifiedState, number>;
  lastUpdated: Date;
  includesSubdecks: boolean;
}

export interface Deck {
  id: string;
  name: string;
  subDecks: string[];
  superDecks?: string[];
  cards: Array<string>;
  notes: Array<string>;
  description?: string;
  options: DeckOptions;
  color?: ColorIdentifier;
  statCache?: DeckStatCache;
}

export interface DeckOptions {
  newToReviewRatio: number;
  dailyNewCards: number;
  /** FSRS settings for this deck. Decks that do not set them use the global settings. */
  desiredRetention?: number;
  maximumInterval?: number;
  /** Steps like ["1m", "10m"]; an empty list skips short-term learning. */
  learningSteps?: string[];
  relearningSteps?: string[];
  enableFuzz?: boolean;
  /**
   * `exact`: intervals count from the moment you answer and short steps are in minutes.
   * `daily`: whole days only; a card is due when its day starts (like Anki).
   */
  schedulingMode?: "exact" | "daily";
  /** Exam or test date as local `YYYY-MM-DD`. Sub-decks without their own date inherit the nearest parent's. */
  examDate?: string;
  /** Days before the exam by which every card should have been seen once more. Default 1. */
  examBufferDays?: number;
  /** Raise desired retention as the exam gets close. Default on. */
  examRamp?: boolean;

  /** The study preset this deck follows. Without one, the deck uses the inline values above. */
  presetId?: string;
  // Filled in from the preset by `effectiveOptions`; legacy decks may carry them inline.
  maxReviewsPerDay?: number;
  newCardOrder?: "created" | "random";
  weights?: number[];
  easyDays?: number[];
  buryNewSiblings?: boolean;
  buryReviewSiblings?: boolean;
  leechThreshold?: number;
  leechAction?: "suspend" | "tag";
}
