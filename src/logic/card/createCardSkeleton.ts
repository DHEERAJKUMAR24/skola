import { createEmptyCard } from "ts-fsrs";
import { v4 as uuidv4 } from "uuid";
import { CardSkeleton } from "./card";

export function createCardSkeleton(): CardSkeleton {
  const id = uuidv4();
  return {
    id: id,
    deck: "[preview not set]",
    model: createEmptyCard(new Date(Date.now())),
    creationDate: new Date(Date.now()),
  };
}
