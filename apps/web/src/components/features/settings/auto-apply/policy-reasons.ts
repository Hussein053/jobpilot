import type { POLICY_REASONS } from "@jobpilot/contracts/policy-preview";

export const policyReasonLabels: Record<(typeof POLICY_REASONS)[number], string> = {
  auto_apply_disabled: "Automatic application preference is off.",
  role_unverified: "The role has not been verified against your selected roles.",
  role_not_allowed: "The verified role is outside your selected roles.",
  country_unverified: "US location eligibility needs verification.",
  country_not_allowed: "The verified country is outside the United States.",
  location_unverified: "Your custom location needs verification.",
  location_not_allowed: "The verified location does not match your saved location.",
  arrangement_unverified: "Remote, hybrid or on-site arrangement needs verification.",
  arrangement_not_allowed: "The work arrangement is outside your preferences.",
  hard_requirements_unverified: "Mandatory qualifications have not been verified.",
  hard_requirements_not_met: "A mandatory qualification is not met.",
  salary_unknown: "Salary evidence is unknown; the missing-salary exception cannot be assumed.",
  salary_unlisted_allowed:
    "Unlisted salary is allowed; this does not establish that pay meets your minimum.",
  salary_unlisted_review: "Unlisted salary requires your review.",
  salary_unlisted_skip: "Your saved policy skips unlisted salary.",
  salary_not_comparable: "Annual base salary in USD has not been established.",
  salary_below_minimum: "Verified annual base salary is below your minimum.",
  match_score_unverified: "No verified match score is available.",
  match_score_below_threshold: "The match score is below your saved threshold.",
  resume_review_required:
    "An active, current approved resume with available content or a file is required.",
  resume_manual_required: "Select an approved resume for manual selection.",
  screening_unresolved: "Screening questions or form inspection remain unresolved.",
  duplicate_application: "An application for this exact URL is already recorded.",
  duplicate_in_progress: "This job already has a recent dry-run reservation.",
  duplicate_uncertain:
    "A similar employer and title may refer to the same job; review its identity.",
  daily_cap_reached: "No simulation capacity remains under the saved daily cap.",
};
