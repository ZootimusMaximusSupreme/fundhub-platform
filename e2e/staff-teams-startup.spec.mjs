import { test, expect, devices, webkit } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { json, OWNER, withSession } from "./harness.mjs";

// Hold the actual deferred library, not a substitute FHData implementation.
// Every API answer is fictional and local; unexpected writes fail closed.
const dataSource = fs.readFileSync(new URL("../public/app/data.js", import.meta.url));
const evidence = process.env.TEAM_STARTUP_EVIDENCE;
const session = { ...OWNER, principal: "staff" };
const staff = Array.from({ length: 27 }, (_, i) => ({
  id: i === 0 ? OWNER.staff.id : `fictional-staff-${i}`,
  name: i === 0 ? OWNER.staff.name : `Fictional Person ${i}`,
  email: i === 0 ? OWNER.staff.email : `e2e+aff-team-${i}@example.test`,
  role: i === 0 ? "owner" : i % 2 ? "closer" : "funding_advisor",
  status: i % 4 ? "active" : "invited",
  monitoring_consent_at: i % 3 ? "2026-10-01T12:00:00Z" : null,
  open_shift: i % 2, monitor_events_today: i
}));
const { defaultBrowserType: _engine, ...proMax } = devices["iPhone 17 Pro Max"];
const profiles = [
  { name: "chromium390", options: { viewport: { width: 390, height: 844 }, hasTouch: true }, states: ["full", "empty", "error"] },
  { name: "chromium1024", options: { viewport: { width: 1024, height: 900 } }, states: ["full"] },
  { name: "chromium1440", options: { viewport: { width: 1440, height: 1000 } }, states: ["full", "empty", "error"] },
  { name: "webkit440", engine: "webkit", options: proMax, states: ["full", "empty", "error"] },
  { name: "webkit1280", engine: "webkit", options: { viewport: { width: 1280, height: 900 } }, states: ["full"] },
  { name: "webkit838", engine: "webkit", options: { ...proMax, viewport: { width: 838, height: 390 } }, states: ["full"] }
];

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function capture(page, name, state, errors, requests, screenshot = true) {
  if (!evidence) return;
  const result = await page.evaluate(() => ({
    readyState: document.readyState, dependency: typeof window.FHData,
    events: window.__teamStartupEvents, width: innerWidth,
    pageWidth: document.documentElement.scrollWidth,
    busy: document.querySelector("#rosterTbl").getAttribute("aria-busy"),
    rowCount: document.querySelectorAll("#rosterBody tr[data-id]").length,
    status: document.querySelector("#hiddenLine").textContent
  }));
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, `${name}-${state}.json`), JSON.stringify({ ...result, errors, requests }, null, 2));
  if (!screenshot) return;
  await page.evaluate(({ name, state, errors }) => {
    const target = document.querySelector("#hiddenLine");
    const rect = target.getBoundingClientRect();
    const layer = document.createElement("div"); layer.id = "team-startup-proof-mark";
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const box = document.createElement("div");
    box.style.cssText = `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;border:2px solid #dc2626`;
    const caption = document.createElement("div");
    caption.style.cssText = "position:absolute;bottom:4px;left:4px;right:4px;padding:8px;border:2px solid #dc2626;background:#fffbea;color:#111;font:13px/1.4 Arial";
    caption.textContent = `FICTIONAL LOCAL CHECK · ${name} · ${state} · ${errors.length ? errors.join(" | ") : "No page error"}`;
    layer.append(box, caption); document.body.append(layer);
  }, { name, state, errors });
  await page.screenshot({ path: path.join(evidence, `${name}-${state}-MARKED.png`), fullPage: true });
  await page.locator("#team-startup-proof-mark").evaluate(e => e.remove());
}

