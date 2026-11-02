import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { AuthTokenService } from "@/modules/auth/auth-token.service";
import { httpErrorResponses } from "@/types/response";
import { reviewFixture } from "./fakes";
import { ResumeReviewService } from "./resume-review.service";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

let fixture = reviewFixture();
const resolve = container.get.bind(container);
const construction = spyOn(container, "get").mockImplementation((key) =>
  key === ResumeReviewService
    ? {
        review: (...args: Parameters<ResumeReviewService["review"]>) =>
          fixture.service.review(...args),
        history: (...args: Parameters<ResumeReviewService["history"]>) =>
          fixture.service.history(...args),
      }
    : resolve(key),
);
const { resumeReviewController } = await import("./resume-review.controller");
construction.mockRestore();
const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) => api.use(resumeReviewController));
let auth: ReturnType<typeof spyOn<typeof container, "get">>;
beforeEach(() => {
  fixture = reviewFixture();
  auth = spyOn(container, "get").mockImplementation((key) =>
    key === AuthTokenService
      ? {
          verify: async (token: string) =>
            token === fixture.token
              ? {
                  id: fixture.owner,
                  role: "USER",
                  email: "fixture@example.test",
                  tokenId: fixture.token,
                }
              : null,
        }
      : resolve(key),
  );
});
afterEach(() => auth.mockRestore());
const request = (method: string, path: string, body?: unknown, token: string = fixture.token) =>
  app.handle(
    new Request(`http://localhost/api/resumes/${fixture.row.id}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
describe("resume review routes", () => {
  it("requires authentication for reviews and history", async () => {
    expect(
      (
        await request(
          "POST",
          "/review",
          { action: "approve", expectedVersion: 1, expectedReviewRevision: 0 },
          "invalid",
        )
      ).status,
    ).toBe(401);
    expect((await request("GET", "/reviews", undefined, "invalid")).status).toBe(401);
  });
  it("checks browser-session authority independently of the general auth guard", async () => {
    fixture.denySession();
    expect(
      (
        await request("POST", "/review", {
          action: "approve",
          expectedVersion: 1,
          expectedReviewRevision: 0,
        })
      ).status,
    ).toBe(403);
    expect(fixture.events).toHaveLength(0);
  });
  it("returns current version metadata and a no-store review receipt", async () => {
    const response = await request("POST", "/review", {
      action: "approve",
      expectedVersion: 1,
      expectedReviewRevision: 0,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      approvedVersion: 1,
      reviewRevision: 1,
      active: true,
    });
    const history = await request("GET", "/reviews");
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({ pagination: { total: 1 } });
  });
  it("rejects live controls, actor overrides, arbitrary approval stamps, and invalid actions", async () => {
    for (const extra of [
      { liveSubmissionsEnabled: true },
      { userId: crypto.randomUUID() },
      { approvedAt: new Date().toISOString() },
      { action: "submit" },
    ]) {
      expect(
        (
          await request("POST", "/review", {
            action: "approve",
            expectedVersion: 1,
            expectedReviewRevision: 0,
            ...extra,
          })
        ).status,
      ).toBe(422);
    }
    expect(fixture.events).toHaveLength(0);
  });
});
