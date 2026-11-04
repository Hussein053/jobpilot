import { createPreparationSchema, reviewPreparationSchema } from "./preparation";
import { describe, expect, test } from "bun:test";

describe("preparation requests", () => {
  const request = () => ({
    requestId: crypto.randomUUID(),
    ingestionRunId: crypto.randomUUID(),
    sourceId: "jsearch:fixture",
  });
  test("rejects submission flags, browser actions, applicant values and approvals in creation", () => {
    for (const extra of [
      { submitted: true },
      { mode: "LIVE" },
      { action: "click" },
      { answers: {} },
      { approveExceptions: true },
    ])
      expect(createPreparationSchema.safeParse({ ...request(), ...extra }).success).toBe(false);
  });
  test("requires explicit version and exception decision for review", () => {
    expect(
      reviewPreparationSchema.safeParse({ expectedRevision: 0, approveExceptions: true }).success,
    ).toBe(false);
    expect(reviewPreparationSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
    expect(
      reviewPreparationSchema.safeParse({ expectedRevision: 1, approveExceptions: true }).success,
    ).toBe(true);
  });
});
