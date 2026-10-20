// Local compatibility receipt, not a replacement for the existing red arrow-key
// specs. Every API is intercepted and all records are fictional fixtures.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, webkit, expect, devices } from "@playwright/test";
import { openScreen, OWNER } from "../../../e2e/harness.mjs";
import bundle from "../../../src/demo/client-portal-sample-bundle.json" with { type: "json" };
import { startPreviewServer } from "../dashboard-ux-polish/astra-comparison/preview-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const OUT = path.join(HERE, "evidence/native-keyboard");
fs.mkdirSync(OUT, { recursive: true });
const baseline = "f1ab024ee0fca5b236ecac50957ec0286c628101";
const id = "c1000000-0000-4000-8000-000000000001";
const client = { ok: true, principal: "client", staff: { role: "client", id, client_id: id } };
const profiles = [
  { key: "chromium1440", engine: chromium, viewport: { width: 1440, height: 900 }, hasTouch: true },
  { key: "chromium390", engine: chromium, viewport: { width: 390, height: 844 }, hasTouch: true },
  { key: "webkit440", engine: webkit, ...devices["iPhone 17 Pro Max"] },
];
const targets = [
  { key: "credit", url: "/app/money-credit.html", selector: "select[aria-label='Money section']", session: client,
    handlers: { ...bundle.reads, "/api/read/affiliate-portal": { ok: true, enrolled: false } },
    letter: "b", value: "/app/money-banks.html", destination: true },
  { key: "finance", url: "/app/finance-os.html", selector: "#fosClient", session: OWNER,
    handlers: { "/api/dashboard/clients": { ok: true, clients: [{ id, first_name: "Dana", last_name: "Whitfield", email: "dana@example.test" }] } },
    letter: "d", value: id, destination: false },
];
const { server, origin } = await startPreviewServer();
const results = [];
try {
  for (const profile of profiles) {
    const browser = await profile.engine.launch({ headless: true });
    try {
      for (const target of targets) for (const version of ["baseline", "astra"]) {
        const { engine, key, ...options } = profile;
        const context = await browser.newContext({ baseURL: origin, ...options, serviceWorkers: "block" });
        const page = await context.newPage();
        const reads = [], errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("request", req => { if (/\/api\/(read\/finance-os|finance\/(bank-accounts|bills))/.test(req.url())) reads.push(req.url()); });
        await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        if (version === "baseline") {
          const html = execFileSync("git", ["show", `${baseline}:public${target.url}`], { cwd: ROOT, encoding: "utf8" });
          await page.route(`**${target.url}`, route => route.fulfill({ contentType: "text/html", body: html }));
        }
        const record = { profile: profile.key, target: target.key, version, errors, originalArrowPassed: false, typeaheadPassed: false };
        try {
          await openScreen(page, target.url, target.session, target.handlers);
          // Settle actual WebKit paint before measuring native control geometry.
          await page.screenshot();
          await expect(page.locator(target.selector)).toBeVisible();
          if (target.key === "finance") await expect(page.locator(`${target.selector} option`)).toHaveCount(2);
          await page.locator(target.selector).focus();
          await expect(page.locator(target.selector)).toBeFocused();
          await page.keyboard.press("ArrowDown");
          await page.keyboard.press(target.destination ? "Enter" : "Tab");
          record.arrowUrl = new URL(page.url()).pathname;
          record.arrowValue = await page.locator(target.selector).inputValue();
          record.originalArrowPassed = target.destination ? record.arrowUrl !== target.url : record.arrowValue === target.value;
          await page.goto(target.url);
          await page.screenshot();
          await expect(page.locator(target.selector)).toBeVisible();
          if (target.key === "finance") await expect(page.locator(`${target.selector} option`)).toHaveCount(2);
          await page.locator(target.selector).focus();
          await expect(page.locator(target.selector)).toBeFocused();
          await page.keyboard.press(target.letter);
          await page.keyboard.press(target.destination ? "Enter" : "Tab");
          if (target.destination) await expect(page).toHaveURL(new RegExp("/app/money-banks\\.html$"));
          else {
            await expect(page.locator(target.selector)).toHaveValue(target.value);
            // Separate native typeahead selection from the original Tab-focus
            // contract, which remains asserted by the unchanged existing spec.
            record.openButtonFocusedAfterTab = await page.locator("#fosOpen").evaluate(el => document.activeElement === el);
            expect(reads).toEqual([]);
          }
          record.typeaheadUrl = new URL(page.url()).pathname;
          record.typeaheadPassed = errors.length === 0;
          record.financialReads = reads;
        } catch (error) { record.failure = error.message; }
        results.push(record);
        console.log(JSON.stringify(record));
        await context.close();
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ capturedAt: new Date().toISOString(), platform: process.platform, baseline, note: "Typeahead is separate real keyboard-event proof. Original arrow-key failures remain red; neither selectOption nor script selection is used.", results }, null, 2) + "\n");
  if (results.some(row => !row.typeaheadPassed)) process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
