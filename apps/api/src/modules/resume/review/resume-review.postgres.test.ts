import { EMPTY_RESUME_DATA } from "@jobpilot/contracts/resume";
import { PrismaPg } from "@prisma/adapter-pg";
import { toInputJson } from "@/common/json";
import { PrismaClient } from "@/generated/prisma/client";
import { ResumeService } from "../resume.service";
import { ResumeReviewService } from "./resume-review.service";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const connection = process.env.JOBPILOT_TEST_DATABASE_URL;
if (connection) {
  const url = new URL(connection);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/jobpilot_settings_test")
    throw new Error("Resume tests require the dedicated loopback test database.");
}
describe.skipIf(!connection)("resume reviews on isolated PostgreSQL", () => {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connection ?? "postgresql://unused" }),
  });
  const service = new ResumeReviewService(db);
  const resumes = new ResumeService(db);
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const session = crypto.randomUUID();
  const terminal = crypto.randomUUID();
  const expired = crypto.randomUUID();
  const revoked = crypto.randomUUID();
  const otherSession = crypto.randomUUID();
  const content = {
    ...EMPTY_RESUME_DATA,
    basics: { ...EMPTY_RESUME_DATA.basics, name: "Synthetic Applicant" },
  };
  const create = () =>
    db.resume.create({
      data: { userId: owner, label: "Synthetic", content: toInputJson(content) },
    });
  beforeAll(async () => {
    for (const id of [owner, other])
      await db.user.create({ data: { id, email: `${id}@fixture.test`, username: id } });
    for (const [id, kind, expiresAt, revokedAt, userId] of [
      [session, "session", new Date(Date.now() + 3_600_000), null, owner],
      [terminal, "terminal", null, null, owner],
      [expired, "session", new Date(Date.now() - 1000), null, owner],
      [revoked, "session", new Date(Date.now() + 3_600_000), new Date(), owner],
      [otherSession, "session", new Date(Date.now() + 3_600_000), null, other],
    ] as const)
      await db.authToken.create({
        data: { id, kind, expiresAt, revokedAt, userId, tokenHash: crypto.randomUUID() },
      });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
    await db.$disconnect();
  });

  it("denies terminal, expired, revoked, and foreign session tokens", async () => {
    const row = await create();
    for (const token of [terminal, expired, revoked, otherSession, crypto.randomUUID()]) {
      await expect(
        service.review(owner, token, row.id, {
          action: "approve",
          expectedVersion: 1,
          expectedReviewRevision: 0,
        }),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect((await db.resume.findUniqueOrThrow({ where: { id: row.id } })).approvedAt).toBeNull();
  });
  it("serializes competing decisions into one append-only review", async () => {
    const row = await create();
    const decisions = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        service.review(owner, session, row.id, {
          action: "approve",
          expectedVersion: 1,
          expectedReviewRevision: 0,
        }),
      ),
    );
    expect(decisions.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.resumeReviewEvent.count({ where: { resumeId: row.id } })).toBe(1);
    expect((await db.resume.findUniqueOrThrow({ where: { id: row.id } })).approvedVersion).toBe(1);
  });
  it("rolls back approval if its audit insert fails", async () => {
    const row = await create();
    await db.resumeReviewEvent.create({
      data: {
        userId: owner,
        resumeId: row.id,
        action: "revoke",
        resumeVersion: 1,
        reviewRevision: 1,
        actorTokenId: session,
      },
    });
    await expect(
      service.review(owner, session, row.id, {
        action: "approve",
        expectedVersion: 1,
        expectedReviewRevision: 0,
      }),
    ).rejects.toBeDefined();
    expect(await db.resume.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      approvedAt: null,
      reviewRevision: 0,
    });
  });
  it("invalidates approval on edits and source replacement/removal, blocking an old review", async () => {
    const row = await create();
    await service.review(owner, session, row.id, {
      action: "approve",
      expectedVersion: 1,
      expectedReviewRevision: 0,
    });
    await resumes.update(owner, row.id, { content });
    expect(await db.resume.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      version: 2,
      approvedAt: null,
    });
    await expect(
      service.review(owner, session, row.id, {
        action: "approve",
        expectedVersion: 1,
        expectedReviewRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await resumes.uploadSource(
      owner,
      row.id,
      new File(["Synthetic PDF fixture"], "resume.pdf", { type: "application/pdf" }),
    );
    expect(await db.resume.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      version: 3,
      approvedAt: null,
    });
    await service.review(owner, session, row.id, {
      action: "approve",
      expectedVersion: 3,
      expectedReviewRevision: 1,
    });
    await resumes.deleteSource(owner, row.id);
    expect(await db.resume.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      version: 4,
      approvedAt: null,
    });
  });
  it("preserves review history after resume removal and isolates another account", async () => {
    const row = await create();
    await service.review(owner, session, row.id, {
      action: "approve",
      expectedVersion: 1,
      expectedReviewRevision: 0,
    });
    await db.resume.delete({ where: { id: row.id } });
    expect((await service.history(owner, row.id, { page: 1, limit: 10 })).items).toHaveLength(1);
    expect((await service.history(other, row.id, { page: 1, limit: 10 })).items).toHaveLength(0);
    const event = await db.resumeReviewEvent.findFirstOrThrow({ where: { resumeId: row.id } });
    await expect(
      Promise.resolve(
        db.resumeReviewEvent.update({ where: { id: event.id }, data: { action: "revoke" } }),
      ),
    ).rejects.toBeDefined();
    await expect(
      Promise.resolve(db.resumeReviewEvent.delete({ where: { id: event.id } })),
    ).rejects.toBeDefined();
  });
  it("does not create application, campaign, or Pilot records", async () => {
    expect(await db.application.count({ where: { userId: owner } })).toBe(0);
    expect(await db.campaign.count({ where: { userId: owner } })).toBe(0);
    expect(await db.pilotRun.count({ where: { userId: owner } })).toBe(0);
  });
  it("requires an available source file for a source-only resume", async () => {
    const missing = await db.resume.create({
      data: {
        userId: owner,
        label: "Missing fixture",
        sourceFilename: `missing-${crypto.randomUUID()}.pdf`,
      },
    });
    await expect(
      service.review(owner, session, missing.id, {
        action: "approve",
        expectedVersion: 1,
        expectedReviewRevision: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
    const uploaded = await resumes.createFromUpload(
      owner,
      new File(["%PDF-1.4\nSynthetic fixture"], "synthetic.pdf", { type: "application/pdf" }),
    );
    await service.review(owner, session, uploaded.id, {
      action: "approve",
      expectedVersion: 1,
      expectedReviewRevision: 0,
    });
    expect(
      (await db.resume.findUniqueOrThrow({ where: { id: uploaded.id } })).approvedVersion,
    ).toBe(1);
    await resumes.remove(owner, uploaded.id);
  });
});
