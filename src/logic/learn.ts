import { Table } from "dexie";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Grade, RecordLog, State } from "ts-fsrs";
import { useCardScheduling } from "./card/CardScheduler";
import { Card } from "./card/card";
import { applyLeech, buryCards } from "./card/cardControls";
import { useCardsWith } from "./card/hooks/useCardsWith";
import { useTodayActivity } from "./card/hooks/useTodayActivity";
import { updateCardModel } from "./card/updateCardModel";
import { NoteType } from "./note/note";
import {
  addDays,
  applyRandomOrder,
  isLeechLapse,
  isStudyable,
  limitNewCards,
  logicalDayStart,
  siblingsToBury,
} from "./scheduling/policy";
import { DeckStatistics, newStatistics } from "./statistics";

export type LearnOptions = {
  learnAll: boolean;
  /** Review everything once without changing any FSRS state or review log. */
  cram?: boolean;
  newToReviewRatio: number;
  sort?: (a: Card<NoteType>, b: Card<NoteType>) => number;
};

export type CardQuerier = {
  querier: (
    cards: Table<Card<NoteType>>
  ) => Promise<Card<NoteType>[] | undefined>;
  dependencies: any[];
};

export type LearnController = {
  newCardsNumber: number;
  timeCriticalCardsNumber: number;
  toReviewCardsNumber: number;
  learnedCardsNumber: number;

  currentCard: Card<NoteType> | null;
  currentCardRepeatInfo: RecordLog | null;

  showingAnswer: boolean;
  showAnswer: () => void;

  answerCard: (rating: Grade) => void;
  requestNextCard: () => void;

  statistics: DeckStatistics;
  isFinished: boolean;

  options: LearnOptions;
};

