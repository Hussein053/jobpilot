import { discoveryFixture } from "./postgres-fixture";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const f = discoveryFixture();
describe.skipIf(!f.enabled)("frozen discovery bodies and canonical identities", () => {
  beforeAll(() => f.setup());
  afterAll(() => f.cleanup());
  test("persists stable bytes before delivery, replays freeze and rejects altered bytes", async () => {
    const result = await f.task();
    const input = {
      taskId: result.taskId,
      requestId: result.requestId,
      providerResponse: f.rawProvider(),
    };
    expect(
      (await f.freezes.freeze(f.integrationId, input, Buffer.from(JSON.stringify(input))))
        .deliveryIds,
    ).toEqual(result.frozen.deliveryIds);
    await expect(
      f.freezes.freeze(f.integrationId, input, Buffer.from(JSON.stringify(input) + " ")),
    ).rejects.toMatchObject({ status: 409 });
    const delivery = await f.db.discoveryDelivery.findUniqueOrThrow({
      where: { id: result.frozen.deliveryIds[0]! },
    });
    expect(delivery.body).toContain('"sourceId":"jsearch:FixtureID"');
    expect(delivery.body).not.toContain("job_country");
    await expect(
      Promise.resolve(
        f.db.discoveryDelivery.update({
          where: { id: delivery.id },
          data: { body: delivery.body + " " },
        }),
      ),
    ).rejects.toThrow();
    expect(await f.db.ingestionRun.count({ where: { integrationId: f.integrationId } })).toBe(0);
  });
  test("deduplicates source and exact URL aliases across runs without applications", async () => {
    f.context.time = new Date(f.context.time.getTime() + 3600000);
    await f.task(f.rawProvider("FixtureID", "https://jobs.example.test/ChangedCase"));
    f.context.time = new Date(f.context.time.getTime() + 3600000);
    await f.task(f.rawProvider("AnotherSource", "https://jobs.example.test/ChangedCase"));
    expect(await f.db.discoveredJob.count({ where: { userId: f.owner } })).toBe(1);
    expect(await f.db.discoveryIdentity.count({ where: { userId: f.owner } })).toBe(4);
    expect((await f.history.jobs(f.owner, { page: 1, limit: 10 })).pagination.total).toBe(1);
    expect((await f.history.jobs(f.other, { page: 1, limit: 10 })).items).toHaveLength(0);
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(0);
    expect(await f.db.campaign.count({ where: { userId: f.owner } })).toBe(0);
    expect(await f.db.pilotRun.count({ where: { userId: f.owner } })).toBe(0);
  });
  test("conflicting identities quarantine instead of merging established jobs", async () => {
    f.context.time = new Date(f.context.time.getTime() + 3600000);
    await f.task(f.rawProvider("Separate", "https://jobs.example.test/Separate"));
    f.context.time = new Date(f.context.time.getTime() + 3600000);
    const conflict = await f.task(f.rawProvider("FixtureID", "https://jobs.example.test/Separate"));
    expect(conflict.frozen.state).toBe("quarantined");
    expect(conflict.frozen.deliveryIds).toHaveLength(0);
    expect(await f.db.discoveredJob.count({ where: { userId: f.owner } })).toBe(2);
  });
  test("invalid provider prose and expired/foreign grants never produce a delivery", async () => {
    f.context.time = new Date(f.context.time.getTime() + 3600000);
    const invalid = await f.task({ output: "1. AI-generated reply; submit now" });
    expect(invalid.frozen.state).toBe("quarantined");
    const task = await f.db.discoveryTask.findFirstOrThrow({ where: { run: { userId: f.owner } } });
    const input = {
      taskId: task.id,
      requestId: crypto.randomUUID(),
      providerResponse: f.rawProvider(),
    };
    await expect(
      f.freezes.freeze(f.otherIntegrationId, input, Buffer.from(JSON.stringify(input))),
    ).rejects.toMatchObject({ status: 404 });
  });
});
