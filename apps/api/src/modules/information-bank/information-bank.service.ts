import {
  type approveBankEntrySchema,
  type BankEntryDefinition,
  bankEntryDefinitionSchema,
  type bankProvenanceSchema,
  requiresSpecificContext,
} from "@jobpilot/contracts/information-bank";
import { type PaginationQuery, pageSlice, paginate } from "@jobpilot/contracts/pagination";
import { inject, injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { requireReviewSession } from "@/common/auth/require-review-session";
import { SECRET_CONTEXTS } from "@/common/crypto/contexts";
import { CryptoService } from "@/common/crypto/crypto.service";
import { badRequest, conflict, notFound } from "@/common/errors";
import { type AnswerEntry, type Prisma, PrismaClient } from "@/generated/prisma/client";
import type { bankListQuery } from "./information-bank.schema";
import {
  type BankEnvelope,
  decodeEntry,
  encodeEntry,
  newEntryKey,
  questionWords,
  readEntry,
} from "./protection";

type Source = z.infer<typeof bankProvenanceSchema>;
const MANUAL_SOURCE: Source = { kind: "user_entered", referenceId: null, referenceVersion: null };

@injectable()
export class InformationBankService {
  constructor(
    private readonly prisma: PrismaClient = inject(PrismaClient),
    private readonly crypto: CryptoService = inject(CryptoService),
  ) {}

  private async findOwned(userId: string, id: string) {
    const row = await this.prisma.answerEntry.findFirst({ where: { id, userId } });
    if (!row) throw notFound("Answer not found");
    return row;
  }
  private async lockReview(tx: Prisma.TransactionClient, userId: string, tokenId: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!rows.length) throw notFound("Account not found");
    // Share the preparer's account lock so concurrent answer approvals cannot change its mapping.
    await requireReviewSession(tx, userId, tokenId);
  }
  private async indexes(userId: string, definition: BankEntryDefinition) {
    const keyed = (value: string) =>
      this.crypto.fingerprintFor(userId, SECRET_CONTEXTS.informationLookup, value);
    const questions = [definition.question, ...definition.aliases];
    const questionKeys = await Promise.all(
      questions.map((question) => keyed(`question\0${question.normalize("NFC")}`)),
    );
    const searchTokens = await Promise.all(
      questionWords(questions.join(" ")).map((word) => keyed(`word\0${word}`)),
    );
    let normalizedIntent: string = definition.intent;
    if (
      ["contact", "employment_preferences", "education", "certifications", "other"].includes(
        definition.intent,
      )
    )
      normalizedIntent += `_${questionKeys[0]}`;
    return {
      intent: definition.intent,
      normalizedIntent,
      category: definition.category,
      scope: definition.scope,
      scopeFingerprint: await keyed(
        `scope\0${JSON.stringify([definition.scope, definition.scopeKey])}`,
      ),
      questionKeys,
      searchTokens,
    };
  }
  private view(row: AnswerEntry, envelope: BankEnvelope) {
    return {
      id: row.id,
      version: row.version,
      status: row.status,
      approvedAt: row.approvedAt,
      reviewDueAt: row.reviewDueAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ready: row.status === "approved" && !!row.reviewDueAt && row.reviewDueAt > new Date(),
      sensitive: requiresSpecificContext(envelope.definition),
      definition: envelope.definition,
      source: envelope.source,
    };
  }

  async list(userId: string, tokenId: string, query: z.infer<typeof bankListQuery>) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const where: Prisma.AnswerEntryWhereInput = {
      userId,
      category: query.category,
      status: query.status,
    };
    if (query.query) {
      const words = questionWords(query.query);
      if (!words.length) throw badRequest("Enter at least one question word.");
      where.searchTokens = {
        hasEvery: await Promise.all(
          words.map((word) =>
            this.crypto.fingerprintFor(userId, SECRET_CONTEXTS.informationLookup, `word\0${word}`),
          ),
        ),
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.answerEntry.findMany({
        where,
        ...pageSlice(query),
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.answerEntry.count({ where }),
    ]);
    return paginate(
      await Promise.all(
        rows.map(async (row) => this.view(row, (await readEntry(row, this.crypto)).envelope)),
      ),
      query,
      total,
    );
  }
  async get(userId: string, tokenId: string, id: string) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const row = await this.findOwned(userId, id);
    return this.view(row, (await readEntry(row, this.crypto)).envelope);
  }
  async create(
    userId: string,
    tokenId: string,
    input: BankEntryDefinition,
    source: Source = MANUAL_SOURCE,
  ) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const definition = bankEntryDefinitionSchema.parse(input);
    const id = crypto.randomUUID();
    const key = newEntryKey();
    const envelope: BankEnvelope = {
      schemaVersion: 1,
      entryId: id,
      version: 1,
      status: "draft",
      approvedAt: null,
      reviewDueAt: null,
      definition,
      source,
    };
    const keyCipher = await this.crypto.encryptFor(
      userId,
      SECRET_CONTEXTS.informationEntryKey,
      key.toString("base64"),
    );
    const indexes = await this.indexes(userId, definition);
    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockReview(tx, userId, tokenId);
      const created = await tx.answerEntry.create({
        data: {
          id,
          userId,
          version: 1,
          ...indexes,
          keyCipher,
          payloadCipher: encodeEntry(envelope, key),
        },
      });
      await tx.answerEntryEvent.create({
        data: {
          userId,
          entryId: id,
          version: 1,
          action: "created",
          actorTokenId: tokenId,
          payloadCipher: encodeEntry(envelope, key, true),
        },
      });
      return created;
    });
    return this.view(row, envelope);
  }
  async edit(
    userId: string,
    tokenId: string,
    id: string,
    expectedVersion: number,
    definition: BankEntryDefinition,
  ) {
    return this.change(
      userId,
      tokenId,
      id,
      expectedVersion,
      "edited",
      bankEntryDefinitionSchema.parse(definition),
    );
  }
  async approve(
    userId: string,
    tokenId: string,
    id: string,
    input: z.infer<typeof approveBankEntrySchema>,
  ) {
    return this.change(
      userId,
      tokenId,
      id,
      input.expectedVersion,
      "approved",
      undefined,
      new Date(input.reviewDueAt),
    );
  }
  async revoke(userId: string, tokenId: string, id: string, expectedVersion: number) {
    return this.change(userId, tokenId, id, expectedVersion, "revoked");
  }

  private async change(
    userId: string,
    tokenId: string,
    id: string,
    expectedVersion: number,
    action: "edited" | "approved" | "revoked",
    definition?: BankEntryDefinition,
    due?: Date,
  ) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const current = await this.findOwned(userId, id);
    if (current.version !== expectedVersion)
      throw conflict("Answer changed. Reload before saving.", "STALE_WRITE");
    const { key, envelope: previous } = await readEntry(current, this.crypto);
    const nextDefinition = definition ?? previous.definition;
    const now = new Date();
    if (action === "approved") {
      const sensitive = requiresSpecificContext(nextDefinition);
      if (sensitive && nextDefinition.scope !== "job")
        throw badRequest("Sensitive answers require approval for one exact job URL.");
      const days = sensitive ? 7 : 90;
      if (
        !due ||
        !Number.isFinite(due.getTime()) ||
        due <= now ||
        due.getTime() > now.getTime() + days * 86_400_000
      )
        throw badRequest(`Choose a future review date within ${days} days.`);
    }
    const status = action === "approved" ? "approved" : "draft";
    const envelope: BankEnvelope = {
      ...previous,
      version: expectedVersion + 1,
      status,
      approvedAt: null,
      reviewDueAt: null,
      definition: nextDefinition,
    };
    if (action === "revoked") envelope.status = "revoked";
    if (action === "edited") envelope.source = MANUAL_SOURCE;
    if (action === "approved" && due) {
      envelope.approvedAt = now.toISOString();
      envelope.reviewDueAt = due.toISOString();
    }
    const indexes = await this.indexes(userId, nextDefinition);
    const row = await this.prisma.$transaction(async (tx) => {
      await this.lockReview(tx, userId, tokenId);
      const changed = await tx.answerEntry.updateMany({
        where: { id, userId, version: expectedVersion },
        data: {
          ...indexes,
          version: expectedVersion + 1,
          status: envelope.status,
          approvedAt: envelope.approvedAt ? new Date(envelope.approvedAt) : null,
          reviewDueAt: envelope.reviewDueAt ? new Date(envelope.reviewDueAt) : null,
          payloadCipher: encodeEntry(envelope, key),
        },
      });
      if (changed.count !== 1)
        throw conflict("Answer changed. Reload before saving.", "STALE_WRITE");
      await tx.answerEntryEvent.create({
        data: {
          userId,
          entryId: id,
          version: envelope.version,
          action,
          actorTokenId: tokenId,
          payloadCipher: encodeEntry(envelope, key, true),
        },
      });
      return tx.answerEntry.findUniqueOrThrow({ where: { id } });
    });
    return this.view(row, envelope);
  }

  async remove(userId: string, tokenId: string, id: string, expectedVersion: number) {
    await requireReviewSession(this.prisma, userId, tokenId);
    await this.findOwned(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await this.lockReview(tx, userId, tokenId);
      const changed = await tx.answerEntry.deleteMany({
        where: { id, userId, version: expectedVersion },
      });
      if (changed.count !== 1)
        throw conflict("Answer changed or was removed. Reload before deleting.", "STALE_WRITE");
      await tx.answerEntryEvent.create({
        data: {
          userId,
          entryId: id,
          version: expectedVersion + 1,
          action: "deleted",
          actorTokenId: tokenId,
        },
      });
    });
    return { deleted: id };
  }

  async history(userId: string, tokenId: string, id: string, query: PaginationQuery) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const current = await this.prisma.answerEntry.findFirst({ where: { id, userId } });
    let key: Buffer | null = null;
    if (current) key = (await readEntry(current, this.crypto)).key;
    const where = { userId, entryId: id };
    const [rows, total] = await Promise.all([
      this.prisma.answerEntryEvent.findMany({
        where,
        ...pageSlice(query),
        orderBy: { version: "desc" },
      }),
      this.prisma.answerEntryEvent.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        version: row.version,
        action: row.action,
        createdAt: row.createdAt,
        definition:
          key && row.payloadCipher
            ? decodeEntry(row.payloadCipher, key, id, row.version, true).definition
            : null,
      })),
      query,
      total,
    );
  }

  async exportEntries(userId: string, tokenId: string) {
    await requireReviewSession(this.prisma, userId, tokenId);
    const entries: ReturnType<InformationBankService["view"]>[] = [];
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.answerEntry.findMany({
        where: { userId, ...(cursor && { id: { gt: cursor } }) },
        ...pageSlice({ page: 1, limit: 100 }),
        orderBy: { id: "asc" },
      });
      for (const row of rows)
        entries.push(this.view(row, (await readEntry(row, this.crypto)).envelope));
      const last = rows.at(-1);
      if (!last || rows.length < 100) break;
      cursor = last.id;
    }
    return { exportedAt: new Date(), entries };
  }
}
