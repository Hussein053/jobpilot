import {
  AUTO_APPLY_DEFAULTS,
  autoApplyPreferencesSchema,
  patchAutoApplySettingsSchema,
} from "./auto-apply";
import { describe, expect, it } from "bun:test";

describe("auto-apply preferences", () => {
  it("preserves the requested defaults without granting execution", () => {
    expect(autoApplyPreferencesSchema.parse(AUTO_APPLY_DEFAULTS)).toEqual(AUTO_APPLY_DEFAULTS);
    expect(AUTO_APPLY_DEFAULTS).not.toHaveProperty("submissionMode");
    expect(AUTO_APPLY_DEFAULTS).not.toHaveProperty("liveSubmissionsEnabled");
  });

  for (const changes of [
    { minimumSalaryUSD: -1 },
    { minimumSalaryUSD: 1.1 },
    { maxDailyApplications: 0 },
    { maxDailyApplications: 101 },
    { minimumMatchScore: 49 },
    { minimumMatchScore: 100.5 },
    { roles: [] },
    { roles: [" "] },
    { roles: ["Project Manager", "project manager"] },
    { workArrangements: [] },
    { workArrangements: ["Remote", "Remote"] },
    { workArrangements: ["Anywhere"] },
    { approvalForExceptions: false },
    { timeZone: "Not/AZone" },
    { runHours: [9, 9, 17] },
    { runHours: [25, 13, 17] },
    { resumeSelection: "fixed", fixedResumeId: null },
    { fixedResumeId: "11111111-1111-4111-8111-111111111111" },
  ]) {
    it(`rejects invalid preferences ${JSON.stringify(changes)}`, () => {
      expect(
        autoApplyPreferencesSchema.safeParse({ ...AUTO_APPLY_DEFAULTS, ...changes }).success,
      ).toBe(false);
    });
  }

  it("retains custom role spelling while trimming whitespace", () => {
    expect(
      autoApplyPreferencesSchema.parse({ ...AUTO_APPLY_DEFAULTS, roles: [" Delivery Lead "] })
        .roles,
    ).toEqual(["Delivery Lead"]);
  });

  it("rejects execution controls, unknown keys, empty patches, and invalid versions", () => {
    for (const body of [
      { expectedVersion: 0, changes: {}, submissionMode: "LIVE" },
      { expectedVersion: 0, changes: { liveSubmissionsEnabled: true } },
      { expectedVersion: 0, changes: { userId: "another-user" } },
      { expectedVersion: 0, changes: {} },
      { expectedVersion: -1, changes: { minimumSalaryUSD: 1 } },
    ])
      expect(patchAutoApplySettingsSchema.safeParse(body).success).toBe(false);
  });
});
