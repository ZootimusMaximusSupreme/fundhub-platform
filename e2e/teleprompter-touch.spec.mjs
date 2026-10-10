// The teleprompter v2 on a touch screen: an iPhone (390 x 844) and an iPad
// (1024 x 1366), both with touch on (owner needs, 2026-10-06,
// docs/specs/teleprompter-requirements-2026-10-06.md).
//
// e2e/static-server.mjs serves public/; /api/** is answered by a small fake of
// the shipped routes, built from the API contract's own examples
// (src/marketing/api-contract.mjs): GET marketing/shoot, POST
// marketing/scripts/edit (a new version on the live one, 409 on a stale one),
// GET marketing/script (every version), GET marketing/health (repo copy held,
// no token). No database, no session, nothing sent anywhere.
//
// It proves: a tap on the words plays and a tap again pauses; a drag up
// rolls the words up and a drag down sends them down with the thumb; the arrow keys still
// change the speed while the words roll; paused, a drag moves them by hand; hold
// a line to change it in place; the change saves itself through the edit route
// (a new version, the pulse says so, honestly, with the repo copy waiting); an
// edit made offline waits on the phone, lives through a reload, and is sent
// once with the same request_id; a 409 shows both texts and Chris picks; the
// history shows who changed what; the iPad gets big words, one row of controls,
// a side drawer, and the mirror.

import { test, expect } from "@playwright/test";
import { CONTRACT } from "../src/marketing/api-contract.mjs";
import { wireApi, withSession } from "./harness.mjs";

const plain = (v) => JSON.parse(JSON.stringify(v));
const PAGE = plain(CONTRACT["GET marketing/shoot"].example.response);
const HEALTH = plain(CONTRACT["GET marketing/health"].example.response);
const [ONE, TWO] = PAGE.shoot.scripts;
const THREE = {
  ...ONE, id: "00000000-0000-4000-8000-000000000301", root_script_id: "00000000-0000-4000-8000-000000000301",
  ad_id: "93", title: "Your file is worth more", angle_name: "Your file is worth more", takes: 0, got_it: false,
  take_no: 1, take_file_name: "SLO Ad 93 — Your file is worth more Take 1.mp4", last_take_file_name: null, style: "words",
  version: 1, source: "machine", created_at: "2026-10-12T11:12:40.000Z", repo_commit: "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d"
};
const HOOK = "MOST lenders read TWO files before they say yes.";
const NEW_HOOK = "MOST lenders read BOTH files before they ever say yes.";

/* A fake of the shipped routes: one live version per script, a new one on each save. */
function fakeServer() {
  const scripts = [ONE, THREE, TWO].map(plain);
  const versions = {};
  for (const s of scripts) versions[s.root_script_id] = [plain(s)];
  let n = 0;
  const live = (rootId) => versions[rootId][0];
  const server = {
    posts: [],
    editDown: false,
    healthCalls: 0,
    shoot() {
      const shoot = { ...PAGE.shoot, root_script_ids: scripts.map((s) => s.root_script_id) };
      shoot.scripts = scripts.map((s) => ({ ...s, ...pick(live(s.root_script_id)), teleprompter_text: live(s.root_script_id).body }));
      return { ...PAGE, shoot };
    },
    edit(req) {
      const rootId = Object.keys(versions).find((r) => versions[r].some((v) => v.id === req.id));
      if (!rootId) return { status: 404, body: { error: "not_found", message: "That script was not found." } };
      const cur = live(rootId);
      if (cur.id !== req.id || cur.version !== req.version) {
        return { status: 409, body: { error: "stale", message: "Someone saved this after you opened it.", current: { version: cur.version, body: cur.body, parts: cur.parts } } };
      }
      return { status: 200, body: { script: server.save(rootId, req.body, req.parts ?? (req.body === cur.body ? cur.parts : null)), warnings: [] } };
    },
    save(rootId, body, parts, source = "chris") {
      const cur = live(rootId);
      cur.status = "superseded";
      n += 1;
      const next = { ...cur, id: `00000000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}`, version: cur.version + 1, status: "locked", body, parts, source, created_at: new Date(Date.UTC(2026, 9, 12, 16, n)).toISOString(), repo_commit: null };
      versions[rootId].unshift(next);
      return next;
    },
    script(id) {
      const rootId = Object.keys(versions).find((r) => versions[r].some((v) => v.id === id));
      if (!rootId) return { status: 404, body: { error: "not_found" } };
      return { status: 200, body: { script: versions[rootId].find((v) => v.id === id), versions: versions[rootId] } };
    },
    versions
  };
  function pick(v) { return { id: v.id, version: v.version, body: v.body, parts: v.parts, source: v.source }; }
  return server;
}

