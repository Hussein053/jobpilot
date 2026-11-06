import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { CryptoService } from "@/common/crypto/crypto.service";
import { previewFixture } from "@/modules/auto-apply/preview/preview-fixture";
import { AnswerResolutionService } from "@/modules/information-bank/answer-resolution.service";
import { InformationBankService } from "@/modules/information-bank/information-bank.service";
import { PreparationAnswerHistoryService } from "./answer-history.service";
import { FIXTURE_FIELDS } from "./fixture-worker";
import { PreparationService } from "./preparation.service";

export function answerHistoryFixture() {
  const f = previewFixture();
  const cryptoService = new CryptoService(f.db);
  const bank = new InformationBankService(f.db, cryptoService);
  const resolver = new AnswerResolutionService(f.db, cryptoService);
  const history = new PreparationAnswerHistoryService(f.db, cryptoService);
  const service = new PreparationService(f.db, resolver, history);
  const otherSession = crypto.randomUUID();
  async function ready() {
    const url = `https://jobs.example.invalid/${crypto.randomUUID()}`;
    const run = await f.run(1, { url });
    const entries = [];
    for (const field of FIXTURE_FIELDS.filter((item) => item.required)) {
      const draft = await bank.create(f.owner, f.session, {
        question: field.label,
        aliases: [],
        intent: field.intent,
        category: "other",
        scope: "job",
        scopeKey: url,
        answer: { kind: "text", value: `PRIVATE original ${field.id} ${crypto.randomUUID()}` },
      });
      entries.push(
        await bank.approve(f.owner, f.session, draft.id, {
          expectedVersion: draft.version,
          reviewDueAt: new Date(Date.now() + 86400000).toISOString(),
        }),
      );
    }
    const preparation = await service.create(f.owner, f.session, {
      requestId: crypto.randomUUID(),
      ingestionRunId: run.id,
      sourceId: ingestionBatchSchema.parse(run.batch).jobs[0]?.sourceId ?? "",
    });
    const reviewed = await service.review(f.owner, f.session, preparation.id, {
      expectedRevision: preparation.revision,
      approveExceptions: true,
    });
    return { preparation: reviewed, entries };
  }

  return {
    ...f,
    cryptoService,
    bank,
    resolver,
    history,
    service,
    otherSession,
    ready,
    async setup(cap = 50) {
      await f.setup(cap);
      await f.db.authToken.create({
        data: {
          id: otherSession,
          userId: f.other,
          kind: "session",
          expiresAt: new Date(Date.now() + 3600000),
          tokenHash: crypto.randomUUID(),
        },
      });
    },
  };
}
