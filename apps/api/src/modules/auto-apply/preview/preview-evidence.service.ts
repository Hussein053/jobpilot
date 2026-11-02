import type { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { injectable } from "@needle-di/core";
import type { z } from "zod/v4";
import { ingestionFacts } from "./ingestion-facts";

@injectable()
export class PreviewEvidenceService {
  facts(job: z.infer<typeof ingestionBatchSchema>["jobs"][number], roles: string[]) {
    return ingestionFacts(job, roles);
  }
}
