// Batch 18 practice tests for the SERVER half of four client money controls. The page tests (a real Chromium,
// fake answers) feed the page whatever the test says; they cannot tell whether the server's own read builds
// the answer the page depends on. These run the server's real read (and the page's own word script) in Node
// over stand-in data. No browser, no database, no network.
//
//   money-declines.html   "Your bank applications list" and "Your steps list + Fundhub's steps expander":
//                         readDeclines / clientDecline (src/blueprint/decline-defense.mjs), and what each bank
//                         answer does to the application (recordOutcome) that the live check relies on
//   money-helper.html     the banner feed: GET /api/money/helper (halted, halt_reason, on)
//   money-payments.html   the list the empty state depends on: GET /api/money/payments (plans)
//   money-transfers.html  "What happened": the ledger lines the read hands the page, and the page's words
//                         for every line it can tell

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { proofRows } from "./fin-b18-proof-rows.mjs";
import {
  clientDecline, readDeclines, recordOutcome,
} from "../../../blueprint/decline-defense.mjs";
import { memoryDb, TEST_CLIENT, TEST_ORG } from "../../../blueprint/decline-defense.test.db.mjs";
import helperHandler from "../../../../api/money/helper.mjs";
import paymentsHandler from "../../../../api/money/payments.mjs";
import { moneyTransfersView } from "../../../finance/money-transfers.mjs";

