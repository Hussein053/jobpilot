import { inject, injectable } from "@needle-di/core";
import { forbidden, notFound, unauthorized } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { type DiscoveryEventKind, type Prisma, PrismaClient } from "@/generated/prisma/client";
import { getExecutionPolicy } from "@/modules/execution/execution-policy";
import { discoveryEventSchema } from "./schemas";

@injectable()
export class DiscoveryContext {
  constructor(readonly prisma: PrismaClient = inject(PrismaClient)) {}
  now() {
    return new Date();
  }
  async owner(tx: Prisma.TransactionClient, integrationId: string) {
    const integration = await tx.ingestionIntegration.findUnique({ where: { id: integrationId } });
    if (!integration?.active) throw unauthorized("Discovery identity is inactive");
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${integration.userId} FOR UPDATE`;
    const current = await tx.ingestionIntegration.findUnique({ where: { id: integrationId } });
    if (!current?.active || current.userId !== integration.userId)
      throw unauthorized("Discovery identity is inactive");
    const policy = await tx.discoveryPolicy.findUnique({ where: { userId: integration.userId } });
    if (
      !policy?.enabled ||
      policy.maxProviderRequestsPerDay <= 0 ||
      policy.rolesPerSlot < 1 ||
      policy.rolesPerSlot > 3 ||
      policy.authBlockedAt
    )
      throw forbidden("Discovery is disabled or blocked");
    const runtime = getExecutionPolicy();
    if (
      runtime.submissionMode !== "DRY_RUN" ||
      runtime.liveSubmissionsEnabled ||
      runtime.unrestrictedAgentsEnabled
    )
      throw forbidden("Dry-run verification failed");
    return { integration: current, policy, userId: integration.userId };
  }
  async task(tx: Prisma.TransactionClient, integrationId: string, id: string) {
    const task = await tx.discoveryTask.findFirst({
      where: { id, run: { integrationId } },
      include: { run: true },
    });
    if (!task) throw notFound("Discovery task not found");
    return task;
  }
  async event(
    tx: Prisma.TransactionClient,
    userId: string,
    kind: DiscoveryEventKind,
    metadata: unknown,
  ) {
    await tx.discoveryEvent.create({
      data: { userId, kind, metadata: toInputJson(discoveryEventSchema.parse(metadata)) },
    });
  }
}
