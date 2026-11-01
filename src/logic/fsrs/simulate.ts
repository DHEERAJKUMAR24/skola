import {
  type Card,
  FSRS,
  Rating,
  State,
  createEmptyCard,
  forgetting_curve,
  generatorParameters,
} from "ts-fsrs";

export interface SimInput {
  desiredRetention: number;
  newCardsPerDay: number;
  /** Days to simulate. */
  days: number;
  maximumInterval: number;
  weights: number[];
}

export interface SimResult {
  desiredRetention: number;
  /** Reviews done on each simulated day (new cards count as a review). */
  reviewsPerDay: number[];
  /** Average reviews per day over the second half, once the schedule settles. */
  avgReviewsPerDay: number;
  totalReviews: number;
  /** Sum of each card's recall chance on the last day: roughly how many cards you still know. */
  cardsKnown: number;
}

/** A small deterministic random generator so the same input gives the same chart. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

const START = new Date(2026, 0, 1, 12);
const dayDate = (d: number) => new Date(START.getFullYear(), 0, 1 + d, 12);

/**
 * Plays out `days` of studying: new cards every day, each due card answered correctly with its
 * real recall chance (Good) or forgotten (Again). Used to show how much work a retention setting
 * means. It models whole days only and ignores Hard/Easy, so treat it as an estimate.
 */
export function simulate(input: SimInput): SimResult {
  const fsrs = new FSRS(
    generatorParameters({
      request_retention: input.desiredRetention,
      maximum_interval: input.maximumInterval,
      w: input.weights,
      enable_fuzz: false,
      enable_short_term: false,
    })
  );
  const random = rng(42);
  const cards: Card[] = [];
  const reviewsPerDay: number[] = [];
  let total = 0;

  for (let day = 0; day < input.days; day++) {
    const now = dayDate(day);
    let today = 0;

    for (let i = 0; i < input.newCardsPerDay; i++) {
      const fresh = createEmptyCard(now);
      cards.push(fsrs.next(fresh, now, Rating.Good).card);
      today++;
    }
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (c.state === State.New || c.due.getTime() > now.getTime()) continue;
      const elapsed = Math.max(
        0,
        (now.getTime() - (c.last_review?.getTime() ?? now.getTime())) /
          86_400_000
      );
      const recall = forgetting_curve(input.weights, elapsed, c.stability);
      const grade = random() < recall ? Rating.Good : Rating.Again;
      cards[i] = fsrs.next(c, now, grade).card;
      today++;
    }
    reviewsPerDay.push(today);
    total += today;
  }

  const end = dayDate(input.days);
  const cardsKnown = cards.reduce((sum, c) => {
    const elapsed = Math.max(
      0,
      (end.getTime() - (c.last_review?.getTime() ?? end.getTime())) / 86_400_000
    );
    return sum + forgetting_curve(input.weights, elapsed, c.stability);
  }, 0);
  const second = reviewsPerDay.slice(Math.floor(reviewsPerDay.length / 2));
  return {
    desiredRetention: input.desiredRetention,
    reviewsPerDay,
    avgReviewsPerDay: second.length
      ? second.reduce((a, b) => a + b, 0) / second.length
      : 0,
    totalReviews: total,
    cardsKnown,
  };
}
