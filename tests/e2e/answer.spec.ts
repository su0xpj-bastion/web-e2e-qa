import { test, expect, waitForAnswer, unique } from "./fixtures";

test.beforeEach(async ({ page, signIn }) => {
  await signIn();
  await page.goto("/");
});

test("answer streams in, it does not arrive all at once", async ({ page, ask }) => {
  await ask(unique("How does streaming work?"));
  const answer = page.getByTestId("answer");
  const lengths = new Set<number>();
  // sample the rendered text while the stream is in flight
  for (let i = 0; i < 40 && (await answer.getAttribute("aria-busy")) !== "false"; i++) {
    lengths.add(((await answer.textContent()) || "").length);
    await page.waitForTimeout(25);
  }
  await waitForAnswer(page);
  expect(lengths.size, "distinct partial lengths seen while streaming").toBeGreaterThanOrEqual(4);
});

test("every citation links to the source it numbers", async ({ page, ask }) => {
  await ask(unique("What should I measure on every release?"));
  await waitForAnswer(page);
  const cites = page.locator(".answer .cite");
  await expect(cites).toHaveCount(2);
  for (const n of [1, 2]) {
    const cite = page.locator(`.answer .cite[data-source="${n}"]`);
    const source = page.locator(`#source-${n} a`);
    await expect(cite).toHaveAttribute("href", (await source.getAttribute("href"))!);
    await expect(cite).toHaveAttribute("aria-label", `Source ${n}: ${await source.textContent()}`);
  }
});

test("a follow-up stays in the same thread and uses the earlier question", async ({ page, ask }) => {
  const first = unique("What is time to first token?");
  await ask(first);
  await waitForAnswer(page, 0);
  await expect(page).toHaveURL(/\/t\/[a-f0-9]+$/);
  const url = page.url();
  await ask("And how do I lower it?");
  const second = await waitForAnswer(page, 1);
  await expect(second).toContainText(`Building on your earlier question about "${first}"`);
  expect(page.url()).toBe(url);
});

test("one submit sends exactly one request, even with Enter and a click", async ({ page, requests }) => {
  const box = page.getByRole("textbox", { name: "Ask anything" });
  await box.fill(unique("Count my requests"));
  await box.press("Enter");                                              // a user presses Enter...
  await page.getByRole("button", { name: "Ask" }).click({ force: true });  // ...and clicks Ask right after
  await waitForAnswer(page);
  expect(requests.filter((r) => r.url().endsWith("/api/ask")).length).toBe(1);
});

test("model output and questions are rendered as text, never as HTML", async ({ page, ask }) => {
  let dialog = false;
  page.on("dialog", async (d) => { dialog = true; await d.dismiss(); });
  const payload = `<img src=x onerror="alert(1)"> <b>bold</b> ${unique("xss")}`;
  await ask(payload);
  await waitForAnswer(page);
  await expect(page.locator(".turn .q")).toHaveText(payload);
  await expect(page.locator(".turn .q img, .turn .q b")).toHaveCount(0);
  expect(dialog).toBe(false);
});

test("empty input does nothing", async ({ page, requests }) => {
  await page.getByRole("textbox", { name: "Ask anything" }).press("Enter");
  await page.waitForTimeout(200);
  expect(requests.filter((r) => r.url().endsWith("/api/ask"))).toHaveLength(0);
});
