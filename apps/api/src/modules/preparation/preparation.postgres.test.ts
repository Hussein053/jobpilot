import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { createPreparationSchema } from "@jobpilot/contracts/preparation";
import { CryptoService } from "@/common/crypto/crypto.service";
import { previewFixture } from "@/modules/auto-apply/preview/preview-fixture";
import { AnswerResolutionService } from "@/modules/information-bank/answer-resolution.service";
import { InformationBankService } from "@/modules/information-bank/information-bank.service";
import { FIXTURE_FIELDS } from "./fixture-worker";
import { PreparationService } from "./preparation.service";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const f = previewFixture();
const cryptoService = new CryptoService(f.db);
const bank = new InformationBankService(f.db, cryptoService);
const service = new PreparationService(f.db, new AnswerResolutionService(f.db, cryptoService));
async function fixtureJob() {
  const run = await f.run(1, { url: `https://jobs.example.invalid/${crypto.randomUUID()}` });
  const data = run.batch;
  const batch = ingestionBatchSchema.parse(data);
  return createPreparationSchema.parse({
    requestId: crypto.randomUUID(),
    ingestionRunId: run.id,
    sourceId: batch.jobs[0]?.sourceId,
  });
}
async function approveAnswer(index: 0 | 1) {
  const field = FIXTURE_FIELDS[index];
  const entry = await bank.create(f.owner, f.session, {
    question: field.label,
    aliases: [],
    intent: field.intent,
    category: index === 0 ? "identity" : "experience",
    scope: "global",
    scopeKey: null,
    answer: { kind: "text", value: `Synthetic private value ${index}` },
  });
  return bank.approve(f.owner, f.session, entry.id, {
    expectedVersion: entry.version,
    reviewDueAt: new Date(Date.now() + 86400000).toISOString(),
  });
}

