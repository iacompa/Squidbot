import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the web bundle smoke tests (Task D.4).
 *
 * webServer block auto-starts `npm run web:serve` before the test run
 * and tears it down after. reuseExistingServer=true in dev so consecutive
 * runs against an already-running server don't fight for port 8080.
 *
 * testDir is `./test` (matches existing apps/desktop/test layout); only
 * files matching *.spec.ts are picked up so they don't collide with
 * Vitest's *.test.ts under src/.
 */
export default defineConfig({
  testDir: "./test",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 30_000,
  webServer: {
    command: "npm run web:serve",
    port: 8080,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI
  },
  use: {
    baseURL: "http://localhost:8080",
    actionTimeout: 5_000
  }
});
