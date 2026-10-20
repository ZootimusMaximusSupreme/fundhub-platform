// Batch 18 practice tests: the partner Home screen (public/app/partner-galaxy.html) in a real Chromium with
// fake /api answers (no live data).
//
//   Download button   the Message Blaster gift: signed out, a bad answer, and a good answer that saves the file
//   Sidebar           which rows a partner is shown on this screen, and which screens a partner may open
//   Sky canvas        click every cluster where it is shown, open/close a worker panel, and pull back
//
// The canvas draws everything itself, and the page keeps its zoom in a closure no test can reach. So the
// sky tests read what a person reads: the sky is drawn through a hooked 2D context that records, for every
// frame, the words the page drew (the "Sky / <cluster>" line at the top left and the cluster names) and the
// size and place of each cluster's glow, and the pointer over the sky is a pointing hand on a cluster that
// is not zoomed on and a zoom-out cursor on the one that is.
//
// WHERE A PERSON CLICKS. The page keeps the canvas bitmap and hit-testing coordinates aligned with the
// displayed sky box after layout changes. The tests still locate visible clusters and workers from recorded
// draw calls, then click the same displayed coordinates a person sees.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { proofRows, sharedScreens, waitFor } from "./fin-b18-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const SURFACE = "public/app/partner-galaxy.html";
const PARTNER = {
  ok: true,
  staff: { id: "staff-p", name: "Pat Partner", email: "pat@partner.test", role: "partner", org_id: "org-1", status: "active", partner_id: "pppppppp-1111-4111-8111-111111111111" },
};
const VIEWPORT = { width: 1400, height: 900 };

// ───────────────────────── Download button ─────────────────────────

async function openGift({ token = "e2e-token", gift }) {
  const calls = [];
  const handler = async (route) => {
    const request = route.request();
    calls.push({ method: request.method(), authorization: request.headers().authorization || null, accept: request.headers().accept || null });
    const answer = await gift();
    return route.fulfill(answer);
  };
  const opened = await screens.open("/app/partner-galaxy.html", {
    session: PARTNER, viewport: VIEWPORT, handlers: { "/api/gifts/message-blaster": handler },
    init: () => { try { localStorage.setItem("fh_token", window.__fhGiftToken || ""); } catch { /* none */ } },
    before: (page) => page.addInitScript((value) => { window.__fhGiftToken = value; try { localStorage.setItem("fh_token", value); } catch { /* none */ } }, token),
  });
  await opened.page.waitForSelector("#blasterBtn");
  return { ...opened, calls };
}

const DMG = Buffer.from("fake-disk-image-bytes");

test("Download: a signed-in partner gets MessageBlaster.dmg, a signed-out one is told to sign in, a bad answer says why", { timeout: 120_000 }, async () => {
  await proof.check(/^Message Blaster for Mac: Download button/, async () => {
    // good answer: the request carries the token, the button locks, the file is saved under its name
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const good = await openGift({
      gift: async () => { await gate; return { status: 200, contentType: "application/x-apple-diskimage", body: DMG }; },
    });
    assert.equal((await good.page.locator("#blasterBtn").innerText()).trim(), "Download", "the button says Download");
    const download = good.page.waitForEvent("download");
    await good.page.locator("#blasterBtn").click();
    await waitFor(() => good.calls.length === 1, "the gift request");
    assert.equal(await good.page.locator("#blasterBtn").isDisabled(), true, "the button is locked while it works");
    assert.equal(await good.page.locator("#blasterStatus").innerText(), "Preparing download…");
    assert.deepEqual(good.calls[0], { method: "GET", authorization: "Bearer e2e-token", accept: "application/x-apple-diskimage" });
    release();
    const file = await download;
    assert.equal(file.suggestedFilename(), "MessageBlaster.dmg");
    await good.page.waitForFunction(() => document.getElementById("blasterStatus").innerText === "Download started — open the file on your Mac.");
    assert.equal(await good.page.locator("#blasterBtn").isDisabled(), false, "the button is free again");
    assert.equal((await good.page.locator("#blasterBtn").innerText()).trim(), "Download", "and it still says Download");
    assert.deepEqual(good.errors, []);
    await good.page.close();

    // signed out (no token, or the demo token): told to sign in, and nothing is requested
    for (const token of ["", "demo"]) {
      const out = await openGift({ token, gift: async () => ({ status: 200, contentType: "application/x-apple-diskimage", body: DMG }) });
      await out.page.locator("#blasterBtn").click();
      await out.page.waitForFunction(() => document.getElementById("blasterStatus").innerText === "Sign in to download.");
      assert.deepEqual(out.calls, [], `token "${token}": no request is made`);
      assert.equal(await out.page.locator("#blasterBtn").isDisabled(), false);
      await out.page.close();
    }

    // the gift answers with a reason: the page says it, and the button is free again
    const refused = await openGift({ gift: async () => ({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "gift_unavailable" }) }) });
    await refused.page.locator("#blasterBtn").click();
    await refused.page.waitForFunction(() => document.getElementById("blasterStatus").innerText === "Could not download — gift_unavailable");
    assert.equal(await refused.page.locator("#blasterBtn").isDisabled(), false);
    await refused.page.close();

    // an answer with no reason says the status
    const bare = await openGift({ gift: async () => ({ status: 500, contentType: "text/plain", body: "boom" }) });
    await bare.page.locator("#blasterBtn").click();
    await bare.page.waitForFunction(() => document.getElementById("blasterStatus").innerText === "Could not download — HTTP 500");
    await bare.page.close();
  }, SURFACE);
});

