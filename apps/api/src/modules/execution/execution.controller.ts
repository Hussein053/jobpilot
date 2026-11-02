import { Elysia } from "elysia";
import { z } from "zod/v4";
import { authGuard } from "@/common/middleware/auth.middleware";
import { getExecutionPolicy } from "./execution-policy";

export const executionController = new Elysia({
  prefix: "/execution",
  detail: { tags: ["Execution"] },
})
  .use(authGuard)
  .get(
    "/policy",
    ({ set }) => {
      set.headers["cache-control"] = "no-store";
      return getExecutionPolicy();
    },
    {
      response: z.object({
        submissionMode: z.literal("DRY_RUN"),
        liveSubmissionsEnabled: z.literal(false),
        unrestrictedAgentsEnabled: z.literal(false),
      }),
      detail: {
        summary: "Read server-owned execution policy",
        description: "Read-only dry-run policy. No activation or policy mutation is supported.",
      },
    },
  );
