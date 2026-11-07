// The application and approval tracker (src/finance/applications-tracker.mjs).
//
// Pure rules first, each with a case that passes and a case that would fail if
// the rule broke. Then the writes against an in-memory stand-in for the four
// tables the tracker touches (unknown SQL throws), then the Plaid claim through
// the real account store (saveAccounts) and its fake (plaid-fake-db.mjs), then
// migration 576's text. The sample is one person: a client who applied to Chase
// for a business card and to a credit union for a loan.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  fundhubStatus, kindFromLenderTable, ownerFromLenderTable, sameBank, bankTokens,
  standInPlan, matchPlaidForApproval, matchStandInsForPlaid, readTrackInput, readTrackUpdate,
  summarize, trackerRow, fromFundhubRow, fromSelfRow, dollarsColumnToCents, centsOf,
  addTrackedApplication, updateTrackedApplication, addAccountForApplication, readApplicationsTracker,
  syncApprovedApplication, ensureApprovedAccount, TrackInputError, STATUS_WORDS
} from "./applications-tracker.mjs";
import { saveAccounts } from "../banking/accounts-store.mjs";
import { fakeBankDb } from "../banking/plaid-fake-db.mjs";
import { bankKey } from "../banking/institution-logos.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(path.resolve(HERE, "../../db/migrations/576_finance_applications.sql"), "utf8");

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const OTHER_CLIENT = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-07T18:00:00Z");

/* ── an in-memory stand-in for the tables the tracker reads and writes ──── */

function trackerDb({ applications = [], lenders = [], accounts = [], items = [], institutions = [] } = {}) {
  const t = { applications: applications.map((a) => ({ ...a })), self: [], accounts: accounts.map((a) => ({ provider: "manual", closed_at: null, raw: {}, ...a })), items, lenders };
  const calls = [];
  const linkOf = (a) => (a.raw && a.raw.fundhub_application) || null;
  const db = {
    t, calls,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      calls.push(s);
      if (/^SAVEPOINT|^RELEASE SAVEPOINT|^ROLLBACK TO SAVEPOINT/.test(s)) return { rows: [] };
      if (/FROM applications a WHERE a\.org_id = \$1::uuid AND a\.client_id = \$2::uuid/.test(s)) {
        return { rows: t.applications.filter((a) => a.org_id === params[0] && a.client_id === params[1]) };
      }
      if (/FROM applications a WHERE a.id = \$1::uuid/.test(s)) {
        return { rows: t.applications.filter((a) => a.id === params[0] && a.org_id === params[1] && a.client_id === params[2]) };
      }
      if (/^SELECT .* FROM finance_applications WHERE org_id = \$1::uuid AND client_id = \$2::uuid ORDER BY/.test(s)) {
        return { rows: t.self.filter((r) => r.org_id === params[0] && r.client_id === params[1]) };
      }
      if (/^SELECT .* FROM finance_applications WHERE id = \$1::uuid AND org_id = \$2::uuid AND client_id = \$3::uuid/.test(s)) {
        return { rows: t.self.filter((r) => r.id === params[0] && r.org_id === params[1] && r.client_id === params[2]) };
      }
      if (/^INSERT INTO finance_applications/.test(s)) {
        const [org_id, client_id, bank, product, kind, owner_kind, applied_on, requested_cents, status, approved_cents, decided_on, last4, entered_by, entered_by_id] = params;
        if (approved_cents !== null && status !== "approved") throw Object.assign(new Error("finance_applications_amount_only_approved_ck"), { code: "23514" });
        const row = { id: crypto.randomUUID(), org_id, client_id, bank, product, kind, owner_kind, applied_on, requested_cents: requested_cents === null ? null : String(requested_cents),
          status, approved_cents: approved_cents === null ? null : String(approved_cents), decided_on, last4, entered_by, entered_by_id, created_at: NOW, updated_at: NOW };
        t.self.push(row);
        return { rows: [{ ...row }] };
      }
      if (/^UPDATE finance_applications SET status = \$4/.test(s)) {
        const row = t.self.find((r) => r.id === params[0] && r.org_id === params[1] && r.client_id === params[2]);
        if (!row) return { rows: [] };
        Object.assign(row, { status: params[3], approved_cents: params[4] === null ? null : String(params[4]), decided_on: params[5], last4: params[6] });
        return { rows: [{ ...row }] };
      }
      if (/^SELECT id, name, mask, provider, closed_at, raw->'fundhub_application' AS link FROM bank_accounts/.test(s)) {
        return { rows: t.accounts.filter((a) => a.org_id === params[0] && a.client_id === params[1] && linkOf(a))
          .map((a) => ({ id: a.id, name: a.name, mask: a.mask, provider: a.provider, closed_at: a.closed_at, link: linkOf(a) })) };
      }
      // The shared logo lookup (src/banking/institution-logos.mjs findLogos): Plaid's saved logos, then the bank book.
      if (/^SELECT plaid_institution_id, name_key, logo_base64 FROM plaid_institutions WHERE logo_base64 IS NOT NULL/.test(s)) {
        const [ids, keys] = params;
        return { rows: institutions.filter((r) => r.logo_base64 && (ids.includes(r.plaid_institution_id) || keys.includes(r.name_key))) };
      }
      if (/^SELECT id, regexp_replace\(.+\) AS name_key, logo_path FROM lenders WHERE org_id = \$1::uuid AND logo_path IS NOT NULL/.test(s)) {
        const [org, ids, keys] = params;
        return { rows: lenders.filter((l) => l.org_id === org && l.logo_path && !l.is_demo && (ids.includes(l.id) || keys.includes(bankKey(l.name))))
          .map((l) => ({ id: l.id, name_key: bankKey(l.name), logo_path: l.logo_path })) };
      }
      if (/^SELECT a.id, a.name, a.mask, a.account_type, a.account_subtype, a.created_at, a.closed_at, \(a.raw \? 'fundhub_application'\) AS linked, i.institution_name/.test(s)) {
        return { rows: t.accounts.filter((a) => a.org_id === params[0] && a.client_id === params[1] && a.provider === "plaid" && !a.closed_at && ["credit", "loan"].includes(a.account_type))
          .map((a) => ({ ...a, linked: !!linkOf(a), institution_name: (items.find((i) => i.id === a.plaid_item_id) || {}).institution_name || null })) };
      }
      if (/^SELECT id FROM bank_accounts WHERE org_id = \$1::uuid AND client_id = \$2::uuid AND raw->'fundhub_application'->>'kind' = \$3/.test(s)) {
        return { rows: t.accounts.filter((a) => a.org_id === params[0] && a.client_id === params[1] && linkOf(a) && linkOf(a).kind === params[2] && linkOf(a).id === params[3]).map((a) => ({ id: a.id })) };
      }
      if (/^UPDATE bank_accounts SET raw = COALESCE\(raw, '\{\}'::jsonb\) \|\| jsonb_build_object\('fundhub_application', \$4::jsonb\)/.test(s)) {
        const a = t.accounts.find((x) => x.id === params[0] && x.org_id === params[1] && x.client_id === params[2] && !linkOf(x));
        if (!a) return { rows: [] };
        a.raw = { ...(a.raw || {}), fundhub_application: JSON.parse(params[3]) };
        return { rows: [{ id: a.id }] };
      }
      if (/^INSERT INTO bank_accounts \(org_id, client_id, plaid_item_id, plaid_account_id, name/.test(s)) {
        const cols = ["org_id", "client_id", "plaid_item_id", "plaid_account_id", "name", "official_name", "mask", "account_type", "account_subtype",
          "currency_code", "available_balance_cents", "current_balance_cents", "credit_limit_cents", "balance_as_of", "raw"];
        const row = { id: crypto.randomUUID(), provider: "manual", closed_at: null, created_at: NOW };
        cols.forEach((c, i) => { row[c] = params[i]; });
        row.raw = JSON.parse(row.raw);
        const l = linkOf(row);
        if (l && t.accounts.some((a) => a.org_id === row.org_id && linkOf(a) && linkOf(a).kind === l.kind && linkOf(a).id === l.id)) {
          throw Object.assign(new Error("duplicate key value violates unique constraint bank_accounts_fundhub_application_uq"), { code: "23505" });
        }
        t.accounts.push(row);
        return { rows: [{ ...row }] };
      }
      throw new Error(`tracker fake: unexpected SQL: ${s.slice(0, 160)}`);
    }
  };
  return db;
}

