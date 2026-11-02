import { expect, test } from "@playwright/test";

const fixtureApi = "http://127.0.0.1:4491";
test.beforeEach(async ({ context, request }) => {
  await request.post(`${fixtureApi}/test/reset`);
  await context.route("**/*", (route) => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:4100", fixtureApi].includes(origin)
      ? route.continue()
      : route.abort();
  });
  await context.routeWebSocket("**/*", (socket) => {
    if (new URL(socket.url()).port === "4100") socket.connectToServer();
    else socket.close();
  });
});

test("saves validated preferences, reverts drafts, and displays history without activating execution", async ({
  page,
  request,
}) => {
  await page.goto("/settings/auto-apply");
  await expect(
    page.getByText("DRY RUN — NO APPLICATIONS WILL BE SUBMITTED", { exact: true }),
  ).toBeVisible();
  const salary = page.getByRole("spinbutton", { name: "Minimum annual base salary (USD)" });
  await expect(salary).toHaveValue("80000");
  await salary.fill("90000");
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.getByText("Saved version: 1", { exact: true })).toBeVisible();
  await expect(page.getByText(/Version 1 ·/)).toBeVisible();
  await salary.fill("100000");
  await page.getByRole("button", { name: "Cancel / revert", exact: true }).click();
  await expect(salary).toHaveValue("90000");
  const state = await (await request.get(`${fixtureApi}/test/state`)).json();
  expect(state.writes).toBe(1);
  expect(state.runtime).toEqual({
    submissionMode: "DRY_RUN",
    liveSubmissionsEnabled: false,
    unrestrictedAgentsEnabled: false,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("retains a stale draft and requires explicit reload before resolving a conflict", async ({
  page,
  request,
}) => {
  await page.goto("/settings/auto-apply");
  const salary = page.getByRole("spinbutton", { name: "Minimum annual base salary (USD)" });
  await expect(salary).toHaveValue("80000");
  await salary.fill("110000");
  await request.post(`${fixtureApi}/test/external-save`);
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.getByText(/Settings changed elsewhere. Your edits are retained/)).toBeVisible();
  await expect(salary).toHaveValue("110000");
  await page.getByRole("button", { name: "Reload saved", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(salary).toHaveValue("95000");
  expect((await (await request.get(`${fixtureApi}/test/state`)).json()).writes).toBe(0);
});

test("does not send invalid preferences to the API", async ({ page, request }) => {
  await page.goto("/settings/auto-apply");
  const salary = page.getByRole("spinbutton", { name: "Minimum annual base salary (USD)" });
  await expect(salary).toHaveValue("80000");
  await salary.fill("-1");
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.getByText("Fix the highlighted fields before saving.")).toBeVisible();
  expect((await (await request.get(`${fixtureApi}/test/state`)).json()).writes).toBe(0);
});

test("uses a generic offline fallback without caching private pages or API data", async ({
  page,
  context,
}) => {
  await page.goto("/settings/auto-apply");
  await expect(page.getByText("Saved version: 0", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const cached = await page.evaluate(async () => {
    const results: string[] = [];
    for (const name of await caches.keys())
      for (const key of await (await caches.open(name)).keys())
        results.push(new URL(key.url).pathname);
    return results.sort();
  });
  expect(cached).toEqual(["/icon-192.png", "/offline.html"]);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("You’re offline", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture Applicant", { exact: true })).toHaveCount(0);
});
