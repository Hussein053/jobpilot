import { expect, test } from "@playwright/test";

const fixtureApi = "http://127.0.0.1:4491";
test.beforeEach(async ({ context, request }) => {
  await request.post(`${fixtureApi}/test/reset`);
  await context.route("**/*", (route) =>
    ["http://127.0.0.1:4100", fixtureApi].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  );
  await context.routeWebSocket("**/*", (socket) => {
    if (new URL(socket.url()).port === "4100") socket.connectToServer();
    else socket.close();
  });
});
test("shows saved quota separately and records review-only simulation after confirmation", async ({
  page,
  request,
}) => {
  await page.goto("/settings/auto-apply");
  await expect(
    page.getByText("Recorded applications today: 2. Remaining actual quota: 48 of 50.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Dry-run reservations today: 1. Remaining simulation capacity: 47.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "Discovery batch to preview", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "1 jobs" }).click();
  await expect(
    page.getByText("Program Manager · Policy Fixture Employer", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No verified match score is available.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Salary evidence is unknown; the missing-salary exception cannot be assumed.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record simulation", exact: true }).click();
  expect((await (await request.get(`${fixtureApi}/test/state`)).json()).simulationWrites).toBe(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Record simulation", exact: true })
    .click();
  await expect(
    page.getByText(
      "Simulation recorded. 0 dry-run reservations; 1 need review. No applications submitted.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await (await request.get(`${fixtureApi}/test/state`)).json()).simulationWrites).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
