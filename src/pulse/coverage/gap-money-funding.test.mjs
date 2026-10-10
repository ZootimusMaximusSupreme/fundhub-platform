// Money A lane: funded rounds, bank yes amounts, held payouts, the commission ledger, the ClickFunnels
// product map and sample rows in the live books.
//
// This file hands the lane a fake database that returns canned rows. It proves the wording, the status
// rules, the skip rules and that the lane only reads. The SQL itself is proved on a real Postgres in
// gap-money-funding.pg.test.mjs (skips without DATABASE_URL, read only, every table shadowed).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PRODUCT as CARD_STACKING_PRODUCT } from "../../funding/card-stacking-rounds.mjs";
import { OPEN_LIMIT_MS } from "../workflow-runs.mjs";
import { TRIPWIRES } from "../tripwires.mjs";
import { GAP_FILES } from "./modules.mjs";
import {
  APPROVED_NO_AMOUNT_AFTER_MS,
  APPROVED_NO_AMOUNT_SQL,
  APPROVED_UNPAID_AFTER_MS,
  APPROVED_UNPAID_SQL,
  CARD_STACKING,
  CHECK_IDS,
  FUNDED_BILL_WAIT_MS,
  FUNDED_CARDS_SQL,
  FUNDED_ROUNDS_SQL,
  HELD_PAYOUTS_SQL,
  LEDGER_RULE_SQL,
  LOOKBACK_MS,
  OPEN_VERSIONS_SQL,
  PAYOUT_HELD_AFTER_MS,
  SAMPLE_ROWS_SQL,
  SEED_CLIENT_EMAIL_RE,
  SEED_PAYMENT_REF_RE,
  SLO_PRODUCTS_SQL,
  gapChecks,
  heldReason,
  judgeApprovedNoAmount,
  judgeFundedBills,
  judgeHeldPayouts,
  judgeLedger,
  judgeSampleRows,
  judgeSloMap,
  roundProblems
} from "./gap-money-funding.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-money-funding.mjs"), "utf8");
const ORG = "00000000-0000-4000-8000-000000000a01";
const NOW = new Date("2026-10-10T15:00:00.000Z");

/* A fake database. `answers` maps the "gap:" tag at the top of each statement to the rows it returns. */
function fakeDb(answers = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      const text = String(sql);
      queries.push({ sql: text, params });
      const tag = (text.match(/gap:[a-z-]+/) || [""])[0];
      if (answers[tag] instanceof Error) throw answers[tag];
      if (typeof answers[tag] === "function") return { rows: answers[tag](params) };
      return { rows: answers[tag] || [] };
    }
  };
}

function byId(rows, id) {
  return rows.find((r) => r.id === id);
}

const CLEAN_ROUND = {
  round_id: "r1", client_id: "11111111-aaaa", client_code: "FH-000101", round_number: 1,
  card_stacking: true, has_closeout: true, bills: 1, linked_sales: 1, back_end_staff: 1,
  commission_rows: 1, confirmed_approvals: 1, fee_percent: 10, total: 1
};

/* ───────────────────────────── the lane as a whole ───────────────────────────── */

test("money lane: six checks, each PASS, FAIL or skip, in the order the board names them", async () => {
  const rows = await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW });
  assert.deepEqual(rows.map((r) => r.id), [
    "funding:funded-no-bill",
    "funding:approved-no-amount",
    "partners:payout-held",
    "commissions:ledger",
    "commissions:slo-map",
    "books:sample-rows"
  ]);
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  for (const r of rows) {
    assert.ok(["PASS", "FAIL", "skip"].includes(r.status));
    assert.equal(typeof r.detail, "string");
    assert.ok(r.detail.length > 0);
    assert.ok("suggestedFix" in r);
    assert.equal(r.status, "PASS", `${r.id}: an empty set of books is a PASS: ${r.detail}`);
    assert.equal(r.suggestedFix, null);
  }
});

