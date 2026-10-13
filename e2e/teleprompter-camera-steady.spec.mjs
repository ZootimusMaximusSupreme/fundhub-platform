// Owner call 2026-10-13: "the camera should never go black ever when on the app."
// On an iPhone each camera ask takes the lens from the last one, so hunting through
// asks flashed the screen black again and again. The ask that worked is remembered
// and tried first. A dropped camera reopens by itself, and the last picture stays on
// screen while it does.
import { test, expect } from "@playwright/test";
import { CONTRACT } from "../src/marketing/api-contract.mjs";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const sample = CONTRACT["GET marketing/shoot"].example.response;
const health = CONTRACT["GET marketing/health"].example.response;

async function open(page) {
  await page.addInitScript(() => {
    localStorage.setItem("fhtp.settings", JSON.stringify({ countdown: false, wpm: 200, cam: "1080p" }));
    const md = navigator.mediaDevices;
    window.__md = md;
    window.__videoAsks = [];
    window.__gumDelay = 0;
    function camStream(facing) {
      const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
      const g = c.getContext("2d"); g.fillStyle = facing === "user" ? "#2a6" : "#a62"; g.fillRect(0, 0, 1080, 1920);
      const s = c.captureStream(30);
      const v = s.getVideoTracks()[0];
      // Like the iPhone front camera: whatever is asked, Safari grants 30 fps.
      v.getSettings = () => ({ width: 1080, height: 1920, frameRate: 30, facingMode: facing, deviceId: facing === "user" ? "front" : "rear" });
      v.getCapabilities = () => ({ frameRate: { max: 60 } });
      const t = setInterval(() => { if (v.readyState === "ended") clearInterval(t); g.fillRect(0, 0, 4, 4); }, 100);
      window.__lastVideo = v;
      return s;
    }
    md.getUserMedia = (ask) => new Promise((resolve) => {
      const fm = ask.video && ask.video.facingMode;
      const facing = fm && (fm.exact || fm.ideal) === "environment" ? "environment" : "user";
      if (ask.video) window.__videoAsks.push(JSON.parse(JSON.stringify(ask.video)));
      setTimeout(() => {
        const s = ask.video ? camStream(facing) : new MediaStream();
        if (ask.audio) {
          const ac = new AudioContext(); const d = ac.createMediaStreamDestination();
          const o = ac.createOscillator(); o.connect(d); o.start();
          const a = d.stream.getAudioTracks()[0];
          Object.defineProperty(a, "label", { get: () => "iPhone Microphone" });
          s.addTrack(a);
        }
        resolve(s);
      }, window.__gumDelay);
    });
    md.enumerateDevices = () => Promise.resolve([]);
    window.MediaRecorder = class { static isTypeSupported() { return true; } constructor() { this.state = "inactive"; } start() { this.state = "recording"; } stop() { this.state = "inactive"; } };
  });
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/marketing/shoot") return json(sample);
    if (p === "/api/marketing/health") return json(health);
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("/app/teleprompter.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#camera-quality")).toBeVisible();
}

test("one camera ask opens the lens, and that ask is remembered for next time", async ({ page }) => {
  await open(page);
  // A hard 30 fps ask opens the lens the first time: no hunt at all.
  expect(await page.evaluate(() => window.__videoAsks.length)).toBe(1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("fhtp.camRecipes1") || "{}"));
  expect(Object.keys(saved)).toHaveLength(1);
  await page.reload();
  await expect(page.locator("#camera-quality")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__videoAsks.length)).toBe(1);
});

test("a dropped camera reopens by itself, and the last picture stays on screen meanwhile", async ({ page }) => {
  await open(page);
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => window.__videoAsks.length);
  await page.evaluate(() => {
    window.__gumDelay = 900;
    const v = window.__lastVideo;
    v.stop();
    v.dispatchEvent(new Event("ended"));
  });
  // While the camera reopens, the held picture covers the empty video.
  await expect(page.locator("#cam-hold")).toBeVisible({ timeout: 1500 });
  await expect(page.locator("#cam")).toBeVisible();
  // Then the new camera is on and the held picture goes away.
  await expect.poll(() => page.evaluate(() => window.__videoAsks.length), { timeout: 5000 }).toBeGreaterThan(before);
  await expect(page.locator("#cam-hold")).toBeHidden({ timeout: 5000 });
  await expect(page.locator("#camera-quality")).toBeVisible();
});
