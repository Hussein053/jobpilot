import { reviewResumeSchema } from "./resume-review";
import { describe, expect, it } from "bun:test";

describe("explicit resume review contract", () => {
  it("requires both the content version and review revision", () => {
    expect(
      reviewResumeSchema.safeParse({
        action: "approve",
        expectedVersion: 1,
        expectedReviewRevision: 0,
      }).success,
    ).toBe(true);
    expect(reviewResumeSchema.safeParse({ action: "approve", expectedVersion: 1 }).success).toBe(
      false,
    );
  });
  it("rejects execution controls and client-provided approval metadata", () => {
    for (const extra of [
      { submit: true },
      { approvedVersion: 1 },
      { active: true },
      { actorTokenId: "other" },
    ]) {
      expect(
        reviewResumeSchema.safeParse({
          action: "approve",
          expectedVersion: 1,
          expectedReviewRevision: 0,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });
  it("rejects unsafe revision bounds and unknown actions", () => {
    for (const value of [0, -1, 1.5, 2147483647])
      expect(
        reviewResumeSchema.safeParse({
          action: "approve",
          expectedVersion: value,
          expectedReviewRevision: 0,
        }).success,
      ).toBe(false);
    expect(
      reviewResumeSchema.safeParse({
        action: "submit",
        expectedVersion: 1,
        expectedReviewRevision: 0,
      }).success,
    ).toBe(false);
  });
});
