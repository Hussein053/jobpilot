import {
  ANSWER_STATUSES,
  bankEntryDefinitionSchema,
  bankProvenanceSchema,
} from "@jobpilot/contracts/information-bank";
import { z } from "zod/v4";
import { SECRET_CONTEXTS } from "@/common/crypto/contexts";
import type { CryptoService } from "@/common/crypto/crypto.service";
import { decrypt, encrypt, generateDek } from "@/common/crypto/secret";
import type { AnswerEntry } from "@/generated/prisma/client";

const envelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entryId: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(ANSWER_STATUSES),
  approvedAt: z.iso.datetime().nullable(),
  reviewDueAt: z.iso.datetime().nullable(),
  definition: bankEntryDefinitionSchema,
  source: bankProvenanceSchema,
});
export type BankEnvelope = z.infer<typeof envelopeSchema>;

export function newEntryKey() {
  return generateDek();
}
export function encodeEntry(envelope: BankEnvelope, key: Buffer, audit = false) {
  return encrypt(
    key,
    audit ? SECRET_CONTEXTS.informationAudit : SECRET_CONTEXTS.informationEntry,
    JSON.stringify(envelope),
  );
}
export function decodeEntry(
  cipher: string,
  key: Buffer,
  entryId: string,
  version: number,
  audit = false,
): BankEnvelope {
  let input: unknown;
  try {
    input = JSON.parse(
      decrypt(
        key,
        audit ? SECRET_CONTEXTS.informationAudit : SECRET_CONTEXTS.informationEntry,
        cipher,
      ),
    );
  } catch {
    throw new Error("Saved answer integrity could not be verified");
  }
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success || parsed.data.entryId !== entryId || parsed.data.version !== version)
    throw new Error("Saved answer integrity could not be verified");
  return parsed.data;
}
export async function readEntry(row: AnswerEntry, crypto: CryptoService) {
  const key = Buffer.from(
    await crypto.decryptFor(row.userId, SECRET_CONTEXTS.informationEntryKey, row.keyCipher),
    "base64",
  );
  if (key.length !== 32) throw new Error("Saved answer key could not be verified");
  const envelope = decodeEntry(row.payloadCipher, key, row.id, row.version);
  if (
    envelope.status !== row.status ||
    envelope.definition.intent !== row.intent ||
    envelope.definition.category !== row.category ||
    envelope.definition.scope !== row.scope ||
    envelope.approvedAt !== (row.approvedAt?.toISOString() ?? null) ||
    envelope.reviewDueAt !== (row.reviewDueAt?.toISOString() ?? null)
  )
    throw new Error("Saved answer approval could not be verified");
  return { key, envelope };
}

export function questionWords(value: string): string[] {
  return [
    ...new Set(
      value
        .normalize("NFC")
        .toLowerCase()
        .match(/[\p{L}\p{N}_]+/gu) ?? [],
    ),
  ];
}
