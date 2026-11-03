import { ingestionBatchSchema } from "./ingestion";
import { describe, expect, it } from "bun:test";

const job = {
  sourceId: "fixture",
  title: "Program Manager",
  company: "Fixture",
  location: "US",
  url: "https://example.test/job",
  description: "Synthetic discovery",
  salary: null,
};
const batch = { schemaVersion: 1, runId: crypto.randomUUID(), jobs: [job] };

describe("versioned discovery contract", () => {
  it("accepts explicit unknown salaries and preserves comparable units without guessing", () => {
    expect(ingestionBatchSchema.parse(batch).jobs[0]?.salary).toBeNull();
    expect(
      ingestionBatchSchema.parse({
        ...batch,
        jobs: [
          {
            ...job,
            salary: {
              minimum: 40,
              maximum: 60,
              currency: "USD",
              period: "hour",
            },
          },
        ],
      }).jobs[0]?.salary?.period,
    ).toBe("hour");
  });
  it("rejects empty, oversized, duplicate, credential-bearing, and unversioned batches", () => {
    for (const value of [
      { ...batch, jobs: [] },
      { ...batch, jobs: Array(26).fill(job) },
      { ...batch, jobs: [job, job] },
      { ...batch, schemaVersion: undefined },
      { ...batch, jobs: [{ ...job, url: "http://example.test/job" }] },
      { ...batch, jobs: [{ ...job, url: "not a URL" }] },
      { ...batch, jobs: [{ ...job, url: "https://example.test/job#token" }] },
      { ...batch, jobs: [{ ...job, credentials: {} }] },
      {
        ...batch,
        jobs: [{ ...job, salary: { minimum: 90, maximum: 80, currency: "USD", period: "year" } }],
      },
    ])
      expect(ingestionBatchSchema.safeParse(value).success).toBe(false);
  });
});
