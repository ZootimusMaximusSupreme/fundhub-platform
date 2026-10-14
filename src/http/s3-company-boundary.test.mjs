// Slice S3 proofs: a staff login of one company cannot act on a client of another.
// One table, one real handler per row. The stand-in `clients` table puts the client
// in company B; the caller is company A. The only statements the handler may run are
// the login check and the one `clients` lookup that turns the caller away. A
// control run with the client moved into company A must get further, so the
// request really does reach the check. Taking the check out of a handler turns its
// row red here, because the handler then goes on to read or write.
import { test } from "node:test";
import assert from "node:assert/strict";

import bankAccounts from "../../api/finance/bank-accounts.mjs";
import bills from "../../api/finance/bills.mjs";
import liabilities from "../../api/finance/liabilities.mjs";
import moneyAccounts from "../../api/money/accounts.mjs";
import moneyConnections from "../../api/money/connections.mjs";
import moneyMap from "../../api/read/money-map.mjs";
import transactions from "../../api/read/transactions.mjs";
import underwrite from "../../api/read/underwrite.mjs";
import clientArchive from "../../api/dashboard/client-archive.mjs";
import authorizedRep from "../../api/auth/authorized-rep.mjs";
import syncLiabilities from "../../api/banking/sync-liabilities.mjs";
import bankingAccounts from "../../api/banking/accounts.mjs";
import staffActions from "../../api/blueprint/staff-actions.mjs";
import clientNotes from "../../api/client-notes.mjs";
import customerInsights from "../../api/customer-insights.mjs";
import readCustomerInsights from "../../api/read/customer-insights.mjs";
import closerDeck from "../../api/closer-deck.mjs";
import readCloserDeck from "../../api/read/closer-deck.mjs";
import cashflow from "../../api/finance/cashflow.mjs";
import containers from "../../api/finance/containers.mjs";
import crsPull from "../../api/finance/crs-pull.mjs";
import softPull from "../../api/finance/soft-pull.mjs";
import inquiryCases from "../../api/inquiry-cases.mjs";
import moneyAlerts from "../../api/money/alerts.mjs";
import moneyBanks from "../../api/money/banks.mjs";
import moneyPayments from "../../api/money/payments.mjs";
import bankInbox from "../../api/read/bank-inbox.mjs";
import adAttribution from "../../api/read/ad-attribution.mjs";
import financeOsSuggestions from "../../api/read/finance-os-suggestions.mjs";
import repairSend from "../../api/repair/send.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { req, staffSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { clientsRule } from "../testing/s3-scoped-rows.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const q = { client_id: CLIENT };
// [name, handler, method, request, status the other company's caller gets]
const DOORS = [
  ["auth/authorized-rep", authorizedRep, "POST", { body: { client_id: CLIENT, remove: true } }, 404],
  ["banking/sync-liabilities", syncLiabilities, "POST", { body: { client_id: CLIENT } }, 404],
  ["banking/accounts (GET)", bankingAccounts, "GET", { query: q }, 404],
  ["banking/accounts (POST)", bankingAccounts, "POST", { body: { client_id: CLIENT, action: "create_account", name: "Checking", account_type: "depository" } }, 404],
  ["blueprint/staff-actions", staffActions, "POST", { body: { client_id: CLIENT, action: "get_next_sequence_plan" } }, 404],
  ["client-notes", clientNotes, "POST", { body: { client_id: CLIENT, notes: "hi" } }, 404],
  ["customer-insights (POST)", customerInsights, "POST", { body: { client_id: CLIENT, stage: "post", channel: "google_meet", answers: { felt_funded: "relieved" } } }, 404],
  ["closer-deck", closerDeck, "POST", { body: { client_id: CLIENT, action: "log_disposition", offer_key: "slo", route: "x", temperature: "hot" } }, 404],
  ["read/closer-deck", readCloserDeck, "GET", { query: q }, 404],
  ["finance/cashflow (GET)", cashflow, "GET", { query: q }, 403],
  ["finance/containers (GET)", containers, "GET", { query: q }, 404],
  ["finance/containers (create)", containers, "POST", { body: { client_id: CLIENT, action: "create", kind: "business", name: "New Co LLC" } }, 404],
  ["finance/crs-pull", crsPull, "POST", { body: { client_id: CLIENT, bureau: "TU", simulate: true } }, 403],
  ["finance/soft-pull", softPull, "POST", { body: { client_id: CLIENT, reason: "proof" } }, 403],
  ["inquiry-cases (create)", inquiryCases, "POST", { body: { client_id: CLIENT, action: "create", bureau: "equifax" } }, 404],
  ["money/alerts", moneyAlerts, "POST", { body: { client_id: CLIENT, action: "set_alert", kind: "promo_end", enabled: false } }, 404],
  ["money/banks", moneyBanks, "POST", { body: { client_id: CLIENT, action: "plan_bank" } }, 404],
  ["money/payments", moneyPayments, "POST", { body: { client_id: CLIENT, action: "ask_for_person" } }, 404],
  ["read/bank-inbox", bankInbox, "GET", { query: q }, 404],
  ["read/ad-attribution", adAttribution, "GET", { query: q }, 404],
  ["read/finance-os-suggestions", financeOsSuggestions, "GET", { query: q }, 404],
  ["finance/bank-accounts (GET)", bankAccounts, "GET", { query: { ...q, view: "surface" } }, 403],
  ["finance/bills (GET)", bills, "GET", { query: q }, 403],
  ["finance/liabilities (GET)", liabilities, "GET", { query: q }, 403],
  ["money/accounts (GET)", moneyAccounts, "GET", { query: q }, 404],
  ["money/connections (GET)", moneyConnections, "GET", { query: q }, 404],
  ["read/money-map", moneyMap, "GET", { query: q }, 404],
  ["read/transactions", transactions, "GET", { query: q }, 404],
  ["read/underwrite", underwrite, "GET", { query: q }, 404],
  ["dashboard/client-archive", clientArchive, "POST", { body: { client_id: CLIENT, confirm: "DELETE" } }, 404],
  ["repair/send", repairSend, "POST", { body: { client_id: CLIENT, mail: true, letters: [] } }, 404]
];