async function open(page, { server = fakeServer(), settings = { countdown: false } } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((s) => {
    localStorage.setItem("fh_token", "e2e-token");
    if (s && !localStorage.getItem("fhtp.settings")) localStorage.setItem("fhtp.settings", JSON.stringify(s));
  }, settings);
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\//, "");
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (req.method() === "GET" && p === "marketing/shoot") return json(200, server.shoot());
    if (req.method() === "GET" && p === "marketing/health") { server.healthCalls += 1; return json(200, HEALTH); }
    if (req.method() === "GET" && p === "marketing/script") { const r = server.script(url.searchParams.get("id")); return json(r.status, r.body); }
    if (req.method() === "POST" && p === "marketing/scripts/edit") {
      const body = JSON.parse(req.postData() || "{}");
      server.posts.push(body);
      if (server.editDown) return route.abort("internetdisconnected");
      const r = server.edit(body);
      return json(r.status, r.body);
    }
    if (req.method() === "POST" && p === "marketing/shoot/mark") return json(200, { marks: {} });
    return json(404, { error: "not_found", path: p });
  });
  await page.goto("/app/teleprompter.html");
  await expect(page.locator("#s-title")).toHaveText("Your file is worth more");
  return { server, errors };
}

const state = (page) => page.evaluate(() => window.__fhtp.state());

/* The middle of the reading area, away from the words' edges. */
async function middle(page) {
  const b = await page.locator("#stage").boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height * 0.6 };
}

/* A finger on the glass, through the browser's own touch input (CDP). */
async function finger(page) {
  const c = await page.context().newCDPSession(page);
  const send = (type, pts) => c.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  return {
    async drag(x, y, dy, steps = 8) {
      await send("touchStart", [{ x, y }]);
      for (let i = 1; i <= steps; i++) { await send("touchMove", [{ x, y: y + (dy * i) / steps }]); }
      await send("touchEnd", []);
    },
    async hold(x, y, ms = 800) {
      await send("touchStart", [{ x, y }]);
      await page.waitForTimeout(ms);
      await send("touchEnd", []);
    }
  };
}

async function roll(page) {
  await page.locator("#play").tap();
  await expect.poll(async () => (await state(page)).playing).toBe(true);
  await page.waitForTimeout(300);
}

