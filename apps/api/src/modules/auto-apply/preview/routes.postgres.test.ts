import { policyOutcomeSchema } from "@jobpilot/contracts/policy-preview";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { AuthTokenService } from "@/modules/auth/auth-token.service";
import { httpErrorResponses } from "@/types/response";
import { PolicyPreviewService } from "./preview.service";
import { previewFixture } from "./preview-fixture";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

const f = previewFixture();
const resolve = container.get.bind(container);
const construction = spyOn(container, "get").mockImplementation((key) =>
  key === PolicyPreviewService ? f.real : resolve(key),
);
const { policyPreviewController } = await import("./preview.controller");
construction.mockRestore();
const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) => api.use(policyPreviewController));
const request = (method: string, path: string, body?: unknown, token: string = f.session) =>
  app.handle(
    new Request(`http://localhost/api/auto-apply${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
let auth: ReturnType<typeof spyOn<typeof container, "get">>;
describe.skipIf(!f.enabled)("dry-run preview mounted routes", () => {
  beforeAll(async () => {
    await f.setup();
    auth = spyOn(container, "get").mockImplementation((key) =>
      key === AuthTokenService
        ? {
            verify: async (token: string) =>
              [f.session, f.terminal].some((allowed) => allowed === token)
                ? { id: f.owner, role: "USER", email: "fixture@example.test", tokenId: token }
                : null,
          }
        : resolve(key),
    );
  });
  afterAll(async () => {
    auth.mockRestore();
    await f.cleanup();
  });
  test("requires auth, returns no-store data, and never accepts execution or score claims", async () => {
    expect((await request("GET", "/preview", undefined, "invalid")).status).toBe(401);
    const result = await request("GET", "/preview");
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({
      runtime: { submissionMode: "DRY_RUN", liveSubmissionsEnabled: false },
      jobs: [],
    });
    const run = await f.run();
    const input = {
      requestId: crypto.randomUUID(),
      ingestionRunId: run.id,
      expectedSettingsVersion: 1,
    };
    expect((await request("POST", "/simulations", input, f.terminal)).status).toBe(403);
    for (const extra of [
      { userId: f.other },
      { liveSubmissionsEnabled: true },
      { matchScore: 100 },
      { facts: { screening: "resolved" } },
    ])
      expect((await request("POST", "/simulations", { ...input, ...extra })).status).toBe(422);
  });
  test("records review-only snapshots and rejects nonexistent execution operations", async () => {
    const run = await f.run();
    const result = await request("POST", "/simulations", {
      requestId: crypto.randomUUID(),
      ingestionRunId: run.id,
      expectedSettingsVersion: 1,
    });
    expect(result.status).toBe(200);
    const body = z
      .object({ id: z.uuid(), jobs: z.array(z.object({ outcome: policyOutcomeSchema })) })
      .parse(await result.json());
    expect(body.jobs[0]!.outcome).toMatchObject({ decision: "review", canSubmit: false });
    expect((await request("GET", `/simulations/${body.id}`)).status).toBe(200);
    for (const path of ["/activate", "/submit", `/simulations/${body.id}/submit`])
      expect((await request("POST", path, {})).status).toBe(404);
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(0);
  });
});