const LOGIN_OR_CLIENT_LOOKUP = /live JOIN staff|account_sessions|FROM accounts WHERE id|^\s*SELECT[^;]*\bFROM clients\b/;

async function run(handler, method, request, clientOrg) {
  return callShared(handler, req(method, request), [
    staffSession({ role: "owner" }), clientsRule([{ id: CLIENT, org_id: clientOrg }])
  ]);
}

for (const [name, handler, method, request, refusal] of DOORS) {
  test(`${name}: a caller from another company is a ${refusal} and the handler reads and writes nothing more`, async () => {
    const control = await run(handler, method, request, ORG_ID);
    const beyond = control.fake.calls.filter((c) => !LOGIN_OR_CLIENT_LOOKUP.test(c.sql));
    assert.ok(control.res.statusCode !== refusal || beyond.length > 0, "the control request must get past the company check");

    const { res, fake } = await run(handler, method, request, OTHER_ORG_ID);
    assert.equal(res.statusCode, refusal);
    assert.equal(res.body && res.body.ok, false);
    const more = fake.calls.filter((c) => !LOGIN_OR_CLIENT_LOOKUP.test(c.sql)).map((c) => c.sql.trim().slice(0, 70));
    assert.deepEqual(more, [], `went on after the company check: ${more.join(" | ")}`);
    const lookups = fake.calls.filter((c) => /FROM clients/.test(c.sql));
    assert.ok(lookups.length > 0, "the company lookup ran");
    for (const lookup of lookups) assert.ok(lookup.params.includes(ORG_ID), "the lookup names the caller's company");
  });
}
