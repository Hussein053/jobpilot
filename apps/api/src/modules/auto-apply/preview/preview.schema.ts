import { autoApplyPreferencesSchema } from "@jobpilot/contracts/auto-apply";
import { policyOutcomeSchema } from "@jobpilot/contracts/policy-preview";
import { storedDate } from "@jobpilot/contracts/utils/json";
import { z } from "zod/v4";

const quotaSchema = z.object({
  date: storedDate,
  timeZone: z.string(),
  startsAt: storedDate,
  resetsAt: storedDate,
  cap: z.number().int().positive(),
  recordedApplications: z.number().int().nonnegative(),
  dryRunReservations: z.number().int().nonnegative(),
  remainingActual: z.number().int().nonnegative(),
  remainingSimulation: z.number().int().nonnegative(),
});
export const previewQuerySchema = z.strictObject({
  ingestionRunId: z.uuid().optional(),
  resumeId: z.uuid().optional(),
});
const selectedResumeSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  reviewRevision: z.number().int(),
  label: z.string(),
});
export const previewJobSchema = z.object({
  sourceId: z.string(),
  title: z.string(),
  company: z.string(),
  url: z.string(),
  resume: selectedResumeSchema.nullable(),
  outcome: policyOutcomeSchema,
});
export const previewSnapshotSchema = z.object({
  settings: autoApplyPreferencesSchema,
  settingsVersion: z.number().int(),
  quota: quotaSchema,
  jobs: z.array(previewJobSchema).max(25),
});
const runtimeSchema = z.object({
  submissionMode: z.literal("DRY_RUN"),
  liveSubmissionsEnabled: z.literal(false),
  unrestrictedAgentsEnabled: z.literal(false),
});
export const previewResponseSchema = previewSnapshotSchema.extend({ runtime: runtimeSchema });
export const simulationResponseSchema = previewSnapshotSchema.extend({
  id: z.uuid(),
  requestId: z.uuid(),
  ingestionRunId: z.uuid(),
  createdAt: z.date(),
  runtime: runtimeSchema,
  duplicate: z.boolean(),
});
export const simulationSummarySchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  ingestionRunId: z.uuid(),
  settingsVersion: z.number().int(),
  createdAt: z.date(),
});