const proof = proofRows(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");

const ORG = TEST_ORG;
const CLIENT = TEST_CLIENT;
const APP = (n) => `aaaaaaaa-0000-4000-8000-00000000a00${n}`;
const DEC = (n) => `dddddddd-0000-4000-8000-00000000d00${n}`;

// ───────────────────────── declines: the applications list ─────────────────────────

function declineRow(over = {}) {
  return {
    id: DEC(1), org_id: ORG, client_id: CLIENT, application_id: null, lender_id: null, bank: "Chase", product: "Ink Business Cash",
    declined_on: "2026-10-02", bureaus_pulled: [], letter_text: null, letter_hash: null, letter_document_id: null, looks_like: null,
    reason_categories: [], needs_person: false, analysis: {}, source: "staff", recorded_by: "Dana", recon_on: null, outcome: "open",
    outcome_approved_amount: null, reapply_on: null, outcome_notes: null, outcome_by: null, outcome_at: null, task_id: null,
    created_at: new Date("2026-10-02T15:00:00Z"), ...over,
  };
}

const STAFF = { kind: "staff", staffId: "s1", name: "Dana Advisor" };

test("Declines (server): each application is listed with its bank, product, the bank's word, and the words of its decline", async () => {
  await proof.check(/^Your bank applications list/, async () => {
    const db = memoryDb({
      applications: [
        { id: APP(1), bank: "Chase", lender_name: "Chase", product_name: "Ink Business Cash", status: "Applied" },
        { id: APP(2), bank: "Amex", lender_name: "American Express", product_name: null, status: "Denied" },
        { id: APP(3), bank: "Wells Fargo", lender_name: null, product_name: "Signify", status: "Approved" },
        { id: APP(4), bank: null, lender_name: null, product_name: null, status: null },
        { id: APP(5), bank: "Citi", lender_name: "Citi", product_name: "Business Card", status: "Missing Docs" },
      ],
    });
    db.t.declines.push(
      declineRow({ id: DEC(1), application_id: APP(1), outcome: "reapply_later", reapply_on: "2026-12-01" }),
      declineRow({ id: DEC(2), application_id: APP(2), outcome: "still_declined" }),
      declineRow({ id: DEC(3), application_id: APP(3), outcome: "approved_on_recon" }),
      declineRow({ id: DEC(5), application_id: APP(5), outcome: "open" }),
    );
    const read = await readDeclines(db, { orgId: ORG, clientId: CLIENT, viewer: { kind: "client" } });
    assert.deepEqual(read.view.applications, [
      { id: APP(1), bank: "Chase", product: "Ink Business Cash", status_words: "Waiting on the bank", decline_id: DEC(1), decline_words: "We will try again on Dec 1, 2026" },
      { id: APP(2), bank: "American Express", product: null, status_words: "Declined", decline_id: DEC(2), decline_words: "Still declined" },
      { id: APP(3), bank: "Wells Fargo", product: "Signify", status_words: "Approved", decline_id: DEC(3), decline_words: "Approved after a second look" },
      { id: APP(4), bank: null, product: null, status_words: "Status not set", decline_id: null, decline_words: null },
      { id: APP(5), bank: "Citi", product: "Business Card", status_words: "The bank needs papers", decline_id: DEC(5), decline_words: "Fundhub is working on it" },
    ], "the lender's name wins over the bank, a missing product or status is said as such, and an application with no decline carries no decline words");
  });
});

test("Declines (server): what each bank answer does to the application is what the live check expects", async () => {
  await proof.check(/^Your bank applications list/, async () => {
    // The live check (fin-b18-applications-list) expects: approved on reconsideration leaves the application
    // Approved; still declined and apply later both leave it Denied. recordOutcome is what writes that.
    const answer = async (outcome, applicationStatus, extra = {}) => {
      const db = memoryDb({ applications: [{ id: APP(1), bank: "Chase", lender_name: "Chase", status: applicationStatus }] });
      db.t.declines.push(declineRow({ id: DEC(1), application_id: APP(1) }));
      const calls = [];
      const setApplicationStatus = async (_db, args) => { calls.push(args); return { id: args.applicationId, status: args.status }; };
      const out = await recordOutcome(db, {
        orgId: ORG, clientId: CLIENT, declineId: DEC(1), outcome, by: STAFF, deps: { setApplicationStatus }, ...extra,
      });
      return { out, calls, decline: db.t.declines[0] };
    };

    const approved = await answer("approved_on_recon", "Denied", { approvedAmount: "15000" });
    assert.deepEqual(approved.calls.map((c) => [c.applicationId, c.status, c.eventType]), [[APP(1), "Approved", "reconsideration"]]);
    assert.equal(approved.decline.outcome, "approved_on_recon");

    const declined = await answer("still_declined", "Applied");
    assert.deepEqual(declined.calls.map((c) => [c.applicationId, c.status, c.eventType]), [[APP(1), "Denied", "reconsideration"]]);

    const later = await answer("reapply_later", "Applied", { reapplyOn: "2027-01-15" });
    assert.deepEqual(later.calls.map((c) => [c.applicationId, c.status, c.eventType]), [[APP(1), "Denied", "reconsideration"]],
      "apply again later also leaves the application Denied");
    assert.equal(later.decline.outcome, "reapply_later");
    assert.equal(later.decline.reapply_on, "2027-01-15");

    const already = await answer("still_declined", "Denied");
    assert.deepEqual(already.calls, [], "an application already Denied is left alone");
  });
});

// ───────────────────────── declines: the steps ─────────────────────────

test("Declines (server): the client's steps and Fundhub's steps are sorted by who does them, with their status and the done count", async () => {
  await proof.check(/^Your steps list \+ Fundhub's steps expander/, async () => {
    const steps = [
      { who: "client", client_text: "Send the second page of the letter", step_text: "STAFF SCRIPT one", source_ref: "Calling DENIED — Step 3", status: "done" },
      { who: "client", client_text: "Confirm your business phone", step_text: "STAFF SCRIPT two", source_ref: "Calling DENIED — Step 4", status: "open" },
      { who: "client", client_text: "Skip the survey", step_text: "STAFF SCRIPT three", source_ref: "Calling DENIED — Step 5", status: "skipped" },
      { who: "agent", client_text: "We read your letter", step_text: "STAFF SCRIPT four", source_ref: "Notion", status: "done" },
      { who: "ops", client_text: "We call the bank", step_text: "STAFF SCRIPT five", source_ref: "Notion", status: "open" },
      { who: "ops", client_text: "We write the second letter", step_text: "STAFF SCRIPT six", source_ref: "Notion", status: "skipped" },
    ];
    const view = clientDecline(declineRow({ analysis: {} }), steps);
    assert.deepEqual(view.your_steps, [
      { text: "Send the second page of the letter", status: "done" },
      { text: "Confirm your business phone", status: "open" },
      { text: "Skip the survey", status: "skipped" },
    ], "only the steps the client does, each with its own status");
    assert.deepEqual(view.fundhub_steps, [
      { text: "We read your letter", status: "done" },
      { text: "We call the bank", status: "open" },
      { text: "We write the second letter", status: "skipped" },
    ], "everything that is not the client's is Fundhub's, in order, with its own status");
    assert.deepEqual([view.fundhub_done, view.fundhub_total], [2, 3], "a finished or skipped step counts as done, an open one does not");
    const blob = JSON.stringify(view);
    assert.doesNotMatch(blob, /STAFF SCRIPT|Calling DENIED|Notion/, "no staff script or source leaves the client's read");

    // a plan with no steps says so with zeros, not with a missing count
    const bare = clientDecline(declineRow(), []);
    assert.deepEqual([bare.your_steps, bare.fundhub_steps, bare.fundhub_done, bare.fundhub_total], [[], [], 0, 0]);
  });
});

