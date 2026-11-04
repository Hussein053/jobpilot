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

test("reviews unknown answers and exceptions before recording a clearly simulated application", async ({
  page,
  request,
}) => {
  await page.goto("/preparation");
  await expect(page.getByText(/DRY_RUN MVP — no applications will be submitted/)).toBeVisible();
  await page.getByRole("combobox", { name: "Discovery batch", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "1 jobs" }).click();
  await page.getByRole("combobox", { name: "Job to prepare", exact: true }).click();
  await page
    .getByRole("option", { name: "Program Manager · Policy Fixture Employer", exact: true })
    .click();
  await page.getByRole("button", { name: "Prepare dry-run application", exact: true }).click();
  await expect(
    page.getByText("Describe your experience leading cross-functional teams.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("What is your preferred contact email?", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Will you require sponsorship?", { exact: true })).toBeVisible();
  await expect(page.getByText(/sensitive: exact job approval required/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run confined simulation", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Approve dry-run exceptions", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    (await (await request.get(`${fixtureApi}/test/state`)).json()).preparationSimulations,
  ).toBe(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Approve dry-run exceptions", exact: true })
    .click();
  await expect(
    page.getByText("Exceptions approved for this simulation revision.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run confined simulation", exact: true }),
  ).toBeDisabled();
  await request.post(`${fixtureApi}/test/approve-preparation-answer`);
  await page.getByRole("button", { name: "Refresh approved answers", exact: true }).click();
  await expect(page.getByText(/Approved Information Bank entry.*version 2/)).toBeVisible();
  await page.getByRole("button", { name: "Run confined simulation", exact: true }).click();
  expect(
    (await (await request.get(`${fixtureApi}/test/state`)).json()).preparationSimulations,
  ).toBe(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Run simulation", exact: true })
    .click();
  await expect(
    page.getByText(
      "Simulation complete. No application was submitted. Final submission controls were blocked.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    (await (await request.get(`${fixtureApi}/test/state`)).json()).preparationSimulations,
  ).toBe(1);
  await expect(page.getByText(/Optional · boolean · review/)).toBeVisible();
  await expect(page.getByText(/Approved Information Bank entry.*version 1/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
