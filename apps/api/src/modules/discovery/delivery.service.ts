import { createHash, randomInt } from "node:crypto";
import type { discoveryLeaseSchema, discoveryReportSchema } from "@jobpilot/contracts/discovery";
import { MAX_DISCOVERY_RETRY_AFTER } from "@jobpilot/contracts/discovery";
import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { inject, injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { conflict, notFound } from "@/common/errors";
import type { DiscoveryDelivery, DiscoveryFailure, Prisma } from "@/generated/prisma/client";
import { getExecutionPolicy } from "@/modules/execution/execution-policy";
import { DiscoveryContext } from "./context";

@injectable()
export class DiscoveryDeliveryService {
  constructor(private readonly context: DiscoveryContext = inject(DiscoveryContext)) {}
  private async find(tx: Prisma.TransactionClient, integrationId: string, id: string) {
    const row = await tx.discoveryDelivery.findFirst({
      where: { id, task: { run: { integrationId } } },
    });
    if (!row) throw notFound("Discovery delivery not found");
    return row;
  }
  private async stored(
    tx: Prisma.TransactionClient,
    integrationId: string,
    row: DiscoveryDelivery,
  ) {
    return tx.ingestionRun.findUnique({
      where: { integrationId_runId: { integrationId, runId: row.runId } },
    });
  }
  async lease(integrationId: string, input: z.infer<typeof discoveryLeaseSchema>) {
    const c = this.context;
    return c.prisma.$transaction(async (tx) => {
      const { userId } = await c.owner(tx, integrationId);
      const row = await this.find(tx, integrationId, input.deliveryId);
      const result = {
        runtime: getExecutionPolicy(),
        allowed: false,
        deliveryId: row.id,
        state: row.state,
        leaseId: null,
        runId: row.runId,
        body: null,
      };
      if (["stored", "quarantined", "auth_stopped"].includes(row.state)) return result;
      let valid = false;
      try {
        const body = ingestionBatchSchema.parse(JSON.parse(row.body));
        valid =
          body.runId === row.runId &&
          Buffer.byteLength(row.body) <= 65536 &&
          createHash("sha256").update(row.body).digest("hex") === row.digest;
      } catch {
        valid = false;
      }
      if (!valid) {
        await tx.discoveryDelivery.update({
          where: { id: row.id },
          data: { state: "quarantined", lastFailure: "body_conflict" },
        });
        await c.event(tx, userId, "quarantined", { deliveryId: row.id, failure: "body_conflict" });
        return { ...result, state: "quarantined" as const };
      }
      const receipt = await this.stored(tx, integrationId, row);
      if (receipt) {
        const state =
          receipt.bodyDigest === row.digest ? ("stored" as const) : ("quarantined" as const);
        await tx.discoveryDelivery.update({
          where: { id: row.id },
          data: {
            state,
            receiptId: state === "stored" ? receipt.id : null,
            lastFailure: state === "stored" ? null : "body_conflict",
          },
        });
        await c.event(tx, userId, state, {
          deliveryId: row.id,
          ...(state === "quarantined" && { failure: "body_conflict" as const }),
        });
        return { ...result, state };
      }
      const now = c.now();
      if (row.state === "in_flight" && row.leaseUntil && row.leaseUntil > now) {
        if (row.leaseId !== input.requestId) return result;
        return { ...result, allowed: true, leaseId: row.leaseId, body: row.body };
      }
      if (row.nextAttemptAt > now) return result;
      if (row.attempts >= 5) {
        await tx.discoveryDelivery.update({
          where: { id: row.id },
          data: { state: "quarantined", lastFailure: "attempt_limit" },
        });
        await c.event(tx, userId, "quarantined", { deliveryId: row.id, failure: "attempt_limit" });
        return { ...result, state: "quarantined" as const };
      }
      await tx.discoveryDelivery.update({
        where: { id: row.id },
        data: {
          state: "in_flight",
          leaseId: input.requestId,
          leaseUntil: new Date(now.getTime() + 60000),
          attempts: { increment: 1 },
        },
      });
      await c.event(tx, userId, "delivery_leased", { deliveryId: row.id });
      return {
        ...result,
        allowed: true,
        state: "in_flight" as const,
        leaseId: input.requestId,
        body: row.body,
      };
    });
  }
  async report(integrationId: string, input: z.infer<typeof discoveryReportSchema>) {
    const c = this.context;
    return c.prisma.$transaction(async (tx) => {
      const { userId } = await c.owner(tx, integrationId);
      const row = await this.find(tx, integrationId, input.deliveryId);
      const response = (state: DiscoveryDelivery["state"], failure: DiscoveryFailure | null) => ({
        runtime: getExecutionPolicy(),
        deliveryId: row.id,
        state,
        failure,
      });
      if (row.state === "stored") return response(row.state, row.lastFailure);
      if (
        row.state !== "in_flight" ||
        row.leaseId !== input.leaseId ||
        !row.leaseUntil ||
        row.leaseUntil <= c.now()
      )
        throw conflict("Delivery lease is not current");
      const status = input.httpStatus;
      const unsafeReceipt = status !== null && status >= 200 && status < 300 && !input.receiptValid;
      if (status === 401 || status === 403 || unsafeReceipt) {
        const failure = unsafeReceipt ? ("invalid_receipt" as const) : ("auth_failed" as const);
        await tx.discoveryDelivery.update({
          where: { id: row.id },
          data: { state: "auth_stopped", lastFailure: failure, lastStatus: status },
        });
        await tx.discoveryPolicy.update({ where: { userId }, data: { authBlockedAt: c.now() } });
        await c.event(tx, userId, "auth_stopped", {
          deliveryId: row.id,
          failure,
          ...(status && { httpStatus: status }),
        });
        return response("auth_stopped", failure);
      }
      const receipt = await this.stored(tx, integrationId, row);
      if (receipt && receipt.bodyDigest === row.digest) {
        await tx.discoveryDelivery.update({
          where: { id: row.id },
          data: {
            state: "stored",
            receiptId: receipt.id,
            lastFailure: null,
            lastStatus: status,
            leaseUntil: null,
          },
        });
        await c.event(tx, userId, "stored", { deliveryId: row.id });
        return response("stored", null);
      }
      let failure: DiscoveryFailure = "bad_payload";
      let retry = false;
      if (receipt || status === 409) failure = "body_conflict";
      else if (status === null) {
        failure = "transport_error";
        retry = true;
      } else if (status === 429) {
        failure = "rate_limited";
        retry = true;
      } else if (status >= 500) {
        failure = "remote_error";
        retry = true;
      } else if (status >= 200 && status < 300) failure = "invalid_receipt";
      const state =
        retry && row.attempts < 5 && input.retryAfterSeconds !== MAX_DISCOVERY_RETRY_AFTER
          ? ("retry_wait" as const)
          : ("quarantined" as const);
      const seconds = Math.max(
        input.retryAfterSeconds ?? 0,
        5 * 2 ** row.attempts + randomInt(0, 10),
      );
      await tx.discoveryDelivery.update({
        where: { id: row.id },
        data: {
          state,
          lastFailure: failure,
          lastStatus: status,
          leaseUntil: null,
          nextAttemptAt: new Date(c.now().getTime() + seconds * 1000),
        },
      });
      await c.event(tx, userId, state, {
        deliveryId: row.id,
        failure,
        ...(status && { httpStatus: status }),
      });
      return response(state, failure);
    });
  }
}
