import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";

const ORIGIN = "https://fundhub.ai";
const RP_ID = "fundhub.ai";
const FIXTURE_PATH = "/__e2e__/passkey-bank-stepup";
const RECOVERY_CODE = "SYNTHETIC-RECOVERY-CODE";
const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `SYNTHETIC-${String(i + 1).padStart(2, "0")}-RECOVERY`);
const EVIDENCE = "ops/workflows/build-evidence/passkey-bank-stepup-2026-11-06";
const SCRIPT = fs.readFileSync("public/app/plaid-stepup.js", "utf8");
const CSS = fs.readFileSync("public/app/plaid-stepup.css", "utf8");

// Every request is fulfilled in this test file. The browser stays on the real
// fundhub.ai origin for secure-context WebAuthn, but no production request is sent.
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Passkey bank fixture</title>
<link rel="stylesheet" href="/app/plaid-stepup.css"><script defer src="/app/plaid-stepup.js"></script></head>
<body><main><h1>Bank connection fixture</h1><button id="start">Connect bank</button></main>
<script>
window.flowOutcome = { state: "idle" };
window.beginBankFlow = function (kind, mode) {
  window.flowOutcome = { state: "pending" };
  const call = mode === "verify" ? window.FHPlaidStepUp.verify(kind) : window.FHPlaidStepUp.authorize(kind);
  call.then(value => { window.flowOutcome = { state: "resolved", value }; },
    error => { window.flowOutcome = { state: "rejected", error: error && error.message }; });
};
document.querySelector("#start").addEventListener("click", () =>
  window.beginBankFlow(document.body.dataset.target || "client_bank", document.body.dataset.mode || "authorize"));
