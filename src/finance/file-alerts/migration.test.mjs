// Migration 471 and the four texts it seeds. The SQL is read as text — the tables
// themselves are proved against a real Postgres in store.pg.test.mjs. What this
// pins, with no database, is the part that can drift in silence: the template the
// client reads and the sentence the planner stored must be the SAME sentence.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { renderTemplate } from "../../lib/render-template.mjs";
import { isDraftTemplateRow } from "../../messaging/draft-guard.mjs";
import { TEMPLATES, KINDS } from "./common.mjs";
import { planPaymentTiming } from "./payment-timing.mjs";
import { planPromoEnd } from "./promo.mjs";
import { evaluateReserve, planCashReserve } from "./cash-reserve.mjs";
import { planNewAccounts, planNewPull } from "./new-credit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "..", "..", "db", "migrations");
const FILE = "471_file_protection_alerts.sql";
const SQL = readFileSync(join(MIGRATIONS, FILE), "utf8");

/** { 'SMS-FILE-PROTECT-…': body } read out of the seed INSERT. */
function seededTemplates() {
  const out = {};
  for (const m of SQL.matchAll(/\('(SMS-FILE-PROTECT-[A-Z-]+)',\s*\$c\$([\s\S]*?)\$c\$\)/g)) out[m[1]] = m[2];
  return out;
}
const templates = seededTemplates();
const STOP = " Reply STOP to opt out.";

describe("migration 471 — the file", () => {
  test("it is number 471, the next free one after 464, and nothing else owns 471", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.startsWith("471_"));
    assert.deepEqual(files, [FILE]);
  });

  test("it is additive and re-runnable: no drop, delete or truncate; every create is guarded", () => {
    const code = SQL.replace(/--.*$/gm, "");
    assert.doesNotMatch(code, /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)\b/i);
    assert.doesNotMatch(code, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(code, /\bTRUNCATE\b/i);
    assert.doesNotMatch(code, /\bUPDATE\s+\w+\s+SET\b/i, "no existing row is rewritten");
    for (const m of code.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/gi)) assert.fail(`unguarded create: ${m[0]}`);
    assert.match(code, /ADD COLUMN IF NOT EXISTS promo_ends_on date/);
    assert.match(code, /ADD COLUMN IF NOT EXISTS promo_apr\s+numeric\(6,5\)/);
  });

  test("promo lives on the statement cycle, not on client_cards", () => {
    const code = SQL.replace(/--.*$/gm, "");
    assert.match(code, /ALTER TABLE account_statement_cycles/);
    assert.doesNotMatch(code, /client_cards/);
  });

  test("both tables have row security ENABLED and FORCED, one policy, and a grant to the app role", () => {
    for (const t of ["file_protection_settings", "file_protection_alerts"]) {
      assert.match(SQL, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      assert.match(SQL, new RegExp(`ALTER TABLE public\\.${t} FORCE ROW LEVEL SECURITY`));
      assert.match(SQL, new RegExp(`CREATE POLICY ${t}_app_all ON public\\.${t}`));
      assert.match(SQL, new RegExp(`GRANT SELECT, INSERT, UPDATE ON public\\.${t} TO fundhub_app`));
    }
  });

  test("the once-only guard and the one-open-cash-alert guard are unique indexes", () => {
    assert.match(SQL, /CREATE UNIQUE INDEX IF NOT EXISTS file_protection_alerts_dedupe_uniq\s+ON file_protection_alerts \(org_id, dedupe_key\)/);
    assert.match(SQL, /CREATE UNIQUE INDEX IF NOT EXISTS file_protection_alerts_one_open_reserve\s+ON file_protection_alerts \(client_id, cash_kind\)\s+WHERE kind = 'cash_reserve' AND cleared_at IS NULL/);
  });

  test("the alert kinds in the table are exactly the kinds in code", () => {
    const m = /kind\s+text NOT NULL\s+CHECK \(kind IN \(([^)]*)\)\)/.exec(SQL);
    assert.ok(m, "the kind CHECK is there");
    const inSql = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    assert.deepEqual(inSql, [...KINDS]);
  });
});

