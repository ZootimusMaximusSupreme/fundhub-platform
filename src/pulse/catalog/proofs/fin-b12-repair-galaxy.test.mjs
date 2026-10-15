// Batch 12, repair cycle 1: what the Galaxy sky does when the page LOADS.
// Practice test means a real page in Chromium, fake /api answers shaped like the saved feed, and a judgement
// of the words and the pill on the screen. Nothing here reads live data.
//
// The live checks for this page read the people, shifts and agents behind the sky. They cannot see the page
// ask for the feed, hold the WAITING pill until the answer comes, or turn the pill and the census into what
// the feed says. These tests can.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, json, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);

const node = (id, name, state) => ({
  id, c: "sales", kind: "human", name, ini: name.split(" ").map((w) => w[0]).join(""), role: "Closer", state, tempo: 0.4,
  out: 2, pace: 0.25, unit: "calls", act: state === "active" ? "On a client call" : "Idle — no open shift",
  pool: ["On a client call"], shift: "—", on: state === "active" ? "on shift" : "off shift",
  stats: [["Events today", "1"], ["Calls today", "1"], ["Open shift", state === "active" ? "yes" : "no"], ["State", state.toUpperCase()]],
  files: [], tl: [["—", "No timeline yet"]], is_demo: false,
});
const feed = (nodes) => ({ ok: true, simulated: false, demo_mode: false, nodes, kpis: [], clients: ["Dana Whitfield"], routes: [] });

/** The feed answer is held until `release()`, so the page can be looked at while it waits. */
function heldFeed(answer, status = 200) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const log = { asks: 0, headers: [] };
  return {
    log, release,
    handlers: {
      "/api/read/company-activity": async (route) => {
        // Only the exact path answers (the harness matches by "contains", so a wrong path that merely starts
        // with it would otherwise be answered too).
        if (new URL(route.request().url()).pathname !== "/api/read/company-activity") {
          return json(route, { ok: false, error: "not_found" }, 404);
        }
        log.asks += 1;
        log.headers.push(route.request().headers());
        await gate;
        return json(route, answer, status);
      },
    },
  };
}

const pill = (page) => page.locator("#livePill").evaluate((el) => ({ text: el.textContent.trim(), live: el.classList.contains("live") }));
const census = (page) => page.locator("#census").innerText().then((s) => s.replace(/\s+/g, " ").trim());

test("Galaxy: the page asks for the feed with the sign-in, waits on WAITING, then paints LIVE and the census from the feed", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Page itself loads \(full-screen canvas, clock, census, LIVE \/ WAITING pill\)/, async () => {
    // The sky is full screen: the canvas takes the width and most of the height of the window.
    const states = ["active", "active", "idle", "blocked"];
    const held = heldFeed(feed(states.map((s, i) => node(`staff:${i}`, `Worker Number${i}`, s))));
    const { page, errors } = await open("/app/galaxy.html", { session: OWNER, handlers: held.handlers });
    await waitFor(() => held.log.asks === 1);

    // While the feed has not answered: WAITING, nobody counted, and a clock that is running.
    assert.deepEqual(await pill(page), { text: "WAITING", live: false });
    assert.equal(await census(page), "0 workers · waiting on activity feed");
    assert.match((await page.locator("#clock").innerText()).trim(), /\d{1,2}:\d{2}:\d{2}/, "the clock shows a time");
    const box = await page.locator("canvas").first().boundingBox();
    assert.ok(box.width >= 1000 && box.height >= 600, `the canvas fills the window (${box.width}x${box.height})`);

    // The page asked once, for the company feed, with the staff sign-in on it.
    assert.equal(held.log.asks, 1);
    assert.equal(held.log.headers[0].authorization, "Bearer e2e-token");

    // The answer comes: LIVE, and the census counts each state in the feed.
    held.release();
    await page.waitForFunction(() => document.querySelector("#livePill")?.textContent.trim() === "LIVE");
    assert.deepEqual(await pill(page), { text: "LIVE", live: true });
    await page.waitForFunction(() => /4 workers/.test(document.querySelector("#census")?.innerText || ""));
    assert.equal(await census(page), "4 workers · 2 working · 1 blocked · 1 idle");
    assert.match((await page.locator("#galaxyBackendNotice").textContent()).replace(/\s+/g, " "), /Live.*4 workers/);
    assert.deepEqual(errors, []);
    await page.close();

    // A feed with other numbers gives other words: 3 people, 1 working.
    const second = heldFeed(feed([node("a", "Ann Able", "active"), node("b", "Bo Best", "idle"), node("c", "Cy Cole", "idle")]));
    second.release();
    const again = await open("/app/galaxy.html", { session: OWNER, handlers: second.handlers });
    await again.page.waitForFunction(() => /3 workers/.test(document.querySelector("#census")?.innerText || ""));
    assert.equal(await census(again.page), "3 workers · 1 working · 2 idle");
    await again.page.close();
  });
});

test("Galaxy: a feed with nobody, a failed feed and a signed-out visit all stay on WAITING and say why", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Page itself loads \(full-screen canvas, clock, census, LIVE \/ WAITING pill\)/, async () => {
    // Nobody clocked in.
    const empty = heldFeed(feed([]));
    empty.release();
    const a = await open("/app/galaxy.html", { session: OWNER, handlers: empty.handlers });
    await a.page.waitForFunction(() => /No workers yet/.test(document.querySelector("#galaxyBackendNotice")?.textContent || ""));
    assert.deepEqual(await pill(a.page), { text: "WAITING", live: false });
    assert.equal(await census(a.page), "0 workers · waiting on activity feed");
    await a.page.close();

    // The feed failed: the page says so with the status, and does not claim LIVE.
    const failed = heldFeed({ ok: false, error: "server_error" }, 500);
    failed.release();
    const b = await open("/app/galaxy.html", { session: OWNER, handlers: failed.handlers });
    await b.page.waitForFunction(() => /Activity feed failed/.test(document.querySelector("#galaxyBackendNotice")?.textContent || ""));
    assert.match(await b.page.locator("#galaxyBackendNotice").textContent(), /\(500\)/);
    assert.deepEqual(await pill(b.page), { text: "WAITING", live: false });
    await b.page.close();

    // Signed out: no feed is asked for, and the page says a real staff session is needed.
    const out = heldFeed(feed([node("a", "Ann Able", "active")]));
    out.release();
    const c = await open("/app/galaxy.html", { session: null, handlers: out.handlers });
    await c.page.waitForFunction(() => /Sign in required/.test(document.querySelector("#galaxyBackendNotice")?.textContent || ""));
    assert.equal(out.log.asks, 0, "no feed was asked for without a sign-in");
    assert.deepEqual(await pill(c.page), { text: "WAITING", live: false });
    await c.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
