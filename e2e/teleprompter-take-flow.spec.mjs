import { test, expect } from "@playwright/test";
import { CONTRACT } from "../src/marketing/api-contract.mjs";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const copy = (v) => JSON.parse(JSON.stringify(v));
const sample = CONTRACT["GET marketing/shoot"].example.response;
const health = CONTRACT["GET marketing/health"].example.response;

async function open(page, { countdown = false, wpm = 200, camera = true, holdUpload = false, failUpload = false, scriptShapes = [], omitFacingSetting = false, omitFrameRateSetting = false, ignoreIdealFacing = false, rejectTrackSwitch = false, rearPlayRejectOnce = false, cameraDevices = [], iphone = false, cameraFps = 30, sourceWidth = 32, sourceHeight = 32, edgeMarkers = false, freezeVideoCallbacks = false, manualVideoCallbacks = false, disableVideoCallbacks = false, savedCam = "1080p", portraitOnlyFor4k = false } = {}) {
  const count = Math.max(sample.shoot.scripts.length, scriptShapes.length);
  const bases = Array.from({ length: count }, (_, i) => {
    if (sample.shoot.scripts[i]) return sample.shoot.scripts[i];
    const id = `00000000-0000-4000-8000-${String(390 + i).padStart(12, "0")}`;
    return { ...sample.shoot.scripts[0], id, root_script_id: id, ad_id: String(90 + i) };
  });
  const scripts = bases.map((s, i) => ({
    ...copy(s), got_it: false, takes: 0, take_no: 1, style: "words",
    body: ("These are the words for a steady camera take. ").repeat(40),
    teleprompter_text: ("These are the words for a steady camera take. ").repeat(40),
    take_file_name: `SLO Ad ${s.ad_id} — Script ${i + 1} Take 1.mp4`,
    ...(scriptShapes[i] || {})
  }));
  const server = { marks: [], uploads: [], chunks: [], errors: [], release: null };
  const uploadGate = holdUpload ? new Promise((resolve) => { server.release = resolve; }) : Promise.resolve();
  page.on("pageerror", (e) => server.errors.push(String(e)));
  await page.addInitScript(({ countdown, wpm, camera, omitFacingSetting, omitFrameRateSetting, ignoreIdealFacing, rejectTrackSwitch, rearPlayRejectOnce, cameraDevices, iphone, cameraFps, sourceWidth, sourceHeight, edgeMarkers, freezeVideoCallbacks, manualVideoCallbacks, disableVideoCallbacks, savedCam, portraitOnlyFor4k }) => {
    localStorage.setItem("fhtp.settings", JSON.stringify({ countdown, wpm, cam: savedCam }));
    localStorage.setItem("fhtp.wpm", JSON.stringify(wpm));
    if (iphone) Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148" });
    if (!camera) return;
    // A real MediaStream for the preview, with a deterministic recorder. Each
    // camera request gets a fresh track so front/rear switching is testable.
    window.__cameraRequests = [];
    window.__cameraAsks = [];
    window.__cameraStreams = [];
    window.__recorderStarts = 0;
    window.__recorderStops = 0;
    window.__recordStream = null;
    window.__captureRates = [];
    window.__recordDraws = 0;
    const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas === window.__recordCanvas) window.__recordDraws++;
      return nativeDrawImage.apply(this, args);
    };
    if (freezeVideoCallbacks) {
      let firstFrame = true;
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        if (firstFrame) {
          firstFrame = false;
          setTimeout(() => callback(performance.now(), { presentedFrames: 1, mediaTime: 0 }), 0);
        }
        return 1;
      };
      HTMLVideoElement.prototype.cancelVideoFrameCallback = () => {};
    }
    if (manualVideoCallbacks) {
      let nextId = 1;
      let presentedFrames = 0;
      const pending = new Map();
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        const id = nextId++;
        pending.set(id, callback);
        return id;
      };
      HTMLVideoElement.prototype.cancelVideoFrameCallback = (id) => { pending.delete(id); };
      window.__sendVideoFrames = (times, counts = []) => {
        for (const [index, now] of times.entries()) {
          const next = pending.entries().next().value;
          if (!next) throw new Error("recorder did not request the next camera frame");
          pending.delete(next[0]);
          presentedFrames = counts[index] ?? presentedFrames + 1;
          next[1](now, { presentedFrames, mediaTime: presentedFrames / 60 });
        }
      };
    }
    if (disableVideoCallbacks) HTMLVideoElement.prototype.requestVideoFrameCallback = undefined;
    const nativeCanvasCapture = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function (rate) {
      window.__captureRates.push(rate);
      window.__recordCanvas = this;
      return nativeCanvasCapture.call(this, rate);
    };
    if (rearPlayRejectOnce) {
      const nativePlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        const track = this.srcObject && this.srcObject.getVideoTracks && this.srcObject.getVideoTracks()[0];
        const facing = track && track.getSettings ? track.getSettings().facingMode : "";
        if (facing === "environment" && !window.__rearPlayRejected) {
          window.__rearPlayRejected = true;
          return Promise.reject(new Error("rear metadata was not ready"));
        }
        return nativePlay.call(this);
      };
    }
    const makeStream = (facing, deviceId, videoAsk) => {
      const highSource = portraitOnlyFor4k && videoAsk?.width?.ideal >= 2160;
      const width = portraitOnlyFor4k ? (highSource ? 32 : 56) : sourceWidth;
      const height = portraitOnlyFor4k ? (highSource ? 56 : 32) : sourceHeight;
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const cameraPixels = canvas.getContext("2d");
      cameraPixels.fillStyle = "red";
      cameraPixels.fillRect(0, 0, width, height / 2);
      cameraPixels.fillStyle = "blue";
      cameraPixels.fillRect(0, height / 2, width, height / 2);
      if (edgeMarkers) {
        cameraPixels.fillStyle = "lime";
        cameraPixels.fillRect(0, 0, width / 8, height);
        cameraPixels.fillStyle = "yellow";
        cameraPixels.fillRect(width * 7 / 8, 0, width / 8, height);
      }
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0];
      let liveFacing = facing;
      let liveDevice = deviceId;
      track.getSettings = () => ({ width, height, ...(omitFrameRateSetting ? {} : { frameRate: cameraFps }), deviceId: liveDevice, ...(omitFacingSetting ? {} : { facingMode: liveFacing }) });
      track.applyConstraints = (next = {}) => {
        const exactFacing = next.facingMode && next.facingMode.exact;
        if (exactFacing && exactFacing !== liveFacing && rejectTrackSwitch) return Promise.reject(new Error("track switch rejected"));
        if (exactFacing) {
          liveFacing = exactFacing;
          liveDevice = exactFacing === "environment" ? "rear" : "front";
        }
        return Promise.resolve();
      };
      window.__cameraStreams.push(stream);
      return stream;
    };
    navigator.mediaDevices.getUserMedia = (ask) => {
      const video = ask && ask.video;
      const fm = video && video.facingMode;
      const exactId = video && video.deviceId && video.deviceId.exact;
      const facing = exactId === "rear" || (!ignoreIdealFacing && fm && (fm.exact || fm.ideal) === "environment") ? "environment" : "user";
      const deviceId = exactId || (facing === "environment" ? "rear" : "front");
      window.__cameraRequests.push(facing);
      window.__cameraAsks.push({ facing, audio: !!ask.audio, video: JSON.parse(JSON.stringify(video)) });
      return Promise.resolve(makeStream(facing, deviceId, video));
    };
    navigator.mediaDevices.enumerateDevices = () => Promise.resolve(cameraDevices);
    let take = 0;
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor(stream) { this.state = "inactive"; window.__recordStream = stream; window.__recorderUsedCameraStream = window.__cameraStreams.includes(stream); }
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
  }, { countdown, wpm, camera, omitFacingSetting, omitFrameRateSetting, ignoreIdealFacing, rejectTrackSwitch, rearPlayRejectOnce, cameraDevices, iphone, cameraFps, sourceWidth, sourceHeight, edgeMarkers, freezeVideoCallbacks, manualVideoCallbacks, disableVideoCallbacks, savedCam, portraitOnlyFor4k });
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
      if (failUpload) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
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

