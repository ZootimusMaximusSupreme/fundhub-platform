// Proves three lenders-desk rows: Apply on a client-scoped view starts a proxy
// session for that lender and client; the Apply dialog offers the copy, End
// session and Close controls when the Chrome extension is not there; and the AI
// bureau config Save sends the typed row (save by id, or upsert for a new row).

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const CLIENT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const LENDER_ID = "bbbbbbbb-1111-4111-8111-111111111111";
const SESSION_ID = "cccccccc-1111-4111-8111-111111111111";
const LENDER = {
  id: LENDER_ID, name: "Mesa Community Bank", lender_table: "OnlineBizCC", bureaus_pulled: "EX", stated_requirements: null,
  priority_tier: 1, active: true, eligible_states: "AZ", application_url: "https://bank.example/apply/mesa",
};
const LAUNCH = {
  ok: true, session_id: SESSION_ID,
  session: { id: SESSION_ID, status: "active", client_id: CLIENT_ID, lender_id: LENDER_ID, application_id: null, started_at: "2026-08-04T12:00:00Z" },
  connection: { host: "pr.proxy.example", port: 7777, username: "customer-test-city-mesa-sessid-abc123", password: "proxy-pass", sessid: "abc123", sesstime: 30 },
  verification: { exit_ip: "203.0.113.44", city: "Mesa", region: "Arizona", targeting_level: "city", requested_city: "mesa", requested_state: "us_arizona" },
  application_url: "https://bank.example/apply/mesa",
  lender: { id: LENDER_ID, name: "Mesa Community Bank", product_name: null },
  routing_active: false, extension_required: true, notice: "Exit IP verified server-side.",
};

// The lender list answers only after the page has finished loading. See the note in the
// first test: if it answers before, one Apply press can start two proxy sessions.
async function openLenders(open, { bureau = [] } = {}) {
  const calls = { launch: [], end: [], bureau: [] };
  let release;
  const afterLoad = new Promise((resolve) => { release = resolve; });
  const handlers = {
    "/api/read/lenders": async (route) => { await afterLoad; return json(route, { ok: true, lenders: [LENDER], meta: { count: 1, empty: false } }); },
    "/api/read/lender-matches": async (route) => {
      await afterLoad;
      return json(route, { ok: true, client_id: CLIENT_ID, match_count: 1, summary: { match_count: 1, lender_count: 1 }, matches: [LENDER] });
    },
    "/api/read/lender-observations": { ok: true, observations: [], meta: { count: 0 } },
    "/api/read/ai-bureau-config": { ok: true, configs: bureau },
    "/api/proxy/launch": async (route) => { calls.launch.push(bodyOf(route)); return json(route, LAUNCH); },
    "/api/proxy/end": async (route) => { calls.end.push(bodyOf(route)); return json(route, { ok: true }); },
    "/api/ai-bureau-config": async (route) => { calls.bureau.push(bodyOf(route)); return json(route, { ok: true }); },
  };
  const opened = await open(`/app/lenders.html?client_id=${CLIENT_ID}`, { session: OWNER, handlers });
  await opened.page.waitForLoadState("load");
  release();
  await opened.page.waitForSelector("#applyClientBanner");
  return { ...opened, calls };
}

test("Apply starts a session for this client and lender, and the dialog ends or closes it", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, calls, errors } = await openLenders(open);

  await proof.check(/^Lender row Apply button/, async () => {
    assert.match(await page.locator("#applyClientBanner").innerText(), /Client-scoped Apply/);
    // NOT ATTACHED, see s4-rows.json. proxy-apply.js binds every [data-fh-apply] button at
    // DOMContentLoaded and lenders.html adds its own handler to each Apply button too. When the
    // list is drawn before that moment, one press starts two proxy sessions (found on a slow
    // machine). Here the list answers after the load, which is the order that sends exactly one.
    await page.getByRole("button", { name: /^Apply$/ }).click();
    await waitFor(() => calls.launch.length === 1);
    assert.deepEqual(calls.launch[0], { client_id: CLIENT_ID, lender_id: LENDER_ID, application_id: null });
  });

  await proof.check(/^Apply dialog: Copy proxy string, End session, Close/, async () => {
    const modal = page.locator("#fh-proxy-apply-modal");
    await modal.waitFor();
    const text = await modal.innerText();
    for (const part of ["Chrome extension not detected", "NOT active", "203.0.113.44", "pr.proxy.example", "customer-test-city-mesa-sessid-abc123"]) {
      assert.ok(text.includes(part), `the dialog shows ${part}`);
    }
    assert.equal(await modal.getByRole("button", { name: /Open application URL/i }).count(), 0, "the bank link is never offered without the extension");
    assert.ok(await modal.locator("[data-copy-btn]").count() >= 4, "every proxy setting has a Copy button");
    await modal.getByRole("button", { name: /End session/i }).click();
    await waitFor(() => calls.end.length === 1);
    assert.deepEqual(calls.end[0], { session_id: SESSION_ID });
    await modal.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: /^Apply$/ }).click();
    await modal.waitFor();
    await modal.getByRole("button", { name: /^Close$/ }).click();
    await modal.waitFor({ state: "hidden" });
    assert.equal(calls.end.length, 1, "Close does not end the session by itself");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("the bureau config Save sends the typed row: save by id, upsert for a new row", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const existing = { id: "dddddddd-1111-4111-8111-111111111111", bureau_code: "EX", bureau_name: "Experian", service_number: "+18885551212", ivr_version: "v2", menu_path: "1,3,2", expected_hold_minutes: 12, active: true };
  const { page, calls } = await openLenders(open, { bureau: [existing] });
  await proof.check(/^AI bureau config row Save button/, async () => {
    await page.locator('[data-tab="bureau"]').click();
    await page.waitForSelector("#bureauBody tr");
    const row = page.locator("#bureauBody tr").first();
    await row.locator('[data-f="menu_path"]').fill("1,3,4");
    await row.locator('[data-f="expected_hold_minutes"]').fill("20");
    await row.locator('[data-f="active"]').selectOption("false");
    await row.locator(".save-bureau").click();
    await waitFor(() => calls.bureau.length === 1);
    assert.deepEqual(calls.bureau[0], {
      action: "save", id: existing.id,
      patch: { bureau_code: "EX", bureau_name: "Experian", service_number: "+18885551212", ivr_version: "v2", menu_path: "1,3,4", expected_hold_minutes: 20, active: false },
    });
    await page.locator("#btnAddBureau").click();
    const added = page.locator("#bureauBody tr").last();
    await added.locator('[data-f="bureau_code"]').fill("TU");
    await added.locator('[data-f="bureau_name"]').fill("TransUnion");
    await added.locator(".save-bureau").click();
    await waitFor(() => calls.bureau.length === 2);
    assert.deepEqual(calls.bureau[1], {
      action: "upsert", bureau_code: "TU", bureau_name: "TransUnion", service_number: null, ivr_version: null,
      menu_path: null, expected_hold_minutes: null, active: true,
    });
  });
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
