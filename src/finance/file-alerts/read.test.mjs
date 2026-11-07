// GET /api/money/alerts — the payload, and the fixture the screen is built against.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fileAlertsPayload } from "./read.mjs";
import { introCountdown } from "./intro-countdown.mjs";
import { buildSamplePayload, SAMPLE_ACCOUNTS, SAMPLE_CYCLES, SAMPLE_CLIENT, SAMPLE_ORG, SAMPLE_NOW } from "./sample-payload.mjs";
import { ACCOUNT_SQL } from "../money-overview.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, "file-alerts.fixture.json"), "utf8"));
const DOC = readFileSync(join(HERE, "..", "..", "..", "docs", "finance", "file-protection-alerts.md"), "utf8");

/** A payload for the sample client with the rows or the store answers changed. `more(sql)`
 *  answers any other read (an answer, or undefined to fall through). */
async function payload({ accounts = SAMPLE_ACCOUNTS, cycles = SAMPLE_CYCLES, optedOut = false, blueprint = true, entitled = true, settings = {}, alerts = [], open = new Map(), now = SAMPLE_NOW, env = {}, more = null } = {}) {
  const conn = {
    async query(sql) {
      const s = String(sql);
      const answer = more ? more(s) : undefined;
      if (answer) return answer;
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(s)) return { rows: [{ id: SAMPLE_CLIENT, first_name: "Sample", last_name: "Client" }] };
      if (/item_created_at/.test(s)) {
        return { rows: accounts.map((a) => ({ id: a.id, account_type: a.account_type, plaid_item_id: null, mask: a.mask, name: a.name, closed_at: null, created_at: null, balance_as_of: null, item_created_at: null })) };
      }
      if (s === ACCOUNT_SQL) return { rows: accounts };
      if (/FROM entities/.test(s)) return { rows: [] };
      if (/FROM account_statement_cycles s/.test(s)) return { rows: cycles.map((row) => ({ row })) };
      if (/FROM card_liabilities l/.test(s)) return { rows: [] };
      if (/FROM clarity_payments p/.test(s)) return { rows: [] };
      throw new Error(`unexpected sql: ${s.slice(0, 80)}`);
    }
  };
  return fileAlertsPayload(conn, { orgId: SAMPLE_ORG, clientId: SAMPLE_CLIENT, now: new Date(now), env }, {
    store: {
      readSettings: async () => ({ payment_timing: true, promo_end: true, cash_reserve: true, new_credit: true, saved: false, ...settings }),
      listAlerts: async () => alerts,
      reserveState: async () => ({ open, episodes: new Map() })
    },
    isOptedOut: async () => optedOut,
    isBlueprint: async () => blueprint,
    financeOsEntitlement: async () => ({ entitled, subscriptionId: entitled ? "s" : null, reason: null })
  });
}

