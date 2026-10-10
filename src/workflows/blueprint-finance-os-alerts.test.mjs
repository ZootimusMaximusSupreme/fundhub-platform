import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  sweep,
  handle,
  SWEEP_CRON,
  SOURCE_WORKFLOW,
  paymentTimingHints,
  entitledFinanceOsClients,
  blueprintBuyerClients,
  alertAudience,
  blueprintFinanceOsAlerts
} from "./blueprint-finance-os-alerts.mjs";
import { PAID_TRANSACTION_STATUS } from "../entitlements/entitlements.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const NOW = new Date("2026-10-12T07:30:00.000Z");

/** A connection that answers the two audience queries and nothing else. */
function audienceDb({ finance = [], blueprint = [] } = {}) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql: String(sql), params });
      if (/FROM subscriptions/.test(sql)) return { rows: finance };
      if (/FROM clients c/.test(sql) && /resolve_product_id/.test(sql)) return { rows: blueprint };
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

describe("the schedule", () => {
  test("the same daily cron and the same function id as before — no new workflow is registered", () => {
    assert.equal(SWEEP_CRON, "30 7 * * *");
    assert.equal(SOURCE_WORKFLOW, "blueprint-finance-os-alerts");
    assert.equal(typeof blueprintFinanceOsAlerts, "object");
  });
});

describe("the audience — Blueprint buyers and Finance OS subscribers, once each", () => {
  test("entitledFinanceOsClients is exactly what two other workflows import it for", async () => {
    const db = audienceDb({ finance: [{ org_id: ORG, client_id: A }] });
    const rows = await entitledFinanceOsClients(db, NOW);
    assert.deepEqual(rows, [{ org_id: ORG, client_id: A }]);
    assert.match(db.seen[0].sql, /s\.tier = \$1/);
    assert.match(db.seen[0].sql, /s\.status = 'active'/);
    assert.deepEqual(db.seen[0].params, ["finance-os", NOW]);
  });

  test("blueprintBuyerClients asks for PAID consulting-package transactions, the way the closer-ready sweeper does", async () => {
    const db = audienceDb({ blueprint: [{ org_id: ORG, client_id: B }] });
    assert.deepEqual(await blueprintBuyerClients(db), [{ org_id: ORG, client_id: B }]);
    assert.match(db.seen[0].sql, /lower\(p\.code\) = lower\(\$1\)/);
    assert.equal(db.seen[0].params[0], BLUEPRINT_PRODUCT_CODE);
    assert.equal(BLUEPRINT_PRODUCT_CODE, "consulting-package");
    assert.equal(db.seen[0].params[1], PAID_TRANSACTION_STATUS);
  });

  test("a client in both lists is one client; each org is kept apart", async () => {
    const db = audienceDb({
      finance: [{ org_id: ORG, client_id: A }, { org_id: ORG, client_id: B }],
      blueprint: [{ org_id: ORG, client_id: B }, { org_id: ORG, client_id: C }, { org_id: "other-org", client_id: B }]
    });
    const rows = await alertAudience(db, NOW);
    assert.deepEqual(
      rows.map((r) => `${r.org_id}:${r.client_id}`).sort(),
      [`${ORG}:${A}`, `${ORG}:${B}`, `${ORG}:${C}`, `other-org:${B}`].sort()
    );
  });

  test("a row with no client is dropped", async () => {
    const db = audienceDb({ finance: [{ org_id: ORG, client_id: null }], blueprint: [] });
    assert.deepEqual(await alertAudience(db, NOW), []);
  });
});

