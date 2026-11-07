// The organized Alerts screen (unit AL2, 2026-11-07) in a real browser at 1440, 390
// and 320 wide, on both pages that run it: the stand-alone /app/money-alerts.html and
// the Alerts tab of /app/financeos.html. For each width: Personal and the business,
// the add-alert form open, and the four states. Every visible control is at least
// 44 by 44, nothing scrolls sideways, and the page throws no error.
// NO BACKEND: page.route() answers /api/**; nothing is saved.
import { test, expect } from "@playwright/test";
import fs from "node:fs";

const fixture = JSON.parse(fs.readFileSync("src/finance/file-alerts/file-alerts.fixture.json", "utf8"));
const DIR = "ops/workflows/build-evidence/fos-al2-custom-alerts-2026-11-07";
const BIZ = "biz:5b0c7e1a-3d2f-4a6b-9c8d-7e6f5a4b3c21";

/* Every visible button, link, select, input and switch inside the section, with its size. */
async function smallControls(page, scope) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ["no section"];
    const out = [];
    for (const el of root.querySelectorAll("button, a[href], select, input, [role=switch], summary")) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!r.width || !r.height || style.visibility === "hidden" || style.display === "none") continue;
      if (r.width < 44 || r.height < 44) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
}
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

const PAGES = [
  { name: "money-alerts", url: "/app/money-alerts.html", scope: "#alerts-root" },
  { name: "financeos", url: "/app/financeos.html#alerts", scope: "#fos-alerts" }
];

for (const width of [1440, 390, 320]) {
  for (const where of PAGES) {
    test(`alerts board on ${where.name} at ${width}: both scopes, the form, the four states`, async ({ browser }) => {
      fs.mkdirSync(DIR, { recursive: true });
      const context = await browser.newContext({ hasTouch: true, viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      let state = "full";
      await page.route("**/api/**", async (route) => {
        const u = route.request().url();
        let body = { ok: true };
        let status = 200;
        if (u.includes("auth/session")) body = { ok: true, principal: "client", staff: { role: "client" } };
        else if (u.includes("/money/alerts")) {
          if (route.request().method() === "POST") body = { ok: true, saved: true };
          else if (state === "loading") return; // never answers: the skeleton stays
          else if (state === "error") { status = 500; body = { ok: false }; }
          else if (state === "empty") {
            body = { ...fixture, cards: [], alerts: [], custom: [],
              board: { ...fixture.board, scopes: fixture.board.scopes.map((x) => ({ ...x, payments: [], bills: [], smart: [] })) },
              reserve: { personal: { state: "unknown" }, business: { state: "unknown" } } };
          } else body = fixture;
        } else if (u.includes("/money/overview")) body = { ok: true, client: { name: "Sample Client" }, sandbox: false };
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      });
      await page.addInitScript(() => { try { localStorage.setItem("fh_token", "t"); localStorage.setItem("fh_role", "client"); } catch (e) { /* none */ } });

      const shot = (label) => page.screenshot({ path: `${DIR}/${where.name}-${label}-${width}.png`, fullPage: true });
      const scoped = (sel) => page.locator(`${where.scope} ${sel}`);

      // Full, Personal.
      await page.goto(where.url);
      await expect(scoped("#fa-pay")).toBeVisible({ timeout: 15_000 });
      await expect(scoped('[data-act="scope"][data-scope="personal"]')).toHaveAttribute("aria-pressed", "true");
      await expect(scoped("#fa-smart")).toContainText("Cash low");
      await expect(scoped("#fa-smart")).toContainText("Pay by Oct 23");
      expect(await smallControls(page, where.scope)).toEqual([]);
      expect(await sideways(page)).toBe(false);
      await shot("personal");

      // Full, the business.
      await scoped(`[data-act="scope"][data-scope="${BIZ}"]`).tap();
      await expect(scoped("#fa-smart")).toContainText("Pay by Oct 13");
      await expect(scoped("#fa-smart")).toContainText("Seasoned in 18 days");
      await expect(scoped("#fa-bills")).toContainText("Office rent");
      expect(await smallControls(page, where.scope)).toEqual([]);
      expect(await sideways(page)).toBe(false);
      await shot("business");

      // The add-bill form open, with the yearly date field.
      await scoped('[data-act="add"][data-kind="bill"]').tap();
      await scoped("#fa-cf-cadence").selectOption("annual");
      await expect(scoped("#fa-cf-date")).toBeVisible();
      await expect(scoped("#fa-cf-for")).toHaveValue(BIZ, { timeout: 2_000 });
      expect(await smallControls(page, where.scope)).toEqual([]);
      expect(await sideways(page)).toBe(false);
      await shot("form");

      for (state of ["empty", "error", "loading"]) {
        await page.goto("about:blank"); // a hash-only change would not load the page again
        await page.goto(where.url);
        if (state === "empty") await expect(scoped("#fa-empty")).toHaveText("Nothing to watch yet", { timeout: 15_000 });
        else if (state === "error") await expect(scoped('[data-act="retry"]')).toBeVisible({ timeout: 15_000 });
        else await expect(scoped('[aria-busy="true"]').first()).toBeVisible({ timeout: 15_000 });
        expect(await smallControls(page, where.scope)).toEqual([]);
        expect(await sideways(page)).toBe(false);
        await shot(state);
      }
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}
