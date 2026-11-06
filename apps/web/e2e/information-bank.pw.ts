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
async function addDraft(page: import("@playwright/test").Page) {
  await page.goto("/information-bank");
  await page.getByRole("button", { name: "New answer", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Exact application question", exact: true })
    .fill("Which email can we use?");
  await dialog
    .getByRole("textbox", { name: "Your answer", exact: true })
    .fill("private-browser-fixture@example.test");
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText("private-browser-fixture@example.test", { exact: true }),
  ).toBeVisible();
}
test("requires reviewed approval, supports revocation and deletion, and never persists answers offline", async ({
  page,
  request,
}) => {
  await addDraft(page);
  const state = await (await request.get(`${fixtureApi}/test/state`)).json();
  expect(state.bankWrites).toBe(1);
  await page.getByRole("button", { name: "Approve reviewed answer", exact: true }).click();
  const confirm = page.getByRole("dialog");
  await expect(
    confirm.getByText("Approve displayed answer version 1?", { exact: true }),
  ).toBeVisible();
  expect((await (await request.get(`${fixtureApi}/test/state`)).json()).bankWrites).toBe(1);
  await confirm.getByRole("button", { name: "Approve reviewed answer", exact: true }).click();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("dialog").getByText(/Version 2 · approved/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Revoke / disable", exact: true }).click();
  await expect(page.getByText("revoked", { exact: true })).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  expect(storage).not.toContain("private-browser-fixture@example.test");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText("No matching answers. Add a draft or import contact suggestions."),
  ).toBeVisible();
});
test("retains stale edits and keeps private search text out of URLs", async ({ page, request }) => {
  await addDraft(page);
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await request.post(`${fixtureApi}/test/change-bank`);
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "Your answer", exact: true })
    .fill("Unsaved private fixture");
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(dialog.getByText(/Answer changed. Reload before saving/)).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Your answer", exact: true })).toHaveValue(
    "Unsaved private fixture",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Discard unsaved answer edits?" })
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search question words", exact: true }).fill("email");
  await expect(page.getByText("Externally updated fixture", { exact: true })).toBeVisible();
  expect(page.url()).not.toContain("email");
  expect((await (await request.get(`${fixtureApi}/test/state`)).json()).bankWrites).toBe(1);
});
