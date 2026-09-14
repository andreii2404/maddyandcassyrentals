/* Run against a local dev server. Auth requests are intercepted; no email is sent. */
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node test with an optional local Playwright installation. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const base = process.env.TEST_BASE_URL || "http://localhost:3000";
  try {
    let requests = 0;
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    await page.route("**/auth/v1/otp**", async (route) => {
      requests++;
      await pending;
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ msg: "Test request failed. Please try again." }) });
    });
    await page.goto(`${base}/sign-in`);
    await page.getByRole("button", { name: "Send Code", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Email is required" }).waitFor();
    assert.equal(requests, 0, "Invalid forms must not send requests");
    await page.getByLabel("Email address").fill("ui-test@example.com");
    await page.getByLabel("Email address").press("Enter");
    const busy = page.locator('button[aria-busy="true"]');
    await busy.waitFor();
    assert.equal(await busy.isDisabled(), true);
    try {
      assert.equal(await busy.getByText("Sending code...", { exact: true }).isVisible(), true,
        "Loading buttons must keep their action label visible");
      await page.getByLabel("Email address").press("Enter");
    } finally {
      release();
    }
    await page.getByRole("button", { name: "Send Code", exact: true }).waitFor();
    assert.equal(requests, 1, "Repeated Enter must not send duplicate requests");
    console.log("PASS: sign-in validation, visible loading state, duplicate-submit guard, and error recovery");
    const screenshotDir = process.env.UI_SCREENSHOT_DIR;
    if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
    const failures = [];
    const routes = ["/", "/catalog", "/cart", "/favorites", "/sign-in", "/sign-up", "/forgot-password", "/verify-email", "/admin/sign-in", "/guest/bookings", "/contact", "/faq", "/how-to-book", "/rental-requirements", "/terms", "/privacy"];
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        const errors = [];
        const onError = (error) => errors.push(error.message);
        page.on("pageerror", onError);
        try {
          const response = await page.goto(`${base}${route}`, { timeout: 60000 });
          await page.locator('main h1, h1, main h2, [role="alert"]').first().waitFor({ timeout: 45000 });
          assert.ok(response.status() < 400, `${route}: HTTP ${response.status()}`);
          assert.equal(await page.getByRole("heading", { name: "This page couldn’t load" }).count(), 0, `${route}: page failed to load`);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          assert.equal(overflow, false, `${route}: horizontal overflow at ${viewport.width}px`);
          assert.deepEqual(errors, [], `${route}: browser errors`);
          const unnamed = await page.locator('button:not([aria-hidden="true"])').evaluateAll((buttons) => buttons.filter((button) => button.getClientRects().length && !button.textContent.trim() && !button.getAttribute('aria-label') && !button.getAttribute('aria-labelledby') && !button.title).length);
          assert.equal(unnamed, 0, `${route}: buttons without accessible labels`);
          if (screenshotDir && ["/catalog", "/sign-in", "/contact", "/guest/bookings"].includes(route)) {
            await page.screenshot({ path: path.join(screenshotDir, `${route.slice(1).replaceAll('/', '-')}-${viewport.width}.png`), fullPage: true });
          }
          console.log(`PASS: ${route} at ${viewport.width}px`);
        } catch (error) {
          failures.push(error.message);
          console.log(`FAIL: ${route} at ${viewport.width}px: ${error.message}`);
        } finally {
          page.off("pageerror", onError);
        }
      }
    }
    await page.goto(`${base}/sign-in`);
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.getByRole("navigation", { name: "Mobile navigation", exact: true }).waitFor();
    await page.getByRole("button", { name: "Close navigation menu" }).click();
    console.log("PASS: mobile navigation opens and closes");
    assert.deepEqual(failures, [], "Route smoke checks failed");
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
