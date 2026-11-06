import { requiresSpecificContext } from "@jobpilot/contracts/information-bank";
import type { preparationStateSchema } from "@jobpilot/contracts/preparation";
import { inject, injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { requireReviewSession } from "@/common/auth/require-review-session";
import { SECRET_CONTEXTS } from "@/common/crypto/contexts";
import { CryptoService } from "@/common/crypto/crypto.service";
import { generateDek } from "@/common/crypto/secret";
import { conflict, notFound } from "@/common/errors";
import { type Prisma, PrismaClient } from "@/generated/prisma/client";
import { readEntry } from "@/modules/information-bank/protection";
import { decryptAnswerUse, encryptAnswerUse } from "./answer-history.protection";

type State = z.infer<typeof preparationStateSchema>;

@injectable()
export class PreparationAnswerHistoryService {
  constructor(
    private readonly prisma: PrismaClient = inject(PrismaClient),
    private readonly crypto = inject(CryptoService),
  ) {}

  // Called only inside the preparer's owner-locked simulation transaction; failure rolls it back.
  async capture(
    tx: Prisma.TransactionClient,
    userId: string,
    preparationId: string,
    state: State,
    capturedAt: Date,
  ) {
    const owner = await tx.user.findUnique({ where: { id: userId }, select: { wrappedDek: true } });
    if (!owner?.wrappedDek) throw conflict("Approved answer encryption key is unavailable.");
    for (const question of state.questions) {
      if (question.status !== "approved" || !question.entryId || !question.entryVersion) continue;
      const entry = await tx.answerEntry.findFirst({
        where: {
          id: question.entryId,
          userId,
          version: question.entryVersion,
          status: "approved",
          approvedAt: { lte: capturedAt },
          reviewDueAt: { gt: capturedAt },
        },
      });
      if (!entry) throw conflict("Answer approval changed; review before simulation.");
      const { envelope } = await readEntry(entry, this.crypto);
      if (
        !envelope.approvedAt ||
        !envelope.reviewDueAt ||
        envelope.definition.intent !== question.intent ||
        envelope.definition.answer.kind !== question.kind
      )
        throw conflict("Approved answer context could not be verified.");
      const id = crypto.randomUUID();
      const key = generateDek();
      const keyCipher = await this.crypto.encryptFor(
        userId,
        SECRET_CONTEXTS.preparationAnswerKey,
        key.toString("base64"),
      );
      const payloadCipher = encryptAnswerUse(
        {
          schemaVersion: 1,
          id,
          userId,
          preparationId,
          questionId: question.id,
          question: question.label,
          intent: question.intent,
          sensitive: requiresSpecificContext(envelope.definition),
          entryId: entry.id,
          entryVersion: entry.version,
          approvedAt: envelope.approvedAt,
          reviewDueAt: envelope.reviewDueAt,
          capturedAt: capturedAt.toISOString(),
          jobUrl: state.job.url,
          scope: envelope.definition.scope,
          scopeKey: envelope.definition.scopeKey,
          source: envelope.source,
          answer: envelope.definition.answer,
        },
        key,
      );
      await tx.preparationAnswerUse.create({
        data: {
          id,
          userId,
          preparationId,
          questionId: question.id,
          entryId: entry.id,
          entryVersion: entry.version,
          keyCipher,
          payloadCipher,
          createdAt: capturedAt,
        },
      });
    }
  }

  async history(userId: string, tokenId: string, preparationId: string) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const preparation = await this.prisma.applicationPreparation.findFirst({
      where: { id: preparationId, userId },
      select: { status: true },
    });
    if (!preparation) throw notFound("Preparation not found");
    if (preparation.status !== "simulated")
      throw conflict("Historical answer values exist only after a completed simulation.");
    const rows = await this.prisma.preparationAnswerUse.findMany({
      where: { userId, preparationId },
      orderBy: [{ questionId: "asc" }, { id: "asc" }],
    });
    if (rows.length) {
      const owner = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { wrappedDek: true },
      });
      if (!owner?.wrappedDek) throw conflict("Historical answer encryption key is unavailable.");
    }
    const items = await Promise.all(
      rows.map(async (row) => {
        const key = Buffer.from(
          await this.crypto.decryptFor(userId, SECRET_CONTEXTS.preparationAnswerKey, row.keyCipher),
          "base64",
        );
        if (key.length !== 32) throw new Error("Historical answer key could not be verified");
        const envelope = decryptAnswerUse(row.payloadCipher, key, {
          ...row,
          capturedAt: row.createdAt.toISOString(),
        });
        return {
          id: row.id,
          questionId: row.questionId,
          question: envelope.question,
          intent: envelope.intent,
          sensitive: envelope.sensitive,
          entryId: row.entryId,
          entryVersion: row.entryVersion,
          approvedAt: new Date(envelope.approvedAt),
          reviewDueAt: new Date(envelope.reviewDueAt),
          capturedAt: row.createdAt,
          scope: envelope.scope,
          scopeKey: envelope.scopeKey,
          source: envelope.source,
          answer: envelope.answer,
        };
      }),
    );
    await requireReviewSession(this.prisma, userId, tokenId);
    return {
      historicalOnly: true as const,
      canReuse: false as const,
      canSubmit: false as const,
      items,
    };
  }
}
