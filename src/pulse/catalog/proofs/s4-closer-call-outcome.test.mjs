// Proves the call outcome the closer logs on closer-dashboard.html: the five
// compliance ticks, the five outcome buttons (and keys 1 to 5), the repair
// referral tick, and Save · next call sending exactly what was picked and
// nothing before it is pressed.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const CLOSER = { ok: true, staff: { id: "staff-2", name: "Casey Reed", email: "casey@fundhub.ai", role: "closer", org_id: "org-1", status: "active" } };
const DUE = "2026-09-01T17:00:00.000Z";
const NEXT_DUE = "2026-09-01T18:00:00.000Z";

const COCKPIT = {
  ok: true,
  staff: { id: "staff-2", name: "Casey Reed", shift: { on_shift: true, elapsed_ms: 3_600_000 } },
  kpis: { cash_today_cents: { cents: 0, display: "$0", deposits: 0 }, cash_month_cents: 0, deposits: 0, calls_held: 0, no_shows: 0, close_rate: null, unlogged: 0, commission_mtd: null, commission_reason: "n/a" },
  client: { id: CLIENT, name: "Dana Whitfield", business_name: "Whitfield Freight", age_months: 26, tags: [], funded: false, pipeline: { stage_key: "closing", stage_name: "Closing" } },
  credit: { available: false, reason: "No crs_results row for this client yet" },
  underwrite: { matched_lenders: 0, lenders: [], applications: [], lenders_reason: "empty", lite_banner_funding: null, totals: { total_personal_funding: 0, total_business_funding: 0, total_combined_funding: 0 } },
  deal: { latest_payment: null, success_fee_percent: 0.1, success_fee_source: "default", success_fee_note: "House default." },
  precall: { conversation_count: 0, summary: "No conversation summary on file yet." },
  current_call: { due_at: DUE, task_id: "task-1", title: "Closing call" },
  next_call: { due_at: NEXT_DUE, task_id: "task-2", client_id: "bbbb", name: "Sam Okafor" },
  up_next: [{ task_id: "task-2", client_id: "bbbb", due_at: NEXT_DUE, title: "Closing call", name: "Sam Okafor" }],
  offers: [{ key: "FUNDING_DFY", name: "Funding done for you", priceDisplay: "$5,000" }],
  gone_quiet: { unlogged: [], quiet_deposits: [] },
  dispositions: { outcomes: ["deposit", "downsell", "callback", "no_show", "not_a_fit"], beliefs: ["pain", "doubt", "cost", "desire", "money", "support", "trust"] },
};

async function openCall(open) {
  const posted = [];
  const alerts = [];
  const handlers = {
    "/api/read/closer-now": { ok: true, current: null, next: null },
    "/api/read/closer-call": COCKPIT,
    "/api/read/tradelines": { ok: true, data: [], client_id: CLIENT },
    "/api/read/lender-matches": { ok: true, matches: [] },
    "/api/read/deal-math": { ok: true },
    "/api/read/agent-context": { ok: true, context: {} },
    "/api/call-outcomes": async (route) => {
      posted.push(bodyOf(route));
      return json(route, { ok: true, created: true, outcome: { outcome: posted.at(-1).outcome } });
    },
  };
  const opened = await open(`/app/closer-dashboard.html?client_id=${CLIENT}&task_id=task-1`, { session: CLOSER, handlers });
  opened.page.on("dialog", (dialog) => { alerts.push(dialog.message()); dialog.accept(); });
  await opened.page.waitForSelector("#fh-save-next");
  return { ...opened, posted, alerts };
}

test("the compliance ticks, outcome buttons, keys and referral tick are sent only when Save is pressed", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posted, alerts } = await openCall(open);

  await proof.check(/^Before you close: 5 compliance checkboxes/, async () => {
    // Three of the five: the other two must go out as false, not as ticked.
    for (const id of ["d2", "d3", "d4"]) await page.locator(`#${id}`).check();
    assert.deepEqual(posted, [], "nothing is sent by ticking");
  });

  await proof.check(/^Repair referral checkbox/, async () => {
    await page.locator("#fh-repair-referral").check();
    assert.deepEqual(posted, []);
  });

  await proof.check(/^Outcome buttons 1-5/, async () => {
    const names = await page.locator("[data-outcome]").evaluateAll((els) => els.map((e) => e.getAttribute("data-outcome")));
    assert.deepEqual(names, ["deposit", "downsell", "callback", "no_show", "not_a_fit"]);
    await page.locator('[data-outcome="deposit"]').click();
    assert.match(await page.locator('[data-outcome="deposit"]').getAttribute("class"), /\bk\b/);
    await page.keyboard.press("3");
    assert.match(await page.locator('[data-outcome="callback"]').getAttribute("class"), /\bk\b/, "key 3 picks Callback");
    assert.doesNotMatch((await page.locator('[data-outcome="deposit"]').getAttribute("class")) || "", /\bk\b/, "only one outcome is picked");
  });

  await proof.check(/^Save · next call button/, async () => {
    await page.locator("#fh-save-next").click();
    await waitFor(() => posted.length === 1);
    assert.deepEqual(posted[0], {
      client_id: CLIENT, outcome: "callback", belief_failed: null, task_id: "task-1",
      checklist: { call_recorded: false, personal_guarantee: true, month_14_cliff: true, bank_decides: true, incorporation_verified: false },
      repair_referral: true,
    });
    assert.equal("transaction_id" in posted[0], false, "the browser never picks the payment");
    await page.waitForURL(/\/app\/closer-dashboard\.html\?client_id=bbbb&task_id=task-2$/);
    assert.deepEqual(alerts, []);
  });
  await page.close();
});

test("Save with no outcome picked says so and sends nothing", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, posted, alerts } = await openCall(open);
  await proof.check(/^Save · next call button/, async () => {
    await page.locator("#fh-save-next").click();
    await waitFor(() => alerts.length === 1);
    assert.match(alerts[0], /Pick an outcome/);
    assert.deepEqual(posted, []);
  });
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
