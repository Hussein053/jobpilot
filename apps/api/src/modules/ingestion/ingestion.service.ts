import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { type PaginationQuery, pageSlice, paginate } from "@jobpilot/contracts/pagination";
import { inject, injectable } from "@needle-di/core";
import { badRequest, conflict, prismaCode, unauthorized, unprocessable } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { PrismaClient } from "@/generated/prisma/client";
import { getExecutionPolicy } from "@/modules/execution/execution-policy";
import { readBoundedBody } from "./bounded-body";
import { signedHeaders, verifyBatchSignature } from "./signature";

@injectable()
export class IngestionService {
  constructor(private readonly prisma: PrismaClient = inject(PrismaClient)) {}

  async ingest(request: Request) {
    const headers = signedHeaders(request.headers);
    const integration = await this.prisma.ingestionIntegration.findUnique({
      where: { id: headers.integrationId },
    });
    if (!integration?.active) throw unauthorized("Invalid ingestion signature");
    const bytes = await readBoundedBody(request, 65_536);
    const bodyDigest = verifyBatchSignature(headers, bytes, integration.publicKeyPem);
    let input: unknown;
    try {
      input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw badRequest("Malformed batch JSON");
    }
    const parsed = ingestionBatchSchema.safeParse(input);
    if (!parsed.success) throw unprocessable("Invalid discovery batch");
    const batch = parsed.data;
    const where = { integrationId_runId: { integrationId: integration.id, runId: batch.runId } };
    const existing = await this.prisma.ingestionRun.findUnique({ where });
    if (existing) return this.receipt(existing, bodyDigest, true);
    try {
      const created = await this.prisma.ingestionRun.create({
        data: {
          integrationId: integration.id,
          runId: batch.runId,
          bodyDigest,
          batch: toInputJson(batch),
        },
      });
      return this.receipt(created, bodyDigest, false);
    } catch (error) {
      if (prismaCode(error) !== "P2002") throw error;
      const winner = await this.prisma.ingestionRun.findUnique({ where });
      if (!winner) throw error;
      return this.receipt(winner, bodyDigest, true);
    }
  }

  async history(userId: string, query: PaginationQuery) {
    const where = { integration: { userId } };
    const [rows, total] = await Promise.all([
      this.prisma.ingestionRun.findMany({
        where,
        ...pageSlice(query),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, runId: true, batch: true, createdAt: true },
      }),
      this.prisma.ingestionRun.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        runId: row.runId,
        createdAt: row.createdAt,
        batch: ingestionBatchSchema.parse(row.batch),
      })),
      query,
      total,
    );
  }

  private receipt(
    row: { id: string; runId: string; bodyDigest: string },
    digest: string,
    duplicate: boolean,
  ) {
    if (row.bodyDigest !== digest) throw conflict("Run ID already used for a different batch");
    return {
      id: row.id,
      runId: row.runId,
      duplicate,
      disposition: "stored_only" as const,
      runtime: getExecutionPolicy(),
    };
  }
}
