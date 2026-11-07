import { test, expect } from "@playwright/test";

const PUBLIC_URL = "https://fundhub.ai/devices.html";
const WEB_URL = "/app/client-portal.html";
const APP_URL = "https://apps.apple.com/us/app/fundhub-portal/id6823985032";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";

async function prepare(page, options = {}) {
  const settings = { ua: WINDOWS, platform: "Win32", hints: { platform: "Windows", mobile: false }, touch: 0, share: "absent", clipboard: "success", ...options };
  await page.addInitScript((o) => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: o.ua });
    Object.defineProperty(navigator, "platform", { configurable: true, value: o.platform });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: o.touch });
    Object.defineProperty(navigator, "userAgentData", { configurable: true, value: o.hints });
    window.__shared = [];
    window.__copied = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: o.share === "absent" ? undefined : (data) => {
      window.__shared.push(data);
      if (o.share === "cancel") return Promise.reject(new DOMException("Cancelled", "AbortError"));
      if (o.share === "failure") return Promise.reject(new DOMException("Not permitted", "NotAllowedError"));
      return Promise.resolve();
    } });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: o.clipboard === "absent" ? undefined : { writeText(text) {
      window.__copied.push(text);
      return o.clipboard === "failure" ? Promise.reject(new DOMException("Denied", "NotAllowedError")) : Promise.resolve();
    } } });
  }, settings);
  if (settings.policyMissing) await page.route("**/funnel/device-destinations.js", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/funnel/fundhub-prompter-download.json", (route) => settings.configError
    ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
    : route.fulfill({ json: settings.config || { app_store_url: APP_URL } }));
  return settings;
}

