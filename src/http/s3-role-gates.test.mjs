// Slice S3 proofs: who may call each customer-data door. One table, one real
// handler per row, one real staff login per role. A role the row's words name
// gets past the gate; a role they do not name is refused with a 403 BEFORE the
// handler asks the database anything (the only statements allowed are the login
// check itself). Taking the gate out of a handler turns its row red here.
import { test } from "node:test";
import assert from "node:assert/strict";

import bankAccounts from "../../api/finance/bank-accounts.mjs";
import bills from "../../api/finance/bills.mjs";
import financeContainers from "../../api/finance/containers.mjs";
import liabilities from "../../api/finance/liabilities.mjs";
import moneyAccounts from "../../api/money/accounts.mjs";
import moneyConnections from "../../api/money/connections.mjs";
import moneyMap from "../../api/read/money-map.mjs";
import transactions from "../../api/read/transactions.mjs";
import underwrite from "../../api/read/underwrite.mjs";
import adAttribution from "../../api/read/ad-attribution.mjs";
import bankInbox from "../../api/read/bank-inbox.mjs";
import clientNotes from "../../api/client-notes.mjs";
import customerInsights from "../../api/customer-insights.mjs";
import readCustomerInsights from "../../api/read/customer-insights.mjs";
import inquiryCases from "../../api/inquiry-cases.mjs";
import repairSend from "../../api/repair/send.mjs";
import clientArchive from "../../api/dashboard/client-archive.mjs";
import verifyDomain from "../../api/partner-brand/verify-domain.mjs";
import privacyErasure from "../../api/privacy/erasure.mjs";
import conversations from "../../api/read/conversations.mjs";
import entitlements from "../../api/read/entitlements.mjs";
import authorizedRep from "../../api/auth/authorized-rep.mjs";
import syncLiabilities from "../../api/banking/sync-liabilities.mjs";
import bankingAccounts from "../../api/banking/accounts.mjs";
import bankingRevoke from "../../api/banking/revoke.mjs";
import staffActions from "../../api/blueprint/staff-actions.mjs";
import bookings from "../../api/bookings.mjs";
import closerDeck from "../../api/closer-deck.mjs";
import readCloserDeck from "../../api/read/closer-deck.mjs";
import documentsDownload from "../../api/documents-download.mjs";
import cashflow from "../../api/finance/cashflow.mjs";
import crsPull from "../../api/finance/crs-pull.mjs";
import softPull from "../../api/finance/soft-pull.mjs";
import moneyAlerts from "../../api/money/alerts.mjs";
import moneyBanks from "../../api/money/banks.mjs";
import moneyPayments from "../../api/money/payments.mjs";
import financeAsk from "../../api/read/finance-ask.mjs";
import financeOsSuggestions from "../../api/read/finance-os-suggestions.mjs";
import inbox from "../../api/read/inbox.mjs";
import repairCases from "../../api/read/repair-cases.mjs";
import repairExceptions from "../../api/repair/exceptions.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { req, staffSession, accountSession, ORG_ID } from "../testing/handler-harness.mjs";
import { FINANCE_OS_ROLES, NOT_FINANCE_OS_ROLES } from "../testing/s3-mem-tasks-db.mjs";
import { clientsRule } from "../testing/s3-scoped-rows.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_STAFF_ROLES = ["setter", "csm", "funding_advisor", "inquiry_specialist", "closer", "sales_manager"];
// Written out here, not read from the product: who each row's words name.
const OWNER_ADMIN = { allowed: ["owner", "admin"], refused: OTHER_STAFF_ROLES };
const FINANCE = { allowed: ["owner", "admin", "sales_manager"], refused: ["closer", "setter", "csm", "funding_advisor", "inquiry_specialist"] };
const FINANCE_OS = { allowed: FINANCE_OS_ROLES, refused: NOT_FINANCE_OS_ROLES };
const STAFF = { allowed: ["owner", "closer", "setter", "csm", "funding_advisor", "inquiry_specialist"], refused: ["affiliate"] };
const CLOSER_DECK = { allowed: ["owner", "admin", "closer", "sales_manager"], refused: ["setter", "csm", "funding_advisor", "inquiry_specialist"] };
const PULLERS = { allowed: ["owner", "admin", "closer", "funding_advisor"], refused: ["setter", "inquiry_specialist", "csm", "sales_manager"] };

