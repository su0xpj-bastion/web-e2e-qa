// What you would check by hand in DevTools (Console, Network, Performance), as assertions.
// The console check itself is the auto fixture in fixtures.ts and applies to every test.
import { test, expect, waitForAnswer, unique } from "./fixtures";

const BUDGET = { domContentLoadedMs: 1500, lcpMs: 2500, uiTtftMs: 1000 };

test.beforeEach(async ({ page, signIn }) => {
  await signIn();
});

test("network: the answer is a real event stream, and nothing fails or leaves the site", async ({ page, ask }) => {
  const failed: string[] = [];
  const offsite: string[] = [];
  page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on("request", (r) => { if (!r.url().startsWith("http://127.0.0.1")) offsite.push(r.url()); });
  await page.goto("/");
  const [res] = await Promise.all([page.waitForResponse("**/api/ask"), ask(unique("Network panel"))]);
  expect(res.headers()["content-type"]).toContain("text/event-stream");
  expect(res.headers()["cache-control"]).toContain("no-cache");
  await waitForAnswer(page);
  expect(failed).toEqual([]);
  expect(offsite).toEqual([]);
});

test("performance: page load and time to first rendered word stay within budget", async ({ page, ask, browserName }) => {
  await page.goto("/");
  const nav = await page.evaluate(() => {
    const [n] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return { dcl: n.domContentLoadedEventEnd - n.startTime };
  });
  expect(nav.dcl, "DOMContentLoaded (ms)").toBeLessThan(BUDGET.domContentLoadedMs);

  if (browserName === "chromium") {                 // LCP is only exposed in Chromium
    const lcp = await page.evaluate(() => new Promise<number>((resolve) => {
      new PerformanceObserver((list) => resolve(list.getEntries().at(-1)!.startTime))
        .observe({ type: "largest-contentful-paint", buffered: true });
      setTimeout(() => resolve(-1), 3000);
    }));
    expect(lcp, "Largest Contentful Paint (ms)").toBeGreaterThan(0);
    expect(lcp).toBeLessThan(BUDGET.lcpMs);
  }

  await ask(unique("Performance panel"));
  await waitForAnswer(page);
  const ttft = await page.evaluate(() => performance.getEntriesByName("ui-ttft")[0]?.duration ?? -1);
  test.info().annotations.push({ type: "ui-ttft-ms", description: ttft.toFixed(0) });
  expect(ttft, "submit -> first word on screen (ms)").toBeGreaterThan(0);
  expect(ttft).toBeLessThan(BUDGET.uiTtftMs);
});

test("security headers: the page sends a Content-Security-Policy and the session cookie is HttpOnly", async ({ page }) => {
  const res = await page.goto("/");
  expect(res!.headers()["content-security-policy"]).toContain("default-src 'self'");
  const cookie = (await page.context().cookies()).find((c) => c.name === "sid");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
});
