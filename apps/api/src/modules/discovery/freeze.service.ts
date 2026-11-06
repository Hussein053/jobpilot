import { createHash } from "node:crypto";
import type { discoveryFailSchema, discoveryFreezeSchema } from "@jobpilot/contracts/discovery";
import { MAX_DISCOVERY_RETRY_AFTER } from "@jobpilot/contracts/discovery";
import { inject, injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { conflict } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { getExecutionPolicy } from "@/modules/execution/execution-policy";
import { freezeDiscoveryBatches } from "@/modules/ingestion/discovery/batches";
import { mapJSearch } from "@/modules/ingestion/discovery/jsearch";
import { observeJobs } from "./canonical-jobs";
import { DiscoveryContext } from "./context";
import { discoveryMappingSchema } from "./schemas";

@injectable()
export class DiscoveryFreezeService {
  constructor(private readonly context: DiscoveryContext = inject(DiscoveryContext)) {}
  async freeze(
    integrationId: string,
    input: z.infer<typeof discoveryFreezeSchema>,
    bytes: Uint8Array,
  ) {
    const c = this.context;
    return c.prisma.$transaction(
      async (tx) => {
        const { userId } = await c.owner(tx, integrationId);
        const task = await c.task(tx, integrationId, input.taskId);
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (task.state === "frozen") {
          if (task.freezeDigest !== digest) throw conflict("Frozen provider response changed");
          const deliveries = await tx.discoveryDelivery.findMany({
            where: { taskId: task.id },
            select: { id: true },
          });
          return {
            runtime: getExecutionPolicy(),
            taskId: task.id,
            state: task.state,
            deliveryIds: deliveries.map((d) => d.id),
            issueCount: discoveryMappingSchema.parse(task.mapping).issues.length,
          };
        }
        if (
          task.state !== "fetch_started" ||
          task.fetchRequestId !== input.requestId ||
          !task.startedAt ||
          c.now().getTime() - task.startedAt.getTime() >= 120000
        )
          throw conflict("Provider fetch is not current");
        let mapped: ReturnType<typeof mapJSearch>;
        try {
          mapped = mapJSearch(input.providerResponse);
        } catch {
          await tx.discoveryTask.update({
            where: { id: task.id },
            data: { state: "quarantined", failure: "mapping_invalid" },
          });
          await c.event(tx, userId, "quarantined", { taskId: task.id, failure: "mapping_invalid" });
          return {
            runtime: getExecutionPolicy(),
            taskId: task.id,
            state: "quarantined" as const,
            deliveryIds: [],
            issueCount: 0,
          };
        }
        if (!(await observeJobs(tx, userId, mapped.jobs, c.now()))) {
          await tx.discoveryTask.update({
            where: { id: task.id },
            data: { state: "quarantined", failure: "identity_conflict" },
          });
          await c.event(tx, userId, "quarantined", {
            taskId: task.id,
            failure: "identity_conflict",
          });
          return {
            runtime: getExecutionPolicy(),
            taskId: task.id,
            state: "quarantined" as const,
            deliveryIds: [],
            issueCount: 0,
          };
        }
        const batches = freezeDiscoveryBatches(
          { slotId: task.runId, roleId: task.id, cursor: null },
          mapped.jobs,
        );
        const deliveryIds = [];
        for (const batch of batches) {
          const delivery = await tx.discoveryDelivery.create({
            data: {
              taskId: task.id,
              runId: batch.runId,
              body: batch.body,
              digest: batch.digest,
              nextAttemptAt: c.now(),
              createdAt: c.now(),
            },
          });
          deliveryIds.push(delivery.id);
        }
        await tx.discoveryTask.update({
          where: { id: task.id },
          data: {
            state: "frozen",
            freezeDigest: digest,
            mapping: toInputJson(
              discoveryMappingSchema.parse({
                schemaVersion: 1,
                issues: mapped.issues,
                cursor: mapped.cursor,
              }),
            ),
          },
        });
        await c.event(tx, userId, "frozen", { taskId: task.id, count: deliveryIds.length });
        return {
          runtime: getExecutionPolicy(),
          taskId: task.id,
          state: "frozen" as const,
          deliveryIds,
          issueCount: mapped.issues.length,
        };
      },
      { timeout: 30000 },
    );
  }
  async fail(integrationId: string, input: z.infer<typeof discoveryFailSchema>) {
    const c = this.context;
    return c.prisma.$transaction(async (tx) => {
      const { userId } = await c.owner(tx, integrationId);
      const task = await c.task(tx, integrationId, input.taskId);
      if (task.state === "fetch_started" && task.fetchRequestId === input.requestId) {
        await tx.discoveryTask.update({
          where: { id: task.id },
          data: { state: "quarantined", failure: "provider_uncertain" },
        });
        if (
          input.httpStatus === 401 ||
          input.httpStatus === 403 ||
          input.retryAfterSeconds === MAX_DISCOVERY_RETRY_AFTER
        )
          await tx.discoveryPolicy.update({
            where: { userId },
            data: { providerAuthBlockedAt: c.now() },
          });
        else if (input.httpStatus === 429 || (input.httpStatus !== null && input.httpStatus >= 500))
          await tx.discoveryPolicy.update({
            where: { userId },
            data: {
              providerBlockedUntil: new Date(
                c.now().getTime() + Math.max(60, input.retryAfterSeconds ?? 0) * 1000,
              ),
            },
          });
        await c.event(tx, userId, "provider_failed", {
          taskId: task.id,
          failure: "provider_uncertain",
          ...(input.httpStatus && { httpStatus: input.httpStatus }),
        });
      }
      return {
        runtime: getExecutionPolicy(),
        taskId: task.id,
        state:
          task.state === "fetch_started" && task.fetchRequestId === input.requestId
            ? ("quarantined" as const)
            : task.state,
        deliveryIds: [],
        issueCount: 0,
      };
    });
  }
}