async function editHook(page, text, from = HOOK) {
  const f = await finger(page);
  const box = await page.locator('#content p[data-p="0"]').boundingBox();
  await f.hold(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#edit-box")).toBeVisible();
  await expect(page.locator("#edit-box")).toHaveValue(from);
  await page.locator("#edit-box").fill(text);
}

const SAVED_HELD = /^Saved \d{1,2}:\d{2} [AP]M\. Waiting to copy to the repo\.$/;

for (const [name, size] of [["iPhone", { width: 390, height: 844 }], ["iPad", { width: 1024, height: 1366 }]]) {
  test.describe(`teleprompter on an ${name} (touch)`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true });

    test("one tap pauses, a tap again rolls on", async ({ page }) => {
      const { errors } = await open(page);
      await roll(page);
      const m = await middle(page);
      await page.touchscreen.tap(m.x, m.y);
      await expect.poll(async () => (await state(page)).playing).toBe(false);
      const paused = (await state(page)).t;
      await page.waitForTimeout(500); // more than a double tap apart
      expect((await state(page)).t).toBe(paused);
      await page.touchscreen.tap(m.x, m.y);
      await expect.poll(async () => (await state(page)).playing).toBe(true);
      await expect.poll(async () => (await state(page)).t).toBeGreaterThan(paused);
      expect((await state(page)).scrollMode).toBe(false);
      expect(errors).toEqual([]);
    });

    test("tap the words to play, tap again to pause, drag up rolls them up, and speed still changes while they roll", async ({ page }) => {
      await open(page);
      const m = await middle(page);
      const f = await finger(page);
      await page.touchscreen.tap(m.x, m.y);
      await expect.poll(async () => (await state(page)).playing).toBe(true);
      const wpm = (await state(page)).wpm;
      await page.keyboard.press("ArrowUp");
      await expect.poll(async () => (await state(page)).wpm).toBe(wpm + 5);
      expect((await state(page)).playing).toBe(true);
      await page.keyboard.press("ArrowDown");
      await expect.poll(async () => (await state(page)).wpm).toBe(wpm);
      expect((await state(page)).playing).toBe(true);
      await page.waitForTimeout(350);
      await page.touchscreen.tap(m.x, m.y);
      await expect.poll(async () => (await state(page)).playing).toBe(false);
      const paused = (await state(page)).t;
      await page.waitForTimeout(400);
      expect((await state(page)).t).toBe(paused);
      // Drag down: the words go down with the thumb.
      await f.drag(m.x, m.y - 80, 250);
      const moved = (await state(page)).t;
      expect(moved).toBeLessThan(paused);
      // Drag up: the words roll up. Next lines come from below.
      await f.drag(m.x, m.y + 40, -120);
      expect((await state(page)).t).toBeGreaterThan(moved);
      expect((await state(page)).playing).toBe(false);
      expect((await state(page)).scrollMode).toBe(false);
      await expect(page.locator("#scrollchip")).toBeHidden();
      const at = (await state(page)).word;
      await page.touchscreen.tap(m.x, m.y);
      await expect.poll(async () => (await state(page)).playing).toBe(true);
      expect((await state(page)).word).toBeGreaterThanOrEqual(at);
    });

    test("tap, then drag by hand: the words move while paused", async ({ page }) => {
      await open(page);
      await roll(page);
      const m = await middle(page);
      await page.touchscreen.tap(m.x, m.y);
      await expect.poll(async () => (await state(page)).playing).toBe(false);
      const t0 = (await state(page)).t;
      const f = await finger(page);
      await page.waitForTimeout(400);
      await f.drag(m.x, m.y - 40, 200);
      const s = await state(page);
      expect(s.t).toBeLessThan(t0);
      expect(s.playing).toBe(false);
      expect(s.mode).toBe("paused");
    });

    test("hold a line, change it in place: it saves itself through the edit route and rolls on", async ({ page }) => {
      const { server, errors } = await open(page);
      await editHook(page, NEW_HOOK);
      // The words never leave the teleprompter; the mirror is off while the box is open.
      expect((await state(page)).editing).toBe(true);
      await expect.poll(() => server.posts.length, { timeout: 5000 }).toBe(1);
      const post = server.posts[0];
      expect(post.id).toBe(THREE.id);
      expect(post.version).toBe(1);
      expect(post.request_id).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
      expect(post.body).toBe(THREE.body.replace(HOOK, NEW_HOOK));
      expect(post.parts.find((p) => p.kind === "hook").text).toBe(NEW_HOOK);
      // The pulse tells the truth: saved, and the repo copy waits for its key.
      await expect(page.locator("#p-save")).toHaveText(SAVED_HELD);
      await expect(page.locator("#e-status")).toHaveText(SAVED_HELD);
      await page.locator("#e-done").tap();
      await expect(page.locator("#edit-box")).toHaveCount(0);
      await expect(page.locator("#content")).toContainText("BOTH files before they ever say yes.");
      expect((await state(page)).script.version).toBe(2);
      // A second change goes on the new version.
      await editHook(page, NEW_HOOK + " Today.", NEW_HOOK);
      await page.locator("#e-done").tap();
      await expect.poll(() => server.posts.length).toBe(2);
      expect(server.posts[1]).toMatchObject({ id: server.versions[THREE.root_script_id][1].id, version: 2 });
      expect(server.versions[THREE.root_script_id][0].body).toContain(NEW_HOOK + " Today.");
      expect(errors).toEqual([]);
    });

    test("editing while it rolls: it stops, then rolls on from the start of the changed line", async ({ page }) => {
      const { server } = await open(page);
      await roll(page);
      await page.waitForTimeout(1500);
      const m = await middle(page);
      await page.touchscreen.tap(m.x, m.y); // pause, so the bar shows
      await expect.poll(async () => (await state(page)).playing).toBe(false);
      await page.waitForTimeout(400);
      await page.touchscreen.tap(m.x, m.y); // roll again
      await expect.poll(async () => (await state(page)).playing).toBe(true);
      const f = await finger(page);
      expect((await state(page)).word).toBeGreaterThan(0);
      const box = await page.locator('#content p[data-p="0"]').boundingBox();
      await f.hold(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page.locator("#edit-box")).toBeVisible();
      expect((await state(page)).playing).toBe(false);
      await page.locator("#edit-box").fill(NEW_HOOK);
      await page.locator("#e-done").tap();
      await expect.poll(() => server.posts.length).toBe(1);
      await expect.poll(async () => (await state(page)).playing).toBe(true);
      // The reading line sat inside the line he changed: it rolls that line again, new words.
      const s = await state(page);
      expect(s.word).toBeLessThan(3);
      expect(s.script.body.startsWith(NEW_HOOK)).toBe(true);
    });

    test("offline: the edit waits on this phone, lives through a reload, then goes once with the same request_id", async ({ page }) => {
      const { server } = await open(page);
      server.editDown = true;
      await editHook(page, NEW_HOOK);
      await page.locator("#e-done").tap();
      await expect(page.locator("#p-save")).toHaveText("Offline — 1 edit waiting");
      const first = server.posts[0].request_id;
      // The page comes back from a reload with the words still there and still waiting.
      await page.reload();
      await expect(page.locator("#content")).toContainText("BOTH files before they ever say yes.");
      await expect(page.locator("#p-save")).toHaveText(/edit waiting|Offline/);
      server.editDown = false;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(page.locator("#p-save")).toHaveText(SAVED_HELD);
      const ids = new Set(server.posts.map((p) => p.request_id));
      expect(ids).toEqual(new Set([first]));
      expect(server.versions[THREE.root_script_id]).toHaveLength(2);
      expect(server.versions[THREE.root_script_id][0].body).toContain(NEW_HOOK);
      expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("fhtp.edits")).items))).toEqual([]);
    });

    test("409: someone saved first — both texts show and Chris picks his own", async ({ page }) => {
      const { server } = await open(page);
      const theirs = THREE.body.replace(HOOK, "MOST banks read TWO files first.");
      server.save(THREE.root_script_id, theirs, null, "chris"); // the Scripts tab, on the Mac
      await editHook(page, NEW_HOOK);
      await page.locator("#e-done").tap();
      await expect(page.locator("#pick")).toBeVisible();
      await expect(page.locator("#pick-title")).toHaveText("Two versions of this script");
      await expect(page.locator("#pick-body")).toContainText("BOTH files before they ever say yes.");
      await expect(page.locator("#pick-body")).toContainText("MOST banks read TWO files first.");
      await expect(page.locator("#p-save")).toHaveText("Two versions. Tap to pick one.");
      await page.getByRole("button", { name: "Keep my words" }).tap();
      await expect(page.locator("#p-save")).toHaveText(SAVED_HELD);
      const last = server.posts[server.posts.length - 1];
      expect(last).toMatchObject({ id: server.versions[THREE.root_script_id][1].id, version: 2 });
      expect(server.versions[THREE.root_script_id][0].body).toContain(NEW_HOOK);
      expect(server.versions[THREE.root_script_id]).toHaveLength(3);
    });

    test("409, the other way: Chris picks the saved words and the screen shows them", async ({ page }) => {
      const { server } = await open(page);
      const theirs = THREE.body.replace(HOOK, "MOST banks read TWO files first.");
      server.save(THREE.root_script_id, theirs, null, "chris");
      await editHook(page, NEW_HOOK);
      await page.locator("#e-done").tap();
      await page.getByRole("button", { name: "Use the saved words" }).tap();
      await expect(page.locator("#content")).toContainText("MOST banks read TWO files first.");
      await expect(page.locator("#content")).not.toContainText("BOTH files");
      expect(server.versions[THREE.root_script_id]).toHaveLength(2);
    });

    test("history: who changed what and when, and whether the repo has it", async ({ page }) => {
      const { server } = await open(page);
      await editHook(page, NEW_HOOK);
      await page.locator("#e-hist").tap();
      await expect.poll(() => server.posts.length).toBe(1);
      await expect(page.locator("#p-save")).toHaveText(SAVED_HELD);
      await expect(page.locator("#hist")).toBeVisible();
      const rows = page.locator("#hist-list .ver");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText("Version 2 · Chris");
      await expect(rows.nth(0)).toContainText("Not in the repo yet.");
      await expect(rows.nth(0).locator("del")).toContainText("TWO");
      await expect(rows.nth(0).locator("ins")).toHaveText(["BOTH", "ever"]);
      await expect(rows.nth(1)).toContainText("Version 1 · The machine");
      await expect(rows.nth(1)).toContainText("In the repo.");
    });
  });
}

