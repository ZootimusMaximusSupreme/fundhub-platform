// The Monday money text job — runWeeklyMoney and sweep, with every outside thing
// faked: no database, no Inngest, no message. One fictional client.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runWeeklyMoney, sweep, inPlanWindow, WEEKLY_CRON } from "./finance-os-weekly-money.mjs";
import { parseCron, dueInSlot } from "../cron/clock.mjs";

const ORG = "org-1";
const CLIENT = "client-1";
const MONDAY_9 = new Date("2026-11-09T16:00:00Z"); // 9:00 a.m. Arizona
const SNAP = {
  today: "2026-11-09",
  asOf: MONDAY_9.toISOString(),
  overview: {
    debt: { cards: [{ account_id: "c1", kind: "personal", used_pct: 30 }] },
    accounts: [{ id: "p-chk", type: "depository", kind: "personal" }]
  },
  cycleByAccount: new Map(),
  meta: [{ id: "p-chk", plaid_item_id: "item-1" }]
};

function deps(over = {}) {
  const sent = [];
  const recorded = [];
  const d = {
    sent, recorded,
    send: async (_c, msg) => { sent.push(msg); return { sent: true, messageId: "msg-1" }; },
    loadSnapshot: async () => SNAP,
    store: {
      recentKeys: async () => new Set(),
      recordAlert: async (_c, row) => { recorded.push(row); return { created: true }; }
    },
    bundleStore: {
      readBundleSettings: async () => ({ weekly_money: true }),
      weekTransactions: async () => [{ bank_account_id: "p-chk", amount_cents: 500000, posted_on: "2026-11-04", category: null }],
      openedBankAccounts: async () => [],
      openStepCount: async () => 2
    },
    ...over
  };
  return d;
}

describe("runWeeklyMoney — one client", () => {
  test("Monday 9 a.m.: one text queued through the template, then recorded once with its key", async () => {
    const d = deps();
    const r = await runWeeklyMoney(null, { orgId: ORG, clientId: CLIENT, now: MONDAY_9 }, d);
    assert.equal(r.sent, true);
    assert.equal(r.key, "fpa:week:client-1:2026-11-09");
    assert.equal(d.sent.length, 1);
    assert.equal(d.sent[0].channel, "sms");
    assert.equal(d.sent[0].templateKey, "SMS-FINANCE-WEEKLY-MONEY");
    assert.equal(d.sent[0].eventId, r.key);
    assert.match(d.sent[0].context.alert.summary, /Money came in 1 time to your personal accounts this week\./);
    assert.equal(d.recorded.length, 1);
    assert.equal(d.recorded[0].kind, "weekly_money");
    assert.equal(d.recorded[0].delivery, "text");
    assert.equal(d.recorded[0].messageId, "msg-1");
    assert.equal(d.recorded[0].dueOn, "2026-11-09");
    assert.doesNotMatch(d.recorded[0].body, /\$|5,000/);
  });

  test("outside 9 a.m. to 4:50 p.m. Arizona nothing is queued", async () => {
    for (const at of ["2026-11-09T15:59:00Z", "2026-11-09T23:51:00Z", "2026-11-10T03:00:00Z"]) {
      const d = deps();
      const r = await runWeeklyMoney(null, { orgId: ORG, clientId: CLIENT, now: new Date(at) }, d);
      assert.equal(r.reason, "outside_send_hours", at);
      assert.equal(d.sent.length, 0, at);
    }
    assert.equal(inPlanWindow(new Date("2026-11-09T23:50:00Z")), true, "4:50 p.m. is the last minute");
  });

  test("switched off: no read, no text", async () => {
    let read = false;
    const d = deps({ loadSnapshot: async () => { read = true; return SNAP; } });
    d.bundleStore.readBundleSettings = async () => ({ weekly_money: false });
    const r = await runWeeklyMoney(null, { orgId: ORG, clientId: CLIENT, now: MONDAY_9 }, d);
    assert.equal(r.reason, "switched_off");
    assert.equal(read, false);
    assert.equal(d.sent.length, 0);
  });

  test("already sent this week: no second text", async () => {
    const d = deps();
    d.store.recentKeys = async () => new Set(["fpa:week:client-1:2026-11-09"]);
    const r = await runWeeklyMoney(null, { orgId: ORG, clientId: CLIENT, now: MONDAY_9 }, d);
    assert.equal(r.reason, "already_sent");
    assert.equal(d.sent.length, 0);
  });

  test("an opted-out client (sendTemplated refuses) is not recorded, so nothing claims a text went", async () => {
    const d = deps({ send: async () => ({ sent: false, reason: "opted_out" }) });
    const r = await runWeeklyMoney(null, { orgId: ORG, clientId: CLIENT, now: MONDAY_9 }, d);
    assert.equal(r.sent, false);
    assert.equal(r.reason, "opted_out");
    assert.equal(d.recorded.length, 0);
  });

  test("nothing known about the week: no text", async () => {
    const d = deps({ loadSnapshot: async () => ({ ...SNAP, overview: { debt: { cards: [] }, accounts: [] }, meta: [] }) });
    d.bundleStore.openStepCount = async () => 0;
    const r = await runWeeklyMoney(null, { orgId: ORG, clientId: CLIENT, now: MONDAY_9 }, d);
    assert.equal(r.reason, "nothing_to_say");
    assert.equal(d.sent.length, 0);
  });
});

test("sweep: every audience client once, one failure does not stop the next", async () => {
  const seen = [];
  const tally = await sweep(null, {
    now: MONDAY_9,
    audience: async () => [{ org_id: ORG, client_id: "a" }, { org_id: ORG, client_id: "b" }, { org_id: ORG, client_id: "c" }],
    run: async (_c, { clientId }) => {
      seen.push(clientId);
      if (clientId === "b") throw new Error("boom");
      return clientId === "a" ? { ok: true, sent: true } : { ok: true, sent: false, reason: "nothing_to_say" };
    }
  });
  assert.deepEqual(seen, ["a", "b", "c"]);
  assert.equal(tally.checked, 3);
  assert.equal(tally.texts, 1);
  assert.deepEqual(tally.skipped, { nothing_to_say: 1 });
  assert.equal(tally.errored.length, 1);
});

test("the clock starts it Monday at 9:00 Arizona and no other time", () => {
  parseCron(WEEKLY_CRON);
  assert.equal(dueInSlot(WEEKLY_CRON, MONDAY_9), true);
  assert.equal(dueInSlot(WEEKLY_CRON, new Date("2026-11-10T16:00:00Z")), false, "Tuesday");
  assert.equal(dueInSlot(WEEKLY_CRON, new Date("2026-11-09T09:00:00Z")), false, "9:00 UTC is 2 a.m. Arizona");
});