test("money lane: no database, or no company id, is a skip for every check, never a PASS", async () => {
  for (const ctx of [{ orgId: ORG, now: NOW }, { db: fakeDb(), now: NOW }, { db: {}, orgId: ORG }]) {
    const rows = await gapChecks(ctx);
    assert.equal(rows.length, 6);
    for (const r of rows) {
      assert.equal(r.status, "skip");
      assert.equal(r.suggestedFix, null);
    }
  }
});

test("money lane: a read that throws is a skip with the reason, and never hides the other five", async () => {
  const db = fakeDb({
    "gap:money-approved-no-amount": new Error("relation \"applications\" does not exist"),
    "gap:money-payout-held": [{ kind: "affiliate", payout_id: "p1", who: "Jordan", amount: 125.5, hold_reason: "partner_license_unsigned", created_at: "2026-09-30T00:00:00Z", license_missing: true, tax_missing: true, total: 1 }]
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  const down = byId(rows, "funding:approved-no-amount");
  assert.equal(down.status, "skip");
  assert.match(down.detail, /does not exist/);
  assert.equal(byId(rows, "partners:payout-held").status, "FAIL");
  assert.equal(byId(rows, "funding:funded-no-bill").status, "PASS");
});

test("money lane: every statement is one SELECT, and the lane sends nothing but reads", async () => {
  const db = fakeDb();
  await gapChecks({ db, orgId: ORG, now: NOW });
  assert.equal(db.queries.length, 9, `expected all nine reads to run, saw ${db.queries.length}`);
  for (const q of db.queries) {
    const text = q.sql.replace(/\/\*[\s\S]*?\*\//g, "").trim().toLowerCase();
    assert.ok(text.startsWith("select") || text.startsWith("with"), `not a read: ${text.slice(0, 40)}`);
    assert.doesNotMatch(text, /\b(insert|update|delete|drop|alter|truncate|grant|revoke)\b/);
    assert.doesNotMatch(text, /^(begin|commit|rollback|set)\b/);
  }
});

test("money lane: the file never opens a transaction, never writes, never calls out", () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /["'`]\s*(BEGIN|COMMIT|ROLLBACK|SET)\b/i);
  assert.doesNotMatch(code, /\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(code, /\bfetch\w*\s*\(|\bhttps?:\/\//i);
  assert.doesNotMatch(code, /readFileSync|existsSync|node:fs/);
  assert.doesNotMatch(code, /from "\.\.\/\.\.\/events|sendTemplated|emit\(/);
});

/* ───────────────────────────── the numbers the lane leans on ───────────────────────────── */

test("money lane: the card-stacking value is the one the money chain writes", () => {
  assert.equal(CARD_STACKING, CARD_STACKING_PRODUCT);
});

test("money lane: the wait for a bill is the pulse's own limit for a workflow with no sleep", () => {
  assert.equal(FUNDED_BILL_WAIT_MS, OPEN_LIMIT_MS);
  assert.equal(FUNDED_BILL_WAIT_MS, 30 * 60 * 1000);
});

test("money lane: the named windows", () => {
  assert.equal(LOOKBACK_MS, 60 * 24 * 60 * 60 * 1000);
  assert.equal(APPROVED_NO_AMOUNT_AFTER_MS, 24 * 60 * 60 * 1000);
  assert.equal(PAYOUT_HELD_AFTER_MS, 24 * 60 * 60 * 1000);
  assert.equal(APPROVED_UNPAID_AFTER_MS, 35 * 24 * 60 * 60 * 1000);
});

test("money lane: the windows reach the SQL as dates, not as words", async () => {
  const db = fakeDb();
  await gapChecks({ db, orgId: ORG, now: NOW });
  const rounds = db.queries.find((q) => /gap:money-funded-rounds/.test(q.sql));
  assert.equal(rounds.params[0], ORG);
  assert.equal(rounds.params[1].getTime(), NOW.getTime() - FUNDED_BILL_WAIT_MS);
  assert.equal(rounds.params[2].getTime(), NOW.getTime() - LOOKBACK_MS);
  assert.equal(rounds.params[3], "card_stacking");
  const unpaid = db.queries.find((q) => /gap:commissions-approved-unpaid/.test(q.sql));
  assert.equal(unpaid.params[1].getTime(), NOW.getTime() - APPROVED_UNPAID_AFTER_MS);
  const held = db.queries.find((q) => /gap:money-payout-held/.test(q.sql));
  assert.equal(held.params[1].getTime(), NOW.getTime() - PAYOUT_HELD_AFTER_MS);
  const sample = db.queries.find((q) => /gap:books-sample-rows/.test(q.sql));
  assert.deepEqual(sample.params, [ORG, SEED_CLIENT_EMAIL_RE, SEED_PAYMENT_REF_RE]);
});

test("money lane: the SQL keeps demo rows out, and reads the same tests the biller reads", () => {
  for (const sql of [FUNDED_ROUNDS_SQL, FUNDED_CARDS_SQL, APPROVED_NO_AMOUNT_SQL, HELD_PAYOUTS_SQL, APPROVED_UNPAID_SQL, LEDGER_RULE_SQL, SLO_PRODUCTS_SQL, SAMPLE_ROWS_SQL]) {
    assert.match(sql, /is_demo, false\) = false/);
  }
  // The shared definitions in src/funding/success-fee.mjs, not a copy of them.
  assert.match(APPROVED_NO_AMOUNT_SQL, /a\.status = 'Approved'/);
  assert.match(APPROVED_NO_AMOUNT_SQL, /a\.approval_excluded_at IS NULL/);
  assert.match(APPROVED_NO_AMOUNT_SQL, /a\.approved_amount IS NULL OR a\.approved_amount <= 0/);
  assert.match(FUNDED_ROUNDS_SQL, /a\.approved_amount IS NOT NULL/);
  // The bill is the success-fee invoice F-07 raises, and a void one is not a bill.
  assert.match(FUNDED_ROUNDS_SQL, /i\.source = 'funding_success_fee' OR i\.invoice_type = 'success_fee'/);
  assert.match(FUNDED_ROUNDS_SQL, /i\.status NOT IN \('void', 'written_off'\)/);
  // Back end rows only, and a reversal is not a commission.
  assert.match(FUNDED_ROUNDS_SQL, /l\.basis = 'back_end'/);
  assert.match(FUNDED_ROUNDS_SQL, /l\.reverses_ledger_id IS NULL/);
  // The one board and the one stage.
  assert.match(FUNDED_CARDS_SQL, /p\.key = 'funding_card_stacking'/);
  assert.match(FUNDED_CARDS_SQL, /ps\.key = 'funded'/);
  // Bonus rules stack on purpose.
  assert.match(OPEN_VERSIONS_SQL, /r\.stacking = 'base'/);
  // Paid history is frozen and is not judged.
  assert.match(LEDGER_RULE_SQL, /l\.status IN \('earned', 'approved'\)/);
  assert.match(LEDGER_RULE_SQL, /l\.reverses_ledger_id IS NULL/);
});

/* ───────────────────────────── 1. funded with no bill ───────────────────────────── */

test("funded-no-bill: a round with its closeout, bill and commission rows is a PASS that counts it", () => {
  const v = judgeFundedBills({ rounds: [CLEAN_ROUND, { ...CLEAN_ROUND, round_id: "r2", total: 2 }].map((r) => ({ ...r, total: 2 })) });
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /2 funded rounds in the last 60 days each have its closeout, success-fee bill and commission rows/);
  assert.equal(v.suggestedFix, null);
});

test("funded-no-bill: no funded round at all says so plainly", () => {
  const v = judgeFundedBills({ rounds: [], cards: [] });
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /no round has been funded in the last 60 days/);
});

test("funded-no-bill: a funded round with no closeout is red and names the client", () => {
  const v = judgeFundedBills({ rounds: [{ ...CLEAN_ROUND, has_closeout: false }] });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /FH-000101 round 1: no closeout record/);
  assert.match(v.suggestedFix, /does not fix this/);
});

test("funded-no-bill: a funded round with no bill names why, from the facts on the round", () => {
  // Nothing confirmed on a card-stacking round.
  let p = roundProblems({ ...CLEAN_ROUND, bills: 0, confirmed_approvals: 0 });
  assert.deepEqual(p, ["no success-fee bill (no bank yes with a dollar amount is on the round)"]);
  // The round is linked to no sale.
  p = roundProblems({ ...CLEAN_ROUND, bills: 0, linked_sales: 0, fee_percent: null });
  assert.deepEqual(p, ["no success-fee bill (the round is linked to no sale, so no fee percent)"]);
  // The sale never agreed a percent.
  p = roundProblems({ ...CLEAN_ROUND, bills: 0, fee_percent: null });
  assert.deepEqual(p, ["no success-fee bill (the sale agreed no success-fee percent)"]);
  p = roundProblems({ ...CLEAN_ROUND, bills: 0, fee_percent: 0 });
  assert.deepEqual(p, ["no success-fee bill (the sale agreed no success-fee percent)"]);
  // Everything is there for a bill, so the bill workflow is the suspect.
  p = roundProblems({ ...CLEAN_ROUND, bills: 0 });
  assert.deepEqual(p, ["no success-fee bill (the bill workflow F-07 did not make one)"]);
});

test("funded-no-bill: an alt-fin round needs a bill, but no closeout and no per-bank approvals", () => {
  const alt = { ...CLEAN_ROUND, card_stacking: false, has_closeout: false, confirmed_approvals: 0, back_end_staff: 0, commission_rows: 0 };
  assert.deepEqual(roundProblems(alt), []);
  assert.deepEqual(roundProblems({ ...alt, bills: 0 }), ["no success-fee bill (the bill workflow F-07 did not make one)"]);
});

test("funded-no-bill: a round where a person excluded every bank yes bills nothing on purpose", () => {
  const onPurpose = { ...CLEAN_ROUND, has_closeout: false, bills: 0, confirmed_approvals: 0, excluded_approvals: 2, back_end_staff: 0, commission_rows: 0 };
  assert.deepEqual(roundProblems(onPurpose), []);
  // One counted approval is back to owing a bill, even if another was excluded.
  assert.deepEqual(roundProblems({ ...onPurpose, confirmed_approvals: 1 }), ["no closeout record", "no success-fee bill (the bill workflow F-07 did not make one)"]);
  // Nothing counted and nothing excluded is the real break.
  assert.deepEqual(roundProblems({ ...onPurpose, excluded_approvals: 0 }), ["no closeout record", "no success-fee bill (no bank yes with a dollar amount is on the round)"]);
  // The staff commission is still owed on the funded amount.
  assert.deepEqual(roundProblems({ ...onPurpose, back_end_staff: 1 }), ["no staff commission rows (1 staff member attributed)"]);
});

test("funded-no-bill: commission rows are owed only when someone is attributed on the back end", () => {
  assert.deepEqual(roundProblems({ ...CLEAN_ROUND, back_end_staff: 0, commission_rows: 0 }), []);
  assert.deepEqual(roundProblems({ ...CLEAN_ROUND, back_end_staff: 2, commission_rows: 0 }), ["no staff commission rows (2 staff members attributed)"]);
  assert.deepEqual(roundProblems({ ...CLEAN_ROUND, back_end_staff: 1, commission_rows: 0 }), ["no staff commission rows (1 staff member attributed)"]);
});

test("funded-no-bill: all three gaps on one round show up together", () => {
  const v = judgeFundedBills({
    rounds: [{ ...CLEAN_ROUND, has_closeout: false, bills: 0, commission_rows: 0, fee_percent: null }]
  });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /no closeout record, no success-fee bill \(the sale agreed no success-fee percent\), no staff commission rows/);
});

test("funded-no-bill: a card in Funded whose client has no funded round is red", () => {
  const v = judgeFundedBills({
    rounds: [],
    cards: [{ card_id: "c1", client_id: "22222222-bbbb", client_code: "FH-000202", entered_at: "2026-10-09T10:00:00Z", total: 1 }]
  });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /1 card sits in Funded on the card-stacking board but the client has no funded round, so nothing was billed \(FH-000202\)/);
});

test("funded-no-bill: more than three broken rounds say how many more", () => {
  const rounds = [1, 2, 3, 4, 5].map((n) => ({ ...CLEAN_ROUND, client_code: `FH-0001${n}`, round_number: n, bills: 0, total: 5 }));
  const v = judgeFundedBills({ rounds });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /5 funded rounds the money chain did not finish/);
  assert.match(v.detail, /and 2 more/);
});

