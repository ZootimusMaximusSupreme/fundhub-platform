// document-vault-chase — the daily clock. Stubbed db; send and createTask are spies,
// so nothing is sent and nothing is queued anywhere.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { sweep, blueprintBuyers, handle, SWEEP_CRON, SOURCE_WORKFLOW, documentVaultChase } from "./document-vault-chase.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";
import { PAID_TRANSACTION_STATUS } from "../entitlements/entitlements.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const A = "550e8400-e29b-41d4-a716-446655440000";
const B = "660e8400-e29b-41d4-a716-446655440000";
const NOW = new Date("2026-10-07T16:45:00Z");

/** A db where each buyer is a client with nothing uploaded, so each is asked once. */
function stubDb({ buyers = [{ org_id: ORG, client_id: A }], broken = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/FROM clients c\s+JOIN transactions t/.test(sql)) return { rows: buyers };
      const clientId = params.find((p) => p === A || p === B);
      if (broken.includes(clientId)) throw new Error(`boom for ${clientId}`);
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) {
        return { rows: [{ id: params[0], first_name: "Sim", last_name: "Buyer", assigned_csm_staff_id: null }] };
      }
      if (/INSERT INTO money_agent_tasks/.test(sql)) return { rows: [{ id: `ask-${params[1].slice(0, 4)}` }] };
      if (/SET status = 'claimed'/.test(sql)) return { rows: [{ id: params[0] }] };
      return { rows: [] };
    }
  };
}

const spies = (result = { sent: true }) => {
  const sent = [];
  return { sent, send: async (_d, a) => { sent.push(a); return result; }, createTask: async () => ({ created: false }) };
};

describe("document-vault-chase", () => {
  test("it is a daily cron at 9:45 Arizona time, after the money helper's 9:30", () => {
    assert.equal(SWEEP_CRON, "45 16 * * *");
    assert.equal(SOURCE_WORKFLOW, "document-vault-chase");
    assert.equal(typeof documentVaultChase, "object");
  });

  test("it reads paid Capital Blueprint buyers — the list the file-protection alerts already read", async () => {
    const db = stubDb();
    await blueprintBuyers(db, {});
    const q = db.calls[0];
    assert.match(q.sql, /resolve_product_id\(t\.org_id, t\.product_name\)/);
    assert.deepEqual(q.params, [BLUEPRINT_PRODUCT_CODE, PAID_TRANSACTION_STATUS]);
  });

  test("one company can be asked for alone", async () => {
    const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
    const db = stubDb({ buyers: [{ org_id: ORG, client_id: A }, { org_id: OTHER_ORG, client_id: B }] });
    assert.deepEqual((await blueprintBuyers(db, { orgId: OTHER_ORG })).map((r) => r.client_id), [B]);
    assert.equal((await blueprintBuyers(db, {})).length, 2);
  });

  test("one pass asks each buyer once and tallies it", async () => {
    const db = stubDb({ buyers: [{ org_id: ORG, client_id: A }, { org_id: ORG, client_id: B }] });
    const sp = spies();
    const t = await sweep(db, { now: NOW, env: {}, send: sp.send, createTask: sp.createTask });
    assert.equal(t.checked, 2);
    assert.equal(t.asked, 2);
    assert.equal(t.csm, 0);
    assert.deepEqual(t.errored, []);
    assert.deepEqual(sp.sent.map((s) => [s.clientId, s.templateKey]), [[A, "SMS-VAULT-ASK-1"], [B, "SMS-VAULT-ASK-1"]]);
  });

  test("a dry run asks nobody and writes nothing", async () => {
    const db = stubDb();
    const sp = spies();
    const t = await sweep(db, { now: NOW, env: {}, dryRun: true, send: sp.send, createTask: sp.createTask });
    assert.equal(t.asked, 0);
    assert.equal(sp.sent.length, 0);
    assert.equal(db.calls.filter((c) => /^\s*(INSERT|UPDATE)/.test(c.sql)).length, 0);
    assert.deepEqual(t.notAsked, { ask_1: 1 });
  });

  test("one client's error is recorded and the next client still runs", async () => {
    const db = stubDb({ buyers: [{ org_id: ORG, client_id: A }, { org_id: ORG, client_id: B }], broken: [A] });
    const sp = spies();
    const t = await sweep(db, { now: NOW, env: {}, send: sp.send, createTask: sp.createTask });
    assert.equal(t.errored.length, 1);
    assert.equal(t.errored[0].clientId, A);
    assert.match(t.errored[0].error, /boom/);
    assert.equal(t.asked, 1);
    assert.deepEqual(sp.sent.map((s) => s.clientId), [B]);
  });

  test("a buyer who cannot be messaged is counted by why, and nobody is texted", async () => {
    const db = stubDb();
    const sp = spies({ sent: false, reason: "opted_out" });
    const t = await sweep(db, { now: NOW, env: {}, send: sp.send, createTask: sp.createTask });
    assert.equal(t.asked, 0);
    assert.deepEqual(t.notAsked, { opted_out: 1 });
  });

  test("DOCUMENT_VAULT_CHASE=off is the kill switch: nothing is read, nothing is asked", async () => {
    for (const off of ["off", "OFF", " off "]) {
      const db = stubDb();
      const sp = spies();
      const t = await sweep(db, { now: NOW, env: { DOCUMENT_VAULT_CHASE: off }, send: sp.send, createTask: sp.createTask });
      assert.deepEqual(t, { skipped: true, reason: "switched_off" }, off);
      assert.equal(db.calls.length, 0);
      assert.equal(sp.sent.length, 0);
    }
    const on = await sweep(stubDb(), { now: NOW, env: { DOCUMENT_VAULT_CHASE: "on" }, ...spies() });
    assert.equal(on.asked, 1, "anything but off is on");
  });

  test("with a step, the audience and each client are their own steps, and only a small summary leaves a step", async () => {
    const db = stubDb({ buyers: [{ org_id: ORG, client_id: A }, { org_id: ORG, client_id: B }] });
    const sp = spies();
    const ran = [];
    const step = { run: async (name, fn) => { ran.push(name); return JSON.parse(JSON.stringify(await fn())); } };
    const t = await sweep(db, { now: NOW, env: {}, step, send: sp.send, createTask: sp.createTask });
    assert.deepEqual(ran, ["audience", `vault-${A}`, `vault-${B}`]);
    assert.equal(t.asked, 2);
  });

  test("handle has the shape the journey runner expects, with or without a step", async () => {
    assert.equal(typeof handle, "function");
    const viaStep = await handle({ db: stubDb({ buyers: [] }), step: { run: async (_name, fn) => fn() } });
    assert.equal(viaStep.checked, 0);
    const direct = await handle({ db: stubDb({ buyers: [] }) });
    assert.equal(direct.checked, 0);
  });
});
