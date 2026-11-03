# PR 2A: enforced dry-run foundation

This development build cannot execute a real job application. The API owns a fixed,
read-only `DRY_RUN` policy, with `liveSubmissionsEnabled=false` and
`unrestrictedAgentsEnabled=false`. Authenticated clients can read it at
`GET /api/execution/policy` (`Cache-Control: no-store`). There is no activation
endpoint, settings field, environment switch, or stored live-mode value. Database
migrations are unnecessary for this single supported execution mode.

## Boundary and intercepted paths

Both Claude and Codex have shell access and direct Playwright MCP tools. They can
submit through a click, Enter, JavaScript, HTTP, a spawned browser, or a different
MCP server. A label filter, a read-only prompt, or blocking only `browser_click`
cannot enforce dry run. Navigation and form filling can themselves trigger writes.
Until there is a confined worker, **all unrestricted provider execution is disabled**.

| Entry point | Enforcement |
| --- | --- |
| Dashboard campaign skills, apply, auto-apply, resume-campaign, retry, and direct terminal commands | Host rejects `/sessions/start`, `/sessions/inject`, and `/ws` before reaching endpoints. |
| Claude and Codex native process launch | `PtyProcess.SpawnWithPtyNet` invokes `ExecutionBoundary.RequireConfinedWorker` before native spawn. It always refuses, even with absent credentials, an unreachable API, or a claimed LIVE mode. |
| Pilot start and restart | `/pilot/start` is rejected; production DI pauses saved Pilot pairing on startup. Any internal launch still reaches the same native spawn guard. |
| Campaign job creation or PATCH into `applying` | API service rejects with 403 before mutating the job. |
| Pilot `job.apply` claim | Shared `startApplying` guard rejects; the run transaction rolls back. |
| Agent reporting a new `applied` outcome | Shared result writer rejects before application/document writes. Replays of existing historical terminal results remain read-only. |
| Automatic or manual host replacement | Startup and explicit updater methods refuse replacement, `/update` is blocked, and `HostHandoff.Relaunch` cannot spawn a replacement. Upstream releases may not contain this boundary. |

The refusal is unconditional for the current executor. A missing, malformed,
unavailable, stale, or even purportedly LIVE remote policy cannot enable it.
There is no cached permission to fail open and no client-supplied mode to trust.

The browser-control policy rejects Enter, Continue, Next, Apply, Save, submit,
navigation, evaluation, uploads, and every other browser action by preventing the
browser-capable provider from starting. No site-specific behavior has been verified
in this PR. Do not treat an apparently harmless control as a safe exception.

## Preserved operations and deliberate limitations

Authentication, profile editing, resume uploads/editing/PDF generation, scoring,
saved searches, API ingestion of discovered jobs, campaign creation/approval,
history, and review management retain their existing APIs. No application is
fabricated for a dry-run attempt. A policy simulator and simulation records are a
later change.

Interactive browser discovery, online form inspection, browser login, browser
preparation, and agent-driven resume extraction/tailoring are unavailable through
the updated host because they share an unrestricted executor. Offline preparation
and existing server-side resume operations remain available. This is the deliberate
fallback required when safe interception cannot be guaranteed, not feature parity
for browser automation.

The shipped skill instructions and MCP configuration remain historical workflows,
not an enforceable boundary. Do not load them in an independently launched CLI
during dry-run development. Such a CLI, an already-running old host, an independently
started Playwright server, or a manually controlled browser is **outside this
build's enforcement**. This code cannot revoke external processes or an OS user's
ability to run programs. Before testing an installed upgrade, terminate older
hosts/agents/browsers and use the guarded build. No running processes were altered
as part of this PR. Do not use production board credentials for fixtures.

No n8n workflow, deployment, live activation, or real application is part of PR 2A.
The safeguards apply only when this branch's API and host are actually used;
updating the API alone cannot stop an old agent from clicking in its local browser.

## Impact on existing searches and local installations

