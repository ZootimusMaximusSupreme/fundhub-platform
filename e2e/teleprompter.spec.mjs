// The teleprompter in a real browser, offline (unit X5, spec §8.1, §8.2).
//
// e2e/static-server.mjs serves public/; /api/** is answered here from the API
// contract's own example (src/marketing/api-contract.mjs GET marketing/shoot).
// No database, no session, nothing sent anywhere.
//
// It proves: no sign-in wall; the empty shoot; it opens on the first script
// with no Got it and shows its ad number, take and exact file name; mirror
// (left-right and upside down) flips the reading area and not the controls;
// v1's keys (Space plays, arrows change speed); at the end of a script Space
// is Got it and Page Up is Another take, each one POST with its own
// request_id; Learn remote; a press made offline waits on the phone and is
// sent once, with the same request_id, when the connection comes back.

import { test, expect } from "@playwright/test";
import { CONTRACT } from "../src/marketing/api-contract.mjs";

const plain = (v) => JSON.parse(JSON.stringify(v));
const PAGE = plain(CONTRACT["GET marketing/shoot"].example.response);
const [ONE, TWO] = PAGE.shoot.scripts;
const THREE = {
  ...ONE, id: "00000000-0000-4000-8000-000000000301", root_script_id: "00000000-0000-4000-8000-000000000301",
  ad_id: "93", title: "Your file is worth more", angle_name: "Your file is worth more", takes: 0, got_it: false,
  take_no: 1, take_file_name: "SLO Ad 93 — Your file is worth more Take 1.mp4", last_take_file_name: null, style: "words"
};
const SHOOT = { ...PAGE, shoot: { ...PAGE.shoot, root_script_ids: [ONE.root_script_id, THREE.root_script_id, TWO.root_script_id], scripts: [ONE, THREE, TWO] } };

async function open(page, { get = SHOOT, posts = [], token = true, markFails = () => false } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (token) await page.addInitScript(() => { localStorage.setItem("fh_token", "e2e-token"); });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace(/^\/api\//, "");
    if (req.method() === "GET" && p === "marketing/shoot") {
      const out = typeof get === "function" ? get() : get;
      return route.fulfill({ status: out.status || 200, contentType: "application/json", body: JSON.stringify(out.body ?? out) });
    }
    if (req.method() === "POST" && p === "marketing/shoot/mark") {
      const body = JSON.parse(req.postData() || "{}");
      posts.push(body);
      if (markFails(body)) return route.abort("internetdisconnected");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ marks: {} }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found", path: p }) });
  });
  await page.goto("/app/teleprompter.html");
  return errors;
}

const state = (page) => page.evaluate(() => window.__fhtp.state());