const fundhubApp = (over = {}) => ({
  id: "c0000000-0000-4000-8000-000000000011", org_id: ORG, client_id: CLIENT, bank: "Chase", lender_name: "Chase",
  lender_id: "d0000000-0000-4000-8000-000000000001", product_name: "Ink Business Cash", lender_table: "OnlineBizCC",
  status: "Approved", approved_amount: "10000.00", requested_amount: "15000.00", submitted_date: new Date(2026, 9, 1),
  status_updated_date: new Date("2026-10-08T17:00:00Z"), approval_excluded_at: null, created_at: new Date("2026-09-30T17:00:00Z"), ...over
});
const BOOK = [
  { id: "d0000000-0000-4000-8000-000000000001", org_id: ORG, name: "Chase", logo_path: "/assets/lenders/chase.png" },
  { id: "d0000000-0000-4000-8000-000000000002", org_id: ORG, name: "Bank of America", logo_path: "/assets/lenders/bank-of-america.png" }
];

/* ── pure rules ────────────────────────────────────────────────────────────── */

test("a Fundhub application's status maps onto the five chips, and an unknown one onto none", () => {
  assert.equal(fundhubStatus("Apply"), "planned");
  assert.equal(fundhubStatus("Applied"), "applied");
  assert.equal(fundhubStatus("Missing Docs"), "pending");
  assert.equal(fundhubStatus("Action Required"), "pending");
  assert.equal(fundhubStatus("Approved"), "approved");
  assert.equal(fundhubStatus("Denied"), "denied");
  assert.equal(fundhubStatus("Funded"), null, "a value the table never holds is not guessed");
  assert.equal(STATUS_WORDS.approved, "Approved");
});

