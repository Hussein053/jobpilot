import { paginatedSchema, paginationQuerySchema } from "@jobpilot/contracts/pagination";
import {
  createPreparationSchema,
  preparationSchema,
  reviewPreparationSchema,
  simulatePreparationSchema,
} from "@jobpilot/contracts/preparation";
import { preparationAnswerHistorySchema } from "@jobpilot/contracts/preparation-answer-history";
import { idParam } from "@jobpilot/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { PreparationAnswerHistoryService } from "./answer-history.service";
import { PreparationService } from "./preparation.service";

const service = container.get(PreparationService);
const answerHistory = container.get(PreparationAnswerHistoryService);
export const preparationController = new Elysia({
  prefix: "/preparations",
  detail: { tags: ["DRY_RUN Preparation"] },
})
  .use(authGuard)
  .onBeforeHandle(({ set }) => {
    set.headers["cache-control"] = "no-store";
  })
  .get("/", ({ user, query }) => service.list(user.id, user.tokenId, query), {
    query: paginationQuerySchema,
    response: paginatedSchema(preparationSchema),
    detail: { summary: "Read owned synthetic preparations and audit references" },
  })
  .post("/", ({ user, body }) => service.create(user.id, user.tokenId, body), {
    body: createPreparationSchema,
    response: preparationSchema,
    beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
    detail: { summary: "Prepare a confined synthetic form; external browser execution disabled" },
  })
  .get("/:id", ({ user, params }) => service.get(user.id, user.tokenId, params.id), {
    params: idParam,
    response: preparationSchema,
    detail: { summary: "Read an owned preparation without answer plaintext" },
  })
  .get(
    "/:id/answer-history",
    ({ user, params }) => answerHistory.history(user.id, user.tokenId, params.id),
    {
      params: idParam,
      response: preparationAnswerHistorySchema,
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      detail: {
        summary:
          "Explicitly review owned encrypted answer-use history; never grants reuse or submission",
      },
    },
  )
  .post(
    "/:id/review",
    ({ user, params, body }) => service.review(user.id, user.tokenId, params.id, body),
    {
      params: idParam,
      body: reviewPreparationSchema,
      response: preparationSchema,
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      detail: {
        summary: "Refresh approved references and explicitly approve simulation exceptions",
      },
    },
  )
  .post(
    "/:id/simulate",
    ({ user, params, body }) =>
      service.simulate(user.id, user.tokenId, params.id, body.expectedRevision),
    {
      params: idParam,
      body: simulatePreparationSchema,
      response: preparationSchema,
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      detail: {
        summary: "Record a quota-limited fixture simulation; final controls always blocked",
      },
    },
  );
