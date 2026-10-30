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


test("iOS blocks the public marketing homepage before workspace or external navigation", () => {
  const action = ios.split("decidePolicyFor navigationAction: WKNavigationAction,")[1]
    .split("createWebViewWith configuration: WKWebViewConfiguration,")[0];
  assert.ok(action, "main-frame callback must exist");
  assert.match(action, /if WorkspaceNavigation\.isPublicMarketingHome\(url\)\s*\{\s*decisionHandler\(\.cancel\)\s*return/);
  assert.ok(action.indexOf("if WorkspaceNavigation.isPublicMarketingHome(url)") <
    action.indexOf("if navigationAction.targetFrame?.isMainFrame == false"),
    "public-home guard must also run for otherwise-allowed payment iframes");
  assert.ok(action.indexOf("if WorkspaceNavigation.isPublicMarketingHome(url)") <
    action.indexOf("if WorkspaceNavigation.shouldOpenInWorkspace(url)"),
    "public-home guard must precede normal in-app or external URL routing");
  const popup = ios.split("createWebViewWith configuration: WKWebViewConfiguration,")[1]
    .split("decidePolicyFor navigationResponse: WKNavigationResponse,")[0];
  assert.match(popup, /guard !WorkspaceNavigation\.isPublicMarketingHome\(url\) else \{ return nil \}/);
  assert.ok(popup.indexOf("guard !WorkspaceNavigation.isPublicMarketingHome(url)") <
    popup.indexOf("WorkspaceNavigation.shouldOpenInWorkspace(url)"));
});

test("iOS checks the final main-frame response URL, including HTTP redirects", () => {
  const response = ios.split("decidePolicyFor navigationResponse: WKNavigationResponse,")[1];
  assert.ok(response, "navigationResponse callback must exist");
  assert.doesNotMatch(response, /navigationResponse\.isForMainFrame/);
  assert.match(response, /navigationResponse\.response\.url/);
  assert.match(response, /WorkspaceNavigation\.isPublicMarketingHome\(finalURL\)/);
  assert.match(response, /decisionHandler\(\.cancel\)/);
  assert.match(response, /decisionHandler\(\.allow\)/);
});

test("Mac blocks marketing-home URLs in main frame, popups and redirects", () => {
  const action = mac.split("decidePolicyFor navigationAction: WKNavigationAction,")[1]
    .split("createWebViewWith configuration: WKWebViewConfiguration,")[0];
  assert.match(action, /if isPublicMarketingHome\(url\)\s*\{/);
  const blockedAction = action.split("if isPublicMarketingHome(url) {")[1]
    .split("if navigationAction.targetFrame?.isMainFrame == false")[0];
  assert.match(blockedAction, /loading = false/);
  assert.match(blockedAction, /decisionHandler\(\.cancel\)/);
  assert.ok(action.indexOf("if isPublicMarketingHome(url)") <
    action.indexOf("if navigationAction.targetFrame?.isMainFrame == false"),
    "marketing-home blocking also covers embedded frames");
  assert.ok(action.indexOf("if isPublicMarketingHome(url)") <
    action.indexOf("if isFundhub(url)"));
  const popup = mac.split("createWebViewWith configuration: WKWebViewConfiguration,")[1]
    .split("decidePolicyFor navigationResponse: WKNavigationResponse,")[0];
  assert.match(popup, /guard !isPublicMarketingHome\(url\) else \{ return nil \}/);
  assert.ok(popup.indexOf("guard !isPublicMarketingHome(url)") <
    popup.indexOf("if isFundhub(url)"));
  const response = mac.split("decidePolicyFor navigationResponse: WKNavigationResponse,")[1]
    .split("private func openAllowedExternal")[0];
  assert.ok(response.indexOf("isPublicMarketingHome(finalURL)") <
    response.indexOf("if navigationResponse.isForMainFrame"),
    "Mac checks the redirect destination before deciding whether to clear the main-frame spinner");
  assert.match(response, /loading = false/);
  assert.match(response, /navigationResponse\.response\.url/);
  assert.match(response, /isPublicMarketingHome\(finalURL\)/);
  assert.match(response, /decisionHandler\(\.cancel\)/);
  assert.match(response, /decisionHandler\(\.allow\)/);
});

test("both native apps classify only first-party public homepage paths as blocked", () => {
  for (const source of [ios, mac]) {
    const body = source.split("func isPublicMarketingHome(_ url: URL) -> Bool {")[1]
      .split("return page.isEmpty || page == \"index.html\"")[0];
    assert.ok(body, "exact same homepage classifier must exist in both wrappers");
    assert.match(body, /url\.scheme\?\.lowercased\(\) == "https"/);
    assert.match(body, /hostname == "fundhub\.ai" \|\| hostname == "www\.fundhub\.ai"/);
    assert.match(body, /url\.standardized\.path\.lowercased\(\)/);
    assert.match(body, /trimmingCharacters\(in: CharacterSet\(charactersIn: "\/"\)\)/);
    assert.doesNotMatch(body, /hasSuffix\("\.fundhub\.ai"\)/);
  }
  // Executable URL classification in iOS FundhubTests.swift includes
  // query/fragment/www/upper-case and legal dashboard/login/payment controls.
  const swiftTests = readFileSync(new URL("../../tools/fundhub-ios/FundhubTests/FundhubTests.swift", import.meta.url), "utf8");
  assert.match(swiftTests, /func testNativeWebViewBlocksPublicMarketingHomeVariants\(\)/);
  assert.match(swiftTests, /func testNativeWebViewPreservesWorkspaceAuthAndExternalDestinations\(\)/);
});

test("decoded dot segments cannot bypass either native public-home classifier", () => {
  for (const source of [ios, mac]) {
    const body = source.split("func isPublicMarketingHome(_ url: URL) -> Bool {")[1]
      .split('return page.isEmpty || page == "index.html"')[0];
    assert.ok(body);
    assert.match(body, /for segment in path\.split\(separator: "\/"\)/);
    assert.match(body, /if segment == "\." \{ continue \}/);
    assert.match(body, /if segment == "\.\."/);
    assert.match(body, /segments\.removeLast\(\)/);
    assert.match(body, /let page = segments\.joined\(separator: "\/"\)/);
  }
});


const iosApp = readFileSync(new URL("../../tools/fundhub-ios/Fundhub/App/FundhubApp.swift", import.meta.url), "utf8");
test("native iPhone client can reach explicit APNs consent without leaving the portal", () => {
  const home = iosApp.split("private struct HomeView: View {")[1].split("private struct BrandMark: View {")[0];
  assert.match(home, /identity\.principal == "client"/);
  assert.match(home, /accessibilityIdentifier\("nativeNotificationSettings"\)/);
  assert.match(home, /showingNotifications = true/);
  assert.match(home, /\.sheet\(isPresented: \$showingNotifications\)/);
  assert.match(home, /NativePushCard\(\)/);
  assert.match(home, /WorkspaceWebView\(/);
  assert.ok(home.indexOf('identity.principal == "client"') < home.indexOf('accessibilityIdentifier("nativeNotificationSettings")'));
});
test("native push UI never promises delivery just from token registration", () => {
  assert.match(push, /Delivery is not guaranteed/);
  assert.match(push, /guard server\.configured else/);
  assert.match(push, /NativePushConsent\.setEnabled\(true\)/);
});
test("Mac Home revokes existing sessions before clearing persistent WebKit data and history", () => {
  const home = mac.split("func goHome() async {")[1].split("func webView(_ webView: WKWebView, didStartProvisionalNavigation")[0];
  assert.ok(home);
  assert.match(home, /await revokeCurrentSession\(\)/);
  assert.match(home, /await WKWebsiteDataStore\.default\(\)\.removeData\(/);
  assert.ok(home.indexOf("await revokeCurrentSession()") < home.indexOf("await WKWebsiteDataStore.default().removeData("));
  assert.ok(home.indexOf("await WKWebsiteDataStore.default().removeData(") < home.indexOf("currentView = nil"));
  assert.ok(home.indexOf("currentView = nil") < home.indexOf("route = nil"));
  assert.match(home, /httpCookieStore\.getAllCookies/);
  assert.match(home, /window\.localStorage\.getItem\('fh_token'\)/);
  assert.match(home, /cookie\.name == "fundhub_session"/);
  assert.match(home, /cookieDomain == "fundhub\.ai"/);
  assert.match(home, /URL\(string: "https:\/\/fundhub\.ai\/api\/auth\/logout"\)!/);
  assert.match(home, /request\.httpMethod = "POST"/);
  assert.match(home, /forHTTPHeaderField: "Authorization"/);
  assert.match(mac, /Task \{ await browser\.goHome\(\) \}/);
  assert.match(mac, /Home and sign out/);
  assert.match(mac, /macLogoutNotice/);
});
