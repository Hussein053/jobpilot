import { DiscoveryDeliveryService } from "./delivery.service";
import { discoveryFixture } from "./postgres-fixture";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const f = discoveryFixture();
describe.skipIf(!f.enabled)("durable signed delivery retries", () => {
  beforeAll(() => f.setup());
  afterAll(() => f.cleanup());
  let deliveryId: string;
  let originalBody: string;
  test("one lease wins and 429 honors Retry-After without changing bytes", async () => {
    const task = await f.task();
    deliveryId = task.frozen.deliveryIds[0]!;
    const leases = await Promise.all(
      Array.from({ length: 3 }, () =>
        f.deliveries.lease(f.integrationId, { deliveryId, requestId: crypto.randomUUID() }),
      ),
    );
    expect(leases.filter((l) => l.allowed)).toHaveLength(1);
    const lease = leases.find((l) => l.allowed)!;
    originalBody = lease.body!;
    await expect(
      f.deliveries.lease(f.otherIntegrationId, { deliveryId, requestId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (
        await f.deliveries.report(f.integrationId, {
          deliveryId,
          leaseId: lease.leaseId!,
          httpStatus: 429,
          receiptValid: false,
          retryAfterSeconds: 120,
        })
      ).state,
    ).toBe("retry_wait");
    const row = await f.db.discoveryDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(f.context.now().getTime() + 120000);
    expect(
      (await f.deliveries.lease(f.integrationId, { deliveryId, requestId: crypto.randomUUID() }))
        .allowed,
    ).toBe(false);
  });
  test("a restarted service reconciles a stored batch after the HTTP response was lost", async () => {
    f.context.time = new Date(f.context.time.getTime() + 121000);
    const restarted = new DiscoveryDeliveryService(f.context);
    const lease = await restarted.lease(f.integrationId, {
      deliveryId,
      requestId: crypto.randomUUID(),
    });
    expect(lease.body).toBe(originalBody);
    const receipt = await f.ingestion.ingest(f.request("ingest", lease.body));
    expect(receipt.disposition).toBe("stored_only");
    const report = await restarted.report(f.integrationId, {
      deliveryId,
      leaseId: lease.leaseId!,
      httpStatus: null,
      receiptValid: false,
      retryAfterSeconds: null,
    });
    expect(report.state).toBe("stored");
    expect(
      (await restarted.lease(f.integrationId, { deliveryId, requestId: crypto.randomUUID() }))
        .allowed,
    ).toBe(false);
    expect(await f.db.ingestionRun.count({ where: { integrationId: f.integrationId } })).toBe(1);
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(0);
  });
  test("a fabricated successful receipt cannot mark an unstored batch stored", async () => {
    f.context.time = new Date(f.context.time.getTime() + 3600000);
    const task = await f.task(f.rawProvider("Unstored"));
    const id = task.frozen.deliveryIds[0]!;
    const lease = await f.deliveries.lease(f.integrationId, {
      deliveryId: id,
      requestId: crypto.randomUUID(),
    });
    const report = await f.deliveries.report(f.integrationId, {
      deliveryId: id,
      leaseId: lease.leaseId!,
      httpStatus: 200,
      receiptValid: true,
      retryAfterSeconds: null,
    });
    expect(report).toMatchObject({ state: "quarantined", failure: "invalid_receipt" });
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(0);
  });
  test("delivery retry attempts stop at five and old fencing IDs cannot overwrite a new lease", async () => {
    f.context.time = new Date(f.context.time.getTime() + 3600000);
    const task = await f.task(f.rawProvider("Retries"));
    const id = task.frozen.deliveryIds[0]!;
    const first = await f.deliveries.lease(f.integrationId, {
      deliveryId: id,
      requestId: crypto.randomUUID(),
    });
    f.context.time = new Date(f.context.time.getTime() + 61000);
    const second = await f.deliveries.lease(f.integrationId, {
      deliveryId: id,
      requestId: crypto.randomUUID(),
    });
    await expect(
      f.deliveries.report(f.integrationId, {
        deliveryId: id,
        leaseId: first.leaseId!,
        httpStatus: 200,
        receiptValid: true,
        retryAfterSeconds: null,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await f.deliveries.report(f.integrationId, {
      deliveryId: id,
      leaseId: second.leaseId!,
      httpStatus: 503,
      receiptValid: false,
      retryAfterSeconds: null,
    });
    for (let attempt = 3; attempt <= 5; attempt++) {
      f.context.time = new Date(f.context.time.getTime() + 1000000);
      const lease = await f.deliveries.lease(f.integrationId, {
        deliveryId: id,
        requestId: crypto.randomUUID(),
      });
      expect(lease.allowed).toBe(true);
      const report = await f.deliveries.report(f.integrationId, {
        deliveryId: id,
        leaseId: lease.leaseId!,
        httpStatus: 503,
        receiptValid: false,
        retryAfterSeconds: null,
      });
      expect(report.state).toBe(attempt === 5 ? "quarantined" : "retry_wait");
    }
    expect((await f.db.discoveryDelivery.findUniqueOrThrow({ where: { id } })).attempts).toBe(5);
    expect(
      (
        await f.deliveries.lease(f.integrationId, {
          deliveryId: id,
          requestId: crypto.randomUUID(),
        })
      ).allowed,
    ).toBe(false);
  });
  test("bad runtime or authentication receipts stop the owned integration pipeline", async () => {
    f.context.time = new Date(f.context.time.getTime() + 3600000);
    const task = await f.task(f.rawProvider("UnsafeReceipt"));
    const id = task.frozen.deliveryIds[0]!;
    const lease = await f.deliveries.lease(f.integrationId, {
      deliveryId: id,
      requestId: crypto.randomUUID(),
    });
    expect(
      (
        await f.deliveries.report(f.integrationId, {
          deliveryId: id,
          leaseId: lease.leaseId!,
          httpStatus: 200,
          receiptValid: false,
          retryAfterSeconds: null,
        })
      ).state,
    ).toBe("auth_stopped");
    await expect(f.claims.work(f.integrationId)).rejects.toMatchObject({ status: 403 });
    expect((await f.history.history(f.other, { page: 1, limit: 10 })).items).toHaveLength(0);
  });
});