// ───────────────────────── Sidebar ─────────────────────────

test("Sidebar: a partner is shown Social Studio and Creative Factory here, and no staff desk row", { timeout: 90_000 }, async () => {
  await proof.check(/^Sidebar rows a partner may open/, async () => {
    const { page, errors } = await screens.open("/app/partner-galaxy.html", { session: PARTNER, viewport: VIEWPORT });
    // the shell gates the rail from the role after the session answers: a gated row carries data-fh-gated
    await page.waitForSelector("#side a.navitem", { state: "attached" });
    await page.waitForFunction(() => document.querySelectorAll("#side [data-fh-gated]").length > 0);
    const rows = await page.evaluate(() => [...document.querySelectorAll("#side a.navitem")].map((a) => {
      const box = a.closest("li") || a;
      return { href: a.getAttribute("data-fh-href") || a.getAttribute("href"), shown: getComputedStyle(box).display !== "none" && getComputedStyle(a).display !== "none" };
    }));
    const shown = rows.filter((row) => row.shown).map((row) => row.href);
    assert.deepEqual(shown, ["social-studio.html", "creative-factory.html"], "a partner sees exactly these two rows on Home");
    for (const hidden of ["pipeline.html", "client-control-panel.html", "lenders.html", "finance-os.html", "ops-admin.html", "hiring.html", "contracts.html", "staff-teams.html", "campaign-manager.html"]) {
      const row = rows.find((r) => r.href === hidden);
      assert.ok(row, `${hidden} is in the rail markup`);
      assert.equal(row.shown, false, `${hidden} is not shown to a partner`);
    }
    // the one group with rows left is Marketing; every other group header is gone, and it opens to the two rows
    const headers = await page.evaluate(() => [...document.querySelectorAll("#side .navgroup")]
      .filter((group) => getComputedStyle(group).display !== "none").map((group) => group.dataset.fhSection));
    assert.deepEqual(headers, ["marketing"], "only the Marketing group is left in a partner's rail");
    await page.locator('#side .navgroup[data-fh-section="marketing"] .navhead').click();
    const open = await page.locator("#side a.navitem").evaluateAll((links) => links
      .filter((a) => a.offsetWidth > 0 && a.offsetHeight > 0).map((a) => a.getAttribute("data-fh-href")));
    assert.deepEqual(open, ["social-studio.html", "creative-factory.html"], "opening Marketing shows exactly the two rows");
    assert.deepEqual(errors, []);
    await page.close();

    // WHICH SCREENS A PARTNER MAY OPEN. The rail above is only what is drawn. The gate is the address: the
    // shell lets a partner stay on a screen in their list and sends them back to Home from any other.
    for (const allowed of ["partner-galaxy.html", "brand-studio.html", "social-studio.html", "creative-factory.html", "partner-training.html"]) {
      const opened = await screens.open(`/app/${allowed}`, { session: PARTNER, viewport: VIEWPORT });
      await opened.page.waitForSelector("html.fh-page-access-confirmed", { state: "attached", timeout: 20_000 });
      assert.equal(new URL(opened.page.url()).pathname, `/app/${allowed}`, `a partner opening ${allowed} stays on it`);
      await opened.page.close();
    }
    for (const refused of ["pipeline.html", "client-control-panel.html", "finance-os.html", "ops-admin.html", "galaxy.html", "campaign-manager.html", "hiring.html"]) {
      const opened = await screens.open(`/app/${refused}`, { session: PARTNER, viewport: VIEWPORT });
      await opened.page.waitForURL((u) => u.pathname === "/app/partner-galaxy.html", { timeout: 20_000 });
      assert.equal(new URL(opened.page.url()).pathname, "/app/partner-galaxy.html", `a partner opening ${refused} is sent back to Home`);
      await opened.page.close();
    }
  }, SURFACE);
});

// ───────────────────────── Sky canvas ─────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE_SOURCE = fs.readFileSync(path.join(HERE, "../../../../public/app/partner-galaxy.html"), "utf8");