test("a stopped take reports camera and copied frame rates for diagnosis", async ({ page }) => {
  await open(page, { iphone: true });
  await stopTake(page);
  await expect(page.locator("#cam-line")).toContainText(/This take: camera \d+ fps · copied \d+ fps/);
});

test("upright Ad rejects a wide 1080p feed and keeps a full portrait preview", async ({ page }) => {
  await open(page, { iphone: true, portraitOnlyFor4k: true });
  await expect.poll(() => page.evaluate(() => {
    const video = document.querySelector("#cam-video");
    return video.videoWidth > 0 && video.videoHeight > video.videoWidth;
  })).toBe(true);
  const asks = await page.evaluate(() => window.__cameraAsks);
  expect(asks.some((ask) => ask.video.width?.ideal === 1080)).toBe(true);
  expect(asks.some((ask) => ask.video.width?.ideal === 3840)).toBe(true);
  await stopTake(page);
});

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
  // An upload in progress does not prevent the next take, hide the camera,
  // or discard the first finished file from device storage.
  await expect(page.locator("#b-rec")).toHaveText("Record");
  await expect.poll(() => page.locator("#cam-video").evaluate((el) => el.videoWidth > 0 && el.readyState >= 2)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(1);
  await stopTake(page);
  await page.locator("#take-save-yes").tap();
  await expect.poll(() => page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(2);
  expect(server.uploads).toHaveLength(1);
  server.release();
  await expect.poll(() => server.uploads.length).toBe(2);
  await expect.poll(() => server.chunks.length).toBe(2);
  expect(server.chunks).toEqual(["take-1", "take-2"]);
  expect(server.errors).toEqual([]);
});

