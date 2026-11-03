import {
  APPLIED_AT,
  OTHER_USERS_VARIANT_ID,
  OWNED_RESUME_ID,
  OWNED_VARIANT_ID,
  setup,
} from "./fakes";
import { describe, expect, it } from "bun:test";

describe("CampaignJobService terminal results in dry run", () => {
  it("blocks new submitted outcomes before application or document writes", async () => {
    for (const ids of [
      {},
      { resumeId: OWNED_RESUME_ID },
      { resumeVariantId: OWNED_VARIANT_ID },
      { resumeVariantId: OTHER_USERS_VARIANT_ID },
    ]) {
      const state = setup();
      await expect(
        state.service.recordJobResult("u1", "c1", "j1", {
          outcome: "applied",
          appliedAt: APPLIED_AT,
          ...ids,
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(state.job.status).toBe("applying");
      expect(state.applicationUpserts).toBe(0);
      expect(state.variantLinks).toHaveLength(0);
      expect(state.coverLetterLinks).toHaveLength(0);
    }
  });

  it("allows read-only replay of a historical submitted result", async () => {
    const state = setup();
    state.setStatus("applied");
    state.setApplication({ id: "historical", appliedAt: new Date(APPLIED_AT) });
    const result = await state.service.recordJobResult("u1", "c1", "j1", {
      outcome: "applied",
      appliedAt: APPLIED_AT,
    });
    expect(result.application).toMatchObject({ id: "historical" });
    expect(state.applicationUpserts).toBe(0);
  });

  it("does not link documents when the job was not applied to", async () => {
    const state = setup();
    await state.service.recordJobResult("u1", "c1", "j1", {
      outcome: "skipped",
      skipReason: "Already applied (url)",
    });
    expect(state.variantLinks).toHaveLength(0);
    expect(state.coverLetterLinks).toHaveLength(0);
  });

  it("rejects a different outcome after the job is terminal", async () => {
    const state = setup();
    await state.service.recordJobResult("u1", "c1", "j1", {
      outcome: "failed",
      failReason: "blocked",
    });
    await expect(
      state.service.recordJobResult("u1", "c1", "j1", {
        outcome: "skipped",
        skipReason: "duplicate",
      }),
    ).rejects.toThrow("already finished");
  });

  it("does not allow PATCH to rewrite a historical applied job", async () => {
    const state = setup();
    state.setStatus("applied");
    await expect(
      state.service.patchJob("u1", "c1", "j1", { description: "late edit" }),
    ).rejects.toThrow("Terminal jobs cannot be edited");
  });

  it("retries a failed job only through the explicit retry command", async () => {
    const state = setup();
    await state.service.recordJobResult("u1", "c1", "j1", {
      outcome: "failed",
      failReason: "timeout",
    });
    const retried = await state.service.retryJob("u1", "c1", "j1", {
      retryNotes: "Try after login refresh",
    });
    expect(retried).toMatchObject({
      status: "approved",
      failReason: null,
      retryNotes: "Try after login refresh",
    });
  });

  it("rescans a skipped job only through the explicit rescan command", async () => {
    const state = setup();
    await state.service.recordJobResult("u1", "c1", "j1", {
      outcome: "skipped",
      skipReason: "Old score",
    });
    const rescanned = await state.service.rescanJob("u1", "c1", "j1", {
      decision: "approved",
      matchScore: 88,
      matchReason: "Fresh posting supports the match",
    });
    expect(rescanned).toMatchObject({
      status: "approved",
      matchScore: 88,
      skipReason: null,
    });
  });
});
