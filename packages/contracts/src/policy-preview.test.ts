import { policyOutcomeSchema, simulatePolicySchema } from "./policy-preview";
import { expect, test } from "bun:test";

test("simulation input cannot supply ownership, execution, score or eligibility claims", () => {
  const request = {
    requestId: crypto.randomUUID(),
    ingestionRunId: crypto.randomUUID(),
    expectedSettingsVersion: 0,
  };
  expect(simulatePolicySchema.safeParse(request).success).toBe(true);
  for (const field of [
    "userId",
    "submissionMode",
    "liveSubmissionsEnabled",
    "matchScore",
    "facts",
    "decision",
  ])
    expect(simulatePolicySchema.safeParse({ ...request, [field]: true }).success).toBe(false);
});
test("a policy outcome can never declare submission permission", () => {
  const outcome = {
    decision: "eligible_for_dry_run",
    reasons: [],
    matchScore: 85,
    matchThreshold: 85,
    salaryMeetsMinimum: true,
    canSubmit: false,
  };
  expect(policyOutcomeSchema.safeParse(outcome).success).toBe(true);
  expect(policyOutcomeSchema.safeParse({ ...outcome, canSubmit: true }).success).toBe(false);
  expect(policyOutcomeSchema.safeParse({ ...outcome, decision: "submitted" }).success).toBe(false);
});