describe("sweep", () => {
  const clients = [{ org_id: ORG, client_id: A }, { org_id: ORG, client_id: B }];
  const audience = async () => clients;

  test("runs every client through the file alerts and adds up what happened", async () => {
    const ran = [];
    const run = async (_db, args) => {
      ran.push(args);
      if (args.clientId === A) {
        return {
          ok: true,
          sent: [
            { kind: "payment_timing", delivery: "text", taskId: null },
            { kind: "new_credit", delivery: "text", taskId: "t1" }
          ],
          rearmed: ["personal"], held: [], notQueued: [], errors: []
        };
      }
      return {
        ok: true,
        sent: [{ kind: "new_credit", delivery: "task_only", taskId: "t2" }],
        rearmed: [], held: [{ key: "k", reason: "opted_out" }], notQueued: [{ key: "j", reason: "template_pending" }], errors: []
      };
    };
    const tally = await sweep({}, { now: NOW, env: { X: "1" }, run, audience });
    assert.equal(tally.day, "2026-10-12");
    assert.equal(tally.checked, 2);
    assert.equal(tally.texts, 2, "a task-only alert is not a text");
    assert.equal(tally.tasks, 2);
    assert.equal(tally.rearmed, 1);
    assert.equal(tally.held, 1);
    assert.equal(tally.notQueued, 1);
    assert.deepEqual(tally.byKind, { payment_timing: 1, promo_end: 0, cash_reserve: 0, new_credit: 2 });
    assert.deepEqual(tally.errored, []);
    assert.deepEqual(ran.map((r) => r.clientId), [A, B]);
    assert.equal(ran[0].orgId, ORG);
    assert.equal(ran[0].now, NOW);
    assert.deepEqual(ran[0].env, { X: "1" });
  });

  test("one client throwing, or reporting not-ok, does not stop the next", async () => {
    const run = async (_db, args) => {
      if (args.clientId === A) throw new Error("plaid went away");
      return { ok: true, sent: [{ kind: "promo_end", delivery: "text", taskId: null }], rearmed: [], held: [], notQueued: [], errors: [] };
    };
    const tally = await sweep({}, { now: NOW, run, audience });
    assert.equal(tally.byKind.promo_end, 1);
    assert.deepEqual(tally.errored, [{ clientId: A, error: "plaid went away" }]);

    const notOk = await sweep({}, { now: NOW, audience, run: async () => ({ ok: false, reason: "client_not_found" }) });
    assert.deepEqual(notOk.errored.map((e) => e.error), ["client_not_found", "client_not_found"]);
  });

  test("a kind that failed inside a client is reported, and the rest of that client still counts", async () => {
    const run = async () => ({
      ok: true, sent: [{ kind: "payment_timing", delivery: "text", taskId: null }], rearmed: [], held: [], notQueued: [],
      errors: [{ kind: "new_credit", error: "crs_results is unreadable" }]
    });
    const tally = await sweep({}, { now: NOW, audience: async () => [clients[0]], run });
    assert.equal(tally.texts, 1);
    assert.deepEqual(tally.errored, [{ clientId: A, kind: "new_credit", error: "crs_results is unreadable" }]);
  });

  test("with Inngest, the audience and each client are their own step", async () => {
    const names = [];
    const step = { run: async (name, fn) => { names.push(name); return fn(); } };
    await sweep({}, { now: NOW, audience, step, run: async () => ({ ok: true, sent: [], rearmed: [], held: [], notQueued: [], errors: [] }) });
    assert.deepEqual(names, ["audience", `alerts-${A}`, `alerts-${B}`]);
  });

  test("nobody in the audience is a clean empty pass", async () => {
    const tally = await sweep(audienceDb(), { now: NOW });
    assert.equal(tally.checked, 0);
    assert.equal(tally.texts, 0);
    assert.deepEqual(tally.errored, []);
  });

  test("handle runs the pass for the journey runner, with or without a step", async () => {
    const db = audienceDb();
    assert.equal((await handle({ db })).checked, 0);
    const names = [];
    const step = { run: async (n, fn) => { names.push(n); return fn(); } };
    assert.equal((await handle({ db, step })).checked, 0);
    assert.deepEqual(names, ["audience"]);
  });
});

describe("paymentTimingHints", () => {
  test("computes next due from cycle rows", async () => {
    const db = {
      query: async () => ({
        rows: [{ payment_due_day: 15, statement_close_day: 10 }]
      })
    };
    const hints = await paymentTimingHints(db, {
      orgId: "11111111-1111-1111-1111-111111111111",
      clientId: "22222222-2222-2222-2222-222222222222",
      todayIso: "2026-09-01"
    });
    assert.equal(hints.length, 1);
    assert.equal(hints[0].nextDueOn, "2026-09-15");
  });
});