const matrix = [
  { name: "iPhone Safari", ua: IPHONE, platform: "iPhone", hints: undefined, touch: 5, iphone: true },
  { name: "iPhone Chrome", ua: IPHONE.replace("Version/18.0", "CriOS/130.0.0.0"), platform: "iPhone", hints: undefined, touch: 5, iphone: true },
  { name: "iPhone Facebook browser", ua: IPHONE + " [FBAN/FBIOS;FBAV/490.0.0.0.0]", platform: "iPhone", hints: undefined, touch: 5, iphone: true },
  { name: "Android Chrome", ua: ANDROID, platform: "Linux armv8l", hints: { platform: "Android", mobile: true }, touch: 5 },
  { name: "Android Facebook browser", ua: ANDROID + " [FB_IAB/FB4A;FBAV/490.0.0.0.0;]", platform: "Linux armv8l", hints: undefined, touch: 5 },
  { name: "Windows Chrome", ua: WINDOWS, platform: "Win32", hints: { platform: "Windows", mobile: false }, touch: 0 },
  { name: "Mac Safari", ua: MAC, platform: "MacIntel", hints: undefined, touch: 0 },
  { name: "Mac Chrome", ua: MAC.replace("Version/18.0", "Chrome/130.0.0.0"), platform: "MacIntel", hints: { platform: "macOS", mobile: false }, touch: 0 },
  { name: "Linux", ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36", platform: "Linux x86_64", hints: { platform: "Linux", mobile: false }, touch: 0 },
  { name: "ChromeOS", ua: "Mozilla/5.0 (X11; CrOS x86_64 130.0.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36", platform: "Linux x86_64", hints: { platform: "Chrome OS", mobile: false }, touch: 0 },
  { name: "iPad desktop mode", ua: MAC, platform: "MacIntel", hints: undefined, touch: 5 },
  { name: "iPad explicit UA", ua: IPHONE.replaceAll("iPhone", "iPad"), platform: "iPad", hints: undefined, touch: 5 },
  { name: "unsupported older iPhone", ua: IPHONE.replace("OS 18_0", "OS 16_7"), platform: "iPhone", hints: undefined, touch: 5 },
  { name: "conflicting Apple and Android signals", ua: IPHONE, platform: "iPhone", hints: { platform: "Android", mobile: true }, touch: 5 },
  { name: "unknown device", ua: "Private browser", platform: "", hints: undefined, touch: 0 },
];

for (const device of matrix) {
  test(`${device.name}: public browser route is always available and Apple requires a supported deliberate choice`, async ({ page }) => {
    await prepare(page, device);
    await page.goto("/devices.html");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Add another device.");
    await expect(page.locator("#open-browser")).toHaveAttribute("href", WEB_URL);
    await expect(page.locator("#open-browser")).toBeVisible();
    await expect(page.locator("#copy-link")).toBeVisible();
    await expect(page.locator("#device-link")).toHaveValue(PUBLIC_URL);
    await expect(page.locator('a[href*="apps.apple.com"]')).toHaveCount(0);
    if (device.iphone) {
      await expect(page.locator("#iphone-choice")).toBeVisible();
      await page.locator("#iphone-choice").click();
      await expect(page.locator("#iphone-download")).toHaveAttribute("href", APP_URL);
      await expect(page.locator("#iphone-download")).toHaveAttribute("rel", "noopener noreferrer");
      await expect(page.locator("#open-browser")).toBeVisible();
    } else {
      await expect(page.locator("#iphone-install")).toBeHidden();
      await expect(page.locator("#iphone-choice")).toBeHidden();
      await expect(page.locator('a[href*="apple.com"],a[href*="testflight"]')).toHaveCount(0);
    }
  });
}

test("computer shows the QR; phone uses a share/copy layout", async ({ page }) => {
  await prepare(page);
  await page.goto("/devices.html");
  await expect(page.locator("#device-qr")).toBeVisible();
  await expect(page.locator("#device-qr")).toHaveAttribute("src", "/assets/fundhub-devices-qr.svg");
  await expect(page.locator("#device-qr")).toHaveJSProperty("complete", true);
  expect(await page.locator("#device-qr").evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
});

test("phone shows the computer handoff copy and no phone QR", async ({ page }) => {
  await prepare(page, { ua: IPHONE, platform: "iPhone", hints: undefined, touch: 5, share: "success" });
  await page.goto("/devices.html");
  await expect(page.locator("#transfer-title")).toHaveText("Use Fundhub on your computer.");
  await expect(page.locator("#qr-wrap")).toBeHidden();
  await expect(page.locator("#share-link")).toBeVisible();
});

test("copy shares only the fixed public URL even when the incoming page contains private-looking parameters", async ({ page }) => {
  await prepare(page);
  await page.goto("/devices.html?t=synthetic-secret&email=e2e%40example.invalid#private");
  await page.locator("#copy-link").click();
  await expect(page.locator("#transfer-status")).toHaveText("Link copied. Open it on your other device.");
  await expect.poll(() => page.evaluate(() => window.__copied)).toEqual([PUBLIC_URL]);
  await expect(page.locator("#device-link")).toHaveValue(PUBLIC_URL);
});

for (const clipboard of ["failure", "absent"]) {
  test(`clipboard ${clipboard}: selects an ordinary link and keeps the browser route`, async ({ page }) => {
    await prepare(page, { clipboard });
    await page.goto("/devices.html");
    await page.locator("#copy-link").click();
    await expect(page.locator("#transfer-status")).toHaveText("Link selected. Copy it, then open it on your other device.");
    await expect(page.locator("#copy-link")).toBeEnabled();
    expect(await page.locator("#device-link").evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(PUBLIC_URL);
    await expect(page.locator("#open-browser")).toBeVisible();
  });
}

for (const share of ["success", "cancel", "failure"]) {
  test(`share ${share}: sends only the fixed public link and preserves fallback`, async ({ page }) => {
    await prepare(page, { ua: IPHONE, platform: "iPhone", hints: undefined, touch: 5, share });
    await page.goto("/devices.html?t=synthetic-secret");
    await page.locator("#share-link").click();
    await expect(page.locator("#share-link")).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.__shared)).toEqual([{ title: "Fundhub", text: "Open Fundhub on your other device.", url: PUBLIC_URL }]);
    const message = share === "success" ? "Share options closed. You can also copy the link." : share === "cancel" ? "Sharing cancelled. Your link is still here." : "Sharing could not open here. Copy the link instead.";
    await expect(page.locator("#transfer-status")).toHaveText(message);
    await expect(page.locator("#copy-link")).toBeVisible();
    await expect(page.locator("#open-browser")).toBeVisible();
  });
}

for (const options of [
  { name: "missing policy", policyMissing: true },
  { name: "empty app config", config: {} },
  { name: "foreign app config", config: { app_store_url: "https://apps.apple.com/us/app/foreign/id1234567890" } },
  { name: "failed app config", configError: true },
]) {
  test(`${options.name}: no Apple link and the public browser route remains usable`, async ({ page }) => {
    await prepare(page, { ua: IPHONE, platform: "iPhone", hints: undefined, touch: 5, ...options });
    await page.goto("/devices.html");
    if (options.configError) await expect(page.locator("#iphone-install")).toHaveAttribute("data-app-state", "error");
    else if (!options.policyMissing) await expect(page.locator("#iphone-install")).toHaveAttribute("data-app-state", "empty");
    await expect(page.locator("#iphone-choice")).toBeHidden();
    await expect(page.locator('a[href*="apps.apple.com"]')).toHaveCount(0);
    await expect(page.locator("#open-browser")).toHaveAttribute("href", WEB_URL);
    await expect(page.locator("#copy-link")).toBeVisible();
  });
}

test("failed config can recover through the actual retry control", async ({ page }) => {
  await prepare(page, { ua: IPHONE, platform: "iPhone", hints: undefined, touch: 5, configError: true });
  await page.goto("/devices.html");
  await expect(page.locator("#retry-app")).toBeVisible();
  await page.route("**/funnel/fundhub-prompter-download.json", (route) => route.fulfill({ json: { app_store_url: APP_URL } }));
  await page.locator("#retry-app").click();
  await expect(page.locator("#iphone-choice")).toBeVisible();
  await expect(page.locator('a[href*="apps.apple.com"]')).toHaveCount(0);
});

test("loading app config does not block browser/share/copy controls", async ({ page }) => {
  await prepare(page, { ua: IPHONE, platform: "iPhone", hints: undefined, touch: 5 });
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  await page.route("**/funnel/fundhub-prompter-download.json", async (route) => { await wait; await route.fulfill({ json: { app_store_url: APP_URL } }); });
  await page.goto("/devices.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#iphone-install")).toHaveAttribute("data-app-state", "loading");
  await expect(page.locator("#iphone-choice")).toBeHidden();
  await expect(page.locator("#open-browser")).toBeVisible();
  await page.locator("#copy-link").click();
  await expect(page.locator("#transfer-status")).toContainText("Link copied");
  release();
  await expect(page.locator("#iphone-choice")).toBeVisible();
});

