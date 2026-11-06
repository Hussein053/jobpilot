import {
  createPreparationSchema,
  type Preparation,
  reviewPreparationSchema,
  simulatePreparationSchema,
} from "@jobpilot/contracts/preparation";

const id = "20e40b66-f3e7-47ca-9969-d66e90258846";
let preparation: Preparation | null = null;
let answersApproved = false;
let simulated = 0;
let created = 0;
let answerHistoryReads = 0;
let referenceOnlyHistory = false;
export function resetPreparationFixture() {
  preparation = null;
  answersApproved = false;
  simulated = 0;
  created = 0;
  answerHistoryReads = 0;
  referenceOnlyHistory = false;
}
export const preparationFixtureState = () => ({
  preparationSimulations: simulated,
  preparationCreates: created,
  answerHistoryReads,
});

function fixture(): Preparation {
  const at = new Date();
  return {
    id,
    revision: 1,
    settingsVersion: 0,
    status: "review",
    createdAt: at,
    updatedAt: at,
    runtime: { mode: "DRY_RUN", canSubmit: false, externalFormsEnabled: false },
    job: {
      sourceId: "jsearch:browser-policy-fixture",
      title: "Program Manager",
      company: "Policy Fixture Employer",
      url: "https://jobs.fixture.invalid/program-manager",
    },
    resume: {
      id: "1578c15d-e419-4dd5-b23d-16ec6756e3da",
      version: 1,
      reviewRevision: 1,
      label: "Approved synthetic resume",
    },
    questions: [
      {
        id: "contact_email",
        label: "What is your preferred contact email?",
        intent: "contact",
        kind: "text",
        required: true,
        sensitive: false,
        status: "approved",
        reason: "approved_exact_context",
        entryId: "0c83bf7e-12b9-4b93-bcb8-e5e9e708db3b",
        entryVersion: 1,
      },
      {
        id: "experience",
        label: "Describe your experience leading cross-functional teams.",
        intent: "other",
        kind: "text",
        required: true,
        sensitive: false,
        status: "review",
        reason: "missing_stale_or_incompatible_answer",
        entryId: null,
        entryVersion: null,
      },
      {
        id: "sponsorship",
        label: "Will you require sponsorship?",
        intent: "sponsorship",
        kind: "boolean",
        required: false,
        sensitive: true,
        status: "review",
        reason: "missing_stale_or_incompatible_answer",
        entryId: null,
        entryVersion: null,
      },
    ],
    exceptions: {
      required: true,
      approved: false,
      reasons: ["Synthetic form only; job eligibility has not been verified."],
    },
    audit: [{ kind: "prepared", at, revision: 1 }],
    simulation: null,
  };
}

export async function handlePreparationFixture(
  request: Request,
  json: (value: unknown, status?: number) => Response,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path === "/test/reference-only-preparation-history") {
    referenceOnlyHistory = true;
    return json({ ok: true });
  }
  if (path === "/test/approve-preparation-answer") {
    answersApproved = true;
    return json({ ok: true });
  }
  if (path === "/api/preparations" && request.method === "GET")
    return json({
      items: preparation ? [preparation] : [],
      pagination: {
        page: 1,
        limit: 10,
        total: preparation ? 1 : 0,
        totalPages: preparation ? 1 : 0,
      },
    });
  if (path === "/api/preparations" && request.method === "POST") {
    if (!createPreparationSchema.safeParse(await request.json()).success)
      return json({ message: "Invalid preparation" }, 422);
    created++;
    preparation ??= fixture();
    return json(preparation);
  }
  if (!path.startsWith(`/api/preparations/${id}`)) return null;
  if (!preparation) return json({ message: "Preparation not found" }, 404);
  if (path.endsWith("/answer-history") && request.method === "GET") {
    answerHistoryReads++;
    const at = new Date();
    return json({
      historicalOnly: true,
      canReuse: false,
      canSubmit: false,
      items: referenceOnlyHistory
        ? []
        : [
            {
              id: "37a61a5d-1e51-4883-b04e-87bb755b7f25",
              questionId: "experience",
              question: "Describe your experience leading cross-functional teams.",
              intent: "other",
              sensitive: false,
              entryId: "95e671db-212e-414c-8bcc-622d41e503a9",
              entryVersion: 2,
              approvedAt: at,
              reviewDueAt: at,
              capturedAt: at,
              scope: "job",
              scopeKey: "https://jobs.fixture.invalid/program-manager",
              source: { kind: "user_entered", referenceId: null, referenceVersion: null },
              answer: { kind: "text", value: "Archived private preparation answer" },
            },
          ],
    });
  }
  if (request.method === "GET") return json(preparation);
  const value = await request.json();
  if (path.endsWith("/review")) {
    const parsed = reviewPreparationSchema.safeParse(value);
    if (!parsed.success) return json({ message: "Invalid review" }, 422);
    if (parsed.data.expectedRevision !== preparation.revision)
      return json({ message: "Preparation changed" }, 409);
    preparation.revision++;
    preparation.exceptions.approved =
      parsed.data.approveExceptions || preparation.exceptions.approved;
    if (answersApproved)
      for (const question of preparation.questions.filter((item) => item.id === "experience")) {
        question.status = "approved";
        question.reason = "approved_exact_context";
        question.entryId = "95e671db-212e-414c-8bcc-622d41e503a9";
        question.entryVersion = 2;
      }
    if (answersApproved && preparation.exceptions.approved) preparation.status = "ready";
    preparation.audit.push({ kind: "reviewed", at: new Date(), revision: preparation.revision });
    return json(preparation);
  }
  if (path.endsWith("/simulate")) {
    const parsed = simulatePreparationSchema.safeParse(value);
    if (!parsed.success || parsed.data.expectedRevision !== preparation.revision)
      return json({ message: "Preparation changed" }, 409);
    if (preparation.status !== "ready")
      return json({ message: "Review unresolved questions" }, 409);
    preparation.revision++;
    preparation.status = "simulated";
    simulated++;
    preparation.simulation = {
      status: "simulated",
      submitted: false,
      finalControlBlocked: true,
      evidence: [
        "Final submit, Enter, Continue, Next, Apply, and Save controls blocked.",
        "No employer website was opened.",
      ],
    };
    preparation.audit.push({ kind: "simulated", at: new Date(), revision: preparation.revision });
    return json(preparation);
  }
  return null;
}