describe("migration 471 — the four texts", () => {
  test("the keys seeded are exactly the keys the code sends", () => {
    assert.deepEqual(Object.keys(templates).sort(), Object.values(TEMPLATES).sort());
  });

  test("seeded the way 433 and 444 seed theirs: compliance passed, SMS, never overwriting an edited copy", () => {
    assert.match(SQL, /SELECT o\.id, t\.template_key, 'sms', NULL::text, t\.body, true/);
    assert.match(SQL, /ON CONFLICT \(org_id, template_key\) DO NOTHING/);
  });

  test("every text ends with the opt-out line, spells the company Fundhub, and never says 'round two'", () => {
    for (const [key, body] of Object.entries(templates)) {
      assert.ok(body.endsWith(STOP.trim()), `${key} ends with the opt-out line`);
      assert.match(body, /^Fundhub (reminder|alert):/, key);
      assert.doesNotMatch(body, /FundHub|Fund Hub|FUNDHUB/, key);
      assert.doesNotMatch(body, /round two|round 2|second round/i, key);
    }
    assert.match(templates[TEMPLATES.cash_reserve], /next funding sequence/);
    assert.match(templates[TEMPLATES.new_credit], /next funding sequence/);
  });

  test("none of them reads as a placeholder draft, so the send path will not refuse it", () => {
    for (const [key, body] of Object.entries(templates)) {
      assert.equal(isDraftTemplateRow({ body, subject: null }), false, key);
    }
  });

  test("every merge tag in every text is one the job fills in (and nothing else)", () => {
    const filled = {
      [TEMPLATES.payment_timing]: ["card", "when", "detail"],
      [TEMPLATES.promo_end]: ["card", "date", "days", "detail"],
      [TEMPLATES.cash_reserve]: ["cash", "cash_amount", "need", "months"],
      [TEMPLATES.new_credit]: ["what"]
    };
    for (const [key, body] of Object.entries(templates)) {
      const tags = [...new Set([...body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))].sort();
      assert.deepEqual(tags, filled[key].map((t) => `alert.${t}`).sort(), key);
    }
  });
});

describe("the template and the planner say the same sentence", () => {
  const card = { account_id: "c", name: "Business Amex", mask: "4404", balance_cents: 540000, limit_cents: 2500000 };
  const promoCycle = { promo_ends_on: "2026-12-06" };

  /* Each plan is rendered through the seeded template exactly as sendTemplated would
     (renderTemplate with { alert: tags }) and compared with the sentence the planner
     stored as `body`, plus the opt-out line the template adds. */
  function check(plan, label) {
    assert.ok(plan && plan.alert !== false, `${label}: a plan was made`);
    const body = templates[plan.templateKey];
    assert.ok(body, `${label}: the template is seeded`);
    assert.equal(renderTemplate(body, { alert: plan.tags }), `${plan.body}${STOP}`, label);
  }

  test("pay before close: before the day, on the day, and with no balance or limit", () => {
    const cyc = { statement_close_day: 15 };
    check(planPaymentTiming(card, cyc, { today: "2026-10-12" }), "3 days out");
    check(planPaymentTiming(card, cyc, { today: "2026-10-15" }), "on the day");
    check(planPaymentTiming({ ...card, balance_cents: 150000 }, cyc, { today: "2026-10-12" }), "already under 10%");
    check(planPaymentTiming({ ...card, limit_cents: null }, cyc, { today: "2026-10-12" }), "no limit");
    check(planPaymentTiming({ ...card, balance_cents: null }, cyc, { today: "2026-10-12" }), "no balance");
  });

  test("promo end: 60, 30 and 7 days, and a balance we do not know", () => {
    check(planPromoEnd(card, promoCycle, { today: "2026-10-07" }), "60");
    check(planPromoEnd(card, promoCycle, { today: "2026-11-06" }), "30");
    check(planPromoEnd(card, promoCycle, { today: "2026-11-29" }), "7");
    check(planPromoEnd({ ...card, balance_cents: null }, promoCycle, { today: "2026-10-07" }), "unknown balance");
  });

  test("cash cushion: personal, business, and a floor on the minimums", () => {
    const debts = [{ kind: "personal", balance_cents: 1, min_cents: 71602 }, { kind: "business", balance_cents: 1, min_cents: 132000 }, { kind: "business", balance_cents: 5, min_cents: null }];
    const personal = evaluateReserve({ kind: "personal", cash: { cents: 421055, accounts: 1, is_floor: false }, debts });
    const business = evaluateReserve({ kind: "business", cash: { cents: 100000, accounts: 1, is_floor: false }, debts });
    check(planCashReserve(personal, { clientId: "c", episode: 1 }), "personal");
    check(planCashReserve(business, { clientId: "c", episode: 1 }), "business with a floor");
  });

  test("new credit: a card, a loan, and a credit pull", () => {
    const row = { id: "n", account_type: "credit", name: "Chase Freedom", mask: "4321", plaid_item_id: "i", item_created_at: "2026-10-01T00:00:00Z", created_at: "2026-10-07T00:00:00Z" };
    const now = new Date("2026-10-08T00:00:00Z");
    check(planNewAccounts([row], { now }).alerts[0], "a new card");
    check(planNewAccounts([{ ...row, account_type: "loan", name: "SBA", mask: null }], { now }).alerts[0], "a new loan");
    const diff = {
      comparable: true, unknown: 0,
      tradelines: [{ source: "credit_pull", type: "card", creditor: "Capital One", opened: "2026-09-20", last4: "5566", print: "p" }],
      inquiries: [{ source: "credit_pull", type: "inquiry", creditor: "American Express", date: "2026-10-03", bureau: "EX" }]
    };
    check(planNewPull(diff, { pullId: "pull-1" }), "a credit pull");
  });
});
