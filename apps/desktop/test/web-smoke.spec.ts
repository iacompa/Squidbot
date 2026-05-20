import { test, expect } from "@playwright/test";

test.describe("Web bundle smoke (D.4)", () => {
  test("loads root and renders the briefing page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".briefing-page")).toBeVisible({ timeout: 10_000 });
    // Briefing's three-column section labels:
    await expect(page.getByText(/Overnight/i).first()).toBeVisible();
    await expect(page.getByText(/Needs you/i).first()).toBeVisible();
    await expect(page.getByText(/Today's plan/i).first()).toBeVisible();
  });

  test("burger button is visible on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("/");
    await expect(page.locator(".briefing-page")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".burger-button")).toBeVisible();
  });

  test("drawer opens via burger and closes via backdrop on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto("/");
    await page.locator(".briefing-page").waitFor({ state: "visible", timeout: 10_000 });

    // Drawer closed initially
    await expect(page.locator(".app-shell")).not.toHaveClass(/nav-open/);

    // Tap burger
    await page.locator(".burger-button").click();
    await expect(page.locator(".app-shell")).toHaveClass(/nav-open/);

    // Tap backdrop — note the backdrop is the .mobile-nav-backdrop.open element
    await page.locator(".mobile-nav-backdrop.open").click();
    await expect(page.locator(".app-shell")).not.toHaveClass(/nav-open/);
  });
});
