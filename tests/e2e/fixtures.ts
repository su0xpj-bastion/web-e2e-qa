import { test as base, expect, type Page, type ConsoleMessage, type Request } from "@playwright/test";
import users from "../fixtures/users.json" with { type: "json" };

export type User = { email: string; password: string; name: string };
export const ADA: User = users.ada;
export const LIN: User = users.lin;

// Browser noise that is expected: a fetch that gets a 401 is logged by Chromium and WebKit
// as "Failed to load resource". The app handles 401 by redirecting to sign-in.
const EXPECTED_CONSOLE = [/Failed to load resource.*401/, /status of 401/,
  // Playwright injects a <style> to hide the caret when it takes screenshots; WebKit reports the
  // page's CSP refusing it. It comes from the test harness, not the app.
  /Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline'/];

type Fixtures = {
  consoleErrors: string[];
  requests: Request[];
  signIn: (user?: User) => Promise<void>;
  ask: (question: string) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  // Auto fixture: every test fails if the page logs an unexpected console error or throws.
  consoleErrors: [async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    page.on("console", (m: ConsoleMessage) => {
      const expected = [...EXPECTED_CONSOLE, ...testInfo.annotations
        .filter((a) => a.type === "expected-console").map((a) => new RegExp(a.description!))];
      if (m.type() === "error" && !expected.some((re) => re.test(m.text()))) errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await use(errors);
    if (errors.length) {
      await testInfo.attach("console-errors", { body: errors.join("\n"), contentType: "text/plain" });
      expect(errors, "unexpected console errors").toEqual([]);
    }
  }, { auto: true }],

  requests: async ({ page }, use) => {
    const seen: Request[] = [];
    page.on("request", (r) => seen.push(r));
    await use(seen);
  },

  // Sign in through the API (fast), so only auth.spec.ts exercises the sign-in form.
  signIn: async ({ page }, use) => {
    await use(async (user = ADA) => {
      const res = await page.request.post("/api/login", { data: { email: user.email, password: user.password } });
      expect(res.ok()).toBeTruthy();
    });
  },

  ask: async ({ page }, use) => {
    await use(async (question: string) => {
      const box = page.getByRole("textbox", { name: "Ask anything" });
      await box.fill(question);
      await box.press("Enter");
    });
  },
});

export { expect };

export async function waitForAnswer(page: Page, index = 0) {
  const status = page.getByTestId("status").nth(index);
  await expect(status).toHaveText(/Done|Stopped/, { timeout: 15_000 });
  return page.getByTestId("answer").nth(index);
}

export const unique = (label: string) => `${label} ${Math.random().toString(36).slice(2, 8)}`;
