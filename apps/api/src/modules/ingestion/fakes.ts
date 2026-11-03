import { createHash, generateKeyPairSync, sign } from "node:crypto";
import type { IngestionIntegration, IngestionRun, PrismaClient } from "@/generated/prisma/client";
import { IngestionService } from "./ingestion.service";

export function ingestionFixture() {
  const keys = generateKeyPairSync("ed25519");
  const integration: IngestionIntegration = {
    id: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    active: true,
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
    createdAt: new Date(),
  };
  const batch = {
    schemaVersion: 1,
    runId: crypto.randomUUID(),
    jobs: [
      {
        sourceId: "synthetic-1",
        title: "Program Manager",
        company: "Fixture Company",
        url: "https://jobs.example.test/synthetic-1",
        location: "Remote, US",
        description: "Synthetic discovery fixture",
        salary: null,
      },
    ],
  };
  const rows = new Map<string, IngestionRun>();
  const db = {
    ingestionIntegration: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === integration.id ? integration : null,
    },
    ingestionRun: {
      findUnique: async ({ where }: { where: { integrationId_runId: { runId: string } } }) =>
        rows.get(where.integrationId_runId.runId) ?? null,
      create: async ({ data }: { data: Omit<IngestionRun, "id" | "createdAt"> }) => {
        if (rows.has(data.runId)) throw { code: "P2002" };
        const row = { ...data, id: crypto.randomUUID(), createdAt: new Date() };
        rows.set(data.runId, row);
        return row;
      },
      findMany: async ({ where }: { where: { integration: { userId: string } } }) =>
        where.integration.userId === integration.userId ? [...rows.values()] : [],
      count: async ({ where }: { where: { integration: { userId: string } } }) =>
        where.integration.userId === integration.userId ? rows.size : 0,
    },
  };
  const service = new IngestionService(db as unknown as PrismaClient);
  function request(input: unknown = batch, overrides: Record<string, string> = {}) {
    const body = typeof input === "string" ? input : JSON.stringify(input);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const digest = createHash("sha256").update(body).digest("hex");
    const message = `jobpilot-ingestion-v1\nPOST\n/api/integrations/n8n/ingest\n${integration.id}\n${timestamp}\n${digest}`;
    return new Request("http://localhost/api/integrations/n8n/ingest", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-jobpilot-integration": integration.id,
        "x-jobpilot-timestamp": timestamp,
        "x-jobpilot-signature": sign(null, Buffer.from(message), keys.privateKey).toString(
          "base64",
        ),
        "x-real-ip": crypto.randomUUID(),
        ...overrides,
      },
    });
  }
  return { integration, batch, rows, service, request };
}
