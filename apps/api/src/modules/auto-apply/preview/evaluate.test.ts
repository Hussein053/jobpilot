import { AUTO_APPLY_DEFAULTS } from "@jobpilot/contracts/auto-apply";
import { evaluatePolicy, type PolicyContext, type PolicyFacts } from "./evaluate";
import { describe, expect, test } from "bun:test";

const facts = (): PolicyFacts => ({
  role: "Program Manager",
  country: "US",
  location: null,
  arrangement: "Remote",
  hardRequirements: "met",
  salary: { kind: "annual_base_usd", minimum: 80000 },
  matchScore: 85,
  screening: "resolved",
});
const context = (): PolicyContext => ({
  approvedResume: true,
  manualResumeSelected: true,
  duplicateApplication: false,
  duplicateInProgress: false,
  duplicateUncertain: false,
  remaining: 50,
});

describe("deterministic dry-run eligibility", () => {
  test("85 passes the score gate but never grants submission", () => {
    expect(evaluatePolicy(AUTO_APPLY_DEFAULTS, facts(), context())).toMatchObject({
      decision: "eligible_for_dry_run",
      matchScore: 85,
      salaryMeetsMinimum: true,
      canSubmit: false,
    });
    expect(
      evaluatePolicy(AUTO_APPLY_DEFAULTS, { ...facts(), matchScore: 84 }, context()),
    ).toMatchObject({ decision: "skip", reasons: ["match_score_below_threshold"] });
  });
  test("a high score cannot override hard requirements or unresolved questions", () => {
    expect(
      evaluatePolicy(
        AUTO_APPLY_DEFAULTS,
        { ...facts(), matchScore: 100, hardRequirements: "not_met" },
        context(),
      ).decision,
    ).toBe("skip");
    for (const next of [
      { ...facts(), hardRequirements: "unknown" as const },
      { ...facts(), screening: "unresolved" as const },
    ])
      expect(evaluatePolicy(AUTO_APPLY_DEFAULTS, next, context()).decision).toBe("review");
  });
  test("verified annual base below the minimum fails independently of score", () => {
    const result = evaluatePolicy(
      AUTO_APPLY_DEFAULTS,
      { ...facts(), salary: { kind: "annual_base_usd", minimum: 79999 }, matchScore: 100 },
      context(),
    );
    expect(result.decision).toBe("skip");
    expect(result.salaryMeetsMinimum).toBe(false);
    expect(result.reasons).toContain("salary_below_minimum");
  });
  test("allowed missing pay does not claim that pay meets the minimum", () => {
    const result = evaluatePolicy(
      AUTO_APPLY_DEFAULTS,
      { ...facts(), salary: { kind: "missing" } },
      context(),
    );
    expect(result.decision).toBe("eligible_for_dry_run");
    expect(result.salaryMeetsMinimum).toBeNull();
    expect(result.reasons).toContain("salary_unlisted_allowed");
  });
  test("unknown and incomparable pay cannot use the missing-pay exception", () => {
    for (const kind of ["unknown", "incomparable"] as const)
      expect(
        evaluatePolicy(AUTO_APPLY_DEFAULTS, { ...facts(), salary: { kind } }, context()).decision,
      ).toBe("review");
    for (const policy of ["skip", "review"] as const)
      expect(
        evaluatePolicy(
          { ...AUTO_APPLY_DEFAULTS, unlistedSalary: policy },
          { ...facts(), salary: { kind: "missing" } },
          context(),
        ).decision,
      ).toBe(policy);
  });
  test("unknown country, arrangement, role or score requires review", () => {
    for (const next of [
      { ...facts(), country: null },
      { ...facts(), arrangement: null },
      { ...facts(), role: null },
      { ...facts(), matchScore: null },
    ])
      expect(evaluatePolicy(AUTO_APPLY_DEFAULTS, next, context()).decision).toBe("review");
  });
  test("explicit incompatible location, arrangement or role fails", () => {
    for (const next of [
      { ...facts(), country: "CA" },
      { ...facts(), role: "Accountant" },
    ])
      expect(evaluatePolicy(AUTO_APPLY_DEFAULTS, next, context()).decision).toBe("skip");
    expect(
      evaluatePolicy({ ...AUTO_APPLY_DEFAULTS, workArrangements: ["Hybrid"] }, facts(), context())
        .decision,
    ).toBe("skip");
    expect(
      evaluatePolicy(
        { ...AUTO_APPLY_DEFAULTS, location: "Boston, MA" },
        { ...facts(), location: "Albany, NY" },
        context(),
      ).decision,
    ).toBe("skip");
    expect(
      evaluatePolicy({ ...AUTO_APPLY_DEFAULTS, location: "Boston, MA" }, facts(), context())
        .decision,
    ).toBe("review");
  });
  test("resume, manual selection and uncertain duplicate gates cannot be bypassed", () => {
    expect(
      evaluatePolicy(AUTO_APPLY_DEFAULTS, facts(), { ...context(), approvedResume: false })
        .decision,
    ).toBe("review");
    expect(
      evaluatePolicy({ ...AUTO_APPLY_DEFAULTS, resumeSelection: "manual" }, facts(), {
        ...context(),
        manualResumeSelected: false,
      }).decision,
    ).toBe("review");
    expect(
      evaluatePolicy(AUTO_APPLY_DEFAULTS, facts(), { ...context(), duplicateUncertain: true })
        .decision,
    ).toBe("review");
  });
  test("duplicates, zero capacity, invalid capacity and disabled preference skip", () => {
    for (const next of [
      { ...context(), duplicateApplication: true },
      { ...context(), duplicateInProgress: true },
      { ...context(), remaining: 0 },
      { ...context(), remaining: NaN },
    ])
      expect(evaluatePolicy(AUTO_APPLY_DEFAULTS, facts(), next).decision).toBe("skip");
    expect(
      evaluatePolicy({ ...AUTO_APPLY_DEFAULTS, autoApplyRequested: false }, facts(), context())
        .decision,
    ).toBe("skip");
  });
  test("invalid stored policy or assessment fails closed", () => {
    expect(() =>
      evaluatePolicy(
        { ...AUTO_APPLY_DEFAULTS, approvalForExceptions: false } as never,
        facts(),
        context(),
      ),
    ).toThrow();
    expect(() =>
      evaluatePolicy(AUTO_APPLY_DEFAULTS, { ...facts(), matchScore: 101 }, context()),
    ).toThrow();
  });
});
