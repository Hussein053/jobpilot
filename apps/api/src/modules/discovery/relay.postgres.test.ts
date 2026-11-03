import { createHash, sign } from "node:crypto";
import { EMPTY_RESUME_DATA } from "@jobpilot/contracts/resume";
import { Elysia } from "elysia";
import { z } from "zod/v4";
import { container } from "@/common/di/container";
import { toInputJson } from "@/common/json";
import { errorMiddleware } from "@/common/middleware/error.middleware";
import type { Application } from "@/generated/prisma/client";
import { AuthTokenService } from "@/modules/auth/auth-token.service";
import { PolicyPreviewService } from "@/modules/auto-apply/preview/preview.service";
import { PreviewEvidenceService } from "@/modules/auto-apply/preview/preview-evidence.service";
import { DiscoveryRelay } from "@/modules/discovery-relay/relay";
import type { RelayCapabilities } from "@/modules/discovery-relay/security";
import { IngestionService } from "@/modules/ingestion/ingestion.service";
import { httpErrorResponses } from "@/types/response";
import { DiscoveryClaimService } from "./claim.service";
import { DiscoveryDeliveryService } from "./delivery.service";
import { DiscoveryFreezeService } from "./freeze.service";
import { DiscoveryHistoryService } from "./history.service";
import { discoveryFixture } from "./postgres-fixture";
import { DiscoveryRequestService } from "./request.service";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

const f = discoveryFixture();
const resolve = container.get.bind(container);
const construction = spyOn(container, "get").mockImplementation((key) => {
  if (key === DiscoveryRequestService) return f.gateway;
  if (key === DiscoveryClaimService) return f.claims;
  if (key === DiscoveryFreezeService) return f.freezes;
  if (key === DiscoveryDeliveryService) return f.deliveries;
  if (key === DiscoveryHistoryService) return f.history;
  if (key === IngestionService) return f.ingestion;
  return resolve(key);
});
const { discoveryController } = await import("./discovery.controller");
const { ingestionController } = await import("../ingestion/ingestion.controller");
construction.mockRestore();
const app = new Elysia()
  .use(errorMiddleware)
  .guard({ as: "scoped", response: httpErrorResponses })
  .group("/api", (api) => api.use(ingestionController).use(discoveryController));
let auth: ReturnType<typeof spyOn<typeof container, "get">>;
let providerCalls = 0;
let historical: Application;
const queries: string[] = [];
let loseIngestionResponse = true;
const capabilities: RelayCapabilities = {
  authenticate: async (request) =>
    request.headers.get("authorization") === "Bearer fixture-only" ? "fixture-workload" : null,
  signer: { sign: async (message) => sign(null, message, f.keys.privateKey) },
  jobpilotFetch: async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://jobpilot.example.test");
    expect(init?.redirect).toBe("error");
    const headers = new Headers(init?.headers);
    headers.set("x-real-ip", crypto.randomUUID());
    const response = await app.handle(new Request(url.toString(), { ...init, headers }));
    if (url.pathname.endsWith("/ingest") && loseIngestionResponse && response.ok) {
      loseIngestionResponse = false;
      throw Error("Synthetic lost response; never log payloads");
    }
    return response;
  },
  providerFetch: async (input, init) => {
    const url = new URL(String(input));
    providerCalls++;
    expect(url.origin).toBe("https://jsearch.p.rapidapi.com");
    expect(url.pathname).toBe("/search-v2");
    expect(url.searchParams.get("num_pages")).toBe("1");
    expect(url.searchParams.has("page")).toBe(false);
    expect(init?.redirect).toBe("error");
    const query = url.searchParams.get("query")!;
    queries.push(query);
    const body = f.rawProvider(createHash("sha256").update(query).digest("hex").slice(0, 20));
    return Response.json({
      ...body,
      data: {
        ...body.data,
        jobs: body.data.jobs.map((job) => ({
          ...job,
          status: "submitted",
          submit: true,
          userId: f.other,
        })),
      },
    });
  },
};
const relay = () =>
  new DiscoveryRelay(
    {
      enabled: true,
      integrationId: f.integrationId,
      publicKeyPem: f.publicKeyPem,
      expectedSubject: "fixture-workload",
      jobpilotOrigin: "https://jobpilot.example.test/",
    },
    capabilities,
  );
const trigger = () =>
  new Request("https://relay.example.test/trigger", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer fixture-only" },
    body: JSON.stringify({ requestId: crypto.randomUUID(), trigger: "manual" }),
  });