test("funded-no-bill: a client with no code is named by the start of its id", () => {
  const v = judgeFundedBills({ rounds: [{ ...CLEAN_ROUND, client_code: null, client_id: "abcdef12-0000", has_closeout: false }] });
  assert.match(v.detail, /abcdef12 round 1/);
});

/* ───────────────────────────── 2. approved with no amount ───────────────────────────── */

test("approved-no-amount: none is a PASS", () => {
  const v = judgeApprovedNoAmount({ rows: [] });
  assert.equal(v.status, "PASS");
  assert.equal(v.suggestedFix, null);
});

test("approved-no-amount: a bank yes with no amount is red and names the bank, the client and the day", () => {
  const v = judgeApprovedNoAmount({
    rows: [{ application_id: "a1", bank: "Chase", client_code: "FH-000303", since: new Date("2026-10-01T09:00:00Z"), total: 1 }]
  });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /1 bank yes older than a day has no dollar amount, so it can never be billed/);
  assert.match(v.detail, /Chase \(FH-000303, since 2026-10-01\)/);
});

test("approved-no-amount: the count is the real total, not the five names shown", () => {
  const rows = [1, 2, 3, 4].map((n) => ({ application_id: `a${n}`, bank: `Bank ${n}`, client_code: `FH-${n}`, since: "2026-10-01T00:00:00Z", total: 12 }));
  const v = judgeApprovedNoAmount({ rows });
  assert.match(v.detail, /12 bank yes answers older than a day have no dollar amount/);
  assert.match(v.detail, /and 1 more/);
});

