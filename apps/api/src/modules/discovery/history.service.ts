import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { type PaginationQuery, pageSlice, paginate } from "@jobpilot/contracts/pagination";
import { inject, injectable } from "@needle-di/core";
import { PrismaClient } from "@/generated/prisma/client";
import { discoveryEventSchema } from "./schemas";

@injectable()
export class DiscoveryHistoryService {
  constructor(private readonly prisma: PrismaClient = inject(PrismaClient)) {}
  async history(userId: string, query: PaginationQuery) {
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.discoveryEvent.findMany({
        where,
        ...pageSlice(query),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.discoveryEvent.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        createdAt: row.createdAt,
        metadata: discoveryEventSchema.parse(row.metadata),
      })),
      query,
      total,
    );
  }
  async jobs(userId: string, query: PaginationQuery) {
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.discoveredJob.findMany({
        where,
        ...pageSlice(query),
        orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.discoveredJob.count({ where }),
    ]);
    return paginate(
      rows.map((row) => ({
        id: row.id,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        snapshot: ingestionBatchSchema.shape.jobs.element.parse(row.snapshot),
      })),
      query,
      total,
    );
  }
}
