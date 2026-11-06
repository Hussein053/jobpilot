# External setup and release decisions

This is the consolidated owner-action list. Development, isolated tests, development branch
publication and PR review need no further routine approvals. No credentials, real resumes or
application answers should be sent in chat, committed, or entered into the temporary demo.
Real applications remain disabled regardless of hosting choice.

## Hosting options and costs

These are planning allowances, not verified provider quotes or authorization to purchase.
Confirm the selected provider's current pricing, backups, data region and account limits before
provisioning anything. No paid resources have been created.

| Option | Expected cost | What the owner must decide | Limitations |
| --- | --- | --- | --- |
| Current temporary synthetic preview | $0 for the existing public-repository standard runner and accountless tunnel, subject to service policy | Nothing for the running demonstration | Four-hour expiry, fresh fixture database, no uptime guarantee; unsuitable for personal data or persistence |
| Existing owner-controlled server | Potentially $0 incremental compute if capacity already exists; electricity, backup storage and optional domain remain separate | Confirm server ownership, capacity, permitted access and an HTTPS hostname | Owner must operate patching, encrypted storage, backups and restore testing; this Codex session is not a permanent server |
| Small managed server with persistent database/storage | Budget roughly $20–60/month initially, potentially higher for independently managed PostgreSQL, backups and key custody | Choose provider, region and spending cap; separately approve provisioning and production deployment | No provider/account is selected or connected; final estimate requires an actual quote |

A domain is optional for the temporary demo. An owned domain can be reused for persistent
hosting. If purchasing a new one, allow roughly $10–25/year as a planning estimate; registration
and renewal vary. Normal automated TLS certificates can be free. A managed key service, outbound
email and provider searches may add usage charges and must be included in the final approval.

## One owner-action checklist

| Connection or permission | Needed for | Owner action and credential custody | When required |
| --- | --- | --- | --- |
| Hosting, persistent PostgreSQL and document volume | Stable HTTPS access and durable private data | Select an option above and approve its exact cost/access scope. Use platform secret bindings for `DATABASE_URL`; database not publicly exposed | Before persistent installation; paid provisioning and production release require separate approval |
| Encryption and backups | Resume files, Information Bank and historical used-answer copies | Generate `SECRET_MASTER_KEY` inside the approved secret manager; keep encrypted, independently recoverable database/file backups and a separately protected key backup. Agree region, operators and retention | Before requesting any actual resume or sensitive answer; demonstrate restore and owner isolation first |
| HTTPS hostname and origin configuration | Secure sessions, PWA and API access | Approve DNS access to one hostname; configure `APP_URL`, `CORS_ORIGINS`, build-time `NEXT_PUBLIC_API_URL` and private `INTERNAL_API_URL` consistently. Use HTTPS, exact origins, Secure cookies and no private caching | Persistent release preparation; DNS changes and deployment remain approval-dependent |
| Transactional account email | Verification, recovery and email changes | Choose a mail provider; current implementation supports Resend with `RESEND_API_KEY` and verified `EMAIL_FROM`. Bind secrets in hosting, not chat or workflow exports | Before a real-user installation is declared operational. Production console mail must not expose recovery links |
| JSearch / RapidAPI | Real structured discovery | Confirm account/plan entitlement, request allowance and spending cap; configure its API key in the relay's managed outbound binding. Supply one sanitized successful `/search-v2` response to pin the actual account schema | Before external discovery is enabled; synthetic fixtures do not establish provider compatibility |
| Existing n8n Cloud workspace | Separate hourly discovery companion | Workspace is already known: `https://hlawal.app.n8n.cloud`. Reuse the analyzed 42-node export; do not request it again. Approve import/testing of a separate inactive companion only after relay setup. Configure a scoped relay caller credential through n8n's credential manager | No live workflow or schedule change without separate approval |
| Relay authentication and hosting | Bound, auditable structured delivery | Choose an approved relay host and a workload-identity/auth gateway. Bind one subject to one owner/integration and fixed destinations. Confirm issuer/audience validation, TLS, redaction and revocation | Before connecting n8n; no browser-session or terminal-token substitute |
| Managed Ed25519 signing | Exact-byte signed ingestion | Select a key service proven to support Ed25519. The implemented signer targets Vault Transit with fixed HTTPS endpoint, key name/version, pinned public key and managed authentication. Private signing key stays in the service; JobPilot stores its public verification key | Before integration activation; no private key in Code nodes, JSON exports, execution data or chat |
| Provider/scheduler budgets | Hourly Program Manager, Project Manager and Business Analyst searches | Confirm search timezone and request cap independently from the 50/day simulation cap. Three roles × one request hourly is up to 72 requests/day before other provider usage/retries. Choose an n8n allowance sufficient for hourly triggers plus execution failures | Before schedule activation; saved settings alone do not start searches |
| Optional Google/GitHub sign-in | Convenience sign-in | Only if desired: create dedicated OAuth clients and exact callbacks; bind client IDs/secrets in hosting. Password sign-in does not need these | Optional; never reuse mailbox credentials or existing production client secrets |
| Telegram, Sheets, Drive and Gmail | Existing legacy workflows/mailbox | No new connection is required for the synthetic MVP. Preserve existing credential references, callbacks, history and files. Review sanitized fixtures only if a later adapter requires them | Separate explicit approval before changing any live workflow; do not connect Gmail to make disabled Pilot run |
| Remaining development merges | Integration into main | PRs #1–#3 are already merged. PRs #4–#11 remain stacked development work; review/check status must be recorded before requesting their final merge sequence | No routine development pause; production release is a separate decision from source integration |
| Production release | Stable real-user availability, still DRY_RUN | Approve a specific commit, destination, migrations, backup/rollback plan, exact monthly budget and release window | Only after all release gates below pass; no authorization inferred from a successful demo |

