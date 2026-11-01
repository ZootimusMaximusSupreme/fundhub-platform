import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickRecipients, buildAlertBody, buildSetterAlertBody, queueStaffBookedAlerts, STAFF_BOOKED_TEMPLATE,
  fundingPayFromRules
} from "./booked-call-alert.mjs";

test("pickRecipients: active setter/owner phones are included regardless of old switch", () => {
  assert.deepEqual(pickRecipients([
    { id: "o", role: "owner", phone: "5551111", notify_booked_call_sms: true },
    { id: "o", role: "closer", phone: "5551111", notify_booked_call_sms: true },
    { id: "c", role: "closer", phone: "5552222", notify_booked_call_sms: false },
    { id: "s", role: "sales_manager", phone: "", notify_booked_call_sms: true },
    { id: "t", role: "setter", phone: "5554444", notify_booked_call_sms: false },
    { id: "a", role: "admin", phone: "5553333", notify_booked_call_sms: true }
  ]), [
    { id: "o", role: "owner", phone: "5551111" },
    { id: "t", role: "setter", phone: "5554444" }
  ]);
});

test("buildAlertBody is a win ping with play path, pay, survey Q/A, no source line", () => {
  const rules = [
    { role: "closer", amount_basis: "deposit_collected", percent: 16.6667 },
    { role: "sales_manager", amount_basis: "deposit_collected", percent: 5 },
    { role: "closer", amount_basis: "amount_funded", percent: 0.25 }
  ];
  const body = buildAlertBody({
    commissionRules: rules,
    client: {
      first_name: "Jane",
      last_name: "Doe",
      phone: "555-0000",
      email: "jane@email.com",
      channel_source: "website:home",
      custom_fields: {
        cf_svy_funding_target_amount_label: "$50k - $100k",
        cf_svy_planned_use_label: "Growth (marketing, inventory, hiring)",
        cf_svy_money_change_now_labels: ["Peace of mind (stop stressing about cash)", "Grow faster (more customers / more reach)"],
        cf_svy_self_reported_fico_label: "580-649",
        cf_svy_has_business_label: "Yes, 1-2 years",
        cf_svy_business_revenue_label: "$250k - $499k",
        cf_svy_revenue_verifiable_label: "Yes, both",
        cf_svy_available_capital_label: "$5k - $25k"
      }
    },
    booking: { startTime: "2026-08-25T21:00:00.000Z", timezone: "America/Phoenix" }
  });
  assert.match(body, /YOU'RE UP — new book/);
  assert.match(body, /Jane Doe/);
  assert.match(body, /555-0000/);
  assert.match(body, /jane@email.com/);
  assert.match(body, /RUN FIRST: Credit repair/);
  assert.match(body, /Always stack a second path/);
  assert.match(body, /\$500 on the \$3,000 deposit \(closer\)/);
  assert.match(body, /Manager: \$150 on that same deposit/);
  assert.match(body, /Plus 0\.25% of whatever funds/);
  assert.match(body, /Set Your Target Amount\n\$50k - \$100k/);
  assert.match(body, /Planned Use\nGrowth/);
  assert.match(body, /What Would This Money Change Right Now\?/);
  assert.match(body, /Your Current Score\n580-649/);
  assert.match(body, /Do You Have a Business\?\nYes, 1-2 years/);
  assert.match(body, /Annual Business Revenue\n\$250k - \$499k/);
  assert.match(body, /Can You Verify Revenue\?\nYes, both/);
  assert.match(body, /Available Capital\n\$5k - \$25k/);
  assert.doesNotMatch(body, /Context:|website:home|clickfunnels/);
  assert.doesNotMatch(body, /Bureau|CRS|Equifax|Experian/);
  assert.doesNotMatch(body, /Annual Personal Income/);
});

test("buildAlertBody: passing survey lane runs funding first", () => {
  const body = buildAlertBody({
    client: {
      first_name: "Pat",
      custom_fields: { cf_svy_self_reported_fico_label: "750+", cf_svy_has_negatives_label: "No" }
    }
  });
  assert.match(body, /RUN FIRST: Funding, done-for-you/);
});

test("setter booking alert gives call facts without closer price or commission copy", () => {
  const body = buildSetterAlertBody({
    client: { first_name: "Pat", phone: "+15551234567", custom_fields: { cf_svy_planned_use_label: "Expansion" } },
    booking: { startTime: "2026-10-28T21:00:00Z", timezone: "America/Phoenix" }
  });
  assert.match(body, /Pat/);
  assert.match(body, /New lead: Pat/);
  assert.match(body, /Booked:/);
  assert.match(body, /Expansion/);
  assert.doesNotMatch(body, /deposit|commission|Funding, done-for-you/i);
});

test("fundingPayFromRules uses live closer deposit percent", () => {
  const pay = fundingPayFromRules([
    { role: "closer", amount_basis: "deposit_collected", percent: 16.6667 }
  ]);
  assert.equal(pay.closerDepositCents, 50000);
});

test("queueStaffBookedAlerts: owner and setter get contact-only booking alerts, never the closer", async () => {
  const messages = [];
  const drains = [];
  const refs = new Set();
  const db = {
    async query(sql, params = []) {
      if (/FROM message_templates/.test(sql)) {
        return { rows: [{ body: "{{alert_body}}", subject: null, compliance_passed: true }] };
      }
      if (/FROM staff/.test(sql)) {
        return { rows: [
          { id: "st-1", role: "owner", phone: "+15551111", notify_booked_call_sms: true },
          { id: "st-2", role: "closer", phone: "+15552222", notify_booked_call_sms: false },
          { id: "st-3", role: "setter", phone: "+15553333", notify_booked_call_sms: false }
        ] };
      }
      if (/FROM clients/.test(sql)) {
        return { rows: [{
          first_name: "Pat", last_name: "Lee", email: "pat@x.com", phone: "480",
          channel_source: "clickfunnels", custom_fields: {}
        }] };
      }
      if (/FROM commission_rules/.test(sql)) {
        return { rows: [
          { role: "closer", amount_basis: "deposit_collected", percent: 16.6667 }
        ] };
      }
      if (/INSERT INTO messages/.test(sql)) {
        if (refs.has(params[4])) return { rows: [] };
        refs.add(params[4]);
        messages.push({
          orgId: params[0], clientId: params[1], template: params[2],
          body: params[3], ref: params[4], to: params[5]
        });
        return { rows: [{ id: "m-" + messages.length }] };
      }
      return { rows: [] };
    }
  };
  const out = await queueStaffBookedAlerts(db, {
    orgId: "org-1", clientId: "cl-1", eventId: "evt-1",
    payload: { startTime: "2026-08-25T21:00:00.000Z", name: "Pat Lee" },
    drainNowImpl: async (_db, id, options) => {
      drains.push({ id, orgId: options.orgId });
      return { sent: 1 };
    }
  });
  assert.equal(out.queued, 2);
  assert.equal(out.sent, 2);
  assert.deepEqual(drains, [
    { id: "m-1", orgId: "org-1" },
    { id: "m-2", orgId: "org-1" }
  ]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].template, STAFF_BOOKED_TEMPLATE);
  assert.equal(messages[0].to, "+15551111");
  assert.match(messages[0].body, /New lead: Pat/);
  assert.match(messages[0].ref, /st-1/);
  assert.equal(messages[1].to, "+15553333");
  assert.match(messages[1].body, /New lead: Pat/);
  assert.match(messages[1].body, /Booked:/);
  assert.doesNotMatch(messages[1].body, /deposit|commission/i);
  assert.match(messages[1].ref, /st-3/);

  const replay = await queueStaffBookedAlerts(db, {
    orgId: "org-1", clientId: "cl-1", eventId: "evt-1",
    drainNowImpl: async () => { throw new Error("replay must not drain"); }
  });
  assert.deepEqual(replay, { queued: 0, sent: 0 });
  assert.equal(messages.length, 2);

  const deferred = await queueStaffBookedAlerts(db, {
    orgId: "org-1", clientId: "cl-1", eventId: "evt-2",
    drainNowImpl: async () => ({ ran: false, reason: "paused", sent: 0 })
  });
  assert.deepEqual(deferred, { queued: 2, sent: 0 });
  assert.equal(messages.length, 4);
});
