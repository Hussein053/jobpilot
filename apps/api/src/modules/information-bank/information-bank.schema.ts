import {
  ANSWER_CATEGORIES,
  ANSWER_EVENT_ACTIONS,
  ANSWER_STATUSES,
  bankEntryDefinitionSchema,
  bankProvenanceSchema,
} from "@jobpilot/contracts/information-bank";
import { paginatedSchema, paginationQuerySchema } from "@jobpilot/contracts/pagination";
import { z } from "zod/v4";

export const bankListQuery = paginationQuerySchema.extend({
  category: z.enum(ANSWER_CATEGORIES).optional(),
  status: z.enum(ANSWER_STATUSES).optional(),
  query: z.string().trim().max(200).optional(),
});
export const bankEntryResponse = z.object({
  id: z.uuid(),
  version: z.number().int(),
  status: z.enum(ANSWER_STATUSES),
  approvedAt: z.date().nullable(),
  reviewDueAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  ready: z.boolean(),
  sensitive: z.boolean(),
  definition: bankEntryDefinitionSchema,
  source: bankProvenanceSchema,
});
export const bankListResponse = paginatedSchema(bankEntryResponse);
export const bankHistoryResponse = paginatedSchema(
  z.object({
    id: z.uuid(),
    version: z.number().int(),
    action: z.enum(ANSWER_EVENT_ACTIONS),
    createdAt: z.date(),
    definition: bankEntryDefinitionSchema.nullable(),
  }),
);