This PR updates source on a development branch. Opening or merging a PR does not
upgrade the user's installed terminal host, stop an existing agent, modify n8n,
or install software on an iPhone. No local installation or running process was
changed during this review.

When the guarded API and host are eventually installed together in an explicitly
authorized environment, expect the following:

- Saved searches, query text, board settings, search history, campaigns, queued and
  approved jobs, application history, resumes, and document links remain stored.
  There is no migration, historical-data rewrite, or destructive reset.
- The guarded host pauses a saved Pilot pairing by persisting `Running=false`.
  It preserves the pairing's provider, token, and API/web addresses. The API's
  separate Pilot running flag is not automatically rewritten and may still appear
  enabled; the local host nevertheless cannot execute work.
- Hourly/adaptive browser discovery, auto-apply, apply-to-links, retries, networking,
  Upwork browser work, and agent-based extraction/tailoring do not run. Scheduled
  searches will not silently catch up through this host. Saving a search or
  approving a job does not launch an agent or consume application quota.
- Existing browser sessions are not resumed, controlled, or invalidated by this
  change. Board logins and Playwright profile files are not removed. Server-side
  authentication, applicant settings, scoring, resume editing/PDF rendering, and
  historical application reads remain available.
- The dock's host status reports `degraded` with a DRY_RUN explanation. Session
  start, command injection, WebSocket access, Pilot start, and update requests
  return 403. Stop, shutdown, and health endpoints remain available.
- This development build cannot self-update. An approved future upgrade requires
  explicit replacement with a reviewed build that retains the boundary. Do not
  run an upstream installer or replace it with a normal unrestricted release as
  a way to clear the degraded status.

For a future installation, first back up the installation's state and identify
all running old hosts/agents. Shut them down before starting the guarded build;
use a separate development installation and database where practical. Verify
the read-only API policy, degraded host status, and denied start/update requests.
These are installation instructions, not actions performed or authorized by this
PR. An API-only update, PWA refresh, or source checkout cannot constrain a still
running unrestricted installation on another computer.

## Tests and future work

API tests cover immutable/read-only policy, authentication, forged mode inputs,
blocked campaign/Pilot transitions, and blocked applied-result writes. Terminal
tests cover both production provider launch paths, the native spawn boundary, and
HTTP/WebSocket entry-point refusals. Existing low-level PTY tests use injected fake
connections; they never invoke the native spawn function or launch a browser.

Historical recording coverage lives in `job-result.store.test.ts`. The data-only
`persistJobResult` routine has no browser, process, network, or activation capability.
It is exercised with fake Prisma state for application/event recording, resume and
cover-letter linking, rollback, and idempotency. Production command handling goes
through `writeJobResult`, which checks ownership and refuses every new applied
outcome before invoking persistence. No test injects an allow-policy, changes the
DRY_RUN constant, or adds a historical-import endpoint.

`execution-routes.test.ts` mounts the real application, campaign-job, and Pilot
controllers with fixture-backed services. It checks denied execution commands,
readable historical lists/detail, owner isolation, and repeated read-only result
replays. Duplicate URL/fuzzy/in-flight checks retain their own independent tests.
Terminal tests enumerate the mapped host route inventory, check both providers,
load a saved pairing through production DI, and test updates with `CanUpdate=true`
as well as a development installation. Replacement launch is also denied directly.
The database tests model transactions and races in memory; they are not evidence
of real PostgreSQL concurrency or durability. No database or live-board integration
test was run, and no historical application data was changed.

Run `bun run test`, API/web typechecks, Biome, knip, and `dotnet test`. No live-board
integration test is appropriate. A future confined executor needs process/network
isolation, exclusive ownership of its browser tools, verified operation contracts,
and a fresh server policy check before each operation. It must control every
egress path, including GET/navigation side effects, JavaScript, shell, alternate
tools, and file uploads. Server-side pre-submit policy and atomic quota checks
remain required before any separately approved activation milestone.
