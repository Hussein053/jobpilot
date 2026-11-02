# Structured discovery adapter foundation

This change implements the mapping and frozen-batch portions of the
[n8n integration plan](n8n-workflow-integration-plan.md). It is an internal library plus tests;
no new HTTP route, workflow activation, signing-key provisioning, outbound request, application
worker, or schedule is introduced. Unrestricted browser providers remain disabled.

`apps/api/src/modules/ingestion/discovery/jsearch.ts` accepts an OK search-v2 envelope with
`data.jobs[]` and an optional cursor. It reads job objects directly, never AI-generated replies.
Only discovery-contract fields survive mapping. Job descriptions remain inert untrusted text.
Invalid objects and unsupported discovery fields are quarantined with safe index/reason codes.
No raw provider data appears in error messages. Conflicting records with the same provider ID
reject the response; identical mapped records collapse. Opaque IDs and URL path/query case are
preserved. Oversize descriptions are rejected, not silently truncated.

Currency is not established by the reviewed provider schema. Therefore v1 salary is always
null, and advertised/partial salary data produces an explicit salary_unverified mapping issue.
An absent description produces description_missing. A future durable adapter must store these
issues with source evidence and keep affected eligibility decisions in review. It must not treat
an advertised but incomparable salary as genuinely absent and apply the allow-missing-salary
setting. Contract v2 evidence and policy integration remain necessary before automated evaluation.
No claim of actual n8n account response compatibility is made without a sanitized raw fixture.

`batches.ts` accepts a trusted search-slot UUID, role UUID, provider input cursor, and mapped jobs.
It orders sources by stable code-point comparison, creates namespace-based UUIDv5 batch IDs,
and serializes validated bodies with at most 25 jobs and 65,536 UTF-8 bytes. Frozen results contain
runId, exact serialized body, and SHA-256 digest. Changed content under the same plan retains the
same identity so the receiver detects a conflict rather than silently accepting a replacement.
The input cursor identifies the fetched page; the response cursor belongs to the next claim.

Object freezing protects only process-local values. These functions are not a durable ledger.
The caller must persist the returned bytes and identities before the first delivery and reuse
those bytes after retries or restarts; it must not refetch/reconstruct a batch after an ambiguous
send. A relay must authenticate its limited caller, bind it to a fixed owner/integration and
receiver, keep Ed25519 keys in managed custody, sign exact persisted bytes with fresh timestamps,
and verify stored_only/DRY_RUN receipts. None of those operational components is enabled here.

Tests use synthetic provider records and ephemeral signing keys. They cover direct mapping,
case sensitivity, nullable salary/description evidence, invalid envelopes/URLs, conflicting
identities, stable IDs, reordered input, Unicode byte limits, strict execution-field rejection,
valid signed stored-only receipts, duplicate retries, and changed-body conflicts. An isolated
PostgreSQL regression sends a mapped signed batch and verifies Application, campaign and Pilot
counts stay unchanged. This is discovery ingestion, never evidence of a submitted application.

Still required: durable slot/batch ledger, scoped discovery-plan authentication, hourly multi-role
claims with provider-credit budgets, cross-run job identity storage, retry/dead-letter reporting,
a securely configured sign-and-deliver relay, and an inactive n8n workflow fixture using those
contracts. Live workflow migration and installation remain separate authorized release work.