test("Declines (server): the read hands each decline its own steps, split by who does them, and no other decline's", async () => {
  await proof.check(/^Your steps list \+ Fundhub's steps expander/, async () => {
    const db = memoryDb({ applications: [] });
    db.t.declines.push(declineRow({ id: DEC(1) }), declineRow({ id: DEC(2), bank: "Amex", created_at: new Date("2026-10-03T15:00:00Z") }));
    const step = (decline, position, who, text, status) => ({
      id: `s-${decline}-${position}`, org_id: ORG, decline_id: decline, position, step_key: `k${position}`, who, client_text: text, status,
    });
    db.t.steps.push(
      step(DEC(1), 1, "client", "First of Chase", "done"),
      step(DEC(1), 2, "client", "Second of Chase", "open"),
      step(DEC(1), 3, "ops", "Ours for Chase", "done"),
      step(DEC(2), 1, "client", "Only one for Amex", "open"),
    );
    const read = await readDeclines(db, { orgId: ORG, clientId: CLIENT, viewer: { kind: "client" } });
    const byId = new Map(read.view.declines.map((d) => [d.id, d]));
    assert.deepEqual(byId.get(DEC(1)).your_steps.map((s) => s.text), ["First of Chase", "Second of Chase"]);
    assert.deepEqual(byId.get(DEC(1)).fundhub_steps.map((s) => s.text), ["Ours for Chase"]);
    assert.deepEqual([byId.get(DEC(1)).fundhub_done, byId.get(DEC(1)).fundhub_total], [1, 1]);
    assert.deepEqual(byId.get(DEC(2)).your_steps.map((s) => s.text), ["Only one for Amex"], "a decline reads its own steps and no other's");
    assert.deepEqual(byId.get(DEC(2)).fundhub_steps, []);
  });
});

// ───────────────────────── helper: the banner feed ─────────────────────────

const MINE = "11111111-2222-3333-4444-555555555555";
const NOW = () => new Date("2026-10-07T17:00:00Z");
const res = () => ({
  statusCode: null, body: null, headers: {},
  status(code) { this.statusCode = code; return this; },
  setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; return this; },
  json(body) { this.body = body; return this; },
});
const asClient = async (_req, _res, _kinds) => ({ kind: "client", accountId: "acc-1", orgId: "org-1", clientId: MINE });

function helperWorld({ agent, thread }) {
  return {
    async query(sql) {
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) return { rows: [{ id: MINE, first_name: "Test", last_name: "Test" }] };
      if (/FROM agent_bridge_heartbeats/.test(sql)) return { rows: [{ last_at: new Date("2026-10-07T16:59:50Z") }] };
      if (/FROM agents WHERE org_id/.test(sql)) return { rows: agent ? [{ code: "FOS-01", name: "FinanceOS Money Helper", prompt: "p", guardrails: {}, ...agent }] : [] };
      if (/FROM money_helper_threads/.test(sql)) return { rows: thread ? [thread] : [] };
      return { rows: [] };
    },
  };
}

