// Command Center, Scripts / Launch / Shoot tabs: every paid or two-tap action asks
// first, a Cancel sends nothing, and one yes sends exactly one write
// (finish-the-853, batch 01, the "cost sheet and two-tap confirm drawn before every
// paid tap" row; the Ideas tab is in fin-b01-paid-taps-ideas.spec.mjs).
//
//   Scripts: Rewrite it (Fix) · Write now · Write it now (from an idea)
//   Launch : Turn on (one ad) · Load all approved into Meta
//   Shoot  : Close the shoot
//
// NO BACKEND: each tab is loaded in its own small stand-in frame and /api/** is
// answered by page.route(). Nothing is spent, loaded or closed.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exampleResponse, CONTRACT } from "../src/marketing/api-contract.mjs";
import { openTabHarness } from "./helpers/cc-tab-harness.mjs";
import { STUB_PATH, stubHtml } from "./helpers/cc-launch-stub.mjs";

test.use({ timezoneId: "America/Phoenix", locale: "en-US", viewport: { width: 1280, height: 900 } });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ok = (page, body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

/* ── Scripts ─────────────────────────────────────────────────────────────── */

async function openScripts(page) {
  const calls = [];
  await page.clock.install({ time: new Date("2026-10-12T16:00:00Z") });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\//, "");
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const key = `${req.method()} ${p}`;
    calls.push({ key, body });
    const answers = {
      "GET marketing/scripts": { scripts: exampleResponse("GET marketing/scripts").scripts, as_of: "2026-10-12T16:00:00Z" },
      "GET marketing/script": exampleResponse("GET marketing/script"),
      "GET marketing/batches": exampleResponse("GET marketing/batches"),
      "GET marketing/settings": exampleResponse("GET marketing/settings"),
      "GET marketing/funnels": exampleResponse("GET marketing/funnels"),
      "GET marketing/ideas": { ideas: exampleResponse("GET marketing/ideas").ideas },
      "GET marketing/rules": exampleResponse("GET marketing/rules"),
      "POST marketing/scripts/fix": [202, exampleResponse("POST marketing/scripts/fix")],
      "POST marketing/batches/write-now": [202, exampleResponse("POST marketing/batches/write-now")],
      "POST marketing/ideas": { idea: exampleResponse("POST marketing/ideas").idea, batch_id: "00000000-0000-4000-8000-000000000302", job_id: "00000000-0000-4000-8000-000000000502" },
    };
    const a = answers[key];
    if (!a) return route.fulfill(ok(page, { error: "not_found", message: "Not mocked here." }, 404));
    return Array.isArray(a) ? route.fulfill(ok(page, a[1], a[0])) : route.fulfill(ok(page, a));
  });
  await openTabHarness(page, { tab: "scripts", flavor: "fundhubcc" });
  await expect(page.locator("article.ccs-card")).toContainText("Draft 1 of 2");
  await answerLikeTheFrame(page);
  return calls;
}
const sent = (calls, key) => calls.filter((c) => c.key === key);

/* The harness's cost sheet only calls onConfirm. The real frame's costSheet also
   returns a promise of true or false, and a tab must run on an explicit true only.
   This makes the harness sheet answer both ways, as the frame does, so a tab that
   runs on any answer is caught. */
async function answerLikeTheFrame(page) {
  await page.evaluate(() => {
    const ctx = window.__stub.ctx;
    ctx.costSheet = function (o) {
      window.__stub.sheets.push({ kind: o.kind, title: o.title });
      return new Promise((resolve) => {
        const sheet = document.getElementById("stub-sheet");
        const yes = document.getElementById("stub-sheet-yes");
        const no = document.getElementById("stub-sheet-no");
        document.querySelector("#stub-sheet-title b").textContent = o.title;
        document.getElementById("stub-sheet-line").textContent = "Cost: unknown, not measured yet.";
        sheet.hidden = false;
        const done = (answer) => {
          yes.removeEventListener("click", onYes);
          no.removeEventListener("click", onNo);
          if (answer && o.onConfirm) o.onConfirm();
          resolve(answer);
        };
        const onYes = () => done(true);
        const onNo = () => done(false);
        yes.addEventListener("click", onYes);
        no.addEventListener("click", onNo);
      });
    };
  });
}