describe.skipIf(!f.enabled)("preparation on isolated PostgreSQL", () => {
  beforeAll(() => f.setup(50));
  afterAll(() => f.cleanup());
  test("rejects real employers and terminal/other-owner access", async () => {
    const realRun = await f.run();
    const realJob = ingestionBatchSchema.parse(realRun.batch).jobs[0];
    await expect(
      service.create(f.owner, f.session, {
        requestId: crypto.randomUUID(),
        ingestionRunId: realRun.id,
        sourceId: realJob?.sourceId ?? "",
      }),
    ).rejects.toMatchObject({ status: 400 });
    const input = await fixtureJob();
    await expect(service.create(f.owner, f.terminal, input)).rejects.toMatchObject({ status: 403 });
    await expect(service.create(f.other, f.session, input)).rejects.toMatchObject({ status: 403 });
  });
  test("detects unanswered fields, records approved reference provenance and explicit exception review", async () => {
    const input = await fixtureJob();
    const draft = await service.create(f.owner, f.session, input);
    expect(draft.status).toBe("review");
    expect(
      draft.questions.filter((question) => question.required && question.status === "review"),
    ).toHaveLength(2);
    await expect(
      service.simulate(f.owner, f.session, draft.id, draft.revision),
    ).rejects.toMatchObject({ status: 403 });
    await approveAnswer(0);
    await approveAnswer(1);
    const reviewed = await service.review(f.owner, f.session, draft.id, {
      expectedRevision: 1,
      approveExceptions: false,
    });
    expect(reviewed.status).toBe("review");
    expect(
      reviewed.questions
        .filter((question) => question.required)
        .every((question) => question.entryVersion === 2),
    ).toBe(true);
    expect(reviewed.questions.find((question) => question.id === "sponsorship")?.status).toBe(
      "review",
    );
    expect(JSON.stringify(reviewed)).not.toContain("Synthetic private value");
    const ready = await service.review(f.owner, f.session, draft.id, {
      expectedRevision: 2,
      approveExceptions: true,
    });
    expect(ready.status).toBe("ready");
    const simulated = await service.simulate(f.owner, f.session, ready.id, ready.revision);
    expect(simulated.status).toBe("simulated");
    expect(simulated.simulation?.submitted).toBe(false);
    expect(simulated.audit.map((event) => event.kind)).toEqual([
      "prepared",
      "reviewed",
      "reviewed",
      "simulated",
    ]);
    expect((await service.simulate(f.owner, f.session, ready.id, ready.revision)).id).toBe(
      simulated.id,
    );
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(0);
    expect(await f.db.campaign.count({ where: { userId: f.owner } })).toBe(0);
    expect(await f.db.pilotRun.count({ where: { userId: f.owner } })).toBe(0);
    const preview = await f.real.preview(f.owner, {});
    expect(preview.quota.recordedApplications).toBe(0);
    expect(preview.quota.dryRunReservations).toBe(1);
    expect(preview.quota.remainingSimulation).toBe(49);
    const rediscovered = await f.run(1, { url: simulated.job.url });
    const duplicatePreview = await f.simulation.preview(f.owner, {
      ingestionRunId: rediscovered.id,
    });
    expect(duplicatePreview.jobs[0]?.outcome.reasons).toContain("duplicate_in_progress");
    const duplicateSimulation = await f.simulation.simulate(f.owner, f.session, {
      requestId: crypto.randomUUID(),
      ingestionRunId: rediscovered.id,
      expectedSettingsVersion: preview.settingsVersion,
    });
    expect(duplicateSimulation.jobs[0]?.outcome.reasons).toContain("duplicate_in_progress");
    expect(await f.db.dryRunReservation.count({ where: { userId: f.owner } })).toBe(0);
    await expect(
      Promise.resolve(
        f.db.applicationPreparation.update({
          where: { id: ready.id },
          data: { status: "review", simulatedAt: null },
        }),
      ),
    ).rejects.toThrow("Simulated preparation is immutable");
    const event = await f.db.preparationEvent.findFirstOrThrow({
      where: { preparationId: ready.id },
    });
    await expect(
      Promise.resolve(f.db.preparationEvent.delete({ where: { id: event.id } })),
    ).rejects.toThrow("Dry-run history is append-only");
  });
  test("deduplicates source/URL and idempotency keys without changing history", async () => {
    const input = await fixtureJob();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.create(f.owner, f.session, input)),
    );
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    await expect(
      service.create(f.owner, f.session, { ...input, requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service.create(f.owner, f.session, { ...input, resumeId: f.resumeId }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(service.get(f.other, f.session, results[0]?.id ?? "")).rejects.toMatchObject({
      status: 403,
    });
  });
  test("rechecks resume approval, settings version and stale revisions at execution", async () => {
    const input = await fixtureJob();
    const created = await service.create(f.owner, f.session, input);
    const ready = await service.review(f.owner, f.session, created.id, {
      expectedRevision: 1,
      approveExceptions: true,
    });
    await expect(
      service.review(f.owner, f.session, ready.id, {
        expectedRevision: 1,
        approveExceptions: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await f.db.resume.update({
      where: { id: f.resumeId },
      data: { approvedAt: null, approvedVersion: null, reviewRevision: { increment: 1 } },
    });
    await expect(
      service.simulate(f.owner, f.session, ready.id, ready.revision),
    ).rejects.toMatchObject({ status: 409 });
    await f.db.resume.update({
      where: { id: f.resumeId },
      data: { approvedAt: new Date(), approvedVersion: 1 },
    });
    const refreshed = await service.review(f.owner, f.session, ready.id, {
      expectedRevision: ready.revision,
      approveExceptions: true,
    });
    await f.db.autoApplyPolicy.update({
      where: { userId: f.owner },
      data: { version: { increment: 1 } },
    });
    await expect(
      service.simulate(f.owner, f.session, refreshed.id, refreshed.revision),
    ).rejects.toMatchObject({ status: 409 });
  });
  test("blocks revoked answers and expired browser sessions before simulation", async () => {
    const input = await fixtureJob();
    const draft = await service.create(f.owner, f.session, input);
    const ready = await service.review(f.owner, f.session, draft.id, {
      expectedRevision: draft.revision,
      approveExceptions: true,
    });
    const contact = ready.questions.find((question) => question.id === "contact_email");
    expect(contact?.entryId).toBeTruthy();
    if (!contact?.entryId || !contact.entryVersion)
      throw new Error("Approved contact fixture missing");
    await bank.revoke(f.owner, f.session, contact.entryId, contact.entryVersion);
    await expect(
      service.simulate(f.owner, f.session, ready.id, ready.revision),
    ).rejects.toMatchObject({ status: 409 });
    const revoked = await bank.get(f.owner, f.session, contact.entryId);
    await bank.approve(f.owner, f.session, contact.entryId, {
      expectedVersion: revoked.version,
      reviewDueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const refreshed = await service.review(f.owner, f.session, ready.id, {
      expectedRevision: ready.revision,
      approveExceptions: true,
    });
    await f.db.authToken.update({
      where: { id: f.session },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      service.simulate(f.owner, f.session, refreshed.id, refreshed.revision),
    ).rejects.toMatchObject({ status: 403 });
    await f.db.authToken.update({
      where: { id: f.session },
      data: { expiresAt: new Date(Date.now() + 3600000) },
    });
  });
  test("serializes preparations against the same shared daily simulation quota", async () => {
    await f.db.autoApplyPolicy.update({
      where: { userId: f.owner },
      data: { maxDailyApplications: 2, version: { increment: 1 } },
    });
    const created = await Promise.all(
      Array.from({ length: 2 }, async () => service.create(f.owner, f.session, await fixtureJob())),
    );
    const ready = await Promise.all(
      created.map((row) =>
        service.review(f.owner, f.session, row.id, {
          expectedRevision: row.revision,
          approveExceptions: true,
        }),
      ),
    );
    const results = await Promise.allSettled(
      ready.map((row) => service.simulate(f.owner, f.session, row.id, row.revision)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const preview = await f.real.preview(f.owner, {});
    expect(preview.quota.remainingSimulation).toBe(0);
    expect(preview.quota.recordedApplications).toBe(0);
    expect(
      await f.db.applicationPreparation.count({ where: { userId: f.owner, status: "simulated" } }),
    ).toBe(2);
  });
});
