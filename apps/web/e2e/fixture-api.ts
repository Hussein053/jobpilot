import {
  AUTO_APPLY_DEFAULTS,
  autoApplyPreferencesSchema,
  patchAutoApplySettingsSchema,
} from "@jobpilot/contracts/auto-apply";

let settings = structuredClone(AUTO_APPLY_DEFAULTS);
let version = 0;
let writes = 0;
let history: unknown[] = [];
const runtime = {
  submissionMode: "DRY_RUN",
  liveSubmissionsEnabled: false,
  unrestrictedAgentsEnabled: false,
};
const response = () => ({
  settings,
  version,
  updatedAt: version ? new Date().toISOString() : null,
  resumeReady: false,
  runtime,
});

// Synthetic API only: never starts the production API or a database connection.
Bun.serve({
  hostname: "127.0.0.1",
  port: 4491,
  async fetch(request) {
    const url = new URL(request.url);
    const headers = {
      "access-control-allow-origin": "http://127.0.0.1:4100",
      "access-control-allow-credentials": "true",
      "access-control-allow-methods": "GET,PATCH,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "cache-control": "no-store",
    };
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname === "/test/reset") {
      settings = structuredClone(AUTO_APPLY_DEFAULTS);
      version = 0;
      writes = 0;
      history = [];
      return json({ ok: true });
    }
    if (url.pathname === "/test/external-save") {
      settings = { ...settings, minimumSalaryUSD: 95_000 };
      version++;
      return json(response());
    }
    if (url.pathname === "/test/state") return json({ ...response(), writes });
    if (url.pathname === "/api/auth/me")
      return json({
        id: "f07c6074-6879-4fb0-b300-0475f4bf6ca6",
        email: "fixture@example.test",
        emailVerified: true,
        role: "USER",
        firstName: "Fixture",
        lastName: "Applicant",
        username: "fixture",
        providers: [],
        contactEmail: "fixture@example.test",
      });
    if (url.pathname === "/api/auto-apply/settings") {
      if (request.method === "GET") return json(response());
      if (request.method !== "PATCH")
        return json({ code: "FORBIDDEN", message: "Fixture operation denied" }, 403);
      const parsed = patchAutoApplySettingsSchema.safeParse(await request.json());
      if (!parsed.success) return json({ code: "UNPROCESSABLE", message: "Invalid settings" }, 422);
      if (parsed.data.expectedVersion !== version)
        return json({ code: "STALE_WRITE", message: "Changed elsewhere" }, 409);
      const next = autoApplyPreferencesSchema.safeParse({ ...settings, ...parsed.data.changes });
      if (!next.success)
        return json({ code: "UNPROCESSABLE", message: "Invalid preferences" }, 422);
      const previousPreferences = structuredClone(settings);
      settings = next.data;
      version++;
      writes++;
      history.unshift({
        id: crypto.randomUUID(),
        previousVersion: version - 1,
        version,
        previousPreferences,
        preferences: settings,
        createdAt: new Date().toISOString(),
      });
      return json(response());
    }
    if (url.pathname === "/api/auto-apply/audit")
      return json({
        items: history,
        pagination: {
          page: 1,
          limit: 10,
          total: history.length,
          totalPages: history.length ? 1 : 0,
        },
      });
    if (url.pathname === "/api/resumes" || url.pathname === "/api/pilot/questions") return json([]);
    return json(
      { code: "FORBIDDEN", message: "No execution or other API exists in this fixture" },
      403,
    );
  },
});
