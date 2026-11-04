const reasonLabels: Record<string, string> = {
  unverified_question: "The exact question has not been verified. Review is required.",
  missing_stale_or_incompatible_answer:
    "No current approved answer matches this exact question, type, and scope.",
  conflicting_answers:
    "More than one approved answer matches. Resolve the conflict before continuing.",
  approved_exact_context:
    "A current approved answer matches this exact question and application context.",
};

export function questionReasonLabel(reason: string): string {
  return reasonLabels[reason] ?? reason;
}

export function preparationEvidenceLabel(evidence: string): string {
  if (evidence.startsWith("blocked_control:"))
    return `Blocked final or ambiguous control: ${evidence.slice("blocked_control:".length)}.`;
  if (evidence === "confined_synthetic_form") return "Used the confined synthetic form.";
  if (evidence === "no_browser_or_network_transport")
    return "No browser or external network action was available.";
  if (evidence === "approved_reference_mapping_only")
    return "Mapped only approved answer references; no answers were invented.";
  return evidence;
}
