import { genericFail } from "@/components/Notification/Notification";
import { CardSorts } from "@/logic/card/CardSorting";
import { getCardsOf } from "@/logic/card/getCardsOf";
import { CognitivePrompt } from "@/logic/cognitivePrompts";
import { Deck } from "@/logic/deck/deck";
import { useLearning } from "@/logic/learn";
import { useCallback, useState } from "react";
import { Grade } from "ts-fsrs";

interface UseLearnSessionOptions {
  deck: Deck | undefined;
  learnAll: boolean;
  cram?: boolean;
  newToReviewRatio: number;
}

export function useLearnSession({
  deck,
  learnAll,
  cram,
  newToReviewRatio,
}: UseLearnSessionOptions) {
  const controller = useLearning(
    {
      querier: () => getCardsOf(deck),
      dependencies: [deck],
    },
    {
      learnAll,
      cram,
      newToReviewRatio,
      sort: CardSorts.byCreationDate(1),
    }
  );

  const [currentRating, setCurrentRating] = useState<Grade | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<CognitivePrompt | null>(
    null
  );
  const cardShowsMastery = useCallback(() => {
    const model = controller.currentCard?.model;
    if (!model) return false;
    return model.reps >= 2;
  }, [controller.currentCard]);

  const answerCard = useCallback(
    async (rating: Grade) => {
      try {
        controller.answerCard(rating);
        controller.requestNextCard();
        setCurrentRating(rating);
        setTimeout(() => setCurrentRating(null), 150);

        setSelectedPrompt(null);
      } catch (error) {
        genericFail();
        console.log(error);
      }
    },
    [controller, cardShowsMastery]
  );

  const togglePrompt = useCallback(
    (prompt: CognitivePrompt) => {
      if (selectedPrompt === prompt) {
        setSelectedPrompt(null);
      } else {
        setSelectedPrompt(prompt);
      }
    },
    [selectedPrompt]
  );

  const closeQuickAdd = useCallback(() => {
    setSelectedPrompt(null);
  }, []);

  return {
    controller,
    currentRating,
    selectedPrompt,
    showPrompts: cardShowsMastery(),
    answerCard,
    togglePrompt,
    closeQuickAdd,
  };
}
