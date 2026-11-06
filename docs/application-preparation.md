# Confined DRY_RUN application preparation

The `/preparation` page prepares owned, signed-ingestion jobs against a fixed synthetic form. The server only accepts HTTPS job URLs whose hostname ends in `.invalid`, a reserved non-production domain. This is a DRY_RUN MVP: employer browser automation, agent execution, external form navigation, and real submission remain disabled.

## Flow

1. Select an owned discovery batch and synthetic job. Creation uses an explicit UUID idempotency key; changed input under the same key returns 409. A second preparation for the same owner/source ID or exact URL also returns 409.
2. The server selects an active, currently approved resume using saved automatic, fixed, or manual preferences. Its ID, content version, review revision, and label become provenance.
3. A server-owned fixture form declares two required fields and one optional sensitive field. Exact labels, intent, type, choice options, company/role/job scope and current Information Bank approval must match. Missing, conflicting, revoked, expired, or incompatible answers remain in question review. No AI answer is generated.
4. Create/approve missing Information Bank entries, then refresh the preparation. Explicit exception approval authorizes only this synthetic simulation. The warning continues to state that employer eligibility and match score are unverified; approval does not convert them to positive evidence.
5. Simulate only after the resume, required answers and exception approval are present. Inside the shared user-row transaction, the server rechecks the current browser session, settings version, resume review revision and source availability, answer approval versions/expiry, duplicate applications/reservations and remaining daily simulation quota.
6. Record `simulated` with `submitted: false` and blocked-control evidence. No `Application`, campaign, or Pilot record is created or updated. Repeat simulation reads the immutable result and does not consume more quota.

## Fixture form

| ID | Exact question | Kind | Requirement |
| --- | --- | --- | --- |
| `contact_email` | What is your preferred contact email? | text, `contact` | Required, approved exact match |
| `experience` | Describe your experience leading cross-functional teams. | text, `other` | Required, approved exact match |
| `sponsorship` | Will you require sponsorship? | boolean, `sponsorship` | Optional; sensitive approval must be job-specific and current |

Unapproved optional fields are omitted. A fixture account may use clearly synthetic values. Do not populate an actual applicant's experience or qualifications from invented fixture answers.

## Boundary and storage

`apps/api/src/modules/preparation/fixture-worker.ts` is a deterministic in-process reference mapper. It has no HTTP client, browser transport, executable launcher, arbitrary script evaluator or client-defined action list. Submit, Enter, Continue, Next, Apply and Save controls all raise a server-owned rejection. Its evidence is simulation evidence, not proof of interacting with a real employer website.

Preparation and immutable event snapshots contain question metadata, resume provenance and approved answer IDs/versions; they do not copy answer values or decrypt them into response payloads. Information Bank values retain their existing encrypted storage and approval rules. New simulations additionally archive the exact approved used answer in a separate AES-GCM encrypted record. Its per-use key is wrapped under the owner’s data key with a dedicated authenticated context. The envelope binds owner, preparation, field, source entry/version and capture time. Ordinary preparation responses and audit events still contain references only. Older simulations remain reference-only; values are never reconstructed from today’s Information Bank. Questions and resume labels are metadata and should not contain secrets.

Information Bank create, edit, approval, revocation and deletion take the same account-row lock as simulation. The final candidate resolution runs inside that transaction, so a concurrent newly approved job-specific answer or conflicting alias cannot silently replace the reviewed mapping. A changed mapping requires preparation review again.

The migration adds `application_preparations` and append-only `preparation_events`. Final simulated preparation rows are immutable while their owner exists. Account deletion cascades their data. Drafts can be reviewed with optimistic revision checks; server-controlled revisions generate an audit event for each change.

Completed preparations consume the same daily simulation capacity reported by policy preview, alongside existing dry-run reservations and recorded application counts. All capacity writers use the same user-row lock. These reservations never imply that an application was submitted.

## API

All preparation routes require a current browser session and return `Cache-Control: no-store`. Terminal credentials do not grant preparation review access.

- `GET /api/preparations?page=1&limit=20`: owned paginated preparations.
- `POST /api/preparations`: `{requestId, ingestionRunId, sourceId, resumeId?}`.
- `GET /api/preparations/:id`: owned state and audit metadata.
- `POST /api/preparations/:id/review`: `{expectedRevision, approveExceptions}`; refresh current approvals, optionally approve simulation exceptions.
- `POST /api/preparations/:id/simulate`: `{expectedRevision}`; record a confined simulation after final revalidation.

There is no endpoint to enable external forms, override execution mode, supply a match score, bypass unanswered required questions, inject browser commands, or mark a preparation submitted.

## Verification

Pure tests cover fixture URL confinement, required-answer gating and final/ambiguous control rejection. PostgreSQL tests use only the explicitly named loopback `jobpilot_settings_test` database and cover browser/owner authorization, unknown-question review, approved-reference provenance, immutable history, replay/deduplication, resume and answer revocation, stale settings/revisions, session expiry, quota races and absence of Application/campaign/Pilot writes. Run the isolated migration before those tests. The root CI database test step must include `src/modules/preparation/`.

A verified adapter for real employer forms and actual confined browser execution remain future work. Encrypted answer-use archives are implemented for new confined simulations; they never authorize reuse or submission.

## Historical answer retention and review

An approved answer is captured inside the same account-locked database transaction as the completed simulation. Failure to encrypt or persist any copy rolls back the simulation, audit event and copies together. Source edits, revocation and deletion do not rewrite a used copy. Archives are append-only, linked to an owned completed preparation by a composite foreign key, and are removed with the live account. Separate per-use keys mean deleting the reusable Information Bank entry does **not** delete already-used historical copies. The deletion confirmation explains this retention. Exports and backups have separate retention; live-row deletion does not promise erasure of every historical backup.

`GET /api/preparations/:id/answer-history` requires a current owner browser session, rechecks that session after decryption and returns `Cache-Control: no-store`. Terminal tokens and other users cannot read it. Its response is always `historicalOnly: true`, `canReuse: false`, `canSubmit: false`. The UI only mounts its private zero-retention query after explicit reveal confirmation, and unmounts values on close or preparation/account changes. Historical approval dates describe the time of use; they are not current approval.

No encrypted values are backfilled for pre-migration simulations. Their history response is empty and the UI explicitly explains reference-only history. Production snapshot restore-and-migrate validation remains a release prerequisite; only isolated synthetic databases were migrated during development.
