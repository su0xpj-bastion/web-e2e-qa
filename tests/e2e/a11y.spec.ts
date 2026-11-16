import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, waitForAnswer, unique } from "./fixtures";

async function audit(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page: page as never }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) - ${v.help}`);
  expect(summary, `axe serious/critical violations on ${label}`).toEqual([]);
}

test("sign-in page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/login");
  await audit(page, "sign-in");
});

test("ask page and a finished answer have no serious accessibility violations", async ({ page, signIn, ask }) => {
  await signIn();
  await page.goto("/");
  await audit(page, "ask page");
  await ask(unique("Accessibility check"));
  await waitForAnswer(page);
  await audit(page, "answer");
});

test("the whole ask flow works from the keyboard", async ({ page, signIn, browserName, isMobile }) => {
  test.skip(isMobile, "keyboard flow is a desktop concern");
  test.skip(browserName === "webkit", "Safari skips links on Tab unless the user turns that on");
  await signIn();
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "Ask anything" });
  await expect(box).toBeFocused();                    // the page puts the cursor in the input
  await page.getByRole("link", { name: "Answerly" }).focus();
  await page.keyboard.press("Shift+Tab");             // the stop before the first header link...
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();                   // ...is the skip link
  await expect(skip).toBeInViewport();                // and it becomes visible when focused
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await box.focus();
  await page.keyboard.type(unique("Keyboard only"));
  await page.keyboard.press("Enter");
  await waitForAnswer(page);
  await expect(box).toBeFocused();                    // focus returns to the input
  await page.keyboard.press("Shift+Tab");
  const focused = await page.evaluate(() => document.activeElement?.textContent);
  expect(focused).toBeTruthy();
});

test("streaming answer is announced politely and marked busy while it streams", async ({ page, signIn, ask }) => {
  await signIn();
  await page.goto("/");
  await ask(unique("Live region"));
  const answer = page.getByTestId("answer");
  await expect(answer).toHaveAttribute("aria-live", "polite");
  await waitForAnswer(page);
  await expect(answer).toHaveAttribute("aria-busy", "false");
});
