// The client's checklist as plan pins, and the staff mark through the one
// completion path. Stub db; no Postgres. Rows are shaped like the seeded
// catalog (db/migrations/362, 400).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { toPin, staffRefusal, kindOf, utcDay, mark, pins, MARKS, name } from "./waypoints.mjs";
import { REFUSAL_MESSAGES } from "../../waypoints/self-attest.mjs";

const NOW = new Date("2026-10-07T02:00:00Z");
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "029964c5-4d8e-47ed-88c9-53ac13863fd4";
const ID = "5d1c3f9e-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

const row = (over = {}) => ({
  id: ID, org_id: ORG, client_id: CLIENT, key: "personal_loan",
  title: "Talk to your advisor about a personal loan",
  detail: "Raise it early, before any of the optimization work changes your accounts.",
  owner_kind: "client", state: "not_started", verify_kind: null,
  due_at: "2026-10-14T04:30:35.217Z", completed_at: null, ...over
});

describe("toPin", () => {
  test("a person-closed client step: planned, a checkpoint, staff may mark it done", () => {
    const p = toPin(row(), NOW);
    assert.deepEqual(p, {
      id: `waypoint:${ID}`, date: "2026-10-14", kind: "checkpoint",
      title: "Talk to your advisor about a personal loan",
      detail: "Raise it early, before any of the optimization work changes your accounts.",
      amount_cents: null, bank: null, container_id: null, status: "planned", source: name, can_mark: ["done"]
    });
    assert.deepEqual(MARKS, ["done"]);
  });

  test("status: done when done; missed when overdue and open; never missed without a date", () => {
    assert.equal(toPin(row({ state: "done", completed_at: "2026-10-01T00:00:00Z" }), NOW).status, "done");
    assert.equal(toPin(row({ due_at: "2026-10-01T00:00:00Z" }), NOW).status, "missed");
    assert.equal(toPin(row({ due_at: "2026-10-01T00:00:00Z", state: "blocked" }), NOW).status, "missed");
    assert.equal(toPin(row({ due_at: null }), NOW), null, "no due date is no pin — nobody set a deadline");
  });

  test("a done step offers no mark", () => {
    assert.deepEqual(toPin(row({ state: "done", completed_at: "2026-10-01T00:00:00Z" }), NOW).can_mark, []);
  });

  test("machine-checked steps keep their proof rules: no staff mark", () => {
    assert.deepEqual(toPin(row({ key: "paydown_chase_1", verify_kind: "paydown" }), NOW).can_mark, []);
    assert.deepEqual(toPin(row({ key: "no_new_credit", verify_kind: "no_new_credit" }), NOW).can_mark, []);
    assert.deepEqual(toPin(row({ key: "blueprint_dispute_bureau_response", verify_kind: "bureau_response_upload" }), NOW).can_mark, []);
  });

  test("staff may close Fundhub's own step when nothing machine-checks it", () => {
    assert.deepEqual(toPin(row({ owner_kind: "fundhub" }), NOW).can_mark, ["done"]);
  });

  test("the kind only picks the icon: paydown, open account, or a checklist step", () => {
    assert.equal(kindOf({ verify_kind: "paydown", key: "paydown_amex_1" }), "pay_down");
    assert.equal(kindOf({ key: "business_checking" }), "open_account");
    assert.equal(kindOf({ key: "form_llc" }), "checkpoint");
  });

  test("the date is the UTC calendar day of due_at — the day the progress page prints", () => {
    assert.equal(utcDay("2026-10-14T04:30:35.217Z"), "2026-10-14");
    assert.equal(utcDay("2026-10-14T23:30:00-07:00"), "2026-10-15");
    assert.equal(utcDay(new Date("2026-10-31T23:59:59Z")), "2026-10-31");
    assert.equal(utcDay(null), null);
    assert.equal(utcDay("not a date"), null);
  });
});

describe("staffRefusal", () => {
  test("the client's rule, minus 'our step'", () => {
    assert.equal(staffRefusal(null), "not_found");
    assert.equal(staffRefusal(row({ state: "skipped" })), "skipped");
    assert.equal(staffRefusal(row({ verify_kind: "paydown" })), "closes_on_credit_report");
    assert.equal(staffRefusal(row({ verify_kind: "no_new_credit" })), "ongoing_rule");
    assert.equal(staffRefusal(row({ verify_kind: "dispute_mail_receipt" })), "machine_checked");
    assert.equal(staffRefusal(row({ owner_kind: "fundhub" })), null);
    assert.equal(staffRefusal(row()), null);
  });
});

