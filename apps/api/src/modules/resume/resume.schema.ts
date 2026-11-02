import { resumeDataSchema } from "@jobpilot/contracts/resume";
import { z } from "zod/v4";

export const createResumeSchema = z.object({
  label: z.string().min(1),
  content: resumeDataSchema.optional(),
});

export const updateResumeSchema = createResumeSchema.partial();

export const resumeSummarySchema = z.object({
  id: z.uuid(),
  label: z.string(),
  version: z.number().int(),
  reviewRevision: z.number().int(),
  active: z.boolean(),
  approvedAt: z.date().nullable(),
  approvedVersion: z.number().int().nullable(),
  approved: z.boolean(),
  sourceFilename: z.string().nullable(),
  hasData: z.boolean(),
  variantCount: z.number().int(),
  isPrimary: z.boolean(),
  updatedAt: z.date(),
});

export const resumeListSchema = z.array(resumeSummarySchema);

/** A resume contact field that disagrees with the profile the form-filler submits. */
export const profileMismatchSchema = z.object({
  field: z.enum(["location", "email", "phone", "linkedin", "github", "website"]),
  resume: z.string(),
  profile: z.string(),
});

export const resumeDetailSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  label: z.string(),
  content: resumeDataSchema.nullable(),
  version: z.number().int(),
  reviewRevision: z.number().int(),
  active: z.boolean(),
  approvedAt: z.date().nullable(),
  approvedVersion: z.number().int().nullable(),
  approved: z.boolean(),
  sourceFilename: z.string().nullable(),
  sourceMimeType: z.string().nullable(),
  sourceSizeBytes: z.number().int().nullable(),
  isPrimary: z.boolean(),
  profileMismatches: z.array(profileMismatchSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const resumeUpdatedSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
});

export const sourceUploadedSchema = z.object({
  id: z.uuid(),
  sourceFilename: z.string(),
});
