import { discoveryFixture } from "./postgres-fixture";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const f = discoveryFixture();
describe.skipIf(!f.enabled)("one-use provider grants and default denial", () => {
  beforeAll(() => f.setup({ enabled: false, roles: 2 }));
  afterAll(() => f.cleanup());
  test("discovery is disabled independently of an active ingestion key", async () => {
    await expect(
      f.claims.claim(f.integrationId, { requestId: crypto.randomUUID(), trigger: "manual" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await f.db.discoveryRun.count({ where: { userId: f.owner } })).toBe(0);
    await f.db.discoveryPolicy.update({ where: { userId: f.owner }, data: { enabled: true } });
  });
  test("provider cooldown blocks other tasks and an ambiguous fetch cannot be repeated", async () => {
    const claim = await f.claims.claim(f.integrationId, {
      requestId: crypto.randomUUID(),
      trigger: "manual",
    });
    const [first, second] = claim.taskIds;
    const requestId = crypto.randomUUID();
    expect((await f.claims.start(f.integrationId, { taskId: first!, requestId })).allowed).toBe(
      true,
    );
    expect((await f.claims.start(f.integrationId, { taskId: first!, requestId })).allowed).toBe(
      false,
    );
    await f.freezes.fail(f.integrationId, {
      taskId: first!,
      requestId,
      reason: "provider_uncertain",
      httpStatus: 429,
      retryAfterSeconds: 120,
    });
    expect(
      (await f.claims.start(f.integrationId, { taskId: second!, requestId: crypto.randomUUID() }))
        .allowed,
    ).toBe(false);
    expect(
      (await f.claims.claim(f.integrationId, { requestId: crypto.randomUUID(), trigger: "manual" }))
        .status,
    ).toBe("provider_backoff");
    f.context.time = new Date(f.context.time.getTime() + 121000);
    const secondRequest = crypto.randomUUID();
    expect(
      (await f.claims.start(f.integrationId, { taskId: second!, requestId: secondRequest }))
        .allowed,
    ).toBe(true);
    await f.freezes.fail(f.integrationId, {
      taskId: second!,
      requestId: secondRequest,
      reason: "provider_uncertain",
      httpStatus: 401,
      retryAfterSeconds: null,
    });
    expect(
      (await f.db.discoveryPolicy.findUniqueOrThrow({ where: { userId: f.owner } }))
        .providerAuthBlockedAt,
    ).not.toBeNull();
    expect(
      await f.db.discoveryTask.count({
        where: { run: { userId: f.owner }, startedAt: { not: null } },
      }),
    ).toBe(2);
  });
});
