import { test, expect } from "./teleprompter-browser-fixture.mjs";
import { CONTRACT } from "../src/marketing/api-contract.mjs";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const copy = (value) => JSON.parse(JSON.stringify(value));
const sample = CONTRACT["GET marketing/shoot"].example.response;
const health = CONTRACT["GET marketing/health"].example.response;

async function open(page, { holdUpload = false, failUpload = false } = {}) {
  const scripts = sample.shoot.scripts.map((script) => ({
    ...copy(script), got_it: false, takes: 0, take_no: 1, style: "words",
    body: "These are the words for a camera take. ".repeat(40),
    teleprompter_text: "These are the words for a camera take. ".repeat(40),
    take_file_name: "Local preview test take.mp4"
  }));
  const server = { starts: [], chunks: [], errors: [], release: null };
  const uploadGate = holdUpload ? new Promise((resolve) => { server.release = resolve; }) : Promise.resolve();
  page.on("pageerror", (error) => server.errors.push(String(error)));
  await page.addInitScript(() => {
    localStorage.setItem("fhtp.settings", JSON.stringify({ countdown: false, wpm: 200, cam: "1080p" }));
    localStorage.setItem("fhtp.wpm", JSON.stringify(200));
    window.__recorderStarts = 0;
    window.__recorderStops = 0;
    window.__sharedFiles = [];
    window.__revokedUrls = [];
    window.__submittedChunks = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).includes("/api/marketing/shoot/take") && init?.method === "PUT" && init.body) {
        // Read the immutable Blob without replacing the body sent by fetch.
        init.body.text().then((bytes) => window.__submittedChunks.push(bytes));
      }
      return nativeFetch(input, init);
    };
    const nativeRevoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => { window.__revokedUrls.push(url); nativeRevoke(url); };
    Object.defineProperty(navigator, "canShare", { configurable: true, value: ({ files }) => files?.length === 1 });
    Object.defineProperty(navigator, "share", { configurable: true, value: ({ files }) => {
      window.__sharedFiles.push(files[0]);
      return Promise.resolve();
    } });
    const mediaDevices = navigator.mediaDevices;
    window.__mediaDevices = mediaDevices;
    const cameraPaints = new WeakMap();
    const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const paint = cameraPaints.get(this.srcObject);
      const result = nativePlay.call(this);
      if (paint) setTimeout(paint, 0);
      return result;
    };
    mediaDevices.getUserMedia = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const pixels = canvas.getContext("2d");
      pixels.fillStyle = "red";
      pixels.fillRect(0, 0, 32, 32);
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0];
      track.getSettings = () => ({ width: 32, height: 32, frameRate: 30, facingMode: "user", deviceId: "front" });
      track.applyConstraints = () => Promise.resolve();
      cameraPaints.set(stream, () => nativeDrawImage.call(pixels, canvas, 0, 0));
      return Promise.resolve(stream);
    };
    mediaDevices.enumerateDevices = () => Promise.resolve([]);
    let take = 0;
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor() { this.state = "inactive"; }
      start() { this.state = "recording"; this.take = ++take; window.__recorderStarts++; }
      stop() {
        this.state = "inactive";
        window.__recorderStops++;
        setTimeout(() => {
          this.ondataavailable({ data: new Blob([`take-${this.take}`], { type: "video/mp4" }) });
          this.onstop();
        }, 10);
      }
    };
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/api/marketing/shoot" && request.method() === "GET") {
      return json({ ...copy(sample), shoot: { ...copy(sample.shoot), scripts: copy(scripts) } });
    }
    if (path === "/api/marketing/health") return json(health);
    if (path === "/api/marketing/shoot/take" && request.method() === "POST") {
      server.starts.push(request.postDataJSON());
      return json({ ok: true, token: `take-${server.starts.length}`, chunk_bytes: 1024 * 1024 });
    }
    if (path === "/api/marketing/shoot/take" && request.method() === "PUT") {
      server.chunks.push(request.postData());
      if (failUpload) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      await uploadGate;
      return json({ ok: true, done: true });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("/app/teleprompter.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#cam")).toBeVisible();
  await expect(page.locator("#b-rec")).toHaveText("Record");
  return server;
}

