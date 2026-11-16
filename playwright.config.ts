import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT || 4173);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "test-results/results.json" }]]
                           : [["list"], ["html", { open: "never" }]],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{platform}/{arg}{ext}",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /visual/ },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] }, testIgnore: /visual/ },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"] }, testIgnore: /visual/ },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] }, testIgnore: /visual/ },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] }, testIgnore: /visual/ },
    { name: "tablet", use: { ...devices["iPad Mini"] }, testIgnore: /visual/ },
    { name: "visual", use: { ...devices["Desktop Chrome"] }, testMatch: /visual/ },
  ],
  webServer: {
    command: "node app/server.mjs",
    url: `${baseURL}/app-config.json`,
    reuseExistingServer: !process.env.CI && !process.env.APP_FAULTS,
    env: { PORT: String(PORT), APP_TEST: "1", APP_FAULTS: process.env.APP_FAULTS || "" },
    stdout: "ignore",
  },
});
