import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile",  width: 400,  height: 800  },
  { name: "tablet",  width: 900,  height: 1200 },
  { name: "desktop", width: 1440, height: 900  }
];

test.describe("Axe a11y scan — Briefing page (E.2)", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name} (${vp.width}x${vp.height}) — zero serious/critical violations`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/");
      // Wait for the briefing page to be visible — the page renders after
      // listPendingApprovals + listJobs resolve from the placeholder adapter.
      await page.locator(".briefing-page").waitFor({ state: "visible", timeout: 10_000 });

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      const blockers = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical"
      );

      if (blockers.length > 0) {
        // Make the failure message useful — list the rule id, severity,
        // and each affected node selector.
        const lines: string[] = [];
        for (const v of blockers) {
          lines.push(`  [${v.impact}] ${v.id}: ${v.help}`);
          for (const node of v.nodes) {
            lines.push(`    target: ${node.target.join(" ")}`);
          }
        }
        console.error(`Axe violations at ${vp.name}:\n${lines.join("\n")}`);
      }

      expect(blockers, `${vp.name} has ${blockers.length} blocking violations`).toHaveLength(0);

      // Also log lower-severity issues so they're visible in CI output
      // without failing the run.
      const minor = results.violations.filter(
        (v) => v.impact !== "serious" && v.impact !== "critical"
      );
      if (minor.length > 0) {
        console.log(`${vp.name}: ${minor.length} minor/moderate axe notes (non-blocking):`);
        for (const v of minor) {
          console.log(`  [${v.impact}] ${v.id}`);
        }
      }
    });
  }
});
