// Batch 18 practice tests: the partner Home screen (public/app/partner-galaxy.html) in a real Chromium with
// fake /api answers (no live data).
//
//   Download button   the Message Blaster gift: signed out, a bad answer, and a good answer that saves the file
//   Sidebar           which rows a partner is shown on this screen
//   Sky canvas        click a cluster to zoom in, click empty space or press Escape to pull back
//
// The canvas draws everything itself, so the zoom level is read the way a person feels it: the pointer
// over the sky is a pointing hand on a cluster that is not zoomed on, a zoom-out cursor anywhere once a
// cluster is zoomed on, and the plain arrow at rest.
//
// Not here, on purpose: "click a worker to open the detail panel". NODES, CLIENTS and ROUTES are empty
// arrays in the page, so no worker is drawn and nothing can be clicked (see manifest-b18.md).

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
  }, SURFACE);
});

// ───────────────────────── Sky canvas ─────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE_SOURCE = fs.readFileSync(path.join(HERE, "../../../../public/app/partner-galaxy.html"), "utf8");

/** The five static clusters, read from the page's own table: id, name, and where each one sits (fractions). */
function clusterTable() {
  const block = /var CLUSTERS = \[([\s\S]*?)\];/.exec(PAGE_SOURCE)[1];
  return [...block.matchAll(/\{id:'(\w+)',\s*name:'([^']+)',[^}]*?fx:([\d.]+),\s*fy:([\d.]+)/g)]
    .map(([, id, name, fx, fy]) => ({ id, name, fx: Number(fx), fy: Number(fy) }));
}

/** Where a cluster rests on a sky of this size: the page's own layout (a side gutter, then 66 above and 44 below). */
function restCentre(cluster, width, height) {
  const padX = Math.min(190, Math.max(92, width * 0.11));
  return [padX + cluster.fx * (width - 2 * padX), 66 + cluster.fy * (height - 66 - 44)];
}

/** Look around a point for a place where the pointer turns into a pointing hand (a cluster can be clicked). */
async function findCluster(page, box, [cx, cy], reach = 70, step = 14) {
  const cursor = async (x, y) => {
    await page.mouse.move(box.x + x, box.y + y);
    return page.evaluate(() => document.getElementById("sky").style.cursor);
  };
  for (let r = 0; r <= reach; r += step) {
    for (let a = 0; a < (r === 0 ? 1 : 8); a += 1) {
      const x = cx + r * Math.cos((a * Math.PI) / 4);
      const y = cy + r * Math.sin((a * Math.PI) / 4);
      if (x < 2 || y < 2 || x > box.width - 2 || y > box.height - 2) continue;
      if ((await cursor(x, y)) === "pointer") return [x, y];
    }
  }
  return null;
}

async function openSky() {
  const opened = await screens.open("/app/partner-galaxy.html", { session: PARTNER, viewport: VIEWPORT });
  const { page } = opened;
  await page.waitForSelector("#sky");
  await page.waitForTimeout(800);
  const box = await page.locator("#sky").boundingBox();
  const cursorAt = async (x, y) => {
    await page.mouse.move(box.x + x, box.y + y);
    return page.evaluate(() => document.getElementById("sky").style.cursor);
  };
  // an empty corner of the sky: arrow at rest, zoom-out once a cluster is zoomed on
  const corner = () => cursorAt(3, 3);
  return { ...opened, box, cursorAt, corner };
}

test("Sky: each of the five clusters can be clicked and a click zooms on it", { timeout: 240_000 }, async () => {
  await proof.check(/^Sky canvas: click a cluster to zoom/, async () => {
    const table = clusterTable();
    assert.deepEqual(table.map((c) => c.name), [
      "Fundhub (fulfillment)", "Sales & Funding", "Inquiry Removal", "Client-Facing Agents", "Ops Agents",
    ], "the page draws five clusters, each with its own name");
    const { page, box, corner, errors } = await openSky();
    assert.equal(await corner(), "default", "at rest the sky shows the plain arrow in empty space");
    for (const cluster of table) {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await waitFor(async () => (await corner()) === "default", `${cluster.name}: at rest`, 6000);
      const spot = await findCluster(page, box, restCentre(cluster, box.width, box.height));
      assert.ok(spot, `${cluster.name} is a clickable mass in the sky`);
      await page.mouse.click(box.x + spot[0], box.y + spot[1]);
      await waitFor(async () => (await corner()) === "zoom-out", `${cluster.name}: zoomed in`, 6000);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

test("Sky: clicking empty space or pressing Escape steps back one level at a time", { timeout: 180_000 }, async () => {
  await proof.check(/^Sky canvas: click empty space or press Escape to pull back/, async () => {
    const { page, box, corner, errors } = await openSky();
    const first = clusterTable()[1];
    const spot = await findCluster(page, box, restCentre(first, box.width, box.height));
    assert.ok(spot, "a cluster to zoom on");
    const [x, y] = spot;

    // zoom in, then click empty space: back to rest
    await page.mouse.click(box.x + x, box.y + y);
    await waitFor(async () => (await corner()) === "zoom-out", "zoomed in", 6000);
    await page.mouse.click(box.x + 3, box.y + 3);
    await waitFor(async () => (await corner()) === "default", "pulled back by a click in empty space", 6000);

    // zoom in, then Escape: back to rest
    await page.mouse.click(box.x + x, box.y + y);
    await waitFor(async () => (await corner()) === "zoom-out", "zoomed in again", 6000);
    await page.keyboard.press("Escape");
    await waitFor(async () => (await corner()) === "default", "pulled back by Escape", 6000);

    // Escape at rest changes nothing
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    assert.equal(await corner(), "default");
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
