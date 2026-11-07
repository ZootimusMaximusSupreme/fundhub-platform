import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const script = await readFile(new URL("../../public/funnel/device-destinations.js", import.meta.url), "utf8");
const context = vm.createContext({ window: {} });
vm.runInContext(script, context);
const policy = context.window.FHDeviceDestinations;
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36";
const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15";
const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36";

for (const [name, nav, expected] of [
  ["supported iPhone", { userAgent: iphone, platform: "iPhone", maxTouchPoints: 5 }, "iphone"],
  ["Facebook iPhone", { userAgent: iphone + " [FBAN/FBIOS;FBAV/501.0.0.0]", maxTouchPoints: 5 }, "iphone"],
  ["Facebook Android", { userAgent: android + " [FBAN/FB4A;FBAV/501.0.0.0]" }, "android"],
  ["Android Chrome", { userAgent: android, userAgentData: { platform: "Android" } }, "android"],
  ["Windows Chrome", { userAgent: windows, userAgentData: { platform: "Windows" } }, "windows"],
  ["Mac Safari", { userAgent: mac, platform: "MacIntel", maxTouchPoints: 0 }, "mac"],
  ["Mac desktop-mode iPad", { userAgent: mac, platform: "MacIntel", maxTouchPoints: 5 }, "unknown"],
  ["explicit iPad", { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", maxTouchPoints: 5 }, "unknown"],
  ["Linux", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" }, "other"],
  ["ChromeOS", { userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)" }, "other"],
  ["old iPhone cannot run app", { userAgent: iphone.replace("18_5", "16_6") }, "unknown"],
  ["unknown iPhone version", { userAgent: "iPhone AppleWebKit" }, "unknown"],
  ["conflicting UA/hints", { userAgent: iphone, userAgentData: { platform: "Windows" } }, "unknown"],
  ["conflicting Android/Mac", { userAgent: android, userAgentData: { platform: "macOS" } }, "unknown"],
  ["iPhone UA with Windows platform", { userAgent: iphone, platform: "Win32" }, "unknown"],
  ["iPhone UA with Mac platform", { userAgent: iphone, platform: "MacIntel" }, "unknown"],
  ["iPhone UA with Linux platform", { userAgent: iphone, platform: "Linux x86_64" }, "unknown"],
  ["Mac UA with Windows platform", { userAgent: mac, platform: "Win32" }, "unknown"],
  ["blank signals", {}, "unknown"],
  ["unhelpful Safari tokens", { userAgent: "Mozilla/5.0 AppleWebKit Safari" }, "unknown"],
  ["mobile false is not Apple", { userAgentData: { mobile: false } }, "unknown"]
]) {
  test(`public destination policy: ${name}`, () => assert.equal(policy.detect(nav), expected));
}

test("unreadable browser signals fail to a browser destination", () => {
  assert.equal(policy.detect({ get userAgent() { throw new Error("blocked"); } }), "unknown");
});

test("only the exact public Fundhub Portal listing is accepted", () => {
  const good = "https://apps.apple.com/us/app/fundhub-portal/id6823985032";
  assert.equal(policy.iphoneUrl({ app_store_url: good }), good);
  for (const value of ["", "javascript:alert(1)", "http://apps.apple.com/app/id6823985032", "https://apps.apple.com.evil.test/app/id6823985032", "https://apps.apple.com@evil.test/app/id6823985032", "https://apps.apple.com/app/id1234567890", good + "?token=secret", good + "#secret"]) {
    assert.equal(policy.iphoneUrl({ app_store_url: value }), "", value);
  }
  assert.equal(policy.iphoneUrl(null), "");
});

test("transfer addresses are fixed public destinations with no session/query", () => {
  assert.equal(policy.publicUrl, "https://fundhub.ai/devices.html");
  assert.equal(policy.webUrl, "https://fundhub.ai/portal-login.html");
  assert.equal(Object.hasOwn(policy, "macUrl"), false);
  assert.equal(Object.isFrozen(policy), true);
});

const entryScript = await readFile(new URL("../../public/app/device-entry.js", import.meta.url), "utf8");
async function runEntry(navigator, config, responseOk = true) {
  const calls = [];
  const host = { hidden: true, children: [], appendChild(node) { this.children.push(node); } };
  const local = vm.createContext({
    navigator,
    document: { getElementById: () => host, createElement: () => ({}) },
    window: { FHDeviceDestinations: policy, fetch: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: responseOk, json: async () => config };
    } }
  });
  vm.runInContext(entryScript, local);
  await new Promise((resolve) => setImmediate(resolve));
  return { host, calls };
}

test("portal install option stays absent for non-Apple and uncertain devices", async () => {
  for (const nav of [{ userAgent: android }, { userAgent: windows }, { userAgent: mac }, {}, { userAgent: mac, maxTouchPoints: 5 }]) {
    const { host, calls } = await runEntry(nav, { app_store_url: "https://apps.apple.com/us/app/fundhub-portal/id6823985032" });
    assert.equal(host.hidden, true);
    assert.equal(host.children.length, 0);
    assert.equal(calls.length, 0);
  }
});

test("supported iPhone gets an optional verified listing without any automatic navigation", async () => {
  const { host, calls } = await runEntry({ userAgent: iphone }, { app_store_url: "https://apps.apple.com/us/app/fundhub-portal/id6823985032" });
  assert.equal(host.hidden, false);
  assert.equal(host.children[0].href, "https://apps.apple.com/us/app/fundhub-portal/id6823985032");
  assert.equal(host.children[0].rel, "noopener noreferrer");
  assert.equal(calls[0].opts.credentials, "omit");
});

test("missing/rejected listing leaves the ordinary web form as the only path", async () => {
  for (const [config, ok] of [[{}, true], [{ app_store_url: "https://example.test" }, true], [null, false]]) {
    const { host } = await runEntry({ userAgent: iphone }, config, ok);
    assert.equal(host.hidden, true);
    assert.equal(host.children.length, 0);
  }
});
