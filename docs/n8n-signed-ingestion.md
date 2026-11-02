# Signed n8n discovery ingestion

The adapter accepts discovered jobs into a separate inbox. It cannot submit an application,
launch a campaign, create Pilot work, run a browser, or change execution policy. Receipts always
report `stored_only` and the server's enforced `DRY_RUN` policy. Existing search, history, resume,
authentication, and campaign routes retain their previous behavior.

## Existing workflows and compatibility

The owner identified `https://hlawal.app.n8n.cloud` as the existing n8n Cloud workspace, containing
Telegram search, JSearch, Google Sheets tracking, Drive resume processing, AI tailoring, and
scheduled searches whose configuration needs verification. These are owner-provided descriptions,
descriptions at the time this adapter was implemented. The subsequently supplied 42-node export
is analyzed in [n8n-workflow-integration-plan.md](n8n-workflow-integration-plan.md). No request
was made to that workspace and no live workflow was changed.

This is a **new canonical contract**, not a claim of compatibility with those workflows.
The supplied export establishes node structure and scheduling, but contains no pinned raw JSearch
response. Provider response compatibility and secure Cloud signing still require verification.
Do not include credential values, applicant information, resume contents, execution URLs with
embedded tokens, or credential-bearing sample data in exports or discovery payloads.
No API keys, passwords, private keys, or n8n credentials are requested or stored by this adapter.

## Trust and signatures

`POST /api/integrations/n8n/ingest` uses an Ed25519 signature, not a web session or terminal token.
There are no provisioned integrations or keys in this change. A trusted operator would need to
provision an `ingestion_integrations` row with the owning account, an Ed25519 SPKI public PEM key,
and explicit activation in a future authorized configuration step. New rows default to inactive.
There is deliberately no public key-registration or activation endpoint. The caller must never
choose an account owner in a request body. The database relation establishes ownership.

Headers:

| Header | Value |
| --- | --- |
| `Content-Type` | `application/json` |
| `X-JobPilot-Integration` | Provisioned integration UUID |
| `X-JobPilot-Timestamp` | Ten-digit Unix timestamp in whole seconds |
| `X-JobPilot-Signature` | Base64 of the 64-byte Ed25519 signature |

Sign these UTF-8 bytes, with LF separators and **no trailing newline**:

```text
jobpilot-ingestion-v1
POST
/api/integrations/n8n/ingest
<integration UUID>
<timestamp header exactly>
<lowercase SHA-256 hex digest of the exact HTTP request body bytes>
```

The caller retains its private signing key outside JobPilot; the receiver only holds its public
verification key. Tests generate temporary key pairs in memory and never export private keys.
Whether the existing n8n Cloud plan/nodes support the required signing step remains unverified.
If they do not, an independently reviewed signing boundary will be needed; do not weaken the
receiver to accept unsigned requests. Public-key provisioning, private-key custody, rotation,
and activation are future integration work, not completed setup.

Missing, malformed, inactive, unknown, expired, future-dated (beyond five minutes), tampered, and
unverifiable signatures fail closed. Changing the integration identity invalidates the signature.
Authentication also precedes replay lookup. Deactivation denies subsequent requests, including
retries; requests already verified and in flight may finish storing data. No execution is granted.
Use HTTPS for any eventual external transport. This change does not deploy or expose an endpoint.

## Contract version 1

```json
{
  "schemaVersion": 1,
  "runId": "b52b2b12-72de-42fd-8ada-a5f9b2568c9c",
  "jobs": [{
    "sourceId": "synthetic-job-1",
    "title": "Program Manager",
    "company": "Example Company",
    "url": "https://jobs.example.test/synthetic-job-1",
    "location": "Remote, US",
    "description": "Synthetic discovery fixture",
    "salary": null
  }]
}
```

The shared validator is `packages/contracts/src/ingestion.ts`. Objects are strict: unknown fields
such as `userId`, `resume`, `credentials`, `submit`, and worker instructions are rejected.
Each batch contains 1–25 jobs, unique source IDs, and at most 65,536 bytes including JSON overhead.
The raw request stream is bounded before JSON parsing, including requests without Content-Length.
Compressed bodies are rejected. Salaries are explicitly unknown (`null`) or contain `minimum`,
`maximum`, uppercase three-letter `currency`, and `period` (`hour`, `month`, `year`). No currency
conversion, annualization, eligibility determination, or invented salary is performed.
URLs must be HTTPS without user information or fragments. No URL is fetched. All job text and
URLs remain untrusted data, never executable instructions. Do not send secrets in free text or
URL query strings; structural validation cannot identify arbitrary secrets in job descriptions.

## Idempotency, history, and storage

The database's unique `(integration_id, run_id)` constraint arbitrates concurrent retries.
The first successful request returns `duplicate: false`; identical retries return the same receipt
with `duplicate: true`. A different raw body under the same run ID returns 409, even if the JSON
differs only in whitespace or order. Preserve the exact serialized body for retries; sign a new
timestamp if necessary. Replays outside the five-minute timestamp window fail authentication.
Persisted run IDs retain replay protection across process restarts. Do not delete them while the
integration remains active unless equivalent replay tombstones are retained.

This is **batch ingestion idempotency**. A job appearing in another run may be stored again;
cross-run job deduplication, daily quotas, policy evaluation, and preparation are later stages.
No existing application record is marked applied or modified.

`GET /api/integrations/n8n/runs?page=1&limit=20` requires the ordinary user session/token and returns
only that user's batches. Neither verification keys nor body digests appear in that response.
Responses use `Cache-Control: no-store`. Requests are limited per IP in each API process using
the existing limiter; global rate limiting and reverse-proxy body/time limits remain deployment
considerations. Ingestion payloads contain discovery data, not applicant data. Rows cascade on
account deletion. No automatic age-based pruning is introduced because it could undo replay
protection; future retention requires tombstones or integration rotation.

## Local validation and rollout limits

The additive migration is `apps/api/prisma/migrations/20261102120000_signed_ingestion/migration.sql`.
No existing tables or records are rewritten. Tests cover signatures, raw-body tampering, strict
schemas, stream limits, concurrent idempotency, owner isolation, default-inactive provisioning,
revocation, and no application/campaign/Pilot side effects. PostgreSQL tests opt in through
`JOBPILOT_TEST_DATABASE_URL` and refuse anything except the dedicated loopback
`jobpilot_settings_test` database. They use synthetic accounts and discovery data.

No production snapshot, n8n workflow, remote database, installed terminal, or local JobPilot user
installation is changed. Production-copy migration verification and sanitized-export mapping
remain release prerequisites. Keep the PR unmerged and deployment disabled until separately
authorized. Browser providers remain disabled by the existing dry-run boundary.

Validated on this branch: Biome, knip, API and web TypeScript checks; 661 API tests and 49 contract
tests pass. The opt-in database suite passes separately: 7 ingestion and 11 settings/resume tests
on isolated PostgreSQL 17, with no schema drift after all migrations. The unchanged terminal
safety suite passes all 203 tests. Database fixtures have no network access or published ports;
fixture resume files use disposable container storage. This does not validate real n8n nodes,
live workflow schemas, a production snapshot, or an installed client upgrade.
