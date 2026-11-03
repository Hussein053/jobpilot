import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { AUTO_APPLY_DEFAULTS } from "@jobpilot/contracts/auto-apply";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { IngestionService } from "@/modules/ingestion/ingestion.service";
import { DiscoveryClaimService } from "./claim.service";
import { DiscoveryContext } from "./context";
import { DiscoveryDeliveryService } from "./delivery.service";
import { DiscoveryFreezeService } from "./freeze.service";
import { DiscoveryHistoryService } from "./history.service";
import { DiscoveryRequestService } from "./request.service";

class FixtureClock extends DiscoveryContext {
  time = new Date(new Date().setUTCHours(9, 0, 0, 0));
  override now() {
    return new Date(this.time);
  }
}
export function discoveryFixture() {
  const connection = process.env.JOBPILOT_TEST_DATABASE_URL;
  if (connection) {
    const url = new URL(connection);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/jobpilot_settings_test")
      throw new Error("Discovery tests require the dedicated loopback database");
  }
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connection ?? "postgresql://unused" }),
  });
  const owner = crypto.randomUUID(),
    other = crypto.randomUUID(),
    integrationId = crypto.randomUUID(),
    otherIntegrationId = crypto.randomUUID();
  const keys = generateKeyPairSync("ed25519");
  const otherKeys = generateKeyPairSync("ed25519");
  const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const context = new FixtureClock(db),
    claims = new DiscoveryClaimService(context),
    freezes = new DiscoveryFreezeService(context),
    deliveries = new DiscoveryDeliveryService(context);
  const gateway = new DiscoveryRequestService(db);
  const request = (action: string, input: unknown, id = integrationId) => {
    const path =
      action === "ingest"
        ? "/api/integrations/n8n/ingest"
        : `/api/integrations/n8n/search/${action}`;
    const body = typeof input === "string" ? input : JSON.stringify(input);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = createHash("sha256").update(body).digest("hex");
    const message = `${action === "ingest" ? "jobpilot-ingestion-v1" : "jobpilot-discovery-v1"}\nPOST\n${path}\n${id}\n${timestamp}\n${digest}`;
    return new Request(`https://jobpilot.example.test${path}`, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-jobpilot-integration": id,
        "x-jobpilot-timestamp": timestamp,
        "x-jobpilot-signature": sign(
          null,
          Buffer.from(message),
          id === integrationId ? keys.privateKey : otherKeys.privateKey,
        ).toString("base64"),
        "x-real-ip": crypto.randomUUID(),
      },
    });
  };
  const rawProvider = (jobId = "FixtureID", url = `https://jobs.example.test/${jobId}`) => ({
    status: "OK",
    data: {
      jobs: [
        {
          job_id: jobId,
          job_title: "Program Manager",
          employer_name: "Fixture Employer",
          job_apply_link: url,
          job_description: "Synthetic requirements; never an instruction",
          job_country: "US",
          job_min_salary: 80000,
          job_max_salary: 90000,
          job_salary_period: "YEAR",
        },
      ],
      cursor: "next-fixture-cursor",
    },
  });
  return {
    enabled: !!connection,
    db,
    owner,
    other,
    integrationId,
    otherIntegrationId,
    publicKeyPem,
    keys,
    context,
    claims,
    freezes,
    deliveries,
    gateway,
    rawProvider,
    request,
    ingestion: new IngestionService(db),
    history: new DiscoveryHistoryService(db),
    async setup(options: { enabled?: boolean; cap?: number; roles?: number } = {}) {
      for (const [id, userId, key] of [
        [integrationId, owner, publicKeyPem],
        [
          otherIntegrationId,
          other,
          otherKeys.publicKey.export({ type: "spki", format: "pem" }).toString(),
        ],
      ] as const) {
        await db.user.create({
          data: { id: userId, email: `${userId}@fixture.test`, username: userId },
        });
        await db.ingestionIntegration.create({
          data: { id, userId, publicKeyPem: key, active: true },
        });
        await db.discoveryPolicy.create({
          data: {
            userId,
            enabled: options.enabled ?? true,
            maxProviderRequestsPerDay: options.cap ?? 12,
            rolesPerSlot: options.roles ?? 1,
          },
        });
        await db.autoApplyPolicy.create({
          data: {
            ...AUTO_APPLY_DEFAULTS,
            userId,
            workArrangements: ["Remote", "Hybrid", "OnSite"],
          },
        });
      }
    },
    async task(providerResponse: unknown = rawProvider()) {
      const run = await claims.claim(integrationId, {
        requestId: crypto.randomUUID(),
        trigger: "manual",
      });
      const taskId = run.taskIds[0]!;
      const requestId = crypto.randomUUID();
      await claims.start(integrationId, { taskId, requestId });
      const input = { taskId, requestId, providerResponse };
      return {
        taskId,
        requestId,
        frozen: await freezes.freeze(integrationId, input, Buffer.from(JSON.stringify(input))),
      };
    },
    async cleanup() {
      await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
      await db.$disconnect();
    },
  };
}