test("video saving uses a small top-right status and leaves the filming toast clear", async ({ page }) => {
  const { server } = await open(page, { holdUpload: true });
  await stopTake(page);
  await page.locator("#take-save-yes").tap();
  await expect(page.locator("#video-save-status")).toBeVisible();
  await expect(page.locator("#video-save-text")).toContainText("Saving");
  await expect(page.locator("#toast")).toBeHidden();
  const box = await page.locator("#video-save-status").boundingBox();
  expect(box.y).toBeLessThan(80);
  expect(box.width).toBeLessThanOrEqual(240);
  expect(box.x + box.width).toBeGreaterThan(380);
  server.release();
  await expect(page.locator("#video-save-text")).toHaveText("Video saved");
  expect(server.errors).toEqual([]);
});

test("a failed video upload stays in the small top status and leaves the file on the phone", async ({ page }) => {
  const { server } = await open(page, { failUpload: true });
  await stopTake(page);
  await page.locator("#take-save-yes").tap();
  await expect(page.locator("#video-save-status")).toBeVisible();
  await expect(page.locator("#video-save-status")).toHaveAttribute("data-state", "failed");
  await expect(page.locator("#video-save-text")).toHaveText("Upload paused · saved on device");
  await expect.poll(() => page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(1);
  await expect(page.locator("#toast")).toBeHidden();
  expect(server.errors).toEqual([]);
});

test("an upload survives reopening the app and retries from the device-saved take", async ({ page }) => {
  const { server } = await open(page, { holdUpload: true });
  await stopTake(page);
  await page.locator("#take-save-yes").tap();
  await expect.poll(() => page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(1);
  await expect.poll(() => server.chunks.length).toBe(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#b-rec")).toHaveText("Record");
  await expect.poll(() => page.locator("#cam-video").evaluate((el) => el.videoWidth > 0 && el.readyState >= 2)).toBe(true);
  await expect.poll(() => server.uploads.length).toBeGreaterThanOrEqual(2);
  server.release();
  await expect.poll(() => page.evaluate(() => window.FundhubTakeStore.all().then((rows) => rows.length))).toBe(0);
  expect(server.errors).toEqual([]);
});

test("the phone UI has an independent input-level display", async ({ page }) => {
  const { server } = await open(page);
  const meter = page.locator("#mic-monitor");
  await expect(meter).toBeVisible();
  await expect(page.locator("#mic-name")).toHaveText("No mic audio");
  await expect(meter).toHaveAttribute("data-state", "unavailable");
  await expect(page.locator("#b-rec")).toHaveText("Record");
  expect(server.errors).toEqual([]);
});

test("camera flip is live, and one recording continues front/rear/front until Record/Stop", async ({ page }) => {
  const { server } = await open(page);
  const flip = page.locator("#b-camera-flip");
  await expect(flip).toHaveAttribute("aria-label", "Use back camera");
  await expect(page.locator("#b-rec")).toHaveText("Record");
  expect(await page.evaluate(() => window.__recorderStarts)).toBe(0);
  await flip.tap();
  await expect(flip).toHaveAttribute("aria-label", "Use front camera");
  await expect.poll(() => page.locator("#cam-video").evaluate((el) => el.videoWidth > 0 && el.readyState >= 2)).toBe(true);
  await expect(page.locator("#b-rec")).toHaveText("Record");
  await flip.tap();
  await expect(flip).toHaveAttribute("aria-label", "Use back camera");
  expect(await page.evaluate(() => window.__recorderStarts)).toBe(0);
  await page.waitForTimeout(550); // ignore iPhone ghost clicks after flip
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await flip.tap();
  await expect(flip).toHaveAttribute("aria-label", "Use front camera");
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await flip.tap();
  await expect(flip).toHaveAttribute("aria-label", "Use back camera");
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 0]);
  expect(await page.evaluate(() => window.__recordStream.getVideoTracks().length)).toBe(1);
  await page.waitForTimeout(550);
  await page.locator("#b-rec").tap();
  await expect(page.getByRole("dialog", { name: "Save this video?" })).toBeVisible();
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 1]);
  expect(server.uploads).toHaveLength(0);
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("iPhone opens the exact rear live view, retries preview start, and stays idle", async ({ page }) => {
  const cameraDevices = [
    { kind: "videoinput", deviceId: "front", label: "Front Camera" },
    { kind: "videoinput", deviceId: "rear", label: "Back Camera" }
  ];
  const { server } = await open(page, { iphone: true, rearPlayRejectOnce: true, cameraDevices });
  const flip = page.locator("#b-camera-flip");
  await flip.tap();
  await expect(flip).toHaveAttribute("aria-label", "Use front camera");
  await expect.poll(() => page.locator("#cam-video").evaluate((el) => el.videoWidth > 0 && el.readyState >= 2)).toBe(true);
  await expect.poll(() => page.locator("#cam-video").evaluate((el) => el.srcObject.getVideoTracks()[0].getSettings().facingMode)).toBe("environment");
  await expect(page.locator("#b-rec")).toHaveText("Record");
  expect(await page.evaluate(() => window.__rearPlayRejected)).toBe(true);
  expect(await page.evaluate(() => window.__cameraRequests)).toEqual(["user", "environment"]);
  expect(server.errors).toEqual([]);
});

test("camera button keeps the rear lens when Safari omits facingMode", async ({ page }) => {
  const cameraDevices = [
    { kind: "videoinput", deviceId: "front", label: "Front Camera" },
    { kind: "videoinput", deviceId: "rear", label: "Back Camera" }
  ];
  const { server } = await open(page, { omitFacingSetting: true, cameraDevices });
  const flip = page.locator("#b-camera-flip");
  await expect(flip).toHaveAttribute("aria-label", "Use back camera");
  await flip.tap();
  await expect(flip).toHaveAttribute("aria-label", "Use front camera");
  await expect.poll(() => page.locator("#cam-video").evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  await expect.poll(() => page.locator("#cam-video").evaluate((el) => el.videoWidth > 0 && el.readyState >= 2)).toBe(true);
  expect(await page.evaluate(() => window.__cameraRequests)).toEqual(["user"]);
  expect(server.errors).toEqual([]);
});

test("camera button uses the exact rear device when Safari ignores the ideal rear request", async ({ page }) => {
  const cameraDevices = [
    { kind: "videoinput", deviceId: "front", label: "Front Camera" },
    { kind: "videoinput", deviceId: "rear", label: "Back Camera" }
  ];
  const { server } = await open(page, { ignoreIdealFacing: true, rejectTrackSwitch: true, cameraDevices });
  const flip = page.locator("#b-camera-flip");
  await flip.tap();
  await expect(flip).toHaveAttribute("aria-label", "Use front camera");
  await expect.poll(() => page.locator("#cam-video").evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  expect(await page.evaluate(() => window.__cameraRequests)).toEqual(["user", "environment"]);
  expect(server.errors).toEqual([]);
});

test("drag words while recording stays one take; only a tap changes playback and Record stops capture", async ({ page }) => {
  const { server } = await open(page);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await page.locator("#play").tap();
  await expect.poll(() => page.evaluate(() => window.__fhtp.state().playing)).toBe(true);
  await page.waitForTimeout(350);
  const rect = await page.locator("#stage").boundingBox();
  const x = rect.x + rect.width * 0.5, y = rect.y + rect.height * 0.65;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 7; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (i * 135 / 7) }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => page.evaluate(() => window.__fhtp.state().playing)).toBe(true);
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 0]);
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  const atDrag = await page.evaluate(() => window.__fhtp.state().t);
  await expect.poll(() => page.evaluate(() => window.__fhtp.state().t)).toBeGreaterThan(atDrag + 0.3);
  await page.touchscreen.tap(x, y);
  await expect.poll(() => page.evaluate(() => window.__fhtp.state().playing)).toBe(false);
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  expect(await page.evaluate(() => window.__recorderStops)).toBe(0);
  await page.touchscreen.tap(x, y);
  await expect.poll(() => page.evaluate(() => window.__fhtp.state().playing)).toBe(true);
  await page.waitForTimeout(550);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#take-save")).toBeVisible();
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 1]);
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("an iPhone ad requests portrait 1080p and a 60 fps take despite a saved 4K choice", async ({ page }) => {
  const { server } = await open(page, {
    iphone: true, cameraFps: 60, savedCam: "4k", sourceWidth: 1080, sourceHeight: 1920,
    scriptShapes: [{ stack_kind: "ad", script_format: "standard", take_file_name: "SLO Ad 91 — Script 1 Take 1.mp4" }]
  });
  const ask = await page.evaluate(() => window.__cameraAsks[0].video);
  expect([ask.width.ideal, ask.height.ideal]).toEqual([1080, 1920]);
  expect(ask.frameRate.ideal).toBeGreaterThanOrEqual(60);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  expect(await page.evaluate(() => window.__cameraStreams[0].getVideoTracks()[0].getSettings().frameRate)).toBe(60);
  expect(await page.evaluate(() => window.__captureRates.at(-1))).toBeGreaterThanOrEqual(60);
  expect(await page.evaluate(() => [window.__recordCanvas.width, window.__recordCanvas.height])).toEqual([1080, 1920]);
  const asksBeforeFlip = await page.evaluate(() => window.__cameraAsks.length);
  const flip = page.locator("#b-camera-flip");
  await flip.tap();
  await expect(flip).toHaveAttribute("aria-label", "Use front camera");
  const flipAsk = await page.evaluate((at) => window.__cameraAsks[at].video, asksBeforeFlip);
  expect([flipAsk.width.ideal, flipAsk.height.ideal]).toEqual([1080, 1920]);
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 0]);
  await page.waitForTimeout(550);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#take-save")).toBeVisible();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("an iPhone VSL requests 4K and a 30 fps take despite a saved 1080p choice", async ({ page }) => {
  const { server } = await open(page, {
    iphone: true, cameraFps: 60, savedCam: "1080p", sourceWidth: 1080, sourceHeight: 1920,
    scriptShapes: [{ stack_kind: "vsl", script_format: "vsl", take_file_name: "SLO VSL 1 — Script 1 Take 1.mp4" }]
  });
  const ask = await page.evaluate(() => window.__cameraAsks[0].video);
  expect([ask.width.ideal, ask.height.ideal]).toEqual([3840, 2160]);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  expect(await page.evaluate(() => window.__captureRates.at(-1))).toBe(30);
  await page.locator("#b-rec").tap();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("1080p Ad copies each fresh 60 fps camera frame despite callback jitter", async ({ page }) => {
  const { server } = await open(page, {
    iphone: true, cameraFps: 60, manualVideoCallbacks: true,
    sourceWidth: 1080, sourceHeight: 1920,
    scriptShapes: [{ stack_kind: "ad", script_format: "standard" }]
  });
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  const { copied, rate } = await page.evaluate(() => {
    const before = window.__recordDraws;
    const every = 1000 / 60;
    const start = performance.now() + 100;
    const times = Array.from({ length: 60 }, (_, i) => start + (i + 1) * every + (i % 2 ? -1 : 1));
    window.__sendVideoFrames(times);
    return { copied: window.__recordDraws - before, rate: window.__captureRates.at(-1) };
  });
  expect(rate).toBe(60);
  expect(copied).toBeGreaterThanOrEqual(55);
  await page.locator("#b-rec").tap();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("1080p Ad keeps its 60 fps request when camera settings omit frame rate", async ({ page }) => {
  const { server } = await open(page, {
    iphone: true, omitFrameRateSetting: true,
    scriptShapes: [{ stack_kind: "ad", script_format: "standard" }]
  });
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  expect(await page.evaluate(() => window.__cameraStreams[0].getVideoTracks()[0].getSettings().frameRate)).toBeUndefined();
  expect(await page.evaluate(() => window.__captureRates.at(-1))).toBe(60);
  await page.locator("#b-rec").tap();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("camera rate counts presented frames even when video callbacks skip frames", async ({ page }) => {
  const { server } = await open(page, {
    iphone: true, cameraFps: 60, manualVideoCallbacks: true,
    scriptShapes: [{ stack_kind: "ad", script_format: "standard" }]
  });
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await page.evaluate(() => {
    const now = performance.now();
    window.__sendVideoFrames([now + 20, now + 60], [1, 61]);
  });
  await page.waitForTimeout(250);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#take-save")).toBeVisible();
  const report = await page.locator("#cam-line").textContent();
  const rates = report.match(/This take: camera (\d+) fps · copied (\d+) fps/);
  expect(rates).not.toBeNull();
  expect(Number(rates[1])).toBeGreaterThan(Number(rates[2]) * 10);
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("4K VSL caps fresh 60 fps camera frames near 30 canvas copies", async ({ page }) => {
  const { server } = await open(page, {
    iphone: true, cameraFps: 60, manualVideoCallbacks: true,
    sourceWidth: 1080, sourceHeight: 1920,
    scriptShapes: [{ stack_kind: "vsl", script_format: "vsl" }]
  });
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  const { copied, rate } = await page.evaluate(() => {
    const before = window.__recordDraws;
    const every = 1000 / 60;
    const start = performance.now() + 100;
    const times = Array.from({ length: 60 }, (_, i) => start + (i + 1) * every + (i % 2 ? -1 : 1));
    window.__sendVideoFrames(times);
    return { copied: window.__recordDraws - before, rate: window.__captureRates.at(-1) };
  });
  expect(rate).toBe(30);
  expect(copied).toBeGreaterThanOrEqual(25);
  expect(copied).toBeLessThanOrEqual(35);
  await page.locator("#b-rec").tap();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("live camera stays unrotated while saved video follows the phone turn", async ({ page }) => {
  const { server } = await open(page, { iphone: true, sourceWidth: 36, sourceHeight: 64 });
  await page.evaluate(() => {
    window.__phoneAngle = 0;
    Object.defineProperty(window, "orientation", {
      configurable: true,
      get: () => window.__phoneAngle
    });
  });
  await expect(page.locator("#cam-feed")).toHaveCSS("transform", "none");
  await page.locator("#b-camera-flip").tap();
  await expect(page.locator("#b-camera-flip")).toHaveAttribute("aria-label", "Use front camera");
  await expect(page.locator("#cam-feed")).toHaveCSS("transform", "none");
  await page.waitForTimeout(550);
  await page.locator("#b-camera-flip").tap();
  await expect(page.locator("#b-camera-flip")).toHaveAttribute("aria-label", "Use back camera");
  await expect(page.locator("#cam-feed")).toHaveCSS("transform", "none");
  await page.waitForTimeout(550);
  async function recordShape(angle) {
    await page.evaluate((next) => { window.__phoneAngle = next; }, angle);
    await expect(page.locator("#cam-feed")).toHaveCSS("transform", "none");
    const screen = page.viewportSize();
    const feed = await page.locator("#cam-feed").boundingBox();
    expect(Math.abs(feed.width - screen.width)).toBeLessThan(2);
    expect(Math.abs(feed.height - screen.height)).toBeLessThan(2);
    await page.locator("#b-rec").tap();
    await expect(page.locator("#b-rec")).toHaveText("Stop");
    const shape = await page.evaluate(() => {
      const track = window.__recordStream.getVideoTracks()[0];
      const settings = track.getSettings();
      return [settings.width, settings.height];
    });
    await expect.poll(() => page.evaluate(() => {
      const canvas = window.__recordCanvas;
      if (!canvas || canvas.width < 2 || canvas.height < 2) return false;
      const ctx = canvas.getContext("2d");
      // Read the camera image and keep the red-over-blue orientation check.
      const { data } = ctx.getImageData(Math.floor(canvas.width / 2), 0, 1, canvas.height);
      const colors = [];
      for (let p = 0; p < data.length; p += 4) {
        if (data[p] > 200 && data[p + 2] < 50) colors.push("red");
        else if (data[p + 2] > 200 && data[p] < 50) colors.push("blue");
      }
      const firstBlue = colors.indexOf("blue");
      return firstBlue > 0 && colors[0] === "red" && colors.at(-1) === "blue" &&
        colors.slice(firstBlue).every((color) => color === "blue");
    })).toBe(true);
    await page.locator("#b-rec").tap();
    await expect(page.locator("#take-save")).toBeVisible();
    await page.locator("#take-save-no").tap();
    return shape;
  }
  const upright = await recordShape(0);
  await page.evaluate(() => { window.__phoneAngle = 90; });
  await page.setViewportSize({ width: 844, height: 390 });
  const sideways = await recordShape(90);
  expect(upright[1]).toBeGreaterThan(upright[0]);
  expect(sideways[0]).toBeGreaterThan(sideways[1]);
  expect(server.errors).toEqual([]);
});

test("portrait take keeps both edges of the native portrait camera without a crop", async ({ page }) => {
  const { server } = await open(page, {
    iphone: true, sourceWidth: 36, sourceHeight: 64, edgeMarkers: true
  });
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await expect.poll(() => page.evaluate(() => {
    const canvas = window.__recordCanvas;
    if (!canvas || canvas.width < 2 || canvas.height < 2) return null;
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let lime = false, yellow = false;
    for (let p = 0; p < data.length; p += 4) {
      if (data[p] < 100 && data[p + 1] > 150 && data[p + 2] < 100) lime = true;
      if (data[p] > 150 && data[p + 1] > 150 && data[p + 2] < 100) yellow = true;
    }
    return { portrait: canvas.height > canvas.width, lime, yellow };
  })).toEqual({ portrait: true, lime: true, yellow: true });
  await page.locator("#b-rec").tap();
  await expect(page.locator("#take-save")).toBeVisible();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("sideways phone keeps Safari preview unrotated and saves a wide file", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const { server } = await open(page, { iphone: true, sourceWidth: 36, sourceHeight: 64 });
  await page.evaluate(() => {
    Object.defineProperty(window, "orientation", { configurable: true, value: 90 });
    window.dispatchEvent(new Event("orientationchange"));
  });
  await expect(page.locator("#cam-feed")).toHaveCSS("transform", "none");
  const feed = await page.locator("#cam-feed").boundingBox();
  expect(Math.abs(feed.width - 844)).toBeLessThan(2);
  expect(Math.abs(feed.height - 390)).toBeLessThan(2);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  const shape = await page.evaluate(() => {
    const settings = window.__recordStream.getVideoTracks()[0].getSettings();
    return [settings.width, settings.height];
  });
  expect(shape[0]).toBeGreaterThan(shape[1]);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#take-save")).toBeVisible();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("iPhone records one stable canvas stream even as physical lenses change", async ({ page }) => {
  const { server } = await open(page, { iphone: true, cameraDevices: [
    { kind: "videoinput", deviceId: "front", label: "Front Camera" },
    { kind: "videoinput", deviceId: "rear", label: "Back Camera" }
  ] });
  await page.locator("#play").tap();
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  expect(await page.evaluate(() => window.__recorderUsedCameraStream)).toBe(false);
  const flip = page.locator("#b-camera-flip");
  await flip.tap();
  await expect(flip).toHaveAttribute("aria-label", "Use front camera");
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await flip.tap();
  await expect(flip).toHaveAttribute("aria-label", "Use back camera");
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 0]);
  await page.waitForTimeout(550);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#take-save")).toBeVisible();
  await page.locator("#take-save-no").tap();
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 1]);
  expect(server.errors).toEqual([]);
});

test("Still to film uses offer-stack names and clearly marks the Complete target", async ({ page }) => {
  const shapes = [
    { offer_word: "Direct Book", stack_kind: "ad", stack_no: 2, ad_id: "93", angle_name: "Over and over" },
    { offer_word: "Direct Book", stack_kind: "vsl", stack_no: 1, ad_id: "94", angle_name: "Why lenders say no" },
    { offer_word: "Direct Book", stack_kind: "thank_you", stack_no: null, ad_id: "95", angle_name: "Next steps" }
  ];
  await open(page, { scriptShapes: shapes });
  await page.locator("#p-file").dblclick();
  const rows = page.locator("#qmenu-list .item");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0).locator(".t")).toHaveText("Direct Book Ad 2 — Over and over");
  await expect(rows.nth(0).locator(".m")).toHaveText("Current · Take 1 · Full script");
  await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(rows.nth(1).locator(".t")).toHaveText("Direct Book VSL 1 — Why lenders say no");
  await expect(rows.nth(2).locator(".t")).toHaveText("Direct Book Thank You — Next steps");
  await expect(page.locator("#qmenu")).not.toContainText("Ad 93");
  await expect(page.locator("#q-complete")).toHaveText("Complete current: Direct Book Ad 2 — Over and over");
  await rows.nth(1).tap();
  await page.locator("#p-file").dblclick();
  await expect(page.locator("#qmenu-list .item").nth(1).locator(".m")).toHaveText("Current · Take 1 · Full script");
  await expect(page.locator("#q-complete")).toHaveText("Complete current: Direct Book VSL 1 — Why lenders say no");
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
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  expect(server.uploads).toHaveLength(0);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#take-save")).toBeVisible();
  await expect(page.locator("#take-save-name")).toHaveText(scripts[0].take_file_name);
  await page.locator("#take-save-no").tap();
  expect((await state(page)).script.root_script_id).toBe(scripts[1].root_script_id);
  expect(server.errors).toEqual([]);
});

test("last script word keeps one take recording for two full seconds before automatic Stop", async ({ page }) => {
  const { server } = await open(page);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await page.evaluate(() => window.__fhtp.finish());
  await expect(page.locator("#end")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 0]);
  await expect.poll(() => page.evaluate(() => window.__recorderStops), { timeout: 2500 }).toBe(1);
  await expect(page.locator("#b-rec")).toHaveText("Record");
  await expect(page.getByRole("dialog", { name: "Save this video?" })).toBeVisible();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("moving to another script cancels the pending end tail without splitting the take", async ({ page }) => {
  const { server } = await open(page);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await page.evaluate(() => window.__fhtp.finish());
  await page.evaluate(() => window.__fhtp.next());
  await page.waitForTimeout(2150);
  expect(await page.evaluate(() => [window.__recorderStarts, window.__recorderStops])).toEqual([1, 0]);
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await page.locator("#b-rec").tap();
  await expect(page.getByRole("dialog", { name: "Save this video?" })).toBeVisible();
  await page.locator("#take-save-no").tap();
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

test("recording does not add a competing animation-frame loop to smooth scrolling", async ({ page }) => {
  const { server } = await open(page, { wpm: 200 });
  await page.locator("#play").tap();
  await page.waitForTimeout(250);
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
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
  expect(speeds.every((speed) => speed > 0)).toBe(true);
  const average = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
  expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(average * 0.08);
  await page.locator("#b-rec").tap();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("recording does not redraw a stale camera frame while the words roll", async ({ page }) => {
  const { server } = await open(page, { wpm: 200, freezeVideoCallbacks: true });
  await page.locator("#play").tap();
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  await page.waitForTimeout(150);
  const sample = () => page.evaluate(() => ({
    draws: window.__recordDraws,
    y: new DOMMatrix(document.getElementById("content").style.transform).m42
  }));
  const before = await sample();
  await page.waitForTimeout(450);
  const after = await sample();
  expect(after.y).toBeLessThan(before.y - 1);
  expect(after.draws - before.draws).toBeLessThanOrEqual(1);
  await page.locator("#b-rec").tap();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});

test("recording still paints and rolls on a browser without video-frame callbacks", async ({ page }) => {
  const { server } = await open(page, { wpm: 200, disableVideoCallbacks: true });
  await page.locator("#play").tap();
  await page.locator("#b-rec").tap();
  await expect(page.locator("#b-rec")).toHaveText("Stop");
  const before = await page.evaluate(() => new DOMMatrix(document.getElementById("content").style.transform).m42);
  await expect.poll(() => page.evaluate(() => window.__recordDraws)).toBeGreaterThan(1);
  const after = await page.evaluate(() => new DOMMatrix(document.getElementById("content").style.transform).m42);
  expect(after).toBeLessThan(before - 1);
  await page.locator("#b-rec").tap();
  await page.locator("#take-save-no").tap();
  expect(server.errors).toEqual([]);
});
