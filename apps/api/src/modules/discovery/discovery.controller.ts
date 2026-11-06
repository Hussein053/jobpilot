import {
  DISCOVERY_EVENTS,
  discoveryClaimResponseSchema,
  discoveryClaimSchema,
  discoveryFailSchema,
  discoveryFreezeResponseSchema,
  discoveryFreezeSchema,
  discoveryLeaseResponseSchema,
  discoveryLeaseSchema,
  discoveryReportResponseSchema,
  discoveryReportSchema,
  discoveryStartResponseSchema,
  discoveryStartSchema,
  discoveryWorkResponseSchema,
} from "@jobpilot/contracts/discovery";
import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { paginatedSchema, paginationQuerySchema } from "@jobpilot/contracts/pagination";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { DiscoveryClaimService } from "./claim.service";
import { DiscoveryDeliveryService } from "./delivery.service";
import { DiscoveryFreezeService } from "./freeze.service";
import { DiscoveryHistoryService } from "./history.service";
import { DiscoveryRequestService } from "./request.service";
import { discoveryEventSchema } from "./schemas";

const requests = container.get(DiscoveryRequestService);
const claims = container.get(DiscoveryClaimService);
const freezes = container.get(DiscoveryFreezeService);
const deliveries = container.get(DiscoveryDeliveryService);
const history = container.get(DiscoveryHistoryService);
export const discoveryController = new Elysia({
  prefix: "/integrations/n8n/search",
  detail: { tags: ["Inactive discovery relay"] },
})
  .onBeforeHandle(({ set }) => {
    set.headers["cache-control"] = "no-store";
  })
  .post(
    "/claim",
    async ({ request }) => {
      const r = await requests.read(request, "claim", discoveryClaimSchema);
      return claims.claim(r.integrationId, r.input);
    },
    {
      parse: "none",
      response: discoveryClaimResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.ingestion),
      detail: {
        summary:
          "Claim a server-timed discovery slot using a purpose-bound signature; disabled by default",
      },
    },
  )
  .post(
    "/start",
    async ({ request }) => {
      const r = await requests.read(request, "start", discoveryStartSchema);
      return claims.start(r.integrationId, r.input);
    },
    {
      parse: "none",
      response: discoveryStartResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.ingestion),
      detail: {
        summary:
          "Consume one provider-request budget grant; uncertain requests cannot be fetched again",
      },
    },
  )
  .post(
    "/work",
    async ({ request }) => {
      const r = await requests.read(request, "work", z.strictObject({}));
      return claims.work(r.integrationId);
    },
    {
      parse: "none",
      response: discoveryWorkResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.ingestion),
      detail: { summary: "Find bounded pending work and quarantine expired provider grants" },
    },
  )
  .post(
    "/freeze",
    async ({ request }) => {
      const r = await requests.read(request, "freeze", discoveryFreezeSchema, 1048576);
      return freezes.freeze(r.integrationId, r.input, r.bytes);
    },
    {
      parse: "none",
      response: discoveryFreezeResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.ingestion),
      detail: {
        summary:
          "Validate structured provider data and persist exact frozen discovery bodies before delivery",
      },
    },
  )
  .post(
    "/fail",
    async ({ request }) => {
      const r = await requests.read(request, "fail", discoveryFailSchema);
      return freezes.fail(r.integrationId, r.input);
    },
    {
      parse: "none",
      response: discoveryFreezeResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.ingestion),
      detail: { summary: "Record an uncertain provider fetch without re-querying or applying" },
    },
  )
  .post(
    "/lease",
    async ({ request }) => {
      const r = await requests.read(request, "lease", discoveryLeaseSchema);
      return deliveries.lease(r.integrationId, r.input);
    },
    {
      parse: "none",
      response: discoveryLeaseResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.ingestion),
      detail: { summary: "Lease immutable bytes for idempotent signed inbox delivery" },
    },
  )
  .post(
    "/report",
    async ({ request }) => {
      const r = await requests.read(request, "report", discoveryReportSchema);
      return deliveries.report(r.integrationId, r.input);
    },
    {
      parse: "none",
      response: discoveryReportResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.ingestion),
      detail: {
        summary:
          "Reconcile authoritative inbox storage or record bounded retry/quarantine metadata; never submitted state",
      },
    },
  )
  .use(authGuard)
  .get("/history", ({ user, query }) => history.history(user.id, query), {
    query: paginationQuerySchema,
    response: paginatedSchema(
      z.object({
        id: z.uuid(),
        kind: z.enum(DISCOVERY_EVENTS),
        createdAt: z.date(),
        metadata: discoveryEventSchema,
      }),
    ),
    detail: { summary: "Read safe owner-scoped discovery audit metadata" },
  })
  .get("/jobs", ({ user, query }) => history.jobs(user.id, query), {
    query: paginationQuerySchema,
    response: paginatedSchema(
      z.object({
        id: z.uuid(),
        firstSeenAt: z.date(),
        lastSeenAt: z.date(),
        snapshot: ingestionBatchSchema.shape.jobs.element,
      }),
    ),
    detail: { summary: "Read deduplicated owned discovery identities; not application records" },
  });
