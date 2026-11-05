import { preparationAnswerHistorySchema } from "./preparation-answer-history";
import { describe, expect, test } from "bun:test";

describe("historical answer review contract", () => {
  const history = () => ({ historicalOnly: true, canReuse: false, canSubmit: false, items: [] });
  test("never accepts history as authorization to reuse or submit", () => {
    expect(preparationAnswerHistorySchema.safeParse(history()).success).toBe(true);
    for (const extra of [
      { historicalOnly: false },
      { canReuse: true },
      { canSubmit: true },
      { mode: "LIVE" },
      { keyCipher: "secret" },
    ])
      expect(preparationAnswerHistorySchema.safeParse({ ...history(), ...extra }).success).toBe(
        false,
      );
  });
  test("requires a typed approved answer, source version and native dates without exposing encryption fields", () => {
    const item = {
      id: crypto.randomUUID(),
      questionId: "contact",
      question: "Your contact email?",
      intent: "contact",
      sensitive: false,
      entryId: crypto.randomUUID(),
      entryVersion: 2,
      approvedAt: new Date(),
      reviewDueAt: new Date(),
      capturedAt: new Date(),
      scope: "job",
      scopeKey: "https://fixture.invalid/job",
      source: { kind: "user_entered", referenceId: null, referenceVersion: null },
      answer: { kind: "text", value: "synthetic@example.invalid" },
    };
    expect(preparationAnswerHistorySchema.safeParse({ ...history(), items: [item] }).success).toBe(
      true,
    );
    for (const change of [
      { keyCipher: "secret" },
      { entryVersion: 0 },
      { capturedAt: "2026-11-04" },
      { answer: { kind: "boolean", value: "true" } },
    ])
      expect(
        preparationAnswerHistorySchema.safeParse({ ...history(), items: [{ ...item, ...change }] })
          .success,
      ).toBe(false);
  });
});
