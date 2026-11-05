import { preparationStateSchema } from "@jobpilot/contracts/preparation";
import { toInputJson } from "@/common/json";
import { PreparationAnswerHistoryService } from "./answer-history.service";
import { answerHistoryFixture } from "./answer-history-fixture";
import { FIXTURE_FIELDS, simulateFixture } from "./fixture-worker";
import { PreparationService } from "./preparation.service";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const f = answerHistoryFixture();
const { cryptoService, bank, resolver, history, service, otherSession, ready } = f;

class FailingHistory extends PreparationAnswerHistoryService {
  override async capture(...args: Parameters<PreparationAnswerHistoryService["capture"]>) {
    await super.capture(...args);
    throw new Error("Fixture archive storage failed");
  }
}

describe.skipIf(!f.enabled)("encrypted answer-use history on isolated PostgreSQL", () => {
  beforeAll(() => f.setup());
  afterAll(() => f.cleanup());

  test("records encrypted used values atomically and never adds plaintext to normal preparation history", async () => {
    const { preparation, entries } = await ready();
    await expect(history.history(f.owner, f.session, preparation.id)).rejects.toMatchObject({
      status: 409,
    });
    const result = await service.simulate(f.owner, f.session, preparation.id, preparation.revision);
    const saved = await f.db.preparationAnswerUse.findMany({
      where: { preparationId: preparation.id },
    });
    expect(saved).toHaveLength(2);
    expect(JSON.stringify(saved)).not.toContain("PRIVATE original");
    expect(JSON.stringify(result)).not.toContain("PRIVATE original");
    const view = await history.history(f.owner, f.session, preparation.id);
    expect(view).toMatchObject({ historicalOnly: true, canReuse: false, canSubmit: false });
    expect(view.items.map((item) => item.answer)).toEqual(
      entries.map((entry) => entry.definition.answer),
    );
    expect(view.items.every((item) => item.entryVersion === 2)).toBe(true);
    expect(view.items.some((item) => item.questionId === "sponsorship")).toBe(false);
    await service.simulate(f.owner, f.session, preparation.id, preparation.revision);
    expect(
      await f.db.preparationAnswerUse.count({ where: { preparationId: preparation.id } }),
    ).toBe(2);
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(0);
  });

  test("retains the approved used version after source edits, revocation and deletion", async () => {
    const { preparation, entries } = await ready();
    await service.simulate(f.owner, f.session, preparation.id, preparation.revision);
    const original = entries[0];
    if (!original) throw new Error("Missing fixture source");
    const edited = await bank.edit(f.owner, f.session, original.id, original.version, {
      ...original.definition,
      answer: { kind: "text", value: "DIFFERENT edited fixture value" },
    });
    const revoked = await bank.revoke(f.owner, f.session, original.id, edited.version);
    await bank.remove(f.owner, f.session, original.id, revoked.version);
    const view = await history.history(f.owner, f.session, preparation.id);
    expect(view.items.find((item) => item.entryId === original.id)?.answer).toEqual(
      original.definition.answer,
    );
    expect(JSON.stringify(view)).not.toContain("DIFFERENT edited");
    expect(await f.db.answerEntry.findUnique({ where: { id: original.id } })).toBeNull();
  });

  test("archives sensitive answers only with current approval for the exact job", async () => {
    const { preparation } = await ready();
    const field = FIXTURE_FIELDS[2];
    const draft = await bank.create(f.owner, f.session, {
      question: field.label,
      aliases: [],
      intent: field.intent,
      category: "work_eligibility",
      scope: "job",
      scopeKey: preparation.job.url,
      answer: { kind: "boolean", value: false },
    });
    await bank.approve(f.owner, f.session, draft.id, {
      expectedVersion: draft.version,
      reviewDueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const refreshed = await service.review(f.owner, f.session, preparation.id, {
      expectedRevision: preparation.revision,
      approveExceptions: false,
    });
    await service.simulate(f.owner, f.session, refreshed.id, refreshed.revision);
    const captured = (await history.history(f.owner, f.session, refreshed.id)).items.find(
      (item) => item.intent === "sponsorship",
    );
    expect(captured).toMatchObject({
      sensitive: true,
      scope: "job",
      scopeKey: preparation.job.url,
      answer: { kind: "boolean", value: false },
    });
    const otherJob = (await ready()).preparation;
    await service.simulate(f.owner, f.session, otherJob.id, otherJob.revision);
    expect(
      (await history.history(f.owner, f.session, otherJob.id)).items.some(
        (item) => item.intent === "sponsorship",
      ),
    ).toBe(false);
  });

  test("requires current owner browser sessions, rejects terminal credentials and isolates other users", async () => {
    const { preparation } = await ready();
    await service.simulate(f.owner, f.session, preparation.id, preparation.revision);
    await expect(history.history(f.owner, f.terminal, preparation.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(history.history(f.other, otherSession, preparation.id)).rejects.toMatchObject({
      status: 404,
    });
    await f.db.authToken.update({ where: { id: f.session }, data: { revokedAt: new Date() } });
    try {
      await expect(history.history(f.owner, f.session, preparation.id)).rejects.toMatchObject({
        status: 403,
      });
    } finally {
      await f.db.authToken.update({ where: { id: f.session }, data: { revokedAt: null } });
    }
  });

  test("never provisions or uses a cached owner key when the live wrapped key is missing", async () => {
    const { preparation } = await ready();
    await service.simulate(f.owner, f.session, preparation.id, preparation.revision);
    await history.history(f.owner, f.session, preparation.id);
    const owner = await f.db.user.findUniqueOrThrow({
      where: { id: f.owner },
      select: { wrappedDek: true },
    });
    await f.db.user.update({ where: { id: f.owner }, data: { wrappedDek: null } });
    try {
      await expect(history.history(f.owner, f.session, preparation.id)).rejects.toMatchObject({
        status: 409,
      });
      expect((await f.db.user.findUniqueOrThrow({ where: { id: f.owner } })).wrappedDek).toBeNull();
    } finally {
      await f.db.user.update({ where: { id: f.owner }, data: { wrappedDek: owner.wrappedDek } });
    }
  });

  test("enforces immutable archive values and composite owner linkage in the database", async () => {
    const { preparation } = await ready();
    await service.simulate(f.owner, f.session, preparation.id, preparation.revision);
    const row = await f.db.preparationAnswerUse.findFirstOrThrow({
      where: { preparationId: preparation.id },
    });
    await expect(
      Promise.resolve(
        f.db.preparationAnswerUse.update({
          where: { id: row.id },
          data: { payloadCipher: "replacement" },
        }),
      ),
    ).rejects.toThrow("Dry-run history is append-only");
    await expect(
      Promise.resolve(f.db.preparationAnswerUse.delete({ where: { id: row.id } })),
    ).rejects.toThrow("Dry-run history is append-only");
    await expect(
      Promise.resolve(
        f.db.preparationAnswerUse.create({
          data: { ...row, id: crypto.randomUUID(), userId: f.other, questionId: "foreign" },
        }),
      ),
    ).rejects.toThrow();
  });

  test("rolls back simulation, archive values and audit events together on archive failure", async () => {
    const { preparation } = await ready();
    const broken = new PreparationService(f.db, resolver, new FailingHistory(f.db, cryptoService));
    await expect(
      broken.simulate(f.owner, f.session, preparation.id, preparation.revision),
    ).rejects.toThrow("Fixture archive storage failed");
    expect((await service.get(f.owner, f.session, preparation.id)).status).toBe("ready");
    expect(
      await f.db.preparationAnswerUse.count({ where: { preparationId: preparation.id } }),
    ).toBe(0);
    expect(
      await f.db.preparationEvent.count({
        where: { preparationId: preparation.id, kind: "simulated" },
      }),
    ).toBe(0);
  });

  test("does not invent values for older reference-only simulations and removes live archives on account deletion", async () => {
    const { preparation } = await ready();
    const row = await f.db.applicationPreparation.findUniqueOrThrow({
      where: { id: preparation.id },
    });
    const state = preparationStateSchema.parse(row.state);
    const legacy = {
      ...state,
      simulation: simulateFixture(
        state.job.url,
        state.questions.map((question) => ({
          id: question.id,
          required: question.required,
          approved: question.status === "approved",
        })),
      ),
    };
    await f.db.applicationPreparation.update({
      where: { id: row.id },
      data: {
        status: "simulated",
        simulatedAt: new Date(),
        revision: row.revision + 1,
        state: toInputJson(legacy),
        events: {
          create: {
            userId: f.owner,
            revision: row.revision + 1,
            kind: "simulated",
            snapshot: toInputJson(legacy),
          },
        },
      },
    });
    expect((await history.history(f.owner, f.session, preparation.id)).items).toEqual([]);
    expect(await f.db.preparationAnswerUse.count({ where: { userId: f.owner } })).toBeGreaterThan(
      0,
    );
    await f.db.user.delete({ where: { id: f.owner } });
    expect(await f.db.preparationAnswerUse.count({ where: { userId: f.owner } })).toBe(0);
  });
});
