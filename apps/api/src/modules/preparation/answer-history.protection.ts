import {
  ANSWER_INTENTS,
  ANSWER_SCOPES,
  bankAnswerSchema,
  bankProvenanceSchema,
} from "@jobpilot/contracts/information-bank";
import { z } from "zod/v4";
import { SECRET_CONTEXTS } from "@/common/crypto/contexts";
import { decrypt, encrypt } from "@/common/crypto/secret";

export const answerUseEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  userId: z.uuid(),
  preparationId: z.uuid(),
  questionId: z.string().min(1).max(100),
  question: z.string().min(1).max(1000),
  intent: z.enum(ANSWER_INTENTS),
  sensitive: z.boolean(),
  entryId: z.uuid(),
  entryVersion: z.number().int().positive(),
  approvedAt: z.iso.datetime(),
  reviewDueAt: z.iso.datetime(),
  capturedAt: z.iso.datetime(),
  jobUrl: z.url(),
  scope: z.enum(ANSWER_SCOPES),
  scopeKey: z.string().nullable(),
  source: bankProvenanceSchema,
  answer: bankAnswerSchema,
});
export type AnswerUseEnvelope = z.infer<typeof answerUseEnvelopeSchema>;

export function encryptAnswerUse(value: AnswerUseEnvelope, key: Buffer) {
  return encrypt(
    key,
    SECRET_CONTEXTS.preparationAnswerValue,
    JSON.stringify(answerUseEnvelopeSchema.parse(value)),
  );
}

export function decryptAnswerUse(
  cipher: string,
  key: Buffer,
  identity: Pick<
    AnswerUseEnvelope,
    "id" | "userId" | "preparationId" | "questionId" | "entryId" | "entryVersion" | "capturedAt"
  >,
) {
  const value = answerUseEnvelopeSchema.parse(
    JSON.parse(decrypt(key, SECRET_CONTEXTS.preparationAnswerValue, cipher)),
  );
  for (const field of [
    "id",
    "userId",
    "preparationId",
    "questionId",
    "entryId",
    "entryVersion",
    "capturedAt",
  ] as const)
    if (value[field] !== identity[field])
      throw new Error("Historical answer integrity could not be verified");
  return value;
}
