import { APPLIED_AT, setup } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("CampaignJobService queued rows", () => {
  it("promotes a scored pasted link from queued to pending", async () => {
    const state = setup();
    state.setStatus("queued");
    const patched = await state.service.patchJob("u1", "c1", "j1", {
      status: "pending",
      title: "Staff Engineer",
      company: "Acme",
    });
    expect(patched).toMatchObject({ status: "pending", title: "Staff Engineer", company: "Acme" });
  });

  it("refuses to skip the score pass by approving a queued row outright", async () => {
    const state = setup();
    state.setStatus("queued");
    await expect(state.service.patchJob("u1", "c1", "j1", { status: "approved" })).rejects.toThrow(
      "cannot transition from queued to approved",
    );
  });
});

describe("CampaignJobService dry-run execution boundary", () => {
  it("blocks campaign PATCH and Pilot claim even for an otherwise approved job", async () => {
    const state = setup();
    state.setStatus("approved");
    await expect(
      state.service.patchJob("u1", "c1", "j1", { status: "applying" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(state.startApplying()).rejects.toMatchObject({ status: 403 });
    expect(state.job.status).toBe("approved");
  });

  it("blocks an agent creating a job already marked applying", async () => {
    const state = setup();
    await expect(
      state.service.addJob("u1", "c1", {
        key: "j2",
        title: "Engineer",
        company: "Acme",
        url: "https://example.test/jobs/2",
        status: "applying",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("duplicate refusal remains independent of execution authorization", () => {
  it("records a detected duplicate as skipped without starting an application", async () => {
    const state = setup();
    state.setStatus("approved");
    state.setApplication({
      id: "existing",
      url: state.job.url,
      title: state.job.title,
      company: state.job.company,
      appliedAt: new Date(APPLIED_AT),
      status: "applied",
    });
    await expect(state.checkDuplicate()).rejects.toThrow("recorded as skipped");
    expect(state.job).toMatchObject({ status: "skipped", skipReason: "Already applied (url)" });
    expect(state.applicationUpserts).toBe(0);
    await expect(state.startApplying()).rejects.toMatchObject({ status: 403 });
  });
});
