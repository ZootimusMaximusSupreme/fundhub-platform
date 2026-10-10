// GET /api/money/alerts — the payload, and the fixture the screen is built against.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fileAlertsPayload } from "./read.mjs";
import { buildSamplePayload, SAMPLE_ACCOUNTS, SAMPLE_CYCLES, SAMPLE_CLIENT, SAMPLE_ORG, SAMPLE_NOW } from "./sample-payload.mjs";
import { ACCOUNT_SQL } from "../money-overview.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(readFileSync(join(HERE, "file-alerts.fixture.json"), "utf8"));
const DOC = readFileSync(join(HERE, "..", "..", "..", "docs", "finance", "file-protection-alerts.md"), "utf8");

/** A payload for the sample client with the rows or the store answers changed. */
async function payload({ accounts = SAMPLE_ACCOUNTS, cycles = SAMPLE_CYCLES, optedOut = false, blueprint = true, entitled = true, settings = {}, alerts = [], open = new Map(), now = SAMPLE_NOW, env = {} } = {}) {
  const conn = {
    async query(sql) {
      const s = String(sql);
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

  test("a client that is not in the org is null (the endpoint answers 404)", async () => {
    const out = await fileAlertsPayload({ query: async () => ({ rows: [] }) }, { orgId: SAMPLE_ORG, clientId: SAMPLE_CLIENT, now: new Date(SAMPLE_NOW) });
    assert.equal(out, null);
  });
});
