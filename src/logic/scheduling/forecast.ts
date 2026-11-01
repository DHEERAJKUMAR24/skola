import { type Card as FsrsCard, State, forgetting_curve } from "ts-fsrs";
import { DAY_MS, examMoment } from "./policy";

export interface ExamForecast {
  daysLeft: number;
  total: number;
  /** Cards never studied. */
  newCards: number;
  /** Cards that have been studied at least once. */
  learned: number;
  /** Cards that will be due again before the exam if left alone. */
  dueBeforeExam: number;
  /** Learned cards whose recall chance on exam day is below the target. */
  atRisk: number;
  /** Average recall chance on exam day over the learned cards, 0 to 1. */
  avgRecall: number;
  /**
   * Expected share of the whole deck you could answer on exam day if you did no more studying:
   * unlearned cards count as 0. A cautious figure, since the exam cap schedules one more review.
   */
  expectedScore: number;
  /** New cards to start each day so every card is learned before the buffer begins. */
  newPerDay: number;
}

interface ForecastInput {
  examDate: string;
  now: Date;
  targetRetention: number;
  bufferDays: number;
  /** FSRS weights; the forgetting curve decay is the last one in FSRS-6. */
  w: number[];
}

/** Recall chance after `days` for a card with the given stability. */
export function recallAfter(
  stability: number,
  days: number,
  w: number[]
): number {
  if (stability <= 0) return 0;
  return forgetting_curve(w, Math.max(0, days), stability);
}

export function forecastExam(
  cards: { model: FsrsCard }[],
  input: ForecastInput
): ExamForecast {
  const examMs = examMoment(input.examDate).getTime();
  const nowMs = input.now.getTime();
  const daysLeft = Math.max(0, (examMs - nowMs) / DAY_MS);

  let newCards = 0;
  let learned = 0;
  let dueBeforeExam = 0;
  let atRisk = 0;
  let recallSum = 0;

  for (const { model } of cards) {
    if (model.state === State.New) {
      newCards++;
      continue;
    }
    learned++;
    const last = model.last_review
      ? new Date(model.last_review).getTime()
      : nowMs;
    const r = recallAfter(model.stability, (examMs - last) / DAY_MS, input.w);
    recallSum += r;
    if (r < input.targetRetention) atRisk++;
    if (new Date(model.due).getTime() < examMs) dueBeforeExam++;
  }

  const total = cards.length;
  const daysToLearn = Math.max(1, Math.floor(daysLeft) - input.bufferDays - 1);
  return {
    daysLeft,
    total,
    newCards,
    learned,
    dueBeforeExam,
    atRisk,
    avgRecall: learned ? recallSum / learned : 0,
    expectedScore: total ? recallSum / total : 0,
    newPerDay: newCards ? Math.ceil(newCards / daysToLearn) : 0,
  };
}
