import { test, expect } from "@playwright/test";

/**
 * Visual regression baselines for the responsive shell (E.3).
 *
 * Phase 1 scope: just the briefing page at five widths. Per-page baselines
 * for the other 13 pages can be added in follow-up tasks — this spec is the
 * harness, and adding a new page is one inner test below.
 *
 * On first run, Playwright generates the baselines under
 * test/visual.spec.ts-snapshots/ (committed). Subsequent runs compare
 * pixel-by-pixel; maxDiffPixelRatio: 0.02 allows minor anti-aliasing
 * drift between CI and local without failing.
 *
 * To intentionally update a baseline (after a design change):
 *   npm run test:web --workspace=@squidbot/desktop -- visual.spec.ts --update-snapshots
 */

const PAGES = [
  { name: "briefing", route: "/" }
];

const VIEWPORTS = [400, 768, 1024, 1440, 2560];

test.describe("Visual regression baselines (E.3)", () => {
  for (const { name, route } of PAGES) {
    for (const width of VIEWPORTS) {
      test(`${name} @ ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        // Wait for the briefing page render — IPC stubs from the placeholder
        // adapter resolve fast, but waiting for networkidle gives the layout
        // time to settle before screenshot.
        await page.locator(".briefing-page").waitFor({ state: "visible", timeout: 10_000 });
        await page.waitForLoadState("networkidle");
        await expect(page).toHaveScreenshot(`${name}-${width}.png`, {
          maxDiffPixelRatio: 0.02,
          fullPage: false
        });
      });
    }
  }
});
