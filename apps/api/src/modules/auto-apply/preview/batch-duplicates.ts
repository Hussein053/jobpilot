import type { z } from "zod/v4";
import type { previewJobSchema } from "./preview.schema";

type Result = z.infer<typeof previewJobSchema>;
export function batchDuplicateGuard() {
  const sources = new Set<string>();
  const urls = new Set<string>();
  const descriptions = new Set<string>();
  return (result: Result) => {
    const key = JSON.stringify(
      [result.company, result.title].map((part) => part.normalize("NFC").trim().toLowerCase()),
    );
    if (sources.has(result.sourceId) || urls.has(result.url)) {
      result.outcome = {
        ...result.outcome,
        decision: "skip",
        reasons: [...result.outcome.reasons, "duplicate_in_progress"],
      };
    } else if (descriptions.has(key) && result.outcome.decision !== "skip") {
      result.outcome = {
        ...result.outcome,
        decision: "review",
        reasons: [...result.outcome.reasons, "duplicate_uncertain"],
      };
    }
    if (result.outcome.decision === "eligible_for_dry_run") {
      sources.add(result.sourceId);
      urls.add(result.url);
      descriptions.add(key);
    }
    return result;
  };
}