/** The five static clusters, read from the page's own table: id and name. */
function clusterTable() {
  const block = /var CLUSTERS = \[([\s\S]*?)\];/.exec(PAGE_SOURCE)[1];
  return [...block.matchAll(/\{id:'(\w+)',\s*name:'([^']+)'/g)].map(([, id, name]) => ({ id, name }));
}

/** Runs before the page: records, for the latest frame, every word and every glow the sky draws. */
const SKY_HOOK = () => {
  const proto = CanvasRenderingContext2D.prototype;
  const state = { frame: { texts: [], grads: [] } };
  window.__fhSky = state;
  const clear = proto.fillRect;
  proto.fillRect = function (x, y, w, h) {
    // the page clears the whole sky once, at the start of every frame
    if (x === 0 && y === 0 && w > 300 && h > 200) state.frame = { texts: [], grads: [] };
    return clear.call(this, x, y, w, h);
  };
  const write = proto.fillText;
  proto.fillText = function (text, x, y, ...rest) {
    state.frame.texts.push([String(text), x, y]);
    return write.call(this, text, x, y, ...rest);
  };
  const glow = proto.createRadialGradient;
  proto.createRadialGradient = function (x0, y0, r0, x1, y1, r1) {
    state.frame.grads.push([x1, y1, r1]);
    return glow.call(this, x0, y0, r0, x1, y1, r1);
  };
};

const BREADCRUMB_Y = 20;

async function openSky() {
  const opened = await screens.open("/app/partner-galaxy.html", {
    session: PARTNER, viewport: VIEWPORT, before: (page) => page.addInitScript(SKY_HOOK),
  });
  const { page } = opened;
  await page.waitForSelector("#sky");
  await waitFor(async () => (await frameOf(page)).texts.length > 0, "the first frame", 10_000);
  // the page's own sky size (what it draws on) and the box it is shown in (what a person points at)
  const geometry = await page.evaluate(() => {
    const sky = document.getElementById("sky");
    const r = sky.getBoundingClientRect();
    return { left: r.left, top: r.top, shownW: r.width, shownH: r.height, drawnW: sky.width, drawnH: sky.height };
  });
  return { ...opened, geometry };
}

const frameOf = (page) => page.evaluate(() => window.__fhSky.frame);

/** Where a drawn place is SHOWN on the screen (the sky is drawn on a bitmap, then fitted to its box). */
const shown = (g, p) => [g.left + (p.x * g.shownW) / g.drawnW, g.top + (p.y * g.shownH) / g.drawnH];

/** "Sky / Sales & Funding" as the page draws it, and whether the pull-back hint is drawn. */
function breadcrumb(frame) {
  const at = frame.texts.map((t, i) => (t[0] === "Sky" && t[2] === BREADCRUMB_Y ? i : -1)).filter((i) => i >= 0).pop();
  if (at === undefined) return { crumbs: [], hint: false };
  const crumbs = [];
  for (let i = at; i < frame.texts.length && frame.texts[i][2] === BREADCRUMB_Y; i += 1) {
    if (frame.texts[i][0] !== "/") crumbs.push(frame.texts[i][0]);
  }
  return { crumbs, hint: frame.texts.some((t) => t[0] === "click empty space to pull back") };
}

/** Where a cluster is drawn and how big its glow is: its centre on the sky and the radius of the glow. */
function drawn(frame, name) {
  const label = frame.texts.filter((t) => t[0] === name.toUpperCase() && t[2] !== BREADCRUMB_Y).pop();
  if (!label) return null;
  const x = label[1];
  const glows = frame.grads.filter((g) => Math.abs(g[0] - x) < 0.01);
  if (!glows.length) return null;
  const big = glows.reduce((a, b) => (b[2] > a[2] ? b : a));
  return { x, y: big[1], radius: big[2] };
}

/** The pointer's cursor over a spot of the screen. */
async function cursorAt(page, [x, y]) {
  await page.mouse.move(x, y);
  return page.evaluate(() => document.getElementById("sky").style.cursor);
}

async function workerSpot(page, geometry) {
  const cx = geometry.left + geometry.shownW / 2;
  const cy = geometry.top + geometry.shownH / 2;
  for (const radius of [0, 12, 24, 36, 48, 60]) {
    for (const [dx, dy] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius],
      [radius, radius], [radius, -radius], [-radius, radius], [-radius, -radius]]) {
      const spot = [cx + dx, cy + dy];
      if (await cursorAt(page, spot) === "pointer") return spot;
    }
  }
  assert.fail("the focused team's service node is not reachable");
}

/** Wait until the camera stops: the biggest glow of the cluster stops changing. */
async function settled(page, name) {
  let last = -1;
  let still = 0;
  await waitFor(async () => {
    const now = drawn(await frameOf(page), name);
    if (!now) return false;
    still = last >= 0 && Math.abs(now.radius - last) < 0.4 ? still + 1 : 0;
    last = now.radius;
    return still >= 4;
  }, `${name}: the camera to stop`, 12_000);
  return drawn(await frameOf(page), name);
}