export function useLearning(
  cardQuerier: CardQuerier,
  options: LearnOptions
): LearnController {
  //e.g. all cards of a deck
  const [providedCards] = useCardsWith(
    cardQuerier.querier,
    cardQuerier.dependencies
  );

  const {
    scheduleFor,
    optionsOf,
    limitOf,
    reviewLimitOf,
    newDayStartHour,
    ready,
  } = useCardScheduling();
  const today = useTodayActivity(newDayStartHour);

  //Time critical cards are cards that are due today / should be done within this learning session (5-10 min interval). timeCriticalCards should be sorted by due date
  const [timeCriticalCards, setTimeCriticalCards] = useState<Card<NoteType>[]>(
    []
  );

  //New cards are cards that have never been reviewed
  const [newCards, setNewCards] = useState<Card<NoteType>[]>([]);
  //To review cards are cards that have been answered correctly before and are due for a review
  const [toReviewCards, setToReviewCards] = useState<Card<NoteType>[]>([]);
  //Learned cards are cards that have been answered correctly but are not due for a review. These cards are not regulary shown, only with learnAll true
  const [learnedCards, setLearnedCards] = useState<Card<NoteType>[]>([]);

  //Currently shown card
  const [currentCard, setCurrentCard] = useState<Card<NoteType> | null>(null);

  const [showingAnswer, setShowingAnswer] = useState<boolean>(false);
  //Used so that nextCard isn't called immediately but only after state has been updated
  const [requestedNextCard, setRequestedNextCard] = useState<boolean>(false);

  //Determines if FinishedLearningView is shown
  const [isFinished, setIsFinished] = useState<boolean>(false);
  //for progress bar and statistics on FinishedLearningView
  const [statistics, setStatistics] = useState<DeckStatistics>(() =>
    newStatistics()
  );

  useEffect(() => {
    //Check if there are already cards provided (and what is needed to limit new cards)
    if (providedCards && ready && today) {
      //Check if there are no cards are in the respective lists and currentCard is not set.
      if (
        timeCriticalCards.length +
          newCards.length +
          toReviewCards.length +
          learnedCards.length ===
          0 &&
        currentCard === null
      ) {
        //If yes, sort the cards into the respective lists
        const now = new Date(Date.now());
        // Suspended and buried cards stay out of study.
        const studyable = providedCards.filter((c) => isStudyable(c, now));
        const seenByDeck = new Map<string, number>();
        const reviewedByDeck = new Map<string, number>();
        for (const c of studyable) {
          if (today.newSeen.has(c.id))
            seenByDeck.set(c.deck, (seenByDeck.get(c.deck) ?? 0) + 1);
          const n = today.reviewed.get(c.id);
          if (n)
            reviewedByDeck.set(c.deck, (reviewedByDeck.get(c.deck) ?? 0) + n);
        }
        const capped = !(options.learnAll || options.cram);
        setTimeCriticalCards(
          studyable.filter(
            (card) =>
              card.model.state === State.Learning ||
              card.model.state === State.Relearning
          )
        );
        // Decks set to random order shuffle their new cards (the same way all day).
        const newOnes = applyRandomOrder(
          studyable
            .filter((card) => card.model.state === State.New)
            .sort(options.sort),
          (deckId) => optionsOf(deckId)?.newCardOrder === "random",
          String(logicalDayStart(now, newDayStartHour).getTime())
        );
        // Each deck has daily limits for new and review cards, except in study-all and cram sessions.
        setNewCards(
          capped ? limitNewCards(newOnes, limitOf, seenByDeck) : newOnes
        );
        const dueOnes = studyable
          .filter(
            (card) => card.model.state === State.Review && card.model.due <= now
          )
          .sort(options.sort);
        setToReviewCards(
          capped
            ? limitNewCards(dueOnes, reviewLimitOf, reviewedByDeck)
            : dueOnes
        );
        setLearnedCards(
          studyable
            .filter(
              (card) =>
                card.model.state === State.Review && card.model.due > now
            )
            .sort(options.sort)
        );
      } else if (currentCard === null) {
        //If currentCard is not set (and there are cards in the lists), set it
        nextCard();
      }
    }
  }, [
    providedCards,
    ready,
    today,
    limitOf,
    reviewLimitOf,
    optionsOf,
    newDayStartHour,
    currentCard,
    timeCriticalCards,
    newCards,
    toReviewCards,
    learnedCards,
    options,
  ]);

  //Tries to set currentCard to the next card
  const nextCard = useCallback(() => {
    if (isFinished) {
      return;
    }
    //If there are time critical cards that are due, set the first one as currentCard
    if (
      timeCriticalCards.length > 0 &&
      timeCriticalCards[0].model.due <= new Date(Date.now())
    ) {
      setCurrentCard(timeCriticalCards[0]);
      setTimeCriticalCards((tcCards) => tcCards.filter((_, i) => i !== 0));
      //If there are new cards or cards that need to be reviewed are available choose one of them based on the newToReviewRatio
    } else if (newCards.length + toReviewCards.length > 0) {
      if (newCards.length === 0) {
        setCurrentCard(toReviewCards[0]);
        setToReviewCards((trCards) => trCards.filter((_, i) => i !== 0));
      } else if (toReviewCards.length === 0) {
        setCurrentCard(newCards[0]);
        setNewCards((nCards) => nCards.filter((_, i) => i !== 0));
      } else {
        if (Math.random() < options.newToReviewRatio) {
          setCurrentCard(newCards[0]);
          setNewCards((nCards) => nCards.filter((_, i) => i !== 0));
        } else {
          setCurrentCard(toReviewCards[0]);
          setToReviewCards((trCards) => trCards.filter((_, i) => i !== 0));
        }
      }
      //If learnAll is true and there are learned cards available set the first one as currentCard
    } else if (options.learnAll && learnedCards.length > 0) {
      setCurrentCard(learnedCards[0]);
      setLearnedCards((lCards) => lCards.filter((_, i) => i !== 0));
      //If there aren't any other cards but still time critical cards which are not due yet do them anyway
    } else if (timeCriticalCards.length > 0) {
      setCurrentCard(timeCriticalCards[0]);
      setTimeCriticalCards((tcCards) => tcCards.filter((_, i) => i !== 0));
      //If there are no cards left finish the learning session
    } else {
      setIsFinished(true);
    }
  }, [timeCriticalCards, newCards, toReviewCards, learnedCards, options]);

  useEffect(() => {
    if (requestedNextCard) {
      nextCard();
      setRequestedNextCard(false);
    }
  }, [requestedNextCard, nextCard]);

  //Providing information about how all 4 ratings would affect the current card
  //Shown on buttons
  const currentCardRepeatInfo = useMemo(() => {
    if (currentCard) {
      // Cards stored by the old fsrs.js lack learning_steps.
      return scheduleFor(currentCard, new Date(Date.now()));
    } else {
      return null;
    }
  }, [currentCard, scheduleFor]);

  /** Leech handling and burying siblings, per the answered card's preset. */
  const afterAnswer = useCallback(
    async (card: Card<NoteType>, lapsesNow: number) => {
      const rules = optionsOf(card.deck);
      if (!rules) return;
      if (
        rules.leechThreshold &&
        isLeechLapse(card.model.lapses, lapsesNow, rules.leechThreshold)
      )
        await applyLeech(card, rules.leechAction ?? "tag");

      const siblings = siblingsToBury(card, providedCards ?? [], rules);
      if (!siblings.length) return;
      const ids = new Set(siblings.map((s) => s.id));
      const tomorrow = addDays(logicalDayStart(new Date(), newDayStartHour), 1);
      await buryCards([...ids], tomorrow.getTime());
      const keep = (c: Card<NoteType>) => !ids.has(c.id);
      setNewCards((l) => l.filter(keep));
      setToReviewCards((l) => l.filter(keep));
      setLearnedCards((l) => l.filter(keep));
      setTimeCriticalCards((l) => l.filter(keep));
    },
    [optionsOf, providedCards, newDayStartHour]
  );

  //Answering the current card with the given rating
  const answer = useCallback(
    (rating: Grade) => {
      if (currentCard && currentCardRepeatInfo) {
        //Don't update the card if it is already learned and not due for a review
        if (options.cram) {
          // Cram never touches FSRS state; a missed card just comes around again this session.
          if (rating === 1)
            setTimeCriticalCards((tc) => [
              ...tc,
              {
                ...currentCard,
                model: { ...currentCard.model, due: new Date(0) },
              },
            ]);
        } else if (
          !(
            currentCard.model.state === State.Review &&
            currentCard.model.due.getTime() >= Date.now()
          )
        ) {
          const newModel = currentCardRepeatInfo[rating].card;
          void updateCardModel(
            currentCard,
            newModel,
            currentCardRepeatInfo[rating].log
          )
            .then(() => afterAnswer(currentCard, newModel.lapses))
            .catch((e) => console.error("study follow-up failed", e));
        }
        if (
          !options.cram &&
          currentCardRepeatInfo[rating].card.scheduled_days === 0
        ) {
          setTimeCriticalCards((tcCards) =>
            [
              ...tcCards,
              { ...currentCard, model: currentCardRepeatInfo[rating].card },
            ].sort((a, b) => a.model.due.getTime() - b.model.due.getTime())
          );
        }
        setStatistics((ds) => {
          return {
            ...ds,
            ratingsList: [...ds.ratingsList, rating],
            cards: {
              ...ds.cards,
              [currentCard.model.state]: ds.cards[currentCard.model.state] + 1,
            },
          };
        });
      } else {
        throw new Error("Card or cardModelInfo is missing");
      }
      setShowingAnswer(false);
    },
    [
      currentCard,
      currentCardRepeatInfo,
      timeCriticalCards,
      statistics,
      options.cram,
      afterAnswer,
    ]
  );

  return {
    newCardsNumber: newCards.length,
    timeCriticalCardsNumber: timeCriticalCards.length,
    toReviewCardsNumber: toReviewCards.length,
    learnedCardsNumber: learnedCards.length,

    currentCard: currentCard,
    currentCardRepeatInfo: currentCardRepeatInfo,

    showingAnswer: showingAnswer,
    showAnswer: setShowingAnswer.bind(null, true),

    answerCard: answer,
    requestNextCard: setRequestedNextCard.bind(null, true),

    statistics: statistics,
    isFinished: isFinished,

    options: options,
  };
}

export function useRepetitionAccuracy(ratingsList: number[]): number {
  return useMemo(() => {
    if (ratingsList.length !== 0) {
      let sum = 0;
      ratingsList.forEach((rating) => {
        return (sum += (rating - 1) / 2);
      });
      return Math.round((sum / ratingsList.length) * 1000) / 10;
    } else {
      return Number.NaN;
    }
  }, [ratingsList]);
}
