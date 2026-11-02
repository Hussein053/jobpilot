# Integration plan for the supplied Job Pilot AI export

Status: design only. This document analyzes the supplied 42-node export against draft PR #3's
signed ingestion contract. It does not change, activate, or contact the live n8n workspace.
The export contains credential references and personal resource identifiers and must not be
committed. Its `active: false` value describes the export, not verified live activation state.

## Observed structure

`Schedule Trigger` feeds `Scheduled Search Request` and `AI Agent`. The agent uses Gemini,
memory, Candidate Profile, Job Preference, Master Resume, and the `HTTP Request` AI tool.
The latter targets JSearch `/search-v2` with query, page, and num_pages parameters.
`Read Job Tracker` and `Filter New Jobs` then consume agent-generated prose, not a preserved
provider response. `Filter New Jobs` parses numbered text and lowercases URLs, which can merge
case-sensitive paths incorrectly. `Save New Job` generates timestamp/index identifiers and
upserts by URL. Telegram receives split replies and job cards.

The Telegram branch routes button actions to tailoring, master-resume selection, submitted
recording, and not-interested handling. The tailoring branch re-searches title/company and can
fall back to the first result, risking a description from another posting. Master-resume
selection can pick a zero-score candidate. Neither behavior establishes an approved resume.
The Submitted button writes Applied records and confirmation metadata. That is a user report,
not evidence that a website accepted an application. No final website-submission node appears
in this export. A separate upload path transfers Telegram resumes to Drive.

The exported schedule is 07:00, 12:30, and 17:30 weekdays, and 09:00 weekends, in
America/New_York. It is not hourly. Keep the existing paths and schedule unchanged during
shadow testing. Do not attach ingestion to the AI prose parser, tailoring response, or
Submitted callback.

## JSearch to contract version 1

The public JSearch search-v2 specification describes `data.jobs[]` and cursor pagination.
The export includes no pinned raw successful response. Validate the account's actual provider
response using a sanitized fixture before enabling any integration; do not assume the tool's
page/num_pages parameters implement the current cursor API.

| Ingestion field | Structured provider source and rule |
| --- | --- |
| schemaVersion | Literal 1 |
| runId | Persisted batch UUID; never generated anew during retry |
| jobs | Validated items from response data.jobs, 1–25 per frozen batch |
| sourceId | `jsearch:` plus exact job_id; preserve case |
| title | job_title; reject missing/empty values |
| company | employer_name; reject missing/empty values |
| url | job_apply_link; HTTPS, no credentials or fragment; preserve path/query case |
| location | job_location, otherwise factual city/state/country components, otherwise Unspecified |
| description | job_description, or empty string when absent; quarantine over 8,000 characters rather than silently truncate |
| salary | null unless both numeric bounds, verified currency, and supported period exist |
| salary.minimum | job_min_salary when fully supported; never infer from prose |
| salary.maximum | job_max_salary when fully supported |
| salary.currency | No currency field is established by the reviewed search-v2 specification; never assume USD from location or a dollar sign |
| salary.period | HOUR→hour, MONTH→month, YEAR→year; DAY/WEEK unsupported in v1 |

Reject non-OK or unexpected response envelopes. Partial salaries, missing descriptions,
remote-work evidence, country, and provider provenance cannot be represented faithfully by v1.
A future strict version 2 can preserve those facts alongside backward-readable version 1 rows.
Until then missing evidence must lead to review in policy evaluation, not assumed eligibility.
Batch by both 25-job and 65,536-byte UTF-8 serialized-body limits, including JSON overhead.
Do not include applicant data, resumes, application status, execution instructions, or credentials.

## Minimal separate integration branch

Create an inactive, credential-free workflow export with these steps:

1. A fixture/manual trigger; an hourly trigger remains disabled until separately authorized.
2. Claim a server-owned discovery plan and role allocation using a dedicated scoped identity.
3. An ordinary HTTP Request node queries JSearch with structured settings and bounded cursor pagination.
4. A Code node validates and maps raw job objects. No model, Telegram message, or prose parser participates.
5. Freeze the serialized batches and their stable IDs in a durable ledger before delivery.
6. Call an authenticated sign-and-deliver relay. Verify its receipt is stored_only and DRY_RUN.
7. Record safe success/error metadata or quarantine a failed batch; never mark an application submitted.

The discovery-plan endpoint, scoped identity, durable delivery ledger, and workflow export are
planned additions, not capabilities already provided by PR #3. PR #3 supplies only verified,
owner-bound batch ingestion and run history. Keep the receiver strict and default-inactive.

## Ed25519 custody and n8n Cloud limitations

