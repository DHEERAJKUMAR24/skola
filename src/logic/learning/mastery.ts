// Pure on purpose: the MCP server and, later, the app share it. No Dexie, no Node APIs.

/** Knowledge (K) and Skill (S): two separate tracks of four dimensions, each rated 0 to 4. */
export const DIMENSIONS = {
  K: ["recall", "explanation", "discrimination", "transfer"],
  S: ["build", "debug", "test", "adapt"],
} as const;

export type Domain = keyof typeof DIMENSIONS;
export type Track = "K" | "KS";

export const RATING_LABELS = [
  "none: could not do it",
  "weak: only with heavy help",
  "partial: with hints or with errors",
  "solid: correct with little help",
  "strong: correct, unaided, and robust",
];

export const MASTERY = {
  /** Both tracks need at least this score (0 to 100). */
  minScore: 85,
  /** No tested dimension may sit below this rating. */
  minRating: 3,
  /** Days between two good results on a dimension. */
  retestDays: 7,
} as const;

const DAY_MS = 86_400_000;

export interface Assessment {
  domain: Domain;
  dimension: string;
  rating: number;
  hints: number;
  independent: boolean;
  /** ms epoch */
  at: number;
}

export interface DimensionState {
  rating: number;
  at: number;
  hints: number;
  independent: boolean;
  assessments: number;
}

export interface DomainScore {
  /** null until all four dimensions have evidence: untested is not zero. */
  score: number | null;
  tested: number;
  untested: string[];
  dimensions: Record<string, DimensionState | null>;
}

export interface NextAction {
  action: "assess" | "revisit" | "retest" | "improve" | "move_on";
  dimension?: string;
  domain?: Domain;
  /** ms epoch; only for retest */
  after?: number;
  reason: string;
}

export interface Status {
  track: Track;
  K: DomainScore;
  S: DomainScore | null;
  mastered: boolean;
  /** What still stands between this objective and mastery. Empty when mastered. */
  blockers: string[];
  next: NextAction;
}

export const isDimension = (domain: Domain, dim: string) =>
  (DIMENSIONS[domain] as readonly string[]).includes(dim);

function scoreDomain(domain: Domain, list: Assessment[]): DomainScore {
  const dimensions: Record<string, DimensionState | null> = {};
  const untested: string[] = [];
  let sum = 0;
  for (const dim of DIMENSIONS[domain]) {
    const mine = list
      .filter((a) => a.domain === domain && a.dimension === dim)
      .sort((x, y) => x.at - y.at);
    const last = mine[mine.length - 1];
    if (!last) {
      dimensions[dim] = null;
      untested.push(dim);
      continue;
    }
    dimensions[dim] = {
      rating: last.rating,
      at: last.at,
      hints: last.hints,
      independent: last.independent,
      assessments: mine.length,
    };
    sum += last.rating;
  }
  return {
    score: untested.length ? null : Math.round((sum / 16) * 1000) / 10,
    tested: 4 - untested.length,
    untested,
    dimensions,
  };
}

/** Day a dimension can be retested: a first good result plus 7 days. */
function retestDue(domain: Domain, dim: string, list: Assessment[]) {
  const good = list
    .filter(
      (a) =>
        a.domain === domain &&
        a.dimension === dim &&
        a.rating >= MASTERY.minRating
    )
    .sort((x, y) => x.at - y.at);
  if (!good.length) return null;
  const first = good[0].at;
  const done = good.some((a) => a.at - first >= MASTERY.retestDays * DAY_MS);
  return { due: first + MASTERY.retestDays * DAY_MS, done };
}

/**
 * Where an objective stands. Mastery needs, for every tracked domain: all four dimensions tested,
 * a score of 85 or more, no dimension under 3, unaided recall and explanation (no hints), independent
 * work on every skill dimension, and a second good result on each dimension at least 7 days after
 * the first. This is an internal study rubric, not a certification.
 */
export function evaluate(
  track: Track,
  list: Assessment[],
  now: number
): Status {
  const K = scoreDomain("K", list);
  const S = track === "KS" ? scoreDomain("S", list) : null;
  const domains: [Domain, DomainScore][] = [["K", K]];
  if (S) domains.push(["S", S]);

  const blockers: string[] = [];
  let next: NextAction | undefined;
  const setNext = (n: NextAction) => {
    next ??= n;
  };

  for (const [d, ds] of domains) {
    for (const dim of ds.untested) {
      blockers.push(`${d} ${dim}: no evidence yet`);
      setNext({
        action: "assess",
        domain: d,
        dimension: dim,
        reason: `${d} ${dim} has not been tested. Untested is not zero; assess it before judging ${d}.`,
      });
    }
  }
  for (const [d, ds] of domains)
    for (const [dim, st] of Object.entries(ds.dimensions)) {
      if (st && st.rating < MASTERY.minRating) {
        blockers.push(
          `${d} ${dim}: rated ${st.rating}, needs ${MASTERY.minRating}`
        );
        setNext({
          action: "revisit",
          domain: d,
          dimension: dim,
          reason: `${d} ${dim} is rated ${st.rating}. Teach it again, then retest.`,
        });
      }
    }
  for (const [d, ds] of domains)
    if (ds.score !== null && ds.score < MASTERY.minScore) {
      blockers.push(`${d} score ${ds.score}, needs ${MASTERY.minScore}`);
      setNext({
        action: "improve",
        domain: d,
        reason: `${d} score is ${ds.score}; raise the weakest dimension to reach ${MASTERY.minScore}.`,
      });
    }
  for (const dim of ["recall", "explanation"]) {
    const st = K.dimensions[dim];
    if (st && st.hints > 0) {
      blockers.push(
        `K ${dim}: needed ${st.hints} hint(s); mastery needs it unaided`
      );
      setNext({
        action: "retest",
        domain: "K",
        dimension: dim,
        reason: `Retest K ${dim} with no hints.`,
      });
    }
  }
  if (S)
    for (const [dim, st] of Object.entries(S.dimensions))
      if (st && !st.independent) {
        blockers.push(`S ${dim}: not done independently`);
        setNext({
          action: "retest",
          domain: "S",
          dimension: dim,
          reason: `Retest S ${dim} as independent work.`,
        });
      }

  for (const [d, ds] of domains)
    for (const dim of Object.keys(ds.dimensions)) {
      const st = ds.dimensions[dim];
      if (!st || st.rating < MASTERY.minRating) continue;
      const r = retestDue(d, dim, list);
      if (r && !r.done) {
        blockers.push(
          `${d} ${dim}: needs a second good result at least ${MASTERY.retestDays} days after the first`
        );
        setNext({
          action: "retest",
          domain: d,
          dimension: dim,
          after: r.due,
          reason:
            now >= r.due
              ? `Retest ${d} ${dim} now (the ${MASTERY.retestDays}-day wait is over).`
              : `Retest ${d} ${dim} after the ${MASTERY.retestDays}-day wait.`,
        });
      }
    }

  const mastered = blockers.length === 0;
  return {
    track,
    K,
    S,
    mastered,
    blockers,
    next: mastered
      ? { action: "move_on", reason: "All mastery conditions are met." }
      : (next as NextAction),
  };
}
