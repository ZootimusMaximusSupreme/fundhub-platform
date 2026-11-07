// Real-Postgres test for the application and approval tracker (migration 576,
// src/finance/applications-tracker.mjs).
//
// SKIPS unless DATABASE_URL is set, like every other .pg.test.mjs here. Run it
// only against a scratch database (CI builds one from db/migrations). Never
// against the live database: it writes and then removes its own fixture client.
//
// WHAT THIS PROVES THAT THE STUB TEST CANNOT.
//   - 576's CHECKs exist and bite: an amount only on an approval, never 0, the
//     answer day never before the day applied, last 4 is 2-4 digits.
//   - The unique index lets one application have one account, even when two
//     writers race past the first look.
//   - The real hook: a staff bank answer of Approved through setApplicationStatus
//     puts the card on the client's accounts with its limit and no balance.
//   - The real Plaid claim: saveAccounts turns the stand-in into the Plaid row in
//     place — one row, same id — and the raw merge keeps the application link.
//   - bigint columns come back as strings; the read still answers in numbers.

import { test, before, after } from "node:test";
import assert from "node:assert";

import { db, close } from "../db.mjs";
import {
  readTrackInput, addTrackedApplication, readApplicationsTracker, ensureApprovedAccount, fromSelfRow
} from "./applications-tracker.mjs";
import { setApplicationStatus } from "../applications/status.mjs";
import { saveAccounts } from "../banking/accounts-store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const NOW = new Date("2026-11-07T18:00:00Z");

let orgId = null;
let clientId = null;

before(async () => {
  if (!HAS_DB) return;
  orgId = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0]?.id;
  assert.ok(orgId, "the default org must exist — run the migrations");
  clientId = (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Tracker', 'Scratch') RETURNING id`, [orgId]
  )).rows[0].id;
});

after(async () => {
  if (!HAS_DB) return;
  // Cascades clear finance_applications, bank_accounts, plaid_items and funding_rounds (and their applications).
  if (clientId) await db.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
  await close();
});

const insertSelf = (cols) => db.query(
  `INSERT INTO finance_applications (org_id, client_id, bank, kind, applied_on, status, approved_cents, decided_on, last4, entered_by)
   VALUES ($1, $2, 'Chase', 'card', $3::date, $4, $5, $6::date, $7, 'client')`,
  [orgId, clientId, cols.applied_on ?? "2026-10-01", cols.status ?? "applied", cols.approved_cents ?? null, cols.decided_on ?? null, cols.last4 ?? null]
);

test("576's rules live in the database and bite", { skip: !HAS_DB }, async () => {
  const refused = async (cols, name) => {
    await assert.rejects(insertSelf(cols), (e) => e.code === "23514" && String(e.constraint || e.message).includes(name), name);
  };
  await refused({ status: "applied", approved_cents: 500000 }, "finance_applications_amount_only_approved_ck");
  await refused({ status: "approved", approved_cents: 0 }, "finance_applications_approved_ck");
  await refused({ status: "pending", decided_on: "2026-10-05" }, "finance_applications_decided_only_answered_ck");
  await refused({ status: "denied", decided_on: "2026-09-01" }, "finance_applications_decided_after_applied_ck");
  await refused({ status: "approved", last4: "12345" }, "finance_applications_last4_ck");
  await refused({ status: "funded" }, "finance_applications_status_ck");
  await insertSelf({ status: "approved", approved_cents: 500000, decided_on: "2026-10-08", last4: "4321" });
});

test("an approved card the client adds lands on their accounts once — the index refuses a second", { skip: !HAS_DB }, async () => {
  const input = readTrackInput({ bank: "Navy Federal", product: "Business Card", kind: "card", applied_on: "2026-10-03",
    status: "approved", approved_amount: "7500", last4: "9876" }, { now: NOW });
  const out = await addTrackedApplication(db, { orgId, clientId, by: { kind: "client" }, input, now: NOW });
  assert.equal(out.account.status, "added");
  const acct = (await db.query(`SELECT * FROM bank_accounts WHERE id = $1`, [out.account.account_id])).rows[0];
  assert.equal(acct.provider, "manual");
  assert.equal(acct.account_type, "credit");
  assert.equal(String(acct.credit_limit_cents), "750000");
  assert.equal(acct.current_balance_cents, null, "unknown stays null, never 0");
  assert.equal(acct.mask, "9876");
  assert.deepEqual([acct.raw.fundhub_application.kind, acct.raw.fundhub_application.id], ["self", out.id]);

  const row = (await db.query(`SELECT * FROM finance_applications WHERE id = $1`, [out.id])).rows[0];
  const again = await ensureApprovedAccount(db, { orgId, clientId, app: fromSelfRow(row), now: NOW });
  assert.deepEqual(again, { status: "exists", account_id: out.account.account_id });
  await assert.rejects(
    db.query(`INSERT INTO bank_accounts (org_id, client_id, name, account_type, raw) VALUES ($1, $2, 'copy', 'credit', $3)`,
      [orgId, clientId, JSON.stringify({ fundhub_application: { kind: "self", id: out.id } })]),
    (e) => e.code === "23505", "bank_accounts_fundhub_application_uq keeps one account per application"
  );
});

