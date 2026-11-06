import type { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import type { z } from "zod/v4";
import type { PolicyFacts } from "./evaluate";

type Job = z.infer<typeof ingestionBatchSchema>["jobs"][number];
export function ingestionFacts(job: Job, roles: string[]): PolicyFacts {
  return {
    role:
      roles.find(
        (role) =>
          role.normalize("NFC").trim().toLowerCase() ===
          job.title.normalize("NFC").trim().toLowerCase(),
      ) ?? null,
    country: null,
    location: null,
    arrangement: null,
    hardRequirements: "unknown",
    // V1 cannot distinguish unlisted pay from a discarded, non-comparable salary.
    salary: job.salary ? { kind: "incomparable" } : { kind: "unknown" },
    matchScore: null,
    screening: "unknown",
  };
}
