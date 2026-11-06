import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { freezeDiscoveryBatches } from "./batches";
import { mapJSearch } from "./jsearch";
import { describe, expect, test } from "bun:test";

const plan = {
  slotId: "5e709017-401e-4474-a930-45ec391e1820",
  roleId: "5c9cba38-88d7-4bec-a97f-eaf790349122",
  cursor: null,
};
const jobs = (count: number, description = "Fixture") =>
  mapJSearch({
    status: "OK",
    data: {
      jobs: Array.from({ length: count }, (_, index) => ({
        job_id: `job-${index}`,
        job_title: "Project Manager",
        employer_name: "Fixture Employer",
        job_apply_link: `https://jobs.example.test/Case/${index}`,
        job_description: description,
      })),
    },
  }).jobs;

describe("frozen discovery batches", () => {
  test("splits at 25 jobs and produces stable IDs and exact replay bytes", () => {
    const input = jobs(26);
    const frozen = freezeDiscoveryBatches(plan, input);
    expect(frozen).toHaveLength(2);
    expect(ingestionBatchSchema.parse(JSON.parse(frozen[0]!.body)).jobs).toHaveLength(25);
    expect(ingestionBatchSchema.parse(JSON.parse(frozen[1]!.body)).jobs).toHaveLength(1);
    expect(freezeDiscoveryBatches(plan, input.toReversed())).toEqual(frozen);
    expect(freezeDiscoveryBatches(plan, input)).toEqual(frozen);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen[0])).toBe(true);
  });
  test("limits serialized UTF-8 bytes independently of character and job counts", () => {
    const input = jobs(8, "界".repeat(8000));
    const batches = freezeDiscoveryBatches(plan, input);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((batch) => JSON.parse(batch.body).jobs)).toHaveLength(8);
    for (const batch of batches) {
      expect(Buffer.byteLength(batch.body, "utf8")).toBeLessThanOrEqual(65_536);
      expect(ingestionBatchSchema.safeParse(JSON.parse(batch.body)).success).toBe(true);
    }
  });
  test("changes identity for another slot, role, or provider cursor", () => {
    const input = jobs(1);
    const first = freezeDiscoveryBatches(plan, input)[0]!;
    for (const next of [
      { ...plan, slotId: crypto.randomUUID() },
      { ...plan, roleId: crypto.randomUUID() },
      { ...plan, cursor: "page-2" },
    ])
      expect(freezeDiscoveryBatches(next, input)[0]?.runId).not.toBe(first.runId);
  });
  test("does not change run identity to evade a changed-body replay conflict", () => {
    const input = jobs(1);
    const first = freezeDiscoveryBatches(plan, input)[0]!;
    input[0]!.description = "Changed provider data must not silently replace a frozen batch";
    const changed = freezeDiscoveryBatches(plan, input)[0]!;
    expect(changed.runId).toBe(first.runId);
    expect(changed.body).not.toBe(first.body);
    expect(changed.digest).not.toBe(first.digest);
  });
  test("returns no request for empty discovery and fails closed on duplicate identities", () => {
    expect(freezeDiscoveryBatches(plan, [])).toEqual([]);
    const [job] = jobs(1);
    expect(() => freezeDiscoveryBatches(plan, [job!, job!])).toThrow("Duplicate");
  });
  test("rejects caller-supplied execution fields and invalid plan identity", () => {
    expect(() => freezeDiscoveryBatches({ ...plan, slotId: "missing" }, jobs(1))).toThrow();
    const input = jobs(1).map((job) => ({ ...job, submit: true }));
    expect(() => freezeDiscoveryBatches(plan, input)).toThrow();
  });
});
