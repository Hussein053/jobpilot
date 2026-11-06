import {
  type AutoApplyPreferences,
  autoApplyPreferencesSchema,
} from "@jobpilot/contracts/auto-apply";
import { type PolicyOutcome, policyOutcomeSchema } from "@jobpilot/contracts/policy-preview";
import { z } from "zod/v4";

const factsSchema = z.strictObject({
  role: z.string().nullable(),
  country: z.string().nullable(),
  location: z.string().nullable(),
  arrangement: z.enum(["Remote", "Hybrid", "On-site"]).nullable(),
  hardRequirements: z.enum(["met", "not_met", "unknown"]),
  salary: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("unknown") }),
    z.strictObject({ kind: z.literal("missing") }),
    z.strictObject({ kind: z.literal("incomparable") }),
    z.strictObject({
      kind: z.literal("annual_base_usd"),
      minimum: z.number().finite().nonnegative(),
    }),
  ]),
  matchScore: z.number().int().min(0).max(100).nullable(),
  screening: z.enum(["resolved", "unresolved", "unknown"]),
});
export type PolicyFacts = z.infer<typeof factsSchema>;
export interface PolicyContext {
  approvedResume: boolean;
  manualResumeSelected: boolean;
  duplicateApplication: boolean;
  duplicateInProgress: boolean;
  duplicateUncertain: boolean;
  remaining: number;
}
const same = (a: string, b: string) =>
  a.normalize("NFC").trim().toLowerCase() === b.normalize("NFC").trim().toLowerCase();

export function evaluatePolicy(
  settingsInput: AutoApplyPreferences,
  factsInput: PolicyFacts,
  context: PolicyContext,
): PolicyOutcome {
  const settings = autoApplyPreferencesSchema.parse(settingsInput);
  const facts = factsSchema.parse(factsInput);
  const reasons: PolicyOutcome["reasons"] = [];
  let skipped = false;
  let review = false;
  const block = (reason: PolicyOutcome["reasons"][number]) => {
    skipped = true;
    reasons.push(reason);
  };
  const uncertain = (reason: PolicyOutcome["reasons"][number]) => {
    review = true;
    reasons.push(reason);
  };
  if (!settings.autoApplyRequested) block("auto_apply_disabled");
  if (context.duplicateApplication) block("duplicate_application");
  if (context.duplicateInProgress) block("duplicate_in_progress");
  if (context.duplicateUncertain) uncertain("duplicate_uncertain");
  if (!Number.isInteger(context.remaining) || context.remaining <= 0) block("daily_cap_reached");
  if (!facts.role) uncertain("role_unverified");
  else if (!settings.roles.some((role) => same(role, facts.role!))) block("role_not_allowed");
  if (!facts.country) uncertain("country_unverified");
  else if (facts.country !== "US") block("country_not_allowed");
  if (settings.location !== "United States — Nationwide") {
    if (!facts.location) uncertain("location_unverified");
    else if (!same(settings.location, facts.location)) block("location_not_allowed");
  }
  if (!facts.arrangement) uncertain("arrangement_unverified");
  else if (!settings.workArrangements.includes(facts.arrangement)) block("arrangement_not_allowed");
  if (facts.hardRequirements === "unknown") uncertain("hard_requirements_unverified");
  if (facts.hardRequirements === "not_met") block("hard_requirements_not_met");
  let salaryMeetsMinimum: boolean | null = null;
  if (facts.salary.kind === "unknown") uncertain("salary_unknown");
  if (facts.salary.kind === "incomparable") uncertain("salary_not_comparable");
  if (facts.salary.kind === "missing") {
    if (settings.unlistedSalary === "skip") block("salary_unlisted_skip");
    if (settings.unlistedSalary === "review") uncertain("salary_unlisted_review");
    if (settings.unlistedSalary === "allow") reasons.push("salary_unlisted_allowed");
  }
  if (facts.salary.kind === "annual_base_usd") {
    salaryMeetsMinimum = facts.salary.minimum >= settings.minimumSalaryUSD;
    if (!salaryMeetsMinimum) block("salary_below_minimum");
  }
  if (facts.matchScore === null) uncertain("match_score_unverified");
  else if (facts.matchScore < settings.minimumMatchScore) block("match_score_below_threshold");
  if (!context.approvedResume) uncertain("resume_review_required");
  if (settings.resumeSelection === "manual" && !context.manualResumeSelected)
    uncertain("resume_manual_required");
  if (facts.screening !== "resolved") uncertain("screening_unresolved");
  let decision: PolicyOutcome["decision"] = "eligible_for_dry_run";
  if (review) decision = "review";
  if (skipped) decision = "skip";
  return policyOutcomeSchema.parse({
    decision,
    reasons,
    matchScore: facts.matchScore,
    matchThreshold: settings.minimumMatchScore,
    salaryMeetsMinimum,
    canSubmit: false,
  });
}
