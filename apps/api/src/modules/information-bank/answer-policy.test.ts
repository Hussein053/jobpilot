import { bankEntryDefinitionSchema } from "@jobpilot/contracts/information-bank";
import { type AnswerCandidate, decideAnswer, type QuestionContext } from "./answer-policy";
import { describe, expect, it } from "bun:test";

const now = new Date("2026-11-02T12:00:00Z");
function candidate(): AnswerCandidate {
  return {
    id: crypto.randomUUID(),
    userId: "fixture-owner",
    version: 2,
    status: "approved",
    approvedAt: new Date("2026-11-01T12:00:00Z"),
    reviewDueAt: new Date("2026-11-05T12:00:00Z"),
    definition: bankEntryDefinitionSchema.parse({
      question: "What is your contact email?",
      aliases: ["Which email should we use to contact you?"],
      intent: "contact",
      category: "identity",
      scope: "global",
      scopeKey: null,
      answer: { kind: "text", value: "synthetic@example.test" },
    }),
  };
}
const question = (): QuestionContext => ({
  userId: "fixture-owner",
  question: "Which email should we use to contact you?",
  intent: "contact",
  kind: "text",
  options: [],
  role: "Program Manager",
  company: "fixture.example.test",
  jobUrl: "https://jobs.example.test/1",
  verified: true,
});

describe("approved answer reuse policy", () => {
  it("recognizes an explicitly reviewed equivalent wording and returns a reference only", () => {
    const entry = candidate();
    expect(decideAnswer([entry], question(), now)).toEqual({
      decision: "reuse",
      entryId: entry.id,
      entryVersion: 2,
      reason: "approved_exact_context",
    });
    expect(JSON.stringify(decideAnswer([entry], question(), now))).not.toContain(
      "synthetic@example.test",
    );
  });
  it("requires review for semantic guesses without an approved alias", () => {
    expect(
      decideAnswer([candidate()], { ...question(), question: "Tell me how to reach you" }, now)
        .decision,
    ).toBe("review");
    expect(decideAnswer([candidate()], { ...question(), verified: false }, now).decision).toBe(
      "review",
    );
  });
  it("rejects revoked, draft, expired, future-dated, and foreign answers", () => {
    for (const override of [
      { status: "revoked" },
      { status: "draft" },
      { reviewDueAt: now },
      { approvedAt: new Date("2026-12-01") },
      { userId: "other-owner" },
      { approvedAt: null },
    ]) {
      expect(decideAnswer([{ ...candidate(), ...override }], question(), now).decision).toBe(
        "review",
      );
    }
  });
  it("does not leak scoped answers across jobs, companies, or roles", () => {
    for (const [scope, scopeKey] of [
      ["job", "https://jobs.example.test/other"],
      ["company", "other.example.test"],
      ["role", "Other Role"],
    ] as const) {
      const entry = candidate();
      entry.definition = { ...entry.definition, scope, scopeKey };
      expect(decideAnswer([entry], question(), now).decision).toBe("review");
    }
  });
  it("prefers a more specific compatible scope and fails closed on equal-scope conflicts", () => {
    const general = candidate();
    const scoped = candidate();
    scoped.definition = { ...scoped.definition, scope: "job", scopeKey: question().jobUrl };
    expect(decideAnswer([general, scoped], question(), now)).toHaveProperty("entryId", scoped.id);
    expect(decideAnswer([general, candidate()], question(), now)).toMatchObject({
      decision: "review",
      reason: "conflicting_answers",
    });
  });
  it("does not conflate work authorization with sponsorship", () => {
    const entry = candidate();
    entry.definition = bankEntryDefinitionSchema.parse({
      question: "Are you authorized to work?",
      intent: "work_authorization",
      category: "work_eligibility",
      scope: "job",
      scopeKey: question().jobUrl,
      answer: { kind: "boolean", value: true },
    });
    const field: QuestionContext = {
      ...question(),
      question: entry.definition.question,
      intent: "work_authorization",
      kind: "boolean",
    };
    expect(decideAnswer([entry], field, now).decision).toBe("reuse");
    expect(
      decideAnswer(
        [entry],
        { ...field, question: "Do you require sponsorship?", intent: "sponsorship" },
        now,
      ).decision,
    ).toBe("review");
    entry.definition = { ...entry.definition, scope: "global", scopeKey: null };
    expect(decideAnswer([entry], field, now).decision).toBe("review");
  });
  it("keeps minimum versus desired salary and SQL versus total experience separate", () => {
    for (const [saved, requested] of [
      ["minimum_salary", "desired_salary"],
      ["experience_sql_years", "experience_total_years"],
    ] as const) {
      const entry = candidate();
      entry.definition = {
        ...entry.definition,
        intent: saved,
        scope: "job",
        scopeKey: question().jobUrl,
        answer: { kind: "number", value: 5 },
      };
      expect(
        decideAnswer([entry], { ...question(), intent: requested, kind: "number" }, now).decision,
      ).toBe("review");
    }
  });
  it("requires compatible types and exactly reviewed choice options", () => {
    const entry = candidate();
    expect(decideAnswer([entry], { ...question(), kind: "number" }, now).decision).toBe("review");
    entry.definition.answer = {
      kind: "choice",
      options: ["Yes", "No", "Prefer not to answer"],
      value: "Prefer not to answer",
    };
    expect(
      decideAnswer(
        [entry],
        { ...question(), kind: "choice", options: ["Yes", "No", "Prefer not to answer"] },
        now,
      ).decision,
    ).toBe("reuse");
    expect(
      decideAnswer([entry], { ...question(), kind: "choice", options: ["Yes", "No"] }, now)
        .decision,
    ).toBe("review");
  });
});
