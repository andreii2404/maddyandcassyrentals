/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser test. */
const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const base = process.env.TEST_BASE_URL || "http://localhost:3000";
  try {
    await page.goto(`${base}/catalog`);
    const card = page.locator("article").filter({ has: page.getByRole("button", { name: "+ Add to Cart", exact: true }) }).first();
    await card.waitFor();
    const productName = await card.getByRole("heading").innerText();
    await card.getByRole("button", { name: new RegExp("^Add .* to favorites$") }).click();
    await card.getByRole("button", { name: new RegExp("^Remove .* from favorites$") }).waitFor();
    await card.getByRole("button", { name: "+ Add to Cart", exact: true }).click();
    await page.goto(`${base}/cart`);
    await page.getByRole("heading", { name: productName, exact: true }).waitFor();
    assert.equal(await page.getByLabel("Quantity", { exact: true }).inputValue(), "1");
    assert.equal(await page.getByRole("button", { name: `Decrease ${productName} quantity`, exact: true }).isDisabled(), true);
    const increase = page.getByRole("button", { name: `Increase ${productName} quantity`, exact: true });
    if (await increase.isEnabled()) {
      await increase.click();
      assert.equal(await page.getByLabel("Quantity", { exact: true }).inputValue(), "2");
      await page.getByRole("button", { name: `Decrease ${productName} quantity`, exact: true }).click();
    }
    assert.equal(await page.getByRole("link", { name: "Start checkout", exact: true }).getAttribute("href"), "/checkout");
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("heading", { name: "Your rental cart is empty.", exact: true }).waitFor();
    console.log("PASS: add to cart, quantity bounds, checkout destination, and remove");
    await page.goto(`${base}/favorites`);
    await page.getByRole("heading", { name: productName, exact: true }).waitFor();
    await page.getByRole("button", { name: `Remove ${productName} from favorites`, exact: true }).click();
    await page.getByRole("heading", { name: "Your favorites list is ready when you are.", exact: true }).waitFor();
    console.log("PASS: favorites persist across pages and can be removed");
    await page.goto(`${base}/catalog`);
    await page.getByLabel("Search products", { exact: true }).fill("no-product-matches-this-98765");
    assert.equal(await page.locator("article").count(), 0);
    await page.getByLabel("Search products", { exact: true }).fill(productName);
    await page.getByRole("heading", { name: productName, exact: true }).waitFor();
    await page.getByLabel("Search products", { exact: true }).fill("");
    await page.getByRole("button", { name: "Cameras", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Cameras", exact: true }).getAttribute("aria-pressed"), "true");
    console.log("PASS: catalog search, empty results, and category filters");
    await page.goto(`${base}/sign-in`);
    const size = await page.getByLabel("Email address").evaluate((input) => parseFloat(getComputedStyle(input).fontSize));
    assert.ok(size >= 16, "Mobile fields should not trigger browser zoom");
    console.log("PASS: mobile form text is at least 16px");
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
