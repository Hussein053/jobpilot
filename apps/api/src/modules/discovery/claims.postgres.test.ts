import { discoveryFixture } from "./postgres-fixture";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const f = discoveryFixture();
describe.skipIf(!f.enabled)("durable discovery planning on PostgreSQL", () => {
  beforeAll(() => f.setup({ cap: 3 }));
  afterAll(() => f.cleanup());
  test("claims a slot once under parallel requests and rotates all configured roles", async () => {
    const requests = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.claims.claim(f.integrationId, { requestId: crypto.randomUUID(), trigger: "scheduled" }),
      ),
    );
    expect(new Set(requests.map((r) => r.runId)).size).toBe(1);
    const roles = [];
    for (let hour = 0; hour < 3; hour++) {
      if (hour) f.context.time = new Date(f.context.time.getTime() + 3600000);
      const run = hour
        ? await f.claims.claim(f.integrationId, {
            requestId: crypto.randomUUID(),
            trigger: "scheduled",
          })
        : requests[0]!;
      const taskId = run.taskIds[0]!;
      const starts = await Promise.all(
        Array.from({ length: 4 }, () =>
          f.claims.start(f.integrationId, { taskId, requestId: crypto.randomUUID() }),
        ),
      );
      expect(starts.filter((start) => start.allowed)).toHaveLength(1);
      const row = await f.db.discoveryTask.findUniqueOrThrow({ where: { id: taskId } });
      roles.push(row.role);
    }
    expect(new Set(roles)).toEqual(
      new Set(["Program Manager", "Project Manager", "Business Analyst"]),
    );
    expect(
      await f.db.discoveryTask.count({
        where: { run: { userId: f.owner }, startedAt: { not: null } },
      }),
    ).toBe(3);
    f.context.time = new Date(f.context.time.getTime() + 3600000);
    expect(
      (
        await f.claims.claim(f.integrationId, {
          requestId: crypto.randomUUID(),
          trigger: "scheduled",
        })
      ).status,
    ).toBe("budget_exhausted");
  });
  test("current settings affect new slots without rewriting a claimed plan", async () => {
    const run = await f.db.discoveryRun.findFirstOrThrow({ where: { userId: f.owner } });
    const before = run.plan;
    await f.db.autoApplyPolicy.update({
      where: { userId: f.owner },
      data: { roles: ["Security Analyst"], version: 2 },
    });
    const replay = await f.claims.claim(f.integrationId, {
      requestId: run.requestId,
      trigger: run.trigger,
    });
    expect(replay.runId).toBe(run.id);
    expect((await f.db.discoveryRun.findUniqueOrThrow({ where: { id: run.id } })).plan).toEqual(
      before,
    );
    await expect(
      f.claims.claim(f.integrationId, {
        requestId: run.requestId,
        trigger: run.trigger === "manual" ? "scheduled" : "manual",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  test("ownership, inactive discovery and expired provider grants fail closed", async () => {
    const task = await f.db.discoveryTask.findFirstOrThrow({ where: { run: { userId: f.owner } } });
    await expect(
      f.claims.start(f.otherIntegrationId, { taskId: task.id, requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    await f.db.discoveryPolicy.update({ where: { userId: f.owner }, data: { enabled: false } });
    await expect(f.claims.work(f.integrationId)).rejects.toMatchObject({ status: 403 });
    await f.db.discoveryPolicy.update({ where: { userId: f.owner }, data: { enabled: true } });
    await f.claims.work(f.integrationId);
    expect(
      await f.db.discoveryTask.count({ where: { run: { userId: f.owner }, state: "quarantined" } }),
    ).toBe(3);
  });
  test("recorded provider grants and events cannot be rewritten or deleted", async () => {
    const task = await f.db.discoveryTask.findFirstOrThrow({ where: { run: { userId: f.owner } } });
    await expect(
      Promise.resolve(
        f.db.discoveryTask.update({ where: { id: task.id }, data: { startedAt: new Date() } }),
      ),
    ).rejects.toThrow();
    await expect(
      Promise.resolve(f.db.discoveryRun.delete({ where: { id: task.runId } })),
    ).rejects.toThrow();
    const event = await f.db.discoveryEvent.findFirstOrThrow({ where: { userId: f.owner } });
    await expect(
      Promise.resolve(f.db.discoveryEvent.delete({ where: { id: event.id } })),
    ).rejects.toThrow();
  });
});
