import { ingestionBatchSchema } from "@jobpilot/contracts/ingestion";
import { z } from "zod/v4";

const envelope = z.object({
  status: z.literal("OK"),
  data: z.object({ jobs: z.array(z.unknown()).max(1000), cursor: z.string().max(4000).nullish() }),
});
const optionalText = z.string().nullable().optional();
const posting = z.object({
  job_id: z
    .string()
    .min(1)
    .max(192)
    .refine((value) => value.trim() === value),
  job_title: z.string(),
  employer_name: z.string(),
  job_apply_link: z.string(),
  job_location: optionalText,
  job_city: optionalText,
  job_state: optionalText,
  job_country: optionalText,
  job_description: optionalText,
  job_min_salary: z.number().finite().nonnegative().nullable().optional(),
  job_max_salary: z.number().finite().nonnegative().nullable().optional(),
  job_salary_period: optionalText,
});
const discoveryJob = ingestionBatchSchema.shape.jobs.element;
export type DiscoveryJob = z.infer<typeof discoveryJob>;
type MappingIssue = {
  index: number;
  reason: "invalid_job" | "invalid_discovery_fields" | "salary_unverified" | "description_missing";
};

export function mapJSearch(input: unknown) {
  const parsed = envelope.safeParse(input);
  if (!parsed.success) throw new Error("Unsupported JSearch response envelope");
  const accepted = new Map<string, DiscoveryJob>();
  const issues: MappingIssue[] = [];
  for (const [index, value] of parsed.data.data.jobs.entries()) {
    const result = posting.safeParse(value);
    if (!result.success) {
      issues.push({ index, reason: "invalid_job" });
      continue;
    }
    const job = result.data;
    const location =
      job.job_location?.trim() ||
      [job.job_city, job.job_state, job.job_country].filter((part) => part?.trim()).join(", ") ||
      "Unspecified";
    const mapped = discoveryJob.safeParse({
      sourceId: `jsearch:${job.job_id}`,
      title: job.job_title,
      company: job.employer_name,
      url: job.job_apply_link,
      location,
      description: job.job_description ?? "",
      // Search-v2 has no verified currency field. Location must not invent one.
      salary: null,
    });
    if (!mapped.success) {
      issues.push({ index, reason: "invalid_discovery_fields" });
      continue;
    }
    const existing = accepted.get(mapped.data.sourceId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(mapped.data))
      throw new Error("Conflicting JSearch source identity");
    accepted.set(mapped.data.sourceId, mapped.data);
    if (job.job_min_salary != null || job.job_max_salary != null || job.job_salary_period)
      issues.push({ index, reason: "salary_unverified" });
    if (!job.job_description?.trim()) issues.push({ index, reason: "description_missing" });
  }
  return { jobs: [...accepted.values()], cursor: parsed.data.data.cursor ?? null, issues };
}