/* ───────────────────────────── 3. payouts on hold ───────────────────────────── */

test("payout-held: nothing held is a PASS", () => {
  assert.equal(judgeHeldPayouts({ rows: [] }).status, "PASS");
});

test("payout-held: the reason names the empty stamp, not just the word held", () => {
  const base = { kind: "affiliate", license_missing: false, tax_missing: false, hold_reason: "tax_form_missing" };
  assert.match(heldReason({ ...base, license_missing: true, tax_missing: true }), /partner_license_signed_at is empty\) and the tax form is not on file \(tax_form_received_at is empty/);
  assert.match(heldReason({ ...base, tax_missing: true }), /^the tax form is not on file \(tax_form_received_at is empty\)$/);
  assert.match(heldReason({ ...base, license_missing: true }), /^the partner license is not signed \(partner_license_signed_at is empty\)$/);
  assert.match(heldReason({ ...base }), /held as "tax_form_missing" but its stamps are now set, so the hold was never released/);
  assert.match(heldReason({ kind: "partner", license_missing: true, tax_missing: false }), /agreement_signed_at is empty/);
});

test("payout-held: a held payout is red with who, how much, why and since when", () => {
  const v = judgeHeldPayouts({
    rows: [
      { kind: "affiliate", payout_id: "p1", who: "Jordan Cruz", amount: 125.5, hold_reason: "partner_license_unsigned", created_at: new Date("2026-10-01T00:04:00Z"), license_missing: true, tax_missing: true, total: 2 },
      { kind: "partner", payout_id: "p2", who: "Acme Funding", amount: 1000, hold_reason: "partner_agreement_unsigned", created_at: new Date("2026-10-01T00:05:00Z"), license_missing: true, tax_missing: false, total: 2 }
    ]
  });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /2 payouts are on hold, \$1,125\.50 in all/);
  assert.match(v.detail, /Jordan Cruz \$125\.50: the partner license is not signed/);
  assert.match(v.detail, /Acme Funding \$1,000: the partner agreement is not signed/);
  assert.match(v.detail, /held since 2026-10-01/);
  assert.match(v.suggestedFix, /does not release or pay anything/);
});

