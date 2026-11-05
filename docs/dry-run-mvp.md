# Local DRY_RUN MVP

This development branch runs the existing Next.js frontend, Elysia API and PostgreSQL together. It does not run the unrestricted terminal host. Application preparation uses a deterministic synthetic form; it does not visit an employer website. All real submission paths remain blocked by the server and terminal host.

## Start on an isolated machine

Prerequisites: Bun, PostgreSQL 17 (or Docker), and the repository dependencies. This example database contains synthetic data only. Do not use the production tunnel or an existing applicant database.

```sh
docker run -d --name jobpilot-mvp-persistent \
  -p 127.0.0.1:15432:5432 \
  -v jobpilot-mvp-data:/var/lib/postgresql/data \
  -e POSTGRES_USER=jobpilot_fixture \
  -e POSTGRES_PASSWORD=local_synthetic_only \
  -e POSTGRES_DB=jobpilot_mvp_local postgres:17
export DATABASE_URL=postgresql://jobpilot_fixture:local_synthetic_only@127.0.0.1:15432/jobpilot_mvp_local
export SECRET_MASTER_KEY="$(openssl rand -base64 32)"
export NODE_ENV=development
export CORS_ORIGINS=http://127.0.0.1:4100
export APP_URL=http://127.0.0.1:4100
export NEXT_PUBLIC_API_URL=http://127.0.0.1:4101
export INTERNAL_API_URL=http://127.0.0.1:4101
bun install --frozen-lockfile
bun --cwd=apps/api run db:generate
bun --cwd=apps/api run db:migrate:apply
bun run dev:api
```

Keep the environment, including the randomly generated master key, in both local development shells. Start `bun run dev:web --hostname 127.0.0.1` in the second shell. Do not use the root `dev` command for this MVP because it also starts the disabled terminal host. Keep the same encryption key across restarts; store it privately outside Git if retaining the database. The named local volume preserves synthetic data across container restarts; do not remove it unless deliberately resetting the fixture. No production backup or migration has been attempted.

The frontend is `http://127.0.0.1:4100`, API health is `http://127.0.0.1:4101/health`. These URLs refer to the machine running the processes; a remote cloud workspace requires an authorized port-forward before a different device can reach them. No public preview or production site is implied.

## Demonstrate

With the API running and the same isolated environment:

```sh
bun --cwd=apps/api run scripts/dry-run-demo.ts
```

The script refuses any database except loopback `jobpilot_mvp_local`. It creates a random synthetic account using normal registration, two resume versions approved through the review API, and an approved contact answer. It maps a structured JSearch-shaped fixture, verifies deduplication, signs exact ingestion bytes using a transient in-memory Ed25519 key, and confirms the signed API returns `stored_only`. Only the public verification key enters the local database. No n8n Cloud workflow or provider is contacted.

It then checks the server's DRY_RUN policy, evaluates the conservative policy preview, creates a preparation and verifies simulation is refused for the unanswered required experience question. No `Application` record may exist. Generated local login credentials and session are written to mode-0600 `/tmp/jobpilot-mvp/demo.json`; do not commit, upload or copy that private file into reports.

Sign in using that local fixture account. Open `/preparation`, then select its history row. In `/information-bank`, create an answer to the exact question **Describe your experience leading cross-functional teams.**, intent **Other**, category **Experience**, global scope, text answer. Explicitly label its value synthetic and approve it. Return to preparation, refresh approved answers, review the unverified-eligibility warnings and approve exceptions for this simulation. Run the confined simulation. New simulations also retain encrypted used-answer copies; the explicit historical-answer reveal is private and does not authorize reuse. The result must say `simulated`, `submitted: false`, and show blocked Submit/Enter/Continue/Next/Apply/Save evidence. The optional sensitive sponsorship answer remains unanswered and omitted.

Simulation is idempotent and counts against shared daily simulation capacity. Historical applications remain separate. Resume or answer revocation, expired approval, stale settings, stale revisions, cross-user requests, terminal credentials and exhausted capacity must block a new simulation.

## Availability and release limits

- Settings, resume review, Information Bank, signed ingestion, conservative policy preview, preparation, exception review, simulation and history are integrated on the development branch.
- Real employer forms, unrestricted Codex/Claude browser execution and live submissions are disabled. The confined mapper provides synthetic evidence, not real browser submission evidence or verified employer eligibility.
- n8n Cloud, JSearch credentials, a hosted authenticated relay and managed signing-key custody are not configured. The inactive companion workflow is not activated. Provider budgets default to zero and discovery policy defaults disabled.
- Hourly multi-role planning and durable relay ledgers have automated synthetic coverage; no live hourly search schedule is running.
- The PWA has a manifest, icons and a privacy-restricted offline shell. Chromium mobile emulation is not physical iPhone/Safari installation verification. A phone needs HTTPS and reachable API/CORS/cookie origins; localhost on the phone is a different machine.
- Secure production release needs reviewed environment origins, TLS, persistent database/storage, managed encryption/signing keys, backups, monitoring, provider access and actual Safari checks. Restore-and-migrate testing of a sanitized production snapshot remains a release prerequisite.
- Local execution needs no paid service. Production costs depend on chosen hosting, database/storage, n8n execution plan, search credits and managed signer; no infrastructure has been purchased or provisioned.

Production deployment, paid infrastructure, changes to live n8n workflows or production credentials, and enabling real applications require separate authorization. Merging foundations does not upgrade or stop an old local installation; users must deliberately install a reviewed guarded build. This build's updater cannot replace itself with an unrestricted executable.

## Restartable local launcher

`PATH=/path/to/bun/bin:$PATH python3 scripts/local-dry-run.py setup` generates a private random encryption key and fixed loopback runtime configuration under ignored `.tmp/jobpilot-mvp/` and migrates the synthetic database. Run `api` and `web` in separate shells, then `seed` and `browser` for the real-stack demonstration. The browser command also needs Playwright Chromium installed (`bunx playwright install chromium --only-shell` from `apps/web`). The launcher never starts the terminal host and refuses a changed database URL. It does not start Docker or obtain additional platform permissions. Start the named fixture container separately when necessary.

Runtime secrets, local demo sessions, logs, and screenshots stay in the ignored private state directory. `/tmp/jobpilot-mvp` points to that directory for the demonstration scripts. Next.js generated cache remains ephemeral in `/tmp/jobpilot-cache`; it contains no durable settings or encryption keys. The current workspace uses a local, uncommitted `.next` symlink to that cache because its persistent filesystem is nearly full. The launcher does not alter a normal installation's Next.js build directory. A stopped remote workspace still requires restarting its processes before its local URL can be used; a persistent volume alone is not an always-on preview deployment.
