import { z } from "zod/v4";

const publicUrl = z
  .url()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.hash;
    } catch {
      return false;
    }
  }, "Use an HTTPS URL without credentials or a fragment");

// A discovery contract, deliberately excluding applicant data and execution instructions.
export const ingestionBatchSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    runId: z.uuid(),
    jobs: z
      .array(
        z.strictObject({
          sourceId: z.string().trim().min(1).max(200),
          title: z.string().trim().min(1).max(300),
          company: z.string().trim().min(1).max(300),
          url: publicUrl,
          location: z.string().trim().min(1).max(300),
          description: z.string().max(8000),
          salary: z
            .strictObject({
              minimum: z.number().finite().nonnegative().max(1_000_000_000),
              maximum: z.number().finite().nonnegative().max(1_000_000_000),
              currency: z.string().regex(/^[A-Z]{3}$/),
              period: z.enum(["hour", "month", "year"]),
            })
            .refine((salary) => salary.maximum >= salary.minimum)
            .nullable(),
        }),
      )
      .min(1)
      .max(25),
  })
  .refine(
    (batch) => new Set(batch.jobs.map((job) => job.sourceId)).size === batch.jobs.length,
    "Source IDs must be unique within a batch",
  );
