import { test, expect, devices, webkit } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { openScreen, json, OWNER } from "./harness.mjs";

// Presentation-only regression: real Journeys controls, fictional API answers.
// The full FIN-B14 proof remains unchanged and owns all editor behavior checks.
const evidence = path.join("ops/workflows/crm-astra-rollout/evidence/journeys-report", process.env.JOURNEYS_REPORT_EVIDENCE || "after");
const tree = {
  name: "Client", start: "A form is filled in", end: "A diagnostic is ready",
  desc: "A fictional journey for the report layout check.",
  nodes: [{ id: "n1", type: "record", title: "Save a note", cfg: { note: "Fictional local record." }, touches: [] }]
};
const report = {
  ok: true, runId: "layout-only", journeySource: "database",
  journeysSkipped: [], startEventFindings: [], screensUnreadable: false,
  headline: "Read every finding, then close this report.",
  summary: {
    walked: { paths: 6, clients: 5 },
    messages: { wouldHaveGoneOut: 0, pathsRefusedByFence: 0, blockedByGate: 0 },
    workflows: { fired: ["wf-local"], registered: 1, neverFired: [] },
    findings: {
      broken: Array.from({ length: 18 }, (_, i) => ({
        journey: "client", nodeTitle: `Fictional step ${i + 1}`,
        summary: "This detailed local result must remain available while the report Close control stays reachable."
      })),
      couldNotCheck: []
    },
    screens: { touchedAndWired: ["journeys.html"], touchedAndWireframe: [], touchedByNoJourney: [] }
  },
  paths: []
};

async function snapshot(page, profile, state) {
  const geometry = await page.evaluate(() => {
    const rect = selector => {
      const e = document.querySelector(selector), r = e.getBoundingClientRect(), s = getComputedStyle(e);
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, font: s.fontSize,
        z: s.zIndex, hit: !!hit && (hit === e || e.contains(hit)), hitId: hit?.id || hit?.tagName };
    };
    return {
      width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
      header: rect("#fh-workspace-header"), close: rect("#runclose"),
      report: rect("#runout"), scrollTop: document.querySelector(".jr-rcard").scrollTop
    };
  });
  fs.mkdirSync(evidence, { recursive: true });
  fs.writeFileSync(path.join(evidence, `${profile}-${state}.json`), JSON.stringify(geometry, null, 2));
  await page.evaluate(({ geometry, profile, state }) => {
    const layer = document.createElement("div"); layer.id = "journeys-test-mark";
    layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const r = geometry.close, box = document.createElement("div");
    box.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;border:2px solid #dc2626`;
    const note = document.createElement("div");
    note.textContent = `FICTIONAL LOCAL CHECK · ${profile} ${state} · Close y${r.y.toFixed(1)}, header bottom ${geometry.header.bottom.toFixed(1)} · ${r.hit ? "Close receives the pointer" : "Header blocks Close"}`;
    note.style.cssText = "position:absolute;bottom:4px;left:4px;right:4px;padding:8px;background:#fffbea;border:2px solid #dc2626;color:#111;font:13px/1.4 Arial";
    layer.append(box, note); document.body.append(layer);
  }, { geometry, profile, state });
  await page.screenshot({ path: path.join(evidence, `${profile}-${state}-MARKED.png`) });
  await page.locator("#journeys-test-mark").evaluate(e => e.remove());
  return geometry;
}

const { defaultBrowserType: _defaultBrowserType, ...proMax } = devices["iPhone 17 Pro Max"];
const profiles = [
  { name: "desktop1440", options: { viewport: { width: 1440, height: 1000 } } },
  { name: "phone390", options: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  { name: "promax440-webkit", engine: "webkit", options: proMax },
  { name: "landscape838-webkit", engine: "webkit", options: { ...proMax, viewport: { width: 838, height: 390 } } }
];

for (const profile of profiles) test.describe(profile.name, () => {
  test.use(profile.options);
  test("report Close and shared header remain reachable before and after scrolling", async ({ page: configuredPage, baseURL }) => {
    // The project supplies a Chromium executablePath. Name the WebKit binary
    // explicitly so that worker launch option does not select the wrong engine.
    const appleBrowser = profile.engine === "webkit" ? await webkit.launch({ executablePath: webkit.executablePath() }) : null;
    const appleContext = appleBrowser ? await appleBrowser.newContext({ ...profile.options, baseURL }) : null;
    const page = appleContext ? await appleContext.newPage() : configuredPage;
    try {
    const writes = [], errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("https://fonts.googleapis.com/**", r => r.abort());
    await page.route("https://fonts.gstatic.com/**", r => r.abort());
    await openScreen(page, "/app/journeys.html", OWNER, {
      "/api/journeys/run": route => {
        writes.push({ method: route.request().method(), body: route.request().postDataJSON() });
        return json(route, report);
      },
      "/api/journeys": route => {
        if (route.request().method() !== "GET") writes.push(route.request().method());
        return json(route, { ok: true, journeys: { client: tree } });
      }
    });
    await expect(page.locator("#canvas .chead p")).toHaveText(tree.desc);
    await page.locator("#fh-shell-search-btn").click();
    await expect(page.locator("#fh-shell-search-close")).toBeVisible();
    await page.locator("#fh-shell-search-close").click();
    await page.locator("#runreal").click();
    await expect(page.locator("#runclose")).toBeVisible();
    await expect(page.locator(".jr-rrow")).toContainText(Array.from({ length: 18 }, (_, i) => `Fictional step ${i + 1}`).concat("1 touched"));
    const initial = await snapshot(page, profile.name, "initial");
    await page.locator(".jr-rcard").evaluate(e => { e.scrollTop = e.scrollHeight; });
    await page.screenshot();
    const scrolled = await snapshot(page, profile.name, "scrolled");
    for (const state of [initial, scrolled]) {
      expect(state.pageWidth).toBeLessThanOrEqual(state.width);
      expect(state.close.width).toBeGreaterThanOrEqual(44);
      expect(state.close.height).toBeGreaterThanOrEqual(44);
      expect(state.close.y).toBeGreaterThanOrEqual(state.header.bottom);
      expect(state.close.bottom).toBeLessThanOrEqual(state.height);
      expect(state.close.hit).toBe(true);
    }
    expect(scrolled.scrollTop).toBeGreaterThan(0);
    await page.locator("#fh-workspace-scope > summary").click();
    await expect(page.locator("#fh-workspace-scope")).toHaveAttribute("open", "");
    await page.locator("#fh-workspace-scope > summary").click();
    await page.locator("#runclose").click();
    await expect(page.locator("#runout")).toHaveCount(0);
    await page.locator("#runreal").click();
    await page.locator("#runclose").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#runout")).toHaveCount(0);
    expect(writes).toEqual([{ method: "POST", body: {} }, { method: "POST", body: {} }]);
    expect(errors).toEqual([]);
    } finally {
      if (appleBrowser) await appleBrowser.close();
    }
  });
});
