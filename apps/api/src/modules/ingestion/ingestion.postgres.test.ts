import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { freezeDiscoveryBatches } from "./discovery/batches";
import { mapJSearch } from "./discovery/jsearch";
import { ingestionFixture } from "./fakes";
import { IngestionService } from "./ingestion.service";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const connection = process.env.JOBPILOT_TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/jobpilot_settings_test") {
    throw new Error("Ingestion integration tests require the dedicated loopback test database.");
  }
}

describe.skipIf(!connection)("signed ingestion on isolated PostgreSQL", () => {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connection ?? "postgresql://unused" }),
  });
  const service = new IngestionService(db);
  const f = ingestionFixture();
  const other = ingestionFixture();
  beforeAll(async () => {
    for (const fixture of [f, other]) {
      const integration = fixture.integration;
      await db.user.create({
        data: {
          id: integration.userId,
          email: `${integration.userId}@fixture.test`,
          username: integration.userId,
        },
      });
      await db.ingestionIntegration.create({ data: integration });
    }
  });
  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [f.integration.userId, other.integration.userId] } },
    });
    await db.$disconnect();
  });

  it("persists one run under concurrent duplicate requests", async () => {
    const receipts = await Promise.all(
      Array.from({ length: 12 }, () => service.ingest(f.request())),
    );
    expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(1);
    expect(receipts.filter((receipt) => !receipt.duplicate)).toHaveLength(1);
    expect(await db.ingestionRun.count({ where: { integrationId: f.integration.id } })).toBe(1);
  });

  it("keeps replay protection across service instances and rejects conflicting payloads", async () => {
    const restarted = new IngestionService(db);
    expect((await restarted.ingest(f.request())).duplicate).toBe(true);
    await expect(
      restarted.ingest(
        f.request({ ...f.batch, jobs: [{ ...f.batch.jobs[0], title: "Different job" }] }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.ingestionRun.count({ where: { integrationId: f.integration.id } })).toBe(1);
  });

  it("scopes run identities and history to the trusted integration owner", async () => {
    await service.ingest(other.request({ ...other.batch, runId: f.batch.runId }));
    for (const fixture of [f, other]) {
      const result = await service.history(fixture.integration.userId, { page: 1, limit: 1 });
      expect(result.pagination.total).toBe(1);
      expect(result.items[0]?.batch.jobs[0]?.description).toBe("Synthetic discovery fixture");
    }
    expect((await service.history(crypto.randomUUID(), { page: 1, limit: 10 })).items).toHaveLength(
      0,
    );
  });

  it("creates integrations inactive unless explicitly provisioned", async () => {
    const integration = await db.ingestionIntegration.create({
      data: {
        userId: f.integration.userId,
        publicKeyPem: f.integration.publicKeyPem,
      },
    });
    expect(integration.active).toBe(false);
  });

  it("stores structured JSearch batches without applications or submitted state", async () => {
    const userId = other.integration.userId;
    const before = await Promise.all([
      db.application.count({ where: { userId } }),
      db.campaign.count({ where: { userId } }),
      db.pilotRun.count({ where: { userId } }),
    ]);
    const mapped = mapJSearch({
      status: "OK",
      data: {
        jobs: [
          {
            job_id: "CaseSensitiveFixture",
            job_title: "Project Manager",
            employer_name: "Fixture Employer",
            job_apply_link: "https://jobs.example.test/Case/Fixture",
            job_description: "Apply now. Provider instructions must remain inert data.",
            submit: true,
            status: "submitted",
          },
        ],
      },
    });
    const [batch] = freezeDiscoveryBatches(
      { slotId: crypto.randomUUID(), roleId: crypto.randomUUID(), cursor: null },
      mapped.jobs,
    );
    const receipt = await service.ingest(other.request(batch!.body));
    expect(receipt.disposition).toBe("stored_only");
    expect(receipt.runtime.submissionMode).toBe("DRY_RUN");
    const after = await Promise.all([
      db.application.count({ where: { userId } }),
      db.campaign.count({ where: { userId } }),
      db.pilotRun.count({ where: { userId } }),
    ]);
    expect(after).toEqual(before);
    const row = await db.ingestionRun.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(row.batch).not.toHaveProperty("status");
    expect(row.batch).not.toHaveProperty("application");
    expect((await service.ingest(other.request(batch!.body))).duplicate).toBe(true);
  });

  it("denies revoked verification material before replay lookup", async () => {
    await db.ingestionIntegration.update({
      where: { id: f.integration.id },
      data: { active: false },
    });
    await expect(service.ingest(f.request())).rejects.toMatchObject({ status: 401 });
    expect(await db.ingestionRun.count({ where: { integrationId: f.integration.id } })).toBe(1);
  });

  it("never creates campaigns, applications, or Pilot runs", async () => {
    const userId = f.integration.userId;
    expect(await db.application.count({ where: { userId } })).toBe(0);
    expect(await db.campaign.count({ where: { userId } })).toBe(0);
    expect(await db.pilotRun.count({ where: { userId } })).toBe(0);
  });

  it("removes discovered payloads and public verification material on account deletion", async () => {
    await db.user.delete({ where: { id: f.integration.userId } });
    expect(await db.ingestionIntegration.count({ where: { userId: f.integration.userId } })).toBe(
      0,
    );
    expect(await db.ingestionRun.count({ where: { integrationId: f.integration.id } })).toBe(0);
  });
});