const q = { client_id: CLIENT };
// A client that is in the caller's company, for doors that answer a 403 when it is not.
const inCompany = clientsRule([{ id: CLIENT, org_id: ORG_ID }]);
const DOORS = [
  ["auth/authorized-rep", authorizedRep, "POST", { body: { client_id: CLIENT, remove: true } }, OWNER_ADMIN],
  ["banking/sync-liabilities", syncLiabilities, "POST", { body: { client_id: CLIENT } }, FINANCE_OS],
  ["banking/accounts (GET)", bankingAccounts, "GET", { query: q }, STAFF],
  ["banking/accounts (POST)", bankingAccounts, "POST", { body: { client_id: CLIENT, action: "create_account" } }, FINANCE],
  ["banking/revoke (GET)", bankingRevoke, "GET", { query: q }, OWNER_ADMIN],
  ["blueprint/staff-actions", staffActions, "POST", { body: { client_id: CLIENT, action: "get_next_sequence_plan" } }, STAFF],
  ["closer-deck", closerDeck, "POST", { body: { client_id: CLIENT, action: "log_disposition" } }, CLOSER_DECK],
  ["read/closer-deck", readCloserDeck, "GET", { query: q }, CLOSER_DECK],
  ["documents-download", documentsDownload, "GET", { query: { id: "d1000000-0000-4000-8000-0000000000d1" } }, STAFF],
  ["finance/cashflow (GET)", cashflow, "GET", { query: q, rules: [inCompany] }, FINANCE],
  ["finance/cashflow (POST)", cashflow, "POST", { body: { client_id: CLIENT, action: "save_settings" } }, FINANCE],
  ["finance/crs-pull", crsPull, "POST", { body: { client_id: CLIENT, bureau: "TU", simulate: true }, rules: [inCompany] }, PULLERS],
  ["finance/soft-pull", softPull, "POST", { body: { client_id: CLIENT, reason: "proof" }, rules: [inCompany] }, PULLERS],
  ["money/alerts", moneyAlerts, "POST", { body: { client_id: CLIENT, action: "set_alert", kind: "promo_end", enabled: false } }, FINANCE_OS],
  ["money/banks", moneyBanks, "POST", { body: { client_id: CLIENT, action: "plan_bank" } }, FINANCE_OS],
  ["money/payments", moneyPayments, "POST", { body: { client_id: CLIENT, action: "ask_for_person" } }, FINANCE_OS],
  ["read/finance-ask", financeAsk, "POST", { body: { client_id: CLIENT, question: "can I afford $500" } }, STAFF],
  ["read/finance-os-suggestions", financeOsSuggestions, "GET", { query: q }, STAFF],
  ["finance/bank-accounts (GET)", bankAccounts, "GET", { query: { ...q, view: "surface" }, rules: [inCompany] }, FINANCE],
  ["finance/bills (GET)", bills, "GET", { query: q, rules: [inCompany] }, FINANCE],
  ["finance/containers (GET)", financeContainers, "GET", { query: q, rules: [inCompany] }, FINANCE],
  ["finance/liabilities (GET)", liabilities, "GET", { query: q, rules: [inCompany] }, STAFF],
  ["money/accounts (GET)", moneyAccounts, "GET", { query: q, rules: [inCompany] }, FINANCE_OS],
  ["money/connections (GET)", moneyConnections, "GET", { query: q, rules: [inCompany] }, FINANCE_OS],
  ["read/money-map", moneyMap, "GET", { query: q, rules: [inCompany] }, STAFF],
  ["read/transactions", transactions, "GET", { query: q, rules: [inCompany] }, STAFF],
  ["read/underwrite", underwrite, "GET", { query: q, rules: [inCompany] }, STAFF],
  ["read/ad-attribution", adAttribution, "GET", { query: q, rules: [inCompany] }, STAFF],
  ["read/bank-inbox", bankInbox, "GET", { query: q, rules: [inCompany] }, STAFF],
  ["client-notes", clientNotes, "POST", { body: { client_id: CLIENT, notes: "hi" }, rules: [inCompany] }, STAFF],
  ["customer-insights (POST)", customerInsights, "POST", { body: { client_id: CLIENT, stage: "post", channel: "google_meet", answers: { a: "b" } } }, STAFF],
  ["read/customer-insights", readCustomerInsights, "GET", { query: q }, STAFF],
  ["inquiry-cases", inquiryCases, "POST", { body: { client_id: CLIENT, action: "create", bureau: "equifax" }, rules: [inCompany] }, STAFF],
  ["repair/send", repairSend, "POST", { body: { client_id: CLIENT, mail: true, letters: [] }, rules: [inCompany] }, STAFF],
  ["dashboard/client-archive", clientArchive, "POST", { body: { client_id: CLIENT, confirm: "DELETE" }, rules: [inCompany] }, STAFF],
  ["partner-brand/verify-domain", verifyDomain, "POST", { body: { partner_id: "a1000000-0000-4000-8000-0000000000a1" } }, OWNER_ADMIN],
  ["privacy/erasure (GET)", privacyErasure, "GET", { query: q }, OWNER_ADMIN],
  ["read/inbox", inbox, "GET", {}, STAFF],
  ["read/conversations", conversations, "GET", { query: q }, STAFF],
  ["read/entitlements", entitlements, "GET", { query: q }, STAFF],
  ["bookings", bookings, "GET", {}, { allowed: ["owner", "closer", "setter", "csm"], refused: [] }], // "staff only": no role set, a client login is refused below
  ["read/repair-cases", repairCases, "GET", {}, { allowed: ["owner", "admin", "inquiry_specialist", "funding_advisor"], refused: ["closer", "setter", "csm", "sales_manager"] }],
  ["repair/exceptions (GET)", repairExceptions, "GET", {}, { allowed: ["owner", "admin", "inquiry_specialist"], refused: ["closer", "setter", "csm", "sales_manager"] }]
];

