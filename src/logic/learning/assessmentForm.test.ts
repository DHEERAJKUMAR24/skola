import { describe, expect, it } from "vitest";
import { type AssessmentInput, validateAssessment } from "./assessmentForm";

const ok: AssessmentInput = {
  domain: "K",
  dimension: "recall",
  rating: 3,
  evidence: "explained closures unaided",
  hints: 0,
  independent: true,
};

describe("validateAssessment", () => {
  it("accepts valid evidence", () => {
    expect(validateAssessment("KS", ok)).toBeNull();
    expect(validateAssessment("K", { ...ok, rating: 4 })).toBeNull();
  });

  it.each([
    ["wrong dimension for the domain", { dimension: "build" }],
    ["rating out of range", { rating: 5 }],
    ["fractional rating", { rating: 2.5 }],
    ["short evidence", { evidence: "yes " }],
    ["too many hints", { hints: 21 }],
    ["a 4 with a hint", { rating: 4, hints: 1 }],
    ["a coached 4", { rating: 4, independent: false }],
  ] as [string, Partial<AssessmentInput>][])("rejects %s", (_n, patch) => {
    expect(validateAssessment("KS", { ...ok, ...patch })).not.toBeNull();
  });

  it("rejects skill evidence on a knowledge-only objective", () => {
    const s = { ...ok, domain: "S" as const, dimension: "build" };
    expect(validateAssessment("K", s)).toMatch(/Knowledge only/);
    expect(validateAssessment("KS", s)).toBeNull();
  });
});
