import {
  bankAnswerSchema,
  bankEntryDefinitionSchema,
  editBankEntrySchema,
} from "./information-bank";
import { describe, expect, it } from "bun:test";

const draft = {
  question: "What is your contact email?",
  intent: "contact",
  category: "identity",
  scope: "global",
  scopeKey: null,
  answer: { kind: "text", value: "synthetic@example.test" },
};
describe("Information Bank validation", () => {
  it("accepts typed user-provided drafts without inferring approval", () => {
    expect(bankEntryDefinitionSchema.parse(draft).aliases).toEqual([]);
    for (const extra of [
      { approved: true },
      { liveSubmissionsEnabled: true },
      { userId: crypto.randomUUID() },
    ])
      expect(bankEntryDefinitionSchema.safeParse({ ...draft, ...extra }).success).toBe(false);
  });
  it("rejects passwords, one-time codes, IDs, and payment credentials", () => {
    for (const question of [
      "Password?",
      "Your OTP?",
      "Social security number?",
      "Passport number?",
      "Credit card?",
      "Bank account?",
      "API key?",
    ])
      expect(bankEntryDefinitionSchema.safeParse({ ...draft, question }).success).toBe(false);
  });
  it("does not let a generic intent disguise a sensitive question or combine distinct intents", () => {
    for (const question of [
      "Do you need sponsorship?",
      "Are you authorized to work?",
      "Do you consent to a background check?",
    ])
      expect(bankEntryDefinitionSchema.safeParse({ ...draft, question }).success).toBe(false);
    expect(
      bankEntryDefinitionSchema.safeParse({
        ...draft,
        question: "Are you authorized to work without sponsorship?",
        intent: "work_authorization",
      }).success,
    ).toBe(false);
  });
  it("requires valid scope bindings and cannot grant execution through edits", () => {
    expect(bankEntryDefinitionSchema.safeParse({ ...draft, scope: "job" }).success).toBe(false);
    expect(
      bankEntryDefinitionSchema.safeParse({
        ...draft,
        scope: "job",
        scopeKey: "http://unsafe.example.test",
      }).success,
    ).toBe(false);
    expect(
      editBankEntrySchema.safeParse({ expectedVersion: 1, definition: draft, status: "approved" })
        .success,
    ).toBe(false);
  });
  it("validates dates, boolean values, and choices without coercion", () => {
    for (const answer of [
      { kind: "boolean", value: "false" },
      { kind: "date", value: "2026-02-30" },
      { kind: "choice", options: ["Yes", "No"], value: "Maybe" },
      { kind: "multiple_choice", options: ["Yes"], value: ["Yes", "Yes"] },
    ])
      expect(bankAnswerSchema.safeParse(answer).success).toBe(false);
    expect(bankAnswerSchema.safeParse({ kind: "boolean", value: false }).success).toBe(true);
  });
});
