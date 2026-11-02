import { bankEntryDefinitionSchema } from "@jobpilot/contracts/information-bank";
import { PrismaPg } from "@prisma/adapter-pg";
import { CryptoService } from "@/common/crypto/crypto.service";
import { PrismaClient } from "@/generated/prisma/client";
import { AnswerResolutionService } from "./answer-resolution.service";
import { InformationBankService } from "./information-bank.service";
import { InformationBankImportService } from "./information-bank-import.service";

export function bankDatabaseFixture() {
  const connection = process.env.JOBPILOT_TEST_DATABASE_URL;
  if (connection) {
    const url = new URL(connection);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/jobpilot_settings_test")
      throw new Error("Bank tests require the dedicated loopback database.");
  }
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: connection ?? "postgresql://unused" }),
  });
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const session = crypto.randomUUID();
  const otherSession = crypto.randomUUID();
  const terminal = crypto.randomUUID();
  const expired = crypto.randomUUID();
  const cryptoService = new CryptoService(db);
  const bank = new InformationBankService(db, cryptoService);
  return {
    enabled: !!connection,
    db,
    owner,
    other,
    session,
    otherSession,
    terminal,
    expired,
    cryptoService,
    bank,
    resolver: new AnswerResolutionService(db, cryptoService),
    importer: new InformationBankImportService(db, bank),
    async setup() {
      for (const id of [owner, other])
        await db.user.create({ data: { id, email: `${id}@fixture.test`, username: id } });
      for (const [id, userId, kind, expiresAt] of [
        [session, owner, "session", new Date(Date.now() + 3_600_000)],
        [otherSession, other, "session", new Date(Date.now() + 3_600_000)],
        [terminal, owner, "terminal", null],
        [expired, owner, "session", new Date(Date.now() - 1000)],
      ] as const) {
        await db.authToken.create({
          data: { id, userId, kind, expiresAt, tokenHash: crypto.randomUUID() },
        });
      }
    },
    async cleanup() {
      await db.user.deleteMany({ where: { id: { in: [owner, other] } } });
      await db.$disconnect();
    },
  };
}
export const ordinaryDraft = () =>
  bankEntryDefinitionSchema.parse({
    question: `What is your contact email for ${crypto.randomUUID()}?`,
    aliases: [],
    intent: "contact",
    category: "identity",
    scope: "global",
    scopeKey: null,
    answer: { kind: "text", value: "bank-private-fixture@example.test" },
  });
export const reviewDate = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
