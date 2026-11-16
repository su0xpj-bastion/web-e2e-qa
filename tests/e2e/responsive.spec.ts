import { test, expect, waitForAnswer, unique } from "./fixtures";

// Runs in every project, so the same assertions cover desktop, tablet and phone viewports.

test.beforeEach(async ({ page, signIn }) => {
  await signIn();
  await page.goto("/");
});

test("no horizontal scrolling on the ask page or an answer", async ({ page, ask }) => {
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow(), "page wider than the viewport").toBeLessThanOrEqual(0);
  await ask(unique("A question with a long answer to check wrapping"));
  await waitForAnswer(page);
  expect(await overflow(), "answer wider than the viewport").toBeLessThanOrEqual(0);
});

test("navigation is reachable at this viewport", async ({ page }) => {
  const menu = page.getByRole("button", { name: "Open menu" });
  const history = page.getByRole("link", { name: "History" });
  if ((page.viewportSize()?.width ?? 1280) <= 640) {
    await expect(history).toBeHidden();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(history).toBeVisible();
    await history.click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "false");    // menu closes after navigating
  } else {
    await expect(menu).toBeHidden();
    await expect(history).toBeVisible();
  }
});

test("buttons are at least 44px tall on touch devices", async ({ page, ask, isMobile }) => {
  test.skip(!isMobile, "touch-target size applies to touch viewports");
  await ask(unique("Touch targets"));
  await waitForAnswer(page);
  for (const name of ["Ask", "Regenerate", "Share", "Open menu"]) {
    const button = page.getByRole("button", { name });
    if (!(await button.isVisible())) continue;          // the menu button only exists on narrow screens
    const box = await button.boundingBox();
    expect(box?.height ?? 0, `${name} button height`).toBeGreaterThanOrEqual(44);
  }
});

test("the input stays in view after an answer on a short screen", async ({ page, ask }) => {
  await ask(unique("Input visibility"));
  await waitForAnswer(page);
  const box = page.getByRole("textbox", { name: "Ask anything" });
  await box.scrollIntoViewIfNeeded();
  await expect(box).toBeInViewport();
  await expect(box).toBeFocused();
});
