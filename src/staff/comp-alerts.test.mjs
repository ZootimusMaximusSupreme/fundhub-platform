import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPayoutEmailContext,
  buildDealCloseBody,
  notifyCommissionPaid,
  notifyCommissionPaidPush,
  notifyDealCloseWin,
  recipientsForSale,
  EMAIL_COMMISSION_PAID,
  SMS_DEAL_CLOSE_WIN
} from "./comp-alerts.mjs";

test("paid commission pushes only to its attributed staff member and client", async () => {
  const calls = [];
  const db = { async query() { return { rows: [{ id: "closer-1" }] }; } };
  const event = {
    orgId: "org-1", clientId: "client-1",
    payload: { staff_id: "closer-1", ledger_id: "ledger-1" }
  };
  const pushImpl = async (_db, args) => { calls.push(args); return { sent: 1 }; };
  const sent = await notifyCommissionPaidPush(db, event, { pushImpl });
  assert.equal(sent.sent, 1);
  assert.deepEqual(calls, [{
    orgId: "org-1", staffId: "closer-1", clientId: "client-1",
    kind: "payout", key: "commission.paid:ledger-1"
  }]);
  const withoutClient = await notifyCommissionPaidPush(db, { ...event, clientId: null }, { pushImpl });
  assert.equal(withoutClient.reason, "missing_ids");
  assert.equal(calls.length, 1);
  const ineligible = await notifyCommissionPaidPush(
    { async query() { return { rows: [] }; } }, event, { pushImpl }
  );
  assert.equal(ineligible.reason, "not_eligible");
  assert.equal(calls.length, 1);
});

test("historical closer duty on an external primary role cannot receive payout push", async () => {
  let pushed = false;
  const db = { async query(sql) {
    assert.match(sql, /lower\(btrim\(s\.role\)\) NOT IN/);
    for (const role of ["owner", "admin", "partner", "client", "affiliate", "outbound_rep"]) {
      assert.match(sql, new RegExp(`'${role}'`));
    }
    // A partner with an old closer assignment is excluded by the query.
    return { rows: [] };
  } };
  const result = await notifyCommissionPaidPush(db, {
    orgId: "org-1", clientId: "client-1",
    payload: { staff_id: "partner-1", ledger_id: "ledger-1" }
  }, { pushImpl: async () => { pushed = true; } });
  assert.equal(result.reason, "not_eligible");
  assert.equal(pushed, false);
});

test("payout email context formats amount and first name", () => {
  const ctx = buildPayoutEmailContext({
    staff: { name: "Alex Closer" },
    amount: "250.05",
    payoutRef: "ACH-99",
    payoutRail: "ACH"
  });
  assert.equal(ctx.staff_first_name, "Alex");
  assert.equal(ctx.amount_display, "$250.05");
  assert.equal(ctx.payout_ref, "ACH-99");
  assert.equal(ctx.payout_rail, "ACH");
});

test("deal-close body is a short win ping", () => {
  const body = buildDealCloseBody({
    staff: { name: "Sam Manager" },
    client: { first_name: "Pat", last_name: "Lee" },
    amount: 3000
  });
  assert.match(body, /Sam/);
  assert.match(body, /Pat Lee/);
  assert.match(body, /closed it/);
});

test("notifyCommissionPaid mails via Resend when template and email exist", async () => {
  const calls = [];
  const db = {
    async query(sql) {
      if (/FROM staff/.test(sql)) {
        return { rows: [{ id: "st-1", name: "Alex", email: "alex@fundhub.ai", role: "closer", status: "active" }] };
      }
      if (/FROM message_templates/.test(sql)) {
        return {
          rows: [{
            subject: "Paid {{amount_display}}",
            body: "Hi {{staff_first_name}} — {{amount_display}} via {{payout_rail}} ref {{payout_ref}}",
            compliance_passed: true
          }]
        };
      }
      return { rows: [] };
    }
  };
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ id: "re_1" }),
      text: async () => "{\"id\":\"re_1\"}"
    };
  };
  const out = await notifyCommissionPaid(
    db,
    {
      orgId: "org-1",
      payload: {
        staff_id: "st-1",
        ledger_id: "led-1",
        amount: "100.00",
        payout_ref: "ACH-1"
      }
    },
    {
      fetchImpl,
      env: {
        RESEND_API_KEY: "re_test_0123456789abcdef",
        RESEND_FROM: "Fundhub <noreply@fundhub.ai>",
        MESSAGING_DRY_RUN: "0"
      }
    }
  );
  assert.equal(out.mailed, true, JSON.stringify(out));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.to[0], "alex@fundhub.ai");
  assert.match(calls[0].body.subject, /\$100\.00/);
});

test("notifyCommissionPaid refuses without staff email", async () => {
  const db = {
    async query(sql) {
      if (/FROM staff/.test(sql)) {
        return { rows: [{ id: "st-1", name: "Alex", email: null, role: "closer", status: "active" }] };
      }
      return { rows: [] };
    }
  };
  const out = await notifyCommissionPaid(db, {
    orgId: "org-1",
    payload: { staff_id: "st-1", amount: "10" }
  });
  assert.equal(out.mailed, false);
  assert.equal(out.reason, "no_email");
});

test("notifyDealCloseWin queues one SMS per attributed phone", async () => {
  const inserts = [];
  const db = {
    async query(sql, params = []) {
      if (/FROM message_templates/.test(sql)) {
        return { rows: [{ body: "{{alert_body}}", compliance_passed: true }] };
      }
      if (/FROM sale_attributions/.test(sql)) {
        return {
          rows: [
            { id: "c1", name: "Closer One", email: "c@x", phone: "+15551111", role: "closer", status: "active", attr_role: "closer" },
            { id: "m1", name: "Manager One", email: "m@x", phone: "+15552222", role: "sales_manager", status: "active", attr_role: "sales_manager" }
          ]
        };
      }
      if (/FROM clients/.test(sql)) {
        return { rows: [{ first_name: "Pat", last_name: "Lee", email: "p@x", phone: "1" }] };
      }
      if (/INSERT INTO messages/.test(sql)) {
        inserts.push(params);
        return { rows: [{ id: `msg-${inserts.length}` }] };
      }
      if (/FROM sales/.test(sql)) return { rows: [{ id: "sale-1" }] };
      return { rows: [] };
    }
  };
  const out = await notifyDealCloseWin(db, {
    id: "evt-1",
    orgId: "org-1",
    clientId: "cl-1",
    payload: { saleId: "sale-1", amount: 3000 }
  });
  assert.equal(out.queued, 2);
  assert.equal(inserts.length, 2);
  assert.equal(inserts[0][2], SMS_DEAL_CLOSE_WIN);
  assert.equal(inserts[0][5], "+15551111");
});

test("recipientsForSale dedupes the same person", async () => {
  const db = {
    async query(sql) {
      if (/FROM sale_attributions/.test(sql)) {
        return {
          rows: [
            { id: "same", name: "Chris", phone: "+1", role: "closer", status: "active", attr_role: "closer" },
            { id: "same", name: "Chris", phone: "+1", role: "closer", status: "active", attr_role: "sales_manager" }
          ]
        };
      }
      return { rows: [] };
    }
  };
  const people = await recipientsForSale(db, { orgId: "o", saleId: "s" });
  assert.equal(people.length, 1);
});

test("template keys are stable", () => {
  assert.equal(EMAIL_COMMISSION_PAID, "EMAIL-COMMISSION-PAID");
  assert.equal(SMS_DEAL_CLOSE_WIN, "SMS-DEAL-CLOSE-WIN");
});