// Doors a signed-in client must not pass at all (the row says staff only). The rest of the table
// admits a client for their own file, which their own tests prove.
const STAFF_ONLY = new Set([
  "auth/authorized-rep", "banking/sync-liabilities", "banking/accounts (GET)", "banking/accounts (POST)", "banking/revoke (GET)",
  "blueprint/staff-actions", "closer-deck", "read/closer-deck", "finance/cashflow (GET)", "finance/cashflow (POST)",
  "finance/crs-pull", "money/banks", "read/finance-ask", "read/finance-os-suggestions", "read/inbox", "read/conversations",
  "bookings", "read/repair-cases", "repair/exceptions (GET)"
]);

const LOGIN_ONLY = /live JOIN staff|account_sessions|FROM accounts WHERE id/;

async function visit(handler, method, { rules = [], ...request }, role) {
  return callShared(handler, req(method, request), [staffSession({ role }), ...rules]);
}

for (const [name, handler, method, request, { allowed, refused }] of DOORS) {
  test(`${name}: ${allowed.join(", ")} get past the gate; ${refused.join(", ")} are refused before any lookup`, async () => {
    for (const role of allowed) {
      // Past the gate may still be a 403 for another reason (no consent on file); only the role refusal counts.
      const { res } = await visit(handler, method, request, role);
      const roleRefusal = res.statusCode === 403 && ["forbidden", "role_forbidden"].includes(res.body && res.body.error);
      assert.equal(roleRefusal, false, `${role} is named by the row and must not be refused`);
      assert.notEqual(res.statusCode, 401, role);
    }
    for (const role of refused) {
      const { res, fake } = await visit(handler, method, request, role);
      assert.equal(res.statusCode, 403, `${role} must be refused`);
      assert.equal(res.body && res.body.ok, false, role);
      const looked = fake.calls.filter((c) => !LOGIN_ONLY.test(c.sql)).map((c) => c.sql.trim().slice(0, 60));
      assert.deepEqual(looked, [], `${role} was refused only after the handler read: ${looked.join(" | ")}`);
    }
  });
}

for (const [name, handler, method, request] of DOORS.filter(([name]) => STAFF_ONLY.has(name))) {
  test(`${name}: a signed-in client is turned away before any lookup`, async () => {
    const { rules = [], ...rest } = request;
    const { res, fake } = await callShared(handler, req(method, rest), [...accountSession({ kind: "client", clientId: CLIENT }), ...rules]);
    assert.ok([401, 403].includes(res.statusCode), `a client login got ${res.statusCode}`);
    assert.equal(res.body && res.body.ok, false);
    const looked = fake.calls.filter((c) => !LOGIN_ONLY.test(c.sql)).map((c) => c.sql.trim().slice(0, 60));
    assert.deepEqual(looked, [], `refused only after the handler read: ${looked.join(" | ")}`);
  });
}
