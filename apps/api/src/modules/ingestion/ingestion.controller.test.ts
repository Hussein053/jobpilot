import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { AuthTokenService } from "@/modules/auth/auth-token.service";
import { httpErrorResponses } from "@/types/response";
import { ingestionFixture } from "./fakes";
import { IngestionService } from "./ingestion.service";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

let fixture = ingestionFixture();
const resolve = container.get.bind(container);
const construction = spyOn(container, "get").mockImplementation((key) =>
  key === IngestionService
    ? {
        ingest: (request: Request) => fixture.service.ingest(request),
        history: (userId: string, query: { page: number; limit: number }) =>
          fixture.service.history(userId, query),
      }
    : resolve(key),
);
const { ingestionController } = await import("./ingestion.controller");
construction.mockRestore();
const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) => api.use(ingestionController));
let auth: ReturnType<typeof spyOn<typeof container, "get">>;
beforeEach(() => {
  fixture = ingestionFixture();
  auth = spyOn(container, "get").mockImplementation((key) =>
    key === AuthTokenService
      ? {
          verify: async (token: string) => ({
            id: token,
            email: "fixture@example.test",
            role: "USER",
            tokenId: token,
          }),
        }
      : resolve(key),
  );
});
afterEach(() => auth.mockRestore());

describe("mounted n8n ingestion routes", () => {
  it("accepts signed raw bytes without a browser session and returns a no-store dry-run receipt", async () => {
    const response = await app.handle(fixture.request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      disposition: "stored_only",
      duplicate: false,
      runtime: { submissionMode: "DRY_RUN", liveSubmissionsEnabled: false },
    });
  });

  it("does not let a browser session substitute for a signature", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/integrations/n8n/ingest", {
        method: "POST",
        headers: {
          authorization: `Bearer ${fixture.integration.userId}`,
          "content-type": "application/json",
          "x-real-ip": crypto.randomUUID(),
        },
        body: JSON.stringify(fixture.batch),
      }),
    );
    expect(response.status).toBe(401);
    expect(fixture.rows.size).toBe(0);
  });

  it("protects history with session authentication and owner filtering", async () => {
    await fixture.service.ingest(fixture.request());
    const url = "http://localhost/api/integrations/n8n/runs?page=1&limit=10";
    expect((await app.handle(new Request(url))).status).toBe(401);
    for (const [userId, expected] of [
      [fixture.integration.userId, 1],
      [crypto.randomUUID(), 0],
    ] as const) {
      const response = await app.handle(
        new Request(url, { headers: { authorization: `Bearer ${userId}` } }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body).toHaveProperty("items.length", expected);
      expect(JSON.stringify(body)).not.toContain("publicKeyPem");
      expect(JSON.stringify(body)).not.toContain("bodyDigest");
    }
  });

  it("does not accept activation, workflow mutation, or worker launch endpoints", async () => {
    for (const path of ["/enable", "/submit", "/workflows", "/execute"]) {
      const response = await app.handle(
        new Request(`http://localhost/api/integrations/n8n${path}`, { method: "POST" }),
      );
      expect(response.status).toBe(404);
    }
    expect(fixture.rows.size).toBe(0);
  });
});
