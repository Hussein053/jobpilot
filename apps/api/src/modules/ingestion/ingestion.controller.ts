import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { paginatedSchema, paginationQuerySchema } from "@jobpilot/contracts/pagination";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { IngestionService } from "./ingestion.service";

const service = container.get(IngestionService);

export const ingestionController = new Elysia({
  prefix: "/integrations/n8n",
  detail: { tags: ["Discovery ingestion"] },
})
  .onBeforeHandle(({ set }) => {
    set.headers["cache-control"] = "no-store";
  })
  .post("/ingest", ({ request }) => service.ingest(request), {
    parse: "none",
    beforeHandle: rateLimit(RATE_LIMITS.ingestion),
    response: z.object({
      id: z.uuid(),
      runId: z.uuid(),
      duplicate: z.boolean(),
      disposition: z.literal("stored_only"),
      runtime: z.object({
        submissionMode: z.literal("DRY_RUN"),
        liveSubmissionsEnabled: z.literal(false),
        unrestrictedAgentsEnabled: z.literal(false),
      }),
    }),
    detail: {
      summary: "Receive a bounded signed discovery batch; never starts application execution",
    },
  })
  .use(authGuard)
  .get("/runs", ({ user, query }) => service.history(user.id, query), {
    query: paginationQuerySchema,
    response: paginatedSchema(
      z.object({ id: z.uuid(), runId: z.uuid(), createdAt: z.date(), batch: ingestionBatchSchema }),
    ),
    detail: { summary: "Read discovery batches belonging to the signed-in user" },
  });
