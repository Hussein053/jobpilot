import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { type PaginationQuery, pageSlice, paginate } from "@jobpilot/contracts/pagination";
import { inject, injectable } from "@needle-di/core";
import { badRequest, conflict, prismaCode, unauthorized, unprocessable } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { PrismaClient } from "@/generated/prisma/client";
import { getExecutionPolicy } from "@/modules/execution/execution-policy";
import { signedHeaders, verifyBatchSignature } from "./signature";

const MAX_BYTES = 65_536;

async function readBatch(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json" ||
    (request.headers.get("content-encoding") ?? "identity") !== "identity"
  ) {
    throw badRequest("Use uncompressed application/json");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (!reader) throw badRequest("Missing batch");
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw badRequest("Batch exceeds 65536 bytes");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

@injectable()
export class IngestionService {
  constructor(private readonly prisma: PrismaClient = inject(PrismaClient)) {}

  async ingest(request: Request) {
    const headers = signedHeaders(request.headers);
    const integration = await this.prisma.ingestionIntegration.findUnique({
      where: { id: headers.integrationId },
    });
    if (!integration?.active) throw unauthorized("Invalid ingestion signature");
    const bytes = await readBatch(request);
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
