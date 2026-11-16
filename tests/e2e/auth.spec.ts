import { test, expect, ADA, LIN, waitForAnswer, unique } from "./fixtures";

test("wrong password shows an error and keeps the email", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADA.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect.");
  await expect(page.getByLabel("Email")).toHaveValue(ADA.email);
  await expect(page.getByLabel("Password")).toHaveValue("");
});

test("signing in from a deep link returns to that page", async ({ page }) => {
  await page.goto("/history");
  await expect(page).toHaveURL(/\/login\?next=%2Fhistory$/);
  await page.getByLabel("Email").fill(ADA.email);
  await page.getByLabel("Password").fill(ADA.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByTestId("who")).toHaveText(ADA.name);
});

test("an expired session keeps the question the user was typing", async ({ page, signIn, ask }) => {
  await signIn();
  await page.goto("/");
  // wait until the page has finished its own /api/me check, or the expiry races it
  await expect(page.getByRole("textbox", { name: "Ask anything" })).toBeVisible();
  await page.request.post("/__test/expire");
  const q = unique("Question typed before the session expired");
  await ask(q);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill(ADA.email);
  await page.getByLabel("Password").fill(ADA.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("textbox", { name: "Ask anything" })).toHaveValue(q);
});

test("sign out ends the session", async ({ page, signIn }) => {
  await signIn();
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/me")).status()).toBe(401);
});

test("one user cannot open another user's thread", async ({ page, signIn, ask, browser }) => {
  await signIn(ADA);
  await page.goto("/");
  await ask(unique("Private question"));
  await waitForAnswer(page);
  const url = page.url();

  const other = await browser.newContext();
  const lin = await other.newPage();
  await lin.request.post("/api/login", { data: { email: LIN.email, password: LIN.password } });
  await lin.goto(url);
  await expect(lin.getByRole("heading", { level: 1 })).toHaveText("Thread not found");
  await other.close();
});
