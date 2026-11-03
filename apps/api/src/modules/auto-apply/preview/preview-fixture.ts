import { createHash } from "node:crypto";
import { AUTO_APPLY_DEFAULTS } from "@jobpilot/contracts/auto-apply";
import { EMPTY_RESUME_DATA } from "@jobpilot/contracts/resume";
import { PrismaPg } from "@prisma/adapter-pg";
import { toInputJson } from "@/common/json";
import { PrismaClient } from "@/generated/prisma/client";
import type { PolicyFacts } from "./evaluate";
import { PolicyPreviewService } from "./preview.service";
import { PreviewEvidenceService } from "./preview-evidence.service";

class FixtureEvidence extends PreviewEvidenceService {
  override facts(): PolicyFacts {
    return {
      role: "Program Manager",
      country: "US",
      location: null,
      arrangement: "Remote",
      hardRequirements: "met",
      salary: { kind: "annual_base_usd", minimum: 80000 },
      matchScore: 85,
      screening: "resolved",
    };
  }
}
export function previewFixture() {
  const connection = process.env.JOBPILOT_TEST_DATABASE_URL;
  if (connection) {
    const url = new URL(connection);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/jobpilot_settings_test")
      throw new Error("Preview tests require the dedicated loopback database");
  }
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connection ?? "postgresql://unused" }),
  });
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const session = crypto.randomUUID();
  const terminal = crypto.randomUUID();
  const integrationId = crypto.randomUUID();
  const resumeId = crypto.randomUUID();
  const real = new PolicyPreviewService(db, new PreviewEvidenceService());
  const simulation = new PolicyPreviewService(db, new FixtureEvidence());
  return {
    enabled: !!connection,
    db,
    owner,
    other,
    session,
    terminal,
    integrationId,
    resumeId,
    real,
    simulation,
    async setup(cap = 50) {
      for (const id of [owner, other])
        await db.user.create({ data: { id, email: `${id}@fixture.test`, username: id } });
      for (const [id, kind, expiresAt] of [
        [session, "session", new Date(Date.now() + 3600000)],
        [terminal, "terminal", null],
      ] as const)
        await db.authToken.create({
          data: { id, kind, expiresAt, userId: owner, tokenHash: crypto.randomUUID() },
        });
      await db.ingestionIntegration.create({
        data: {
          id: integrationId,
          userId: owner,
          active: false,
          publicKeyPem: "unused fixture public material",
        },
      });
      await db.resume.create({
        data: {
          id: resumeId,
          userId: owner,
          label: "Approved Program Manager",
          approvedAt: new Date(),
          approvedVersion: 1,
          content: toInputJson({ ...EMPTY_RESUME_DATA, basics: { name: "Synthetic Fixture" } }),
        },
      });
      await db.autoApplyPolicy.create({
        data: {
          ...AUTO_APPLY_DEFAULTS,
          userId: owner,
          maxDailyApplications: cap,
          workArrangements: ["Remote", "Hybrid", "OnSite"],
        },
      });
    },
    async run(count = 1, overrides: Record<string, unknown> = {}) {
      const jobs = Array.from({ length: count }, () => {
        const id = crypto.randomUUID();
        return {
          sourceId: `jsearch:${id}`,
          title: "Program Manager",
          company: `Fixture ${id}`,
          url: `https://jobs.example.test/${id}`,
          location: "US",
          description: "Synthetic requirements",
          salary: null,
          ...overrides,
        };
      });
      const runId = crypto.randomUUID();
      const batch = { schemaVersion: 1, runId, jobs };
      return db.ingestionRun.create({
        data: {
          integrationId,
          runId,
          bodyDigest: createHash("sha256").update(JSON.stringify(batch)).digest("hex"),
          batch: toInputJson(batch),
        },
      });
    },
    async cleanup() {
      await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
      await db.$disconnect();
    },
  };
}