test.describe("teleprompter at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a film link sends the key, rolls the script, and never opens login", async ({ page }) => {
    let seen = "";
    await page.route("**/api/**", async (route) => {
      const req = route.request();
      if (new URL(req.url()).pathname.endsWith("/marketing/shoot")) seen = req.headers()["x-shoot-film"] || "";
      if (req.method() === "GET" && new URL(req.url()).pathname.endsWith("/marketing/shoot")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SHOOT) });
      }
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });
    await page.goto("/app/teleprompter.html?k=film-key-1");
    await expect(page.locator("#content")).toContainText("MOST lenders read TWO files before they say yes.");
    await expect(page.locator("#empty")).toBeHidden();
    await expect(page.locator("#empty-plan")).toBeHidden();
    expect(seen).toBe("film-key-1");
    expect(page.url()).not.toContain("login.html");
    await expect(page.getByText(/sign in/i)).toHaveCount(0);
    await page.reload();
    await expect(page.locator("#content")).toContainText("MOST lenders read TWO files before they say yes.");
    expect(page.url()).not.toContain("login.html");
  });

  test("no sign-in: the shoot rolls and the sign-in wall stays hidden", async ({ page }) => {
    await open(page, { token: false });
    await expect(page.locator("#wall")).toHaveCount(0);
    await expect(page.getByText(/sign in/i)).toHaveCount(0);
    await expect(page.locator("#content")).toContainText("MOST lenders read TWO files before they say yes.");
  });

  test("no shoot planned: says so and links to the Shoot tab", async ({ page }) => {
    await open(page, { get: { ...PAGE, shoot: null } });
    await expect(page.getByText("No shoot is planned. Pick the scripts on the Shoot tab and save the plan.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Plan it on the Shoot tab" })).toHaveAttribute("href", "/app/marketing-command-center.html#shoot");
  });

  test("opens on the first script with no Got it, with its ad number, take and exact file name; one column, big taps", async ({ page }) => {
    const errors = await open(page);
    await expect(page.locator("#s-title")).toHaveText("Your file is worth more");
    await expect(page.locator("#s-ad")).toHaveText("Ad 93 · Take 1 · 2 of 3");
    await expect(page.locator("#s-file")).toHaveText("SLO Ad 93 — Your file is worth more Take 1.mp4");
    await expect(page.locator("#content")).toContainText("MOST lenders read TWO files before they say yes.");
    await expect(page.locator("#content .w.caps").first()).toHaveText("MOST");
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    expect(w[0]).toBeLessThanOrEqual(w[1]);
    const small = await page.locator("#controls .btn").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).length);
    expect(small).toBe(0);
    await expect(page.locator("#controls .btn")).toHaveCount(2);
    await expect(page.locator("#b-rec")).toHaveText("Record");
    await expect(page.locator("#play")).toHaveText("Play");
    await expect(page.locator("#b-stop")).toHaveCount(0);
    await expect(page.locator("#b-script-save")).toBeHidden();
    await expect(page.locator("#wpm-down")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a saved speed is still there after a reload", async ({ page }) => {
    await open(page);
    await page.evaluate(() => localStorage.setItem("fhtp.wpm", JSON.stringify(180)));
    await page.reload();
    await expect(page.locator("#s-time")).toContainText("180 wpm");
  });

  test("Play becomes Pause while the words roll, and the buttons hide while the cursor is in the words", async ({ page }) => {
    await open(page);
    await expect(page.locator("#content")).toContainText("MOST lenders");
    await page.locator("#play").click();
    await expect(page.locator("#play")).toHaveText("Pause");
    await page.locator("#play").click();
    await expect(page.locator("#play")).toHaveText("Play");
    await page.evaluate(() => {
      document.body.classList.add("wording");
    });
    await expect(page.locator("#controls")).toBeHidden();
    await page.evaluate(() => {
      document.body.classList.remove("wording");
    });
    await expect(page.locator("#b-rec")).toBeVisible();
    await expect(page.locator("#play")).toBeVisible();
  });

  test("mirror flips the reading area (text, line, progress, end card) and never the controls", async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.__fhtp.openSheet("set"));
    await page.getByLabel("Mirror left to right (beam-splitter glass)").check();
    const flip = () => page.locator("#flip").evaluate((el) => getComputedStyle(el).transform);
    expect(await flip()).toBe("matrix(-1, 0, 0, 1, 0, 0)");
    await page.getByLabel("Flip upside down (some rigs need it)").check();
    expect(await flip()).toBe("matrix(-1, 0, 0, -1, 0, 0)");
    expect(await page.locator("#bar").evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fhtp.settings")))).toMatchObject({ mirror: true, flipV: true });
    // Kept on this device: a reload comes back mirrored.
    await page.reload();
    expect(await flip()).toBe("matrix(-1, 0, 0, -1, 0, 0)");
  });

  test("v1's keys: the arrows change the speed, Space counts down then rolls, Space again pauses", async ({ page }) => {
    await open(page);
    await expect(page.locator("#status .note")).toContainText("blank gap keeps that same speed");
    await expect(page.locator("#s-time")).toContainText("150 wpm");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator("#s-time")).toContainText("155 wpm");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator("#s-time")).toContainText("145 wpm");
    await page.keyboard.press(" ");
    await expect(page.locator("#count")).toBeVisible();
    await expect.poll(async () => (await state(page)).playing, { timeout: 5000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => document.body.classList.contains("rolling"))).toBe(true);
    await page.waitForTimeout(400);
    expect((await state(page)).t).toBeGreaterThan(0);
    const mid = await state(page);
    await page.keyboard.press("ArrowUp");
    await expect.poll(async () => (await state(page)).wpm).toBe(mid.wpm + 5);
    expect((await state(page)).playing).toBe(true);
    await page.keyboard.press("ArrowDown");
    await expect.poll(async () => (await state(page)).wpm).toBe(mid.wpm);
    expect((await state(page)).playing).toBe(true);
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press(" ");
    expect((await state(page)).playing).toBe(false);
  });
});