test.describe("teleprompter on an iPad: the rig", () => {
  test.use({ viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true });

  test("big words by default, one row of controls, settings in a side drawer, mirror kept on this iPad", async ({ page }) => {
    await open(page, { settings: null });
    expect((await state(page)).script.root_script_id).toBe(THREE.root_script_id);
    expect(await page.locator("#content").evaluate((el) => getComputedStyle(el).fontSize)).toBe("64px");
    const controls = await page.locator("#controls").boundingBox();
    expect(controls.width).toBeGreaterThan(600);
    const labels = await page.locator("#controls .btn").allTextContents();
    expect(labels.map((s) => s.trim())).toEqual(["Record", "Stop", "Play"]);
    const small = await page.locator("#bar .btn").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 56).length);
    expect(small).toBe(0);
    await page.evaluate(() => window.__fhtp.openSheet("set"));
    const drawer = await page.locator("#set").boundingBox();
    expect(drawer.x + drawer.width).toBeGreaterThan(1020);
    expect(drawer.width).toBeLessThanOrEqual(440);
    expect(drawer.height).toBeGreaterThan(1300);
    await page.getByLabel("Mirror left to right (beam-splitter glass)").check();
    await page.locator("#r-measure").fill("40");
    await page.locator("#set").getByRole("button", { name: "Close" }).tap();
    const flip = () => page.locator("#flip").evaluate((el) => getComputedStyle(el).transform);
    expect(await flip()).toBe("matrix(-1, 0, 0, 1, 0, 0)");
    // Editing shows the words the right way round, then the mirror comes back.
    await editHook(page, NEW_HOOK);
    expect(await flip()).toBe("none");
    await page.locator("#e-done").tap();
    expect(await flip()).toBe("matrix(-1, 0, 0, 1, 0, 0)");
    await page.reload();
    expect(await flip()).toBe("matrix(-1, 0, 0, 1, 0, 0)");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fhtp.settings")))).toMatchObject({ mirror: true, measure: 40 });
  });

  test("Next script goes on in film order without a mark; the take file name stays on screen while it rolls", async ({ page }) => {
    await open(page);
    await expect(page.locator("#p-file")).toHaveText("SLO Ad 93 — Your file is worth more Take 1.mp4");
    await roll(page);
    await page.waitForTimeout(1700); // the bars fade while it rolls; the pulse row does not
    await expect(page.locator("body")).toHaveClass(/rolling/);
    expect(Number(await page.locator("#pulse").evaluate((el) => getComputedStyle(el).opacity))).toBeGreaterThan(0.5);
    await page.touchscreen.tap(512, 700);
    await expect.poll(async () => (await state(page)).playing).toBe(false);
    await page.evaluate(() => window.__fhtp.next());
    await expect(page.locator("#s-ad")).toHaveText("Ad 92 · Take 1 · 3 of 3");
    await expect(page.locator("#p-file")).toHaveText("Inquiries off first");
    await expect(page.locator("body")).not.toContainText("file-name word");
  });
});

test.describe("the Command Center hears a saved edit", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("a teleprompter save makes the Shoot tab open in this browser read the words again at once", async ({ context }) => {
    const server = fakeServer();
    const cc = await context.newPage();
    await withSession(cc);
    let reads = 0;
    await wireApi(cc, {
      handlers: {
        "marketing/shoot": (route) => {
          reads += 1;
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(server.shoot()) });
        }
      }
    });
    await cc.goto("/app/marketing-command-center.html#shoot");
    await expect.poll(() => reads).toBeGreaterThan(0);
    await cc.waitForTimeout(500);
    const before = reads;
    const tp = await context.newPage();
    await open(tp, { server });
    await editHook(tp, NEW_HOOK);
    await tp.locator("#e-done").click();
    await expect.poll(() => server.posts.length).toBe(1);
    await expect.poll(() => reads, { timeout: 5000 }).toBeGreaterThan(before);
  });
});