async function backToRest(page, name) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await waitFor(async () => breadcrumb(await frameOf(page)).crumbs.join("/") === "Sky", "the sky at rest", 12_000);
  return settled(page, name);
}

test("Sky: all five clusters can be clicked where they are shown and zoom on their own name", { timeout: 300_000 }, async () => {
  await proof.check(/^Sky canvas: click a cluster to zoom/, async () => {
    const table = clusterTable();
    assert.deepEqual(table.map((c) => c.name), [
      "Fundhub (fulfillment)", "Sales & Funding", "Inquiry Removal", "Client-Facing Agents", "Ops Agents",
    ], "the page draws five clusters, each with its own name");
    const { page, geometry, errors } = await openSky();
    assert.deepEqual(breadcrumb(await frameOf(page)), { crumbs: ["Sky"], hint: false }, "at rest the trail is just Sky");

    for (const cluster of table) {
      const rest = await backToRest(page, cluster.name);
      assert.ok(rest, `${cluster.name} is drawn on the sky`);
      const spot = shown(geometry, rest);
      assert.equal(await cursorAt(page, spot), "pointer", `${cluster.name}: its shown center is clickable`);
      await page.mouse.click(...spot);
      await waitFor(async () => breadcrumb(await frameOf(page)).crumbs.join("/") === `Sky/${cluster.name}`,
        `${cluster.name}: its own name in the trail`, 8000);
      assert.equal(breadcrumb(await frameOf(page)).hint, true, `${cluster.name}: the pull-back hint appears once zoomed`);

      const zoomed = await settled(page, cluster.name);
      const grew = zoomed.radius / rest.radius;
      assert.ok(grew > 1.8 && grew < 2.5, `${cluster.name}: zoomed in about 2x (it grew ${grew.toFixed(2)}x)`);
      assert.ok(Math.abs(zoomed.x - geometry.drawnW / 2) < 45 && Math.abs(zoomed.y - geometry.drawnH / 2) < 45,
        `${cluster.name}: centred on the sky`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

test("Sky: a neutral worker opens the detail panel without inventing live activity", { timeout: 180_000 }, async () => {
  await proof.check(/^Sky canvas: click a worker to open the detail panel/, async () => {
    const { page, geometry, errors } = await openSky();
    const cluster = clusterTable()[0];
    const rest = await settled(page, cluster.name);
    await page.mouse.click(...shown(geometry, rest));
    await waitFor(async () => breadcrumb(await frameOf(page)).crumbs.join("/") === `Sky/${cluster.name}`, "the cluster opens", 8000);
    await settled(page, cluster.name);
    const spot = await workerSpot(page, geometry);
    await page.mouse.click(...spot);
    await page.waitForSelector("#panel.open");
    const words = (await page.locator("#panel").innerText()).replace(/\s+/g, " ");
    assert.match(words, /Fulfillment service/);
    assert.match(words, /No live activity feed connected/);
    assert.match(words, /Not connected/);
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

test("Sky: clicking empty space or pressing Escape steps back out of a cluster, and Escape at rest changes nothing", { timeout: 240_000 }, async () => {
  await proof.check(/^Sky canvas: click empty space or press Escape/, async () => {
    const { page, geometry, errors } = await openSky();
    const cluster = clusterTable()[1];
    const trail = async () => breadcrumb(await frameOf(page)).crumbs.join("/");
    const rest = await settled(page, cluster.name);
    assert.ok(rest, "a cluster to zoom on");

    await page.mouse.click(...shown(geometry, rest));
    await waitFor(async () => (await trail()) === `Sky/${cluster.name}`, "zoomed in", 8000);
    await settled(page, cluster.name);
    const spot = await workerSpot(page, geometry);
    await page.mouse.click(...spot);
    await page.waitForSelector("#panel.open");
    await page.locator("#pClose").click();
    await waitFor(async () => !(await page.locator("#panel").evaluate((el) => el.classList.contains("open"))), "panel close button", 5000);
    await waitFor(async () => (await trail()) === `Sky/${cluster.name}`, "panel close returns to the cluster", 5000);

    await page.mouse.click(geometry.left + 3, geometry.top + geometry.shownH - 3);
    await waitFor(async () => (await trail()) === "Sky", "pulled back by a click in empty space", 8000);

    const again = await settled(page, cluster.name);
    await page.mouse.click(...shown(geometry, again));
    await waitFor(async () => (await trail()) === `Sky/${cluster.name}`, "zoomed in again", 8000);
    await page.keyboard.press("Escape");
    await waitFor(async () => (await trail()) === "Sky", "pulled back by Escape", 8000);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    assert.equal(await trail(), "Sky");
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
