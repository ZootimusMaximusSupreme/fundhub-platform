import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import {
  DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_METADATA,
  DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_PROOF_CASES,
  DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_ROW_KEYS,
} from "./display-contracts-teams-social-1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PUBLIC = path.join(ROOT, "public");
const TYPES = new Map([[".css", "text/css"], [".html", "text/html"], [".js", "text/javascript"], [".json", "application/json"], [".svg", "image/svg+xml"], [".png", "image/png"]]);

function staticFile(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const candidates = !clean ? [path.join(PUBLIC, "index.html")] : [path.join(PUBLIC, clean), path.join(PUBLIC, clean, "index.html")];
  return candidates.find((candidate) => candidate.startsWith(PUBLIC) && fs.existsSync(candidate));
}

async function startServer() {
  const server = http.createServer((req, res) => {
    const file = staticFile(new URL(req.url, "http://127.0.0.1").pathname);
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": `${TYPES.get(path.extname(file)) || "application/octet-stream"}; charset=utf-8` });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function proof(control) {
  const found = DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_PROOF_CASES.find((entry) => entry.control === control);
  assert.ok(found, `proof case is registered: ${control}`);
  return found;
}

test("Teams/Social controls show their rendered result against controlled APIs", { timeout: 90_000 }, async (t) => {
  assert.equal(DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_METADATA.provedCount, DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_ROW_KEYS.length);
  assert.equal(new Set(DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_ROW_KEYS).size, DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_ROW_KEYS.length);
  const source = JSON.parse(fs.readFileSync(path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/desks-f.json"), "utf8"));
  for (const item of DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_PROOF_CASES) {
    assert.equal(source.filter((row) => row.surface === item.surface && row.control === item.control).length, 1);
  }

  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await closeServer(server);
  });

  const staff = [
    { id: "staff-owner-1", name: "Alex Owner", email: "alex@example.test", role: "owner", status: "active", employee_code: "A-01", phone: "5550101", start_date: "2025-01-02", notify_booked_call_sms: false, monitoring_consent_at: null, open_shift: 0, monitor_events_today: 4 },
    { id: "staff-closer-2", name: "Sam Closer", email: "sam@example.test", role: "closer", status: "invited", employee_code: "C-02", phone: "5550102", start_date: "2025-02-03", notify_booked_call_sms: true, monitoring_consent_at: "2026-09-01T00:00:00Z", open_shift: 1, monitor_events_today: 2 },
  ];
  const staffWrites = [];
  const staffPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: "America/Phoenix" });
  await staffPage.addInitScript(() => localStorage.setItem("fh_token", "teams-proof-token"));
  await staffPage.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (request.method() === "GET" && pathname === "/api/auth/session") return json(route, { ok: true, principal: "staff", staff: { id: "staff-owner-1", email: "alex@example.test", role: "owner" } });
    if (request.method() === "GET" && pathname === "/api/read/staff") return json(route, { ok: true, items: staff, hiddenCount: 3 });
    if (request.method() === "GET" && pathname === "/api/shifts") return json(route, { ok: true, shift: null });
    if (request.method() === "GET" && pathname === "/api/read/contracts") return json(route, { ok: true, items: [] });
    if (request.method() === "GET" && pathname === "/api/staff/telemetry") return json(route, {
      ok: true,
      staff: { monitoring_on: true, monitoring_consent_at: "2026-09-01T00:00:00Z" },
      hours: { payable_hours: 6.25 },
      activity: { avg_overall: 82, activity_samples: 3, screenshot_samples: 1, recent: [{ kind: "monitor_activity", created_at: "2026-10-12T10:00:00Z", detail: { overall: 82 } }] },
      shifts: [{ started_at: "2026-10-12T08:00:00Z", ended_at: null, open: true }],
    });
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      staffWrites.push({ pathname, body });
      if (pathname === "/api/shifts") return json(route, { ok: true, shift: { id: "shift-proof", started_at: "2026-10-12T12:00:00Z" } });
      if (pathname === "/api/staff/monitoring-consent") {
        return json(route, { ok: true, staff: { monitoring_consent_at: body.action === "grant" ? "2026-10-12T12:00:00Z" : null, monitoring_on: body.action === "grant" } });
      }
    }
    return json(route, { ok: true, items: [] });
  });

  await staffPage.goto(`${origin}/app/staff-teams.html`);
  await staffPage.locator("#rosterBody").getByText("Alex Owner", { exact: true }).waitFor();
  const staffResults = new Set();
  assert.equal(await staffPage.locator("#hiddenLine").innerText(), "3 people are hidden from this list (owner and seeded test logins).");
  staffResults.add(proof("'Hidden from this list: N people (owner and seeded test logins)' line").recipe);
  assert.equal(await staffPage.locator("#kHead").innerText(), "2");
  assert.equal(await staffPage.locator("#kConsent").innerText(), "1/2");
  assert.equal(await staffPage.locator("#kPending").innerText(), "1");
  assert.equal(await staffPage.locator("#onShiftTxt").innerText(), "1 on shift");
  staffResults.add(proof("Stat tiles: HEADCOUNT, ON SHIFT, CONSENT, PENDING and the 'N on shift' chip").recipe);
  const rosterText = await staffPage.locator("#rosterBody").innerText();
  assert.match(rosterText, /Alex Owner[\s\S]*alex@example\.test[\s\S]*Owner[\s\S]*Missing[\s\S]*Out[\s\S]*Active/);
  assert.match(rosterText, /Sam Closer[\s\S]*sam@example\.test[\s\S]*Closer[\s\S]*On file[\s\S]*In · now[\s\S]*Invited/);
  staffResults.add(proof("Page open: roster (name, email, role, status, consent, open shift, today's monitor events, hidden-seed count)").recipe);

  await staffPage.locator("#roleFilter").selectOption({ label: "Closer" });
  assert.equal(await staffPage.locator("#rosterBody").innerText().then((s) => s.includes("Sam Closer")), true);
  assert.equal(await staffPage.locator("#rosterBody").innerText().then((s) => s.includes("Alex Owner")), false);
  await staffPage.locator("#roleFilter").selectOption("");
  await staffPage.locator("#qFilter").fill("alex@example.test");
  assert.equal(await staffPage.locator("#rosterBody").innerText().then((s) => s.includes("Alex Owner")), true);
  assert.equal(await staffPage.locator("#rosterBody").innerText().then((s) => s.includes("Sam Closer")), false);
  staffResults.add(proof("Roster filters: role select and name/code box").recipe);

  await staffPage.locator('#rosterBody tr[data-id="staff-owner-1"]').click();
  assert.equal(await staffPage.locator("#editor").evaluate((e) => e.classList.contains("open")), true);
  assert.equal(await staffPage.locator("#ed_first").inputValue(), "Alex");
  assert.equal(await staffPage.locator("#ed_last").inputValue(), "Owner");
  assert.equal(await staffPage.locator("#ed_email").inputValue(), "alex@example.test");
  await staffPage.locator("#ed_phone").fill("5550199");
  await staffPage.locator("#ed_start").fill("2026-03-04");
  await staffPage.locator("#ed_role").selectOption({ label: "Admin" });
  assert.equal(await staffPage.locator("#ed_phone").inputValue(), "5550199");
  assert.equal(await staffPage.locator("#ed_start").inputValue(), "2026-03-04");
  assert.equal(await staffPage.locator("#ed_role").inputValue(), "Admin");
  staffResults.add(proof("Roster row click (opens that person in the editor)").recipe);
  await staffPage.locator("#ed_consent").click();
  assert.equal(await staffPage.locator("#ed_consent").evaluate((e) => e.classList.contains("on")), true);
  staffResults.add(proof("Editor switch: 'Monitoring consent on file' (owner only)").recipe);
  await staffPage.locator("#edCancel").click();
  assert.equal(await staffPage.locator("#editor").evaluate((e) => e.classList.contains("open")), false);
  await staffPage.locator('#rosterBody tr[data-id="staff-owner-1"]').click();
  await staffPage.locator("#edClose").click();
  assert.equal(await staffPage.locator("#editor").evaluate((e) => e.classList.contains("open")), false);
  await staffPage.locator('#rosterBody tr[data-id="staff-owner-1"]').click();
  await staffPage.locator("#scrim").click({ position: { x: 500, y: 500 } });
  assert.equal(await staffPage.locator("#editor").evaluate((e) => e.classList.contains("open")), false);
  staffResults.add(proof("Editor 'Cancel', close X, click outside").recipe);

  await staffPage.getByRole("button", { name: "Add person", exact: true }).click();
  assert.equal(await staffPage.locator("#edTitle").innerText(), "New person");
  assert.equal(await staffPage.locator("#ed_code").inputValue(), "—");
  assert.equal(await staffPage.locator("#ed_first").inputValue(), "");
  staffResults.add(proof("'+ Add person' (opens the empty editor; 'No employee code is issued by this system')").recipe);
  await staffPage.locator("#ed_first").fill("Taylor");
  await staffPage.locator("#ed_last").fill("Proof");
  await staffPage.locator("#ed_email").fill("taylor@example.test");
  await staffPage.locator("#ed_role").selectOption({ label: "Admin" });
  assert.equal(await staffPage.locator("#ed_first").inputValue(), "Taylor");
  assert.equal(await staffPage.locator("#ed_role").inputValue(), "Admin");
  assert.equal(await staffPage.locator("#ed_start").isEditable(), false);
  staffResults.add(proof("Editor fields: first name, last name, email, phone, role select, start date").recipe);
  await staffPage.locator("#edCancel").click();

  await staffPage.locator('[data-tab="perms"]').click();
  for (const label of ["People", "Role access", "Time & consent", "Activity"]) {
    assert.equal(await staffPage.getByRole("button", { name: label, exact: true }).isVisible(), true);
  }
  assert.match(await staffPage.locator("#tab-perms").innerText(), /The permission list is not available here\. This page does not change role rules\./);
  assert.match(await staffPage.locator("#tab-perms").innerText(), /The server checks what that role can do on every action\./);
  staffResults.add(proof("Tabs: Roster, Permissions, Clock & consent, Telemetry").recipe);
  staffResults.add(proof("Permissions tab (static copy: says no permission list can be shown)").recipe);
  await staffPage.locator('[data-tab="clock"]').click();
  const clockText = await staffPage.locator("#clockBody").innerText();
  assert.match(clockText, /Alex Owner[\s\S]*you[\s\S]*Record form[\s\S]*Clock in/i);
  assert.match(clockText, /Sam Closer[\s\S]*ON FILE[\s\S]*Revoke/i);
  assert.match(clockText, /4 mon/);
  assert.match(clockText, /2 mon/);
  staffResults.add(proof("Page open: who am I (marks the 'you' row, owner-only consent buttons)").recipe);
  staffResults.add(proof("Page open: my open shift (so 'Clock in / Clock out' shows the true state)").recipe);
  const confirmConsent = async (staffId, action, phrase) => {
    const consentResponse = staffPage.waitForResponse((response) => {
      const request = response.request();
      if (request.method() !== "POST" || new URL(response.url()).pathname !== "/api/staff/monitoring-consent") return false;
      const body = request.postDataJSON();
      return body.staff_id === staffId && body.action === action;
    });
    const dialogPromise = new Promise((resolve) => staffPage.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await dialog.accept();
    }));
    await staffPage.locator(`[data-consent="${staffId}"]`).click();
    assert.match(await dialogPromise, phrase);
    assert.equal((await consentResponse).status(), 200);
    await staffPage.locator(`[data-consent="${staffId}"][data-on="${action === "grant" ? "1" : "0"}"]`).waitFor();
    assert.deepEqual(staffWrites.at(-1), { pathname: "/api/staff/monitoring-consent", body: { staff_id: staffId, action } });
  };
  await confirmConsent("staff-owner-1", "grant", /signed monitoring consent form is on file/);
  await confirmConsent("staff-closer-2", "revoke", /Revoke monitoring consent/);
  staffResults.add(proof("Clock tab 'Record form' / 'Revoke' monitoring consent (owner only, asks first)").recipe);

  await staffPage.locator('[data-tab="telemetry"]').click();
  await staffPage.locator("#teleStaff").selectOption("staff-closer-2");
  await staffPage.getByText("6.25h", { exact: true }).waitFor();
  assert.equal(await staffPage.locator("#teleConsent").innerText(), "On");
  assert.equal(await staffPage.locator("#teleAvg").innerText(), "82%");
  assert.match(await staffPage.locator("#teleEvents").innerText(), /overall 82%/);
  assert.match(await staffPage.locator("#teleShifts").innerText(), /OPEN/i);
  const refreshResponse = staffPage.waitForResponse((response) => response.url().includes("/api/staff/telemetry?staff_id=staff-closer-2"));
  await staffPage.locator("#teleRefresh").click();
  await refreshResponse;
  staffResults.add(proof("Telemetry tab: person select, Refresh (consent, payable hours, activity average, shifts, monitor events)").recipe);

  const partnerA = "partner-proof-a";
  const partnerB = "partner-proof-b";
  const channel = { id: "channel-proof-1", partner_id: partnerA, channel: "facebook", handle: "@proof", external_account_id: "account-proof", connection_state: "active", has_access_token: true, has_refresh_token: false, timezone: "UTC", scopes: ["pages_manage_posts"], best_times: { mon: ["09:30"] } };
  const channel2 = { id: "channel-proof-2", partner_id: partnerA, channel: "linkedin", handle: "Proof Org", external_account_id: "org-proof", connection_state: "active", has_access_token: true, has_refresh_token: false, timezone: "America/Los_Angeles", scopes: ["w_member_social"], best_times: { tue: ["14:00"] } };
  let posts = [
    { id: "post-queued", partner_id: partnerA, channel_id: channel.id, caption: "Waiting caption", offer_type: "funding", status: "queued", scheduled_for: "2030-01-01T09:30:00Z", created_at: "2026-10-10T00:00:00Z", attempt: 0 },
    { id: "post-blocked", partner_id: partnerA, channel_id: channel.id, caption: "Blocked caption", offer_type: "credit_cards", status: "blocked", blocked_reasons: [{ rule_set: "claims", rule: "claim" }], created_at: "2026-10-10T00:00:00Z" },
    { id: "post-failed", social_post_id: "post-failed", partner_id: partnerA, channel_id: channel.id, caption: "Failed caption", offer_type: "funding", status: "failed", scheduled_for: "2026-10-11T09:30:00Z", created_at: "2026-10-11T00:00:00Z", attempt: 3, last_error: "Provider refused the post" },
    { id: "post-posted", social_post_id: "post-posted", partner_id: partnerA, channel_id: channel.id, caption: "Posted caption", offer_type: "funding", status: "posted", scheduled_for: "2026-10-09T09:30:00Z", posted_at: "2026-10-09T09:31:00Z", external_post_id: "facebook-reference-123", created_at: "2026-10-09T00:00:00Z", attempt: 1 },
  ];
  const socialReads = [];
  const socialWrites = [];
  const socialErrors = [];
  const socialPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "America/Phoenix" });
  socialPage.on("pageerror", (error) => socialErrors.push(error.message));
  await socialPage.addInitScript(() => localStorage.setItem("fh_token", "social-proof-token"));
  await socialPage.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (request.method() === "GET") {
      socialReads.push({ pathname, search: url.search });
      if (pathname === "/api/auth/session") return json(route, { ok: true, principal: "staff", staff: { id: "staff-owner-1", email: "alex@example.test", role: "owner" } });
      if (pathname === "/api/read/partners") return json(route, { ok: true, items: [{ id: partnerA, name: "Proof Partner A" }, { id: partnerB, name: "Proof Partner B" }] });
      if (pathname === "/api/social/channels") return json(route, { ok: true, items: [{ ...channel, partner_id: url.searchParams.get("partner_id") }, { ...channel2, partner_id: url.searchParams.get("partner_id") }] });
      if (pathname === "/api/social/settings") return json(route, { ok: true, settings: { stored: true, approve_before_launch: true, weekly_asset_target: 4, max_concurrent_jobs: 2, autopilot_enabled: false, launch_enabled: false } });
      if (pathname === "/api/social/posts") return json(route, { ok: true, items: posts, tasks: [{ id: "task-social-failed", task_key: "social_post_failed", title: "A scheduled Facebook post failed after 3 attempts", detail: "Provider refused the post", severity: "warning", resolved_at: null, created_at: "2026-10-11T10:00:00Z", updated_at: "2026-10-11T10:00:00Z" }] });
      if (pathname === "/api/partner-marketing/usage") return json(route, { ok: true, enabled: true, remaining: 7 });
      if (pathname === "/api/campaigns/action-log") return json(route, { ok: true, items: [{ id: "audit-proof", partner_id: partnerA, actor: "staff", rule_key: "social_post", reason: "Proof attempt", target_id: "post-queued", before: {}, after: {}, created_at: "2026-10-11T00:00:00Z", revertible: false }] });
      if (pathname === "/api/social/oauth") return json(route, { ok: false, error: "not_configured" });
    }
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      socialWrites.push({ pathname, body });
      if (pathname === "/api/social/generate") {
        const generated = ["One", "Two", "Three"].map((word, i) => ({ id: `post-generated-${i + 1}`, partner_id: partnerA, channel_id: channel.id, caption: `${word} generated funding post`, offer_type: "funding", status: "draft", scheduled_for: null, created_at: "2026-10-12T00:00:00Z", attempt: 0 }));
        posts = [...posts, ...generated];
        return json(route, { ok: true, items: generated });
      }
      if (pathname === "/api/social/schedule") return json(route, { ok: true, state: "queued" });
      if (pathname === "/api/social/publish") return json(route, { ok: true, results: [{ ok: true }, { ok: false }] });
    }
    return json(route, { ok: true, items: [] });
  });

  await socialPage.goto(`${origin}/app/social-studio.html?partner_id=${partnerA}`);
  await socialPage.waitForFunction(() => document.querySelector("#partnerSel option")?.textContent === "Proof Partner A");
  assert.deepEqual(await socialPage.locator("#partnerSel option").allTextContents(), ["Proof Partner A", "Proof Partner B"]);
  assert.deepEqual(await socialPage.locator("#partnerSel option").allTextContents(), ["Proof Partner A", "Proof Partner B"]);
  await socialPage.getByText("@proof", { exact: true }).waitFor();
  await socialPage.getByText("saved setting", { exact: true }).waitFor();
  await socialPage.waitForFunction(() => ["oauthFb", "oauthIg", "oauthLi"].every((id) => document.getElementById(id)?.disabled));
  const oauthReads = socialReads.filter((entry) => entry.pathname === "/api/social/oauth");
  assert.equal(oauthReads.length, 3, "the three probes run once, after the partner is known");
  assert.deepEqual(oauthReads.map((entry) => new URLSearchParams(entry.search).get("partner_id")), [partnerA, partnerA, partnerA]);
  assert.deepEqual(oauthReads.map((entry) => new URLSearchParams(entry.search).get("channel")).sort(), ["facebook", "instagram", "linkedin"]);
  const hasRead = (pathname) => socialReads.some((entry) => entry.pathname === pathname);
  for (const endpoint of ["/api/read/partners", "/api/social/channels", "/api/social/settings", "/api/social/posts", "/api/partner-marketing/usage", "/api/campaigns/action-log"]) assert.equal(hasRead(endpoint), true, `${endpoint} was requested`);
  const socialResults = new Set();
  socialResults.add(proof("Page open: partner list for the picker").recipe);
  assert.match(await socialPage.locator("#tblQueued").innerText(), /Waiting caption/);
  assert.equal(await socialPage.locator("#ssSuiteTxt").innerText(), "Writing on · 7 left");
  assert.match(await socialPage.locator("#btBody").innerText(), /09:30/);
  assert.match(await socialPage.locator("#chGrid").innerText(), /Facebook[\s\S]*@proof[\s\S]*account-proof/);
  assert.match(await socialPage.locator("#ghGrid").innerText(), /TikTok[\s\S]*cannot be used/i);
  assert.match(await socialPage.locator("#approvalBody").innerText(), /Approval required before sending[\s\S]*saved setting[\s\S]*Held posts do not send[\s\S]*Only the owner or an admin[\s\S]*Credit repair always needs approval/i);
  await socialPage.locator('[data-pane="audit"]').click();
  assert.match(await socialPage.locator("#tblAudit").innerText(), /Proof attempt/);
  socialResults.add(proof("Page open per partner: connected accounts, saved approval setting, post queue, writing allowance, send history (5 reads)").recipe);
  socialResults.add(proof("'Best times to post': account select and the saved posting times (UTC)").recipe);
  await socialPage.locator("#btChannel").selectOption(channel2.id);
  assert.equal(await socialPage.locator("#btChannel").inputValue(), channel2.id);
  assert.match(await socialPage.locator("#btBody").innerText(), /America\/Los_Angeles[\s\S]*14:00:00 UTC[\s\S]*14:00/);

  await socialPage.locator("#partnerSel").selectOption("1");
  await socialPage.waitForURL(new RegExp(`partner_id=${partnerB}`));
  assert.equal(new URL(socialPage.url()).searchParams.get("partner_id"), partnerB);
  socialResults.add(proof("Partner picker (select): reloads the page scoped to that partner (?partner_id=)").recipe);

  await socialPage.locator("#partnerSel").selectOption("0");
  await socialPage.waitForURL(new RegExp(`partner_id=${partnerA}`));
  for (const [key, phrase] of [["channels", "2 connected · 2 can post"], ["queued", "1 unsent · 0 past due"], ["blocked", "1 blocked · 1 reason"], ["failed", "1 failed after 3 tries"], ["posted", "1 sent. Likes, views, clicks and shares are not tracked."]]) {
    await socialPage.locator(`button.stat[data-k="${key}"]`).click();
    assert.equal(await socialPage.locator(`button.stat[data-k="${key}"]`).getAttribute("aria-pressed"), "true");
    assert.match(await socialPage.locator("#derivBody").innerText(), new RegExp(phrase));
  }
  socialResults.add(proof("Five tiles (Connected accounts, Waiting to post, Needs a rewrite, Could not be sent, Sent): switch the explanation strip").recipe);

  await socialPage.locator("#composeTop").click();
  assert.equal(await socialPage.evaluate(() => document.activeElement?.id), "cCaption");
  assert.equal(await socialPage.locator("#composer").evaluate((e) => e.getBoundingClientRect().top < innerHeight), true);
  socialResults.add(proof("'Write a post' button (top bar): scrolls to the writer").recipe);
  await socialPage.locator("#cChannel").selectOption(channel.id);
  assert.equal(await socialPage.locator("#cChannel").inputValue(), channel.id);
  await socialPage.locator("#cChannel").selectOption(channel2.id);
  assert.equal(await socialPage.locator("#cChannel").inputValue(), channel2.id);
  await socialPage.locator("#cChannel").selectOption(channel.id);
  await socialPage.locator("#cOffer").selectOption("credit_cards");
  assert.equal(await socialPage.locator("#cOffer").inputValue(), "credit_cards");
  await socialPage.locator("#cOffer").selectOption("credit_repair");
  assert.equal(await socialPage.locator("#cOffer").inputValue(), "credit_repair");
  await socialPage.locator("#cOffer").selectOption("funding");
  assert.equal(await socialPage.locator("#cOffer").inputValue(), "funding");
  await socialPage.locator("#cOffer").selectOption("credit_cards");
  await socialPage.locator("#cCaption").fill("Proof caption typed into the writer.");
  assert.equal(await socialPage.locator("#capCount").innerText(), "36 letters");
  socialResults.add(proof("Writer: account select, topic select (Funding / Credit cards / Credit repair), 'What the post says' box").recipe);
  assert.equal(await socialPage.locator("#cAsset").isDisabled(), true);
  socialResults.add(proof("Writer: picture/video select (disabled: attaching a picture is not built)").recipe);

  await socialPage.locator("#clearComposer").click();
  assert.equal(await socialPage.locator("#cCaption").inputValue(), "");
  assert.equal(await socialPage.locator("#cOffer").inputValue(), "");
  assert.equal(await socialPage.locator("#cWhen").inputValue(), "");
  socialResults.add(proof("'Clear the form'").recipe);

  await socialPage.locator("#ssGenBtn").click();
  await socialPage.getByText("Wrote 3 posts. They are in the waiting list below.", { exact: true }).waitFor();
  assert.deepEqual(socialWrites.at(-1), { pathname: "/api/social/generate", body: { partner_id: partnerA, count: 3, offer_type: "funding" } });
  await socialPage.locator("#tblQueued").getByText("One generated funding post", { exact: true }).first().waitFor();
  socialResults.add(proof("'Write 3 posts for me': asks the writing model for 3 funding posts, screens them, lands them in the waiting list").recipe);

  await socialPage.locator("#cChannel").selectOption(channel.id);
  await socialPage.locator("#cOffer").selectOption("funding");
  await socialPage.locator("#cCaption").fill("Rendered queue action proof.");
  await socialPage.locator("#cWhen").fill("2030-01-02T09:15");
  await socialPage.locator("#queueBtn").click();
  await socialPage.getByText("Saved. Copy check says: queued. Use \"Send anything due now\" to send everything that is already past its time.", { exact: true }).waitFor();
  assert.deepEqual(socialWrites.at(-1), { pathname: "/api/social/schedule", body: { partner_id: partnerA, channel_id: channel.id, caption: "Rendered queue action proof.", offer_type: "funding", asset_id: null, scheduled_for: "2030-01-02T09:15:00.000Z" } });
  socialResults.add(proof("'Queue post': screens the words on the server, saves the post as waiting (or blocked / held) with its send time").recipe);

  const publishDialogPromise = new Promise((resolve) => socialPage.once("dialog", async (dialog) => {
    resolve(dialog.message());
    await dialog.accept();
  }));
  await socialPage.locator("#publishDueBtn").click();
  assert.match(await publishDialogPromise, /already due[\s\S]*in public[\s\S]*cannot be undone/);
  await socialPage.getByText("Tried 2 posts · 1 went out.", { exact: true }).waitFor();
  assert.deepEqual(socialWrites.at(-1), { pathname: "/api/social/publish", body: { partner_id: partnerA } });
  socialResults.add(proof("'Send anything due now': publishes every due waiting post for the partner to its connected accounts, in public (asks first)").recipe);

  await socialPage.locator('[data-pane="queued"]').click();
  assert.equal(await socialPage.locator("#pane-queued").evaluate((e) => e.classList.contains("on")), true);
  assert.match(await socialPage.locator("#tblQueued").innerText(), /One generated funding post/);
  socialResults.add(proof("Tab 'Waiting' (draft, queued, scheduled, awaiting approval)").recipe);
  await socialPage.locator('[data-pane="blocked"]').click();
  assert.equal(await socialPage.locator("#pane-blocked").evaluate((e) => e.classList.contains("on")), true);
  assert.match(await socialPage.locator("#tblBlocked").innerText(), /Blocked caption/);
  socialResults.add(proof("Tab 'Needs a rewrite' (blocked by the copy check or refused by a person)").recipe);
  await socialPage.locator('[data-pane="failed"]').click();
  assert.match(await socialPage.locator("#tblFailed").innerText(), /Failed caption[\s\S]*3[\s\S]*gave up after 3[\s\S]*Provider refused the post/);
  assert.match(await socialPage.locator("#taskStrip").innerText(), /JOB TO FIX[\s\S]*A scheduled Facebook post failed after 3 attempts[\s\S]*One job covers all 1 failed post[\s\S]*No single post is linked/i);
  await socialPage.locator('[data-pane="posted"]').click();
  assert.match(await socialPage.locator("#tblPosted").innerText(), /Posted caption[\s\S]*facebook-reference-123/);
  await socialPage.locator('[data-pane="audit"]').click();
  assert.match(await socialPage.locator("#tblAudit").innerText(), /Proof attempt/);
  socialResults.add(proof("Tab 'Send history' (one line per attempt, written before the attempt)").recipe);

  await socialPage.locator('[data-pane="queued"]').click();
  const queuedRow = socialPage.locator('tr[data-row="post-queued"]');
  await queuedRow.press("Enter");
  const queuedDetail = socialPage.locator('tr[data-det="post-queued"]');
  assert.equal(await queuedDetail.isVisible(), true);
  await queuedDetail.getByRole("button", { name: "See the details" }).click();
  assert.equal(await socialPage.locator("#drawer").evaluate((node) => node.classList.contains("on")), true);
  assert.match(await socialPage.locator("#drawerBody").innerText(), /Not checked yet[\s\S]*none recorded/i);
  await socialPage.locator("#drawerClose").click();
  assert.equal(await socialPage.locator("#drawer").evaluate((node) => node.classList.contains("on")), false);
  await queuedDetail.getByRole("button", { name: "See the details" }).click();
  await socialPage.locator("#scrim").dispatchEvent("click");
  assert.equal(await socialPage.locator("#drawer").evaluate((node) => node.classList.contains("on")), false);
  await queuedDetail.getByRole("button", { name: "See the details" }).click();
  await socialPage.keyboard.press("Escape");
  assert.equal(await socialPage.locator("#drawer").evaluate((node) => node.classList.contains("on")), false);
  assert.deepEqual(socialErrors, []);
  await socialPage.locator("#fOffer").selectOption("funding");
  assert.match(await socialPage.locator("#fCount").innerText(), /posts match your filter/i);
  await socialPage.locator("#fChannel").selectOption(channel.id);
  assert.equal(await socialPage.locator("#fChannel").inputValue(), channel.id);
  socialResults.add(proof("Filters: account select and topic select, and the 'N shown' count").recipe);
  assert.equal(staffResults.size, DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_PROOF_CASES.filter((item) => item.surface === "staff-teams.html" && staffResults.has(item.recipe)).length);
  assert.equal(socialResults.size, DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_PROOF_CASES.filter((item) => item.surface === "social-studio.html" && socialResults.has(item.recipe)).length);
  assert.equal(staffResults.size + socialResults.size, DISPLAY_CONTRACTS_TEAMS_SOCIAL_1_METADATA.provedCount);
});
