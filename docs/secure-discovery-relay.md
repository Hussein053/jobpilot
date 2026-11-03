# Inactive secure discovery relay

This branch implements durable discovery planning, provider grants, frozen delivery, canonical
job identity and an inactive n8n template. It does not activate a workflow, run a provider request,
provision a credential, create applications, start Pilot/campaign work or enable any browser.
All development tests use synthetic data and temporary keys. Application execution remains
independently blocked by enforced DRY_RUN.

## Default-denied configuration and trust

Existing ingestion keys do not automatically gain discovery access. A server-owned
DiscoveryPolicy defaults to enabled=false and zero provider requests/day. No public API can
create/enable it, reset an authentication block, register a key or activate live submissions.
Machine operations require an active ingestion integration, a current Ed25519 signature bound
to their exact method/path/body, and an enabled, unblocked discovery policy. Ordinary session or
terminal tokens cannot replace that signature. Historical discovery feeds remain owner-readable.

The relay is a library with a handle(Request) entry point, not a running listener. It defaults to
disabled and also refuses requests without injected authentication, signing and transport
capabilities. Its only incoming operation is POST /trigger with requestId and scheduled/manual
trigger. A trusted gateway must authenticate the caller to the one expected workload subject;
a caller-provided subject header is not authentication. Do not install the fixture authenticator
in a deployment. TLS, managed caller authentication and the runtime bindings must be verified
before a separately authorized release.

The JobPilot origin, integration identity, public-key pin, provider host and Vault key/version
are deployment bindings, never caller-controlled URLs or signing inputs. Redirects and cookies
are disabled on outbound requests; job URLs are never fetched. Signatures returned by a managed
signer must verify locally against the pinned Ed25519 public key before any request is sent.
There is no raw signing endpoint, unsigned fallback or export of private material.

## Practical managed signing

VaultTransitSigner implements a fixed-key, fixed-version Vault Transit signing adapter. It sends
base64 of the exact domain-separated message with prehashed=false, validates the versioned
signature envelope, and lets the relay verify the resulting Ed25519 signature against its pin.
Its authenticated Vault transport must be bound to a short-lived workload identity with sign-only
access to that named key. Vault tokens, provider credentials and gateway secrets are not inputs
to workflow JSON or public JobPilot APIs. No real Vault, key or credential was accessed here.
Provision a non-derived Ed25519 key with export/backup permissions disabled and verify those
properties during release setup; this adapter does not provision or audit a live Vault instance.

