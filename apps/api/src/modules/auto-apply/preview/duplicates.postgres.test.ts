import { previewFixture } from "./preview-fixture";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const f = previewFixture();
describe.skipIf(!f.enabled)("parallel duplicate and resume gates", () => {
  beforeAll(() => f.setup(10));
  afterAll(() => f.cleanup());
  test("different parallel request IDs reserve one copy of the same job", async () => {
    const run = await f.run();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.simulation.simulate(f.owner, f.session, {
          requestId: crypto.randomUUID(),
          ingestionRunId: run.id,
          expectedSettingsVersion: 1,
        }),
      ),
    );
    expect(
      results
        .flatMap((result) => result.jobs)
        .filter((job) => job.outcome.decision === "eligible_for_dry_run"),
    ).toHaveLength(1);
    expect(
      results
        .flatMap((result) => result.jobs)
        .filter((job) => job.outcome.reasons.includes("duplicate_in_progress")),
    ).toHaveLength(7);
    expect(await f.db.dryRunReservation.count({ where: { userId: f.owner } })).toBe(1);
  });
  test("requires owned current approval for manual and fixed selection", async () => {
    const run = await f.run();
    await f.db.autoApplyPolicy.update({
      where: { userId: f.owner },
      data: { resumeSelection: "manual", version: 2 },
    });
    const none = await f.simulation.preview(f.owner, { ingestionRunId: run.id });
    expect(none.jobs[0]?.outcome.reasons).toContain("resume_manual_required");
    expect(none.jobs[0]?.resume).toBeNull();
    const foreign = await f.simulation.preview(f.owner, {
      ingestionRunId: run.id,
      resumeId: crypto.randomUUID(),
    });
    expect(foreign.jobs[0]?.outcome.reasons).toContain("resume_review_required");
    const selected = await f.simulation.preview(f.owner, {
      ingestionRunId: run.id,
      resumeId: f.resumeId,
    });
    expect(selected.jobs[0]?.outcome.decision).toBe("eligible_for_dry_run");
    await f.db.autoApplyPolicy.update({
      where: { userId: f.owner },
      data: { resumeSelection: "fixed", fixedResumeId: f.resumeId, version: 3 },
    });
    await f.db.resume.update({
      where: { id: f.resumeId },
      data: { approvedAt: null, approvedVersion: null, reviewRevision: { increment: 1 } },
    });
    expect(
      (await f.simulation.preview(f.owner, { ingestionRunId: run.id })).jobs[0]?.outcome.reasons,
    ).toContain("resume_review_required");
  });
  test("historical replay after a settings change does not make new allocations", async () => {
    const history = await f.simulation.history(f.owner, { page: 1, limit: 10 });
    const saved = await f.simulation.get(f.owner, history.items[0]!.id);
    const replay = await f.simulation.simulate(f.owner, f.session, {
      requestId: saved.requestId,
      ingestionRunId: saved.ingestionRunId,
      expectedSettingsVersion: 1,
    });
    expect(replay.duplicate).toBe(true);
    expect(replay.settingsVersion).toBe(1);
    expect(replay.runtime.liveSubmissionsEnabled).toBe(false);
    expect(await f.db.dryRunReservation.count({ where: { userId: f.owner } })).toBe(1);
  });
});
