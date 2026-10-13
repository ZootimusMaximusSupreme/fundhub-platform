// Owner call 2026-10-13: the mic label tells the truth and follows the plug.
// "iPhone mic on" with the phone's own mic. Plug a Rode in and the app moves to
// it and says "Rode on". Pull it out and the iPhone mic comes back. A take that
// is recording keeps its mic; the switch happens when it stops.
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
    window.__rodeIn = false;
    window.__audioAsks = [];
    window.__tracks = [];
    function micTrack(label, id) {
      const ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      const osc = ac.createOscillator(); osc.connect(dest); osc.start();
      const t = dest.stream.getAudioTracks()[0];
      Object.defineProperty(t, "label", { get: () => label });
      t.getSettings = () => ({ deviceId: id });
      window.__tracks.push(t);
      return t;
    }
    function camStream() {
      const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
      const g = c.getContext("2d"); g.fillStyle = "#345"; g.fillRect(0, 0, 1080, 1920);
      const s = c.captureStream(30);
      const v = s.getVideoTracks()[0];
      v.getSettings = () => ({ width: 1080, height: 1920, frameRate: 30, facingMode: "user", deviceId: "front" });
      setInterval(() => g.fillRect(0, 0, 2, 2), 100);
      return s;
    }
    md.getUserMedia = (ask) => {
      const s = ask.video ? camStream() : new MediaStream();
      if (ask.audio) {
        window.__audioAsks.push(JSON.parse(JSON.stringify(ask.audio)));
        const exact = ask.audio && ask.audio.deviceId && ask.audio.deviceId.exact;
        if (exact === "rode" && !window.__rodeIn) return Promise.reject(new Error("NotFound"));
        s.addTrack(exact === "rode" || (window.__rodeIn && !exact) ? micTrack("RØDE Wireless GO II", "rode") : micTrack("iPhone Microphone", "builtin"));
      }
      return Promise.resolve(s);
    };
    md.enumerateDevices = () => Promise.resolve([
      { kind: "videoinput", deviceId: "front", label: "Front Camera" },
      { kind: "videoinput", deviceId: "rear", label: "Back Camera" },
      { kind: "audioinput", deviceId: "builtin", label: "iPhone Microphone" },
      ...(window.__rodeIn ? [{ kind: "audioinput", deviceId: "rode", label: "RØDE Wireless GO II" }] : [])
    ]);
    window.__plug = (inNow) => {
      window.__rodeIn = inNow;
      if (!inNow) window.__tracks.filter((t) => t.label.includes("RØDE")).forEach((t) => { t.stop(); t.dispatchEvent(new Event("ended")); });
      md.dispatchEvent(new Event("devicechange"));
    };
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor(stream) { this.state = "inactive"; window.__recAudio = stream.getAudioTracks().map((t) => t.label); }
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; setTimeout(() => { this.ondataavailable && this.ondataavailable({ data: new Blob(["take"], { type: "video/mp4" }) }); this.onstop && this.onstop(); }, 10); }
    };
  });
  await page.route("**/api/**", (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (b) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/marketing/shoot") return json(sample);
    if (p === "/api/marketing/health") return json(health);
    if (p === "/api/marketing/shoot/take" && route.request().method() === "POST") return json({ ok: true, token: "t1", chunk_bytes: 1048576 });
    if (p === "/api/marketing/shoot/take") return json({ ok: true, done: true });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("/app/teleprompter.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#cam")).toBeVisible();
}

test("iPhone mic on, then Rode on when plugged in, then iPhone mic on when pulled out", async ({ page }) => {
  await open(page);
  await expect(page.locator("#mic-name")).toHaveText("iPhone mic on");
  await page.evaluate(() => window.__plug(true));
  await expect(page.locator("#mic-name")).toHaveText("Rode on");
  expect(await page.evaluate(() => window.__audioAsks.some((a) => a && a.deviceId && a.deviceId.exact === "rode"))).toBe(true);
  await page.evaluate(() => window.__plug(false));
  await expect(page.locator("#mic-name")).toHaveText("iPhone mic on");
});

test("a Rode plugged in during a take waits for Stop; the take keeps its mic", async ({ page }) => {
  await open(page);
  await expect(page.locator("#mic-name")).toHaveText("iPhone mic on");
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  const asksBefore = await page.evaluate(() => window.__audioAsks.length);
  await page.evaluate(() => window.__plug(true));
  await page.waitForTimeout(600);
  // No new mic is opened mid-take, and the label still names the mic being recorded.
  expect(await page.evaluate(() => window.__audioAsks.length)).toBe(asksBefore);
  await expect(page.locator("#mic-name")).toHaveText("iPhone mic on");
  expect(await page.evaluate(() => window.__recAudio)).toEqual(["iPhone Microphone"]);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#mic-name")).toHaveText("Rode on");
});
