// Account alerts — the SQL itself, on a real Postgres. Read only.
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here.
// Run it:  DATABASE_URL=postgres://... node --test src/pulse/coverage/gap-alerts.pg.test.mjs
//
// The real tables are shadowed by a CTE that holds ONLY the made-up rows of the scenario, each query runs inside
// BEGIN READ ONLY and is rolled back, so no real row is read and nothing is written. Same harness as
// gap-msg.pg.test.mjs and gap-handoff.pg.test.mjs.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { pool, close } from "../../db.mjs";
import { ALERT_TEXTS_SQL, CARD_CYCLES_SQL, CARD_TEXTS_SQL } from "./gap-alerts.mjs";
import { TEST_ADDRESS_RE } from "./gap-sms.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG = crypto.randomUUID();
const OTHER_ORG = crypto.randomUUID();
const NOW = new Date("2026-10-10T13:00:00.000Z");
const ago = (hours) => new Date(NOW.getTime() - hours * 3600000).toISOString();
const uuid = () => crypto.randomUUID();

const SHADOWS = {
  file_protection_alerts: {
    cols: "org_id, client_id, kind, due_on, sent_at, delivery, message_id",
    rec: "org_id uuid, client_id uuid, kind text, due_on date, sent_at timestamptz, delivery text, message_id uuid"
  },
  messages: {
    cols: "id, org_id, status, blocked_reason, created_at, scheduled_at, last_attempt_at, provider_ref",
    rec: "id uuid, org_id uuid, status text, blocked_reason text, created_at timestamptz, scheduled_at timestamptz, last_attempt_at timestamptz, provider_ref text"
  },
  clients: {
    cols: "id, org_id, email, custom_fields, is_demo",
    rec: "id uuid, org_id uuid, email text, custom_fields jsonb, is_demo boolean"
  },
  account_statement_cycles: {
    cols: "id, org_id, client_id, bank_account_id, source, payment_due_day, minimum_payment_cents, last_statement_balance_cents, last_statement_date, raw",
    rec: "id uuid, org_id uuid, client_id uuid, bank_account_id uuid, source text, payment_due_day int, minimum_payment_cents bigint, last_statement_balance_cents bigint, last_statement_date date, raw jsonb"
  },
  bank_accounts: {
    cols: "id, org_id, name, mask, account_type, current_balance_cents, closed_at",
    rec: "id uuid, org_id uuid, name text, mask text, account_type text, current_balance_cents bigint, closed_at timestamptz"
  },
  subscriptions: {
    cols: "org_id, client_id, tier, status, effective_from, effective_to",
    rec: "org_id uuid, client_id uuid, tier text, status text, effective_from timestamptz, effective_to timestamptz"
  },
  opt_outs: {
    cols: "client_id, channel, opted_in_at",
    rec: "client_id uuid, channel text, opted_in_at timestamptz"
  }
};

let conn = null;

before(async () => {
  if (!HAS_DB) return;
  conn = await pool().connect();
  await conn.query("BEGIN READ ONLY");
  const ro = await conn.query("SHOW transaction_read_only");
  assert.equal(ro.rows[0].transaction_read_only, "on", "the harness must be read only");
});

after(async () => {
  if (!HAS_DB) return;
  try { await conn.query("ROLLBACK"); } catch { /* the connection is gone; nothing to undo */ }
  conn.release();
  await close();
});

function withShadows(sql, paramCount) {
  const ctes = Object.entries(SHADOWS).map(([table, def], i) =>
    `${table} AS (SELECT ${def.cols} FROM ${table} WHERE false UNION ALL SELECT ${def.cols} FROM jsonb_to_recordset($${paramCount + i + 1}::jsonb) AS x(${def.rec}))`
  ).join(",\n");
  return `WITH ${ctes}\n${sql}`;
}

async function rows(sql, params, fakes = {}) {
  const text = withShadows(sql, params.length);
  const extra = Object.keys(SHADOWS).map((t) => JSON.stringify(fakes[t] || []));
  return (await conn.query(text, [...params, ...extra])).rows;
}

const client = (over = {}) => ({ id: over.id || uuid(), org_id: ORG, email: over.email ?? "maria@gmail.com", custom_fields: over.custom_fields || {}, is_demo: over.is_demo ?? false });

