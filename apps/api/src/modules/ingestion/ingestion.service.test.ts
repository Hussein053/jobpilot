import { ingestionFixture } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("signed discovery ingestion", () => {
  it("stores a signed batch with no execution capability or applied outcome", async () => {
    const f = ingestionFixture();
    const receipt = await f.service.ingest(f.request());
    expect(receipt).toMatchObject({
      duplicate: false,
      disposition: "stored_only",
      runtime: {
        submissionMode: "DRY_RUN",
        liveSubmissionsEnabled: false,
        unrestrictedAgentsEnabled: false,
      },
    });
    expect(f.rows.size).toBe(1);
    expect([...f.rows.values()][0]?.batch).toEqual(f.batch);
  });

  it("returns one receipt under concurrent retries and rejects changed content with the same run ID", async () => {
    const f = ingestionFixture();
    const receipts = await Promise.all(
      Array.from({ length: 8 }, () => f.service.ingest(f.request())),
    );
    expect(new Set(receipts.map((r) => r.id)).size).toBe(1);
    expect(receipts.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(f.rows.size).toBe(1);
    await expect(
      f.service.ingest(f.request({ ...f.batch, jobs: [{ ...f.batch.jobs[0], title: "Changed" }] })),
    ).rejects.toMatchObject({ status: 409 });
  });

  for (const [name, overrides] of [
    ["missing signature", { "x-jobpilot-signature": "" }],
    ["invalid signature", { "x-jobpilot-signature": `${"A".repeat(86)}==` }],
    ["unknown integration", { "x-jobpilot-integration": crypto.randomUUID() }],
    ["expired timestamp", { "x-jobpilot-timestamp": String(Math.floor(Date.now() / 1000) - 301) }],
    ["future timestamp", { "x-jobpilot-timestamp": String(Math.floor(Date.now() / 1000) + 301) }],
    ["malformed timestamp", { "x-jobpilot-timestamp": "NaN" }],
  ] as const)
    it(`fails closed for ${name}`, async () => {
      const f = ingestionFixture();
      await expect(f.service.ingest(f.request(f.batch, overrides))).rejects.toMatchObject({
        status: 401,
      });
      expect(f.rows.size).toBe(0);
    });

  for (const state of ["inactive", "unverifiable"] as const)
    it(`denies an ${state} integration`, async () => {
      const f = ingestionFixture();
      if (state === "inactive") f.integration.active = false;
      else f.integration.publicKeyPem = "unverifiable";
      await expect(f.service.ingest(f.request())).rejects.toMatchObject({ status: 401 });
      expect(f.rows.size).toBe(0);
    });

  it("binds the signature to exact bytes and to the integration identity", async () => {
    const f = ingestionFixture();
    const original = f.request();
    const tampered = new Request(original.url, {
      method: "POST",
      headers: original.headers,
      body: `${await original.text()} `,
    });
    await expect(f.service.ingest(tampered)).rejects.toMatchObject({ status: 401 });
    const signed = f.request();
    f.integration.id = crypto.randomUUID();
    signed.headers.set("x-jobpilot-integration", f.integration.id);
    await expect(f.service.ingest(signed)).rejects.toMatchObject({ status: 401 });
    expect(f.rows.size).toBe(0);
  });

  it("rejects invalid schema, owner overrides, submission flags, and embedded applicant data", async () => {
    const f = ingestionFixture();
    for (const input of [
      { ...f.batch, schemaVersion: 2 },
      { ...f.batch, userId: crypto.randomUUID() },
      { ...f.batch, submit: true },
      { ...f.batch, resume: "private content" },
      { ...f.batch, jobs: [{ ...f.batch.jobs[0], apiKey: "synthetic-forbidden-field" }] },
      { ...f.batch, jobs: [{ ...f.batch.jobs[0], url: "https://user:pass@example.test" }] },
      { ...f.batch, jobs: [{ ...f.batch.jobs[0], url: "not a URL" }] },
    ])
      await expect(f.service.ingest(f.request(input))).rejects.toMatchObject({ status: 422 });
    expect(f.rows.size).toBe(0);
  });

  it("enforces the byte limit even for a streamed request without content-length", async () => {
    const f = ingestionFixture();
    const signed = f.request();
    const request = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(40_000));
          controller.enqueue(new Uint8Array(40_000));
          controller.close();
        },
      }),
    });
    await expect(f.service.ingest(request)).rejects.toMatchObject({ status: 400 });
    expect(f.rows.size).toBe(0);
  });

  it("rejects malformed JSON, compression, and unsupported content types", async () => {
    const f = ingestionFixture();
    for (const request of [
      f.request("{"),
      f.request(f.batch, { "content-type": "text/plain" }),
      f.request(f.batch, { "content-encoding": "gzip" }),
    ]) {
      await expect(f.service.ingest(request)).rejects.toMatchObject({ status: 400 });
    }
  });

  it("requires a fresh signature for retries and denies revoked integrations even for existing runs", async () => {
    const f = ingestionFixture();
    await f.service.ingest(f.request());
    f.integration.active = false;
    await expect(f.service.ingest(f.request())).rejects.toMatchObject({ status: 401 });
    expect(f.rows.size).toBe(1);
  });

  it("limits historical batch reads to the owner inferred from the trusted integration", async () => {
    const f = ingestionFixture();
    await f.service.ingest(f.request());
    const owner = await f.service.history(f.integration.userId, { page: 1, limit: 10 });
    const other = await f.service.history(crypto.randomUUID(), { page: 1, limit: 10 });
    expect(owner.items).toHaveLength(1);
    expect(other.items).toHaveLength(0);
    expect(other.pagination.total).toBe(0);
  });
});