test.describe("Scripts tab: every paid tap, Cancel then yes", () => {
  test("Rewrite it (Fix a script from a note)", async ({ page }) => {
    const calls = await openScripts(page);
    await page.getByRole("button", { name: "Fix" }).click();
    await page.getByLabel("What should change?").fill("Shorter hook.");
    await page.getByRole("button", { name: "Rewrite it" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Rewrite this script from your note");
    expect(sent(calls, "POST marketing/scripts/fix"), "nothing before the answer").toHaveLength(0);
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(250);
    expect(sent(calls, "POST marketing/scripts/fix"), "a Cancel sends nothing").toHaveLength(0);
    await page.getByRole("button", { name: "Rewrite it" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Yes, go ahead" }).click();
    await expect.poll(() => sent(calls, "POST marketing/scripts/fix").length).toBe(1);
    expect(sent(calls, "POST marketing/scripts/fix")[0].body).toMatchObject({ note: "Shorter hook." });
  });

  test("Write now (a whole batch)", async ({ page }) => {
    const calls = await openScripts(page);
    await page.getByRole("button", { name: "Write now" }).click();
    await expect(page.getByRole("dialog")).toContainText("Write scripts now");
    expect(sent(calls, "POST marketing/batches/write-now")).toHaveLength(0);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(250);
    expect(sent(calls, "POST marketing/batches/write-now"), "a Cancel sends nothing").toHaveLength(0);
    await page.getByRole("button", { name: "Write now" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Yes, go ahead" }).click();
    await expect.poll(() => sent(calls, "POST marketing/batches/write-now").length).toBe(1);
  });

  test("Write it now (one script from a typed idea)", async ({ page }) => {
    const calls = await openScripts(page);
    await page.getByText("Ideas", { exact: true }).click();
    await page.getByLabel("Your idea").fill("Banks read the business file first.");
    await page.getByRole("button", { name: "Write it now" }).click();
    await expect(page.getByRole("dialog")).toContainText("Write one script from this idea now");
    expect(sent(calls, "POST marketing/ideas")).toHaveLength(0);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(250);
    expect(sent(calls, "POST marketing/ideas"), "a Cancel sends nothing").toHaveLength(0);
    await expect(page.getByLabel("Your idea")).toHaveValue("Banks read the business file first.");
    await page.getByRole("button", { name: "Write it now" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Yes, go ahead" }).click();
    await expect.poll(() => sent(calls, "POST marketing/ideas").length).toBe(1);
    expect(sent(calls, "POST marketing/ideas")[0].body).toMatchObject({ raw_points: "Banks read the business file first.", write_now: true });
  });
});

/* ── Launch ──────────────────────────────────────────────────────────────── */

const AD_ROW = "00000000-0000-4000-8000-000000000801";
const VIDEO_C = "00000000-0000-4000-8000-000000000703";
const VIDEO_D = "00000000-0000-4000-8000-000000000704";

function loadStatus() {
  const body = exampleResponse("GET marketing/meta/load-status");
  body.loads[0].ad_set = { ...body.loads[0].ad_set, name: "Roadmap broad", status: "PAUSED", daily_budget_cents: 10000 };
  body.loads[0].angle = "Lenders read two files";
  body.loads[0].funnel_key = "roadmap_147";
  return body;
}
const APPROVED = {
  ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
  items: [{ id: VIDEO_C, ad_id: "90", take_no: 2, video_kind: "ad", status: "approved", approved_at: "2026-10-13T20:01:00.000Z" }],
};

async function openLaunch(page) {
  const writes = [];
  await page.route(`**${STUB_PATH}`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: stubHtml("launch") }));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\//, "");
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    const reply = (code, data) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) });
    if (req.method() === "GET" && p === "marketing/meta/load-status") return reply(200, loadStatus());
    if (req.method() === "GET" && p === "ad-videos") return reply(200, APPROVED);
    if (req.method() === "POST") writes.push({ path: p, body });
    if (req.method() === "POST" && p === "marketing/meta/load") return reply(202, exampleResponse("POST marketing/meta/load"));
    if (req.method() === "POST" && p === "campaigns/write") return reply(200, { ok: true, ad: { id: AD_ROW, status: "ACTIVE" } });
    return reply(404, { error: "not_found" });
  });
  await page.goto(STUB_PATH);
  await expect(page.locator(".ccl-row", { hasText: "Ad 91" })).toBeVisible();
  return writes;
}

test.describe("Launch tab: every confirm, Cancel then yes", () => {
  test("Turn on one ad", async ({ page }) => {
    const writes = await openLaunch(page);
    const row = page.locator(".ccl-row", { hasText: "Ad 91" });
    await row.getByRole("button", { name: "Turn on" }).click();
    const sheet = page.getByRole("dialog", { name: "Turn on Ad 91?" });
    await expect(sheet).toBeVisible();
    expect(writes).toEqual([]);
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.waitForTimeout(250);
    expect(writes, "a Cancel sends nothing").toEqual([]);
    await row.getByRole("button", { name: "Turn on" }).click();
    await page.getByRole("dialog", { name: "Turn on Ad 91?" }).getByRole("button", { name: "Yes, turn on Ad 91" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].path).toBe("campaigns/write");
    expect(writes[0].body.action).toBe("resume_ad");
  });

  test("Load all approved ads into Meta", async ({ page }) => {
    const writes = await openLaunch(page);
    await page.locator("#cclLoadAll").click();
    const loadAll = /^Load \d+ ads? into Meta\?$/;
    const sheet = page.getByRole("dialog", { name: loadAll });
    await expect(sheet).toBeVisible();
    expect(writes).toEqual([]);
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.waitForTimeout(250);
    expect(writes, "a Cancel sends nothing").toEqual([]);
    await page.locator("#cclLoadAll").click();
    await page.getByRole("dialog", { name: loadAll }).getByRole("button", { name: "Load them" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].path).toBe("marketing/meta/load");
    expect(writes[0].body.all).toBe(true);
  });
});

/* ── Shoot ───────────────────────────────────────────────────────────────── */

const SHOOT_HOST = fs.readFileSync(path.join(HERE, "helpers", "shoot-tab-host.html"), "utf8");
const SHOOT_PAGE = JSON.parse(JSON.stringify(CONTRACT["GET marketing/shoot"].example.response));

test.describe("Shoot tab: Close the shoot, Cancel then yes", () => {
  test("Close the shoot", async ({ page }) => {
    const posts = [];
    await page.route("**/e2e-host/shoot.html", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: SHOOT_HOST }));
    await page.route("**/api/**", async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^\/api\//, "");
      if (req.method() === "GET" && p === "marketing/shoot") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SHOOT_PAGE) });
      if (req.method() === "POST") {
        posts.push({ path: p, body: JSON.parse(req.postData() || "{}") });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ shoot: SHOOT_PAGE.shoot }) });
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found", path: p }) });
    });
    await page.goto("/e2e-host/shoot.html");
    await page.getByRole("button", { name: "Close the shoot" }).click();
    await expect(page.getByText("Close this shoot? Scripts not marked Got it stay on the next plan.")).toBeVisible();
    expect(posts).toEqual([]);
    await page.getByRole("button", { name: "Keep it" }).click();
    await page.waitForTimeout(250);
    expect(posts, "a Cancel sends nothing").toEqual([]);
    await page.getByRole("button", { name: "Close the shoot" }).click();
    await page.getByRole("button", { name: "Close it" }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].body).toMatchObject({ id: SHOOT_PAGE.shoot.id, status: "done" });
  });
});