</script></body></html>`;

async function addAuthenticator(page, { userVerified = true, automaticPresenceSimulation = true, badUV = false } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: userVerified,
    automaticPresenceSimulation
  } });
  if (badUV) await cdp.send("WebAuthn.setResponseOverrideBits", { authenticatorId, isBadUV: true });
  return { cdp, authenticatorId };
}

function createPasskeyEndpoint({ status = {}, failRegisterOptions = false } = {}) {
  const timeline = [];
  const challenges = new Map();
  const credentials = new Map();
  let enrolled = status.enrolled === true;
  let assured = status.assured === true;
  let recoveryRequired = status.recovery_required === true;
  let recoveryUsed = false;
  let recoveryCodesIssued = false;
  let lastVerification = null;

  function note(action, body) {
    timeline.push({ endpoint: "passkey", action, target_kind: body.target_kind,
      recovery_token: body.recovery_token });
  }

  async function handle(body) {
    note(body.action, body);
    if (body.action === "status") return { ok: true, enrolled, assured, recovery_required: recoveryRequired };
    if (body.action === "recover") {
      if (body.recovery_code !== RECOVERY_CODE || recoveryUsed) return { ok: false, error: "invalid_recovery_code" };
      recoveryUsed = true;
      recoveryRequired = false;
      return { ok: true, recovery_token: "synthetic-recovery-token" };
    }
    if (body.action === "register_options") {
      if (failRegisterOptions) return { ok: false, error: "fresh_login_required" };
      if (recoveryUsed && body.recovery_token !== "synthetic-recovery-token") return { ok: false, error: "passkey_verification_failed" };
      const options = await generateRegistrationOptions({
        rpName: "Fundhub", rpID: RP_ID,
        userName: "synthetic-client@fundhub.ai", userDisplayName: "Synthetic Fundhub Client",
        userID: Buffer.from("synthetic-fundhub-account", "utf8"),
        attestationType: "none", timeout: 300000, supportedAlgorithmIDs: [-7, -257],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        excludeCredentials: [...credentials.values()].map(c => ({ id: c.id, transports: c.transports }))
      });
      const challenge_token = randomUUID();
      challenges.set(challenge_token, { action: "register", challenge: options.challenge });
      return { ok: true, challenge_token, options };
    }
    if (body.action === "register_verify") {
      const challenge = challenges.get(body.challenge_token);
      challenges.delete(body.challenge_token);
      if (!challenge || challenge.action !== "register") return { ok: false, error: "passkey_verification_failed" };
      try {
        const result = await verifyRegistrationResponse({
          response: body.response, expectedChallenge: challenge.challenge,
          expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserPresence: true,
          requireUserVerification: true, supportedAlgorithmIDs: [-7, -257]
        });
        lastVerification = { verified: result.verified, userVerified: result.registrationInfo?.userVerified === true };
        if (!result.verified || !result.registrationInfo?.userVerified) return { ok: false, error: "passkey_verification_failed" };
        const key = result.registrationInfo.credential;
        credentials.set(key.id, { id: key.id, publicKey: new Uint8Array(key.publicKey), counter: key.counter,
          transports: key.transports || [], deviceType: result.registrationInfo.credentialDeviceType });
        enrolled = true;
        return { ok: true, registered: true, assured: false };
      } catch {
        lastVerification = { verified: false, userVerified: false };
        return { ok: false, error: "passkey_verification_failed" };
      }
    }
    if (body.action === "authenticate_options") {
      const options = await generateAuthenticationOptions({
        rpID: RP_ID, timeout: 300000, userVerification: "required",
        allowCredentials: [...credentials.values()].map(c => ({ id: c.id, transports: c.transports }))
      });
      const challenge_token = randomUUID();
      challenges.set(challenge_token, { action: "authenticate", challenge: options.challenge });
      return { ok: true, challenge_token, options };
    }
    if (body.action === "authenticate_verify") {
      const challenge = challenges.get(body.challenge_token);
      challenges.delete(body.challenge_token);
      const credential = credentials.get(body.response?.id);
      if (!challenge || challenge.action !== "authenticate" || !credential) return { ok: false, error: "passkey_verification_failed" };
      try {
        const result = await verifyAuthenticationResponse({
          response: body.response, expectedChallenge: challenge.challenge,
          expectedOrigin: ORIGIN, expectedRPID: RP_ID,
          credential: { id: credential.id, publicKey: credential.publicKey,
            counter: credential.counter, transports: credential.transports },
          requireUserVerification: true
        });
        const userVerified = result.authenticationInfo?.userVerified === true;
        lastVerification = { verified: result.verified, userVerified };
        if (!result.verified || !userVerified) return { ok: false, error: "passkey_verification_failed" };
        credential.counter = result.authenticationInfo.newCounter;
        assured = true;
        const response = { ok: true, assured: true };
        if (!recoveryCodesIssued) {
          recoveryCodesIssued = true;
          response.recovery_codes = RECOVERY_CODES;
        }
        return response;
      } catch {
        lastVerification = { verified: false, userVerified: false };
        return { ok: false, error: "passkey_verification_failed" };
      }
    }
    return { ok: false, error: "action_required" };
  }
  return { timeline, handle, lastVerification: () => lastVerification };
}

async function openFixture(page, { targetKind = "client_bank", mode = "authorize", status = {}, failRegisterOptions = false } = {}) {
  const api = createPasskeyEndpoint({ status, failRegisterOptions });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "synthetic-e2e-session-token");
    window.__credentialCalls = [];
    for (const method of ["create", "get"]) {
      const credentials = navigator.credentials;
      const original = credentials[method].bind(credentials);
      Object.defineProperty(credentials, method, { configurable: true, value: function (options) {
        const entry = { method, pending: true, userVerification: options?.publicKey?.userVerification || options?.publicKey?.authenticatorSelection?.userVerification || null, aborted: false };
        window.__credentialCalls.push(entry);
        if (options?.signal) options.signal.addEventListener("abort", () => { entry.aborted = true; }, { once: true });
        return original(options).finally(() => { entry.pending = false; });
      } });
    }
  });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    if (url.pathname === FIXTURE_PATH) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8",
      body: HTML.replace('<body>', `<body data-target="${targetKind}" data-mode="${mode}">`) });
    if (url.pathname === "/app/plaid-stepup.js") return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: SCRIPT });
    if (url.pathname === "/app/plaid-stepup.css") return route.fulfill({ status: 200, contentType: "text/css; charset=utf-8", body: CSS });
    if (url.pathname === "/api/auth/passkey") {
      const result = await api.handle(route.request().postDataJSON());
      return route.fulfill({ status: result.ok ? 200 : 401, contentType: "application/json", body: JSON.stringify(result) });
    }
    if (url.pathname === "/api/auth/plaid-mfa") {
      const body = route.request().postDataJSON();
      api.timeline.push({ endpoint: "consent", action: body.action, target_kind: body.target_kind, consent: body.consent });
      if (body.action === "consent_details") return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, consent_text: "I agree to connect this synthetic bank.", privacy_url: "/privacy/" }) });
      if (body.action === "authorize") return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify(body.consent === true ? { ok: true, grant_token: "synthetic-bank-grant" } : { ok: false, error: "consent_required" }) });
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    }
    return route.fulfill({ status: 404, body: "fixture only" });
  });
  await page.goto(`${ORIGIN}${FIXTURE_PATH}`);
  return { api, pageErrors };
}

async function expectOutcome(page, expected) {
  await expect.poll(() => page.evaluate(() => window.flowOutcome)).toEqual(expected);
}

async function captureMarkedSetup(page, filename) {
  await page.evaluate(() => {
    document.querySelector("#passkey-review-overlay")?.remove();
    const dialog = document.querySelector(".fh-plaid-stepup");
    if (!dialog.hasAttribute("data-review-overflow")) dialog.dataset.reviewOverflow = dialog.style.overflow;
    if (!dialog.hasAttribute("data-review-padding")) dialog.dataset.reviewPadding = dialog.style.paddingBottom;
    dialog.style.overflow = "visible";
    dialog.style.paddingBottom = "50px";
    const dialogBox = dialog.getBoundingClientRect();
    const titleNode = document.querySelector(".fh-plaid-stepup h2");
    const range = document.createRange(); range.selectNodeContents(titleNode);
    const title = range.getBoundingClientRect();
    const action = document.querySelector(".fh-plaid-stepup [data-continue]").getBoundingClientRect();
    const overlay = document.createElement("div");
    overlay.id = "passkey-review-overlay";
    Object.assign(overlay.style, { position: "absolute", inset: "0", zIndex: "2147483647", pointerEvents: "none", overflow: "visible" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.assign(svg.style, { position: "absolute", inset: "0", width: `${dialogBox.width}px`, height: `${dialogBox.height}px`, overflow: "visible" });
    const addArrow = (x1, y1, x2, y2) => {
      const makeLine = (color, width) => {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(x1)); line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2)); line.setAttribute("y2", String(y2));
        line.setAttribute("stroke", color); line.setAttribute("stroke-width", String(width));
        line.setAttribute("stroke-linecap", "round"); svg.appendChild(line);
      };
      makeLine("#181818", 8); makeLine("#ffd21f", 4);
      const angle = Math.atan2(y2 - y1, x2 - x1), length = 12, half = 7;
      const bx = x2 - Math.cos(angle) * length, by = y2 - Math.sin(angle) * length;
      const points = `${x2},${y2} ${bx - Math.sin(angle) * half},${by + Math.cos(angle) * half} ${bx + Math.sin(angle) * half},${by - Math.cos(angle) * half}`;
      const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      head.setAttribute("points", points); head.setAttribute("fill", "#ffd21f"); head.setAttribute("stroke", "#181818"); head.setAttribute("stroke-width", "2");
      svg.appendChild(head);
    };
    const addMark = (rect, number, placement) => {
      const size = 34, left = rect.left - dialogBox.left, top = rect.top - dialogBox.top;
      const x = placement === "right" ? left + rect.width + 20 : left + rect.width / 2 - size / 2;
      const y = placement === "right" ? top + rect.height / 2 - size / 2
        : placement === "above" ? top - size - 12 : top + rect.height + 14;
      const badge = document.createElement("div");
      badge.textContent = String(number);
      Object.assign(badge.style, { position: "absolute", left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px`,
        display: "grid", placeItems: "center", borderRadius: "50%", boxSizing: "border-box", border: "3px solid #fff", outline: "2px solid #bd1717",
        background: "#d52222", color: "#fff", font: "bold 18px Arial,sans-serif", boxShadow: "0 1px 4px #333" });
      overlay.appendChild(badge);
      if (placement === "right") addArrow(x, y + size / 2, left + rect.width + 4, top + rect.height / 2);
      else if (placement === "above") addArrow(x + size / 2, y + size, left + rect.width / 2, top + 2);
      else addArrow(x + size / 2, y, left + rect.width / 2, top + rect.height - 2);
    };
    addMark(title, 1, "right"); addMark(action, 2, "below");
    overlay.appendChild(svg);
    const caption = document.createElement("div");
    caption.textContent = "Existing account; passkey setup before bank connection";
    Object.assign(caption.style, { position: "absolute", bottom: "-42px", left: "50%", transform: "translateX(-50%)", maxWidth: "calc(100vw - 24px)",
      padding: "7px 10px", borderRadius: "4px", background: "#181818", color: "#fff", font: "bold 13px Arial,sans-serif", textAlign: "center", boxShadow: "0 1px 5px #555" });
    overlay.appendChild(caption); dialog.appendChild(overlay);
  });
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: `${EVIDENCE}/${filename}`, fullPage: true });
  await page.locator("#passkey-review-overlay").evaluate(node => node.remove());
  await page.locator(".fh-plaid-stepup").evaluate(dialog => {
    dialog.style.overflow = dialog.dataset.reviewOverflow || "";
    dialog.style.paddingBottom = dialog.dataset.reviewPadding || "";
    delete dialog.dataset.reviewOverflow; delete dialog.dataset.reviewPadding;
  });
}

