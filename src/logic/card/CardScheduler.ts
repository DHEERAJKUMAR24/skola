import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useMemo } from "react";
import { db } from "../db";
import type { Deck } from "../deck/deck";
import { effectiveOptions, usePresets } from "../deck/presets";
import type { NoteType } from "../note/note";
import { resolveExam, scheduleCard } from "../scheduling/policy";
import { defaultSettings } from "../settings/defaultSettings";
import { useSetting } from "../settings/hooks/useSetting";
import type { Card } from "./card";

/**
 * Everything the study session needs to schedule cards: each deck's study preset,
 * the inherited exam date, whole-day or exact timing, and per-card overrides.
 */
export function useCardScheduling() {
  const [maximumInterval] = useSetting("#globalScheduler_maximumInterval");
  const [retention] = useSetting("#globalScheduler_requestRetention");
  const [w] = useSetting("#globalScheduler_w");
  const [newDayStartHour] = useSetting("#newDayStartHour");
  const presetList = usePresets();

  const decksById = useLiveQuery(
    async () =>
      new Map<string, Deck>((await db.decks.toArray()).map((d) => [d.id, d])),
    []
  );
  const presets = useMemo(
    () => new Map((presetList ?? []).map((p) => [p.id, p])),
    [presetList]
  );

  const global = useMemo(
    () => ({
      retention,
      maximumInterval,
      w: (w ?? defaultSettings["#globalScheduler_w"])
        .split(",")
        .map((x) => Number.parseFloat(x)),
    }),
    [retention, maximumInterval, w]
  );

  /** The study settings that apply to a deck: its preset laid over the deck itself. */
  const optionsOf = useCallback(
    (deckId: string) => effectiveOptions(decksById?.get(deckId), presets),
    [decksById, presets]
  );

  const scheduleFor = useCallback(
    (card: Card<NoteType>, now: Date = new Date()) => {
      const deck = decksById?.get(card.deck);
      return scheduleCard(card.model, {
        deckOptions: optionsOf(card.deck),
        exam: resolveExam(deck, decksById ?? new Map()),
        cardOverride: card.fsrsOverride,
        global,
        newDayStartHour,
        now,
      });
    },
    [decksById, optionsOf, global, newDayStartHour]
  );

  const limitOf = useCallback(
    (deckId: string) => optionsOf(deckId)?.dailyNewCards,
    [optionsOf]
  );
  const reviewLimitOf = useCallback(
    (deckId: string) => optionsOf(deckId)?.maxReviewsPerDay,
    [optionsOf]
  );

  return {
    scheduleFor,
    optionsOf,
    limitOf,
    reviewLimitOf,
    newDayStartHour,
    ready: decksById !== undefined && presetList !== undefined,
  };
}
