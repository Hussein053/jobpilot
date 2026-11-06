# DRY_RUN development review status

The owner confirmed the HTTPS iPhone demo loads and signs in. The screenshot review identified
misleading Pilot setup prompts and a consumed single-job fixture. This follow-up makes
Preparation a primary mobile destination, hides agent/mailbox setup unless a verified server
policy allows unrestricted agents (the current policy never does), exposes existing preparation
navigation without weakening duplicate protection, filters inactive approved resume choices,
and seeds ten distinct jobs across the three configured roles. Verification consumes one job
and leaves nine available.

The stack was reviewed for submission boundaries, encryption, approval concurrency, migration
preservation, structured discovery, retry ledgers, preview credential handling and PWA privacy.
One relay defect was fixed: a bounded invocation processing older tasks could falsely report a
new claim complete. Deferred or denied unfinished work now reports partial; an allowed grant
without a verified query stops before provider access. Frozen work remains idempotent.

## Source integration

| PR | Scope | Review disposition |
| --- | --- | --- |
| #1–#3 | Enforced DRY_RUN, versioned settings API, signed ingestion | Already merged; final controls and unrestricted hosts remain disabled |
| #4 | Settings interface and private-cache-safe PWA | Reviewed; physical iPhone demo owner-confirmed, persistent-origin installation still pending |
| #5 | Versioned resume approval | Reviewed; only active approved versions can be selected, automatic matching remains deterministic rather than a calibrated score |
| #6 | Encrypted Information Bank | Reviewed; current approvals and exact-job sensitive scopes remain required |
| #7 | Structured JSearch adapter | Reviewed against existing workflow analysis; real provider response/entitlement remains unverified |
| #8 | Conservative eligibility and quota preview | Reviewed; unknown evidence requires review and simulations never become submitted applications |
| #9 | Durable planner and secure delivery relay | Reviewed; completion-reporting correction in follow-up; actual managed signer/identity/hosting remains unconfigured |
| #10 | Confined preparation and temporary HTTPS preview | Prior CI and actual HTTPS frontend/API/database browser flow passed; remains draft and unmerged |
| #11 | Encrypted used-answer archives and preview publication | Prior exact-head CI passed; follow-up UI/relay/security tests must pass again before source integration |

Reviews do not imply production readiness, external activation or permission to bypass checks.
No PR beyond the already-authorized #1–#3 merge sequence is merged by this follow-up. The
integrated development branch contains the stacked features without changing main.

A consolidated draft integration PR on `feat/jobpilot-dry-run-release` targets main so the
complete tree can be tested and reviewed in one place. It does not close, merge or replace the
stacked PRs automatically. Only this additional explicit owner branch is allowed to request a
synthetic preview; public-repository and same-owner checks remain required.

## Remaining implementation limits

- The in-process fixture worker is demonstrable, but is not an employer browser. Unrestricted
  Codex, Claude, Playwright MCP, terminal start/update/replacement and Pilot execution remain
  blocked. A separately installed older local host is outside this build's control.
- V1 structured discovery does not establish currency, work arrangement, country or job-specific
  match evidence sufficiently for unattended eligibility. Unknown facts remain review items.
- The relay is a tested library plus inactive workflow template. Actual workload authentication,
  Ed25519 custody, provider connectivity and hourly execution need approved external bindings
  and staging tests. No live 42-node workflow was changed.
- Used-answer archives are immutable historical evidence, not current authorization for reuse.
  Original reference-only simulations have no fabricated value backfill. Account deletion and
  separately managed backup/export retention have different scopes.
- Private persistent hosting, backup/key restore, production-copy migration validation and
  recovery-email delivery must be verified before asking for any real applicant data.

The single owner-action list, hosting options, cost assumptions and permission boundaries are
in [external-setup-handoff.md](external-setup-handoff.md). Build/test evidence belongs to the
exact source head and its GitHub CI run; do not transfer a prior green result to a new head.