test("the lender table says card, line or loan, and business or personal", () => {
  assert.equal(kindFromLenderTable("OnlineBizCC"), "card");
  assert.equal(kindFromLenderTable("PersonalCC"), "card");
  assert.equal(kindFromLenderTable("BizLOC_Stated"), "line");
  assert.equal(kindFromLenderTable("PersonalLOC"), "line");
  assert.equal(kindFromLenderTable("PersonalLoans"), "loan");
  assert.equal(kindFromLenderTable(null), null);
  assert.equal(ownerFromLenderTable("InBranchBizCC"), "business");
  assert.equal(ownerFromLenderTable("PersonalLOC"), "personal");
  assert.equal(ownerFromLenderTable(null), null);
});

test("one bank, many spellings — and two banks never match on the word 'bank'", () => {
  assert.deepEqual(bankTokens("JPMorgan Chase Bank, N.A."), ["chase", "jpmorgan"]);
  assert.ok(sameBank("Chase", "JPMorgan Chase Bank, N.A."));
  assert.ok(sameBank("Bank of America", "Bank of America"));
  assert.ok(!sameBank("Chase", "Bank of America"));
  assert.ok(!sameBank("Bank of Hope", "Bank of America"), "shared noise words do not make a match");
  assert.ok(!sameBank("", "Chase"));
  assert.ok(sameBank("Amex", "American Express"), "the short name a person types still finds Plaid's name");
  assert.ok(sameBank("BofA", "Bank of America"));
  assert.ok(!sameBank("Amex", "Capital One"));
  assert.ok(!sameBank("Boat Bank", "Bank of America"), "only the whole word is a short name");
});

/* ── the bank's logo: the shared identity check (Codex CX12) ──────────────── */

