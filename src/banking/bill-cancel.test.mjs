// "Cancel it for me" — src/banking/bill-cancel.mjs. Pure parts run on plain
// rows; the writes run on a small fake database that records every statement.
// No Postgres, no network, no real task.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  cancelState, buildBillCancel, billView, cleanCancelUrl, taskWords, dayOf,
  readBillCancel, requestBillCancel, setCancelLink, SOURCE_WORKFLOW, TASK_ROLE, URL_MAX
} from "./bill-cancel.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const ACCT = "a1000000-0000-4000-8000-000000000001";
const ACCT2 = "a2000000-0000-4000-8000-000000000002";
const BILL = "b1000000-0000-4000-8000-000000000001";
const TASK = "71000000-0000-4000-8000-000000000001";
const STAFF = "5aff0000-0000-4000-8000-000000000001";

const billRow = (over = {}) => ({
  id: BILL, bank_account_id: ACCT, merchant_key: "SAMPLE STREAMING", merchant_display: "Sample Streaming",
  cadence: "monthly", typical_amount_cents: "-1599", next_expected_on: "2026-11-12", last_seen_on: "2026-10-12",
  account_name: "Sample Checking", account_official_name: null, account_mask: "xxxx4821", ...over
});
const ask = (over = {}) => ({
  id: "r1", bank_account_id: ACCT, merchant_key: "SAMPLE STREAMING", created_at: new Date("2026-11-06T15:00:00Z"),
  task_id: TASK, task_done: false, task_staff_id: null, task_updated_at: new Date("2026-11-06T15:00:00Z"), ...over
});

describe("cancelState — where one ask stands, read from its team task", () => {
  test("no ask: the button shows", () => {
    assert.deepEqual(cancelState(null), { state: "none", asked_on: null, cancelled_on: null, charged_again_on: null, can_ask: true });
  });

  test("an open task nobody took is Requested; a claimed one is Working", () => {
    const r = cancelState(ask());
    assert.equal(r.state, "requested");
    assert.equal(r.asked_on, "2026-11-06");
    assert.equal(r.can_ask, false);
    assert.equal(cancelState(ask({ task_staff_id: STAFF })).state, "working");
  });

  test("a done task is Cancelled on the day it was marked done", () => {
    const r = cancelState(ask({ task_done: true, task_updated_at: new Date("2026-11-09T20:00:00Z") }), { lastChargeOn: "2026-10-12" });
    assert.equal(r.state, "cancelled");
    assert.equal(r.cancelled_on, "2026-11-09");
    assert.equal(r.charged_again_on, null);
    assert.equal(r.can_ask, false);
  });

  test("a charge after the cancel day says Charged again and lets the client ask again", () => {
    const r = cancelState(ask({ task_done: true, task_updated_at: new Date("2026-11-09T20:00:00Z") }), { lastChargeOn: "2026-11-12" });
    assert.equal(r.state, "cancelled");
    assert.equal(r.charged_again_on, "2026-11-12");
    assert.equal(r.can_ask, true);
    // The same day is not "after".
    assert.equal(cancelState(ask({ task_done: true, task_updated_at: new Date("2026-11-12T08:00:00Z") }), { lastChargeOn: "2026-11-12" }).charged_again_on, null);
  });

  test("an ask whose task was removed is no ask at all", () => {
    assert.equal(cancelState(ask({ task_id: null, task_done: null })).state, "none");
    assert.equal(cancelState(ask({ task_done: null })).state, "none");
  });
});

