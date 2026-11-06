import { z } from "zod/v4";

const POLICY_DECISIONS = ["eligible_for_dry_run", "review", "skip"] as const;
export const POLICY_REASONS = [
  "auto_apply_disabled",
  "role_unverified",
  "role_not_allowed",
  "country_unverified",
  "country_not_allowed",
  "location_unverified",
  "location_not_allowed",
  "arrangement_unverified",
  "arrangement_not_allowed",
  "hard_requirements_unverified",
  "hard_requirements_not_met",
  "salary_unknown",
  "salary_unlisted_allowed",
  "salary_unlisted_review",
  "salary_unlisted_skip",
  "salary_not_comparable",
  "salary_below_minimum",
  "match_score_unverified",
  "match_score_below_threshold",
  "resume_review_required",
  "resume_manual_required",
  "screening_unresolved",
  "duplicate_application",
  "duplicate_in_progress",
  "duplicate_uncertain",
  "daily_cap_reached",
] as const;
export const policyOutcomeSchema = z.strictObject({
  decision: z.enum(POLICY_DECISIONS),
  reasons: z.array(z.enum(POLICY_REASONS)),
  matchScore: z.number().int().min(0).max(100).nullable(),
  matchThreshold: z.number().int().min(50).max(100),
  salaryMeetsMinimum: z.boolean().nullable(),
  canSubmit: z.literal(false),
});
export type PolicyOutcome = z.infer<typeof policyOutcomeSchema>;
export const simulatePolicySchema = z.strictObject({
  requestId: z.uuid(),
  ingestionRunId: z.uuid(),
  expectedSettingsVersion: z.number().int().nonnegative(),
  resumeId: z.uuid().optional(),
});
