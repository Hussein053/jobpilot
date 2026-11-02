import {
  autoApplyPreferencesSchema,
  patchAutoApplySettingsSchema,
} from "@jobpilot/contracts/auto-apply";
import { paginatedSchema, paginationQuerySchema } from "@jobpilot/contracts/pagination";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { AutoApplyService } from "./auto-apply.service";

const service = container.get(AutoApplyService);
const settingsResponse = z.object({
  settings: autoApplyPreferencesSchema,
  version: z.number().int(),
  updatedAt: z.date().nullable(),
  resumeReady: z.boolean(),
  runtime: z.object({
    submissionMode: z.literal("DRY_RUN"),
    liveSubmissionsEnabled: z.literal(false),
    unrestrictedAgentsEnabled: z.literal(false),
  }),
});

export const autoApplyController = new Elysia({
  prefix: "/auto-apply",
  detail: { tags: ["Auto-Apply Settings"] },
})
  .use(authGuard)
  .onBeforeHandle(({ set }) => {
    set.headers["cache-control"] = "no-store";
  })
  .get("/settings", ({ user }) => service.get(user.id), {
    response: settingsResponse,
    detail: { summary: "Read preferences and independent execution state" },
  })
  .patch("/settings", ({ user, body }) => service.patch(user.id, user.tokenId, body), {
    body: patchAutoApplySettingsSchema,
    response: settingsResponse,
    beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
    detail: { summary: "Save preferences using an expected version; cannot authorize execution" },
  })
  .get("/audit", ({ user, query }) => service.audit(user.id, query), {
    query: paginationQuerySchema,
    response: paginatedSchema(
      z.object({
        id: z.uuid(),
        previousVersion: z.number().int(),
        version: z.number().int(),
        createdAt: z.date(),
        previousPreferences: autoApplyPreferencesSchema.nullable(),
        preferences: autoApplyPreferencesSchema,
      }),
    ),
    detail: { summary: "Read settings change history for the signed-in user" },
  });
