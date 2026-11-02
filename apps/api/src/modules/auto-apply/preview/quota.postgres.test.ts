import { previewFixture } from "./preview-fixture";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const f = previewFixture();
describe.skipIf(!f.enabled)("atomic dry-run reservations on isolated PostgreSQL", () => {
  beforeAll(() => f.setup(50));
  afterAll(() => f.cleanup());
  test("serializes parallel batches at the cap without creating applications", async () => {
    const runs = await Promise.all(Array.from({ length: 4 }, () => f.run(25)));
    const results = await Promise.all(
      runs.map((run) =>
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
    ).toHaveLength(50);
    expect(await f.db.dryRunReservation.count({ where: { userId: f.owner } })).toBe(50);
    const preview = await f.real.preview(f.owner, {});
    expect(preview.quota.recordedApplications).toBe(0);
    expect(preview.quota.remainingActual).toBe(50);
    expect(preview.quota.remainingSimulation).toBe(0);
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(0);
    expect(await f.db.campaign.count({ where: { userId: f.owner } })).toBe(0);
    expect(await f.db.pilotRun.count({ where: { userId: f.owner } })).toBe(0);
  });
  test("replays one simulation idempotently and rejects changed input", async () => {
    const run = await f.run();
    const request = {
      requestId: crypto.randomUUID(),
      ingestionRunId: run.id,
      expectedSettingsVersion: 1,
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => f.simulation.simulate(f.owner, f.session, request)),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    await expect(
      f.simulation.simulate(f.owner, f.session, { ...request, resumeId: f.resumeId }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await f.db.dryRunReservation.count({ where: { userId: f.owner } })).toBe(50);
  });
  test("requires current settings and a browser session before allocating", async () => {
    const run = await f.run();
    const request = {
      requestId: crypto.randomUUID(),
      ingestionRunId: run.id,
      expectedSettingsVersion: 0,
    };
    await expect(f.simulation.simulate(f.owner, f.session, request)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      f.simulation.simulate(f.owner, f.terminal, { ...request, expectedSettingsVersion: 1 }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.simulation.simulate(f.other, f.session, { ...request, expectedSettingsVersion: 1 }),
    ).rejects.toMatchObject({ status: 403 });
  });
  test("keeps simulation and reservation history immutable", async () => {
    const reservation = await f.db.dryRunReservation.findFirstOrThrow({
      where: { userId: f.owner },
    });
    await expect(
      f.db.dryRunReservation.delete({ where: { id: reservation.id } }),
    ).rejects.toThrow();
    await expect(
      f.db.dryRunSimulation.update({
        where: { id: reservation.simulationId },
        data: { settingsVersion: 99 },
      }),
    ).rejects.toThrow();
    const history = await f.real.history(f.owner, { page: 1, limit: 20 });
    expect(history.pagination.total).toBe(5);
    expect((await f.real.history(f.other, { page: 1, limit: 20 })).items).toHaveLength(0);
    await expect(f.real.get(f.other, reservation.simulationId)).rejects.toMatchObject({
      status: 404,
    });
  });
});
