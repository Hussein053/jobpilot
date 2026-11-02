# Version-specific resume approval

An owned master resume now exposes its active state, current content version, review revision,
and approval of that version in list/detail responses. Existing resumes remain readable and are
not implicitly approved. Primary selection and n8n's `Resume Ready` status do not grant approval.

The detail screen asks the user to review the saved preview and explicitly confirm approval.
Unsaved edits are excluded. The settings fixed-resume picker offers only active, currently
approved master resumes. Variants are outside this approval and cannot inherit it for preparation.

`POST /api/resumes/:id/review` accepts only `action`, `expectedVersion`, and
`expectedReviewRevision`. Actions are `approve`, `revoke`, `activate`, and `deactivate`. A current,
unrevoked browser-session token is required independently of the general auth guard; terminal
tokens cannot make these decisions. Missing, expired, foreign, and unverifiable authority fails
closed. Approval requires active state and valid structured content or an available source file.

Content and source changes invalidate approval. Source replacement/removal now increments the
resume version too, preventing a stale review from approving a different file under an old
version. Label-only edits preserve content approval. Review revisions serialize competing
decisions independently of content versions. Deactivation clears approval; activation requires
another explicit review. Neither action changes the application's execution boundary.

Each explicit decision and its actor token ID, resume version, and review revision are saved in
the same database transaction. Audit failure rolls back approval. The review history is
append-only while the owner exists, survives deletion of the resume, and cascades on account
deletion. `GET /api/resumes/:id/reviews` returns paginated history only for that owner and never
returns the actor credential. No resume content is copied into review events. Responses from the
review routes use `Cache-Control: no-store`.

The additive migration is `20261102160000_resume_reviews`. Validation uses synthetic accounts
and files in a disposable PostgreSQL 17 container with no network or published ports. No restored
production snapshot has been tested or modified; production-copy verification remains a release
prerequisite. Fixture browser checks cover explicit confirmation and revocation at desktop and
phone widths. Live submissions and unrestricted worker execution remain disabled; approval is
only a prerequisite for future confined preparation, not submission authorization.