describe("buildBillCancel — the block the Strategy screen draws", () => {
  test("the newest ask per bill wins, matched by account AND merchant", () => {
    const out = buildBillCancel({
      bills: [billRow(), billRow({ id: "b2", bank_account_id: ACCT2 })],
      requests: [
        ask({ id: "new", task_staff_id: STAFF }),
        ask({ id: "old", task_done: true }),
        ask({ id: "other-merchant", merchant_key: "SAMPLE GYM" })
      ]
    });
    const [a, b] = out.bills;
    assert.equal(a.cancel.state, "working", "newest of the two asks on this bill");
    assert.equal(b.cancel.state, "none", "the same merchant on another account is another bill");
    assert.deepEqual(out.counts, { requested: 0, working: 1, cancelled: 0 });
  });

  test("a bill reads the size of its charge; an unknown amount stays null, never 0", () => {
    const [b] = buildBillCancel({ bills: [billRow()] }).bills;
    assert.equal(b.amount_cents, 1599);
    assert.equal(b.name, "Sample Streaming");
    assert.equal(b.account_mask, "4821");
    const [u] = buildBillCancel({ bills: [billRow({ typical_amount_cents: null, merchant_display: null })] }).bills;
    assert.equal(u.amount_cents, null);
    assert.equal(u.name, "SAMPLE STREAMING");
  });

  test("the merchant's own cancel link shows only for that merchant", () => {
    const out = buildBillCancel({
      bills: [billRow(), billRow({ id: "b2", merchant_key: "SAMPLE GYM", merchant_display: "Sample Gym" })],
      links: [{ merchant_key: "SAMPLE STREAMING", url: "https://example.com/cancel", set_at: new Date("2026-11-01T00:00:00Z") }]
    });
    const by = Object.fromEntries(out.bills.map((b) => [b.name, b]));
    assert.deepEqual(by["Sample Streaming"].link, { url: "https://example.com/cancel", set_on: "2026-11-01" });
    assert.equal(by["Sample Gym"].link, null);
  });

  test("sorted by next charge, then name; the viewer is only client or staff", () => {
    const out = buildBillCancel({
      bills: [
        billRow({ id: "late", merchant_display: "A", next_expected_on: null }),
        billRow({ id: "soon", merchant_display: "Z", next_expected_on: "2026-11-02" }),
        billRow({ id: "mid", merchant_display: "M", next_expected_on: "2026-11-20" })
      ],
      viewer: "anyone"
    });
    assert.deepEqual(out.bills.map((b) => b.id), ["soon", "mid", "late"]);
    assert.equal(out.viewer, "client");
    assert.equal(buildBillCancel({ viewer: "staff" }).viewer, "staff");
  });
});

describe("cleanCancelUrl — https only, a real host, nothing hidden in it", () => {
  test("keeps a full https address", () => {
    assert.equal(cleanCancelUrl(" https://example.com/account/cancel "), "https://example.com/account/cancel");
  });
  test("refuses anything else", () => {
    for (const bad of ["http://example.com/cancel", "javascript:alert(1)", "https://user:pw@example.com/x",
      "https://example.com/a b", "https://localhost/cancel", "example.com/cancel", "", null,
      "https://example.com/" + "x".repeat(URL_MAX)]) {
      assert.equal(cleanCancelUrl(bad), null, String(bad).slice(0, 40));
    }
  });
});

describe("taskWords — the CSM's task says only what is on file", () => {
  test("amount, how often, the account, the last and next charge, and a due day before the next charge", () => {
    const w = taskWords(billRow(), { today: "2026-11-07" });
    assert.equal(w.title, "Cancel a repeat bill: Sample Streaming");
    assert.match(w.detail, /The client asked Fundhub to cancel Sample Streaming\./);
    assert.match(w.detail, /It charges \$15\.99 every month on Sample Checking ····4821\./);
    assert.match(w.detail, /Last charge Oct 12, 2026\./);
    assert.match(w.detail, /Next charge about Nov 12, 2026\./);
    assert.match(w.detail, /mark this task done/);
    assert.equal(w.dueAt, "2026-11-12");
  });
  test("an unknown amount is left out (never $0), and a past next date sets no due day", () => {
    const w = taskWords(billRow({ typical_amount_cents: null, next_expected_on: "2026-10-01" }), { today: "2026-11-07" });
    assert.doesNotMatch(w.detail, /\$0/);
    assert.match(w.detail, /It charges every month on Sample Checking/);
    assert.equal(w.dueAt, null);
  });
});

test("dayOf reads dates and timestamps as the UTC day", () => {
  assert.equal(dayOf("2026-11-07"), "2026-11-07");
  assert.equal(dayOf(new Date("2026-11-07T23:30:00Z")), "2026-11-07");
  assert.equal(dayOf("2026-11-07T23:30:00.000Z"), "2026-11-07");
  assert.equal(dayOf("not a day"), null);
  assert.equal(dayOf(null), null);
});

/* ── the writes, on a fake database ─────────────────────────────────────── */

function fakeDb({ bill = billRow(), latest = null, links = [], requests = [], taskByKey = null, fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (fail && fail.test(sql)) throw new Error("boom");
      if (/FROM recurring_bills b/.test(sql) && /b\.id = \$3/.test(sql)) return { rows: bill ? [bill] : [] };
      if (/FROM recurring_bills b/.test(sql)) return { rows: bill ? [bill] : [] };
      if (/count\(\*\) OVER \(\)/.test(sql)) return { rows: latest ? [latest] : [] };
      if (/FROM bill_cancel_requests r/.test(sql)) return { rows: requests };
      if (/FROM merchant_cancel_links/.test(sql)) return { rows: links };
      if (/INSERT INTO bill_cancel_requests/.test(sql)) return { rows: [{ id: "new-request" }] };
      if (/INSERT INTO merchant_cancel_links/.test(sql)) return { rows: [{ merchant_key: params[1], url: params[2], set_at: new Date("2026-11-07T12:00:00Z") }] };
      if (/FROM tasks/.test(sql)) return { rows: taskByKey ? [{ id: taskByKey }] : [] };
      return { rows: [] };
    }
  };
}
function taskSpy(result = { created: true, id: TASK, reason: null }) {
  const calls = [];
  const fn = async (_db, spec) => { calls.push(spec); return result; };
  fn.calls = calls;
  return fn;
}
const NOW = new Date("2026-11-07T18:00:00Z");

