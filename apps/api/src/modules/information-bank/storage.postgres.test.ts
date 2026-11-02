import { bankDatabaseFixture, ordinaryDraft, reviewDate } from "./postgres-fixture";
import { encodeEntry, readEntry } from "./protection";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const f = bankDatabaseFixture();
describe.skipIf(!f.enabled)("Information Bank protected persistence", () => {
  beforeAll(f.setup);
  afterAll(f.cleanup);
  it("encrypts questions, values, and version history without storing a plaintext search index", async () => {
    const definition = ordinaryDraft();
    const created = await f.bank.create(f.owner, f.session, definition);
    const row = await f.db.answerEntry.findUniqueOrThrow({ where: { id: created.id } });
    const event = await f.db.answerEntryEvent.findFirstOrThrow({ where: { entryId: created.id } });
    for (const data of [row, event]) {
      expect(JSON.stringify(data)).not.toContain(definition.question);
      expect(JSON.stringify(data)).not.toContain("bank-private-fixture@example.test");
    }
    expect(created).toMatchObject({ status: "draft", version: 1, ready: false, definition });
    expect(JSON.stringify(created)).not.toContain("keyCipher");
    expect(JSON.stringify(created)).not.toContain("payloadCipher");
    expect(
      (await f.db.user.findUniqueOrThrow({ where: { id: f.owner } })).wrappedDek,
    ).not.toBeNull();
  });
  it("versions edits and preserves the prior approved value", async () => {
    const created = await f.bank.create(f.owner, f.session, ordinaryDraft());
    await f.bank.approve(f.owner, f.session, created.id, {
      expectedVersion: 1,
      reviewDueAt: reviewDate(),
    });
    const edited = await f.bank.edit(f.owner, f.session, created.id, 2, {
      ...created.definition,
      answer: { kind: "text", value: "new-fixture@example.test" },
    });
    expect(edited).toMatchObject({
      version: 3,
      status: "draft",
      approvedAt: null,
      reviewDueAt: null,
      ready: false,
    });
    const history = await f.bank.history(f.owner, f.session, created.id, { page: 1, limit: 10 });
    expect(history.items.find((event) => event.version === 2)?.definition?.answer).toEqual({
      kind: "text",
      value: "bank-private-fixture@example.test",
    });
    expect(history.items.find((event) => event.version === 3)?.definition?.answer).toEqual({
      kind: "text",
      value: "new-fixture@example.test",
    });
  });
  it("allows one competing edit and rolls back if the audit cannot be written", async () => {
    const created = await f.bank.create(f.owner, f.session, ordinaryDraft());
    const edits = await Promise.allSettled(
      ["first", "second"].map((value) =>
        f.bank.edit(f.owner, f.session, created.id, 1, {
          ...created.definition,
          answer: { kind: "text", value },
        }),
      ),
    );
    expect(edits.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await f.db.answerEntryEvent.count({ where: { entryId: created.id } })).toBe(2);
    const row = await f.db.answerEntry.findUniqueOrThrow({ where: { id: created.id } });
    const { key, envelope } = await readEntry(row, f.cryptoService);
    await f.db.answerEntryEvent.create({
      data: {
        userId: f.owner,
        entryId: row.id,
        version: 3,
        action: "edited",
        actorTokenId: f.session,
        payloadCipher: encodeEntry({ ...envelope, version: 3 }, key, true),
      },
    });
    await expect(
      f.bank.edit(f.owner, f.session, row.id, 2, {
        ...created.definition,
        answer: { kind: "text", value: "must roll back" },
      }),
    ).rejects.toBeDefined();
    expect((await f.db.answerEntry.findUniqueOrThrow({ where: { id: row.id } })).version).toBe(2);
  });
  it("rejects ciphertext moved between entries or between storage contexts", async () => {
    const a = await f.bank.create(f.owner, f.session, ordinaryDraft());
    const b = await f.bank.create(f.owner, f.session, ordinaryDraft());
    const original = await f.db.answerEntry.findUniqueOrThrow({ where: { id: a.id } });
    const donor = await f.db.answerEntry.findUniqueOrThrow({ where: { id: b.id } });
    await f.db.answerEntry.update({
      where: { id: a.id },
      data: { keyCipher: donor.keyCipher, payloadCipher: donor.payloadCipher },
    });
    await expect(f.bank.get(f.owner, f.session, a.id)).rejects.toThrow("integrity");
    const audit = await f.db.answerEntryEvent.findFirstOrThrow({ where: { entryId: a.id } });
    await f.db.answerEntry.update({
      where: { id: a.id },
      data: { keyCipher: original.keyCipher, payloadCipher: audit.payloadCipher! },
    });
    await expect(f.bank.get(f.owner, f.session, a.id)).rejects.toThrow("integrity");
    await f.db.answerEntry.update({
      where: { id: a.id },
      data: { payloadCipher: original.payloadCipher },
    });
  });
  it("deletes the live key while retaining immutable audit metadata with unreadable values", async () => {
    const created = await f.bank.create(f.owner, f.session, ordinaryDraft());
    await f.bank.remove(f.owner, f.session, created.id, 1);
    expect(await f.db.answerEntry.findUnique({ where: { id: created.id } })).toBeNull();
    const history = await f.bank.history(f.owner, f.session, created.id, { page: 1, limit: 10 });
    expect(history.items).toHaveLength(2);
    expect(history.items.every((event) => event.definition === null)).toBe(true);
    const event = await f.db.answerEntryEvent.findFirstOrThrow({ where: { entryId: created.id } });
    await expect(
      Promise.resolve(f.db.answerEntryEvent.delete({ where: { id: event.id } })),
    ).rejects.toBeDefined();
    await expect(
      Promise.resolve(
        f.db.answerEntryEvent.update({ where: { id: event.id }, data: { action: "revoked" } }),
      ),
    ).rejects.toBeDefined();
  });
  it("searches and paginates question words in SQL without indexing answer values", async () => {
    const definition = ordinaryDraft();
    definition.question = `UniqueMarker${crypto.randomUUID().replaceAll("-", "")} question`;
    const created = await f.bank.create(f.owner, f.session, definition);
    const result = await f.bank.list(f.owner, f.session, {
      page: 1,
      limit: 1,
      query: definition.question.split(" ")[0],
    });
    expect(result.pagination.total).toBe(1);
    expect(result.items[0]?.id).toBe(created.id);
    expect(
      (await f.bank.list(f.owner, f.session, { page: 1, limit: 10, query: "bank-private-fixture" }))
        .items,
    ).toHaveLength(0);
  });
});
