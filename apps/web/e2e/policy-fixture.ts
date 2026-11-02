import type { AutoApplyPreferences } from "@jobpilot/contracts/auto-apply";
import { simulatePolicySchema } from "@jobpilot/contracts/policy-preview";
import { quotaDay } from "../../api/src/modules/auto-apply/preview/day-window";
import { evaluatePolicy } from "../../api/src/modules/auto-apply/preview/evaluate";
import { ingestionFacts } from "../../api/src/modules/auto-apply/preview/ingestion-facts";

const runId = "c531bb47-9109-467b-811a-e54045779a4b";
const job = {
  sourceId: "jsearch:browser-policy-fixture",
  title: "Program Manager",
  company: "Policy Fixture Employer",
  url: "https://jobs.example.test/Fixture",
  location: "US",
  description: "Fixture only",
  salary: null,
};
const runtime = {
  submissionMode: "DRY_RUN",
  liveSubmissionsEnabled: false,
  unrestrictedAgentsEnabled: false,
};
const receipts = new Map<string, { key: string; body: Record<string, unknown> }>();
let writes = 0;
export const policyFixtureState = () => ({ simulationWrites: writes });
export function resetPolicyFixture() {
  receipts.clear();
  writes = 0;
}
export async function handlePolicyFixture(
  request: Request,
  saved: { settings: AutoApplyPreferences; version: number },
  json: (value: unknown, status?: number) => Response,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/api/integrations/n8n/runs")
    return json({
      items: [
        {
          id: runId,
          runId,
          createdAt: new Date(),
          batch: { schemaVersion: 1, runId, jobs: [job] },
        },
      ],
      pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
  const summary = () => {
    const day = quotaDay(new Date(), saved.settings.timeZone);
    return {
      settings: saved.settings,
      settingsVersion: saved.version,
      quota: {
        ...day,
        cap: saved.settings.maxDailyApplications,
        recordedApplications: 2,
        dryRunReservations: 1,
        remainingActual: Math.max(0, saved.settings.maxDailyApplications - 2),
        remainingSimulation: Math.max(0, saved.settings.maxDailyApplications - 3),
      },
      runtime,
    };
  };
  const outcomes = () => [
    {
      ...job,
      resume: null,
      outcome: evaluatePolicy(saved.settings, ingestionFacts(job, saved.settings.roles), {
        approvedResume: false,
        manualResumeSelected: false,
        duplicateApplication: false,
        duplicateInProgress: false,
        duplicateUncertain: false,
        remaining: Math.max(0, saved.settings.maxDailyApplications - 3),
      }),
    },
  ];
  if (url.pathname === "/api/auto-apply/preview") {
    const selected = url.searchParams.get("ingestionRunId");
    if (selected && selected !== runId) return json({ message: "Discovery run not found" }, 404);
    return json({ ...summary(), jobs: selected ? outcomes() : [] });
  }
  if (url.pathname === "/api/auto-apply/simulations" && request.method === "POST") {
    const parsed = simulatePolicySchema.safeParse(await request.json());
    if (!parsed.success) return json({ message: "Invalid simulation" }, 422);
    const input = parsed.data;
    const key = JSON.stringify([
      input.ingestionRunId,
      input.expectedSettingsVersion,
      input.resumeId ?? null,
    ]);
    const prior = receipts.get(input.requestId);
    if (prior)
      return prior.key === key
        ? json({ ...prior.body, duplicate: true })
        : json({ message: "Request identity conflict" }, 409);
    if (input.expectedSettingsVersion !== saved.version)
      return json({ message: "Settings changed. Reload before simulating." }, 409);
    if (input.ingestionRunId !== runId) return json({ message: "Discovery run not found" }, 404);
    const body = {
      ...summary(),
      id: crypto.randomUUID(),
      requestId: input.requestId,
      ingestionRunId: runId,
      createdAt: new Date(),
      jobs: outcomes(),
      duplicate: false,
    };
    receipts.set(input.requestId, { key, body });
    writes++;
    return json(body);
  }
  return null;
}