describe("requestBillCancel — one press opens one team task", () => {
  test("a new ask: a CSM task with the bill's facts, then the request row on that task", async () => {
    const db = fakeDb();
    const createTask = taskSpy();
    const r = await requestBillCancel(db, { orgId: ORG, clientId: CLIENT, billId: BILL, actor: "client", now: NOW, createTask });
    assert.equal(r.ok, true);
    assert.equal(r.created, true);
    assert.equal(createTask.calls.length, 1);
    const spec = createTask.calls[0];
    assert.equal(spec.assigneeRole, TASK_ROLE);
    assert.equal(spec.assigneeRole, "csm");
    assert.equal(spec.sourceWorkflow, SOURCE_WORKFLOW);
    assert.equal(spec.orgId, ORG);
    assert.equal(spec.clientId, CLIENT);
    assert.equal(spec.eventId, `bill-cancel:${ACCT}:SAMPLE STREAMING:1`);
    assert.equal(spec.dueAt, "2026-11-12");
    assert.match(spec.detail, /\$15\.99 every month/);
    const insert = db.calls.find((c) => /INSERT INTO bill_cancel_requests/.test(c.sql));
    assert.ok(insert, "the request row is written");
    assert.deepEqual(insert.params.slice(0, 5), [ORG, CLIENT, ACCT, "SAMPLE STREAMING", BILL]);
    assert.equal(insert.params[6], 1599, "the size of the charge, positive");
    assert.equal(insert.params[8], TASK);
    assert.equal(insert.params[9], "client");
    assert.equal(insert.params[10], null, "a client press names no staff member");
    assert.equal(r.bill_cancel.ok, true);
  });

  test("every statement is bound to the org and the client (the cancel-link list is the org's own)", async () => {
    const db = fakeDb();
    await requestBillCancel(db, { orgId: ORG, clientId: CLIENT, billId: BILL, now: NOW, createTask: taskSpy() });
    assert.ok(db.calls.length >= 4);
    for (const c of db.calls) {
      assert.equal(c.params[0], ORG, c.sql.slice(0, 60));
      if (/FROM merchant_cancel_links/.test(c.sql)) continue;
      assert.equal(c.params[1], CLIENT, c.sql.slice(0, 60));
    }
  });

  test("an open ask (Requested or Working) answers with what is there and opens nothing", async () => {
    for (const latest of [ask({ prior: "1" }), ask({ prior: "1", task_staff_id: STAFF })]) {
      const db = fakeDb({ latest });
      const createTask = taskSpy();
      const r = await requestBillCancel(db, { orgId: ORG, clientId: CLIENT, billId: BILL, now: NOW, createTask });
      assert.equal(r.ok, true);
      assert.equal(r.created, false);
      assert.equal(createTask.calls.length, 0);
      assert.equal(db.calls.some((c) => /INSERT INTO bill_cancel_requests/.test(c.sql)), false);
    }
  });

  test("a cancel that held is not asked twice; one that charged again is a second task", async () => {
    const held = fakeDb({ latest: ask({ prior: "1", task_done: true, task_updated_at: new Date("2026-11-01T12:00:00Z") }),
      bill: billRow({ last_seen_on: "2026-10-12" }) });
    const noTask = taskSpy();
    assert.equal((await requestBillCancel(held, { orgId: ORG, clientId: CLIENT, billId: BILL, now: NOW, createTask: noTask })).created, false);
    assert.equal(noTask.calls.length, 0);

    const again = fakeDb({ latest: ask({ prior: "1", task_done: true, task_updated_at: new Date("2026-11-01T12:00:00Z") }),
      bill: billRow({ last_seen_on: "2026-11-05" }) });
    const second = taskSpy({ created: true, id: "72000000-0000-4000-8000-000000000002" });
    const r = await requestBillCancel(again, { orgId: ORG, clientId: CLIENT, billId: BILL, now: NOW, createTask: second });
    assert.equal(r.created, true);
    assert.equal(second.calls[0].eventId, `bill-cancel:${ACCT}:SAMPLE STREAMING:2`);
  });

  test("two presses at once: the other press's task is found by its key and reused", async () => {
    const db = fakeDb({ taskByKey: TASK });
    const r = await requestBillCancel(db, { orgId: ORG, clientId: CLIENT, billId: BILL, now: NOW,
      createTask: taskSpy({ created: false, id: null, reason: "duplicate_race" }) });
    assert.equal(r.ok, true);
    assert.equal(r.created, false);
    const insert = db.calls.find((c) => /INSERT INTO bill_cancel_requests/.test(c.sql));
    assert.equal(insert.params[8], TASK);
  });

  test("no task, no request row", async () => {
    const db = fakeDb();
    const r = await requestBillCancel(db, { orgId: ORG, clientId: CLIENT, billId: BILL, now: NOW,
      createTask: taskSpy({ created: false, id: null, reason: "duplicate_race" }) });
    assert.deepEqual(r, { ok: false, error: "task_not_saved" });
    assert.equal(db.calls.some((c) => /INSERT INTO bill_cancel_requests/.test(c.sql)), false);
  });

  test("a bad id or a bill not on this client's file is refused before any task", async () => {
    const createTask = taskSpy();
    assert.deepEqual(await requestBillCancel(fakeDb(), { orgId: ORG, clientId: CLIENT, billId: "nope", createTask }), { ok: false, error: "bad_bill_id" });
    assert.deepEqual(await requestBillCancel(fakeDb({ bill: null }), { orgId: ORG, clientId: CLIENT, billId: BILL, createTask }), { ok: false, error: "bill_not_found" });
    assert.equal(createTask.calls.length, 0);
  });

  test("a staff press says so and names the staff member", async () => {
    const db = fakeDb();
    await requestBillCancel(db, { orgId: ORG, clientId: CLIENT, billId: BILL, actor: "staff", staffId: STAFF, now: NOW, createTask: taskSpy() });
    const insert = db.calls.find((c) => /INSERT INTO bill_cancel_requests/.test(c.sql));
    assert.equal(insert.params[9], "staff");
    assert.equal(insert.params[10], STAFF);
  });
});

