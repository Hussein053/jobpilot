import { paginatedSchema, paginationQuerySchema } from "@jobpilot/contracts/pagination";
import { simulatePolicySchema } from "@jobpilot/contracts/policy-preview";
import { idParam } from "@jobpilot/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import {
  previewQuerySchema,
  previewResponseSchema,
  simulationResponseSchema,
  simulationSummarySchema,
} from "./preview.schema";
import { PolicyPreviewService } from "./preview.service";

const service = container.get(PolicyPreviewService);
export const policyPreviewController = new Elysia({
  prefix: "/auto-apply",
  detail: { tags: ["Dry-Run Policy"] },
})
  .use(authGuard)
  .onBeforeHandle(({ set }) => {
    set.headers["cache-control"] = "no-store";
  })
  .get("/preview", ({ user, query }) => service.preview(user.id, query), {
    query: previewQuerySchema,
    response: previewResponseSchema,
    beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
    detail: {
      summary:
        "Read recorded daily counts and conservative eligibility; never executes or reserves",
    },
  })
  .post("/simulations", ({ user, body }) => service.simulate(user.id, user.tokenId, body), {
    body: simulatePolicySchema,
    response: simulationResponseSchema,
    beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
    detail: {
      summary:
        "Record a versioned simulation with atomic dry-run-only reservations; browser session required",
    },
  })
  .get("/simulations", ({ user, query }) => service.history(user.id, query), {
    query: paginationQuerySchema,
    response: paginatedSchema(simulationSummarySchema),
    detail: { summary: "Read owned immutable dry-run history" },
  })
  .get("/simulations/:id", ({ user, params }) => service.get(user.id, params.id), {
    params: idParam,
    response: simulationResponseSchema,
    detail: { summary: "Read an owned historical simulation, never an execution permission" },
  });
