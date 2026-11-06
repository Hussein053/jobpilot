import { z } from "zod/v4";

export const RESUME_REVIEW_ACTIONS = ["approve", "revoke", "activate", "deactivate"] as const;
export const reviewResumeSchema = z.strictObject({
  action: z.enum(RESUME_REVIEW_ACTIONS),
  expectedVersion: z.number().int().positive().max(2147483646),
  expectedReviewRevision: z.number().int().nonnegative().max(2147483646),
});
