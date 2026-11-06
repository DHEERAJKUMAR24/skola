import { serverCall } from "../serverApi";
import type { Domain, Track } from "./mastery";

export const WHAT = "Learning objectives";

export type Priority = "P0" | "P1" | "P2";
export type ObjectiveStatus = "active" | "parked" | "done";

export interface NextAction {
  action: "assess" | "revisit" | "retest" | "improve" | "move_on";
  dimension?: string;
  domain?: Domain;
  after?: number;
  reason: string;
}

/** Latest rating per dimension; null = no evidence yet. */
export type Ratings = Record<string, number | null>;

export interface ObjectiveBrief {
  objective_id: string;
  title: string;
  deck_id: string | null;
  priority: Priority;
  track: Track;
  status: ObjectiveStatus;
  k_score: number | null;
  s_score: number | null;
  mastered: boolean;
  next: NextAction;
  dimensions: { K: Ratings; S: Ratings | null };
}

export interface DimensionState {
  rating: number;
  at: number;
  hints: number;
  independent: boolean;
  assessments: number;
}

export interface DomainScore {
  score: number | null;
  tested: number;
  untested: string[];
  dimensions: Record<string, DimensionState | null>;
}

export interface Evidence {
  assessment_id: string;
  at: number;
  domain: Domain;
  dimension: string;
  rating: number;
  hints: number;
  independent: boolean;
  evidence: string;
  source: string | null;
}

export interface ObjectiveDetail {
  objective_id: string;
  title: string;
  description: string | null;
  deck_id: string | null;
  priority: Priority;
  status: ObjectiveStatus;
  track: Track;
  K: DomainScore;
  S: DomainScore | null;
  mastered: boolean;
  blockers: string[];
  next: NextAction;
  mastery_rules: { min_score: number; min_rating: number; retest_days: number };
  evidence: Evidence[];
  card_ids: string[];
  cards: {
    linked: number;
    missing: number;
    due_now: number;
    new: number;
    lapses: number;
  };
}

export interface ObjectiveFields {
  title: string;
  description?: string;
  deck_id?: string;
  priority: Priority;
  track: Track;
  status?: ObjectiveStatus;
}

const call = <T = Record<string, any>>(body: object) =>
  serverCall<T>("/api/objectives", body, WHAT);

export const objectivesApi = {
  list: async (status?: ObjectiveStatus) =>
    (await call<{ items: ObjectiveBrief[] }>({ op: "list", status })).items,
  get: (id: string) =>
    call<ObjectiveDetail>({ op: "get", objective_id: id, evidence_limit: 200 }),
  create: (f: ObjectiveFields) =>
    call<{ objective_id: string }>({
      op: "create",
      title: f.title,
      description: f.description || undefined,
      deck_id: f.deck_id || undefined,
      priority: f.priority,
      track: f.track,
    }),
  update: (id: string, f: Partial<ObjectiveFields>) =>
    call({ op: "update", objective_id: id, ...f }),
  /** Step 1 of 2: nothing is deleted; returns what would go and the confirm token. */
  previewDelete: (id: string) =>
    call<{
      will_delete: { objective: string; evidence: number; card_links: number };
      confirm_token: string;
    }>({ op: "delete", objective_id: id }),
  confirmDelete: (id: string, confirm_token: string) =>
    call<{ deleted: boolean }>({
      op: "delete",
      objective_id: id,
      confirm_token,
    }),
  assess: (id: string, a: Record<string, unknown>) =>
    call({ op: "assess", objective_id: id, ...a }),
  link: (id: string, add?: string[], remove?: string[]) =>
    call({
      op: "link",
      objective_id: id,
      add_card_ids: add,
      remove_card_ids: remove,
    }),
};

export const DIMENSION_HELP: Record<string, string> = {
  recall: "Can the learner say it from memory, with no hints?",
  explanation: "Can they explain why, in their own words, with no hints?",
  discrimination: "Can they tell it apart from similar things?",
  transfer: "Can they use it in a situation they have not seen?",
  build: "Can they make it, independently?",
  debug: "Can they find and fix what is wrong?",
  test: "Can they check that it works, and show how?",
  adapt: "Can they change it for a new requirement?",
};

export function describeNext(n: NextAction): string {
  const what = n.dimension ? ` ${n.domain ?? ""} ${n.dimension}`.trimEnd() : "";
  switch (n.action) {
    case "assess":
      return `Assess${what}. ${n.reason}`;
    case "revisit":
      return `Revisit${what}. ${n.reason}`;
    case "retest":
      return `Retest${what}${n.after ? ` after ${new Date(n.after).toLocaleDateString()}` : ""}. ${n.reason}`;
    case "improve":
      return `Improve${what}. ${n.reason}`;
    default:
      return n.reason || "Nothing left to do: mastered.";
  }
}