const ordinary = (path: string, token = f.owner) =>
  app.handle(
    new Request(`https://jobpilot.example.test/api/integrations/n8n/search${path}`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
describe.skipIf(!f.enabled)("relay through mounted signed endpoints on PostgreSQL", () => {
  beforeAll(async () => {
    await f.setup({ roles: 3, cap: 12 });
    const content = toInputJson({ ...EMPTY_RESUME_DATA, basics: { name: "Historical Fixture" } });
    const resume = await f.db.resume.create({
      data: { userId: f.owner, label: "Historical source", content },
    });
    const variant = await f.db.resumeVariant.create({
      data: { resumeId: resume.id, label: "Historical document", content },
    });
    historical = await f.db.application.create({
      data: {
        userId: f.owner,
        url: "https://jobs.example.test/Historical",
        title: "Historical role",
        company: "Historical Fixture",
        source: "manual",
        status: "interviewing",
        appliedAt: new Date("2020-01-01T00:00:00Z"),
        resumeId: resume.id,
        resumeVariantId: variant.id,
      },
    });

    auth = spyOn(container, "get").mockImplementation((key) =>
      key === AuthTokenService
        ? {
            verify: async (token: string) =>
              [f.owner, f.other].some((id) => id === token)
                ? { id: token, email: "fixture@example.test", role: "USER", tokenId: token }
                : null,
          }
        : resolve(key),
    );
  });
  afterAll(async () => {
    auth.mockRestore();
    await f.cleanup();
  });
  test("structured discovery, signing, durable storage and conservative policy work together", async () => {
    const response = await relay().handle(trigger());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      storedBatches: 3,
      submissionMode: "DRY_RUN",
      status: "complete",
    });
    expect(providerCalls).toBe(3);
    for (const role of ["Program Manager", "Project Manager", "Business Analyst"])
      expect(queries.some((query) => query.startsWith(role))).toBe(true);
    expect(await f.db.ingestionRun.count({ where: { integrationId: f.integrationId } })).toBe(3);
    expect(await f.db.discoveredJob.count({ where: { userId: f.owner } })).toBe(3);
    const run = await f.db.ingestionRun.findFirstOrThrow({
      where: { integrationId: f.integrationId },
    });
    const preview = await new PolicyPreviewService(f.db, new PreviewEvidenceService()).preview(
      f.owner,
      { ingestionRunId: run.id },
    );
    expect(preview.jobs[0]?.outcome).toMatchObject({ decision: "review", canSubmit: false });
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(1);
    expect(await f.db.application.findUnique({ where: { id: historical.id } })).toEqual(historical);
    expect(await f.db.campaign.count({ where: { userId: f.owner } })).toBe(0);
    expect(await f.db.pilotRun.count({ where: { userId: f.owner } })).toBe(0);
  });
  test("a restarted relay reuses durable state without repeating provider fetches", async () => {
    expect((await relay().handle(trigger())).status).toBe(200);
    expect(providerCalls).toBe(3);
    f.context.time = new Date(f.context.time.getTime() + 3600000);
    expect((await relay().handle(trigger())).status).toBe(200);
    expect(providerCalls).toBe(6);
    expect(await f.db.discoveredJob.count({ where: { userId: f.owner } })).toBe(3);
    expect(await f.db.ingestionRun.count({ where: { integrationId: f.integrationId } })).toBe(6);
  });
  test("machine operations reject user tokens, cross-purpose signatures and injected controls", async () => {
    const unsigned = await app.handle(
      new Request("https://jobpilot.example.test/api/integrations/n8n/search/claim", {
        method: "POST",
        headers: { authorization: `Bearer ${f.owner}`, "content-type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), trigger: "manual" }),
      }),
    );
    expect(unsigned.status).toBe(401);
    const input = { requestId: crypto.randomUUID(), trigger: "manual" };
    const original = f.request("claim", input);
    const headers = original.headers;
    expect(
      (
        await app.handle(
          new Request("https://jobpilot.example.test/api/integrations/n8n/search/start", {
            method: "POST",
            headers,
            body: JSON.stringify(input),
          }),
        )
      ).status,
    ).toBe(401);
    for (const extra of [
      { userId: f.other },
      { submissionMode: "LIVE" },
      { providerUrl: "https://evil.example.test" },
    ])
      expect((await app.handle(f.request("claim", { ...input, ...extra }))).status).toBe(422);
    const revoked = f.request("work", {});
    await f.db.ingestionIntegration.update({
      where: { id: f.integrationId },
      data: { active: false },
    });
    expect((await app.handle(revoked)).status).toBe(401);
    await f.db.ingestionIntegration.update({
      where: { id: f.integrationId },
      data: { active: true },
    });
  });
  test("history and canonical feeds are owner-only metadata and expose no execution routes", async () => {
    const response = await ordinary("/history");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    for (const secret of [
      "x-jobpilot-signature",
      "PRIVATE KEY",
      "Fixture Employer",
      "job_description",
    ])
      expect(text).not.toContain(secret);
    const other = await ordinary("/jobs", f.other);
    expect(z.object({ items: z.array(z.unknown()) }).parse(await other.json()).items).toHaveLength(
      0,
    );
    for (const path of ["/submit", "/activate", "/execute"])
      expect(
        (
          await app.handle(
            new Request(`https://jobpilot.example.test/api/integrations/n8n/search${path}`, {
              method: "POST",
              body: "{}",
            }),
          )
        ).status,
      ).toBe(404);
  });
});
