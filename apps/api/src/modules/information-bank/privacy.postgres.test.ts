import { EMPTY_RESUME_DATA } from "@jobpilot/contracts/resume";
import { toInputJson } from "@/common/json";
import { bankDatabaseFixture, ordinaryDraft, reviewDate } from "./postgres-fixture";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const f = bankDatabaseFixture();
describe.skipIf(!f.enabled)("Information Bank privacy and existing records", () => {
  beforeAll(f.setup);
  afterAll(f.cleanup);
  it("keeps lookup fingerprints and exported data isolated per owner", async () => {
    const definition = ordinaryDraft();
    const own = await f.bank.create(f.owner, f.session, definition);
    const foreign = await f.bank.create(f.other, f.otherSession, {
      ...definition,
      answer: { kind: "text", value: "foreign-private-sentinel" },
    });
    const a = await f.db.answerEntry.findUniqueOrThrow({ where: { id: own.id } });
    const b = await f.db.answerEntry.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(a.questionKeys).not.toEqual(b.questionKeys);
    expect(a.scopeFingerprint).not.toBe(b.scopeFingerprint);
    const exported = await f.bank.exportEntries(f.owner, f.session);
    expect(exported.entries.some((entry) => entry.id === own.id)).toBe(true);
    expect(JSON.stringify(exported)).not.toContain("foreign-private-sentinel");
    expect(JSON.stringify(exported)).not.toContain("keyCipher");
    expect(JSON.stringify(exported)).not.toContain("payloadCipher");
    await expect(f.bank.exportEntries(f.owner, f.terminal)).rejects.toMatchObject({ status: 403 });
  });
  it("imports only explicit contact facts as drafts and preserves existing answers on retries", async () => {
    await f.db.user.update({
      where: { id: f.owner },
      data: {
        firstName: "Fixture",
        lastName: "Applicant",
        contactEmail: "contact-fixture@example.test",
        phone: "+12025550123",
        city: "Fixture City",
        usAuthorized: true,
        requiresSponsorship: true,
      },
    });
    const first = await f.importer.profile(f.owner, f.session);
    expect(first.created).toBe(4);
    const entries = (await f.bank.list(f.owner, f.session, { page: 1, limit: 100 })).items.filter(
      (entry) => entry.source.kind === "profile_draft",
    );
    expect(entries).toHaveLength(4);
    expect(
      entries.every(
        (entry) =>
          entry.status === "draft" && !entry.ready && entry.definition.intent === "contact",
      ),
    ).toBe(true);
    const email = entries.find(
      (entry) => entry.definition.question === "What is your contact email?",
    )!;
    await f.bank.approve(f.owner, f.session, email.id, {
      expectedVersion: 1,
      reviewDueAt: reviewDate(),
    });
    expect(await f.importer.profile(f.owner, f.session)).toEqual({ created: 0, skipped: 4 });
    expect(await f.bank.get(f.owner, f.session, email.id)).toMatchObject({
      version: 2,
      status: "approved",
    });
  });
  it("does not inherit approval from a resume and refuses foreign resume imports", async () => {
    const resume = await f.db.resume.create({
      data: {
        userId: f.other,
        label: "Synthetic source",
        content: toInputJson({
          ...EMPTY_RESUME_DATA,
          basics: { name: "Other Fixture", email: "other-fixture@example.test" },
        }),
        approvedAt: new Date(),
        approvedVersion: 1,
      },
    });
    await expect(f.importer.resume(f.owner, f.session, resume.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await f.importer.resume(f.other, f.otherSession, resume.id)).created).toBe(2);
    const drafts = (
      await f.bank.list(f.other, f.otherSession, { page: 1, limit: 100 })
    ).items.filter((entry) => entry.source.kind === "resume_draft");
    expect(
      drafts.every(
        (entry) =>
          entry.status === "draft" &&
          entry.source.referenceId === resume.id &&
          entry.source.referenceVersion === 1,
      ),
    ).toBe(true);
  });
  it("preserves historical application status, dates, and linked resume documents", async () => {
    const content = toInputJson({ ...EMPTY_RESUME_DATA, basics: { name: "Historical Fixture" } });
    const resume = await f.db.resume.create({
      data: { userId: f.owner, label: "Historical source", content },
    });
    const variant = await f.db.resumeVariant.create({
      data: { resumeId: resume.id, label: "Historical document", content },
    });
    const application = await f.db.application.create({
      data: {
        userId: f.owner,
        title: "Historical Fixture",
        company: "Fixture",
        url: "https://jobs.example.test/historical-bank-fixture",
        source: "manual",
        status: "applied",
        appliedAt: new Date("2020-01-01T00:00:00Z"),
        resumeId: resume.id,
        resumeVariantId: variant.id,
      },
    });
    const before = await f.db.application.findUniqueOrThrow({
      where: { id: application.id },
      include: { resume: true, resumeVariantUsed: true },
    });
    const entry = await f.bank.create(f.owner, f.session, ordinaryDraft());
    await f.bank.approve(f.owner, f.session, entry.id, {
      expectedVersion: 1,
      reviewDueAt: reviewDate(),
    });
    await f.bank.edit(f.owner, f.session, entry.id, 2, {
      ...entry.definition,
      answer: { kind: "text", value: "Edited synthetic answer" },
    });
    await f.bank.remove(f.owner, f.session, entry.id, 3);
    expect(
      await f.db.application.findUniqueOrThrow({
        where: { id: application.id },
        include: { resume: true, resumeVariantUsed: true },
      }),
    ).toEqual(before);
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(1);
    expect(await f.db.campaign.count({ where: { userId: f.owner } })).toBe(0);
    expect(await f.db.pilotRun.count({ where: { userId: f.owner } })).toBe(0);
  });
});
