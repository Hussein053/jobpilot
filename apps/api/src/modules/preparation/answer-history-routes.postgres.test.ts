import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { AuthTokenService } from "@/modules/auth/auth-token.service";
import { httpErrorResponses } from "@/types/response";
import { PreparationAnswerHistoryService } from "./answer-history.service";
import { answerHistoryFixture } from "./answer-history-fixture";
import { PreparationService } from "./preparation.service";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

const f = answerHistoryFixture();
const resolve = container.get.bind(container);
let request: (id: string, token?: string) => Promise<Response>;
let auth: ReturnType<typeof spyOn<typeof container, "get">>;
let preparationId: string;

describe.skipIf(!f.enabled)("private archived-answer HTTP boundary", () => {
  beforeAll(async () => {
    await f.setup();
    const { preparation } = await f.ready();
    await f.service.simulate(f.owner, f.session, preparation.id, preparation.revision);
    preparationId = preparation.id;
    const construction = spyOn(container, "get").mockImplementation((key) => {
      if (key === PreparationService) return f.service;
      if (key === PreparationAnswerHistoryService) return f.history;
      return resolve(key);
    });
    let controller: typeof import("./preparation.controller")["preparationController"] | undefined;
    try {
      controller = (await import("./preparation.controller")).preparationController;
    } finally {
      construction.mockRestore();
    }
    if (!controller) throw new Error("Preparation controller unavailable");
    const app = new Elysia()
      .use(errorMiddleware)
      .guard({ as: "scoped", response: httpErrorResponses })
      .group("/api", (api) => api.use(controller));
    auth = spyOn(container, "get").mockImplementation((key) =>
      key === AuthTokenService
        ? {
            verify: async (token: string) => {
              if (![f.session, f.terminal, f.otherSession].some((allowed) => allowed === token))
                return null;
              return {
                id: token === f.otherSession ? f.other : f.owner,
                role: "USER",
                email: "synthetic@example.test",
                tokenId: token,
              };
            },
          }
        : resolve(key),
    );
    request = (id, token = f.session) =>
      app.handle(
        new Request(`http://localhost/api/preparations/${id}/answer-history`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      );
  });
  afterAll(async () => {
    auth?.mockRestore();
    await f.cleanup();
  });

  test("denies anonymous, terminal and foreign-user archive reads", async () => {
    expect((await request(preparationId, "invalid")).status).toBe(401);
    expect((await request(preparationId, f.terminal)).status).toBe(403);
    expect((await request(preparationId, f.otherSession)).status).toBe(404);
  });
  test("returns explicit historical values without keys, execution permission or writes", async () => {
    const before = await f.db.preparationAnswerUse.count({ where: { userId: f.owner } });
    const response = await request(preparationId);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const json = await response.text();
    const value: unknown = JSON.parse(json);
    expect(value).toMatchObject({
      historicalOnly: true,
      canReuse: false,
      canSubmit: false,
      items: expect.any(Array),
    });
    expect(json).toContain("PRIVATE original");
    for (const forbidden of ["payloadCipher", "keyCipher", "tokenHash", "wrappedDek"])
      expect(json).not.toContain(forbidden);
    expect(await f.db.preparationAnswerUse.count({ where: { userId: f.owner } })).toBe(before);
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(0);
  });
});
