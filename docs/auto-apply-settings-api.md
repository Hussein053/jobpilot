# Versioned Auto-Apply Settings API

This change is based on PR 1's enforced dry-run branch. It adds preferences and
history only: no activation, browser execution, scheduling, worker integration,
policy preview, n8n change, or deployment. `autoApplyRequested=true` is a saved
preference and never permission to submit.

## Endpoints

All routes require the existing session cookie or terminal bearer token. The
authenticated principal supplies the owner and audit actor; request bodies cannot
choose either. Responses use `Cache-Control: no-store`.

- `GET /api/auto-apply/settings`: `{settings, version, updatedAt, resumeReady, runtime}`.
  With no saved record, returns version `0`, `updatedAt=null`, and the requested
  defaults without creating a row. Runtime always reports `DRY_RUN`,
  `liveSubmissionsEnabled=false`, and `unrestrictedAgentsEnabled=false`.
- `PATCH /api/auto-apply/settings`: `{expectedVersion, changes}`. `changes` is a
  nonempty partial preference object. Unknown keys, execution controls, and owner
  IDs are rejected, including when nested under `changes`. Validation errors are
  422; a stale version is 409 with code `STALE_WRITE`. Each successful save
  increments the version, including an explicit save of unchanged values.
- `GET /api/auto-apply/audit?page=1&limit=25`: paginated history for this user,
  newest version first. Snapshots include previous/new preferences and versions,
  plus timestamps. There is no update, delete, or activation endpoint.

Example first save:

```json
{
  "expectedVersion": 0,
  "changes": {
    "minimumSalaryUSD": 80000,
    "roles": ["Program Manager", "Project Manager", "Business Analyst"],
    "timeZone": "America/New_York"
  }
}
```

Use the version returned by GET or the last successful PATCH. On 409, reload and
let the user reconcile changes; do not blindly retry with the new version. PATCH
returns its own committed snapshot, not a later writer's settings. Reads cannot
change execution state.

## Preference semantics

Defaults preserve the implementation specification: $80,000 minimum annual base
USD; missing salary allowed; the three requested roles; US nationwide;
Remote/Hybrid/On-site; daily cap 50; hourly search; automatic resume selection;
match threshold 85/100; exception approval required. Added scheduling defaults are
explicitly `timeZone="UTC"` and `runHours=[9,13,17]`; no timezone is inferred from
the applicant's location.

Salary must be a nonnegative integer within PostgreSQL integer range; cap is
1–100 and match threshold 50–100. Role names are trimmed while preserving spelling
and capitalization; empty or case-insensitive duplicate roles are rejected.
Arrangements must be nonempty, unique, and drawn from the three supported values.
The new API always requires `approvalForExceptions=true`.

`searchFrequency` is `hourly`, `three_times_daily`, or `manual`. The future
scheduler must interpret hourly as each local hour boundary, three-times-daily as
the three distinct 0–23 local hours in `runHours`, and manual as no scheduled
search. An IANA timezone is required. DST repetition/gap handling, role rotation,
provider quotas, and daily quota reservations belong to the simulator/scheduler
milestone; this API creates no runs and returns no invented quota/preview counts.

`resumeSelection` is `auto`, `manual`, or `fixed`. Fixed selection requires an
owned, active, approved resume and a `fixedResumeId`; other modes require that ID
to be null. Switch both fields together. New approval metadata is additive:
existing resumes remain active but have `approvedAt=null` and `approvedVersion=null`, requiring explicit
approval in a later feature. No existing upload/editor route can set that field.
There is no approval endpoint in this PR. An approval stamp is usable only when
`approvedVersion` equals the current resume version; content edits invalidate
readiness. Source replacement/removal clears both approval fields. `resumeReady=false` warns that no usable
approved resume exists. Deleting/revoking/deactivating a resume does not rewrite
policy history; readiness is rechecked and future workers must check again before
use. A fixed ID deliberately is not a cascading foreign key that blocks the
existing resume-deletion flow.

## Persistence and migration

`AutoApplyPolicy` stores validated fields in relational columns, with a per-user
version and updated timestamp. `AutoApplyAuditEvent` holds append-only snapshots
and the actor token's ID, never the bearer token or applicant answers. The policy
write and audit insert share a transaction; version-conditional updates and
unique constraints allow only one save for a given version, including competing
first saves. Database constraints reinforce numeric bounds and required arrays.

An UPDATE/DELETE trigger protects history while its owner exists. Account deletion
still cascades, preserving the existing deletion flow; history is not retained
after account deletion. A database administrator can disable triggers and remains
inside the trusted administrative boundary. Per-user isolation follows existing
application authorization conventions; this migration does not introduce RLS.

The migration adds tables and resume approval metadata. It does not rewrite,
delete, or infer approval for legacy settings, Pilot instructions, profiles,
resumes, or application records. Existing `AutoApplySettings` and
`PilotState.instructionsConfig` remain legacy configuration. The new policy is
the canonical input for the future simulator; existing skills are not switched
over here. Do not treat changing this API as changing an old installation's search
settings. Browser execution remains disabled throughout the transition.

The SQL was generated by comparing the checked-in baseline schema to the new
schema, with reviewed constraints/triggers added. Validation uses the repository's
baseline migrations, synthetic legacy records, and a network-isolated PostgreSQL
17 container. No production dump, connection, migration, or deployment is used;
compatibility with a real production snapshot remains a release prerequisite.

## Verification

The normal API/contracts suites test authentication, strict validation, version
conflicts, history ownership, wire round-trips, and unchanged DRY_RUN controls.
`auto-apply.postgres.test.ts` is opt-in using `JOBPILOT_TEST_DATABASE_URL`; it refuses
anything except loopback and database `jobpilot_settings_test`. It never inherits
`DATABASE_URL` as its test connection. Run it only in a dedicated disposable test
database after applying all checked-in migrations:

```sh
STORAGE_ROOT=/tmp/jobpilot-settings-resumes \
JOBPILOT_TEST_DATABASE_URL=postgresql://postgres:fixture@127.0.0.1:5432/jobpilot_settings_test \
  bun --cwd=apps/api test src/modules/auto-apply/auto-apply.postgres.test.ts
```

These tests create synthetic users and exercise real concurrent first saves,
optimistic updates, audit failure rollback, immutable history, resume checks, and
account-deletion cascades. They do not run agents or submit applications. The new
migration must be reviewed and tested against a restored production copy before
any separately authorized release. PR 1 remains unmerged.
