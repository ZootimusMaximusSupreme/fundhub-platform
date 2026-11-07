// The daily pass's bundle block (unit AL): each bundle plan goes through the pass's
// own deliver() — send through the templated path, then record, once per key —
// and a bundle failure is reported without stopping the pass. Everything outside
// is a fake; no database, no message.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { runFileAlerts } from "./run.mjs";

const ORG = "org-1";
const CLIENT = "client-1";
const NOW = new Date("2026-11-06T07:30:00Z");
const PLAN = {
  alert: true, kind: "card_over_10", key: "fpa:over10:card-a:2026-11-16", templateKey: "SMS-FILE-PROTECT-CARD-OVER-10",
  bankAccountId: "card-a", label: "Sample Card A ending 4404", threshold: 10, dueOn: "2026-11-16",
  tags: { when: "on Nov 16" }, body: "Fundhub reminder: one of your cards is over 10% of its limit.", detail: {}
};

function world({ known = [], planBundleAlerts } = {}) {
  const w = { sends: [], recorded: [] };
  w.deps = {
    loadSnapshot: async () => ({ client: { id: CLIENT }, today: "2026-11-06", overview: { debt: { cards: [] }, cash: {} }, debts: [], cycleByAccount: new Map(), meta: [], staleByKind: {} }),
    loadLatestPulls: async () => null,
    isOptedOut: async () => false,
    isBlueprint: async () => false,
    send: async (_c, msg) => { w.sends.push(msg); return { sent: true, messageId: "msg-1" }; },
    createTask: async () => ({ id: null }),
    store: {
      // Every older kind off (and unit D's phone alerts, where they exist), so only the bundle runs.
      readSettings: async () => ({ payment_timing: false, promo_end: false, cash_reserve: false, new_credit: false, phone_alerts: false }),
      recentKeys: async () => new Set(known),
      reserveState: async () => ({ open: new Map(), episodes: new Map() }),
      recordAlert: async (_c, row) => { w.recorded.push(row); return { created: true }; },
      newCreditLast4: async () => new Set(),
      assignedCsm: async () => null
    },
    planBundleAlerts: planBundleAlerts || (async () => ({ plans: [PLAN], skipped: [{ kind: "business_credit", subject: "Sample Cedar LLC", reason: "sample_report" }] }))
  };
  w.run = () => runFileAlerts(null, { orgId: ORG, clientId: CLIENT, now: NOW, env: {} }, w.deps);
  return w;
}

describe("the bundle in the daily pass", () => {
  test("a bundle plan is sent through the template and recorded once, with its kind", async () => {
    const w = world();
    const r = await w.run();
    assert.deepEqual(r.sent.map((s) => [s.kind, s.key, s.delivery]), [["card_over_10", PLAN.key, "text"]]);
    assert.equal(w.sends.length, 1);
    assert.deepEqual({ ...w.sends[0], context: undefined }, { orgId: ORG, clientId: CLIENT, channel: "sms", templateKey: PLAN.templateKey, eventId: PLAN.key, context: undefined });
    assert.deepEqual(w.sends[0].context, { alert: PLAN.tags });
    assert.equal(w.recorded[0].kind, "card_over_10");
    assert.equal(w.recorded[0].dueOn, "2026-11-16");
    assert.ok(r.skipped.some((s) => s.kind === "business_credit" && s.reason === "sample_report"));
  });

  test("a key already sent is not sent again", async () => {
    const w = world({ known: [PLAN.key] });
    const r = await w.run();
    assert.equal(w.sends.length, 0);
    assert.ok(r.skipped.some((s) => s.kind === "card_over_10" && s.reason === "already_sent"));
  });

  test("the bundle failing is reported, and the pass still finishes", async () => {
    const w = world({ planBundleAlerts: async () => { throw new Error("businesses is unreadable"); } });
    const r = await w.run();
    assert.equal(r.ok, true);
    assert.deepEqual(r.errors, [{ kind: "bundle", error: "businesses is unreadable" }]);
  });

  test("the pass hands the bundle its snapshot, its day and the pay-before-close switch", async () => {
    let got = null;
    const w = world({ planBundleAlerts: async (_c, args) => { got = args; return { plans: [], skipped: [] }; } });
    await w.run();
    assert.equal(got.orgId, ORG);
    assert.equal(got.clientId, CLIENT);
    assert.equal(got.today, "2026-11-06");
    assert.equal(got.settings.payment_timing, false);
    assert.ok(got.snap && got.snap.client.id === CLIENT);
  });
});