test("a staff bank answer of Approved puts the card on the client's accounts, through the real status writer", { skip: !HAS_DB }, async () => {
  const round = (await db.query(
    `INSERT INTO funding_rounds (org_id, client_id, round_number, status, product) VALUES ($1, $2, 1, 'open', 'card_stacking') RETURNING id`,
    [orgId, clientId])).rows[0].id;
  const app = (await db.query(
    `INSERT INTO applications (org_id, funding_round_id, client_id, bank, lender_name, product_name, lender_table, status, submitted_date)
     VALUES ($1, $2, $3, 'Chase', 'Chase', 'Ink Business Cash', 'OnlineBizCC', 'Applied', DATE '2026-10-01') RETURNING id`,
    [orgId, round, clientId])).rows[0].id;
  await setApplicationStatus(db, { orgId, applicationId: app, status: "Approved", patch: { approved_amount: "10000.00" } });
  const acct = (await db.query(
    `SELECT * FROM bank_accounts WHERE client_id = $1 AND raw->'fundhub_application'->>'id' = $2`, [clientId, app])).rows[0];
  assert.ok(acct, "the approval added the account");
  assert.equal(acct.raw.fundhub_application.kind, "fundhub");
  assert.equal(String(acct.credit_limit_cents), "1000000");
  assert.equal(acct.name, "Chase Ink Business Cash");
  const view = await readApplicationsTracker(db, { orgId, clientId });
  const chase = view.rows.find((r) => r.id === app);
  assert.equal(chase.status, "approved");
  assert.equal(chase.approved_cents, 1000000, "a number, not the string pg hands back");
  assert.equal(chase.account_state, "added");
  assert.equal(chase.can_edit, false);
});

test("when Plaid first reads the card, the stand-in becomes the Plaid row in place", { skip: !HAS_DB }, async () => {
  const item = (await db.query(
    `INSERT INTO plaid_items (org_id, client_id, plaid_item_id, institution_name, encrypted_access_token, consent_granted_at, link_state)
     VALUES ($1, $2, $3, 'Chase', 'inert-test-ciphertext', '2026-11-07T10:00:00Z', 'active') RETURNING id`,
    [orgId, clientId, `tracker-fixture-${clientId}`])).rows[0].id;
  const standIn = (await db.query(
    `SELECT id FROM bank_accounts WHERE client_id = $1 AND raw->'fundhub_application'->>'kind' = 'fundhub'`, [clientId])).rows[0].id;
  // The stand-in from the test above has no last 4, and this read shows one new
  // Chase card: it is that card.
  await saveAccounts(db, [
    { providerAccountId: "tracker-ink", name: "INK BUSINESS CASH", mask: "4321", accountType: "credit", accountSubtype: "credit card",
      currencyCode: "USD", currentBalanceCents: 25000, creditLimitCents: 1000000, raw: { plaid_environment: "sandbox" } }
  ], { orgId, clientId, provider: "plaid", plaidItemId: item });
  const rows = (await db.query(`SELECT * FROM bank_accounts WHERE client_id = $1 AND plaid_item_id = $2`, [clientId, item])).rows;
  assert.equal(rows.length, 1, "one row for the card, not two");
  assert.equal(rows[0].id, standIn, "the same row, so its history stays");
  assert.equal(rows[0].provider, "plaid");
  assert.equal(String(rows[0].current_balance_cents), "25000");
  assert.equal(rows[0].raw.fundhub_application.kind, "fundhub", "the link survives the Plaid merge");
  assert.ok(rows[0].raw.fundhub_application.plaid_seen_at);
  const view = await readApplicationsTracker(db, { orgId, clientId });
  assert.equal(view.rows.find((r) => r.source === "fundhub").account_state, "plaid");
});
