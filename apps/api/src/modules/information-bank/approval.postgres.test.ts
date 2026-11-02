import { bankEntryDefinitionSchema } from "@jobpilot/contracts/information-bank";
import { bankDatabaseFixture, ordinaryDraft, reviewDate } from "./postgres-fixture";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const f = bankDatabaseFixture();
const jobUrl = "https://jobs.example.test/synthetic";
const context = (question: string) => ({
  question,
  intent: "contact" as const,
  kind: "text" as const,
  options: [],
  role: "Program Manager",
  company: "fixture.example.test",
  jobUrl,
  verified: true,
});
describe.skipIf(!f.enabled)("Information Bank approval and resolution", () => {
  beforeAll(f.setup);
  afterAll(f.cleanup);
  it("denies terminal, expired, and foreign sessions for reads and approval", async () => {
    const entry = await f.bank.create(f.owner, f.session, ordinaryDraft());
    for (const token of [f.terminal, f.expired, f.otherSession]) {
      await expect(f.bank.get(f.owner, token, entry.id)).rejects.toMatchObject({ status: 403 });
      await expect(
        f.bank.approve(f.owner, token, entry.id, { expectedVersion: 1, reviewDueAt: reviewDate() }),
      ).rejects.toMatchObject({ status: 403 });
    }
    await expect(f.bank.get(f.other, f.otherSession, entry.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(
      (await f.bank.history(f.other, f.otherSession, entry.id, { page: 1, limit: 10 })).items,
    ).toHaveLength(0);
  });
  it("resolves an approved alias to a reference without leaking the answer", async () => {
    const definition = ordinaryDraft();
    definition.aliases = [`Equivalent contact wording ${crypto.randomUUID()}`];
    const entry = await f.bank.create(f.owner, f.session, definition);
    expect((await f.resolver.resolve(f.owner, context(definition.aliases[0]!))).decision).toBe(
      "review",
    );
    await f.bank.approve(f.owner, f.session, entry.id, {
      expectedVersion: 1,
      reviewDueAt: reviewDate(),
    });
    const result = await f.resolver.resolve(f.owner, context(definition.aliases[0]!));
    expect(result).toMatchObject({ decision: "reuse", entryId: entry.id, entryVersion: 2 });
    expect(JSON.stringify(result)).not.toContain("bank-private-fixture@example.test");
    await f.bank.revoke(f.owner, f.session, entry.id, 2);
    expect((await f.resolver.resolve(f.owner, context(definition.aliases[0]!))).decision).toBe(
      "review",
    );
  });
  it("requires exact job scope and a short current review interval for sensitive answers", async () => {
    const draft = bankEntryDefinitionSchema.parse({
      question: "Do you require sponsorship?",
      intent: "sponsorship",
      category: "work_eligibility",
      scope: "global",
      scopeKey: null,
      answer: { kind: "boolean", value: false },
    });
    const entry = await f.bank.create(f.owner, f.session, draft);
    await expect(
      f.bank.approve(f.owner, f.session, entry.id, {
        expectedVersion: 1,
        reviewDueAt: reviewDate(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await f.bank.edit(f.owner, f.session, entry.id, 1, {
      ...draft,
      scope: "job",
      scopeKey: jobUrl,
    });
    await expect(
      f.bank.approve(f.owner, f.session, entry.id, {
        expectedVersion: 2,
        reviewDueAt: new Date(Date.now() + 8 * 86_400_000).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await f.bank.approve(f.owner, f.session, entry.id, {
      expectedVersion: 2,
      reviewDueAt: reviewDate(),
    });
    const field = {
      ...context(draft.question),
      intent: "sponsorship" as const,
      kind: "boolean" as const,
    };
    expect((await f.resolver.resolve(f.owner, field)).decision).toBe("reuse");
    expect(
      (await f.resolver.resolve(f.owner, { ...field, jobUrl: "https://jobs.example.test/other" }))
        .decision,
    ).toBe("review");
    expect((await f.resolver.resolve(f.other, field)).decision).toBe("review");
    expect(
      (await f.resolver.resolve(f.owner, { ...field, intent: "work_authorization" })).decision,
    ).toBe("review");
  });
  it("rejects past or excessive review intervals and stale approval versions", async () => {
    const entry = await f.bank.create(f.owner, f.session, ordinaryDraft());
    for (const due of [new Date(Date.now() - 1000), new Date(Date.now() + 91 * 86_400_000)])
      await expect(
        f.bank.approve(f.owner, f.session, entry.id, {
          expectedVersion: 1,
          reviewDueAt: due.toISOString(),
        }),
      ).rejects.toMatchObject({ status: 400 });
    await f.bank.approve(f.owner, f.session, entry.id, {
      expectedVersion: 1,
      reviewDueAt: reviewDate(),
    });
    await expect(
      f.bank.approve(f.owner, f.session, entry.id, {
        expectedVersion: 1,
        reviewDueAt: reviewDate(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("preserves an explicitly approved EEO opt-out choice only for the reviewed options", async () => {
    const draft = bankEntryDefinitionSchema.parse({
      question: "Voluntary EEO response",
      intent: "eeo",
      category: "other",
      scope: "job",
      scopeKey: jobUrl,
      answer: {
        kind: "choice",
        options: ["Respond", "Prefer not to answer"],
        value: "Prefer not to answer",
      },
    });
    const entry = await f.bank.create(f.owner, f.session, draft);
    await f.bank.approve(f.owner, f.session, entry.id, {
      expectedVersion: 1,
      reviewDueAt: reviewDate(),
    });
    const field = {
      ...context(draft.question),
      intent: "eeo" as const,
      kind: "choice" as const,
      options: ["Respond", "Prefer not to answer"],
    };
    expect((await f.resolver.resolve(f.owner, field)).decision).toBe("reuse");
    expect((await f.resolver.resolve(f.owner, { ...field, options: ["Respond"] })).decision).toBe(
      "review",
    );
  });
});