async function stopTake(page) {
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await page.locator("#b-rec").tap();
  await expect(page.locator("#take-save")).toBeVisible();
}

async function previewBytes(page, selector) {
  return page.locator(selector).evaluate((video) => fetch(video.src).then((response) => response.text()));
}

async function markedScreenshot(page, selector, caption, path) {
  await page.evaluate(({ selector, caption }) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    const box = document.createElement("div");
    box.id = "review-mark";
    Object.assign(box.style, {
      position: "fixed", left: `${rect.left - 4}px`, top: `${rect.top - 4}px`,
      width: `${rect.width + 8}px`, height: `${rect.height + 8}px`,
      border: "4px solid #ff453a", borderRadius: "12px", pointerEvents: "none",
      zIndex: "2147483647"
    });
    const label = document.createElement("span");
    label.textContent = caption;
    Object.assign(label.style, {
      position: "absolute", left: rect.left > innerWidth / 2 ? "auto" : "0",
      right: rect.left > innerWidth / 2 ? "0" : "auto",
      top: "-30px", padding: "4px 8px",
      background: "#ff453a", color: "#fff", font: "bold 12px system-ui",
      whiteSpace: "nowrap"
    });
    box.appendChild(label);
    document.body.appendChild(box);
  }, { selector, caption });
  await page.screenshot({ path });
  await page.locator("#review-mark").evaluate((mark) => mark.remove());
}

test("the original take can be watched and shared before and after device-first save", async ({ page }) => {
  const server = await open(page, { holdUpload: true });
  await expect(page.locator("#watch-last")).toBeHidden();
  await stopTake(page);
  await expect(page.locator("#take-save-preview")).toBeVisible();
  expect(await previewBytes(page, "#take-save-preview")).toBe("take-1");
  expect(await page.locator("#take-save-preview").evaluate((video) => video.autoplay)).toBe(false);
  if (process.env.FUNDHUB_MARK_UI) {
    await markedScreenshot(page, "#take-save", "Watch or save the original take here", "/tmp/fundhub-take-save-marked-draft.png");
  }
  const pendingUrl = await page.locator("#take-save-preview").getAttribute("src");
  await page.locator("#take-save-phone").tap();
  expect(await page.evaluate(() => Promise.all(window.__sharedFiles.map((file) => file.text())))).toEqual(["take-1"]);
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 1]);
  expect(await page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(0);
  expect(server.starts).toHaveLength(0);

  await page.locator("#take-save-yes").tap();
  await expect.poll(() => page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(1);
  await expect.poll(() => server.chunks.length).toBe(1);
  expect(await page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows[0].file.text()))).toBe("take-1");
  await expect.poll(() => page.evaluate(() => window.__submittedChunks)).toEqual(["take-1"]);
  await expect.poll(() => page.evaluate((url) => window.__revokedUrls.includes(url), pendingUrl)).toBe(true);
  await expect(page.locator("#watch-last")).toBeVisible();
  const watchHit = await page.locator("#watch-last").boundingBox();
  expect(watchHit.width).toBeGreaterThanOrEqual(44);
  expect(watchHit.height).toBeGreaterThanOrEqual(44);
  if (process.env.FUNDHUB_MARK_UI) {
    await markedScreenshot(page, "#watch-last", "Watch the saved take while Drive uploads", "/tmp/fundhub-watch-action-marked-draft.png");
  }
  await page.locator("#watch-last").tap();
  if (process.env.FUNDHUB_MARK_UI) {
    await markedScreenshot(page, "#take-watch", "Replay and save the last take", "/tmp/fundhub-watch-take-marked-draft.png");
  }
  expect(await previewBytes(page, "#take-watch-preview")).toBe("take-1");
  const watchUrl = await page.locator("#take-watch-preview").getAttribute("src");
  await page.locator("#take-watch-phone").tap();
  expect(await page.evaluate(() => Promise.all(window.__sharedFiles.map((file) => file.text())))).toEqual(["take-1", "take-1"]);
  await page.locator("#take-watch-close").tap();
  await expect(page.locator("#take-watch")).toBeHidden();
  await expect.poll(() => page.evaluate((url) => window.__revokedUrls.includes(url), watchUrl)).toBe(true);
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 1]);
  expect(await page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(1);
  expect(server.starts).toHaveLength(1);

  server.release();
  await expect.poll(() => page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(0);
  await page.locator("#watch-last").tap();
  expect(await previewBytes(page, "#take-watch-preview")).toBe("take-1");
  await page.locator("#take-watch-close").tap();
  expect(server.errors).toEqual([]);
});

