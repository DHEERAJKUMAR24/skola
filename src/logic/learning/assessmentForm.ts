import { DIMENSIONS, type Domain, type Track, isDimension } from "./mastery";

export interface AssessmentInput {
  domain: Domain;
  dimension: string;
  rating: number;
  evidence: string;
  hints: number;
  independent: boolean;
}

/**
 * The checks the server runs on record_assessment (src/server/mcpEvidence.ts), so the form can say
 * what is wrong before sending. The server stays the authority; a test keeps the two in step.
 */
export function validateAssessment(
  track: Track,
  a: AssessmentInput
): string | null {
  if (!isDimension(a.domain, a.dimension))
    return `Pick one of ${DIMENSIONS[a.domain].join(", ")}.`;
  if (a.domain === "S" && track === "K")
    return "This objective tracks Knowledge only. Change its track to K and S first.";
  if (!Number.isInteger(a.rating) || a.rating < 0 || a.rating > 4)
    return "The rating is a whole number from 0 to 4.";
  const evidence = a.evidence.trim();
  if (evidence.length < 5)
    return "Write what the learner did, in at least 5 characters.";
  if (evidence.length > 4000) return "Evidence is limited to 4000 characters.";
  if (!Number.isInteger(a.hints) || a.hints < 0 || a.hints > 20)
    return "Hints is a whole number from 0 to 20.";
  if (a.rating === 4 && (a.hints > 0 || !a.independent))
    return "A 4 means strong and unaided: it needs 0 hints and independent work. Rate 3 or lower, or fix hints.";
  return null;
}
