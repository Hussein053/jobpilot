import {
  AUTO_APPLY_DEFAULTS,
  autoApplyPreferencesSchema,
  patchAutoApplySettingsSchema,
} from "@jobpilot/contracts/auto-apply";
import { EMPTY_RESUME_DATA } from "@jobpilot/contracts/resume";
import { reviewResumeSchema } from "@jobpilot/contracts/resume-review";
import { bankFixtureState, handleBankFixture, resetBankFixture } from "./bank-fixture";

let settings = structuredClone(AUTO_APPLY_DEFAULTS);
let version = 0;
let writes = 0;
let history: unknown[] = [];
const resumeId = "1578c15d-e419-4dd5-b23d-16ec6756e3da";
const resume = () => ({
  id: resumeId,
  userId: "f07c6074-6879-4fb0-b300-0475f4bf6ca6",
  label: "Synthetic resume",
  version: 1,
  reviewRevision: 0,
  active: true,
  approved: false,
  approvedAt: null as string | null,
  approvedVersion: null as number | null,
  content: { ...EMPTY_RESUME_DATA, basics: { name: "Fixture Applicant" } },
  sourceFilename: null,
  sourceMimeType: null,
  sourceSizeBytes: null,
  isPrimary: false,
  profileMismatches: [],
  hasData: true,
  variantCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
let currentResume = resume();
let reviewWrites = 0;
const resumeSubscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
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
  idleTimeout: 0,
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
      resetBankFixture();
      currentResume = resume();
      reviewWrites = 0;
      return json({ ok: true });
    }
    if (url.pathname === "/test/external-save") {
      settings = { ...settings, minimumSalaryUSD: 95_000 };
      version++;
      return json(response());
    }
    if (url.pathname === "/test/change-resume") {
      currentResume.version++;
      currentResume.approved = false;
      currentResume.approvedAt = null;
      currentResume.approvedVersion = null;
      const event = new TextEncoder().encode(
        `data: ${JSON.stringify({ type: "content.updated", resumeId, version: currentResume.version })}\n\n`,
      );
      for (const subscriber of resumeSubscribers) {
        try {
          subscriber.enqueue(event);
        } catch {
          resumeSubscribers.delete(subscriber);
        }
      }
      return json({ version: currentResume.version });
    }
    if (url.pathname === "/test/state")
      return json({ ...response(), writes, reviewWrites, ...bankFixtureState() });
    const bankResponse = await handleBankFixture(request, json);
    if (bankResponse) return bankResponse;
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
    if (url.pathname === "/api/resumes") return json([currentResume]);
    if (url.pathname === `/api/resumes/${resumeId}`) return json(currentResume);
    if (url.pathname === `/api/resumes/${resumeId}/events`) {
      let subscriber: ReadableStreamDefaultController<Uint8Array> | undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            subscriber = controller;
            resumeSubscribers.add(controller);
            controller.enqueue(new TextEncoder().encode(": connected\n\n"));
          },
          cancel() {
            if (subscriber) resumeSubscribers.delete(subscriber);
          },
        }),
        { headers: { ...headers, "content-type": "text/event-stream" } },
      );
    }
    if (
      url.pathname === `/api/resumes/${resumeId}/variants` ||
      url.pathname === "/api/pilot/questions"
    )
      return json([]);
    if (url.pathname === `/api/resumes/${resumeId}/review` && request.method === "POST") {
      const parsed = reviewResumeSchema.safeParse(await request.json());
      if (!parsed.success) return json({ code: "UNPROCESSABLE", message: "Invalid review" }, 422);
      const input = parsed.data;
      if (
        input.expectedVersion !== currentResume.version ||
        input.expectedReviewRevision !== currentResume.reviewRevision
      )
        return json({ code: "STALE_WRITE", message: "Reload resume" }, 409);
      currentResume.reviewRevision++;
      reviewWrites++;
      currentResume.approved = input.action === "approve";
      currentResume.approvedAt = currentResume.approved ? new Date().toISOString() : null;
      currentResume.approvedVersion = currentResume.approved ? currentResume.version : null;
      if (input.action === "activate") currentResume.active = true;
      if (input.action === "deactivate") currentResume.active = false;
      return json(currentResume);
    }
    return json(
      { code: "FORBIDDEN", message: "No execution or other API exists in this fixture" },
      403,
    );
  },
});
