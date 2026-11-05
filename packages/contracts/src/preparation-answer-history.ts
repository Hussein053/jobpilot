import { z } from "zod/v4";
import {
  ANSWER_INTENTS,
  ANSWER_SCOPES,
  bankAnswerSchema,
  bankProvenanceSchema,
} from "./information-bank";

export const preparationAnswerHistorySchema = z.strictObject({
  historicalOnly: z.literal(true),
  canReuse: z.literal(false),
  canSubmit: z.literal(false),
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        questionId: z.string(),
        question: z.string(),
        intent: z.enum(ANSWER_INTENTS),
        sensitive: z.boolean(),
        entryId: z.uuid(),
        entryVersion: z.number().int().positive(),
        approvedAt: z.date(),
        reviewDueAt: z.date(),
        capturedAt: z.date(),
        scope: z.enum(ANSWER_SCOPES),
        scopeKey: z.string().nullable(),
        source: bankProvenanceSchema,
        answer: bankAnswerSchema,
      }),
    )
    .max(100),
});