/* A real 1x1 PNG in base64, the kind of string Plaid sends. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const selfApp = (bank, day) => readTrackInput({ bank, kind: "card", applied_on: day, status: "applied" }, { now: NOW });

test("the exact bank gets its own logo; a near name never borrows another bank's", async () => {
  const book = [...BOOK, { id: "d0000000-0000-4000-8000-000000000003", org_id: ORG, name: "First Citizens Bank", logo_path: "/assets/lenders/first-citizens-bank.png" }];
  const db = trackerDb({ lenders: book });
  await addTrackedApplication(db, { orgId: ORG, clientId: CLIENT, now: NOW, input: selfApp("CHASE", "2026-11-01") });
  await addTrackedApplication(db, { orgId: ORG, clientId: CLIENT, now: NOW, input: selfApp("First National Bank", "2026-11-02") });
  await addTrackedApplication(db, { orgId: ORG, clientId: CLIENT, now: NOW, input: selfApp("Navy Federal", "2026-11-03") });
  const by = Object.fromEntries((await readApplicationsTracker(db, { orgId: ORG, clientId: CLIENT })).rows.map((r) => [r.bank, r.logo_url]));
  assert.equal(by.CHASE, "/assets/lenders/chase.png", "the same name, any case, is the same bank");
  assert.equal(by["First National Bank"], null, "First National Bank is not First Citizens Bank: name only");
  assert.equal(by["Navy Federal"], null, "no book row, no logo — never a drawn one");
});

test("a name that points at two logos gets none; a lender id still matches exactly", async () => {
  const twins = [
    { id: "d0000000-0000-4000-8000-000000000004", org_id: ORG, name: "First National Bank", logo_path: "/assets/lenders/fnb-omaha.png" },
    { id: "d0000000-0000-4000-8000-000000000005", org_id: ORG, name: "First National Bank", logo_path: "/assets/lenders/fnb-alaska.png" }
  ];
  const db = trackerDb({ lenders: twins, applications: [fundhubApp({ bank: "First National Bank", lender_name: "First National Bank", lender_id: twins[1].id })] });
  await addTrackedApplication(db, { orgId: ORG, clientId: CLIENT, now: NOW, input: selfApp("First National Bank", "2026-11-02") });
  const rows = (await readApplicationsTracker(db, { orgId: ORG, clientId: CLIENT })).rows;
  assert.equal(rows.find((r) => r.source === "self").logo_url, null, "two banks share the name: name only");
  assert.equal(rows.find((r) => r.source === "fundhub").logo_url, "/assets/lenders/fnb-alaska.png", "the round's own lender id picks its logo");
});

test("Plaid's logo comes first; the bank book is next; a failed lookup is the name alone", async () => {
  const institutions = [{ plaid_institution_id: "ins_56", name_key: "chase", logo_base64: PNG }];
  const plaid = await readApplicationsTracker(trackerDb({ applications: [fundhubApp()], lenders: BOOK, institutions }), { orgId: ORG, clientId: CLIENT });
  assert.equal(plaid.rows[0].logo_url, `data:image/png;base64,${PNG}`);
  const book = await readApplicationsTracker(trackerDb({ applications: [fundhubApp()], lenders: BOOK }), { orgId: ORG, clientId: CLIENT });
  assert.equal(book.rows[0].logo_url, "/assets/lenders/chase.png");
  const db = trackerDb({ applications: [fundhubApp()], lenders: BOOK });
  const query = db.query;
  db.query = async (sql, params) => { if (/plaid_institutions|AS name_key/.test(sql)) throw new Error("connection reset"); return query(sql, params); };
  const failed = await readApplicationsTracker(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(failed.rows.length, 1, "the list still loads");
  assert.equal(failed.rows[0].logo_url, null);
});

test("money: a dollars column and a bigint column turn into cents; unknown stays null, never 0", () => {
  assert.equal(dollarsColumnToCents("10000.00"), 1000000);
  assert.equal(dollarsColumnToCents("450.10"), 45010);
  assert.equal(dollarsColumnToCents(null), null);
  assert.equal(dollarsColumnToCents("0.00"), null, "a zero approval is not an amount");
  assert.equal(centsOf("1000000"), 1000000);
  assert.equal(centsOf(null), null);
});

test("only an approved card or line of credit that still counts adds an account", () => {
  const card = fromFundhubRow(fundhubApp());
  assert.deepEqual(standInPlan(card), {
    name: "Chase Ink Business Cash", mask: null, account_type: "credit", account_subtype: "credit card", credit_limit_cents: 1000000
  });
  assert.equal(standInPlan(fromFundhubRow(fundhubApp({ status: "Applied" }))), null);
  assert.equal(standInPlan(fromFundhubRow(fundhubApp({ status: "Denied" }))), null);
  assert.equal(standInPlan(fromFundhubRow(fundhubApp({ lender_table: "PersonalLoans" }))), null, "a loan is not added for them");
  assert.equal(standInPlan(fromFundhubRow(fundhubApp({ approval_excluded_at: new Date() }))), null, "an approval that does not count adds nothing");
  const noAmount = standInPlan(fromFundhubRow(fundhubApp({ approved_amount: null })));
  assert.equal(noAmount.credit_limit_cents, null, "an approval with no amount keeps its limit unknown, never 0");
  assert.equal(standInPlan(fromFundhubRow(fundhubApp({ lender_table: "BizLOC_Stated" }))).account_subtype, "line of credit");
});

test("approval after Plaid: the same last 4 links; a new card at the same bank links; two possible cards ask instead", () => {
  const app = { ...fromFundhubRow(fundhubApp()), last4: null };
  const old = { id: "a1", institution_name: "Chase", account_type: "credit", account_subtype: "credit card", mask: "1111", created_at: new Date("2025-01-01T12:00:00Z"), linked: false };
  const fresh = { id: "a2", institution_name: "Chase", account_type: "credit", account_subtype: "credit card", mask: "4321", created_at: new Date("2026-10-09T12:00:00Z"), linked: false };
  const boa = { id: "a3", institution_name: "Bank of America", account_type: "credit", account_subtype: "credit card", mask: "4321", created_at: new Date("2026-10-09T12:00:00Z"), linked: false };
  assert.equal(matchPlaidForApproval(app, [old, fresh, boa]).pick.id, "a2", "the older card at the same bank is not this one");
  assert.deepEqual(matchPlaidForApproval(app, [old, boa]), { pick: null, ambiguous: false }, "only an old card: add a stand-in");
  const twoNew = { ...fresh, id: "a4", mask: "9999" };
  assert.deepEqual(matchPlaidForApproval(app, [fresh, twoNew]), { pick: null, ambiguous: true });
  assert.equal(matchPlaidForApproval({ ...app, last4: "9999" }, [fresh, twoNew]).pick.id, "a4", "the last 4 settles it");
  assert.deepEqual(matchPlaidForApproval({ ...app, last4: "5555" }, [fresh, twoNew]), { pick: null, ambiguous: false });
  assert.equal(matchPlaidForApproval(app, [{ ...fresh, linked: true }]).pick, null, "a card already tied to an application is not taken twice");
});

test("Plaid after approval: a stand-in pairs with its own card, once, and never with another bank's", () => {
  const masked = { id: "s1", mask: "4321", account_type: "credit", account_subtype: "credit card", link: { bank: "Chase" } };
  const bare = { id: "s2", mask: null, account_type: "credit", account_subtype: "credit card", link: { bank: "Chase" } };
  const incoming = [
    { providerAccountId: "p1", mask: "4321", accountType: "credit", accountSubtype: "credit card" },
    { providerAccountId: "p2", mask: "7777", accountType: "credit", accountSubtype: "credit card" },
    { providerAccountId: "p3", mask: "0001", accountType: "depository", accountSubtype: "checking" }
  ];
  const pairs = matchStandInsForPlaid([masked, bare], incoming, "Chase");
  assert.deepEqual(pairs.map((p) => [p.standIn.id, p.account.providerAccountId]), [["s1", "p1"], ["s2", "p2"]]);
  assert.deepEqual(matchStandInsForPlaid([masked, bare], incoming, "Bank of America"), [], "another bank's read claims nothing");
  const twoBare = [bare, { ...bare, id: "s3" }];
  assert.deepEqual(matchStandInsForPlaid(twoBare, incoming.slice(1), "Chase"), [], "two cards with no last 4 at one bank: leave them");
  assert.deepEqual(matchStandInsForPlaid([bare], incoming, "Chase").length, 0, "two new cards and no last 4: leave it");
});

test("the add form: what is required, what is refused, and nothing invented", () => {
  const ok = readTrackInput({ bank: " Chase ", product: "Ink Business Cash", kind: "card", owner_kind: "business", applied_on: "2026-10-01",
    requested_amount: "$15,000", status: "approved", approved_amount: "10000", last4: "4321", decided_on: "2026-10-08" }, { now: NOW });
  assert.deepEqual(ok, { bank: "Chase", product: "Ink Business Cash", kind: "card", owner_kind: "business", applied_on: "2026-10-01",
    requested_cents: 1500000, status: "approved", approved_cents: 1000000, last4: "4321", decided_on: "2026-10-08" });
  const bare = readTrackInput({ bank: "Chase", kind: "loan", applied_on: "2026-10-01" }, { now: NOW });
  assert.equal(bare.status, "applied");
  assert.equal(bare.requested_cents, null, "blank asked-for amount stays unknown");
  const refuse = (body, code) => assert.throws(() => readTrackInput({ bank: "Chase", kind: "card", applied_on: "2026-10-01", ...body }, { now: NOW }),
    (e) => e instanceof TrackInputError && e.code === code, code);
  refuse({ bank: "" }, "bank_required");
  refuse({ kind: "mortgage" }, "invalid_kind");
  refuse({ applied_on: "" }, "applied_on_required");
  refuse({ applied_on: "2026-11-08" }, "invalid_applied_on");
  refuse({ applied_on: "2026-02-30" }, "invalid_applied_on");
  refuse({ requested_amount: "0" }, "invalid_requested_amount");
  refuse({ status: "approved", approved_amount: "-5" }, "invalid_approved_amount");
  refuse({ status: "applied", approved_amount: "5000" }, "amount_only_on_approval");
  refuse({ status: "pending", decided_on: "2026-10-05" }, "decided_only_on_answer");
  refuse({ status: "denied", decided_on: "2026-09-01" }, "invalid_decided_on");
  refuse({ status: "approved", last4: "4111111111111111" }, "invalid_last4");
  refuse({ owner_kind: "joint" }, "invalid_owner_kind");
  refuse({ status: "funded" }, "invalid_status");
  assert.equal(readTrackUpdate({ status: "denied", decided_on: "2026-10-03" }, { appliedOn: "2026-10-01", now: NOW }).status, "denied");
});

test("the list counts applications and never adds approved limits together", () => {
  const rows = [
    trackerRow(fromFundhubRow(fundhubApp())),
    trackerRow(fromFundhubRow(fundhubApp({ id: "x2", status: "Denied" }))),
    trackerRow(fromSelfRow({ id: "x3", bank: "Desert Credit Union", kind: "loan", applied_on: "2026-10-02", status: "pending" }))
  ];
  assert.deepEqual(summarize(rows), { total: 3, planned: 0, applied: 0, pending: 1, approved: 1, denied: 1 });
  assert.ok(!Object.keys(summarize(rows)).some((k) => /cents|amount|total_/.test(k)));
});

/* ── writes, against the in-memory stand-in ────────────────────────────────── */

