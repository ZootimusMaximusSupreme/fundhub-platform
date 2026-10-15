// Practice test (fake data, real page): the footer note of the call log bar on
// closer-dashboard.html. The bar stays hidden until a call is loaded; once the
// call is on screen the note says cash comes from the payment record, and it
// drops the "recording not available" half once the client's own words are on
// file. A page with no call, or a call that would not load, shows no bar.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CLOSER } from "../../../../e2e/harness.mjs";
import { json, startPages } from "./fin-b23-browser-kit.mjs";

const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const NOTE_FULL = "Cash comes from the payment record — never typed. Recording/transcript not available yet.";
const NOTE_SAID = "Cash comes from the payment record — never typed.";

const COCKPIT = {
  ok: true,
  staff: { id: "staff-2", name: "Casey Reed", shift: { on_shift: true, elapsed_ms: 3_600_000 } },
  kpis: { cash_today_cents: { cents: 0, display: "$0", deposits: 0 }, cash_month_cents: 0, deposits: 0, calls_held: 0, no_shows: 0, close_rate: null, unlogged: 0, commission_mtd: null, commission_reason: "n/a" },
  client: { id: CLIENT, name: "Dana Whitfield", business_name: "Whitfield Freight", age_months: 26, tags: [], funded: false, pipeline: { stage_key: "closing", stage_name: "Closing" } },
  credit: { available: false, reason: "No credit pull on file yet" },
  underwrite: { matched_lenders: 0, lenders: [], applications: [], lenders_reason: "empty", lite_banner_funding: null, totals: { total_personal_funding: 0, total_business_funding: 0, total_combined_funding: 0 } },
  deal: { latest_payment: null, success_fee_percent: 0.1, success_fee_source: "default", success_fee_note: "House default." },
  precall: { conversation_count: 0, summary: "No conversation summary on file yet." },
  current_call: { due_at: "2026-09-01T17:00:00.000Z", task_id: "task-1", title: "Closing call" },
  next_call: null,
  up_next: [],
  offers: [],
  gone_quiet: { unlogged: [], quiet_deposits: [] },
};

async function openDashboard(open, { query = `?client_id=${CLIENT}&task_id=task-1`, cockpit = COCKPIT, said = null, now = { ok: true, current: null, next: null } } = {}) {
  const handlers = {
    "/api/read/closer-now": now,
    "/api/read/closer-call": async (route) => json(route, cockpit, cockpit.ok === false ? 500 : 200),
    "/api/read/tradelines": { ok: true, data: [], client_id: CLIENT },
    "/api/read/lender-matches": { ok: true, matches: [] },
    "/api/read/deal-math": { ok: true },
    "/api/read/agent-context": { ok: true, context: said ? { as_prompt_block: `intent: funding\nsaid: ${said}\nnext: call` } : {} },
  };
  return open(`/app/closer-dashboard.html${query}`, { session: CLOSER, handlers });
}

test("with a call loaded the bar is shown and the note says cash comes from the payment record", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const { page, errors } = await openDashboard(open);
  await page.waitForSelector("#fh-save-next");
  assert.equal(await page.locator(".logbar").isVisible(), true, "the bar is on screen once the call is loaded");
  assert.equal(await page.locator(".logbar").evaluate((el) => el.hidden), false);
  assert.equal((await page.locator(".logbar .foot span").first().innerText()).trim(), NOTE_FULL);
  assert.equal(await page.locator(".logbar .foot #fh-save-next").count(), 1, "the note sits beside Save · next call");
  assert.deepEqual(errors, []);
  await page.close();
});

test("once the client's own words are on file the note drops the recording sentence", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const { page } = await openDashboard(open, { said: "I need fifty thousand for trucks" });
  await page.waitForFunction((want) => document.querySelector(".logbar .foot span")?.textContent.trim() === want, NOTE_SAID);
  assert.match(await page.locator(".ctx [data-fh-said]").innerText(), /said: I need fifty thousand for trucks/);
  await page.close();
});

test("a page with no call, or a call that would not load, shows no bar and no note", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const none = await openDashboard(open, { query: "" });
  await none.page.waitForFunction(() => /No call right now/.test(document.querySelector("#ccp-who-name, .who h1")?.textContent || ""));
  assert.equal(await none.page.locator(".logbar").isVisible(), false);
  await none.page.close();

  const broken = await openDashboard(open, { cockpit: { ok: false, error: "server_error" } });
  await broken.page.waitForFunction(() => /Could not load/.test(document.querySelector("#ccp-who-name, .who h1")?.textContent || ""));
  assert.equal(await broken.page.locator(".logbar").isVisible(), false);
  await broken.page.close();
});