for (const profile of profiles) test.describe(profile.name, () => {
  test.use(profile.options);
  for (const state of profile.states) test(`delayed real data.js preserves loading and ${state} roster`, async ({ page: configuredPage, baseURL }) => {
    // The configured worker carries a Chromium executable override.
    const apple = profile.engine === "webkit" ? await webkit.launch({ executablePath: webkit.executablePath() }) : null;
    const context = apple ? await apple.newContext({ ...profile.options, baseURL }) : null;
    const page = context ? await context.newPage() : configuredPage;
    const libraryGate = gate(), rosterGate = gate();
    const errors = [], requests = [], violations = [];
    let libraryRequests = 0, rosterRequests = 0, servedRealLibrary = false;
    const name = `${profile.name}-${state}`;
    try {
      page.on("pageerror", error => errors.push(error.message));
      await withSession(page, session);
      await page.addInitScript(() => {
        window.__teamStartupEvents = [];
        document.addEventListener("load", event => {
          if (event.target instanceof HTMLScriptElement && event.target.src && new URL(event.target.src).pathname === "/app/data.js") {
            window.__teamStartupEvents.push("data.js loaded");
          }
        }, true);
        document.addEventListener("DOMContentLoaded", () => window.__teamStartupEvents.push("DOMContentLoaded"), { once: true });
      });
      await page.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== new URL(baseURL).origin) return route.abort();
        if (request.method() !== "GET") {
          violations.push(`${request.method()} ${url.pathname}`);
          return route.abort();
        }
        if (url.pathname === "/app/data.js") {
          libraryRequests++;
          await libraryGate.promise;
          const response = await route.fetch();
          expect(await response.body()).toEqual(dataSource);
          servedRealLibrary = true;
          return route.fulfill({ response });
        }
        if (!url.pathname.startsWith("/api/")) return route.continue();
        requests.push(url.pathname + url.search);
        if (url.pathname === "/api/auth/session") return json(route, session);
        if (url.pathname === "/api/health") return json(route, { ok: true, db: "up" });
        if (url.pathname === "/api/read/staff") {
          rosterRequests++;
          expect(url.searchParams.get("limit")).toBe("200");
          await rosterGate.promise;
          return state === "error"
            ? json(route, { ok: false, error: "Fictional roster service failure." }, 500)
            : json(route, { ok: true, items: state === "empty" ? [] : staff, hiddenCount: 2 });
        }
        if (url.pathname === "/api/shifts") return json(route, { ok: true, shift: null });
        return json(route, { ok: true, items: [] });
      });
      await page.goto("/app/staff-teams.html", { waitUntil: "commit" });
      // The real shell has parsed the prompt session response while data.js is
      // still held. On the old page its earlier inline session also resolves,
      // so FHData.wire throws before the deferred library can run.
      await expect(page.locator("html")).toHaveClass(/fh-page-access-confirmed/);
      await expect(page.locator("#rosterTbl")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("#rosterBody .team-loading-row")).toHaveCount(6);
      expect(await page.evaluate(() => typeof window.FHData)).toBe("undefined");
      expect(await page.evaluate(() => document.readyState)).toBe("interactive");
      expect(libraryRequests).toBe(1);
      expect(rosterRequests).toBe(0);
      // WebKit screenshot capture waits for document font readiness, which
      // cannot settle while a deferred script is intentionally held.
      await capture(page, name, "library-held", errors, requests, false);
      libraryGate.release();
      await page.waitForLoadState("domcontentloaded");
      await capture(page, name, "library-released", errors, requests);
      expect(errors, "No roster startup may use FHData before its actual deferred script runs").toEqual([]);
      await expect.poll(() => rosterRequests).toBe(1);
      expect(servedRealLibrary).toBe(true);
      expect(await page.evaluate(() => window.__teamStartupEvents)).toEqual(["data.js loaded", "DOMContentLoaded"]);
      await expect(page.locator("#rosterTbl")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("#rosterBody tr[data-id]")).toHaveCount(0);
      await capture(page, name, "roster-held", errors, requests);
      rosterGate.release();
      await expect(page.locator("#rosterTbl")).toHaveAttribute("aria-busy", "false");
      if (state === "full") {
        await expect(page.locator("#rosterBody tr[data-id]")).toHaveCount(27);
        await expect(page.locator("#kHead")).toHaveText("27");
        await expect(page.locator("#rosterBody tr[data-id]").first()).toContainText(OWNER.staff.name);
        expect(await page.evaluate(() => PEOPLE[0].self)).toBe(true);
        await page.locator("#qFilter").fill("Fictional Person 26");
        await expect(page.locator("#rosterBody tr[data-id]")).toHaveCount(1);
        await page.locator("#qFilter").fill("");
        await page.locator("#rosterBody tr[data-id]").first().click();
        await expect(page.locator("#ed_first")).toHaveValue("Jordan");
        await page.locator("#edClose").click();
      } else if (state === "empty") {
        await expect(page.locator("#rosterBody")).toContainText("Your team starts here");
        await page.locator('[data-team-state-action="add"]').click();
        await expect(page.locator("#ed_first")).toHaveValue("");
        await page.locator("#edClose").click();
      } else {
        await expect(page.locator("#rosterBody")).toContainText("Team could not load");
        await expect(page.locator('[data-team-state-action="retry"]')).toHaveText("Reload team");
        await expect(page.locator("#fh-data-banner")).toContainText("something went wrong on our side");
      }
      await expect.poll(() => page.locator("#editor").evaluate(e => e.getBoundingClientRect().left >= innerWidth)).toBe(true);
      await capture(page, name, "settled", errors, requests);
      expect(libraryRequests).toBe(1);
      expect(rosterRequests).toBe(1);
      expect(violations).toEqual([]);
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => localStorage.getItem("fh_token"))).toBe("e2e-token");
    } finally {
      libraryGate.release();
      rosterGate.release();
      await page.unrouteAll({ behavior: "ignoreErrors" });
      if (apple) await apple.close();
    }
  });
});
