import { badRequest, forbidden } from "@/common/errors";

export const FIXTURE_FIELDS = [
  {
    id: "contact_email",
    label: "What is your preferred contact email?",
    intent: "contact",
    kind: "text",
    required: true,
    sensitive: false,
  },
  {
    id: "experience",
    label: "Describe your experience leading cross-functional teams.",
    intent: "other",
    kind: "text",
    required: true,
    sensitive: false,
  },
  {
    id: "sponsorship",
    label: "Will you require sponsorship?",
    intent: "sponsorship",
    kind: "boolean",
    required: false,
    sensitive: true,
  },
] as const;

export function assertFixtureUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".invalid") ||
    url.username ||
    url.password ||
    url.hash
  )
    throw badRequest(
      "Only reserved .invalid synthetic jobs support the confined DRY_RUN form. External forms are disabled.",
    );
}

// This worker has no browser, HTTP client, executable launch, or user-provided action transport.
export function fixtureControl(action: string): never {
  throw forbidden(
    `DRY_RUN fixture: control ${action} is blocked; no final or ambiguous actions execute.`,
  );
}

export function simulateFixture(
  url: string,
  fields: { id: string; approved: boolean; required: boolean }[],
) {
  assertFixtureUrl(url);
  if (fields.some((field) => field.required && !field.approved))
    throw forbidden("Required questions need approved exact-context answers.");
  const evidence = [
    "confined_synthetic_form",
    "no_browser_or_network_transport",
    "approved_reference_mapping_only",
  ];
  for (const action of ["Submit", "Enter", "Continue", "Next", "Apply", "Save"]) {
    try {
      fixtureControl(action);
    } catch {
      evidence.push(`blocked_control:${action}`);
    }
  }
  return {
    status: "simulated" as const,
    submitted: false as const,
    finalControlBlocked: true as const,
    evidence,
  };
}
