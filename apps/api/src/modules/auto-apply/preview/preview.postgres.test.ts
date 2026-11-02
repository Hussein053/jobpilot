import { previewFixture } from "./preview-fixture";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const f = previewFixture();
describe.skipIf(!f.enabled)("policy preview preservation on isolated PostgreSQL", () => {
  beforeAll(() => f.setup(3));
  afterAll(() => f.cleanup());
  test("v1 evidence stays in review and preview has no writes", async () => {
    const run = await f.run();
    const result = await f.real.preview(f.owner, { ingestionRunId: run.id });
    expect(result.runtime.submissionMode).toBe("DRY_RUN");
    expect(result.jobs[0]?.outcome.decision).toBe("review");
    for (const reason of [
      "country_unverified",
      "arrangement_unverified",
      "hard_requirements_unverified",
      "match_score_unverified",
      "screening_unresolved",
      "salary_unknown",
    ] as const)
      expect(result.jobs[0]?.outcome.reasons).toContain(reason);
    expect(await f.db.dryRunSimulation.count({ where: { userId: f.owner } })).toBe(0);
    const saved = await f.real.simulate(f.owner, f.session, {
      requestId: crypto.randomUUID(),
      ingestionRunId: run.id,
      expectedSettingsVersion: 1,
    });
    expect(saved.jobs[0]?.outcome.canSubmit).toBe(false);
    expect(await f.db.dryRunReservation.count({ where: { userId: f.owner } })).toBe(0);
  });
  test("rejects foreign discovery runs and never returns resume content", async () => {
    const run = await f.run();
    await expect(f.real.preview(f.other, { ingestionRunId: run.id })).rejects.toMatchObject({
      status: 404,
    });
    const result = await f.real.preview(f.owner, { ingestionRunId: run.id });
    expect(JSON.stringify(result)).not.toContain("Synthetic Fixture");
  });
  test("counts existing history separately and preserves its dates, status and resume links", async () => {
    const historical = await f.db.application.create({
      data: {
        userId: f.owner,
        source: "manual",
        status: "interviewing",
        title: "Historical Program Manager",
        company: "Historical Fixture",
        url: "https://jobs.example.test/history",
        resumeId: f.resumeId,
        appliedAt: new Date(),
      },
    });
    const run = await f.run(3);
    const result = await f.simulation.simulate(f.owner, f.session, {
      requestId: crypto.randomUUID(),
      ingestionRunId: run.id,
      expectedSettingsVersion: 1,
    });
    expect(
      result.jobs.filter((job) => job.outcome.decision === "eligible_for_dry_run"),
    ).toHaveLength(2);
    expect(result.jobs[2]?.outcome.reasons).toContain("daily_cap_reached");
    expect(result.quota).toMatchObject({
      recordedApplications: 1,
      dryRunReservations: 2,
      remainingActual: 2,
      remainingSimulation: 0,
    });
    expect(await f.db.application.findUnique({ where: { id: historical.id } })).toEqual(historical);
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(1);
    const duplicate = await f.run(1, { url: historical.url });
    expect(
      (await f.real.preview(f.owner, { ingestionRunId: duplicate.id })).jobs[0]?.outcome.reasons,
    ).toContain("duplicate_application");
    const uncertain = await f.run(1, { title: historical.title, company: historical.company });
    expect(
      (await f.real.preview(f.owner, { ingestionRunId: uncertain.id })).jobs[0]?.outcome.reasons,
    ).toContain("duplicate_uncertain");
  });
  test("deduplicates the same provider identity across runs even when its URL changes", async () => {
    const reserved = await f.db.dryRunReservation.findFirstOrThrow({ where: { userId: f.owner } });
    const run = await f.run(1, { sourceId: reserved.sourceId });
    expect(
      (await f.real.preview(f.owner, { ingestionRunId: run.id })).jobs[0]?.outcome.reasons,
    ).toContain("duplicate_in_progress");
    const sameUrl = await f.run(1, { url: reserved.url });
    expect(
      (await f.real.preview(f.owner, { ingestionRunId: sameUrl.id })).jobs[0]?.outcome.reasons,
    ).toContain("duplicate_in_progress");
  });
  test("rejects unapproved, inactive and stale resume versions", async () => {
    const run = await f.run();
    for (const data of [
      { active: false },
      { active: true, approvedAt: null },
      { approvedAt: new Date(), approvedVersion: 1, version: 2 },
    ]) {
      await f.db.resume.update({ where: { id: f.resumeId }, data });
      expect(
        (await f.real.preview(f.owner, { ingestionRunId: run.id })).jobs[0]?.outcome.reasons,
      ).toContain("resume_review_required");
    }
    await f.db.resume.update({
      where: { id: f.resumeId },
      data: { active: true, version: 2, approvedAt: new Date(), approvedVersion: 2 },
    });
  });
  test("rolls back a simulation if reservation storage fails", async () => {
    await f.db.autoApplyPolicy.update({
      where: { userId: f.owner },
      data: { maxDailyApplications: 10, version: 2 },
    });
    const run = await f.run();
    const before = await f.db.dryRunSimulation.count({ where: { userId: f.owner } });
    await f.db.$executeRawUnsafe(
      "ALTER TABLE dry_run_reservations ADD CONSTRAINT fixture_reject_reservation CHECK (false) NOT VALID",
    );
    try {
      await expect(
        f.simulation.simulate(f.owner, f.session, {
          requestId: crypto.randomUUID(),
          ingestionRunId: run.id,
          expectedSettingsVersion: 2,
        }),
      ).rejects.toThrow();
    } finally {
      await f.db.$executeRawUnsafe(
        "ALTER TABLE dry_run_reservations DROP CONSTRAINT fixture_reject_reservation",
      );
    }
    expect(await f.db.dryRunSimulation.count({ where: { userId: f.owner } })).toBe(before);
    expect(await f.db.dryRunReservation.count({ where: { userId: f.owner } })).toBe(2);
  });
  test("blocks duplicate URLs inside one batch before reserving twice", async () => {
    const run = await f.run(2, { url: "https://jobs.example.test/shared-batch-url" });
    const result = await f.simulation.simulate(f.owner, f.session, {
      requestId: crypto.randomUUID(),
      ingestionRunId: run.id,
      expectedSettingsVersion: 2,
    });
    expect(result.jobs[0]?.outcome.decision).toBe("eligible_for_dry_run");
    expect(result.jobs[1]?.outcome.reasons).toContain("duplicate_in_progress");
    expect(
      await f.db.dryRunReservation.count({
        where: { userId: f.owner, url: "https://jobs.example.test/shared-batch-url" },
      }),
    ).toBe(1);
  });
  test("marks ambiguous same-company/title cross-platform matches for review", async () => {
    const run = await f.run(2, { company: "Cross Platform Fixture" });
    const result = await f.simulation.simulate(f.owner, f.session, {
      requestId: crypto.randomUUID(),
      ingestionRunId: run.id,
      expectedSettingsVersion: 2,
    });
    expect(result.jobs[0]?.outcome.decision).toBe("eligible_for_dry_run");
    expect(result.jobs[1]?.outcome.decision).toBe("review");
    expect(result.jobs[1]?.outcome.reasons).toContain("duplicate_uncertain");
  });
});
