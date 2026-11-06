import { genericFail } from "@/components/Notification/Notification";
import { CardSorts } from "@/logic/card/CardSorting";
import { getCardsOf } from "@/logic/card/getCardsOf";
import { CognitivePrompt } from "@/logic/cognitivePrompts";
import { Deck } from "@/logic/deck/deck";
import { useLearning } from "@/logic/learn";
import { weakCardsForStudy } from "@/logic/master/builderData";
import { useCallback, useState } from "react";
import { Grade } from "ts-fsrs";

interface UseLearnSessionOptions {
  deck: Deck | undefined;
  learnAll: boolean;
  cram?: boolean;
  /** Study only the weakest linked cards of this master note (see weakDrillParam). */
  weakOfMaster?: string | null;
  newToReviewRatio: number;
}

export function useLearnSession({
  deck,
  learnAll,
  cram,
  weakOfMaster,
  newToReviewRatio,
}: UseLearnSessionOptions) {
  const controller = useLearning(
    {
      querier: () =>
        weakOfMaster ? weakCardsForStudy(weakOfMaster) : getCardsOf(deck),
      dependencies: [deck, weakOfMaster],
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
