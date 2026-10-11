import { test, expect } from "@playwright/test";
import { CONTRACT } from "../src/marketing/api-contract.mjs";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const copy = (v) => JSON.parse(JSON.stringify(v));
const sample = CONTRACT["GET marketing/shoot"].example.response;
const health = CONTRACT["GET marketing/health"].example.response;

async function open(page, { countdown = false, wpm = 200, camera = true, holdUpload = false } = {}) {
  const scripts = sample.shoot.scripts.map((s, i) => ({
    ...copy(s), got_it: false, takes: 0, take_no: 1, style: "words",
    body: ("These are the words for a steady camera take. ").repeat(40),
    teleprompter_text: ("These are the words for a steady camera take. ").repeat(40),
    take_file_name: `SLO Ad ${s.ad_id} — Script ${i + 1} Take 1.mp4`
  }));
  const server = { marks: [], uploads: [], chunks: [], errors: [], release: null };
  const uploadGate = holdUpload ? new Promise((resolve) => { server.release = resolve; }) : Promise.resolve();
  page.on("pageerror", (e) => server.errors.push(String(e)));
  await page.addInitScript(({ countdown, wpm, camera }) => {
    localStorage.setItem("fhtp.settings", JSON.stringify({ countdown, wpm, cam: "1080p" }));
    localStorage.setItem("fhtp.wpm", JSON.stringify(wpm));
    if (!camera) return;
    // A real MediaStream for the preview, with a deterministic recorder. No device or upload.
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 32;
    canvas.getContext("2d").fillRect(0, 0, 32, 32);
    const stream = canvas.captureStream(30);
    const track = stream.getVideoTracks()[0];
    track.getSettings = () => ({ width: 32, height: 32, frameRate: 30, facingMode: "user" });
    track.applyConstraints = () => Promise.resolve();
    navigator.mediaDevices.getUserMedia = () => Promise.resolve(stream);
    navigator.mediaDevices.enumerateDevices = () => Promise.resolve([]);
    let take = 0;
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor() { this.state = "inactive"; }
      start() { this.state = "recording"; this.take = ++take; }
      stop() {
        this.state = "inactive";
        setTimeout(() => {
          this.ondataavailable({ data: new Blob([`take-${this.take}`], { type: "video/mp4" }) });
          this.onstop();
        }, 10);
      }
    };
  }, { countdown, wpm, camera });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/marketing/shoot" && req.method() === "GET") {
      return json({ ...copy(sample), shoot: { ...copy(sample.shoot), scripts: copy(scripts) } });
    }
    if (p === "/api/marketing/health") return json(health);
    if (p === "/api/marketing/shoot/mark") {
      const mark = req.postDataJSON();
      server.marks.push(mark);
      const s = scripts.find((s) => s.root_script_id === mark.root_script_id);
      if (s) { s.takes++; s.got_it = mark.mark === "got_it"; }
      return json({ marks: {} });
    }
    if (p === "/api/marketing/shoot/take" && req.method() === "POST") {
      server.uploads.push(req.postDataJSON());
      return json({ ok: true, token: `take-${server.uploads.length}`, chunk_bytes: 1024 * 1024 });
    }
    if (p === "/api/marketing/shoot/take" && req.method() === "PUT") {
      server.chunks.push(req.postData());
      await uploadGate;
      return json({ ok: true, done: true });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("/app/teleprompter.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#p-file")).toHaveText(scripts[0].take_file_name);
  if (camera) await expect(page.locator("#cam")).toBeVisible();
  return { server, scripts };
}

const state = (page) => page.evaluate(() => window.__fhtp.state());

async function stopTake(page) {
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await page.locator("#b-rec").tap();
  await expect(page.getByRole("dialog", { name: "Save this video?" })).toBeVisible();
}

test("every take asks Yes or No; No sends nothing and Yes sends that take once", async ({ page }) => {
  const { server, scripts } = await open(page);
  await stopTake(page);
  await expect(page.locator("#take-save-name")).toHaveText(scripts[0].take_file_name);
  await page.screenshot({ path: test.info().outputPath("take-save.png") });
  expect(server.uploads).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#take-save")).toBeVisible();
  await page.getByRole("button", { name: "No", exact: true }).tap();
  await expect(page.locator("#take-save")).toBeHidden();
  expect(server.uploads).toHaveLength(0);

  await stopTake(page);
  expect(server.uploads).toHaveLength(0);
  await page.getByRole("button", { name: "Yes", exact: true }).tap();
  await expect.poll(() => server.chunks.length).toBe(1);
  expect(server.uploads).toHaveLength(1);
  expect(server.uploads[0].name).toBe(scripts[0].take_file_name);
  expect(server.chunks[0]).toBe("take-2");
  expect(server.errors).toEqual([]);
});

