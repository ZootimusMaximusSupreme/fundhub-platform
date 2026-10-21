import { test, expect } from "./teleprompter-browser-fixture.mjs";
import { CONTRACT } from "../src/marketing/api-contract.mjs";

/* Inside the Fundhub Prompter iPhone app the phone's own camera films
 * (owner call 2026-10-21: 4K60 long form, 1080p up to 120 fps ads). The page
 * keeps its screen and only talks to the app. A fake app here records every
 * message the page posts and answers like the real one. */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const copy = (v) => JSON.parse(JSON.stringify(v));
const sample = CONTRACT["GET marketing/shoot"].example.response;
const health = CONTRACT["GET marketing/health"].example.response;

async function open(page, { holdReady = false } = {}) {
  const base = sample.shoot.scripts[0];
  const words = ("These are the words for a native camera take. ").repeat(40);
  const scripts = [
    { ...copy(base), title: "/watch VSL (book-a-call)", script_format: "vsl", take_file_name: "Direct Book VSL 1 Take 1.mp4", offer_key: "funding_dfy" },
    { ...copy(base), id: "00000000-0000-4000-8000-000000000391", root_script_id: "00000000-0000-4000-8000-000000000391",
      ad_id: "105", title: "Direct Book Ad 13 — 700 and up", script_format: null, funnel_key: null, angle_name: "700 and up",
      take_file_name: "Direct Book Ad 105 — 700 and up Take 1.mp4", offer_key: "funding_dfy" }
  ].map((s) => ({ ...s, got_it: false, takes: 0, take_no: 1, style: "words", body: words, teleprompter_text: words }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(({ holdReady }) => {
    localStorage.setItem("fhtp.settings", JSON.stringify({ countdown: false, wpm: 200 }));
    window.__getUserMedia = 0;
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => { window.__getUserMedia++; return Promise.reject(new Error("no browser camera here")); };
    }
    window.__posted = [];
    // What the app injects at document start.
    window.FundhubNativeCamera = { version: 1, queue: [], receive: function (e) { this.queue.push(e); } };
    const send = (e) => setTimeout(() => window.FundhubNativeCamera.receive(e), 5);
    window.webkit = { messageHandlers: { fundhubCamera: { postMessage: (m) => {
      window.__posted.push(JSON.parse(JSON.stringify(m)));
      if (m.type === "open") {
        const four = m.mode === "4k";
        const ready = () => send({ type: "camera", state: "ready", facing: m.facing, mode: m.mode,
          width: four ? 2160 : 1080, height: four ? 3840 : 1920, fps: four ? 60 : 120,
          summary: (four ? "Long form · 4K" : "Ad · 1080p") + " · " + (four ? 60 : 120) + " fps", shortfall: null });
        if (holdReady) window.__releaseReady = ready; else ready();
      }
      if (m.type === "record") send({ type: "recording" });
      if (m.type === "stop") send({ type: "take", id: "take-1", name: "Direct Book VSL 1 Take 1.mp4", url: "fundhub-take://take/take-1.mp4", bytes: 1234, diagnostics: { elapsed_ms: 900 } });
      if (m.type === "keep") send({ type: "upload", text: "Uploading Direct Book VSL 1 Take 1.mp4 · 40%", state: "saving" });
    } } } };
  }, { holdReady });
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/marketing/shoot" && req.method() === "GET") return json({ ...copy(sample), shoot: { ...copy(sample.shoot), scripts: copy(scripts) } });
    if (p === "/api/marketing/health") return json(health);
    if (p === "/api/marketing/shoot/mark") return json({ marks: {} });
    if (p === "/api/marketing/shoot/take") return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("/app/teleprompter.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#p-file")).toHaveText(scripts[0].take_file_name);
  return { errors };
}

const posted = (page) => page.evaluate(() => window.__posted);

