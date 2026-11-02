import { forbidden } from "@/common/errors/http.error";

// No activation exists in PR 2A. Neither preferences nor environment variables grant execution.
const POLICY = Object.freeze({
  submissionMode: "DRY_RUN" as const,
  liveSubmissionsEnabled: false as const,
  unrestrictedAgentsEnabled: false as const,
});

export function getExecutionPolicy() {
  return POLICY;
}

export function assertApplicationExecutionAllowed(): void {
  throw forbidden("DRY_RUN: application execution and submitted outcomes are disabled.");
}