describe("setCancelLink — a team member saves the merchant's own cancel page", () => {
  test("the merchant comes from the client's own bill, never from the browser", async () => {
    const db = fakeDb();
    const r = await setCancelLink(db, { orgId: ORG, clientId: CLIENT, billId: BILL, url: "https://example.com/cancel", staffId: STAFF });
    assert.equal(r.ok, true);
    const up = db.calls.find((c) => /INSERT INTO merchant_cancel_links/.test(c.sql));
    assert.deepEqual(up.params, [ORG, "SAMPLE STREAMING", "https://example.com/cancel", STAFF]);
    assert.equal(r.link.url, "https://example.com/cancel");
    assert.equal(r.bill_cancel.viewer, "staff");
  });

  test("a bad link writes nothing; a bill not on file writes nothing", async () => {
    const db = fakeDb();
    assert.deepEqual(await setCancelLink(db, { orgId: ORG, clientId: CLIENT, billId: BILL, url: "http://example.com" }), { ok: false, error: "bad_url" });
    assert.equal(db.calls.length, 0);
    const gone = fakeDb({ bill: null });
    assert.deepEqual(await setCancelLink(gone, { orgId: ORG, clientId: CLIENT, billId: BILL, url: "https://example.com/x" }), { ok: false, error: "bill_not_found" });
    assert.equal(gone.calls.some((c) => /merchant_cancel_links/.test(c.sql)), false);
  });
});

describe("readBillCancel — the read never takes the Strategy screen down", () => {
  test("a failed read is ok:false, not a throw", async () => {
    const r = await readBillCancel(fakeDb({ fail: /FROM recurring_bills/ }), { orgId: ORG, clientId: CLIENT });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "read_failed");
  });
  test("no bills: no other read", async () => {
    const db = fakeDb({ bill: null });
    const r = await readBillCancel(db, { orgId: ORG, clientId: CLIENT, viewer: "staff" });
    assert.deepEqual(r, { ok: true, viewer: "staff", bills: [], counts: { requested: 0, working: 0, cancelled: 0 } });
    assert.equal(db.calls.length, 1);
  });
  test("bills with their asks and links, only presentable bills on open accounts", async () => {
    const db = fakeDb({ requests: [ask()], links: [{ merchant_key: "SAMPLE STREAMING", url: "https://example.com/c", set_at: null }] });
    const r = await readBillCancel(db, { orgId: ORG, clientId: CLIENT });
    assert.equal(r.bills[0].cancel.state, "requested");
    assert.equal(r.bills[0].link.url, "https://example.com/c");
    const read = db.calls[0];
    assert.deepEqual(read.params[2], ["medium", "high"]);
    assert.match(read.sql, /a\.closed_at IS NULL/);
    assert.match(read.sql, /a\.client_id = b\.client_id/);
  });
});

test("billView never shows a negative amount", () => {
  assert.equal(billView(billRow({ typical_amount_cents: -250000 })).amount_cents, 250000);
});
