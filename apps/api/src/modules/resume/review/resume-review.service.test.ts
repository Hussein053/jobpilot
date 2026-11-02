import { reviewFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("explicit resume review", () => {
  it("approves the exact saved version and records its review revision", async () => {
    const f = reviewFixture();
    const result = await f.service.review(f.owner, f.token, f.row.id, {
      action: "approve",
      expectedVersion: 1,
      expectedReviewRevision: 0,
    });
    expect(result).toMatchObject({
      active: true,
      version: 1,
      approvedVersion: 1,
      reviewRevision: 1,
    });
    expect(f.events).toHaveLength(1);
    expect(f.events[0]).toMatchObject({
      action: "approve",
      actorTokenId: f.token,
      resumeVersion: 1,
    });
  });

  it("rejects terminal, expired, revoked, missing, or foreign session authorization", async () => {
    const f = reviewFixture();
    f.denySession();
    await expect(
      f.service.review(f.owner, f.token, f.row.id, {
        action: "approve",
        expectedVersion: 1,
        expectedReviewRevision: 0,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.row.approvedAt).toBeNull();
    expect(f.events).toHaveLength(0);
  });

  it("returns 404 for a foreign resume without exposing approval state", async () => {
    const f = reviewFixture();
    await expect(
      f.service.review(f.owner, f.token, crypto.randomUUID(), {
        action: "approve",
        expectedVersion: 1,
        expectedReviewRevision: 0,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.events).toHaveLength(0);
  });

  it("denies stale content and stale review revisions", async () => {
    const f = reviewFixture();
    for (const input of [
      { expectedVersion: 2, expectedReviewRevision: 0 },
      { expectedVersion: 1, expectedReviewRevision: 1 },
    ]) {
      await expect(
        f.service.review(f.owner, f.token, f.row.id, { action: "approve", ...input }),
      ).rejects.toMatchObject({ status: 409, code: "STALE_WRITE" });
    }
    expect(f.events).toHaveLength(0);
  });

  it("does not approve inactive or empty resumes", async () => {
    const f = reviewFixture();
    f.row.active = false;
    await expect(
      f.service.review(f.owner, f.token, f.row.id, {
        action: "approve",
        expectedVersion: 1,
        expectedReviewRevision: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
    f.row.active = true;
    f.row.sourceFilename = null;
    f.row.content = null;
    await expect(
      f.service.review(f.owner, f.token, f.row.id, {
        action: "approve",
        expectedVersion: 1,
        expectedReviewRevision: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
    f.row.sourceFilename = `missing-${crypto.randomUUID()}.pdf`;
    await expect(
      f.service.review(f.owner, f.token, f.row.id, {
        action: "approve",
        expectedVersion: 1,
        expectedReviewRevision: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("deactivation revokes approval and reactivation requires a fresh review", async () => {
    const f = reviewFixture();
    for (const [revision, action] of [
      [0, "approve"],
      [1, "deactivate"],
      [2, "activate"],
    ] as const) {
      await f.service.review(f.owner, f.token, f.row.id, {
        action,
        expectedVersion: 1,
        expectedReviewRevision: revision,
      });
    }
    expect(f.row).toMatchObject({
      active: true,
      approvedAt: null,
      approvedVersion: null,
      reviewRevision: 3,
    });
    expect(f.events).toHaveLength(3);
  });

  it("allows only one competing decision at a review revision", async () => {
    const f = reviewFixture();
    const results = await Promise.allSettled(
      ["approve", "deactivate"].map((action) =>
        f.service.review(f.owner, f.token, f.row.id, {
          action: action as "approve" | "deactivate",
          expectedVersion: 1,
          expectedReviewRevision: 0,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.events).toHaveLength(1);
  });

  it("filters history by owner and preserves history independently of a resume row", async () => {
    const f = reviewFixture();
    await f.service.review(f.owner, f.token, f.row.id, {
      action: "approve",
      expectedVersion: 1,
      expectedReviewRevision: 0,
    });
    expect((await f.service.history(f.owner, f.row.id, { page: 1, limit: 10 })).items).toHaveLength(
      1,
    );
    expect(
      (await f.service.history(crypto.randomUUID(), f.row.id, { page: 1, limit: 10 })).items,
    ).toHaveLength(0);
  });
});
