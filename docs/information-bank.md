# Application Information Bank

This development branch adds a private, versioned answer library. It does not enable an
application worker or browser execution. Creating, editing, importing, approving, or deleting an
answer cannot create an application, campaign, or Pilot task. Existing application records and
resume/document links remain readable.

## Review and reuse

The Information Bank page supports typed answers, explicit aliases, categories, global/role/
company/job scopes, search, editing, approval, revocation, deletion, history, and explicit export.
Every new answer and import is a draft. Editing invalidates approval. Approval captures the
version displayed before confirmation and requires an unexpired browser session; terminal
tokens cannot read or approve the bank. Concurrent edits fail with a version conflict.

Approval expires within 90 days. Sensitive eligibility, legal, compensation, and personal
questions require an exact job URL and expire within seven days. Passwords, payment credentials,
security codes, and government identifiers are excluded. These checks help constrain known
questions; they cannot reliably recognize every sensitive phrase or secret in arbitrary prose.

The internal resolver returns an answer ID and version only when a trusted, verified question
matches an explicitly saved question or alias, intent, type, choices, scope, and current approval.
It fails closed on unknown questions, expired approvals, conflicting answers, or unverified form
context. Semantic similarity never grants permission. The resolver has no public HTTP endpoint
and is not connected to an application worker in this change.

Contact imports copy explicit profile or owned structured-resume facts into drafts with source
provenance. They do not infer work eligibility, sponsorship, salary, legal declarations, or years
of experience. Resume approval does not approve its imported answers. Duplicate imports preserve
existing answers rather than overwrite them.

## Privacy and retention

Questions, aliases, answer values, scope keys, and provenance are encrypted using per-entry
AES-GCM keys wrapped by the existing per-user encryption service. Audit snapshots use distinct
associated data. Owner-specific HMAC indexes support question-word searches without storing
plaintext questions or indexing answer values. Index equality and word counts still leak some
metadata to a database observer. Categories, intents, scope kinds, dates, and approval status
are database metadata, not encrypted fields.

Search terms travel in a POST body rather than a URL. Responses use no-store, and bank queries
are removed from the client query cache when unused. Mutations do not queue for offline replay.
The PWA does not cache bank responses, pages, or answers. Active UI state necessarily contains
plaintext while the account is using the library. Downloaded JSON exports contain plaintext;
export requires an explicit confirmation and the user controls the resulting file.

Deleting an entry removes its live wrapped key and encrypted entry. Immutable audit metadata and
encrypted historical snapshots remain, but the bank API can no longer decrypt those snapshots.
This is not an assurance of erasure from backups: backups containing old keys require the
operator's backup retention and deletion policy. Account deletion cascades bank rows and audit
metadata. No automatic age-based retention or backup deletion is introduced here.

## Compatibility and remaining work

The migration is additive and does not rewrite historical applications. No local installed
JobPilot terminal or n8n workflow changes. Existing discovery remains available, while legacy
unrestricted terminal/browser application execution stays disabled under enforced DRY_RUN.
Applying migrations to a production copy remains a release prerequisite; development tests use
only synthetic isolated PostgreSQL data.

A grouped unknown-question review queue, use-once decisions, immutable preparation usage
snapshots, policy/quota evaluation, and a confined preparer remain separate development steps.
This library alone cannot prepare or submit an application. Online form verification is not
implemented; arbitrary agents cannot designate a form as verified through the bank API.
