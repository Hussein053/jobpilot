import { z } from "zod/v4";
import { ANSWER_INTENTS } from "./information-bank";
import { storedDate } from "./utils/json";

export const PREPARATION_STATUSES = ["review", "ready", "simulated"] as const;
export const PREPARATION_EVENTS = ["prepared", "reviewed", "simulated"] as const;
export const createPreparationSchema = z.strictObject({
  requestId: z.uuid(),
  ingestionRunId: z.uuid(),
  sourceId: z.string().min(1).max(1000),
  resumeId: z.uuid().optional(),
});
export const reviewPreparationSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  approveExceptions: z.boolean(),
});
export const simulatePreparationSchema = reviewPreparationSchema.omit({ approveExceptions: true });
export const preparationStateSchema = z.strictObject({
  settingsVersion: z.number().int().nonnegative(),
  job: z.strictObject({
    sourceId: z.string(),
    title: z.string(),
    company: z.string(),
    url: z.url(),
  }),
  resume: z
    .strictObject({
      id: z.uuid(),
      version: z.number().int().positive(),
      reviewRevision: z.number().int(),
      label: z.string(),
    })
    .nullable(),
  questions: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      intent: z.enum(ANSWER_INTENTS),
      kind: z.enum(["text", "boolean"]),
      required: z.boolean(),
      sensitive: z.boolean(),
      status: z.enum(["approved", "review"]),
      reason: z.string(),
      entryId: z.uuid().nullable(),
      entryVersion: z.number().int().positive().nullable(),
    }),
  ),
  exceptions: z.strictObject({
    required: z.literal(true),
    approved: z.boolean(),
    reasons: z.array(z.string()),
  }),
  simulation: z
    .strictObject({
      status: z.literal("simulated"),
      submitted: z.literal(false),
      finalControlBlocked: z.literal(true),
      evidence: z.array(z.string()),
    })
    .nullable(),
});
export const preparationSchema = preparationStateSchema.extend({
  id: z.uuid(),
  revision: z.number().int().positive(),
  status: z.enum(PREPARATION_STATUSES),
  createdAt: z.date(),
  updatedAt: z.date(),
  runtime: z.strictObject({
    mode: z.literal("DRY_RUN"),
    canSubmit: z.literal(false),
    externalFormsEnabled: z.literal(false),
  }),
  audit: z.array(
    z.strictObject({
      kind: z.enum(PREPARATION_EVENTS),
      at: storedDate,
      revision: z.number().int().positive(),
    }),
  ),
});
export type Preparation = z.infer<typeof preparationSchema>;
