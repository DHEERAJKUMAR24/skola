import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useMemo } from "react";
import type { FSRS } from "ts-fsrs";
import { db } from "../db";
import {
  type DeckFsrsOptions,
  resolveParams,
  schedulerFor,
} from "../deck/fsrsOptions";
import { defaultSettings } from "../settings/defaultSettings";
import { useSetting } from "../settings/hooks/useSetting";

/**
 * Returns a function that picks the right FSRS scheduler for a deck: that deck's own
 * options, layered over the global settings (which older decks still rely on).
 */
export function useSchedulerFor(): (deckId: string) => FSRS {
  const [maximumInterval] = useSetting("#globalScheduler_maximumInterval");
  const [retention] = useSetting("#globalScheduler_requestRetention");
  const [w] = useSetting("#globalScheduler_w");

  const optionsByDeck = useLiveQuery(async () => {
    const decks = await db.decks.toArray();
    return new Map<string, DeckFsrsOptions>(
      decks.map((d) => [d.id, d.options])
    );
  }, []);

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

  return useCallback(
    (deckId: string) =>
      schedulerFor(resolveParams(optionsByDeck?.get(deckId), global)),
    [optionsByDeck, global]
  );
}
