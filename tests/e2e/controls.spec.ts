import { test, expect, waitForAnswer, unique } from "./fixtures";

test.beforeEach(async ({ page, signIn }) => {
  await signIn();
  await page.goto("/");
});

test("Stop ends the answer where it is", async ({ page, ask, context, baseURL }) => {
  // slow the stream (test-only cookie) so Stop lands mid-answer on every device and CI runner
  await context.addCookies([{ name: "token_ms", value: "60", url: baseURL! }]);
  await ask(unique("Tell me about caching"));
  const answer = page.getByTestId("answer");
  await expect(answer).toContainText("Here is");                 // some text has arrived
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByTestId("status")).toHaveText("Stopped");
  const frozen = await answer.textContent();
  await page.waitForTimeout(800);                                   // > 12 more tokens if it kept going
  await expect(answer).toHaveText(frozen!);
  expect(frozen!.length).toBeLessThan(300);
});

test("Regenerate replaces the answer instead of adding a second one", async ({ page, ask }) => {
  await ask(unique("Explain rate limits"));
  await waitForAnswer(page);
  await page.getByRole("button", { name: "Regenerate" }).click();
  await waitForAnswer(page);
  await expect(page.getByTestId("turn")).toHaveCount(1);
});

test("a stream that breaks mid-answer shows an error, and Try again gives one clean answer", async ({ page, ask }) => {
  let calls = 0;
  await page.route("**/api/ask", async (route) => {
    calls += 1;
    if (calls > 1) return route.continue();
    const sse = [
      `event: meta\ndata: {"thread_id":"abc123","sources":[]}\n\n`,
      `event: token\ndata: {"text":"Partial answer "}\n\n`,
      `event: error\ndata: {"message":"The answer was interrupted. Please try again."}\n\n`,
    ].join("");
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body: sse });
  });
  await ask(unique("Interrupted question"));
  await expect(page.getByRole("alert")).toContainText("interrupted");
  await page.getByRole("button", { name: "Try again" }).click();
  await waitForAnswer(page);
  await expect(page.getByTestId("turn")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("answer")).not.toContainText("Partial answer");
});

test("a shared link opens read-only for someone who is signed out", async ({ page, ask, browser }) => {
  const q = unique("Share this answer");
  await ask(q);
  await waitForAnswer(page);
  await page.getByRole("button", { name: "Share" }).click();
  const link = page.getByTestId("share-link");
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");

  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(href!);
  await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(q);
  await expect(visitor.getByTestId("answer")).toContainText("Here is a short answer");
  await expect(visitor.getByRole("textbox")).toHaveCount(0);
  await expect(visitor.getByText("read only")).toBeVisible();
  await anon.close();
});