test("in the phone app the page films with the app's camera: 4K for the VSL, 1080p for an ad, one take saved through the app", async ({ page }) => {
  const { errors } = await open(page);
  await expect(page.locator("html")).toHaveClass(/native-cam/);
  await expect.poll(async () => (await posted(page)).filter((m) => m.type === "open")[0]).toEqual({ type: "open", mode: "4k", facing: "user" });
  await expect(page.locator("#cam-video")).toBeHidden();
  await expect(page.locator("#camera-quality")).toContainText(/60/);
  await expect(page.locator("#mic-name")).toHaveText("Phone app mic");

  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await expect.poll(async () => (await posted(page)).find((m) => m.type === "record"))
    .toEqual({ type: "record", name: "Direct Book VSL 1 Take 1.mp4", offer_key: "funding_dfy", funnel_tag: null });
  await page.locator("#b-rec").tap();
  await expect.poll(async () => (await posted(page)).some((m) => m.type === "stop")).toBe(true);

  const dialog = page.getByRole("dialog", { name: "Save this video?" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("#take-save-name")).toHaveText("Direct Book VSL 1 Take 1.mp4");
  await expect(page.locator("#take-save-preview")).toHaveAttribute("src", "fundhub-take://take/take-1.mp4");
  await expect(page.locator("#take-save-phone")).toBeHidden();
  await page.locator("#take-save-yes").tap();
  await expect.poll(async () => (await posted(page)).find((m) => m.type === "keep")).toEqual({ type: "keep", id: "take-1" });
  await expect(page.locator("#video-save-text")).toHaveText("Uploading Direct Book VSL 1 Take 1.mp4 · 40%");

  await page.evaluate(() => window.__fhtp.next());
  await expect.poll(async () => (await posted(page)).filter((m) => m.type === "open").pop()).toEqual({ type: "open", mode: "1080p", facing: "user" });
  await expect(page.locator("#camera-quality")).toContainText(/120/);

  expect(await page.evaluate(() => window.__getUserMedia)).toBe(0);
  expect(errors).toEqual([]);
});

test("No on the save question tells the app to throw the take away", async ({ page }) => {
  await open(page);
  await expect.poll(async () => (await posted(page)).some((m) => m.type === "open")).toBe(true);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await page.locator("#b-rec").tap();
  await expect(page.getByRole("dialog", { name: "Save this video?" })).toBeVisible();
  await page.locator("#take-save-no").tap();
  await expect.poll(async () => (await posted(page)).find((m) => m.type === "discard")).toEqual({ type: "discard", id: "take-1" });
  expect((await posted(page)).some((m) => m.type === "keep")).toBe(false);
  await expect(page.locator("#b-rec")).toHaveText("Record");
});

test("it looks like Safari: black until the app's camera is live, then the live camera under the same shade", async ({ page }) => {
  const { errors } = await open(page, { holdReady: true });
  await expect.poll(async () => (await posted(page)).some((m) => m.type === "open")).toBe(true);
  const look = () => page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const box = document.getElementById("cam"), shade = document.getElementById("cam-shade");
    return { html: cs(document.documentElement).backgroundColor, body: cs(document.body).backgroundColor,
      cam: cs(box).backgroundColor, camShown: cs(box).display !== "none", shade: cs(shade).opacity, shadeColor: cs(shade).backgroundColor,
      video: cs(document.getElementById("cam-video")).display, transform: cs(box).transform };
  });
  const before = await look();
  expect(before.html).toBe("rgba(0, 0, 0, 0)");
  expect(before.body).toBe("rgba(0, 0, 0, 0)");
  expect(before.camShown).toBe(true);
  expect(before.cam).toBe("rgb(0, 0, 0)");
  expect(before.video).toBe("none");
  await page.evaluate(() => window.__releaseReady());
  await expect(page.locator("html")).toHaveClass(/native-cam-live/);
  const after = await look();
  expect(after.cam).toBe("rgba(0, 0, 0, 0)");
  // The same shade Safari paints over its camera (teleprompter.css #cam-shade).
  expect(after.shade).toBe("1");
  expect(after.shadeColor).toMatch(/^rgba\(0, 0, 0, 0\.55[78]\)$/);   // 0.558, as the browser rounds it
  expect(after.transform).toBe("none");
  expect(errors).toEqual([]);
});