VAPID push keys are optional. Generate and bind them securely only if notifications are wanted;
they are not required to install the PWA. No AI provider credential is needed for the current
deterministic fixture preparation. Any future AI tailoring must remain an explicitly approved
draft and must never invent qualifications.

## Release gates before personal data

1. Green tests on the exact integrated source commit, including database migration/drift,
   authorization, encrypted archive preservation, quota races and denied final controls for both
   provider paths. No ignored failure or branch-protection bypass.
2. Restore a permitted database copy and document volume into an isolated environment, apply
   migrations, and prove historical application/resume/document relationships remain readable.
   Only synthetic databases have been migrated in this sprint; a production restore is unverified.
3. Encrypted persistent disks/backups, protected wrapping key, restricted operators, defined
   retention and a successfully exercised restore. Database snapshots alone do not back up files
   or encryption keys. Document storage is not represented as per-file application encryption.
4. Staging HTTPS sign-in, recovery email, owner isolation, logout, upload/download authorization,
   same-origin API routing and non-caching of private data. No credentials in diagnostic logs.
5. Synthetic signed staging round-trip using the selected relay/key manager; verify failed keys,
   replay, retries and malformed responses cannot produce application records. Keep the live
   legacy n8n schedule and Telegram Submitted callback unchanged.
6. Persistent-origin iPhone Home Screen launch and offline privacy check. The owner confirmed the
   temporary iPhone demo works; this does not establish standalone installation on a future origin.
7. Separate release approval. Afterward request real resumes/answers only through the secured
   installation, with explicit draft/approval and retention controls.

## n8n migration boundaries

The existing [42-node analysis](n8n-workflow-integration-plan.md) remains the source for actual
Telegram/Sheets/Drive branch behavior and field mappings. Its original design-only status is
historical: the structured adapter, ledger, planner, relay library and inactive companion are
now implemented in the development stack, as documented in
[secure-discovery-relay.md](secure-discovery-relay.md). No actual Cloud import, managed signer,
identity gateway or provider response has been verified.

Use structured JSearch objects rather than AI-generated Telegram text. Freeze exact batch bytes
and stable run IDs before delivery, preserve case-sensitive job IDs/URLs, and reconcile retries
against the durable receiver. Missing salary currency or eligibility evidence remains unknown;
never manufacture USD, an 85% match or verified qualifications. Ingestion receipts mean
`stored_only`, not applied or submitted. The old Telegram Submitted button remains a user report
in the old system and cannot become verified JobPilot submission evidence.

Real employer-form inspection and a confined external browser worker remain unimplemented.
Current preparation intentionally accepts only synthetic `.invalid` jobs. No external connection
or deployment approval can enable unrestricted browser execution or real application submission.
