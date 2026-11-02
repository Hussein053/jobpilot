import { z } from "zod/v4";
import { timeZoneSchema } from "./pilot/schedule";

export const MISSING_SALARY_POLICIES = ["allow", "review", "skip"] as const;
export const SEARCH_FREQUENCIES = ["hourly", "three_times_daily", "manual"] as const;
export const RESUME_SELECTIONS = ["auto", "manual", "fixed"] as const;
export const DB_WORK_ARRANGEMENTS = ["Remote", "Hybrid", "OnSite"] as const;
const unique = (values: string[]) =>
  new Set(values.map((v) => v.toLowerCase())).size === values.length;

const preferenceFields = z
  .object({
    autoApplyRequested: z.boolean(),
    minimumSalaryUSD: z.number().int().min(0).max(2147483647),
    unlistedSalary: z.enum(MISSING_SALARY_POLICIES),
    roles: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(30)
      .refine(unique, "Remove duplicate roles."),
    location: z.string().trim().min(1).max(300),
    workArrangements: z
      .array(z.enum(["Remote", "Hybrid", "On-site"]))
      .min(1)
      .max(3)
      .refine(unique, "Remove duplicate arrangements."),
    maxDailyApplications: z.number().int().min(1).max(100),
    searchFrequency: z.enum(SEARCH_FREQUENCIES),
    timeZone: timeZoneSchema,
    runHours: z
      .array(z.number().int().min(0).max(23))
      .length(3)
      .refine((hours) => new Set(hours).size === 3, "Choose three distinct hours."),
    resumeSelection: z.enum(RESUME_SELECTIONS),
    fixedResumeId: z.uuid().nullable(),
    minimumMatchScore: z.number().int().min(50).max(100),
    approvalForExceptions: z.literal(true),
  })
  .strict();

export const autoApplyPreferencesSchema = preferenceFields.refine(
  (value) => (value.resumeSelection === "fixed") === (value.fixedResumeId !== null),
  { message: "A fixed resume is required only for fixed selection.", path: ["fixedResumeId"] },
);
export type AutoApplyPreferences = z.infer<typeof autoApplyPreferencesSchema>;

export const AUTO_APPLY_DEFAULTS: Readonly<AutoApplyPreferences> =
  Object.freeze<AutoApplyPreferences>({
    autoApplyRequested: true,
    minimumSalaryUSD: 80000,
    unlistedSalary: "allow",
    roles: ["Program Manager", "Project Manager", "Business Analyst"],
    location: "United States — Nationwide",
    workArrangements: ["Remote", "Hybrid", "On-site"],
    maxDailyApplications: 50,
    searchFrequency: "hourly",
    timeZone: "UTC",
    runHours: [9, 13, 17],
    resumeSelection: "auto",
    fixedResumeId: null,
    minimumMatchScore: 85,
    approvalForExceptions: true,
  });

export const patchAutoApplySettingsSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483646),
    changes: preferenceFields
      .partial()
      .refine((value) => Object.keys(value).length > 0, "Supply at least one change."),
  })
  .strict();
