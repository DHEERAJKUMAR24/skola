import { useMediaHtml } from "@/logic/media/useMedia";
import { useEffect, useSyncExternalStore } from "react";
import { QuestionContent } from "../shared/QuestionAnswerDisplay";
import "./MultipleChoiceView.css";
import { type MultipleChoiceNoteContent, shuffledOrder } from "./types";

const BASE = "multiple-choice";

// The question side and the answer side are separate components, so what the user picked lives
// outside React, keyed by card id.
const picks = new Map<string, Set<number>>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const EMPTY: ReadonlySet<number> = new Set();

export function pickedOf(cardId: string): ReadonlySet<number> {
  return picks.get(cardId) ?? EMPTY;
}

export function togglePick(cardId: string, index: number, multi: boolean) {
  const cur = new Set(picks.get(cardId) ?? []);
  if (multi) {
    if (!cur.delete(index)) cur.add(index);
  } else {
    cur.clear();
    cur.add(index);
  }
  picks.set(cardId, cur);
  emit();
}

export function clearPicks(cardId: string) {
  if (picks.delete(cardId)) emit();
}

function usePicks(cardId: string) {
  return useSyncExternalStore(
    subscribe,
    () => picks.get(cardId) ?? EMPTY,
    () => EMPTY
  );
}

interface Props {
  cardId: string;
  content?: MultipleChoiceNoteContent;
  /** The answer side: mark right and wrong choices and show the explanation. */
  revealed: boolean;
}

/** Study view of a multiple-choice card. */
export function MultipleChoiceView({ cardId, content, revealed }: Props) {
  const picked = usePicks(cardId);
  const choices = content?.choices ?? [];
  const explanation = useMediaHtml(content?.explanation ?? "");
  const multi = choices.filter((c) => c.correct).length > 1;

  // A fresh question starts with nothing picked; the answer side keeps the pick it was given.
  useEffect(() => {
    if (!revealed) clearPicks(cardId);
  }, [cardId, revealed]);

  const order = shuffledOrder(choices.length, cardId);

  return (
    <div>
      <QuestionContent html={content?.question ?? ""} />
      {multi && <p className={`${BASE}__hint`}>Select all that apply</p>}
      <ul className={`${BASE}__choices`}>
        {order.map((i, pos) => {
          const choice = choices[i];
          const isPicked = picked.has(i);
          const state = revealed
            ? choice.correct
              ? "correct"
              : isPicked
                ? "wrong"
                : "idle"
            : isPicked
              ? "picked"
              : "idle";
          return (
            <li key={i}>
              <button
                type="button"
                className={`${BASE}__choice ${BASE}__choice--${state}`}
                aria-pressed={isPicked}
                disabled={revealed}
                onClick={() => togglePick(cardId, i, multi)}
              >
                <span className={`${BASE}__letter`}>
                  {String.fromCharCode(65 + pos)}
                </span>
                <span>{choice.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {revealed && content?.explanation && (
        <div
          className={`${BASE}__explanation`}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: same editor HTML the basic card shows
          dangerouslySetInnerHTML={{ __html: explanation }}
        />
      )}
    </div>
  );
}

/** Read-only view for the notes list: the choices, with the correct ones marked when asked to. */
export function MultipleChoiceNoteView({
  content,
  showAnswers,
}: { content: MultipleChoiceNoteContent; showAnswers: boolean }) {
  const explanation = useMediaHtml(content.explanation ?? "");
  return (
    <div>
      <QuestionContent html={content.question} />
      <ul className={`${BASE}__choices`}>
        {content.choices.map((c, i) => (
          <li key={`${i}-${c.text}`}>
            <div
              className={`${BASE}__choice ${BASE}__choice--${
                showAnswers && c.correct ? "correct" : "idle"
              }`}
            >
              <span className={`${BASE}__letter`}>
                {String.fromCharCode(65 + i)}
              </span>
              <span>{c.text}</span>
            </div>
          </li>
        ))}
      </ul>
      {showAnswers && content.explanation && (
        <div
          className={`${BASE}__explanation`}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: same editor HTML the basic card shows
          dangerouslySetInnerHTML={{ __html: explanation }}
        />
      )}
    </div>
  );
}