/* A db that answers the one SELECT with `found` and records every query. */
function stubDb(found) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/^\s*SELECT \* FROM client_waypoints/.test(sql)) return { rows: found ? [found] : [] };
      if (/UPDATE client_waypoints/.test(sql)) {
        return { rows: [{ ...found, state: "done", completed_at: params[3] || "2026-10-07T03:00:00Z" }] };
      }
      return { rows: [] };
    }
  };
}

describe("mark — the staff path", () => {
  const at = "2026-10-07T03:00:00.000Z";

  test("done on a person-closed step goes through completeWaypoint, found by id AND org AND client", async () => {
    const db = stubDb(row());
    const out = await mark(db, { orgId: ORG, clientId: CLIENT, pinId: `waypoint:${ID}`, status: "done", at, now: NOW });
    assert.equal(out.ok, true);
    assert.equal(out.changed, true);
    assert.equal(out.pin.status, "done");
    assert.deepEqual(out.pin.can_mark, []);
    assert.deepEqual(db.calls[0].params, [ID, ORG, CLIENT]);
    assert.match(db.calls[0].sql, /id = \$1::uuid AND org_id = \$2::uuid AND client_id = \$3::uuid/);
    assert.match(db.calls[1].sql, /SET state = 'done', completed_at = COALESCE\(\$4::timestamptz, now\(\)\)/);
    assert.deepEqual(db.calls[1].params, [ORG, CLIENT, "personal_loan", at]);
  });

  test("an already-done step answers ok with changed: false and writes nothing", async () => {
    const db = stubDb(row({ state: "done", completed_at: "2026-10-01T00:00:00Z" }));
    const out = await mark(db, { orgId: ORG, clientId: CLIENT, pinId: `waypoint:${ID}`, status: "done", at, now: NOW });
    assert.equal(out.ok, true);
    assert.equal(out.changed, false);
    assert.equal(db.calls.length, 1);
  });

  test("a machine-checked step is refused with the reason the client page already uses, and nothing is written", async () => {
    for (const [verify, reason] of [["paydown", "closes_on_credit_report"], ["no_new_credit", "ongoing_rule"], ["bureau_response_upload", "machine_checked"]]) {
      const db = stubDb(row({ verify_kind: verify }));
      const out = await mark(db, { orgId: ORG, clientId: CLIENT, pinId: `waypoint:${ID}`, status: "done", at, now: NOW });
      assert.deepEqual(out, { ok: false, reason, message: REFUSAL_MESSAGES[reason] }, verify);
      assert.ok(!db.calls.some((c) => /UPDATE/.test(c.sql)), `${verify}: no write`);
    }
  });

  test("a skipped step is refused", async () => {
    const out = await mark(stubDb(row({ state: "skipped" })), { orgId: ORG, clientId: CLIENT, pinId: `waypoint:${ID}`, status: "done", now: NOW });
    assert.equal(out.reason, "skipped");
  });

  test("somebody else's step, or one that does not exist, is not_found", async () => {
    const out = await mark(stubDb(null), { orgId: ORG, clientId: CLIENT, pinId: `waypoint:${ID}`, status: "done", now: NOW });
    assert.deepEqual(out, { ok: false, reason: "not_found" });
  });

  test("a pin id that is not a waypoint is not_found without a query", async () => {
    for (const pinId of ["due:amex:2026-10-15", "waypoint:not-a-uuid", "", null]) {
      const db = stubDb(row());
      const out = await mark(db, { orgId: ORG, clientId: CLIENT, pinId, status: "done", now: NOW });
      assert.equal(out.reason, "not_found");
      assert.equal(db.calls.length, 0);
    }
  });

  test("missed is never written — it is worked out from the date", async () => {
    const db = stubDb(row());
    const out = await mark(db, { orgId: ORG, clientId: CLIENT, pinId: `waypoint:${ID}`, status: "missed", now: NOW });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "missed_is_worked_out");
    assert.equal(db.calls.length, 0);
  });
});

describe("pins — the read", () => {
  test("filters on org and client, a due date, not skipped, and the window as UTC instants", async () => {
    const calls = [];
    const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [row(), row({ id: "x", due_at: null })] }; } };
    const out = await pins(db, { orgId: ORG, clientId: CLIENT, from: "2026-10-01", to: "2026-10-31", now: NOW });
    assert.equal(out.length, 1, "a row without a date never becomes a pin");
    assert.deepEqual(calls[0].params, [ORG, CLIENT, "2026-10-01", "2026-10-31"]);
    assert.match(calls[0].sql, /due_at IS NOT NULL/);
    assert.match(calls[0].sql, /state <> 'skipped'/);
    assert.match(calls[0].sql, /AT TIME ZONE 'UTC'/);
  });
});
