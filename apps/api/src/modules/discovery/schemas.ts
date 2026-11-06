import { autoApplyPreferencesSchema } from "@jobpilot/contracts/auto-apply";
import { DISCOVERY_FAILURES } from "@jobpilot/contracts/discovery";
import { z } from "zod/v4";

export const discoveryPlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  settings: autoApplyPreferencesSchema,
});
export const discoveryMappingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  cursor: z.string().max(4000).nullable(),
  issues: z
    .array(
      z.strictObject({
        index: z.number().int().nonnegative(),
        reason: z.enum([
          "invalid_job",
          "invalid_discovery_fields",
          "salary_unverified",
          "description_missing",
        ]),
      }),
    )
    .max(3000),
});
export const discoveryEventSchema = z.strictObject({
  runId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  deliveryId: z.uuid().optional(),
  failure: z.enum(DISCOVERY_FAILURES).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  count: z.number().int().nonnegative().optional(),
});
