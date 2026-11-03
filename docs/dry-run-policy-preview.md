# Dry-run policy preview and quota simulation

This branch adds a deterministic policy evaluator, read-only preview, and append-only dry-run
simulation history. It does not enable a preparer, browser, agent provider, live activation,
application record creation, or outbound requests. Every outcome has canSubmit=false and the
server continues to report DRY_RUN with unrestricted agents disabled.

## API and UI

- GET /api/auto-apply/preview returns saved settings, a settings version, local-day quota and,
  optionally, decisions for an owned ingestionRunId. An optional resumeId selects an approved
  resume when the saved selection mode is manual. Reading creates no reservations or history.
- POST /api/auto-apply/simulations accepts only requestId, ingestionRunId,
  expectedSettingsVersion and optional resumeId. It requires a current browser session,
  independently of ordinary auth. No score, eligibility facts, user ownership, execution mode,
  approval stamps or submission state can be supplied by the client.
- GET /api/auto-apply/simulations provides paginated owned summaries; GET with /:id reads an
  owned immutable historical snapshot. A historical result is never an execution permission.

The settings screen shows recorded applications, remaining actual quota, simulated reservations,
remaining simulation capacity and the reset instant separately. These use saved settings, not
unsaved form values. Existing historical records supply the recorded count; this change does not
retroactively verify their original website-submission evidence. A discovery-batch selector shows
per-job reasons and approved resume references without exposing resume contents. Recording a
simulation requires explicit confirmation and cannot start real preparation or submission.
Offline mutations fail immediately and do not replay. An explicit retry of the same input retains
its request identity. Settings/history/resume functionality and the private PWA cache boundary
remain intact. Counts refresh periodically and can be refreshed manually.

## Deterministic rules and missing evidence

Role, US country, custom location, arrangement, hard requirements, comparable annual base USD,
score threshold, approved current resume, screening resolution, duplicates and daily capacity are
independent gates. A score of 85 passes an 85 threshold but cannot override unknown or failed
mandatory requirements. Verified annual base pay below the minimum skips. Truly unlisted pay can
be allowed without claiming it meets the minimum; unknown or incomparable pay requires review.
An explicit failing gate skips, uncertainty reviews, and only a complete passing assessment is
eligible_for_dry_run. None of these states means submitted.

The production PreviewEvidenceService currently extracts only an exact configured role match
from ingestion v1. Country, arrangement, hard requirements, score and screening are unknown.
V1 null salary cannot distinguish genuine absence from discarded/incomparable provider salary,
so it is unknown rather than eligible for the allow-missing-salary exception. Even a v1 salary
object does not establish base rather than total compensation. Production v1 jobs consequently
remain in review unless an independent failing gate skips them. No positive eligibility or
calibrated score is invented from descriptions or resume keywords.

Automatic resume selection ranks active approved current versions by job-title term overlap,
then stable update/id order. This is a deterministic tie-breaking heuristic, not a qualification
assessment. Content must validate or its owned source file must exist. Fixed/manual selections
are owner-bound. Source availability and approval must be checked again by any future preparer.
The positive-assessment provider in preview-fixture.ts is test-only; there is no HTTP or environment
switch for installing it in production. Future verified assessments must be bound to the selected
resume version and inspected job context before this evidence service is expanded.

## Atomic capacity and duplicate handling

Recorded application counts use appliedAt in the user's current saved IANA timezone, with an
inclusive start and exclusive next-day boundary. Reset calculation handles fractional offsets,
23/25-hour daylight-saving days, and skipped midnights; it does not assume every day is 24 hours.
The quota date is a UTC-midnight label; startsAt and resetsAt are the actual local-day instants.
All historical application statuses still consume the day in which their application was recorded.

Each simulation locks its owning User row before reading settings and counting capacity. Settings
PATCH takes the same lock, so policy changes and allocations serialize. The expected settings
version must match. Existing application counts plus dry-run reservations created in that local
day cannot exceed the cap under this lock. The selected resume row is locked and its current
content/approval/review versions checked before recording a reservation. Crossing a day boundary
before commit fails and rolls back. Audit snapshots and all reservations commit together.

The unique owner/requestId key and digest of the typed request make retries idempotent, including
across server instances. A changed input under that ID returns 409. Repeating a completed request
returns its original historical quota snapshot, not a fresh eligibility decision. Preview is only
an observation; the POST always re-reads and evaluates current state under the lock.

Exact historical URLs skip. Source IDs and exact URLs with dry-run reservations in the preceding
24 hours skip, including across ingestion runs. Same-company/title matches with a different URL
are uncertain and require review. The same checks apply within a batch before two allocations
can be recorded. Source identities and case-sensitive URL paths are preserved. Different feeds
with different IDs, URLs, titles and company names cannot be reliably identified as one posting
from v1 alone; cross-provider provenance/canonical identities remain integration work. No fuzzy
identity guess is treated as permission to proceed.

The reservation table contains simulation metadata only. Reservations are not Application rows,
confirmed submissions, executable work or permanent live duplicate tombstones. Their day counts
and 24-hour duplicate window are simulation semantics. Future real preparation/live reservations
must have a separately reviewed lifecycle and must recheck all gates; this table cannot be used
as a shortcut to authorize a worker.

## Persistence, privacy and release limits

The additive migration creates dry_run_simulations and dry_run_reservations. SQL triggers reject
updates/deletes while the owner exists; account deletion cascades them. Audit JSON validates on
write and read, reviving stored dates. Snapshot metadata includes settings, job identifiers/reasons
and approved resume references, never resume content or Information Bank answer values. HTTP
responses are no-store; private preview query state is not persisted offline. No API keys or
private signing keys are introduced.

Existing records, local installations and n8n workflows are unchanged. Production-copy migration
verification remains a release prerequisite. Development database tests use only a dedicated
synthetic loopback database; CI also checks migration/schema drift. Real online form verification,
verified assessment production, grouped question review, secure relay/durable n8n scheduling and
a confined preparer remain separate work. Keep all PRs unmerged and all activation disabled.
