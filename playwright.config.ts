import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke test: two strangers in two isolated browser contexts.
// Runs against `npm run dev` (started automatically unless one is already up).
const PORT = Number(process.env.E2E_PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    // Set E2E_CHANNEL=chrome (or msedge) to use an installed browser instead
    // of Playwright's downloaded Chromium.
    channel: process.env.E2E_CHANNEL,
    launchOptions: {
      // Fake camera/mic so the video path can run headless without prompts.
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