test("alert texts: the alerts that said a text was queued come back with their message, or with none when it is gone", async () => {
  const maria = client();
  const demo = client({ is_demo: true });
  const m1 = { id: uuid(), org_id: ORG, status: "delivered", blocked_reason: null, created_at: ago(3), scheduled_at: null, last_attempt_at: ago(3), provider_ref: null };
  const alerts = [
    { org_id: ORG, client_id: maria.id, kind: "payment_timing", due_on: "2026-10-12", sent_at: ago(3), delivery: "text", message_id: m1.id },
    { org_id: ORG, client_id: maria.id, kind: "promo_end", due_on: "2026-12-06", sent_at: ago(4), delivery: "text", message_id: uuid() },
    { org_id: ORG, client_id: maria.id, kind: "new_credit", due_on: null, sent_at: ago(5), delivery: "task_only", message_id: null },
    { org_id: ORG, client_id: maria.id, kind: "cash_reserve", due_on: "2026-11-01", sent_at: ago(24 * 10), delivery: "text", message_id: m1.id },
    { org_id: ORG, client_id: maria.id, kind: "payment_timing", due_on: "2026-10-10", sent_at: ago(24 * 10), delivery: "text", message_id: m1.id },
    { org_id: ORG, client_id: demo.id, kind: "payment_timing", due_on: "2026-10-12", sent_at: ago(3), delivery: "text", message_id: m1.id },
    { org_id: OTHER_ORG, client_id: maria.id, kind: "payment_timing", due_on: "2026-10-12", sent_at: ago(3), delivery: "text", message_id: m1.id }
  ];
  const got = await rows(ALERT_TEXTS_SQL, [ORG, ago(72), "2026-10-10", TEST_ADDRESS_RE], { file_protection_alerts: alerts, messages: [m1], clients: [maria, demo] });
  // The task-only alert, the old one not due today, the demo client and the other company are not read.
  assert.equal(got.length, 3);
  const by = Object.fromEntries(got.map((r) => [`${r.kind}:${r.due_on instanceof Date ? r.due_on.toISOString().slice(0, 10) : r.due_on}`, r]));
  assert.equal(Object.values(by).filter((r) => r.message_id === null).length, 1, "the promo alert's message row is gone");
  assert.equal(got.filter((r) => r.status === "delivered").length, 2);
});

test("card cycles: Plaid cards and any loan, for a Finance OS client who is entitled now; closed, manual cards, lapsed and demo are not", async () => {
  const maria = client();
  const lapsed = client({ email: "lapsed@gmail.com" });
  const unpaid = client({ email: "unpaid@gmail.com" });
  const demo = client({ is_demo: true });
  const acct = (over = {}) => ({ id: uuid(), org_id: ORG, name: "Business Amex", mask: "4404", account_type: "credit", current_balance_cents: 500000, closed_at: null, ...over });
  const cycle = (account, clientRow, over = {}) => ({
    id: uuid(), org_id: ORG, client_id: clientRow.id, bank_account_id: account.id, source: "provider", payment_due_day: 11,
    minimum_payment_cents: 135000, last_statement_balance_cents: 500000, last_statement_date: "2026-09-20",
    raw: { next_payment_due_date: "2026-10-11" }, ...over
  });
  const card = acct();
  const manualCard = acct({ name: "Manual card" });
  const manualLoan = acct({ name: "SBA Loan", account_type: "loan" });
  const plaidLoan = acct({ name: "Plaid Loan", account_type: "loan" });
  const closed = acct({ name: "Closed card", closed_at: ago(48) });
  const lapsedCard = acct({ name: "Lapsed card" });
  const demoCard = acct({ name: "Demo card" });
  const sub = (c, over = {}) => ({ org_id: ORG, client_id: c.id, tier: "finance-os", status: "active", effective_from: ago(24 * 30), effective_to: null, ...over });
  const got = await rows(CARD_CYCLES_SQL, [ORG, NOW.toISOString(), TEST_ADDRESS_RE], {
    clients: [maria, lapsed, unpaid, demo],
    bank_accounts: [card, manualCard, manualLoan, plaidLoan, closed, lapsedCard, demoCard],
    account_statement_cycles: [
      cycle(card, maria),
      cycle(manualCard, maria, { source: "manual" }),
      cycle(manualLoan, maria, { source: "manual", raw: {} }),
      cycle(plaidLoan, maria),
      cycle(closed, maria),
      cycle(lapsedCard, lapsed),
      cycle(card, unpaid),
      cycle(demoCard, demo)
    ],
    subscriptions: [
      sub(maria),
      sub(lapsed, { effective_to: ago(24) }),
      sub(demo),
      { ...sub(unpaid), tier: "money-helper" }
    ],
    opt_outs: [{ client_id: maria.id, channel: "sms", opted_in_at: null }]
  });
  const names = got.map((r) => r.name).sort();
  assert.deepEqual(names, ["Business Amex", "Plaid Loan", "SBA Loan"]);
  assert.ok(got.every((r) => r.sms_opted_out === true), "Maria said STOP; the flag rides on every row she owns");
  assert.equal(got.find((r) => r.name === "SBA Loan").is_loan, true);
  assert.equal(got.find((r) => r.name === "Business Amex").is_loan, false);
});

test("card texts: the job's own references are matched exactly, in this company only", async () => {
  const ref = "workflow:SMS-FINANCE-OS-CARD-DUE:card-due:acct-1:2026-10-11";
  const messages = [
    { id: uuid(), org_id: ORG, status: "delivered", blocked_reason: null, created_at: ago(18), scheduled_at: null, last_attempt_at: ago(18), provider_ref: ref },
    { id: uuid(), org_id: ORG, status: "delivered", blocked_reason: null, created_at: ago(18), scheduled_at: null, last_attempt_at: ago(18), provider_ref: `${ref}x` },
    { id: uuid(), org_id: OTHER_ORG, status: "delivered", blocked_reason: null, created_at: ago(18), scheduled_at: null, last_attempt_at: ago(18), provider_ref: ref }
  ];
  const got = await rows(CARD_TEXTS_SQL, [ORG, [ref]], { messages });
  assert.equal(got.length, 1);
  assert.equal(got[0].provider_ref, ref);
});
