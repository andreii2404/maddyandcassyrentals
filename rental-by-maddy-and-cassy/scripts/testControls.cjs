/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser tests. */
// Exercises actual components with local service doubles; never writes production data.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const esbuild = require("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
  const root = path.resolve(__dirname, "..");
  const service = `
    export const submitManualPayment = async () => { window.paymentCalls++; await new Promise(resolve => window.finishPayment = resolve); };
    export const updateBalancePaymentPreference = async () => {};
    export const getAdminCatalog = async () => ({ products: [], categories: [{ id:'cat', name:'Cameras', sortOrder:1 }], inventoryUnits: [], priceHistory: [], reviews: [] });
    export const createCatalogProductAsAdmin = async () => { window.productCalls++; await new Promise(resolve => window.finishProduct = resolve); return 'test-product'; };
    export const createCatalogCategoryAsAdmin = async () => {};
    export const deactivateCatalogProductAsAdmin = async () => {};
    export const deleteCatalogCategoryAsAdmin = async () => {};
    export const moderateProductReviewAsAdmin = async () => {};
    export const updateCatalogCategoryAsAdmin = async () => {};
    export const updateCatalogProductAsAdmin = async () => {};
    export const updateInventoryUnitAsAdmin = async () => {};
    export const uploadCatalogImage = async () => {};
  `;
  const result = await esbuild.build({
    stdin: { contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Button } from '@/components/ui/Button';
      import BookingPaymentPanel from '@/components/payment/BookingPaymentPanel';
      import AdminCatalogManager from '@/app/admin/catalog/AdminCatalogManager';
      import Modal from '@/components/ui/Modal';
      window.paymentCalls = 0; window.productCalls = 0; window.linkClicks = 0;
      function Fixture() {
        const [open, setOpen] = useState(false);
        return <><Button href="#destination" disabled id="disabled-link" onClick={() => window.linkClicks++}>Disabled link</Button>
          <Button variant="toggle" active={false}>Toggle off</Button>
          <Button onClick={() => setOpen(true)}>Open modal</Button>
          {open && <Modal title="Test dialog" onClose={() => setOpen(false)}><input aria-label="Dialog input"/><Button>Last action</Button></Modal>}
          <BookingPaymentPanel booking={{ id:'test', status:'pending', totalAmount:1000, rentalSubtotal:1000, refundableDeposit:0, startDate:'2026-12-01T09:00:00Z', balancePaymentPreference:'online_gcash' }} payments={[]}/>
          <AdminCatalogManager/>
        </>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    `, loader: "tsx", resolveDir: root },
    bundle: true, write: false, outdir: "ui-fixture", jsx: "automatic", loader: { ".css": "local-css" },
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "local-test-services", setup(build) {
      build.onResolve({ filter: /^(next\/link|next\/image|@\/src\/services\/(paymentService|productService|operationsService)|@\/components\/ui\/ToastProvider)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
        let contents = service;
        if (args.path === "next/link") contents = 'import React from "react"; export default React.forwardRef(function Link({href,prefetch,children,...props},ref){return <a {...props} href={href} ref={ref}>{children}</a>});';
        if (args.path === "next/image") contents = 'export default function Image(){return null}';
        if (args.path.endsWith("ToastProvider")) contents = 'export function useToast(){return {showToast:()=>{}}}';
        return { contents, loader: "tsx", resolveDir: root };
      });
    } }],
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => console.error("Fixture browser error:", error.message));
  try {
    await page.route("**/*", (route) => route.abort());
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.addStyleTag({ content: await fs.readFile(path.join(root, "app/globals.css"), "utf8") });
    await page.addStyleTag({ content: result.outputFiles.find((file) => file.path.endsWith(".css")).text });
    await page.addScriptTag({ content: result.outputFiles.find((file) => file.path.endsWith(".js")).text });
    await page.locator("#disabled-link").click({ force: true });
    assert.equal(await page.evaluate(() => window.linkClicks), 0);
    assert.equal(await page.locator("#disabled-link").getAttribute("aria-disabled"), "true");
    assert.equal(await page.getByRole("button", { name: "Toggle off" }).getAttribute("aria-pressed"), "false");
    const opener = page.getByRole("button", { name: "Open modal", exact: true });
    await opener.click();
    await page.getByRole("button", { name: "Last action" }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.getByRole("button", { name: "Close dialog" }).evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.getByRole("button", { name: "Last action" }).evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press("Escape");
    assert.equal(await opener.evaluate((el) => el === document.activeElement), true);
    console.log("PASS: disabled links, toggle semantics, modal focus trap and focus restoration");

    await page.getByRole("button", { name: "Submit Payment Proof", exact: true }).click();
    assert.equal(await page.getByRole("alert").count(), 1);
    assert.equal(await page.evaluate(() => window.paymentCalls), 0);
    await page.getByLabel("Reference number", { exact: false }).fill("TEST-123");
    await page.getByLabel("Name of account used", { exact: false }).fill("Test Customer");
    await page.getByLabel("11-digit GCash mobile number used", { exact: false }).fill("09123456789");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("test proof") });
    await page.getByLabel("Reference number", { exact: false }).press("Enter");
    const submitting = page.getByRole("button", { name: "Submitting payment…", exact: true });
    await submitting.waitFor();
    assert.equal(await submitting.isDisabled(), true);
    assert.equal(await page.locator('input[type="file"]').first().isDisabled(), true);
    await page.evaluate(() => {
      document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    assert.equal(await page.evaluate(() => window.paymentCalls), 1);
    await page.evaluate(() => window.finishPayment());
    await page.getByRole("button", { name: "Submit Payment Proof", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Reference number", { exact: false }).inputValue(), "");
    console.log("PASS: payment validation, Enter submission, duplicate guard, locked uploads, and success reset");

    await page.getByRole("button", { name: "+ Add Product", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Product", exact: true });
    await dialog.getByLabel("Product name", { exact: false }).fill("Test Camera");
    await dialog.getByLabel("Regular daily price", { exact: false }).fill("500");
    await dialog.getByLabel("Product name", { exact: false }).press("Enter");
    await dialog.getByRole("button", { name: "Saving...", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.productCalls), 1);
    await dialog.getByLabel("Product name", { exact: false }).press("Enter");
    assert.equal(await page.evaluate(() => window.productCalls), 1);
    await page.evaluate(() => window.finishProduct());
    await dialog.waitFor({ state: "detached" });
    console.log("PASS: admin product editor saves with Enter and prevents repeated saves");
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