test.describe("teleprompter, the end of a script and the remote", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("double-tap the tiny name button finishes this script and shows the next; one tap does nothing", async ({ page }) => {
    const posts = [];
    await open(page, { posts });
    const chip = page.locator("#p-file");
    await expect(chip).toHaveText("SLO Ad 93 — Your file is worth more Take 1.mp4");
    await expect(chip).toBeVisible();
    const flip = await page.locator("#flip").boundingBox();
    const box = await chip.boundingBox();
    expect(box.height).toBeLessThanOrEqual(28);
    expect(box.width).toBeLessThanOrEqual(160);
    expect(box.y).toBeGreaterThanOrEqual(flip.y + flip.height - 1);
    await chip.click();
    await page.waitForTimeout(400);
    await expect(page.locator("#s-title")).toHaveText("Your file is worth more");
    expect(posts).toHaveLength(0);
    await chip.dblclick();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ shoot_id: PAGE.shoot.id, root_script_id: THREE.root_script_id, mark: "got_it" });
    await expect(page.locator("#s-title")).toHaveText("Inquiries off first");
    await expect(chip).toHaveText("Inquiries off first");
    await expect(page.locator("body")).not.toContainText("file-name word");
  });

  test("Space at the end is Got it: one mark, then the next script with no Got it loads", async ({ page }) => {
    const posts = [];
    await open(page, { posts });
    await page.evaluate(() => window.__fhtp.finish());
    await expect(page.locator("#end")).toBeVisible();
    await expect(page.locator("#end-take")).toHaveText("Name this clip: SLO Ad 93 — Your file is worth more Take 1.mp4");
    await page.keyboard.press(" ");
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ shoot_id: PAGE.shoot.id, root_script_id: THREE.root_script_id, mark: "got_it" });
    expect(posts[0].request_id).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
    await expect(page.locator("#toast")).toHaveText("Got it. Keep SLO Ad 93 — Your file is worth more Take 1.mp4.");
    await expect(page.locator("#s-ad")).toHaveText("Ad 92 · Take 1 · 3 of 3");
    await expect(page.locator("#s-file")).toHaveText("Inquiries off first");
    await expect(page.locator("#p-file")).toHaveText("Inquiries off first");
    await expect(page.locator("body")).not.toContainText("file-name word");
  });

  test("Page Up at the end is Another take: the take number moves on and it rolls again", async ({ page }) => {
    const posts = [];
    await open(page, { posts });
    await page.evaluate(() => window.__fhtp.finish());
    await page.keyboard.press("PageUp");
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].mark).toBe("another_take");
    await expect(page.locator("#s-ad")).toHaveText("Ad 93 · Take 2 · 2 of 3");
    await expect(page.locator("#s-file")).toHaveText("SLO Ad 93 — Your file is worth more Take 2.mp4");
    await expect(page.locator("#count")).toBeVisible();
  });

  test("Got it on the screen works too; the last one says to share the clips", async ({ page }) => {
    const posts = [];
    const one = { ...SHOOT, shoot: { ...SHOOT.shoot, scripts: [ONE, THREE] } };
    await open(page, { get: one, posts });
    await page.evaluate(() => window.__fhtp.finish());
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByText("Every script is marked Got it.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open SLO Ads" })).toHaveAttribute("href", "https://drive.google.com/drive/folders/13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ");
    expect(posts).toHaveLength(1);
  });

  test("Learn remote: a remote's button learned for Got it marks the take at the end", async ({ page }) => {
    const posts = [];
    await open(page, { posts });
    await page.evaluate(() => window.__fhtp.openSheet("set"));
    await page.locator('[data-slot="got_it"]').click();
    await expect(page.locator('[data-slot="got_it"]')).toContainText("Press the button now");
    await page.keyboard.press("b");
    await expect(page.locator('[data-slot="got_it"]')).toContainText("b");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fhtp.keys")))).toEqual({ got_it: ["key:b"] });
    await page.getByRole("button", { name: "Close" }).last().click();
    await page.evaluate(() => window.__fhtp.finish());
    await page.keyboard.press("b");
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].mark).toBe("got_it");
  });

  test("offline: the press waits on this phone, then goes once with the same request_id", async ({ page }) => {
    const posts = [];
    let down = true;
    await open(page, { posts, markFails: () => down });
    await page.evaluate(() => window.__fhtp.finish());
    await page.keyboard.press(" ");
    await expect(page.locator("#pending")).toBeHidden();
    await expect(page.locator("#pending")).toContainText("saved on this phone");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fhtp.queue")).length)).toBe(1);
    // The next script still loads; the shoot keeps going without a connection.
    await expect(page.locator("#s-ad")).toHaveText("Ad 92 · Take 1 · 3 of 3");
    down = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("fhtp.queue")).length)).toBe(0);
    await expect(page.locator("#pending")).toBeHidden();
    expect(posts.length).toBe(2);
    expect(posts[1].request_id).toBe(posts[0].request_id);
  });
});