test.describe("Plaid bank passkey step-up on the exact Fundhub origin", () => {
  test("waits for a click, registers, verifies with user verification, saves codes, then asks consent", async ({ page }) => {
    const { cdp, authenticatorId } = await addAuthenticator(page);
    const { api, pageErrors } = await openFixture(page);
    expect(new URL(page.url()).origin).toBe(ORIGIN);
    await expect(page.locator(".fh-plaid-stepup")).toHaveCount(0);
    expect(api.timeline).toEqual([]);
    expect(await page.evaluate(() => window.__credentialCalls)).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#start").click();
    await expect(page.locator(".fh-plaid-stepup h2")).toHaveText("Set up a passkey");
    await expect(page.locator("[data-continue]")).toHaveText("Set up passkey");
    await expect(page.locator("[data-passkey-browser]")).toBeVisible();
    await expect(page.locator(".fh-plaid-stepup")).toContainText("On Mac, open fundhub.ai in Safari or Chrome.");
    await captureMarkedSetup(page, "passkey-setup-mobile-390.png");
    await page.setViewportSize({ width: 1280, height: 900 });
    await captureMarkedSetup(page, "passkey-setup-desktop.png");
    expect(api.timeline.map(x => x.action)).toEqual(["status"]);
    await page.locator("[data-continue]").click();
    await expect(page.locator("[data-continue]")).toHaveText("Verify and continue");
    expect(api.timeline.map(x => x.action)).toEqual(["status", "register_options", "register_verify"]);
    expect(api.lastVerification()).toEqual({ verified: true, userVerified: true });
    expect(await page.evaluate(() => window.__credentialCalls.map(x => [x.method, x.userVerification]))).toEqual([["create", "required"]]);

    await page.locator("[data-continue]").click();
    await expect(page.locator("[data-continue]")).toHaveText("I saved these codes");
    expect(api.timeline.map(x => x.action)).toEqual(["status", "register_options", "register_verify", "authenticate_options", "authenticate_verify"]);
    await expect(page.locator("textarea[readonly]")).toBeVisible();
    expect((await page.locator("textarea[readonly]").inputValue()).split("\n")).toHaveLength(10);
    await page.evaluate(() => { window.savedCodesDialog = document.querySelector(".fh-plaid-stepup"); });
    await expect(page.locator(".fh-plaid-stepup")).not.toContainText("I agree to connect this synthetic bank.");
    await page.locator("[data-continue]").click();

    await expect(page.locator(".fh-plaid-stepup")).toContainText("I agree to connect this synthetic bank.");
    expect(api.timeline.map(x => x.action)).toEqual(["status", "register_options", "register_verify", "authenticate_options", "authenticate_verify", "consent_details"]);
    expect(await page.evaluate(() => ({ connected: window.savedCodesDialog.isConnected,
      cleared: window.savedCodesDialog.querySelector("textarea").value }))).toEqual({ connected: false, cleared: "" });
    await expect(page.locator('[name="consent"]')).not.toBeChecked();
    await page.locator('[name="consent"]').check();
    await page.locator("[data-continue]").click();
    await expectOutcome(page, { state: "resolved", value: "synthetic-bank-grant" });
    expect(api.timeline.map(x => x.action)).toEqual(["status", "register_options", "register_verify", "authenticate_options", "authenticate_verify", "consent_details", "authorize"]);
    expect(api.timeline.at(-1)).toMatchObject({ action: "authorize", consent: true, target_kind: "client_bank" });
    expect(pageErrors).toEqual([]);
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.detach();
  });

  test("an existing assurance skips the authenticator and still requires explicit consent", async ({ page }) => {
    const { api, pageErrors } = await openFixture(page, { status: { enrolled: true, assured: true } });
    await page.locator("#start").click();
    await expect(page.locator(".fh-plaid-stepup")).toContainText("I agree to connect this synthetic bank.");
    expect(api.timeline.map(x => x.action)).toEqual(["status", "consent_details"]);
    expect(await page.evaluate(() => window.__credentialCalls)).toEqual([]);
    await expect(page.locator('[name="consent"]')).not.toBeChecked();
    await page.locator('[name="consent"]').check();
    await page.locator("[data-continue]").click();
    await expectOutcome(page, { state: "resolved", value: "synthetic-bank-grant" });
    expect(api.timeline.map(x => x.action)).toEqual(["status", "consent_details", "authorize"]);
    expect(pageErrors).toEqual([]);
  });

  test("missing WebAuthn APIs keep browser fallback usable and never authorize the bank", async ({ page }) => {
    const { api, pageErrors } = await openFixture(page, { targetKind: "client_bank" });
    await page.evaluate(() => { window.PublicKeyCredential = undefined; });
    await page.locator("#start").click();
    const dialog = page.locator(".fh-plaid-stepup");
    await expect(dialog.locator("h2")).toHaveText("Verify in a browser");
    await expect(dialog).toContainText("Use Safari or Chrome to set up or verify your passkey");
    await expect(dialog.locator("[data-passkey-browser]")).toBeVisible();
    await expect(dialog.locator("[data-continue]")).toBeHidden();
    await expect(dialog.locator("[data-passkey-recovery]")).toBeHidden();
    expect(await dialog.locator("[data-passkey-browser]").getAttribute("href")).toBe("https://www.fundhub.ai/portal-login.html");
    expect(api.timeline.map(item => item.action)).toEqual(["status"]);
    expect(await page.evaluate(() => window.__credentialCalls)).toEqual([]);
    expect(api.timeline.some(item => ["register_options", "register_verify", "authenticate_options", "authenticate_verify", "consent_details", "authorize"].includes(item.action))).toBe(false);
    await dialog.locator("[data-cancel]").click();
    await expectOutcome(page, { state: "rejected", error: "cancelled" });
    expect(api.timeline.map(item => item.action)).toEqual(["status"]);
    expect(pageErrors).toEqual([]);
  });

  test("cancel closes the first prompt; retry can verify, but cancelling code review makes no consent call", async ({ page }) => {
    const { cdp, authenticatorId } = await addAuthenticator(page);
    const { api, pageErrors } = await openFixture(page);
    await page.locator("#start").click();
    await expect(page.locator(".fh-plaid-stepup")).toBeVisible();
    await page.locator("[data-cancel]").click();
    await expectOutcome(page, { state: "rejected", error: "cancelled" });
    expect(api.timeline.map(x => x.action)).toEqual(["status"]);

    await page.locator("#start").click();
    await page.locator("[data-continue]").click();
    await expect(page.locator("[data-continue]")).toHaveText("Verify and continue");
    await page.locator("[data-continue]").click();
    await expect(page.locator("[data-continue]")).toHaveText("I saved these codes");
    expect(api.timeline.map(x => x.action)).toEqual(["status", "status", "register_options", "register_verify", "authenticate_options", "authenticate_verify"]);
    await page.locator("[data-cancel]").click();
    await expectOutcome(page, { state: "rejected", error: "cancelled" });
    expect(api.timeline.some(x => x.endpoint === "consent")).toBe(false);
    expect(api.timeline.some(x => x.action === "authorize" || x.action === "consent_details")).toBe(false);
    expect(pageErrors).toEqual([]);
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.detach();
  });

  for (const abortMode of ["token change", "pagehide"]) {
    test(`aborts a pending real credential request on ${abortMode} without verification or consent`, async ({ page }) => {
      const { cdp, authenticatorId } = await addAuthenticator(page, { automaticPresenceSimulation: false });
      const { api, pageErrors } = await openFixture(page);
      await page.locator("#start").click();
      await page.locator("[data-continue]").click();
      await expect.poll(() => page.evaluate(() => window.__credentialCalls.at(-1)?.pending)).toBe(true);
      if (abortMode === "token change") {
        await page.evaluate(() => localStorage.setItem("fh_token", "synthetic-switched-account"));
      } else {
        await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      }
      await expect.poll(() => page.evaluate(() => window.__credentialCalls.at(-1)?.aborted)).toBe(true);
      await expect.poll(() => page.evaluate(() => window.flowOutcome)).toEqual({ state: "rejected", error: "cancelled" });
      expect(api.timeline.map(x => x.action)).toEqual(["status", "register_options"]);
      expect(api.timeline.some(x => x.action.endsWith("_verify") || x.endpoint === "consent")).toBe(false);
      expect(pageErrors).toEqual([]);
      await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
      await cdp.detach();
    });
  }

  test("recovery token is sent with registration despite initially enrolled status; recovery codes never escape", async ({ page }) => {
    const { cdp, authenticatorId } = await addAuthenticator(page);
    const { api, pageErrors } = await openFixture(page, { mode: "verify", status: { enrolled: true, recovery_required: true } });
    await page.locator("#start").click();
    await expect(page.locator(".fh-plaid-stepup h2")).toHaveText("Recover your passkey");
    await page.locator('[name="recovery"]').fill(RECOVERY_CODE);
    await page.locator("[data-recover]").click();
    await expect(page.locator(".fh-plaid-stepup h2")).toHaveText("Set up a passkey");
    await page.locator("[data-continue]").click();
    await expect(page.locator("[data-continue]")).toHaveText("Verify and continue");
    await page.locator("[data-continue]").click();
    await expect(page.locator("[data-continue]")).toHaveText("I saved these codes");
    const registrationOptions = api.timeline.find(x => x.action === "register_options");
    expect(registrationOptions).toMatchObject({ recovery_token: "synthetic-recovery-token", target_kind: "client_bank" });
    await page.evaluate(() => { window.recoveryCodesDialog = document.querySelector(".fh-plaid-stepup"); });
    expect((await page.locator("textarea[readonly]").inputValue()).split("\n")).toHaveLength(10);
    await page.locator("[data-continue]").click();
    await expect.poll(() => page.evaluate(() => window.flowOutcome.state)).toBe("resolved");
    const outcome = await page.evaluate(() => window.flowOutcome.value);
    expect(outcome.assured).toBe(true);
    expect(outcome).not.toHaveProperty("recovery_codes");
    expect(await page.evaluate(() => ({ connected: window.recoveryCodesDialog.isConnected,
      cleared: window.recoveryCodesDialog.querySelector("textarea").value }))).toEqual({ connected: false, cleared: "" });
    expect(api.timeline.map(x => x.action)).toEqual(["status", "recover", "register_options", "register_verify", "authenticate_options", "authenticate_verify"]);
    expect(pageErrors).toEqual([]);
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.detach();
  });

  test("recovery-required state hides normal continue and opens recovery controls", async ({ page }) => {
    const { api, pageErrors } = await openFixture(page, { status: { enrolled: true, recovery_required: true } });
    await page.locator("#start").click();
    await expect(page.locator(".fh-plaid-stepup h2")).toHaveText("Recover your passkey");
    await expect(page.locator("[data-continue]")).toBeHidden();
    await expect(page.locator("[data-passkey-recovery]")).toBeVisible();
    expect(await page.locator("[data-passkey-recovery]").evaluate(el => el.open)).toBe(true);
    expect(await page.evaluate(() => window.__credentialCalls)).toEqual([]);
    expect(api.timeline.map(x => x.action)).toEqual(["status"]);
    await page.locator("[data-cancel]").click();
    expect(pageErrors).toEqual([]);
  });

  test("authenticator response without user verification shows retry and never authorizes the bank", async ({ page }) => {
    const { cdp, authenticatorId } = await addAuthenticator(page, { badUV: true });
    const { api, pageErrors } = await openFixture(page);
    await page.locator("#start").click();
    await page.locator("[data-continue]").click();
    await expect(page.locator(".fh-plaid-stepup-error")).toContainText("passkey check");
    await expect(page.locator("[data-continue]")).toBeEnabled();
    await expect(page.locator("[data-continue]")).toHaveText("Set up passkey");
    expect(api.timeline.map(x => x.action)).toEqual(["status", "register_options", "register_verify"]);
    expect(api.timeline.some(x => x.endpoint === "consent" || x.action === "authorize")).toBe(false);
    expect(api.lastVerification()).toEqual({ verified: false, userVerified: false });
    expect(pageErrors).toEqual([]);
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.detach();
  });

  for (const target of [
    { kind: "client_bank", href: `${ORIGIN}/portal-login.html`, browserHref: "https://www.fundhub.ai/portal-login.html" },
    { kind: "affiliate_payout", href: `${ORIGIN}/login.html?next=%2Fapp%2Faffiliate.html`, browserHref: "https://www.fundhub.ai/login.html?next=%2Fapp%2Faffiliate.html" },
    { kind: "company_bank", href: `${ORIGIN}/login.html?next=%2Fapp%2Fcompany-cash.html`, browserHref: "https://www.fundhub.ai/login.html?next=%2Fapp%2Fcompany-cash.html" }
  ]) {
    test(`${target.kind} prompt uses its fresh sign-in URL at mobile and desktop widths`, async ({ page }, testInfo) => {
      const { api, pageErrors } = await openFixture(page, { targetKind: target.kind, failRegisterOptions: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#start").click();
      await page.locator("[data-continue]").click();
      await expect(page.locator("[data-passkey-signin]")).toBeVisible();
      expect(new URL(await page.locator("[data-passkey-signin]").getAttribute("href"), ORIGIN).href).toBe(target.href);
      const browserLink = page.locator("[data-passkey-browser]");
      await expect(browserLink).toBeVisible();
      expect(await browserLink.getAttribute("href")).toBe(target.browserHref);
      await expect(browserLink).toHaveAttribute("target", "_blank");
      await expect(browserLink).toHaveAttribute("rel", /noopener/);
      expect(new URL(target.browserHref).origin).toBe("https://www.fundhub.ai");
      expect(target.browserHref).not.toMatch(/token|session|bearer|secret/i);
      const mobileBox = await page.locator(".fh-plaid-stepup").boundingBox();
      expect(mobileBox.x).toBeGreaterThanOrEqual(0);
      expect(mobileBox.x + mobileBox.width).toBeLessThanOrEqual(390);
      await page.screenshot({ path: testInfo.outputPath(`${target.kind}-mobile-390.png`), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      const desktopBox = await page.locator(".fh-plaid-stepup").boundingBox();
      expect(desktopBox.x).toBeGreaterThanOrEqual(0);
      expect(desktopBox.x + desktopBox.width).toBeLessThanOrEqual(1280);
      await page.screenshot({ path: testInfo.outputPath(`${target.kind}-desktop.png`), fullPage: true });
      expect(api.timeline.map(x => x.action)).toEqual(["status", "register_options"]);
      expect(pageErrors).toEqual([]);
    });
  }
});