test("No discards the pending take without a Watch action or upload", async ({ page }) => {
  const server = await open(page);
  await stopTake(page);
  expect(await previewBytes(page, "#take-save-preview")).toBe("take-1");
  await page.locator("#take-save-phone").tap();
  expect(await page.evaluate(() => Promise.all(window.__sharedFiles.map((file) => file.text())))).toEqual(["take-1"]);
  await page.locator("#take-save-no").tap();
  await expect(page.locator("#watch-last")).toBeHidden();
  expect(await page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(0);
  expect(server.starts).toHaveLength(0);
  expect(server.errors).toEqual([]);
});

test("Watch stays away during a paused recording and returns for the prior saved take", async ({ page }) => {
  const server = await open(page, { holdUpload: true });
  await stopTake(page);
  await page.locator("#take-save-yes").tap();
  await expect.poll(() => page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(1);
  await expect(page.locator("#watch-last")).toBeVisible();

  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  expect(await page.evaluate(() => document.body.classList.contains("rolling"))).toBe(false);
  await expect(page.locator("#watch-last")).toBeHidden();
  await page.locator("#watch-last").evaluate((button) => button.click());
  await expect(page.locator("#take-watch")).toBeHidden();
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([2, 1]);

  await page.locator("#b-rec").tap();
  await expect(page.locator("#take-save")).toBeVisible();
  await page.locator("#watch-last").evaluate((button) => button.click());
  await expect(page.locator("#take-watch")).toBeHidden();
  await page.locator("#take-save-no").tap();
  await expect(page.locator("#watch-last")).toBeVisible();
  await page.locator("#watch-last").tap();
  expect(await previewBytes(page, "#take-watch-preview")).toBe("take-1");
  await page.locator("#take-watch-close").tap();
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([2, 2]);
  expect(await page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(1);
  expect(server.starts).toHaveLength(1);
  server.release();
  expect(server.errors).toEqual([]);
});

test("reopening offers Watch for the latest take still queued on this phone", async ({ page }) => {
  const server = await open(page, { holdUpload: true });
  await stopTake(page);
  await page.locator("#take-save-yes").tap();
  await expect.poll(() => page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(1);
  expect(server.errors).toEqual([]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#watch-last")).toBeVisible();
  await page.locator("#watch-last").tap();
  expect(await previewBytes(page, "#take-watch-preview")).toBe("take-1");
  await page.locator("#take-watch-close").tap();
  server.release();
});

test("quick Yes and reload cancels the preview load without a page error", async ({ page }) => {
  const server = await open(page, { failUpload: true });
  await stopTake(page);
  // Do not read or play the preview: WebKit may still be loading metadata.
  await page.locator("#take-save-yes").tap();
  await expect.poll(() => page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(1);
  await expect(page.locator("#video-save-status")).toHaveAttribute("data-state", "failed");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#watch-last")).toBeVisible();
  expect(server.errors).toEqual([]);
});