async function helperFeed(world) {
  const out = res();
  await helperHandler({ method: "GET", query: {} }, out, { db: helperWorld(world), requirePrincipal: asClient, now: NOW, env: {} });
  assert.equal(out.statusCode, 200);
  return out.body.helper;
}

test("Helper (server): a stopped thread reaches the banner as halted with its reason, a running one does not", async () => {
  await proof.check(/^Banner: helper stopped \/ not switched on/, async () => {
    const stop = await helperFeed({ agent: { status: "shadow" }, thread: { halted_at: new Date("2026-10-07T16:00:00Z"), halt_reason: "stop" } });
    assert.deepEqual([stop.halted, stop.halt_reason], [true, "stop"], "a stop the client asked for is sent as halted, with its reason");
    const legal = await helperFeed({ agent: { status: "live" }, thread: { halted_at: new Date("2026-10-07T16:00:00Z"), halt_reason: "legal" } });
    assert.deepEqual([legal.halted, legal.halt_reason], [true, "legal"], "a stop for another reason says that reason");
    const running = await helperFeed({ agent: { status: "shadow" }, thread: null });
    assert.deepEqual([running.halted, running.halt_reason], [false, null], "no stop is sent as not halted");
    const opened = await helperFeed({ agent: { status: "shadow" }, thread: { halted_at: null, halt_reason: null } });
    assert.deepEqual([opened.halted, opened.halt_reason], [false, null], "a thread row with no stop is not halted");
  });
});

test("Helper (server): the helper is on only while its agent is running (shadow or live), and off for anything else", async () => {
  await proof.check(/^Banner: helper stopped \/ not switched on/, async () => {
    const on = async (agent) => (await helperFeed({ agent, thread: null })).on;
    assert.equal(await on({ status: "shadow" }), true, "shadow answers in the app, so it is on");
    assert.equal(await on({ status: "live" }), true);
    assert.equal(await on({ status: "draft" }), false, "a draft agent is not switched on");
    assert.equal(await on({ status: "retired" }), false, "a retired agent is not switched on");
    assert.equal(await on(null), false, "no agent row at all is not switched on");
    // the status itself goes to the page as written, so staff can see why it is off
    assert.equal((await helperFeed({ agent: { status: "draft" }, thread: null })).status, "draft");
  });
});

// ───────────────────────── payments: the list behind the empty state ─────────────────────────

const PLAN = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "Fundhub payment plan", status: "open", left_cents: 100000, late_cents: 0, is_late: false,
  installments: [{ seq: 1, due_on: "2026-11-02", left_cents: 100000, state: "upcoming" }],
};

async function paymentsFeed(plans) {
  const out = res();
  await paymentsHandler({ method: "GET", query: {} }, out, {
    db: { query: async () => ({ rows: [] }) },
    requirePrincipal: asClient,
    now: NOW,
    env: {},
    listClarityPayments: async () => plans,
    moneyOverview: async () => ({ ok: true, client: { id: MINE, name: "Sam" }, upcoming: [] }),
    readMoneyLog: async () => [],
    readUnmatchedPayments: async () => [],
  });
  assert.equal(out.statusCode, 200);
  return out.body;
}

test("Payments (server): a client who owes is sent the plans they owe, and one who owes nothing is sent none", async () => {
  await proof.check(/^Empty state \('You do not owe Fundhub anything right now'\)/, async () => {
    const owing = await paymentsFeed([PLAN]);
    assert.deepEqual(owing.plans, [PLAN], "the plan reaches the page, so the page does not say 'you owe nothing'");
    assert.deepEqual(owing.owed, { open_count: 1, left_cents: 100000, late_cents: 0, late_count: 0 });

    // a settled plan is still listed (the page shows it as settled); it is not counted as owed
    const settled = await paymentsFeed([{ ...PLAN, status: "settled", left_cents: 0 }]);
    assert.equal(settled.plans.length, 1);
    assert.deepEqual(settled.owed, { open_count: 0, left_cents: 0, late_cents: 0, late_count: 0 });

    const none = await paymentsFeed([]);
    assert.deepEqual(none.plans, []);
    assert.deepEqual(none.owed, { open_count: 0, left_cents: 0, late_cents: 0, late_count: 0 });
  });
});

