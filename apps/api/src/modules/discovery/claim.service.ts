import { createHash } from "node:crypto";
import type { discoveryClaimSchema, discoveryStartSchema } from "@jobpilot/contracts/discovery";
import { providerQuerySchema } from "@jobpilot/contracts/discovery";
import { pageSlice } from "@jobpilot/contracts/pagination";
import { inject, injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { conflict } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { policyPreferences } from "@/modules/auto-apply/auto-apply.preferences";
import { getExecutionPolicy } from "@/modules/execution/execution-policy";
import { DiscoveryContext } from "./context";
import { discoverySlot } from "./schedule";
import { discoveryPlanSchema } from "./schemas";

@injectable()
export class DiscoveryClaimService {
  constructor(private readonly context: DiscoveryContext = inject(DiscoveryContext)) {}
  async claim(integrationId: string, input: z.infer<typeof discoveryClaimSchema>) {
    const c = this.context;
    return c.prisma.$transaction(
      async (tx) => {
        const { userId, policy } = await c.owner(tx, integrationId);
        const digest = createHash("sha256")
          .update(JSON.stringify([input.trigger]))
          .digest("hex");
        const prior = await tx.discoveryRun.findUnique({
          where: { integrationId_requestId: { integrationId, requestId: input.requestId } },
          include: { tasks: true },
        });
        if (prior) {
          if (prior.requestDigest !== digest) throw conflict("Discovery request identity conflict");
          return {
            runtime: getExecutionPolicy(),
            runId: prior.id,
            duplicate: true,
            status: "claimed" as const,
            taskIds: prior.tasks.map((task) => task.id),
          };
        }
        const row = await tx.autoApplyPolicy.findUnique({ where: { userId } });
        const settings = policyPreferences(row);
        const now = c.now();
        const slot = discoverySlot(settings, input.trigger, now);
        const empty = { runtime: getExecutionPolicy(), runId: null, duplicate: false, taskIds: [] };
        if (!slot) return { ...empty, status: "not_due" as const };
        if (
          policy.providerAuthBlockedAt ||
          (policy.providerBlockedUntil && policy.providerBlockedUntil > now)
        )
          return { ...empty, status: "provider_backoff" as const };
        const existing = await tx.discoveryRun.findUnique({
          where: { userId_slotKey: { userId, slotKey: slot.key } },
          include: { tasks: true },
        });
        if (existing)
          return {
            ...empty,
            runId: existing.id,
            duplicate: true,
            status: "claimed" as const,
            taskIds: existing.tasks
              .filter(
                (task) => existing.integrationId === integrationId && task.state === "planned",
              )
              .map((task) => task.id),
          };
        const day = new Date(now);
        day.setUTCHours(0, 0, 0, 0);
        const spent = await tx.discoveryTask.count({
          where: { run: { userId }, startedAt: { gte: day } },
        });
        const count = Math.min(
          policy.rolesPerSlot,
          settings.roles.length,
          policy.maxProviderRequestsPerDay - spent,
        );
        if (count <= 0) return { ...empty, status: "budget_exhausted" as const };
        const roles = Array.from(
          { length: count },
          (_, index) => settings.roles[(policy.roleCursor + index) % settings.roles.length]!,
        );
        const run = await tx.discoveryRun.create({
          data: {
            userId,
            integrationId,
            requestId: input.requestId,
            requestDigest: digest,
            trigger: input.trigger,
            slotKey: slot.key,
            slotAt: slot.at,
            settingsVersion: row?.version ?? 0,
            plan: toInputJson(discoveryPlanSchema.parse({ schemaVersion: 1, settings })),
            createdAt: now,
          },
        });
        const taskIds = [];
        for (const [position, role] of roles.entries()) {
          const query = providerQuerySchema.parse({
            query: `${role} jobs in ${settings.location}`,
            country: "us",
            numPages: 1,
            remoteOnly:
              settings.workArrangements.length === 1 && settings.workArrangements[0] === "Remote",
          });
          const task = await tx.discoveryTask.create({
            data: { runId: run.id, position, role, query: toInputJson(query), createdAt: now },
          });
          taskIds.push(task.id);
        }
        await tx.discoveryPolicy.update({
          where: { userId },
          data: { roleCursor: (policy.roleCursor + count) % settings.roles.length },
        });
        await c.event(tx, userId, "claimed", { runId: run.id, count });
        return {
          runtime: getExecutionPolicy(),
          runId: run.id,
          duplicate: false,
          status: "claimed" as const,
          taskIds,
        };
      },
      { timeout: 30000 },
    );
  }
  async start(integrationId: string, input: z.infer<typeof discoveryStartSchema>) {
    const c = this.context;
    return c.prisma.$transaction(async (tx) => {
      const { userId, policy } = await c.owner(tx, integrationId);
      const task = await c.task(tx, integrationId, input.taskId);
      const result = {
        runtime: getExecutionPolicy(),
        allowed: false,
        taskId: task.id,
        state: task.state,
        query: null,
      };
      if (task.state !== "planned") return result;
      if (
        policy.providerAuthBlockedAt ||
        (policy.providerBlockedUntil && policy.providerBlockedUntil > c.now())
      )
        return result;
      const now = c.now();
      if (now.getTime() - task.createdAt.getTime() >= 20 * 60000) return result;
      const day = new Date(now);
      day.setUTCHours(0, 0, 0, 0);
      if (
        (await tx.discoveryTask.count({ where: { run: { userId }, startedAt: { gte: day } } })) >=
        policy.maxProviderRequestsPerDay
      )
        return result;
      const query = providerQuerySchema.parse(task.query);
      await tx.discoveryTask.update({
        where: { id: task.id },
        data: { state: "fetch_started", fetchRequestId: input.requestId, startedAt: now },
      });
      await c.event(tx, userId, "provider_started", { taskId: task.id });
      return { ...result, allowed: true, state: "fetch_started" as const, query };
    });
  }
  async work(integrationId: string) {
    const c = this.context;
    return c.prisma.$transaction(
      async (tx) => {
        const { userId } = await c.owner(tx, integrationId);
        const now = c.now();
        const expired = await tx.discoveryTask.findMany({
          where: {
            run: { integrationId },
            state: "fetch_started",
            startedAt: { lte: new Date(now.getTime() - 120000) },
          },
          ...pageSlice({ page: 1, limit: 100 }),
          orderBy: { startedAt: "asc" },
        });
        for (const task of expired) {
          await tx.discoveryTask.update({
            where: { id: task.id },
            data: { state: "quarantined", failure: "provider_uncertain" },
          });
          await c.event(tx, userId, "provider_failed", {
            taskId: task.id,
            failure: "provider_uncertain",
          });
        }
        const tasks = await tx.discoveryTask.findMany({
          where: {
            run: { integrationId },
            state: "planned",
            createdAt: { gt: new Date(now.getTime() - 20 * 60000) },
          },
          ...pageSlice({ page: 1, limit: 3 }),
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        const deliveries = await tx.discoveryDelivery.findMany({
          where: {
            task: { run: { integrationId } },
            state: { in: ["pending", "retry_wait", "in_flight"] },
            nextAttemptAt: { lte: now },
            OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
          },
          ...pageSlice({ page: 1, limit: 5 }),
          orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        return {
          runtime: getExecutionPolicy(),
          taskIds: tasks.map((t) => t.id),
          deliveryIds: deliveries.map((d) => d.id),
        };
      },
      { timeout: 30000 },
    );
  }
}