describe("the fixture IS what the endpoint returns", () => {
  test("the sample payload equals src/finance/file-alerts/file-alerts.fixture.json, key for key", async () => {
    assert.deepEqual(JSON.parse(JSON.stringify(await buildSamplePayload())), FIXTURE);
  });

  test("the doc points at the fixture and names every top-level key of it", () => {
    assert.match(DOC, /file-alerts\.fixture\.json/);
    for (const key of Object.keys(FIXTURE)) assert.match(DOC, new RegExp(`\`${key}\``), `the doc names ${key}`);
  });

  test("the sample tells one coherent story", () => {
    const [amex, visa] = FIXTURE.cards;
    assert.equal(amex.promo.alerted_thresholds.length, 1, "the 60-day text already went out");
    assert.equal(FIXTURE.alerts.filter((a) => a.kind === "promo_end").length, 1);
    assert.equal(visa.pay_before.unknown_reason, "no_statement_close_day");
    assert.equal(FIXTURE.reserve.personal.state, "below");
    assert.equal(FIXTURE.reserve.personal.open_alert_id, FIXTURE.alerts.find((a) => a.kind === "cash_reserve").id);
    assert.equal(FIXTURE.reserve.business.state, "ok");
  });

  test("the board (unit AL2) tells the same story: every number on it comes from the rest of the sample", () => {
    const [personal, biz] = FIXTURE.board.scopes;
    assert.deepEqual([personal.key, biz.name], ["personal", "Sample Co LLC"]);
    const smart = (scope, kind) => scope.smart.filter((s) => s.kind === kind);
    // The pay-by alert asks for the same amount the pay-before-close text did ("Pay about $2,900 to get under 10%").
    const pay = smart(biz, "pay_by")[0];
    assert.equal(pay.pay_cents, 290000);
    assert.match(FIXTURE.alerts.find((a) => a.kind === "payment_timing").body, /Pay about \$2,900 to get under 10%/);
    assert.equal(pay.close_on, FIXTURE.cards[0].pay_before.next_close_on);
    assert.deepEqual([pay.for, pay.on, pay.due_on], ["both", "2026-10-13", "2026-10-15"], "the Amex closes and is due Oct 15: pay by Oct 13");
    assert.equal(FIXTURE.board.pay_by_days_before, 2);
    // The Visa has no close day, so its pay-by day comes from its due date and no close is made up.
    const [visaPay] = smart(personal, "pay_by");
    const visa = FIXTURE.cards[1];
    assert.deepEqual([visaPay.account_id, visaPay.for, visaPay.close_on, visaPay.due_on, visaPay.on],
      [visa.account_id, "due_date", null, "2026-10-25", "2026-10-23"]);
    assert.equal(visaPay.pay_cents, visa.balance_cents - Math.round(visa.limit_cents / 10), "what gets it under 10%");
    // Nothing on the board is said twice: one pay-by per card, and no card in two scopes.
    const ids = FIXTURE.board.scopes.flatMap((s) => smart(s, "pay_by").map((x) => x.account_id));
    assert.deepEqual(ids.sort(), FIXTURE.cards.map((c) => c.account_id).sort());
    // Cash: personal is the cash text's own verdict; the business is covered, so it has none.
    assert.equal(smart(personal, "cash_low")[0].short_cents, FIXTURE.reserve.personal.short_cents);
    assert.deepEqual(smart(biz, "cash_low"), []);
    // The bill cleanup flags match the bills: QuickBooks costs $90 now, Google Workspace $72.
    const bill = (name) => FIXTURE.bills.find((b) => b.name === name);
    assert.equal(smart(biz, "price_up")[0].to_cents, bill("QuickBooks Online").typical_cents);
    assert.equal(smart(biz, "charged_twice")[0].amount_cents, bill("Google Workspace").typical_cents);
    // What the client added sits where they said, and its phone alert is the one waiting in the sent list.
    assert.ok(personal.payments.some((p) => p.item_id === FIXTURE.custom[0].id));
    assert.ok(biz.bills.some((b) => b.item_id === FIXTURE.custom[1].id));
    assert.ok(FIXTURE.phone.sent.some((s) => s.kind === "custom_alert" && s.subject_id === FIXTURE.custom[0].id && s.about_on === FIXTURE.custom[0].next_on));
  });
});