// ───────────────────────── transfers: what happened ─────────────────────────

const TRANSFER = "7b0f0c52-31d6-4f0e-9d6e-2a51f1e0a0b1";
const TASK = "9c1d2e3f-0000-4000-8000-00000000a0b1";

function fakeTransferStore(events) {
  return {
    isTransferStore: true,
    async client() { return { id: CLIENT, first_name: "Sam", last_name: "Client" }; },
    async sendableAccounts() { return []; },
    async moneyTasks() {
      return [{
        id: TASK, title: "Deposit to build banking history", amount_cents: 2000, to_kind: "bank_account", kind: "deposit", source: "staff",
        status: "done", requested_by_kind: "staff", result: { client_message: "Done." }, created_at: "2026-10-07T04:00:00.000Z",
      }];
    },
    async transfersForTasks() {
      return [{
        id: TRANSFER, agent_task_id: TASK, status: "settled", status_reason: null, environment: "sandbox",
        from_account_label: "Personal Checking ••1101", to_account_label: "Business Checking ••2202", scheduled_for: "2026-10-07",
        debit_status: "settled", credit_status: "settled", approved_by_kind: "client", approved_at: "2026-10-07T04:01:00.000Z",
        approval_terms: { words: "I said yes." }, settled_at: "2026-10-07T05:00:00.000Z", cancelled_by_kind: null,
        debit_transfer_id: "d", credit_transfer_id: "c", credit_authorization_id: "a",
      }];
    },
    async events() { return events; },
    async usedOnDay() { return 0; },
    async account() { return null; },
  };
}

const LINE = (id, type, over = {}) => ({
  id, transfer_id: TRANSFER, event_type: type, created_at: new Date(Date.UTC(2026, 9, 7, 4, id, 0)),
  leg: null, actor_kind: "system", from_status: null, to_status: "approved", ...over,
});

test("Transfers (server): the read hands the page every ledger line of a move, in order, with its type, time, side, who and status", async () => {
  await proof.check(/^What happened \(details toggle: ledger events in words\)/, async () => {
    const lines = [
      LINE(1, "approved", { actor_kind: "client", to_status: "approved" }),
      LINE(2, "started", { actor_kind: "system", from_status: "approved", to_status: "authorized" }),
      LINE(3, "plaid_posted", { actor_kind: "provider", leg: "debit", from_status: "authorized", to_status: "submitted" }),
      LINE(4, "plaid_settled", { actor_kind: "provider", leg: "credit", from_status: "submitted", to_status: "settled" }),
    ];
    const view = await moneyTransfersView(fakeTransferStore(lines), { orgId: ORG, clientId: CLIENT, env: {}, now: new Date("2026-10-07T15:00:00Z") });
    assert.equal(view.history.length, 1);
    assert.deepEqual(view.history[0].transfer.events, [
      { type: "approved", at: "2026-10-07T04:01:00.000Z", leg: null, actor: "client", from_status: null, to_status: "approved" },
      { type: "started", at: "2026-10-07T04:02:00.000Z", leg: null, actor: "system", from_status: "approved", to_status: "authorized" },
      { type: "plaid_posted", at: "2026-10-07T04:03:00.000Z", leg: "debit", actor: "provider", from_status: "authorized", to_status: "submitted" },
      { type: "plaid_settled", at: "2026-10-07T04:04:00.000Z", leg: "credit", actor: "provider", from_status: "submitted", to_status: "settled" },
    ]);

    // only the newest 24 lines of a long story are sent
    const long = Array.from({ length: 30 }, (_, i) => LINE(i + 1, i % 2 ? "provider_wait" : "started"));
    const cut = await moneyTransfersView(fakeTransferStore(long), { orgId: ORG, clientId: CLIENT, env: {}, now: new Date("2026-10-07T15:00:00Z") });
    assert.equal(cut.history[0].transfer.events.length, 24);
    assert.equal(cut.history[0].transfer.events[0].at, "2026-10-07T04:07:00.000Z", "the oldest six are the ones dropped");
    assert.equal(cut.history[0].transfer.events[23].at, "2026-10-07T04:30:00.000Z");
  });
});

