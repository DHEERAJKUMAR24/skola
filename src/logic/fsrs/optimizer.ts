import { Rating } from "ts-fsrs";
import type { ReviewLogRecord } from "../card/reviewLog";
import { FSRS_WEIGHT_COUNT, isValidWeights } from "../deck/presets";

const DAY_MS = 86_400_000;

/** Fewer reviews than this give unreliable parameters; Anki suggests the same ballpark. */
export const MIN_OPTIMIZE_REVIEWS = 400;

export interface TrainingSet {
  ratings: Uint32Array;
  /** Study days since the previous review of the same card (0 for its first review or the same day). */
  deltas: Uint32Array;
  /** Reviews in each training item, in the order the items appear in `ratings`. */
  lengths: Uint32Array;
  /** Real reviews used (not the expanded item rows). */
  reviews: number;
  cards: number;
}

/**
 * Turns the review log into what the optimizer trains on: one sequence per card,
 * oldest review first. Manual changes (reschedules, resets) are not real answers and are skipped.
 */
/** Which study day a moment belongs to; the day rolls over at `hour`, not midnight. */
function studyDay(ms: number, hour: number): number {
  const d = new Date(ms - hour * 3_600_000);
  return Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS
  );
}

export function buildTrainingSet(
  logs: ReviewLogRecord[],
  newDayStartHour = 4
): TrainingSet {
  const byCard = new Map<string, ReviewLogRecord[]>();
  for (const l of logs) {
    if (l.rating === Rating.Manual || l.rating < 1 || l.rating > 4) continue;
    const list = byCard.get(l.card);
    if (list) list.push(l);
    else byCard.set(l.card, [l]);
  }

  const ratings: number[] = [];
  const deltas: number[] = [];
  const lengths: number[] = [];
  let reviews = 0;
  for (const list of byCard.values()) {
    list.sort((a, b) => a.reviewedAt - b.reviewedAt);
    const r = list.map((l) => l.rating);
    const d = list.map((l, i) =>
      i === 0
        ? 0
        : Math.max(
            0,
            studyDay(l.reviewedAt, newDayStartHour) -
              studyDay(list[i - 1].reviewedAt, newDayStartHour)
          )
    );
    reviews += list.length;
    // The trainer wants one item per prefix of the history (reviews 1..k, k >= 2), and rejects
    // an item whose reviews all fall on the same day.
    let spaced = false;
    for (let k = 2; k <= list.length; k++) {
      spaced ||= d[k - 1] > 0;
      if (!spaced) continue;
      ratings.push(...r.slice(0, k));
      deltas.push(...d.slice(0, k));
      lengths.push(k);
    }
  }
  return {
    ratings: Uint32Array.from(ratings),
    deltas: Uint32Array.from(deltas),
    lengths: Uint32Array.from(lengths),
    reviews,
    cards: byCard.size,
  };
}

export interface OptimizeOptions {
  /** True for exact-time decks, where same-day short steps matter. */
  shortTerm: boolean;
  relearningSteps: number;
  newDayStartHour?: number;
  timeoutMs?: number;
}

/**
 * Trains personal FSRS parameters from the review log in a Web Worker (it takes a few seconds
 * and would freeze the page otherwise). Rejects if there is too little data or training fails.
 */
export function optimizeWeights(
  logs: ReviewLogRecord[],
  opts: OptimizeOptions
): Promise<number[]> {
  const set = buildTrainingSet(logs, opts.newDayStartHour);
  if (set.reviews < MIN_OPTIMIZE_REVIEWS)
    return Promise.reject(
      new Error(
        `Needs at least ${MIN_OPTIMIZE_REVIEWS} reviews to train; you have ${set.reviews}.`
      )
    );

  if (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated)
    return Promise.reject(
      new Error(
        "This browser cannot run the optimizer here (it needs a cross-origin isolated page; try Chrome, Edge or Firefox)."
      )
    );

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./optimizer.worker.ts", import.meta.url)
    );
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Training took too long and was stopped."));
    }, opts.timeoutMs ?? 180_000);
    const done = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (
      e: MessageEvent<{ weights?: number[]; error?: string }>
    ) => {
      done();
      const w = e.data.weights;
      if (w && isValidWeights(w)) resolve(w);
      else
        reject(
          new Error(
            e.data.error ??
              `Training returned ${Array.isArray(w) ? (w as unknown[]).length : 0} of ${FSRS_WEIGHT_COUNT} values.`
          )
        );
    };
    worker.onerror = (e) => {
      done();
      reject(
        new Error(e.message || "The optimizer could not start in this browser.")
      );
    };
    worker.postMessage({
      ratings: set.ratings,
      deltas: set.deltas,
      lengths: set.lengths,
      shortTerm: opts.shortTerm,
      relearningSteps: opts.relearningSteps,
    });
  });
}
