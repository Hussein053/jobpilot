import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import type { z } from "zod/v4";
import { toInputJson } from "@/common/json";
import type { DiscoveryIdentityKind, Prisma } from "@/generated/prisma/client";

type Job = z.infer<typeof ingestionBatchSchema>["jobs"][number];
export async function observeJobs(
  tx: Prisma.TransactionClient,
  userId: string,
  jobs: Job[],
  now: Date,
) {
  const existing = await tx.discoveryIdentity.findMany({
    where: {
      userId,
      OR: [
        { kind: "source", value: { in: jobs.map((job) => job.sourceId) } },
        { kind: "url", value: { in: jobs.map((job) => job.url) } },
      ],
    },
  });
  const key = (kind: string, value: string) => `${kind}\0${value}`;
  const identities = new Map(existing.map((row) => [key(row.kind, row.value), row.jobId]));
  const known = new Set(identities.keys());
  const originalIds = new Set(existing.map((row) => row.jobId));
  const snapshots = new Map<string, Job>();
  const added: { kind: DiscoveryIdentityKind; value: string; jobId: string }[] = [];
  for (const job of jobs) {
    const source = identities.get(key("source", job.sourceId));
    const url = identities.get(key("url", job.url));
    if (source && url && source !== url) return false;
    const id = source ?? url ?? crypto.randomUUID();
    snapshots.set(id, job);
    for (const [kind, value] of [
      ["source", job.sourceId],
      ["url", job.url],
    ] as const) {
      const k = key(kind, value);
      if (!identities.has(k)) {
        identities.set(k, id);
        if (!known.has(k)) added.push({ kind, value, jobId: id });
      }
    }
  }
  for (const [id, job] of snapshots) {
    const snapshot = toInputJson(ingestionBatchSchema.shape.jobs.element.parse(job));
    if (originalIds.has(id))
      await tx.discoveredJob.update({ where: { id, userId }, data: { snapshot, lastSeenAt: now } });
    else
      await tx.discoveredJob.create({
        data: { id, userId, snapshot, firstSeenAt: now, lastSeenAt: now },
      });
  }
  if (added.length)
    await tx.discoveryIdentity.createMany({
      data: added.map((entry) => ({ id: crypto.randomUUID(), userId, ...entry })),
    });
  return true;
}
