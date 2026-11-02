import { AUTO_APPLY_DEFAULTS } from "@jobpilot/contracts/auto-apply";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import type { AutoApplyPolicy, PrismaClient } from "@/generated/prisma/client";
import { AuthTokenService } from "@/modules/auth/auth-token.service";
import { httpErrorResponses } from "@/types/response";
import { AutoApplyService } from "./auto-apply.service";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const owner: string = crypto.randomUUID();
const other: string = crypto.randomUUID();
let row: AutoApplyPolicy | null = null;
let events: Record<string, unknown>[] = [];
const db = {
  autoApplyPolicy: {
    findUnique: async ({ where }: { where: { userId: string } }) =>
      row?.userId === where.userId ? row : null,
    findUniqueOrThrow: async () => row,
    create: async ({ data }: { data: AutoApplyPolicy }) => {
      row = { ...data, updatedAt: new Date() };
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { userId: string; version: number };
      data: Partial<AutoApplyPolicy>;
    }) => {
      if (row?.userId !== where.userId || row.version !== where.version) return { count: 0 };
      row = { ...row, ...data, updatedAt: new Date() };
      return { count: 1 };
    },
  },
  resume: { findMany: async () => [], findFirst: async () => null },
  autoApplyAuditEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const event = {
        id: crypto.randomUUID(),
        createdAt: new Date(),
        previousPreferences: null,
        ...structuredClone(data),
      };
      events.push(event);
      return event;
    },
    findMany: async ({ where }: { where: { userId: string } }) =>
      events.filter((event) => event.userId === where.userId).reverse(),
    count: async ({ where }: { where: { userId: string } }) =>
      events.filter((event) => event.userId === where.userId).length,
  },
  $transaction: mock(async (work: (client: unknown) => unknown) => work(db)),
};
const service = new AutoApplyService(db as unknown as PrismaClient);
const resolve = container.get.bind(container);
const construction = spyOn(container, "get").mockImplementation((key) =>
  key === AutoApplyService ? service : resolve(key),
);
const { autoApplyController } = await import("./auto-apply.controller");
construction.mockRestore();
const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) => api.use(autoApplyController));
let auth: ReturnType<typeof spyOn<typeof container, "get">>;

beforeEach(() => {
  row = null;
  events = [];
  db.$transaction.mockClear();
  auth = spyOn(container, "get").mockImplementation((key) =>
    key === AuthTokenService
      ? {
          verify: async (token: string) =>
            [owner, other].includes(token)
              ? {
                  id: token,
                  email: "fixture@example.test",
                  role: "USER",
                  tokenId: token,
                }
              : null,
        }
      : resolve(key),
  );
});
afterEach(() => auth.mockRestore());

const request = (method: string, path: string, body?: unknown, token = owner) =>
  app.handle(
    new Request(`http://localhost/api/auto-apply${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

describe("authenticated auto-apply settings API", () => {
  it("requires authentication for settings reads, writes, and history", async () => {
    for (const [method, path] of [
      ["GET", "/settings"],
      ["PATCH", "/settings"],
      ["GET", "/audit"],
    ]) {
      const response = await request(
        method,
        path,
        method === "PATCH" ? { expectedVersion: 0, changes: { minimumSalaryUSD: 1 } } : undefined,
        "invalid",
      );
      expect(response.status).toBe(401);
    }
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("round-trips preferences with independent DRY_RUN state and audit history", async () => {
    const initial = await request("GET", "/settings");
    expect(initial.status).toBe(200);
    expect(initial.headers.get("cache-control")).toBe("no-store");
    expect(await initial.json()).toMatchObject({
      version: 0,
      settings: AUTO_APPLY_DEFAULTS,
      resumeReady: false,
    });
    const saved = await request("PATCH", "/settings", {
      expectedVersion: 0,
      changes: AUTO_APPLY_DEFAULTS,
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      version: 1,
      settings: AUTO_APPLY_DEFAULTS,
      runtime: { submissionMode: "DRY_RUN", liveSubmissionsEnabled: false },
    });
    const history = await request("GET", "/audit?page=1&limit=10");
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({
      items: [{ previousVersion: 0, version: 1, preferences: AUTO_APPLY_DEFAULTS }],
    });
  });

  it("rejects invalid and privileged fields without writes", async () => {
    for (const changes of [
      { minimumSalaryUSD: -1 },
      { roles: [] },
      { maxDailyApplications: 101 },
      { minimumMatchScore: 84.5 },
      { workArrangements: [] },
      { approvalForExceptions: false },
      { liveSubmissionsEnabled: true },
      { submissionMode: "LIVE" },
      { userId: other },
    ]) {
      const response = await request("PATCH", "/settings", { expectedVersion: 0, changes });
      expect(response.status).toBe(422);
    }
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("rejects stale versions and never leaks history or settings across users", async () => {
    await request("PATCH", "/settings", {
      expectedVersion: 0,
      changes: { minimumSalaryUSD: 90000 },
    });
    const stale = await request("PATCH", "/settings", {
      expectedVersion: 0,
      changes: { minimumSalaryUSD: 100000 },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "STALE_WRITE" });
    const history = await request("GET", "/audit", undefined, other);
    expect(await history.json()).toMatchObject({ items: [], pagination: { total: 0 } });
    const settings = await request("GET", "/settings", undefined, other);
    expect(await settings.json()).toMatchObject({
      version: 0,
      settings: { minimumSalaryUSD: 80000 },
    });
    expect(events).toHaveLength(1);
  });
});