This adapter follows the [official Transit signing API](https://developer.hashicorp.com/vault/api-docs/secret/transit#sign-data).
The [n8n HTTP credential reference](https://docs.n8n.io/integrations/builtin/credentials/httprequest/)
describes managed header authentication. Compatibility of the actual Cloud workspace, gateway,
Vault version and identity bindings remains a release prerequisite; mocked protocol tests do not
prove deployed key custody. Equivalent managed signers can implement the same narrow capability.

A deployment binds DiscoveryRelay to a trusted gateway, uses VaultTransitSigner with an
authenticated Vault transport, uses ordinary TLS fetch for the fixed JobPilot origin, and supplies
a provider transport that obtains its credential from a managed secret binding. No default
credential reader or listener is installed by this change. Missing bindings fail closed. No real
secrets need to be sent to the assistant or committed to configure those platform bindings later.

## Scheduling and credit semantics

The server reads saved roles, location, arrangement, frequency, hours and timezone when claiming
a slot. Settings changes cannot rewrite an existing claim. Hourly searches use actual local-hour
boundaries with a five-minute grace period; selected-hour searches use the configured local
hours. Repeated DST hours are two hourly slots but only one selected-hour search. Missing DST
hours are skipped, not silently caught up. Manual searches occupy at most one manual UTC-hour
slot and share the same provider budget. Manual frequency creates no scheduled searches.

The inactive workflow has a fifteen-minute UTC tick so whole-, half- and quarter-hour timezones
can all reach a local hour boundary. Non-due ticks make no provider request, but would still
consume n8n workflow executions after activation: up to 96 ticks/day. Actual Cloud execution
limits/cost and queue delays must be checked. A delay beyond the grace window skips that search.
The template is not a modification of the old weekday/weekend half-hour schedule.

One claim selects up to three roles in persistent round-robin order. Larger role lists rotate
across slots. Each task grants exactly one JSearch search-v2 request with num_pages=1; it does
not follow the response cursor. The cursor is retained as metadata for a later, separately
budgeted pagination design. Request country is US; remote-only filtering is used only when the
saved preference allows Remote exclusively. Other arrangements remain candidates for later
verified policy evaluation. No minimum-pay filter hides jobs with unlisted pay.

An atomic owner-row lock serializes claims and provider starts across processes and integration
keys. The server-owned provider budget counts each persisted start grant in the UTC day, even
if the response/grant is lost and no billable request can be proved. A grant is one-use; uncertain
provider fetches are quarantined instead of repeated. Provider 429/5xx responses set a cooldown;
provider 401/403 blocks further provider starts until operator repair. These controls do not
consume or change the application's daily cap.

This is a budget for this relay only. It cannot observe requests from the unchanged legacy n8n
workflows, other RapidAPI clients, or other owners sharing a provider account. Operators must
allocate account headroom before activation. Three roles hourly can consume 72 provider credits
per UTC day, plus any separately requested manual searches within the configured total cap.
No automatic retries of a billed provider request are performed.

## Durability, identities and delivery

Plans, one-use starts, canonical jobs, aliases, frozen bodies, attempts and audit events live in
PostgreSQL. Request IDs and slot keys deduplicate concurrent/repeated claims. A crash before a
start can recover a planned task for twenty minutes. A crash/timeout after a start cannot safely
prove whether the provider charged it, so the task expires into quarantine after two minutes.
A provider result lost before successful freeze may be missed until a later new search; it is
never silently fetched again under the old grant. This conservative loss window is intentional.

Freeze validates the raw structured provider envelope, uses the existing mapper, stores safe
mapping-issue codes and cursor, and freezes the exact ingestion bodies and hashes before any
inbox delivery. The same freeze bytes replay; changed bytes return 409. Bodies, grants, claimed
plans and audit events have SQL immutability protection. Integration records with run history
must be deactivated/rotated rather than deleted, preserving replay/budget history; account
deletion cascades owned data. No automatic retention pruning is introduced.

Canonical discovery identities use owner-scoped exact provider IDs and exact case-sensitive URL
aliases with a composite ownership FK. Conflicting established identities quarantine rather
than auto-merge. Different sources sharing a generic URL can still collapse conservatively;
different IDs/URLs/names may refer to the same real job without being detectable. Fuzzy identity
is not permission to apply. Existing inbox rows are left readable and are not backfilled or
rewritten into canonical identities; the new projection covers the new relay's searches.

Delivery leases have fencing IDs and expire after sixty seconds. Retries use the persisted body
and batch UUID with a fresh signature timestamp. Retry-After is honored; values of seven days or more require operator repair instead of an early retry.
transient transport/429/5xx failures use bounded exponential delay/jitter. Five lease attempts
end in quarantine. Schema/conflict errors quarantine, and authentication or unsafe runtime
receipts stop discovery until operator repair. Receipts only mean stored in the discovery inbox.

The backend checks its authoritative IngestionRun and exact body hash before acknowledging
stored state. A fabricated successful receipt cannot mark an unstored batch stored. A lost
HTTP response is reconciled against that durable inbox; an old lease cannot overwrite a new
one. Neither a storage receipt nor a canonical job identity can set submitted/applied state.

## HTTP surfaces and limits

Purpose-bound signed POST operations under /api/integrations/n8n/search are claim, start, work,
freeze, fail, lease and report. Control bodies are bounded at 4 KiB; freeze at 1 MiB. They accept
no applicant/resume/Information Bank data, executable instructions, target URLs or execution
flags. Provider descriptions remain untrusted inert text. Structural validation cannot detect
arbitrary secrets pasted into public provider text; do not send applicant data in that channel.

Authenticated GET /history and /jobs are paginated and owner-filtered. Audit metadata contains
only IDs, counts, bounded statuses and reason codes, never signatures, headers, raw responses,
resume content or bank answers. All responses are no-store. Existing per-process/IP rate limits
also apply; distributed ingress/body/timeout limits remain deployment configuration.

## Inactive workflow and cutover

integrations/n8n/jobpilot-discovery.inactive.json contains separate manual/scheduled trigger
identities, a disabled schedule, a disabled fixed-placeholder relay HTTP node with retries off,
and a receipt check. active and MCP exposure are false, execution-data retention is disabled,
and there are no credential IDs or source-workflow resource IDs. The new branch asks the relay
to fetch structured data so external HTTP retries cannot bypass the provider grant ledger. It
does not parse AI/Telegram prose and never invokes Telegram/Sheets/Drive/resume processing.

Before any live use: validate the template against the actual Cloud node versions; configure
managed gateway/provider/Vault bindings outside exports; verify key custody, TLS and redaction;
validate migrations on a production copy; allocate provider and n8n execution budgets; run a
staging fixture round-trip and check it cannot create applications. Only then seek the separately
required release/activation approval. Existing Telegram callbacks, Sheets history, Drive resumes,
legacy IDs and schedules remain unchanged. Do not promote the old Submitted button to verified
JobPilot evidence. Resume Ready and AI tailoring remain drafts requiring explicit review.

The application preparer, grouped question review and verified assessment production are still
separate work. Ingestion v1 lacks sufficient policy evidence, so normal policy previews remain
in review. All unrestricted providers and final submission entry points remain disabled.