/* ───────────────────────────── 4. the ledger ───────────────────────────── */

test("ledger: no rows at all is a PASS that says the ledger is empty", () => {
  const v = judgeLedger({ approved: { n: 0 }, rules: { read_rows: 0, no_rule: 0, wrong_version: 0 }, open: { scopes: 0 } });
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /the ledger has no earned or approved commission rows yet/);
});

test("ledger: rows read, nothing wrong, is a PASS with the count", () => {
  const v = judgeLedger({ approved: { n: 0 }, rules: { read_rows: 7, no_rule: 0, wrong_version: 0 }, open: { scopes: 0 } });
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /7 earned or approved rows read/);
  assert.match(v.detail, /35 days/);
});

test("ledger: approved and unpaid past the line is red with the money and the oldest day", () => {
  const v = judgeLedger({ approved: { n: 3, dollars: 1250, oldest: new Date("2026-08-30T00:00:00Z") }, rules: { read_rows: 3 }, open: { scopes: 0 } });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /3 approved commission rows \(\$1,250\) have sat unpaid for more than 35 days, the oldest approved 2026-08-30/);
  assert.match(v.suggestedFix, /does not approve, pay or change a rate/);
});

test("ledger: a row that names no rule, or a rule that was not in force, is red and counts both", () => {
  const v = judgeLedger({ approved: { n: 0 }, rules: { read_rows: 5, no_rule: 1, wrong_version: 2 }, open: { scopes: 0 } });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /3 earned or approved rows do not match a rate version \(1 name no rule, 2 name a rule that was not in force on the sale date\)/);
});

