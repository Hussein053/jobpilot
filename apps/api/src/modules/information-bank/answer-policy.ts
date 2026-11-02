import {
  type AnswerIntent,
  type BankEntryDefinition,
  requiresSpecificContext,
} from "@jobpilot/contracts/information-bank";

export interface AnswerCandidate {
  id: string;
  userId: string;
  version: number;
  status: string;
  approvedAt: Date | null;
  reviewDueAt: Date | null;
  definition: BankEntryDefinition;
}
export interface QuestionContext {
  userId: string;
  question: string;
  intent: AnswerIntent;
  kind: BankEntryDefinition["answer"]["kind"];
  options: string[];
  role: string | null;
  company: string | null;
  jobUrl: string;
  verified: boolean;
}
const rank = { global: 0, role: 1, company: 2, job: 3 };
const same = (a: string, b: string) => a.normalize("NFC").trim() === b.normalize("NFC").trim();

export function decideAnswer(
  candidates: AnswerCandidate[],
  context: QuestionContext,
  now = new Date(),
) {
  if (!context.verified) return { decision: "review" as const, reason: "unverified_question" };
  const applicable = candidates
    .filter((entry) => {
      const definition = entry.definition;
      if (
        entry.userId !== context.userId ||
        entry.status !== "approved" ||
        !entry.approvedAt ||
        entry.approvedAt > now ||
        !entry.reviewDueAt ||
        entry.reviewDueAt <= now
      )
        return false;
      if (definition.intent !== context.intent || definition.answer.kind !== context.kind)
        return false;
      if (
        ![definition.question, ...definition.aliases].some((question) =>
          same(question, context.question),
        )
      )
        return false;
      if (
        requiresSpecificContext(definition) &&
        (definition.scope !== "job" ||
          entry.reviewDueAt.getTime() - entry.approvedAt.getTime() > 7 * 86_400_000)
      )
        return false;
      if (definition.scope === "job" && definition.scopeKey !== context.jobUrl) return false;
      if (definition.scope === "company" && definition.scopeKey !== context.company) return false;
      if (definition.scope === "role" && definition.scopeKey !== context.role) return false;
      const options = "options" in definition.answer ? definition.answer.options : [];
      return JSON.stringify(options) === JSON.stringify(context.options);
    })
    .sort((a, b) => rank[b.definition.scope] - rank[a.definition.scope]);
  const first = applicable[0];
  if (!first)
    return { decision: "review" as const, reason: "missing_stale_or_incompatible_answer" };
  if (applicable[1] && rank[applicable[1].definition.scope] === rank[first.definition.scope])
    return { decision: "review" as const, reason: "conflicting_answers" };
  return {
    decision: "reuse" as const,
    entryId: first.id,
    entryVersion: first.version,
    reason: "approved_exact_context",
  };
}
