import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { AuthTokenService } from "@/modules/auth/auth-token.service";
import { httpErrorResponses } from "@/types/response";
import { executionController } from "./execution.controller";
import { afterEach, describe, expect, it, spyOn } from "bun:test";

const token = "execution-test-token";
const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) => api.use(executionController));

const resolve = container.get.bind(container);
const fake = {
  verify: async (raw: string) =>
    raw === token
      ? {
          id: crypto.randomUUID(),
          email: "test@example.test",
          role: "USER",
          tokenId: crypto.randomUUID(),
        }
      : null,
};

afterEach(() => {
  lookup?.mockRestore();
});

let lookup: ReturnType<typeof spyOn<typeof container, "get">> | undefined;

function authenticate() {
  lookup = spyOn(container, "get").mockImplementation((key) =>
    key === AuthTokenService ? fake : resolve(key),
  );
}

describe("execution policy endpoint", () => {
  it("requires authentication", async () => {
    const response = await app.handle(new Request("http://localhost/api/execution/policy"));
    expect(response.status).toBe(401);
  });

  it("ignores caller-supplied live mode and forbids caching", async () => {
    authenticate();
    const response = await app.handle(
      new Request(
        "http://localhost/api/execution/policy?submissionMode=LIVE&liveSubmissionsEnabled=true",
        { headers: { authorization: `Bearer ${token}`, "x-execution-mode": "LIVE" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      submissionMode: "DRY_RUN",
      liveSubmissionsEnabled: false,
      unrestrictedAgentsEnabled: false,
    });
  });

  it("exposes no policy mutation or activation route", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await app.handle(
        new Request("http://localhost/api/execution/policy", {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ submissionMode: "LIVE", liveSubmissionsEnabled: true }),
        }),
      );
      expect([404, 405]).toContain(response.status);
    }
    const response = await app.handle(
      new Request("http://localhost/api/execution/activate", { method: "POST" }),
    );
    expect(response.status).toBe(404);
  });
});
