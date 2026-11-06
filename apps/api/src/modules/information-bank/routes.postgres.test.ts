import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import { AuthTokenService } from "@/modules/auth/auth-token.service";
import { httpErrorResponses } from "@/types/response";
import { InformationBankService } from "./information-bank.service";
import { InformationBankImportService } from "./information-bank-import.service";
import { bankDatabaseFixture, ordinaryDraft } from "./postgres-fixture";
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";

const f = bankDatabaseFixture();
const resolve = container.get.bind(container);
const construction = spyOn(container, "get").mockImplementation((key) => {
  if (key === InformationBankService) return f.bank;
  if (key === InformationBankImportService) return f.importer;
  return resolve(key);
});
const { informationBankController } = await import("./information-bank.controller");
construction.mockRestore();
const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) => api.use(informationBankController));
const request = (method: string, path: string, body?: unknown, token: string = f.session) =>
  app.handle(
    new Request(`http://localhost/api/information-bank${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
let auth: ReturnType<typeof spyOn<typeof container, "get">>;
describe.skipIf(!f.enabled)("Information Bank mounted routes on PostgreSQL", () => {
  beforeAll(async () => {
    await f.setup();
    auth = spyOn(container, "get").mockImplementation((key) =>
      key === AuthTokenService
        ? {
            verify: async (token: string) =>
              [f.session, f.terminal].includes(token as typeof f.session)
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
  it("requires a browser session and returns protected data with no-store headers", async () => {
    expect((await request("GET", "/", undefined, "invalid")).status).toBe(401);
    expect((await request("GET", "/", undefined, f.terminal)).status).toBe(403);
    const response = await request("POST", "/", ordinaryDraft());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ status: "draft", ready: false });
  });
  it("rejects execution flags, owner changes, approval stamps, and spoofed provenance", async () => {
    for (const extra of [
      { userId: f.other },
      { status: "approved" },
      { liveSubmissionsEnabled: true },
      { source: { kind: "resume_draft" } },
    ]) {
      expect((await request("POST", "/", { ...ordinaryDraft(), ...extra })).status).toBe(422);
    }
  });
  it("does not expose keys, ciphertext, actor tokens, or unrestricted worker endpoints", async () => {
    const entry = await f.bank.create(f.owner, f.session, ordinaryDraft());
    for (const path of [`/${entry.id}`, `/${entry.id}/history`, "/export"]) {
      const response = await request("GET", path);
      expect(response.status).toBe(200);
      const body = JSON.stringify(await response.json());
      for (const forbidden of ["keyCipher", "payloadCipher", "actorTokenId"])
        expect(body).not.toContain(forbidden);
    }
    for (const path of ["/submit", "/execute", "/activate"])
      expect((await request("POST", path, {})).status).toBe(404);
  });
});
