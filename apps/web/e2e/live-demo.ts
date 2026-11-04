import { readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { z } from "zod/v4";

// Opt-in real local API verification. Never use fixture response interception here.
if (process.env.JOBPILOT_LOCAL_DEMO !== "1")
  throw new Error("Set JOBPILOT_LOCAL_DEMO=1 for the isolated synthetic demo.");
const demo = z
  .object({ email: z.email(), password: z.string(), preparationId: z.uuid() })
  .parse(JSON.parse(await readFile("/tmp/jobpilot-mvp/demo.json", "utf8")));
const preview = process.env.JOBPILOT_PREVIEW_URL;
if (preview && !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(preview))
  throw new Error("Only an HTTPS ephemeral preview origin is accepted.");
const web = preview ?? "http://127.0.0.1:4100";
const api = preview ? `${web}/api` : "http://127.0.0.1:4101/api";
const check = expect.configure({ timeout: 30000 });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(60000);
const errors: string[] = [];
await context.route("**/*", (route) =>
  [web, new URL(api).origin].includes(new URL(route.request().url()).origin)
    ? route.continue()
    : route.abort(),
);
await context.routeWebSocket("**/*", (socket) => {
  if (!preview && new URL(socket.url()).origin === "ws://127.0.0.1:4100") socket.connectToServer();
  else socket.close();
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const steps: string[] = [];
try {
  await page.goto(`${web}/login`);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(demo.email);
  await page.getByLabel("Password", { exact: true }).fill(demo.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  steps.push("ordinary password sign-in");
  if (preview) {
    const session = (await context.cookies(web)).find((cookie) => cookie.name === "session");
    check(session?.secure).toBe(true);
    check(session?.httpOnly).toBe(true);
    check(session?.sameSite).toBe("Lax");
    steps.push("HTTPS session cookie is Secure, HttpOnly and SameSite=Lax");
  }
  await page.goto(`${web}/preparation`);
  await check(page.getByText(/DRY_RUN MVP — no applications will be submitted/)).toBeVisible();
  await page.getByRole("button", { name: "View preparation", exact: true }).first().click();
  const endpoint = `${api}/preparations/${demo.preparationId}`;
  const initial = z
    .object({ status: z.string() })
    .parse(await (await context.request.get(endpoint)).json());
  if (initial.status !== "simulated") {
    await check(
      page.getByRole("button", { name: "Run confined simulation", exact: true }),
    ).toBeDisabled();
    await page.screenshot({ path: "/tmp/jobpilot-mvp/review-desktop.png", fullPage: true });
    steps.push("required unanswered question blocks simulation");
    const created = await context.request.post(`${api}/information-bank/`, {
      headers: { origin: web },
      data: {
        question: "Describe your experience leading cross-functional teams.",
        aliases: [],
        intent: "other",
        category: "experience",
        scope: "global",
        scopeKey: null,
        answer: {
          kind: "text",
          value:
            "SYNTHETIC FIXTURE ONLY: fictional team coordination; not a real applicant qualification.",
        },
      },
    });
    if (!created.ok()) throw new Error(`Bank draft failed ${created.status()}`);
    const entry = z.object({ id: z.uuid(), version: z.number() }).parse(await created.json());
    const approved = await context.request.post(`${api}/information-bank/${entry.id}/approve`, {
      headers: { origin: web },
      data: {
        expectedVersion: entry.version,
        reviewDueAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    if (!approved.ok()) throw new Error(`Bank approval failed ${approved.status()}`);
    steps.push("synthetic draft created and explicitly approved through actual authenticated API");
    await page.getByRole("button", { name: "Refresh approved answers", exact: true }).click();
    await check(page.getByText(/Approved Information Bank entry/)).toHaveCount(2);
    await page.getByRole("button", { name: "Approve dry-run exceptions", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Approve dry-run exceptions", exact: true })
      .click();
    await check(
      page.getByRole("button", { name: "Run confined simulation", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Run confined simulation", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Run simulation", exact: true })
      .click();
  }
  await check(page.getByText(/Simulation complete. No application was submitted./)).toBeVisible();
  await check(page.getByText(/Optional · boolean · review/)).toBeVisible();
  steps.push("UI exception approval and confined simulation; optional sensitive answer omitted");
  await page
    .getByText(/Simulation complete. No application was submitted./)
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/jobpilot-mvp/simulated-desktop.png", fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: "View preparation", exact: true }).first().click();
  await check(page.getByText(/Simulation complete. No application was submitted./)).toBeVisible();
  const state = z
    .object({
      status: z.literal("simulated"),
      simulation: z.object({
        submitted: z.literal(false),
        finalControlBlocked: z.literal(true),
        evidence: z.array(z.string()),
      }),
      audit: z.array(z.unknown()),
    })
    .parse(await (await context.request.get(endpoint)).json());
  for (const control of ["Submit", "Enter", "Continue", "Next", "Apply", "Save"])
    check(state.simulation.evidence).toContain(`blocked_control:${control}`);
  steps.push("persisted audit and all six blocked controls verified from real backend");
  await page.setViewportSize({ width: 390, height: 844 });
  await check
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page
    .getByText(/Simulation complete. No application was submitted./)
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/jobpilot-mvp/simulated-phone.png", fullPage: true });
  const manifest = await context.request.get(`${web}/manifest.webmanifest`);
  check(manifest.ok()).toBe(true);
  const manifestData = z
    .object({
      display: z.literal("standalone"),
      icons: z.array(z.object({ src: z.string() })).min(2),
    })
    .parse(await manifest.json());
  check(manifestData.icons.some((icon) => icon.src === "/icon-192.png")).toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
  });
  await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Service worker not ready")), 20000),
      ),
    ]),
  );
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        urls.push(new URL(request.url).pathname);
    return urls;
  });
  check(cached.every((path) => ["/offline.html", "/icon-192.png"].includes(path))).toBe(true);
  const applications = z
    .object({ pagination: z.object({ total: z.literal(0) }) })
    .parse(await (await context.request.get(`${api}/applied/?page=1&limit=1`)).json());
  const policy = z
    .object({
      submissionMode: z.literal("DRY_RUN"),
      liveSubmissionsEnabled: z.literal(false),
      unrestrictedAgentsEnabled: z.literal(false),
    })
    .parse(await (await context.request.get(`${api}/execution/policy`)).json());
  check(applications.pagination.total).toBe(0);
  check(policy.liveSubmissionsEnabled).toBe(false);
  steps.push(
    "historical Application count remains zero and server execution policy remains enforced DRY_RUN",
  );
  check(errors).toEqual([]);
  await writeFile(
    "/tmp/jobpilot-mvp/browser-report.json",
    JSON.stringify(
      {
        passed: true,
        backend: "real API and PostgreSQL",
        steps,
        mobile: "390x844 Chromium; no horizontal overflow",
        pwa: {
          manifest: true,
          worker: true,
          privateDataCached: false,
          cachedPaths: cached,
          physicalIPhone: "not verified",
        },
        auditEvents: state.audit.length,
        submitted: false,
      },
      null,
      2,
    ),
  );
  console.log("Real browser DRY_RUN flow passed; desktop, phone and PWA evidence saved.");
} catch (error) {
  await page.screenshot({ path: "/tmp/jobpilot-mvp/browser-failure.png", fullPage: true });
  await writeFile(
    "/tmp/jobpilot-mvp/browser-report.json",
    JSON.stringify({ passed: false, steps, failure: String(error), pageErrors: errors }, null, 2),
  );
  console.error("Real browser verification failed; inspect local browser-report.json");
  process.exitCode = 1;
} finally {
  await browser.close();
}