test("ledger: one pay scope with two open versions is red", () => {
  const v = judgeLedger({ approved: { n: 0 }, rules: { read_rows: 1 }, open: { scopes: 1 } });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /1 pay scope has more than one open rate version/);
});

test("ledger: all three breaks together are all named", () => {
  const v = judgeLedger({ approved: { n: 1, dollars: 10, oldest: "2026-08-01T00:00:00Z" }, rules: { no_rule: 1 }, open: { scopes: 2 } });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /unpaid/);
  assert.match(v.detail, /rate version/);
  assert.match(v.detail, /2 pay scopes have more than one open rate version/);
});

/* ───────────────────────────── 5. the ClickFunnels map ───────────────────────────── */

test("slo-map: nothing sold through ClickFunnels is a PASS that says there is nothing to judge", () => {
  const v = judgeSloMap({ rows: [] });
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /no product has been sold through ClickFunnels/);
});

test("slo-map: a sold product with a map and a rule is a PASS", () => {
  const v = judgeSloMap({ rows: [{ product_id: "p1", product: "slo-roadmap", sales: 4, mapped: true, ruled: true }] });
  assert.equal(v.status, "PASS");
  assert.match(v.detail, /1 product sold through ClickFunnels in the last 60 days, and each has an active map and a commission rule/);
});

test("slo-map: a sold product with no active map is red, and says the next order is turned away", () => {
  const v = judgeSloMap({ rows: [{ product_id: "p1", product: "slo-roadmap", sales: 4, mapped: false, ruled: true }] });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /slo-roadmap \(sold 4 times\): no active map, so the next paid order for it is turned away/);
});

test("slo-map: a sold product with no open commission rule is red", () => {
  const v = judgeSloMap({ rows: [{ product_id: "p1", product: "slo-roadmap", sales: 1, mapped: true, ruled: false }] });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /slo-roadmap \(sold 1 time\): no commission rule is open for it/);
});

