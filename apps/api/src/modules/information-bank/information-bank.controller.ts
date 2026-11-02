import {
  approveBankEntrySchema,
  bankEntryDefinitionSchema,
  bankVersionSchema,
  editBankEntrySchema,
} from "@jobpilot/contracts/information-bank";
import { paginationQuerySchema } from "@jobpilot/contracts/pagination";
import { idParam } from "@jobpilot/contracts/shared";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { deletedResponseSchema } from "@/types/response";
import {
  bankEntryResponse,
  bankHistoryResponse,
  bankListQuery,
  bankListResponse,
} from "./information-bank.schema";
import { InformationBankService } from "./information-bank.service";
import { InformationBankImportService } from "./information-bank-import.service";

const service = container.get(InformationBankService);
const importer = container.get(InformationBankImportService);
export const informationBankController = new Elysia({
  prefix: "/information-bank",
  detail: { tags: ["Information Bank"] },
})
  .use(authGuard)
  .onBeforeHandle(({ set }) => {
    set.headers["cache-control"] = "no-store";
  })
  .get("/export", ({ user }) => service.exportEntries(user.id, user.tokenId), {
    response: z.object({ exportedAt: z.date(), entries: z.array(bankEntryResponse) }),
    detail: { summary: "Explicitly export owned current answers without keys or ciphertext" },
  })
  .post("/import-profile", ({ user }) => importer.profile(user.id, user.tokenId), {
    response: z.object({ created: z.number().int(), skipped: z.number().int() }),
    beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
    detail: {
      summary:
        "Import nonempty profile contact facts as unapproved drafts; never infer eligibility",
    },
  })
  .post(
    "/import-resume/:id",
    ({ user, params }) => importer.resume(user.id, user.tokenId, params.id),
    {
      params: idParam,
      response: z.object({ created: z.number().int(), skipped: z.number().int() }),
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      detail: {
        summary:
          "Import owned structured resume contact facts as drafts without overwriting existing answers",
      },
    },
  )
  .get("/", ({ user, query }) => service.list(user.id, user.tokenId, query), {
    query: bankListQuery.omit({ query: true }),
    response: bankListResponse,
    detail: {
      summary: "Search only this user's protected question words; requires a browser session",
    },
  })
  .post("/search", ({ user, body }) => service.list(user.id, user.tokenId, body), {
    body: bankListQuery,
    response: bankListResponse,
    detail: { summary: "Search question words in a request body instead of access-log URLs" },
  })
  .post("/", ({ user, body }) => service.create(user.id, user.tokenId, body), {
    body: bankEntryDefinitionSchema,
    response: bankEntryResponse,
    beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
    detail: { summary: "Create an encrypted draft; never grants reuse or submission" },
  })
  .get("/:id", ({ user, params }) => service.get(user.id, user.tokenId, params.id), {
    params: idParam,
    response: bankEntryResponse,
    detail: { summary: "Read an owned answer using a browser session" },
  })
  .patch(
    "/:id",
    ({ user, params, body }) =>
      service.edit(user.id, user.tokenId, params.id, body.expectedVersion, body.definition),
    {
      params: idParam,
      body: editBankEntrySchema,
      response: bankEntryResponse,
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      detail: { summary: "Edit a versioned answer, invalidating approval" },
    },
  )
  .post(
    "/:id/approve",
    ({ user, params, body }) => service.approve(user.id, user.tokenId, params.id, body),
    {
      params: idParam,
      body: approveBankEntrySchema,
      response: bankEntryResponse,
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      detail: {
        summary:
          "Approve an exact version, scope, and review interval; never authorizes submission",
      },
    },
  )
  .post(
    "/:id/revoke",
    ({ user, params, body }) =>
      service.revoke(user.id, user.tokenId, params.id, body.expectedVersion),
    {
      params: idParam,
      body: bankVersionSchema,
      response: bankEntryResponse,
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      detail: { summary: "Revoke reuse of the expected answer version" },
    },
  )
  .delete(
    "/:id",
    ({ user, params, body }) =>
      service.remove(user.id, user.tokenId, params.id, body.expectedVersion),
    {
      params: idParam,
      body: bankVersionSchema,
      response: deletedResponseSchema,
      beforeHandle: rateLimit(RATE_LIMITS.pilotMutation),
      detail: {
        summary: "Remove the answer and its wrapped key, retaining only readable audit metadata",
      },
    },
  )
  .get(
    "/:id/history",
    ({ user, params, query }) => service.history(user.id, user.tokenId, params.id, query),
    {
      params: idParam,
      query: paginationQuerySchema,
      response: bankHistoryResponse,
      detail: { summary: "Read version history; deleted entry values cannot be decrypted" },
    },
  );