test("adding an approved card the client applied for puts it on their accounts once, with the approved limit and no balance", async () => {
  const db = trackerDb();
  const input = readTrackInput({ bank: "Chase", product: "Ink Business Cash", kind: "card", applied_on: "2026-10-01", status: "approved", approved_amount: "10000", last4: "4321" }, { now: NOW });
  const out = await addTrackedApplication(db, { orgId: ORG, clientId: CLIENT, by: { kind: "client" }, input, now: NOW });
  assert.equal(out.account.status, "added");
  assert.equal(db.t.accounts.length, 1);
  const acct = db.t.accounts[0];
  assert.equal(acct.name, "Chase Ink Business Cash");
  assert.equal(acct.account_type, "credit");
  assert.equal(acct.credit_limit_cents, 1000000);
  assert.equal(acct.current_balance_cents, null, "the balance is unknown until a bank says it");
  assert.equal(acct.mask, "4321");
  assert.equal(acct.client_id, CLIENT);
  assert.deepEqual([acct.raw.fundhub_application.kind, acct.raw.fundhub_application.id], ["self", out.id]);
  const again = await addAccountForApplication(db, { orgId: ORG, clientId: CLIENT, source: "self", id: out.id, now: NOW });
  assert.equal(again.account.status, "exists");
  assert.equal(db.t.accounts.length, 1, "a second press adds nothing");
});

test("an application that is not approved, or a loan, adds no account", async () => {
  const db = trackerDb();
  for (const body of [
    { bank: "Chase", kind: "card", applied_on: "2026-10-01" },
    { bank: "Chase", kind: "card", applied_on: "2026-10-01", status: "denied" },
    { bank: "Desert Credit Union", kind: "loan", applied_on: "2026-10-01", status: "approved", approved_amount: "20000" }
  ]) {
    const out = await addTrackedApplication(db, { orgId: ORG, clientId: CLIENT, input: readTrackInput(body, { now: NOW }), now: NOW });
    assert.equal(out.account.status, "not_needed");
  }
  assert.equal(db.t.accounts.length, 0);
});