test("two accepted takes save in order even while the first upload is waiting", async ({ page }) => {
  const { server } = await open(page, { holdUpload: true });
  await stopTake(page);
  await page.locator("#take-save-yes").tap();
  await expect.poll(() => server.chunks.length).toBe(1);
  await stopTake(page);
  await page.locator("#take-save-yes").tap();
  expect(server.uploads).toHaveLength(1);
  server.release();
  await expect.poll(() => server.uploads.length).toBe(2);
  await expect.poll(() => server.chunks.length).toBe(2);
  expect(server.chunks).toEqual(["take-1", "take-2"]);
  expect(server.errors).toEqual([]);
});

test("double-tap the script, Complete, then confirm; cancellation keeps it queued", async ({ page }) => {
  const { server, scripts } = await open(page);
  await page.locator("#p-file").dblclick();
  await expect(page.locator("#qmenu")).toBeVisible();
  const cancel = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain(scripts[0].angle_name || scripts[0].title);
    await dialog.dismiss();
  });
  await page.locator("#q-complete").tap();
  await cancel;
  expect(server.marks).toHaveLength(0);
  expect((await state(page)).script.root_script_id).toBe(scripts[0].root_script_id);

  await page.locator("#qmenu [data-close]").tap();
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await page.locator("#p-file").dblclick();
  const confirm = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await page.locator("#q-complete").tap();
  await confirm;
  await expect.poll(() => server.marks.length).toBe(1);
  expect(server.marks[0].mark).toBe("got_it");
  expect(server.marks[0].root_script_id).toBe(scripts[0].root_script_id);
  await expect(page.locator("#take-save")).toBeVisible();
  await expect(page.locator("#take-save-name")).toHaveText(scripts[0].take_file_name);
  expect(server.uploads).toHaveLength(0);
  await page.locator("#take-save-no").tap();
  expect((await state(page)).script.root_script_id).toBe(scripts[1].root_script_id);
  expect(server.errors).toEqual([]);
});

test("countdown appears on first play and never on pause, seek, or resume", async ({ page }) => {
  const { server } = await open(page, { countdown: true, camera: false });
  await page.locator("#play").tap();
  await expect(page.locator("#count")).toBeVisible();
  await page.locator("#play").tap();
  await expect(page.locator("#count")).toBeHidden();
  await page.locator("#play").tap();
  await expect.poll(async () => (await state(page)).playing).toBe(true);
  await expect(page.locator("#count")).toBeHidden();
  await page.locator("#play").tap();
  await page.locator("#stage").dispatchEvent("wheel", { deltaY: 80 });
  await page.locator("#play").tap();
  await expect.poll(async () => (await state(page)).playing).toBe(true);
  await expect(page.locator("#count")).toBeHidden();
  expect(server.errors).toEqual([]);
});

for (const wpm of [200, 205, 210, 215]) {
  test(`smooth forward scroll at ${wpm} WPM with the camera overlay`, async ({ page }) => {
    const { server } = await open(page, { wpm });
    await page.locator("#play").tap();
    const points = await page.evaluate(() => new Promise((resolve) => {
      const el = document.getElementById("content");
      const points = [];
      const started = performance.now();
      function tick(at) {
        points.push({ at, y: new DOMMatrix(el.style.transform).m42 });
        if (at - started < 1000) requestAnimationFrame(tick);
        else resolve(points);
      }
      requestAnimationFrame(tick);
    }));
    expect(points.length).toBeGreaterThan(20);
    const speeds = points.slice(1).map((p, i) => (points[i].y - p.y) / ((p.at - points[i].at) / 1000));
    expect(speeds.every((s) => s > 0)).toBe(true);
    const average = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(average * 0.05);
    expect((await state(page)).wpm).toBe(wpm);
    const shade = await page.locator("#cam-shade").evaluate((el) => getComputedStyle(el).backgroundColor);
    // Chromium rounds CSS alpha to an 8-bit value when returning the computed color.
    const alpha = Number(shade.match(/,\s*([\d.]+)\)$/)[1]);
    expect(Math.abs(alpha - 0.558)).toBeLessThan(1 / 255);
    expect(server.errors).toEqual([]);
  });
}