test("QR loading failure leaves the ordinary copy link", async ({ page }) => {
  await prepare(page);
  await page.route("**/assets/fundhub-devices-qr.svg", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/devices.html");
  await expect(page.locator("#qr-error")).toBeVisible();
  await expect(page.locator("#qr-wrap")).toBeHidden();
  await page.locator("#copy-link").click();
  await expect(page.locator("#transfer-status")).toContainText("Link copied");
});

for (const width of [390, 768, 1440]) {
  test(`${width}px: fits the viewport and retains readable type and usable controls`, async ({ page }) => {
    await prepare(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/devices.html");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    expect(await page.locator(".devices-heading>p:last-child").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    for (const control of ["#copy-link", "#open-browser", "#device-link"]) {
      const box = await page.locator(control).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("ordinary portal and manual public device link work with no dead controls", async ({ page }) => {
    await page.goto("/devices.html");
    await expect(page.locator("#open-browser")).toHaveAttribute("href", WEB_URL);
    await expect(page.locator("#open-browser")).toBeVisible();
    await expect(page.locator("#device-link")).toHaveValue(PUBLIC_URL);
    await expect(page.locator("#copy-link")).toBeHidden();
    await expect(page.locator("#share-link")).toBeHidden();
    await expect(page.locator('a[href*="apps.apple.com"]')).toHaveCount(0);
  });
});


test("current-device and Back links preserve the native portal session destination", async ({ page }) => {
  await prepare(page);
  await page.route("**/app/client-portal.html", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Portal continuation</h1>" }));
  await page.goto("/devices.html");
  await expect(page.locator("#back-fundhub")).toHaveAttribute("href", "/app/client-portal.html");
  await expect(page.locator("#open-browser")).toHaveAttribute("href", "/app/client-portal.html");
  await page.locator("#open-browser").click();
  await expect(page).toHaveURL(/\/app\/client-portal\.html$/);
  await expect(page.getByRole("heading")).toHaveText("Portal continuation");
});

test("Back returns to the real same-origin workspace entry", async ({ page }) => {
  await prepare(page);
  await page.route("**/app/client-portal.html", (route) => route.fulfill({ contentType: "text/html", body: '<h1>Original portal</h1><a href="/devices.html">Add another device</a>' }));
  await page.goto("/app/client-portal.html");
  await page.getByRole("link", { name: "Add another device" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Add another device.");
  await page.getByRole("link", { name: "Back to Fundhub" }).click();
  await expect(page).toHaveURL(/\/app\/client-portal\.html$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Original portal");
});

test("a foreign referrer never becomes a Back destination", async ({ page }) => {
  await prepare(page);
  await page.route("**/app/client-portal.html", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Safe portal</h1>" }));
  await page.goto("/devices.html", { referer: "https://outside.example.invalid/private" });
  await page.getByRole("link", { name: "Back to Fundhub" }).click();
  await expect(page).toHaveURL(/\/app\/client-portal\.html$/);
  await expect(page.getByRole("heading")).toHaveText("Safe portal");
});