describe("the payload", () => {
  test("a card with a close day says when the text goes; one without says why not", async () => {
    const p = await payload();
    const [amex, visa] = p.cards;
    assert.deepEqual(amex.pay_before, { next_close_on: "2026-10-15", days_to_close: 3, unknown_reason: null, text_on: "2026-10-12", texted: false, texted_at: null });
    assert.deepEqual([visa.statement_close_day, visa.pay_before.next_close_on, visa.pay_before.text_on, visa.pay_before.unknown_reason],
      [null, null, null, "no_statement_close_day"]);
  });

  test("the lead time follows the setting", async () => {
    const p = await payload({ env: { FILE_ALERT_PAY_BEFORE_CLOSE_DAYS: "5" } });
    assert.equal(p.settings.pay_before_close_days, 5);
    assert.equal(p.cards[0].pay_before.text_on, "2026-10-10");
  });

  test("a promo reads its days left, payoff and next text — and an ended one says so, with no payoff", async () => {
    const live = (await payload()).cards[0].promo;
    assert.deepEqual([live.ends_on, live.days_left, live.ended, live.apr_pct, live.payoff.monthly_cents], ["2026-12-06", 55, false, 0, 270000]);
    assert.deepEqual(live.next_alert, { threshold: 30, on: "2026-11-06" });
    const gone = (await payload({ now: "2026-12-10T12:00:00.000Z" })).cards[0].promo;
    assert.deepEqual([gone.ended, gone.days_left, gone.payoff, gone.next_alert], [true, -4, null, null]);
  });

  test("a promo rate reads as a percent, with three decimals at most", async () => {
    const cycles = SAMPLE_CYCLES.map((c) => (c.promo_ends_on ? { ...c, promo_apr: "0.02990" } : c));
    assert.equal((await payload({ cycles })).cards[0].promo.apr_pct, 2.99);
  });

  test("the Settings payoff is the intro countdown's to the cent: with interest at 9.99%, only the least with no rate on file", async () => {
    const amex = SAMPLE_ACCOUNTS.find((a) => a.name === "Business Amex");
    for (const [apr, floor] of [["0.09990", false], [null, true], ["0.00000", false]]) {
      const cycles = SAMPLE_CYCLES.map((c) => (c.promo_ends_on ? { ...c, promo_apr: apr } : c));
      const card = (await payload({ cycles })).cards[0];
      const countdown = introCountdown({ account_id: amex.id, balance_cents: amex.current_balance_cents }, cycles.find((c) => c.promo_ends_on), { today: "2026-10-12" });
      assert.equal(card.promo.payoff.monthly_cents, countdown.monthly_cents, `rate ${apr}: one amount`);
      assert.equal(card.promo.payoff.monthly_is_floor, floor, `rate ${apr}`);
      assert.equal(countdown.monthly_is_floor, floor, `rate ${apr}`);
    }
    const at = (await payload({ cycles: SAMPLE_CYCLES.map((c) => (c.promo_ends_on ? { ...c, promo_apr: "0.09990" } : c)) })).cards[0].promo.payoff;
    assert.ok(at.monthly_cents > 270000, "9.99% costs more than the no-interest $2,700 a month");
  });

  test("the two cash verdicts are separate, and there is no combined total anywhere in the payload", async () => {
    const p = await payload();
    assert.deepEqual(Object.keys(p.reserve).sort(), ["business", "months", "not_counted", "personal"]);
    const seen = [];
    const walk = (o, path = "") => {
      for (const [k, v] of Object.entries(o || {})) {
        if (/total|combined|all_cash/i.test(k)) seen.push(`${path}${k}`);
        if (v && typeof v === "object" && !Array.isArray(v)) walk(v, `${path}${k}.`);
      }
    };
    walk(p);
    assert.deepEqual(seen, []);
  });

  test("a card or loan nobody has sorted into personal or business is listed as NOT counted", async () => {
    const accounts = SAMPLE_ACCOUNTS.map((a) => (a.name === "Personal Visa" ? { ...a, entity_kind: "unknown" } : a));
    const p = await payload({ accounts });
    assert.deepEqual(p.reserve.not_counted, { debts: 1, minimums_cents: 6602 });
    assert.equal(p.reserve.personal.minimums_cents, null, "and the personal check no longer has it");
  });

  test("opted out and not enrolled are said plainly", async () => {
    const out = await payload({ optedOut: true, blueprint: false, entitled: false });
    assert.equal(out.settings.texts_blocked, true);
    assert.deepEqual(out.enrolled, { blueprint: false, finance_os: false, any: false });
    const fin = await payload({ blueprint: false, entitled: true });
    assert.deepEqual(fin.enrolled, { blueprint: false, finance_os: true, any: true });
  });

  test("a switched-off kind reads off; the labels are plain words", async () => {
    const p = await payload({ settings: { promo_end: false, saved: true } });
    assert.equal(p.settings.kinds.promo_end.enabled, false);
    assert.equal(p.settings.kinds.payment_timing.enabled, true);
    assert.equal(p.settings.saved, true);
    assert.deepEqual(Object.values(p.settings.kinds).map((k) => k.label),
      ["Pay before the statement closes", "Promo rate ending", "Cash cushion", "New credit"]);
  });

  test("a cash alert is 'open' until it clears; due dates are plain text dates", async () => {
    const alerts = [
      { id: "a", kind: "cash_reserve", cash_kind: "personal", body: "b", delivery: "text", message_id: "m", sent_at: "t", cleared_at: null, due_on: null, threshold: 6 },
      { id: "b", kind: "cash_reserve", cash_kind: "personal", body: "b", delivery: "text", message_id: "m", sent_at: "t", cleared_at: "2026-10-10T07:30:00.000Z", due_on: null, threshold: 6 },
      { id: "c", kind: "payment_timing", bank_account_id: "x", body: "b", delivery: "text", message_id: "m", sent_at: "t", cleared_at: null, due_on: new Date("2026-10-15T00:00:00Z"), threshold: 3 }
    ];
    const p = await payload({ alerts });
    assert.deepEqual(p.alerts.map((a) => a.open), [true, false, false]);
    assert.equal(p.alerts[2].due_on, "2026-10-15");
  });

  test("the board reads the bill cleanup, the seasoning clock and the bank logos itself; a read that fails adds nothing", async () => {
    const AMEX_ID = SAMPLE_ACCOUNTS.find((a) => a.name === "Business Amex").id;
    // A 1-by-1 PNG, the shape Plaid hands back for a bank's logo.
    const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const more = (s) => {
      // The bill cleanup (src/banking/bill-cleanup.mjs): the accounts and no bank history.
      if (/LEFT JOIN entities e ON e\.id = a\.entity_id/.test(s) || /FROM bank_transactions t/.test(s)) return { rows: [] };
      // The bank plan (readRelationships): one Chase account opened Sep 30.
      if (/FROM blueprint_bank_relationship_todos/.test(s)) {
        return { rows: [{ id: "7e1d2c3b-4a59-4687-8796-a5b4c3d2e1f0", bank_key: "chase", bank_name: "Chase", account_kind: "business", state: "done", notes: null,
          lender_id: null, entity_id: null, planned_open_on: null, planned_deposit_cents: null, opened_on: "2026-09-30", created_at: "2026-09-30T15:00:00.000Z", updated_at: "2026-09-30T15:00:00.000Z" }] };
      }
      if (/FROM bank_relationship_deposits/.test(s) || /FROM lenders/.test(s)) return { rows: [] };
      // The bank logos (src/banking/institution-logos.mjs): the Amex's login and Plaid's saved logo.
      if (/JOIN plaid_items p ON p\.id = ba\.plaid_item_id/.test(s)) return { rows: [{ bank_account_id: AMEX_ID, plaid_institution_id: "ins_sample", institution_name: "Sample Bank" }] };
      if (/FROM plaid_institutions/.test(s)) return { rows: [{ plaid_institution_id: "ins_sample", name_key: "samplebank", logo_base64: PNG }] };
      return undefined;
    };
    const p = await payload({ more });
    assert.equal(p.board.checks.bill_cleanup, true, "the cleanup ran (and found nothing in no history)");
    assert.equal(p.board.checks.seasoning, true);
    const smart = p.board.scopes.flatMap((s) => s.smart);
    assert.deepEqual(smart.filter((x) => x.kind === "seasoning").map((x) => [x.name, x.day, x.days_left, x.on]), [["Chase", 12, 18, "2026-10-30"]],
      "the seasoning clock is src/finance/apply-gate.mjs's own");
    const amexRow = p.board.scopes.flatMap((s) => s.payments).find((x) => x.account_id === AMEX_ID);
    assert.equal(amexRow.logo, `data:image/png;base64,${PNG}`, "the Amex carries Plaid's logo");
    assert.equal(smart.find((x) => x.kind === "pay_by" && x.account_id === AMEX_ID).logo, amexRow.logo);
    assert.ok(p.board.scopes.flatMap((s) => s.payments).filter((x) => x.account_id && x.account_id !== AMEX_ID).every((x) => x.logo === null),
      "no logo is guessed for the others");

    // Every one of those reads failing (this connection knows none of them): the board still builds, with nothing made up.
    const bare = await payload();
    assert.deepEqual([bare.board.checks.bill_cleanup, bare.board.checks.seasoning], [false, false]);
    assert.ok(bare.board.scopes.every((s) => !s.smart.some((x) => ["seasoning", "price_up", "charged_twice"].includes(x.kind))));
    assert.ok(bare.board.scopes.flatMap((s) => s.payments).every((x) => x.logo === null));
  });

  test("a client that is not in the org is null (the endpoint answers 404)", async () => {
    const out = await fileAlertsPayload({ query: async () => ({ rows: [] }) }, { orgId: SAMPLE_ORG, clientId: SAMPLE_CLIENT, now: new Date(SAMPLE_NOW) });
    assert.equal(out, null);
  });
});
