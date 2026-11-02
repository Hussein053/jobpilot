import { pageSlice } from "@jobpilot/contracts/pagination";
import { inject, injectable } from "@needle-di/core";
import { SECRET_CONTEXTS } from "@/common/crypto/contexts";
import { CryptoService } from "@/common/crypto/crypto.service";
import { PrismaClient } from "@/generated/prisma/client";
import { decideAnswer, type QuestionContext } from "./answer-policy";
import { readEntry } from "./protection";

// In-process only: a confined preparer supplies verified field context and its server-owned user.
@injectable()
export class AnswerResolutionService {
  constructor(
    private readonly prisma: PrismaClient = inject(PrismaClient),
    private readonly crypto: CryptoService = inject(CryptoService),
  ) {}
  async resolve(userId: string, context: Omit<QuestionContext, "userId">) {
    if (!context.verified) return { decision: "review" as const, reason: "unverified_question" };
    const keyed = (value: string) =>
      this.crypto.fingerprintFor(userId, SECRET_CONTEXTS.informationLookup, value);
    const scopes: [string, string | null][] = [
      ["global", null],
      ["job", context.jobUrl],
    ];
    if (context.company) scopes.push(["company", context.company]);
    if (context.role) scopes.push(["role", context.role]);
    const scopeFingerprints = await Promise.all(
      scopes.map((scope) => keyed(`scope\0${JSON.stringify(scope)}`)),
    );
    const now = new Date();
    const rows = await this.prisma.answerEntry.findMany({
      where: {
        userId,
        intent: context.intent,
        status: "approved",
        reviewDueAt: { gt: now },
        questionKeys: { has: await keyed(`question\0${context.question.normalize("NFC").trim()}`) },
        scopeFingerprint: { in: scopeFingerprints },
      },
      ...pageSlice({ page: 1, limit: 21 }),
      orderBy: { id: "asc" },
    });
    if (rows.length > 20) return { decision: "review" as const, reason: "conflicting_answers" };
    const candidates = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        userId: row.userId,
        version: row.version,
        status: row.status,
        approvedAt: row.approvedAt,
        reviewDueAt: row.reviewDueAt,
        definition: (await readEntry(row, this.crypto)).envelope.definition,
      })),
    );
    return decideAnswer(candidates, { ...context, userId }, now);
  }
}