/** The page's own script, run in Node (it loads nothing and reads no page when there is no document). */
function pageWords() {
  const source = fs.readFileSync(path.join(ROOT, "public/app/money-transfers.js"), "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "money-transfers.js" });
  return { eventWords: context.FHMoneyTransfers.eventWords, source };
}

const ITEM = { transfer: { from_label: "Personal Checking ••1101", to_label: "Business Checking ••2202", approved_by: "client" } };
const SAID = (type, leg = null, item = ITEM) => pageWords().eventWords({ type, leg }, item);

test("Transfers (server): the page tells every ledger line it can tell in its own words, on the right side of the move", async () => {
  await proof.check(/^What happened \(details toggle: ledger events in words\)/, async () => {
    const WORDS = {
      approved: "Said yes",
      started: "Started today's move",
      authorized: "Bank check passed",
      declined: "Bank check said no",
      submitted: "Asked the bank to take the money out",
      credit_authorized: "Bank check passed for the second account",
      credit_submitted: "Asked the bank to put the money in",
      cancelled: "Stopped",
      date_passed: "The date passed — nothing moved",
      failed: "Did not go through",
      provider_wait: "The bank did not answer — trying again",
      provider_not_enabled: "The bank connection is not switched on",
      needs_bank_login: "The bank login needs fixing",
      account_removed: "An account was disconnected",
    };
    // the table here is the page's table: a word added or taken away on the page has to be pinned here too
    const { source } = pageWords();
    const table = /var EVENT_WORDS = \{([\s\S]*?)\};/.exec(source)[1];
    const pageKeys = [...table.matchAll(/^\s*([a-z_]+):\s*"/gm)].map((m) => m[1]).sort();
    assert.deepEqual(Object.keys(WORDS).sort(), pageKeys, "every word the page has is pinned here, and none that it lacks");
    for (const [type, words] of Object.entries(WORDS)) assert.equal(SAID(type), words, `${type} says its words`);

    // the practice-run yes is its own words; a client's yes is just "Said yes"
    assert.equal(SAID("approved", null, { transfer: { approved_by: "sandbox_role_play" } }), "Said yes (practice run, sandbox)");
    // a line the page has no words for is its name in plain words, never blank
    assert.equal(SAID("brand_new_kind"), "brand new kind");

    // a bank line says which side of the move it is, and the bank's word for it
    const LEGS = {
      pending: "waiting at the bank", posted: "sent", settled: "done", funds_available: "money ready",
      failed: "failed", returned: "sent back", cancelled: "stopped",
    };
    for (const [word, words] of Object.entries(LEGS)) {
      assert.equal(SAID(`plaid_${word}`, "debit"), `Out of Personal Checking ••1101: ${words}`, `debit side, ${word}`);
      assert.equal(SAID(`plaid_${word}`, "credit"), `Into Business Checking ••2202: ${words}`, `credit side, ${word}`);
    }
    assert.equal(SAID("plaid_posted", null), "Out of Personal Checking ••1101: sent", "a bank line with no side is told on the debit side");
    assert.equal(SAID("plaid_new_thing", "credit"), "Into Business Checking ••2202: new thing", "a bank word the page does not know is said plainly");
    assert.equal(SAID("plaid_posted", "debit", { transfer: {} }), "Out of your account: sent", "no account name says 'your account'");
    assert.equal(SAID("plaid_posted", "credit", { transfer: {} }), "Into the other account: sent", "no account name says 'the other account'");
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
