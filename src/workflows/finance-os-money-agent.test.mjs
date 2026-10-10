// finance-os-money-agent — the daily clock. Stubbed db; send is a spy, so no
// text can leave this test.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { sweep, SWEEP_CRON, handle } from "./finance-os-money-agent.mjs";

function db({ clients = [], boom = null } = {}) {
  return {
    async query(sql, params) {
      if (/FROM subscriptions s/.test(sql)) return { rows: clients };
      if (boom && params && params[1] === boom) throw new Error("bad row");
      if (/EXISTS \(SELECT 1 FROM opt_outs/.test(sql)) return { rows: [{ opted_out: false, escalated: false, handed: false }] };
      if (/FROM clarity_payment_installments i/.test(sql)) {
        return { rows: [{ id: `i-${params[1]}`, seq: 2, due_on: "2026-10-02", amount_cents: "50000", paid_cents: "0", kind: "clarity", owed_to: "Fundhub LLC" }] };
      }
      if (/INSERT INTO money_agent_log/.test(sql)) return { rows: [{ id: "l1" }] };
      return { rows: [] };
    }
  };
}

describe("finance-os-money-agent sweep", () => {
  test("runs after the card due texts, inside the day window", () => {
    assert.equal(SWEEP_CRON, "30 16 * * *");
  });

  test("one pass over every Finance OS client; one client's error does not stop the rest", async () => {
    const sent = [];
    const send = async (_db, a) => { sent.push(a); return { sent: true }; };
    const t = await sweep(db({ clients: [{ org_id: "o", client_id: "c1" }, { org_id: "o", client_id: "c2" }], boom: "c1" }),
      { now: new Date("2026-10-06T16:30:00Z"), send, createTask: async () => ({ id: "t" }) });
    assert.equal(t.checked, 2);
    assert.equal(t.errored.length, 1);
    assert.equal(t.errored[0].clientId, "c1");
    assert.equal(t.queued, 1);
    assert.equal(sent[0].clientId, "c2");
  });

  test("no Finance OS clients → nothing", async () => {
    const t = await sweep(db(), { now: new Date("2026-10-06T16:30:00Z"), send: async () => { throw new Error("must not send"); } });
    assert.deepEqual({ checked: t.checked, queued: t.queued }, { checked: 0, queued: 0 });
  });

  test("handle() runs inside a step when the runner gives one", async () => {
    let named = null;
    await handle({ db: db(), step: { run: async (name, fn) => { named = name; return fn(); } } });
    assert.equal(named, "sweep");
  });
});
