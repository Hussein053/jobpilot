import { SECRET_CONTEXTS } from "@/common/crypto/contexts";
import { encrypt, generateDek } from "@/common/crypto/secret";
import {
  answerUseEnvelopeSchema,
  decryptAnswerUse,
  encryptAnswerUse,
} from "./answer-history.protection";
import { describe, expect, test } from "bun:test";

const envelope = () =>
  answerUseEnvelopeSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    preparationId: crypto.randomUUID(),
    questionId: "experience",
    question: "Describe your experience leading cross-functional teams.",
    intent: "other",
    sensitive: false,
    entryId: crypto.randomUUID(),
    entryVersion: 2,
    approvedAt: "2026-11-04T10:00:00.000Z",
    reviewDueAt: "2026-11-05T10:00:00.000Z",
    capturedAt: "2026-11-04T11:00:00.000Z",
    jobUrl: "https://fixture.invalid/job",
    scope: "job",
    scopeKey: "https://fixture.invalid/job",
    source: { kind: "user_entered", referenceId: null, referenceVersion: null },
    answer: { kind: "text", value: "PRIVATE approved original fixture answer" },
  });

describe("encrypted preparation answer-use evidence", () => {
  test("retains exact approved values while ciphertext reveals neither value nor question", () => {
    const original = envelope();
    const key = generateDek();
    const cipher = encryptAnswerUse(original, key);
    expect(cipher).not.toContain("PRIVATE");
    expect(cipher).not.toContain(original.question);
    expect(decryptAnswerUse(cipher, key, original)).toEqual(original);
    expect(encryptAnswerUse(original, key)).not.toBe(cipher);
  });
  test("binds archives to their owner, preparation, question, source and capture time", () => {
    const original = envelope();
    const key = generateDek();
    const cipher = encryptAnswerUse(original, key);
    for (const field of [
      "id",
      "userId",
      "preparationId",
      "questionId",
      "entryId",
      "entryVersion",
      "capturedAt",
    ] as const) {
      const changed = { ...original, [field]: field === "entryVersion" ? 3 : crypto.randomUUID() };
      expect(() => decryptAnswerUse(cipher, key, changed)).toThrow();
    }
  });
  test("rejects wrong keys, other-purpose ciphertext and corruption", () => {
    const original = envelope();
    const key = generateDek();
    const cipher = encryptAnswerUse(original, key);
    expect(() => decryptAnswerUse(cipher, generateDek(), original)).toThrow();
    expect(() =>
      decryptAnswerUse(
        encrypt(key, SECRET_CONTEXTS.informationEntry, JSON.stringify(original)),
        key,
        original,
      ),
    ).toThrow();
    const corrupt = (cipher[0] === "A" ? "B" : "A") + cipher.slice(1);
    expect(() => decryptAnswerUse(corrupt, key, original)).toThrow();
  });
});
