import { AUTO_APPLY_DEFAULTS } from "@jobpilot/contracts/auto-apply";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { ResumeService } from "@/modules/resume/resume.service";
import { AutoApplyService } from "./auto-apply.service";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Explicit opt-in, separate from DATABASE_URL: never run these against the tunnel or production.
const connection = process.env.JOBPILOT_TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/jobpilot_settings_test") {
    throw new Error("Settings integration tests require the dedicated loopback test database.");
  }
}

describe.skipIf(!connection)("auto-apply settings on isolated PostgreSQL", () => {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connection ?? "postgresql://unused" }),
  });
  const service = new AutoApplyService(db);
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const token = crypto.randomUUID();
  let version = 0;
  let resumeId = "";

  beforeAll(async () => {
    for (const id of [owner, other])
      await db.user.create({ data: { id, email: `${id}@fixture.test`, username: id } });
    const resume = await db.resume.create({ data: { userId: owner, label: "fixture resume" } });
    resumeId = resume.id;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
    await db.$disconnect();
  });

  it("reads version-zero defaults without inserting rows", async () => {
    const result = await service.get(owner);
    expect(result).toMatchObject({
      version: 0,
      updatedAt: null,
      settings: AUTO_APPLY_DEFAULTS,
      resumeReady: false,
    });
    expect(result.runtime).toMatchObject({
      submissionMode: "DRY_RUN",
      liveSubmissionsEnabled: false,
    });
    expect(await db.autoApplyPolicy.count({ where: { userId: owner } })).toBe(0);
  });

  it("persists complete preferences and an atomic audit snapshot", async () => {
    const result = await service.patch(owner, token, {
      expectedVersion: 0,
      changes: AUTO_APPLY_DEFAULTS,
    });
    version = result.version;
    expect(version).toBe(1);
    expect(result.settings).toEqual(AUTO_APPLY_DEFAULTS);
    expect((await service.audit(owner, { page: 1, limit: 10 })).items[0]).toMatchObject({
      previousVersion: 0,
      version: 1,
      previousPreferences: null,
      preferences: AUTO_APPLY_DEFAULTS,
    });
    expect((await service.audit(other, { page: 1, limit: 10 })).items).toHaveLength(0);
  });

  it("rejects live fields and unapproved or foreign resume targets without writes", async () => {
    for (const changes of [
      { liveSubmissionsEnabled: true },
      { submissionMode: "LIVE" },
      { approvalForExceptions: false },
      { resumeSelection: "fixed", fixedResumeId: resumeId },
      { resumeSelection: "fixed", fixedResumeId: crypto.randomUUID() },
    ])
      await expect(
        service.patch(owner, token, { expectedVersion: version, changes }),
      ).rejects.toMatchObject({ status: 422 });
    expect((await service.get(owner)).version).toBe(version);
    expect(await db.autoApplyAuditEvent.count({ where: { userId: owner } })).toBe(1);
  });

  it("allows only an owned active approved fixed resume", async () => {
    await db.resume.update({
      where: { id: resumeId },
      data: { approvedAt: new Date(), approvedVersion: 1 },
    });
    await expect(
      service.patch(other, token, {
        expectedVersion: 0,
        changes: {
          resumeSelection: "fixed",
          fixedResumeId: resumeId,
        },
      }),
    ).rejects.toMatchObject({ status: 422 });
    const result = await service.patch(owner, token, {
      expectedVersion: version,
      changes: {
        resumeSelection: "fixed",
        fixedResumeId: resumeId,
      },
    });
    version = result.version;
    expect(result.resumeReady).toBe(true);
    await db.resume.update({ where: { id: resumeId }, data: { version: { increment: 1 } } });
    expect((await service.get(owner)).resumeReady).toBe(false);
    await expect(
      service.patch(owner, token, {
        expectedVersion: version,
        changes: { minimumSalaryUSD: 81000 },
      }),
    ).rejects.toMatchObject({ status: 422 });
    await db.resume.update({ where: { id: resumeId }, data: { approvedVersion: 2 } });
    await db.resume.update({ where: { id: resumeId }, data: { active: false } });
    expect((await service.get(owner)).resumeReady).toBe(false);
  });

  it("allows exactly one competing save at a given version", async () => {
    const results = await Promise.allSettled(
      [90000, 100000].map((minimumSalaryUSD) =>
        service.patch(owner, token, {
          expectedVersion: version,
          changes: { minimumSalaryUSD, resumeSelection: "auto", fixedResumeId: null },
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { status: 409, code: "STALE_WRITE" } });
    version += 1;
    expect((await service.get(owner)).version).toBe(version);
    expect(await db.autoApplyAuditEvent.count({ where: { userId: owner } })).toBe(version);
  });

  it("serializes simultaneous first saves without duplicate history", async () => {
    const results = await Promise.allSettled(
      [80000, 90000].map((minimumSalaryUSD) =>
        service.patch(other, token, {
          expectedVersion: 0,
          changes: { minimumSalaryUSD },
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "STALE_WRITE" },
    });
    expect(await db.autoApplyAuditEvent.count({ where: { userId: other } })).toBe(1);
  });

  it("rolls back the policy if its audit insert fails", async () => {
    const before = await service.get(owner);
    await db.$executeRawUnsafe(
      "ALTER TABLE auto_apply_audit_events ADD CONSTRAINT fixture_reject_audit CHECK (false) NOT VALID",
    );
    try {
      await expect(
        service.patch(owner, token, {
          expectedVersion: version,
          changes: { minimumSalaryUSD: 123456 },
        }),
      ).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(
        "ALTER TABLE auto_apply_audit_events DROP CONSTRAINT fixture_reject_audit",
      );
    }
    expect(await service.get(owner)).toEqual(before);
    expect(await db.autoApplyAuditEvent.count({ where: { userId: owner } })).toBe(version);
  });

  it("rejects history edits/deletion and preserves earlier snapshots", async () => {
    await expect(
      Promise.resolve(
        db.autoApplyAuditEvent.updateMany({ where: { userId: owner }, data: { version: 999 } }),
      ),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(db.autoApplyAuditEvent.deleteMany({ where: { userId: owner } })),
    ).rejects.toThrow();
    const first = await db.autoApplyAuditEvent.findUniqueOrThrow({
      where: { userId_version: { userId: owner, version: 1 } },
    });
    expect(first.preferences).toEqual(AUTO_APPLY_DEFAULTS);
    const page = await service.audit(owner, { page: 1, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].version).toBe(version);
    expect(page.pagination.total).toBe(version);
  });

  it("enforces numeric policy bounds in the database too", async () => {
    await expect(
      Promise.resolve(db.$executeRaw`
      UPDATE auto_apply_policies SET max_daily_applications = 101 WHERE user_id = ${owner}
    `),
    ).rejects.toThrow();
    expect((await service.get(owner)).settings.maxDailyApplications).toBe(50);
  });

  it("source replacement and removal revoke approval without changing other resume behavior", async () => {
    const resumes = new ResumeService(db);
    await db.resume.update({
      where: { id: resumeId },
      data: { active: true, approvedAt: new Date(), approvedVersion: 2 },
    });
    await resumes.uploadSource(
      owner,
      resumeId,
      new File(["synthetic fixture"], "fixture.pdf", { type: "application/pdf" }),
    );
    expect(await db.resume.findUniqueOrThrow({ where: { id: resumeId } })).toMatchObject({
      approvedAt: null,
      approvedVersion: null,
    });
    await db.resume.update({
      where: { id: resumeId },
      data: { approvedAt: new Date(), approvedVersion: 2 },
    });
    await resumes.deleteSource(owner, resumeId);
    expect(await db.resume.findUniqueOrThrow({ where: { id: resumeId } })).toMatchObject({
      approvedAt: null,
      approvedVersion: null,
      sourceFilename: null,
    });
  });

  it("preserves a fixed preference while reporting a deleted resume as unavailable", async () => {
    await db.resume.update({
      where: { id: resumeId },
      data: { active: true, approvedAt: new Date(), approvedVersion: 2 },
    });
    const saved = await service.patch(owner, token, {
      expectedVersion: version,
      changes: {
        resumeSelection: "fixed",
        fixedResumeId: resumeId,
      },
    });
    version = saved.version;
    await db.resume.delete({ where: { id: resumeId } });
    const current = await service.get(owner);
    expect(current).toMatchObject({
      version,
      resumeReady: false,
      settings: { fixedResumeId: resumeId },
    });
  });
});
