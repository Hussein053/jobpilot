import {
  discoveryClaimSchema,
  discoveryFreezeSchema,
  discoveryReportSchema,
  discoveryStartSchema,
  storedIngestionReceiptSchema,
} from "./discovery";
import { expect, test } from "bun:test";

test("machine requests cannot select ownership, timestamps, activation, destinations or credentials", () => {
  const claim = { requestId: crypto.randomUUID(), trigger: "scheduled" };
  expect(discoveryClaimSchema.safeParse(claim).success).toBe(true);
  for (const key of [
    "userId",
    "slotAt",
    "settingsVersion",
    "enabled",
    "targetUrl",
    "privateKey",
    "submissionMode",
  ])
    expect(discoveryClaimSchema.safeParse({ ...claim, [key]: "forged" }).success).toBe(false);
  expect(
    discoveryStartSchema.safeParse({
      taskId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      query: "override",
    }).success,
  ).toBe(false);
  expect(
    discoveryFreezeSchema.safeParse({
      taskId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      providerResponse: {},
      submit: true,
    }).success,
  ).toBe(false);
});
test("reports are bounded metadata and receipts cannot declare application submission", () => {
  const report = {
    deliveryId: crypto.randomUUID(),
    leaseId: crypto.randomUUID(),
    httpStatus: 429,
    receiptValid: false,
    retryAfterSeconds: 60,
  };
  expect(discoveryReportSchema.safeParse(report).success).toBe(true);
  expect(discoveryReportSchema.safeParse({ ...report, retryAfterSeconds: 9999999 }).success).toBe(
    false,
  );
  expect(discoveryReportSchema.safeParse({ ...report, responseBody: "private" }).success).toBe(
    false,
  );
  expect(
    storedIngestionReceiptSchema.safeParse({
      id: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      duplicate: false,
      disposition: "submitted",
      runtime: {
        submissionMode: "DRY_RUN",
        liveSubmissionsEnabled: false,
        unrestrictedAgentsEnabled: false,
      },
    }).success,
  ).toBe(false);
});
