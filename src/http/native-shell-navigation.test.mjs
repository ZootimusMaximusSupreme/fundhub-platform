// Source-level regression guards for native WebKit navigation.
// These run on the normal Linux CI lane. They do not replace XCTest on Xcode
// or actual iPhone/Mac app interaction before a native release.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ios = readFileSync(new URL("../../tools/fundhub-ios/Fundhub/UI/WorkspaceWebView.swift", import.meta.url), "utf8");
const mac = readFileSync(new URL("../../tools/fundhub-mac/FundhubMac.swift", import.meta.url), "utf8");

test("iOS first-party popups load in the authenticated WebView, not Safari", () => {
  const popup = ios.split("createWebViewWith configuration: WKWebViewConfiguration,")[1];
  assert.ok(popup, "iOS new-window delegate must exist");
  assert.match(popup, /if WorkspaceNavigation\.isSignOutDestination\(url\)\s*\{\s*onWebSignOut\(\)/);
  assert.match(popup, /else if WorkspaceNavigation\.shouldOpenInWorkspace\(url\)\s*\{\s*webView\.load\(navigationAction\.request\)/);
  assert.match(popup, /else if \["https", "mailto", "tel"\]\.contains\(url\.scheme\?\.lowercased\(\) \?\? ""\)\s*\{\s*UIApplication\.shared\.open\(url\)/);
  assert.match(ios, /url\.scheme\?\.lowercased\(\) == "https" && url\.host\?\.lowercased\(\) == "fundhub\.ai"/);
});

test("iOS subframes stay within WebKit, including third-party payment frames", () => {
  assert.match(ios, /navigationAction\.targetFrame\?\.isMainFrame == false\s*\{\s*decisionHandler\(\.allow\)/);
});

test("macOS never launches unapproved external URL schemes", () => {
  assert.match(mac, /private func openAllowedExternal\(_ url: URL\)/);
  assert.match(mac, /guard \["https", "mailto", "tel"\]\.contains\(url\.scheme\?\.lowercased\(\) \?\? ""\) else \{ return \}/);
  // All system-URL opens go through the allowlisted helper.
  assert.equal((mac.match(/NSWorkspace\.shared\.open\(url\)/g) || []).length, 1);
  assert.equal((mac.match(/openAllowedExternal\(url\)/g) || []).length, 2);
});

const push = readFileSync(new URL("../../tools/fundhub-ios/Fundhub/Core/NativePush.swift", import.meta.url), "utf8");

test("native APNs requires explicit app opt-in and cannot silently revive opt-out", () => {
  assert.match(push, /guard NativePushConsent\.isEnabled\(\) else \{/);
  assert.match(push, /if server\.registered \{\s*try await api\.unregisterNativePush/);
  assert.match(push, /guard self\.bearer == bearer else \{ return \}\s*switch settings\.authorizationStatus/);
  assert.match(push, /guard let bearer, NativePushConsent\.isEnabled\(\) else \{ return \}/);
  assert.match(push, /guard self\.bearer == bearer && NativePushConsent\.isEnabled\(\) else \{/);
  assert.match(push, /NativePushConsent\.setEnabled\(true\)/);
  assert.ok((push.match(/NativePushConsent\.setEnabled\(false\)/g) || []).length >= 3);
});

const iosModels = readFileSync(new URL("../../tools/fundhub-ios/Fundhub/Core/Models.swift", import.meta.url), "utf8");

test("native iPhone setter signs into the setter desk, never the generic pipeline", () => {
  assert.match(iosModels, /case "setter": return "\/app\/setter-dashboard\.html"/);
  assert.match(iosModels, /guard principal == "staff" else \{ return "\/app\/client-portal\.html" \}/);
  const setterPage = readFileSync(new URL("../../public/app/setter-dashboard.html", import.meta.url), "utf8");
  assert.match(setterPage, /<title>Fundhub [^<]*Setter Dashboard<\/title>/);
});

test("native APNs consent is tied to the signed-in bearer, not the prior account", () => {
  assert.match(push, /static func bind\(to bearer: String/);
  assert.match(push, /SHA256\.hash\(data: Data\(bearer\.utf8\)\)/);
  assert.match(push, /defaults\.string\(forKey: sessionKey\) == fingerprint/);
  assert.match(push, /defaults\.set\(false, forKey: key\)/);
  assert.match(push, /NativePushConsent\.bind\(to: bearer\)/);
});
