// Visual regression. Baselines are per platform (fonts render differently on macOS and
// Linux); CI compares against the Linux baselines committed under __screenshots__/visual/linux.
import { test, expect, waitForAnswer } from "./fixtures";

test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

test("sign-in page", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveScreenshot("sign-in.png");
});

test("finished answer with sources", async ({ page, signIn, ask }) => {
  await signIn();
  await page.goto("/");
  await ask("How does streaming work?");            // fixed question -> fixed answer and sources
  await waitForAnswer(page);
  await expect(page).toHaveScreenshot("answer.png", {
    mask: [page.getByTestId("who")],
  });
});
