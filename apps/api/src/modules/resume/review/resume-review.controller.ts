import { paginatedSchema, paginationQuerySchema } from "@jobpilot/contracts/pagination";
import { RESUME_REVIEW_ACTIONS, reviewResumeSchema } from "@jobpilot/contracts/resume-review";
import { idParam } from "@jobpilot/contracts/shared";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { ResumeReviewService } from "./resume-review.service";

const service = container.get(ResumeReviewService);
export const resumeReviewController = new Elysia({
  prefix: "/resumes",
  detail: { tags: ["Resume review"] },
})
  .use(authGuard)
  .onBeforeHandle(({ set }) => {
    set.headers["cache-control"] = "no-store";
  })
  .post(
    "/:id/review",
    ({ user, params, body }) => service.review(user.id, user.tokenId, params.id, body),
    {
      params: idParam,
      body: reviewResumeSchema,
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      response: z.object({
        id: z.uuid(),
        version: z.number().int(),
        reviewRevision: z.number().int(),
        active: z.boolean(),
        approvedAt: z.date().nullable(),
        approvedVersion: z.number().int().nullable(),
      }),
      detail: { summary: "Explicitly review the current resume version using a browser session" },
    },
  )
  .get("/:id/reviews", ({ user, params, query }) => service.history(user.id, params.id, query), {
    params: idParam,
    query: paginationQuerySchema,
    response: paginatedSchema(
      z.object({
        id: z.uuid(),
        action: z.enum(RESUME_REVIEW_ACTIONS),
        resumeVersion: z.number().int(),
        reviewRevision: z.number().int(),
        createdAt: z.date(),
      }),
    ),
    detail: { summary: "Read this user's append-only resume review history" },
  });
