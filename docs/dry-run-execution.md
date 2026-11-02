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
| Automatic or manual host replacement | Startup and explicit updater methods refuse replacement, and `/update` is blocked. Upstream releases may not contain this boundary. |

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

## Tests and future work

API tests cover immutable/read-only policy, authentication, forged mode inputs,
blocked campaign/Pilot transitions, and blocked applied-result writes. Terminal
tests cover both production provider launch paths, the native spawn boundary, and
HTTP/WebSocket entry-point refusals. Existing low-level PTY tests use injected fake
connections; they never invoke the native spawn function or launch a browser.

Run `bun run test`, API/web typechecks, Biome, knip, and `dotnet test`. No live-board
integration test is appropriate. A future confined executor needs process/network
isolation, exclusive ownership of its browser tools, verified operation contracts,
and a fresh server policy check before each operation. It must control every
egress path, including GET/navigation side effects, JavaScript, shell, alternate
tools, and file uploads. Server-side pre-submit policy and atomic quota checks
remain required before any separately approved activation milestone.