test("when Plaid already shows the new card, the approval links it instead of adding a second copy", async () => {
  const item = { id: "e0000000-0000-4000-8000-000000000001", institution_name: "Chase" };
  const plaidCard = { id: "f0000000-0000-4000-8000-000000000001", org_id: ORG, client_id: CLIENT, provider: "plaid", plaid_item_id: item.id,
    plaid_account_id: "plaid-ink", name: "Ink Business Cash", mask: "4321", account_type: "credit", account_subtype: "credit card",
    created_at: new Date("2026-10-09T12:00:00Z"), raw: { plaid: true } };
  const db = trackerDb({ accounts: [plaidCard], items: [item] });
  const out = await addTrackedApplication(db, { orgId: ORG, clientId: CLIENT, now: NOW,
    input: readTrackInput({ bank: "Chase", kind: "card", applied_on: "2026-10-01", status: "approved", approved_amount: "10000" }, { now: NOW }) });
  assert.deepEqual(out.account, { status: "linked", account_id: plaidCard.id });
  assert.equal(db.t.accounts.length, 1);
  assert.equal(db.t.accounts[0].raw.plaid, true, "Plaid's own record is kept");
  assert.equal(db.t.accounts[0].raw.fundhub_application.id, out.id);
});

test("two Plaid cards that could be it: nothing is added, and the screen asks for the last 4", async () => {
  const item = { id: "e0000000-0000-4000-8000-000000000001", institution_name: "Chase" };
  const card = (n, mask) => ({ id: `f0000000-0000-4000-8000-00000000000${n}`, org_id: ORG, client_id: CLIENT, provider: "plaid", plaid_item_id: item.id,
    plaid_account_id: `p${n}`, name: "Chase card", mask, account_type: "credit", account_subtype: "credit card", created_at: new Date("2026-10-09T12:00:00Z"), raw: {} });
  const db = trackerDb({ accounts: [card(1, "1111"), card(2, "2222")], items: [item] });
  const out = await addTrackedApplication(db, { orgId: ORG, clientId: CLIENT, now: NOW,
    input: readTrackInput({ bank: "Chase", kind: "card", applied_on: "2026-10-01", status: "approved" }, { now: NOW }) });
  assert.equal(out.account.status, "ambiguous");
  const view = await readApplicationsTracker(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(view.rows[0].account_state, "ambiguous");
  assert.match(view.rows[0].account_words, /last 4 digits/);
  const fixed = await updateTrackedApplication(db, { orgId: ORG, clientId: CLIENT, id: out.id, body: { status: "approved", last4: "2222" }, now: NOW });
  assert.deepEqual(fixed.account, { status: "linked", account_id: card(2, "2222").id });
  // A Fundhub round row has no last 4 for the client to give, so it never asks for one.
  const round = trackerRow({ ...fromFundhubRow(fundhubApp()), needs_last4: true });
  assert.equal(round.account_state, "ambiguous");
  assert.doesNotMatch(round.account_words, /last 4/);
  assert.match(round.account_words, /Nothing counts twice/);
  assert.equal(round.can_add_account, false);
});

test("a client cannot change another client's application, and a Fundhub row is never changed here", async () => {
  const db = trackerDb({ applications: [fundhubApp()] });
  const mine = await addTrackedApplication(db, { orgId: ORG, clientId: CLIENT, now: NOW,
    input: readTrackInput({ bank: "Chase", kind: "card", applied_on: "2026-10-01" }, { now: NOW }) });
  assert.deepEqual(await updateTrackedApplication(db, { orgId: ORG, clientId: OTHER_CLIENT, id: mine.id, body: { status: "denied" }, now: NOW }), { ok: false, error: "not_found" });
  assert.deepEqual(await updateTrackedApplication(db, { orgId: ORG, clientId: CLIENT, id: fundhubApp().id, body: { status: "denied" }, now: NOW }), { ok: false, error: "not_found" });
  assert.equal(db.t.applications[0].status, "Approved", "the bank's answer on the round application is untouched");
  assert.ok(!db.calls.some((s) => /UPDATE applications|INSERT INTO applications/.test(s)), "the tracker never writes the applications table");
});

test("a staff bank answer of Approved adds the account; Denied, or a broken database, never throws", async () => {
  const db = trackerDb();
  const row = fundhubApp();
  const out = await syncApprovedApplication(db, { orgId: ORG, application: row });
  assert.equal(out.status, "added");
  assert.equal(db.t.accounts[0].raw.fundhub_application.kind, "fundhub");
  assert.equal(db.t.accounts[0].credit_limit_cents, 1000000);
  assert.equal((await syncApprovedApplication(db, { orgId: ORG, application: fundhubApp({ id: "c0000000-0000-4000-8000-000000000012", status: "Denied" }) })).status, "not_needed");
  assert.equal((await syncApprovedApplication(db, { orgId: ORG, application: { ...row, client_id: null } })).status, "not_needed");
  const broken = { async query() { throw new Error("connection reset"); } };
  const failed = await syncApprovedApplication(broken, { orgId: ORG, application: row });
  assert.equal(failed.status, "failed");
});

test("inside the caller's transaction a failure rolls back only its own statements", async () => {
  const seen = [];
  const tx = {
    release() {},
    async query(sql) {
      seen.push(sql.replace(/\s+/g, " ").trim().slice(0, 40));
      if (/^SAVEPOINT|^ROLLBACK TO SAVEPOINT|^RELEASE/.test(sql)) return { rows: [] };
      throw new Error("relation bank_accounts is locked");
    }
  };
  const out = await syncApprovedApplication(tx, { orgId: ORG, application: fundhubApp() });
  assert.equal(out.status, "failed");
  assert.equal(seen[0], "SAVEPOINT fos_applications");
  assert.equal(seen.at(-1), "ROLLBACK TO SAVEPOINT fos_applications");
});

test("the read: both sources, newest first, the bank book's logo, the account it is on, and a stand-in waiting on Plaid", async () => {
  const db = trackerDb({ applications: [fundhubApp(), fundhubApp({ id: "c0000000-0000-4000-8000-000000000013", status: "Missing Docs", lender_id: null,
    lender_name: "Bank of America", product_name: "Business Advantage", submitted_date: new Date(2026, 9, 20), approved_amount: null })], lenders: BOOK });
  await syncApprovedApplication(db, { orgId: ORG, application: fundhubApp() });
  await addTrackedApplication(db, { orgId: ORG, clientId: CLIENT, now: NOW,
    input: readTrackInput({ bank: "Desert Credit Union", kind: "loan", owner_kind: "personal", applied_on: "2026-11-02", status: "approved", approved_amount: "20000" }, { now: NOW }) });
  const view = await readApplicationsTracker(db, { orgId: ORG, clientId: CLIENT });
  assert.deepEqual(view.rows.map((r) => [r.bank, r.source, r.status]), [
    ["Desert Credit Union", "self", "approved"],
    ["Bank of America", "fundhub", "pending"],
    ["Chase", "fundhub", "approved"]
  ]);
  const chase = view.rows[2];
  assert.equal(chase.logo_url, "/assets/lenders/chase.png");
  assert.equal(chase.approved_cents, 1000000);
  assert.equal(chase.requested_cents, 1500000);
  assert.equal(chase.applied_on, "2026-10-01");
  assert.equal(chase.account_state, "added");
  assert.equal(chase.can_edit, false, "Fundhub's round rows are read only here");
  assert.equal(view.rows[1].logo_url, "/assets/lenders/bank-of-america.png", "matched by name when the row names no lender");
  assert.equal(view.rows[1].approved_cents, null);
  assert.equal(view.rows[0].logo_url, null, "no book row, no logo");
  assert.equal(view.rows[0].account_state, "loan");
  assert.equal(view.rows[0].can_edit, true);
  assert.deepEqual(view.counts, { total: 3, planned: 0, applied: 0, pending: 1, approved: 2, denied: 0 });
});

test("an approval from before this shipped shows 'Add to my accounts', and the button adds it", async () => {
  const db = trackerDb({ applications: [fundhubApp()], lenders: BOOK });
  const before = await readApplicationsTracker(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(before.rows[0].account_state, "missing");
  assert.equal(before.rows[0].can_add_account, true);
  const out = await addAccountForApplication(db, { orgId: ORG, clientId: CLIENT, source: "fundhub", id: fundhubApp().id, now: NOW });
  assert.equal(out.account.status, "added");
  assert.deepEqual(await addAccountForApplication(db, { orgId: ORG, clientId: OTHER_CLIENT, source: "fundhub", id: fundhubApp().id, now: NOW }), { ok: false, error: "not_found" });
  const after = await readApplicationsTracker(db, { orgId: ORG, clientId: CLIENT });
  assert.equal(after.rows[0].can_add_account, false);
});

test("two saves at once: the unique index lets one in, and the other answers with it", async () => {
  const db = trackerDb();
  const app = fromFundhubRow(fundhubApp());
  const [a, b] = await Promise.all([
    ensureApprovedAccount(db, { orgId: ORG, clientId: CLIENT, app, now: NOW }),
    ensureApprovedAccount(db, { orgId: ORG, clientId: CLIENT, app, now: NOW })
  ]);
  assert.deepEqual([a.status, b.status].sort(), ["added", "exists"]);
  assert.equal(db.t.accounts.length, 1);
});

/* ── the Plaid claim, through the real account store ───────────────────────── */

test("when Plaid first sees the approved card, the stand-in becomes that Plaid account — same row, no copy", async () => {
  const itemId = "e0000000-0000-4000-8000-000000000009";
  const standIn = { id: "f0000000-0000-4000-8000-000000000020", org_id: ORG, client_id: CLIENT, provider: "manual", plaid_item_id: null, plaid_account_id: null,
    name: "Chase Ink Business Cash", mask: "4321", account_type: "credit", account_subtype: "credit card", credit_limit_cents: 1000000, entity_kind: "business",
    raw: { entry: "application", fundhub_application: { kind: "self", id: "app-1", bank: "Chase" } } };
  const db = fakeBankDb({ items: [{ id: itemId, org_id: ORG, client_id: CLIENT, institution_name: "Chase" }], accounts: [standIn] });
  const out = await saveAccounts(db, [
    { providerAccountId: "plaid-ink", name: "INK BUSINESS CASH", mask: "4321", accountType: "credit", accountSubtype: "credit card", currentBalanceCents: 25000, creditLimitCents: 1000000, raw: { plaid: true } },
    { providerAccountId: "plaid-chk", name: "Business Checking", mask: "0001", accountType: "depository", accountSubtype: "checking", currentBalanceCents: 600000, raw: {} }
  ], { orgId: ORG, clientId: CLIENT, provider: "plaid", plaidItemId: itemId });
  assert.equal(out.written, 2);
  assert.equal(db.state.accounts.length, 2, "the card is one row, not two");
  const card = db.state.accounts.find((a) => a.id === standIn.id);
  assert.equal(card.provider, "plaid");
  assert.equal(card.plaid_account_id, "plaid-ink");
  assert.equal(card.current_balance_cents, 25000, "the bank's balance now fills the unknown");
  assert.equal(card.entity_kind, "business", "a classification a person made is kept");
  assert.equal(card.raw.fundhub_application.id, "app-1", "the link to the application survives the Plaid read");
  assert.equal(card.raw.plaid, true);
});

test("a Plaid card with a different last 4 is a different card: the stand-in stays and Plaid adds its own row", async () => {
  const itemId = "e0000000-0000-4000-8000-000000000009";
  const standIn = { id: "f0000000-0000-4000-8000-000000000021", org_id: ORG, client_id: CLIENT, provider: "manual", plaid_item_id: null, name: "Chase Ink Business Cash",
    mask: "4321", account_type: "credit", account_subtype: "credit card", raw: { fundhub_application: { kind: "self", id: "app-2", bank: "Chase" } } };
  const db = fakeBankDb({ items: [{ id: itemId, org_id: ORG, client_id: CLIENT, institution_name: "Chase" }], accounts: [standIn] });
  await saveAccounts(db, [{ providerAccountId: "plaid-freedom", name: "Freedom", mask: "8888", accountType: "credit", accountSubtype: "credit card", raw: {} }],
    { orgId: ORG, clientId: CLIENT, provider: "plaid", plaidItemId: itemId });
  assert.equal(db.state.accounts.length, 2);
  assert.equal(db.state.accounts.find((a) => a.id === standIn.id).provider, "manual");
});

test("a mock or hand sync never claims a stand-in", async () => {
  const standIn = { id: "f0000000-0000-4000-8000-000000000022", org_id: ORG, client_id: CLIENT, provider: "manual", plaid_item_id: null, name: "Chase Ink",
    mask: null, account_type: "credit", account_subtype: "credit card", raw: { fundhub_application: { kind: "self", id: "app-3", bank: "Chase" } } };
  const db = fakeBankDb({ accounts: [standIn] });
  await saveAccounts(db, [{ providerAccountId: "mock-1", name: "Mock card", accountType: "credit", accountSubtype: "credit card" }],
    { orgId: ORG, clientId: CLIENT, provider: "mock" });
  assert.ok(!db.calls.some((c) => /fundhub_application/.test(c.sql)), "the claim only runs for Plaid");
});

/* ── migration 576 ─────────────────────────────────────────────────────────── */

test("migration 576: the rules live in the database, row locks have a policy, and nothing can delete", () => {
  const sql = MIGRATION.replace(/--[^\n]*/g, "");
  for (const ck of [
    "finance_applications_status_ck", "finance_applications_kind_ck", "finance_applications_amount_only_approved_ck",
    "finance_applications_decided_only_answered_ck", "finance_applications_decided_after_applied_ck", "finance_applications_last4_ck",
    "finance_applications_requested_ck", "finance_applications_approved_ck"
  ]) assert.match(sql, new RegExp(`CONSTRAINT ${ck}`), ck);
  assert.match(sql, /CHECK \(approved_cents IS NULL OR approved_cents > 0\)/, "an amount is never 0");
  assert.match(sql, /CHECK \(last4 IS NULL OR last4 ~ '\^\[0-9\]\{2,4\}\$'\)/);
  assert.match(sql, /org_id\s+uuid NOT NULL REFERENCES orgs\(id\)/);
  assert.match(sql, /client_id\s+uuid NOT NULL REFERENCES clients\(id\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /CREATE POLICY finance_applications_app_all/, "a locked table with no policy hides every row (rls-shape)");
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON public\.finance_applications TO fundhub_app/);
  assert.doesNotMatch(sql, /GRANT[^;]*DELETE/i);
  assert.doesNotMatch(sql, /DELETE FROM|\bDROP TABLE\b|ALTER TABLE (public\.)?applications\b/i, "no row removed, and the applications table is not touched");
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS bank_accounts_fundhub_application_uq[\s\S]*WHERE raw \? 'fundhub_application'/);
});