test("slo-map: two sale motions of one product are judged on the worse one, once", () => {
  const v = judgeSloMap({
    rows: [
      { product_id: "p1", product: "slo-roadmap", sales: 3, mapped: true, ruled: true },
      { product_id: "p1", product: "slo-roadmap", sales: 1, mapped: true, ruled: false }
    ]
  });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /1 ClickFunnels product is not set up/);
  assert.match(v.detail, /sold 4 times/);
});

/* ───────────────────────────── 6. sample rows ───────────────────────────── */

test("sample-rows: nothing from the seed tool is a PASS", () => {
  const v = judgeSampleRows({ counts: { clients: 0, payments: 0, sales: 0, commission_rows: 0, invoices: 0, messages: 0 } });
  assert.equal(v.status, "PASS");
  assert.equal(v.suggestedFix, null);
});

test("sample-rows: the sample client and its fake money are red and counted", () => {
  const v = judgeSampleRows({
    counts: { clients: 2, payments: 4, payment_dollars: 6064, sales: 2, sale_dollars: 6000, commission_rows: 0, invoices: 0, messages: 3 }
  });
  assert.equal(v.status, "FAIL");
  assert.match(v.detail, /2 sample clients, 4 sample payments \(\$6,064\), 2 sales \(\$6,000\), 3 messages/);
  assert.match(v.detail, /count toward real totals/);
  assert.match(v.suggestedFix, /does not delete anything/);
});

test("sample-rows: the seed patterns match what api/dashboard/seed.mjs writes, and nothing else", () => {
  const email = new RegExp(SEED_CLIENT_EMAIL_RE);
  const ref = new RegExp(SEED_PAYMENT_REF_RE);
  assert.equal(email.test("sample+1790000000000@fundhub.demo"), true);
  assert.equal(email.test("maria.lopez@gmail.com"), false);
  assert.equal(email.test("sample+abc@fundhub.demo"), false);
  assert.equal(ref.test("seed_t32_1790000000000"), true);
  assert.equal(ref.test("seed_tdep_1790000000000"), true);
  // The sim receipts are a different tool's test money, and are not counted here.
  assert.equal(ref.test("sim-pay-1790742620460"), false);
  // The seed tool still writes exactly these shapes.
  const seed = fs.readFileSync(path.join(HERE, "../../../api/dashboard/seed.mjs"), "utf8");
  assert.match(seed, /`sample\+\$\{stamp\}@fundhub\.demo`/);
  assert.match(seed, /`seed_t32_\$\{stamp\}`/);
  assert.match(seed, /`seed_tdep_\$\{stamp\}`/);
});

/* ───────────────────────────── the map, the list, the tripwires ───────────────────────────── */

test("money lane: it is on the named list the live bundle reads", () => {
  assert.ok(GAP_FILES.some(([name]) => name === "gap-money-funding.mjs"));
});

test("money lane: every id has a place in the tripwire map, and every surface the board named is sorted", () => {
  const named = new Set(Object.values(TRIPWIRES).flatMap((t) => t.checks));
  for (const id of CHECK_IDS) assert.ok(named.has(id), `${id} is not named by any tripwire`);
  const wanted = [
    "route:pipeline-cards", "route:applications", "route:commissions", "route:commission-rules",
    "route:slo-connections", "route:dashboard/seed", "route:read/affiliates",
    "desk:products-commissions.html", "desk:client-control-panel.html", "desk:affiliate.html"
  ];
  for (const key of wanted) {
    assert.ok(TRIPWIRES[key], `${key} is not in TRIPWIRES`);
    assert.equal(TRIPWIRES[key].impact, "money");
    assert.ok(TRIPWIRES[key].checks.some((id) => CHECK_IDS.includes(id)), `${key} names none of the six money checks`);
  }
  assert.ok(TRIPWIRES["route:pipeline-cards"].checks.includes("funding:funded-no-bill"));
});
