import { createHash } from "node:crypto";
import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { z } from "zod/v4";
import type { DiscoveryJob } from "./jsearch";

const planSchema = z.strictObject({
  slotId: z.uuid(),
  roleId: z.uuid(),
  cursor: z.string().max(4000).nullable(),
});
function batchId(slotId: string, roleId: string, cursor: string | null, index: number) {
  const namespace = Buffer.from(slotId.replaceAll("-", ""), "hex");
  const digest = createHash("sha1")
    .update(namespace)
    .update(JSON.stringify([roleId, cursor, index]))
    .digest()
    .subarray(0, 16);
  // UUIDv5 is an identity, not an authentication primitive.
  digest[6] = (digest[6]! & 15) | 80;
  digest[8] = (digest[8]! & 63) | 128;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function freezeDiscoveryBatches(
  planInput: z.input<typeof planSchema>,
  jobs: DiscoveryJob[],
) {
  const plan = planSchema.parse(planInput);
  if (new Set(jobs.map((job) => job.sourceId)).size !== jobs.length)
    throw new Error("Duplicate discovery source identity");
  const ordered = [...jobs].sort((a, b) => {
    if (a.sourceId === b.sourceId) return 0;
    return a.sourceId < b.sourceId ? -1 : 1;
  });
  const frozen: Readonly<{ runId: string; body: string; digest: string }>[] = [];
  let chunk: DiscoveryJob[] = [];
  const serialize = (items: DiscoveryJob[]) => {
    const runId = batchId(plan.slotId, plan.roleId, plan.cursor, frozen.length);
    const data = ingestionBatchSchema.parse({ schemaVersion: 1, runId, jobs: items });
    return { runId, body: JSON.stringify(data) };
  };
  const append = () => {
    const batch = serialize(chunk);
    frozen.push(
      Object.freeze({
        ...batch,
        digest: createHash("sha256").update(batch.body).digest("hex"),
      }),
    );
    chunk = [];
  };
  for (const job of ordered) {
    ingestionBatchSchema.shape.jobs.element.parse(job);
    if (chunk.length === 25) append();
    const candidate = serialize([...chunk, job]);
    if (Buffer.byteLength(candidate.body, "utf8") > 65_536) {
      if (!chunk.length) throw new Error("Discovery job exceeds batch byte limit");
      append();
      const single = serialize([job]);
      if (Buffer.byteLength(single.body, "utf8") > 65_536)
        throw new Error("Discovery job exceeds batch byte limit");
    }
    chunk.push(job);
  }
  if (chunk.length) append();
  return Object.freeze(frozen);
}
