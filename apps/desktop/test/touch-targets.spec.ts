import { test, expect, type Page } from "@playwright/test";

const SIDEBAR_NAV_LABELS = [
  "Briefing", "Chat", "Integrations", "Approvals", "Trust", "History", "Settings"
];

async function visibleInteractiveElements(page: Page): Promise<{ index: number; box: { width: number; height: number } | null; text: string }[]> {
  const handles = await page.locator("button, a[href], [role='button']").all();
  const out: { index: number; box: { width: number; height: number } | null; text: string }[] = [];
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    if (!(await h.isVisible().catch(() => false))) continue;
    const box = await h.boundingBox().catch(() => null);
    if (!box) continue;
    const text = (await h.textContent().catch(() => null))?.trim().slice(0, 60) ?? "";
    out.push({ index: i, box: { width: box.width, height: box.height }, text });
  }
  return out;
}

function assertAllHit44(elements: { index: number; box: { width: number; height: number } | null; text: string }[], surfaceLabel: string): void {
  const failures = elements
    .filter((el) => el.box && (el.box.width < 44 || el.box.height < 44))
    .map((el) => `[${el.index}] ${Math.round(el.box!.width)}×${Math.round(el.box!.height)} "${el.text}"`);
  expect(failures, `Surface "${surfaceLabel}" had ${failures.length} undersized touch targets:\n  ${failures.join("\n  ")}`).toEqual([]);
}

test.describe("Touch-target audit @ 400px (E.1)", () => {
  test.use({ viewport: { width: 400, height: 800 } });

  test("Briefing landing — every interactive element ≥ 44×44", async ({ page }) => {
    await page.goto("/");
    await page.locator(".briefing-page").waitFor({ state: "visible", timeout: 10_000 });
    const elements = await visibleInteractiveElements(page);
    expect(elements.length, "Briefing page should expose at least one interactive button").toBeGreaterThan(0);
    assertAllHit44(elements, "Briefing");
  });

  test("Open drawer — every visible interactive element ≥ 44×44", async ({ page }) => {
    await page.goto("/");
    await page.locator(".briefing-page").waitFor({ state: "visible", timeout: 10_000 });
    await page.locator(".burger-button").click();
    // Wait for the drawer animation to complete
    await page.waitForTimeout(300);
    const elements = await visibleInteractiveElements(page);
    expect(elements.length).toBeGreaterThan(0);
    assertAllHit44(elements, "Drawer-open");
  });

  // Drawer open + navigate to each primary sidebar page, audit on each.
  for (const label of SIDEBAR_NAV_LABELS) {
    test(`${label} page — every interactive element ≥ 44×44`, async ({ page }) => {
      await page.goto("/");
      await page.locator(".briefing-page").waitFor({ state: "visible", timeout: 10_000 });
      await page.locator(".burger-button").click();
      await page.waitForTimeout(200);

      // Sidebar nav uses `.nav-item` button elements whose visible label
      // sits inside an inner <span>. We match on visible text via CSS-
      // text-selector (`:has(span:text-is(...))`) rather than
      // `getByRole(..., { name })` because Chromium's a11y tree computes
      // the accessible name as empty for these buttons (lucide-react SVG
      // sibling appears to suppress text-from-span name computation —
      // confirmed via CDP Accessibility.getFullAXTree). A CSS locator
      // sidesteps that quirk and is just as robust.
      const navButton = page.locator(`.sidebar .nav-item:has(span:text-is("${label}"))`);
      if ((await navButton.count()) === 0) {
        test.skip(true, `No "${label}" nav item found — skipping (page may be under Advanced collapsible).`);
        return;
      }
      await navButton.first().click();
      // Drawer auto-closes on route change.
      await page.waitForTimeout(300);

      const elements = await visibleInteractiveElements(page);
      expect(elements.length, `${label} page should expose at least one interactive button`).toBeGreaterThan(0);
      assertAllHit44(elements, label);
    });
  }
});
