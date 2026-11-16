import { test, expect, waitForAnswer, unique } from "./fixtures";

test.beforeEach(async ({ page, signIn }) => {
  await signIn();
  await page.goto("/");
});

test("a thread survives a reload and appears in History", async ({ page, ask }) => {
  const q = unique("Remember this thread");
  await ask(q);
  await waitForAnswer(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(q);
  await expect(page.getByTestId("answer")).toContainText("Here is a short answer");

  await page.goto("/history");
  const entry = page.getByRole("link", { name: q });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/t\/[a-f0-9]+$/);
});

test("back and forward move between pages without a reload", async ({ page, ask }) => {
  const q = unique("Navigate around");
  await ask(q);
  await waitForAnswer(page);
  const threadUrl = page.url();
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 42));
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(threadUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(q);
  await page.goForward();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(42);
});

test("an unknown thread id shows a not-found page, not a crash", async ({ page }) => {
  test.info().annotations.push({ type: "expected-console", description: "status of 404" });
  await page.goto("/t/deadbeef0000");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thread not found");
});