The receiver signs a domain-separated message containing POST, its fixed ingestion path,
integration UUID, ten-digit timestamp, and SHA-256 of the exact body bytes. See
[n8n-signed-ingestion.md](n8n-signed-ingestion.md) for the exact LF-delimited format.

The Cloud Code node's crypto support alone does not demonstrate secure private-key custody.
Do not place a private key in workflow JSON, node parameters, code, ordinary environment
expressions, or execution data. The reviewed Crypto node's createSign-style implementation
does not establish support for Ed25519's one-shot signing API. Do not substitute another
algorithm or accept unsigned payloads to make the workflow run.

Use an independently authenticated sign-and-deliver relay with a managed private key store.
Its caller identity is bound to one integration/owner, its target and ingestion path are fixed,
and its input is a validated discovery batch. It stores exact bytes, signs, and delivers them;
it must not expose an arbitrary signing oracle or caller-selected destination. The n8n caller
uses a managed credential for this limited relay operation, not a JobPilot browser session or
terminal token. JobPilot retains only the public verification key. Rotation uses an explicit
integration/key lifecycle and an overlap/revocation policy.

This relay has not been deployed or security-tested in n8n Cloud. Available credential types,
managed-key Ed25519 support, authentication, execution-data redaction/retention, and outbound
TLS restrictions must be verified before activation. No real key or credential is needed to
implement local ephemeral-key tests. If those conditions cannot be verified, delivery stays
disabled; unsigned fallback is not an option.

## IDs, delivery, deduplication, and errors

The server assigns a stable search-slot UUID bound to settings version and normalized UTC slot.
Derive each batch UUID from that slot plus role, cursor/page identity, and chunk index. Persist
exact bytes before the first attempt. A retry uses the same bytes and runId with a fresh signed
timestamp; it must not repeat discovery and silently change the batch under the old identity.

PR #3's unique integration/runId constraint makes identical retries idempotent across restarts.
A changed body under the same ID returns 409: stop and investigate; do not evade it with a new
UUID. Cross-run job deduplication needs a separate owner/provider/job_id uniqueness constraint
and observed-at history. Exact provider IDs take precedence over URL guesses. URL fallbacks
preserve case-sensitive path and query data. A discovered-job identity must never imply an
application was created or submitted.

Honor Retry-After on 429; retry transient transport/5xx failures with bounded exponential jitter.
Treat 400/422 as quarantined schema errors, 401/403 as a stopped integration, and 409 as a
conflict. A durable dead-letter record contains run ID, role ID, attempt count, safe reason,
HTTP status, and correlation ID. Logs and notifications exclude authentication headers,
signatures, response bodies containing private information, and resume/answer data. Notify
operators only through a channel authorized during eventual setup; no messages are sent now.

## Hourly multi-role settings

The server, not the AI agent, chooses enabled roles, location, arrangement, frequency, time zone,
and settings version. Claim each slot atomically to tolerate overlapping scheduler executions.
Use bounded pages and a separate provider-credit budget with fair round-robin role allocation.
Three roles with one provider page hourly can consume 72 request credits/day, before retries;
the 50-application daily cap is not a search-request budget. Rotate larger role sets if needed.

Hourly claims use UTC identities and explicit daylight-saving tests. Settings changes affect
future claims, not already frozen batches. Manual, selected-local-hour, and hourly modes need
explicit semantics; the old half-hour/weekend schedule must not be silently approximated by
an hours-only model. Require a deliberate later cutover once settings and budget are verified.

## Migration and proof before activation

Preserve Telegram webhook ownership, callbacks, existing JP identifiers, Sheets history, Drive
files, tailoring, and resume uploads. Begin with synthetic fixtures in a separate inactive
workflow. Shadow discovery writes only the JobPilot inbox; no legacy Applied rows are promoted
to verified application history. ResumeReady and AI-tailored text remain drafts until explicit
JobPilot approval. Only a separately authorized cutover would change scheduling or live nodes.

Required tests include raw provider fixture mapping, nullable/partial salary and missing currency,
case-sensitive IDs/URLs, envelope/pagination failures, byte limits, stable IDs, retry byte equality,
restart/concurrent deduplication, invalid signatures, key revocation, and plan-owner isolation.
Database assertions must prove every ingestion outcome leaves Application, campaign, and Pilot
records unchanged and cannot write submitted/applied state. Inject jobs containing instructions
and unsupported execution/status fields and prove they remain inert or fail strict validation.
Run fixture end-to-end discovery→signed ingestion→policy preview with browser execution disabled.

Existing PR #3 tests cover signature rejection, raw-body limits, strict execution-field rejection,
owner isolation, concurrent run idempotency, and no application/campaign/Pilot side effects.
Adapter, relay, hourly claim, and cross-run identity tests remain to be implemented. This plan
must not be interpreted as evidence those components or a live integration already work.
