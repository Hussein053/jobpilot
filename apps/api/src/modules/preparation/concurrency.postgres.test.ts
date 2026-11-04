import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { CryptoService } from "@/common/crypto/crypto.service";
import { previewFixture } from "@/modules/auto-apply/preview/preview-fixture";
import { AnswerResolutionService } from "@/modules/information-bank/answer-resolution.service";
import { InformationBankService } from "@/modules/information-bank/information-bank.service";
import { FIXTURE_FIELDS } from "./fixture-worker";
import { PreparationService } from "./preparation.service";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const f = previewFixture();
const cryptoService = new CryptoService(f.db);
const bank = new InformationBankService(f.db, cryptoService);
const service = new PreparationService(f.db, new AnswerResolutionService(f.db, cryptoService));

async function waitForBlocked(holdingPid: number, count: number) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const rows = await f.db.$queryRaw<{ count: bigint }[]>`WITH RECURSIVE blocked(pid) AS (
      SELECT pid FROM pg_stat_activity
      WHERE ${holdingPid}::integer = ANY(pg_blocking_pids(pid))
      UNION
      SELECT activity.pid FROM pg_stat_activity activity
      JOIN blocked ON blocked.pid = ANY(pg_blocking_pids(activity.pid))
    ) SELECT count(*) AS count FROM blocked`;
    if (Number(rows[0]?.count) >= count) return;
    await Bun.sleep(10);
  }
  throw new Error("Expected concurrent fixture operations to wait on the shared account lock");
}

describe.skipIf(!f.enabled)("preparation approval serialization", () => {
  beforeAll(() => f.setup());
  afterAll(() => f.cleanup());

  test("a queued job-specific approval invalidates an older global-answer preparation", async () => {
    const url = `https://jobs.example.invalid/${crypto.randomUUID()}`;
    const run = await f.run(1, { url });
    const due = new Date(Date.now() + 86400000).toISOString();
    for (const field of FIXTURE_FIELDS.filter((item) => item.required)) {
      const entry = await bank.create(f.owner, f.session, {
        question: field.label,
        aliases: [],
        intent: field.intent,
        category: "other",
        scope: "global",
        scopeKey: null,
        answer: { kind: "text", value: "Synthetic fixture answer" },
      });
      await bank.approve(f.owner, f.session, entry.id, {
        expectedVersion: entry.version,
        reviewDueAt: due,
      });
    }
    const draft = await service.create(f.owner, f.session, {
      requestId: crypto.randomUUID(),
      ingestionRunId: run.id,
      sourceId: ingestionBatchSchema.parse(run.batch).jobs[0]?.sourceId ?? "",
    });
    const ready = await service.review(f.owner, f.session, draft.id, {
      expectedRevision: draft.revision,
      approveExceptions: true,
    });
    const override = await bank.create(f.owner, f.session, {
      question: FIXTURE_FIELDS[0].label,
      aliases: [],
      intent: "contact",
      category: "identity",
      scope: "job",
      scopeKey: url,
      answer: { kind: "text", value: "job-specific-synthetic@example.invalid" },
    });

    const locked = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const holder = f.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${f.owner} FOR UPDATE`;
        const rows = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        locked.resolve(rows[0]?.pid ?? -1);
        await release.promise;
      },
      { timeout: 15000 },
    );
    const pid = await locked.promise;
    const approval = bank.approve(f.owner, f.session, override.id, {
      expectedVersion: override.version,
      reviewDueAt: due,
    });
    let simulation: Promise<unknown> | undefined;
    try {
      await waitForBlocked(pid, 1);
      // PostgreSQL queues row-lock waiters: approval must commit before simulation can inspect answers.
      simulation = service.simulate(f.owner, f.session, ready.id, ready.revision);
      await waitForBlocked(pid, 2);
    } finally {
      release.resolve();
      await holder;
    }
    await approval;
    if (!simulation) throw new Error("Simulation was not started");
    await expect(simulation).rejects.toMatchObject({ status: 409 });
    expect((await service.get(f.owner, f.session, ready.id)).status).toBe("ready");
    expect(await f.db.application.count({ where: { userId: f.owner } })).toBe(0);
    expect(
      await f.db.applicationPreparation.count({ where: { userId: f.owner, status: "simulated" } }),
    ).toBe(0);
  }, 15000);
});
