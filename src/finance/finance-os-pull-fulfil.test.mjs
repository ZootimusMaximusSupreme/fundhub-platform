import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  systemPullUsesSimulation,
  savedSystemPullIntent,
  fulfilQueuedSystemPulls
} from "./finance-os-pull-fulfil.mjs";

describe("systemPullUsesSimulation", () => {
  test("defaults to simulation when live is not explicitly named", () => {
    assert.equal(systemPullUsesSimulation({}), true);
    assert.equal(systemPullUsesSimulation({ CRS_ALLOW_LIVE: "1" }), true);
  });

  test("live only when FINANCE_OS_SYSTEM_PULL_LIVE and CRS_ALLOW_LIVE are both on", () => {
    assert.equal(
      systemPullUsesSimulation({ FINANCE_OS_SYSTEM_PULL_LIVE: "1", CRS_ALLOW_LIVE: "1" }),
      false
    );
  });
});

describe("fulfilQueuedSystemPulls", () => {
  test("an empty queue does nothing", async () => {
    const db = {
      query: async (text) => {
        if (/FROM soft_pull_requests/.test(text)) return { rows: [] };
        throw new Error("unexpected query");
      }
    };
    const tally = await fulfilQueuedSystemPulls(db, {
      runPull: async () => ({ ok: true }),
      aftercare: async () => ({})
    });
    assert.equal(tally.checked, 0);
    assert.equal(tally.fulfilled, 0);
    assert.equal(tally.ok, true);
  });

  test("one fault does not stop the next row", async () => {
    const rows = [
      { id: "a", org_id: "o", client_id: "c1" },
      { id: "b", org_id: "o", client_id: "c2" }
    ];
    let n = 0;
    const db = {
      query: async (text) => {
        if (/FROM soft_pull_requests/.test(text)) return { rows };
        throw new Error("unexpected");
      }
    };
    const tally = await fulfilQueuedSystemPulls(db, {
      runPull: async (_db, { clientId }) => {
        n += 1;
        if (clientId === "c1") throw new Error("boom");
        return { ok: true, crsResultId: "cr" };
      },
      aftercare: async () => ({ ok: true })
    });
    assert.equal(tally.fulfilled, 1);
    assert.equal(tally.errored.length, 1);
    assert.equal(n, 2);
    assert.equal(tally.ok, false);
  });
});

test("aftercare failure creates a scoped owner exception without ordering a second paid pull", async () => {
  let queued = true;
  let pulls = 0;
  const tasks = [];
  const db = { async query(sql, params) {
    if (/FROM soft_pull_requests/.test(sql)) return { rows: queued ? [{ id: "request", org_id: "org", client_id: "client" }] : [] };
    if (/SELECT id FROM tasks/.test(sql)) return { rows: [] };
    if (/INSERT INTO tasks/.test(sql)) {
      tasks.push(params);
      return { rows: [{ id: "owner-task" }] };
    }
    throw new Error(`Unexpected query ${sql}`);
  } };
  const input = {
    runPull: async () => { pulls += 1; queued = false; return { ok: true, crsResultId: "saved-credit" }; },
    aftercare: async () => ({ ok: false, failures: [{ phase: "letterPack", error: "storage failed" }] })
  };
  const out = await fulfilQueuedSystemPulls(db, input);
  assert.equal(out.fulfilled, 1, "the credit pull succeeded; the missing delivery is a separate failure");
  assert.equal(out.ok, false);
  assert.equal(out.errored[0].phase, "aftercare");
  assert.equal(out.deliveryExceptions[0].task.id, "owner-task");
  assert.equal(tasks[0][0], "org");
  assert.equal(tasks[0][1], "client");
  assert.equal(tasks[0][6], "owner");
  assert.match(tasks[0][9], /saved-credit/);
  assert.match(tasks[0][9], /do not request another paid credit pull/);
  await fulfilQueuedSystemPulls(db, input);
  assert.equal(pulls, 1);
  assert.equal(tasks.length, 1);
});

test("Blueprint monthly aftercare never delivers a simulated CRS result", async () => {
  const row = { id: "request-sim", org_id: "org-sim", client_id: "client-sim" };
  const db = {
    async query(sql) {
      if (/FROM soft_pull_requests/.test(sql)) return { rows: [row] };
      throw new Error("Simulated acceptance test must perform no database writes");
    }
  };
  let aftercareRuns = 0;
  const run = async (env) => fulfilQueuedSystemPulls(db, {
    env,
    createTaskImpl: async () => ({ id: "held" }),
    runPull: async (_db, opts) => ({
      ok: true,
      simulated: true,
      crsResultId: "simulated-crs-id",
      requestId: opts.requestId
    }),
    aftercare: async () => {
      aftercareRuns += 1;
      return { ok: true };
    }
  });

  // The saved-result stamp wins even when external live flags are on.
  for (const env of [{}, { FINANCE_OS_SYSTEM_PULL_LIVE: "1", CRS_ALLOW_LIVE: "1" }]) {
    const out = await run(env);
    assert.equal(out.checked, 1);
    assert.equal(out.fulfilled, 0, "simulated reports cannot count as real CRS fulfillment");
    if (systemPullUsesSimulation(env)) {
      assert.equal(out.simulatedFulfilled, 1);
      assert.equal(out.skipped[0]?.reason, "simulated_result_not_customer_delivery");
    } else {
      assert.equal(out.simulatedFulfilled, 0);
      assert.equal(out.authorizationHolds[0]?.reason, "request_not_explicitly_real");
    }
    assert.deepEqual(out.deliveryExceptions, []);
    assert.equal(out.errored.length, 0);
  }
  assert.equal(aftercareRuns, 0, "simulation must not reseed roadmap or generate customer letter packs");
});

test("actual successful CRS result still runs Blueprint aftercare", async () => {
  const row = { id: "request-real", org_id: "org-real", client_id: "client-real",
    subscription_id: "plan-real", idempotency_key: "finance-os-monthly:plan-real:0:real" };
  const db = {
    async query(sql) {
      if (/FROM soft_pull_requests/.test(sql)) return { rows: [row] };
      throw new Error("Real-result acceptance fixture performs no database writes");
    }
  };
  const calls = [];
  const tally = await fulfilQueuedSystemPulls(db, {
    env: { FINANCE_OS_SYSTEM_PULL_LIVE: "1", CRS_ALLOW_LIVE: "1" },
    consentCheck: async () => ({ valid: true }),
    entitlementCheck: async () => ({ entitled: true, subscriptionId: "plan-real" }),
    runPull: async (_conn, input) => {
      assert.equal(input.simulate, false);
      return { ok: true, simulated: false, crsResultId: "provider-crs-id" };
    },
    aftercare: async (_conn, args) => {
      calls.push(args);
      return { ok: true };
    }
  });
  assert.equal(tally.fulfilled, 1);
  assert.equal(tally.simulatedFulfilled, 0);
  assert.equal(tally.ok, true);
  assert.deepEqual(calls, [{
    orgId: "org-real", clientId: "client-real", crsResultId: "provider-crs-id"
  }]);
});

test("persisted mode, tenant scope, consent, and paid term all fail closed before real provider", async () => {
  const LIVE = { CRS_ALLOW_LIVE: "1", FINANCE_OS_SYSTEM_PULL_LIVE: "1" };
  const row = { id: "q1", org_id: "org", client_id: "client", subscription_id: "plan", idempotency_key: "finance-os-monthly:plan:1:real" };
  const db = { query: async () => ({ rows: [row] }) };
  let sends = 0, holds = [];
  const run = (options = {}) => fulfilQueuedSystemPulls(db, {
    env: LIVE,
    runPull: async () => { sends++; return { ok: true, simulated: false, crsResultId: "report" }; },
    aftercare: async () => ({ ok: true }),
    createTaskImpl: async (_db, task) => { holds.push(task); return { id: "task" }; },
    consentCheck: async () => ({ valid: true }),
    entitlementCheck: async () => ({ entitled: true, subscriptionId: "plan" }),
    ...options
  });
  assert.equal(savedSystemPullIntent(row), "real");
  row.idempotency_key = "finance-os-monthly:plan:1";
  assert.equal(savedSystemPullIntent(row), "simulated");
  assert.equal((await run()).authorizationHolds[0].reason, "request_not_explicitly_real");
  row.idempotency_key = "finance-os-monthly:plan:1:real";
  assert.equal((await run({ consentCheck: async () => ({ valid: false, reason: "revoked" }) })).authorizationHolds[0].reason, "consent_no_longer_valid");
  assert.equal((await run({ entitlementCheck: async () => ({ entitled: false }) })).authorizationHolds[0].reason, "paid_access_no_longer_valid");
  assert.equal((await run({ entitlementCheck: async () => ({ entitled: true, subscriptionId: "foreign-plan" }) })).authorizationHolds[0].reason, "paid_access_no_longer_valid");
  assert.equal((await run({ env: {} })).authorizationHolds[0].reason, "live_flags_disabled_for_real_request");
  row.idempotency_key = "finance-os-monthly:another-plan:1:real";
  assert.equal(savedSystemPullIntent(row), "unknown");
  assert.equal((await run()).authorizationHolds[0].reason, "request_not_explicitly_real");
  assert.equal(sends, 0);
  assert.equal(holds.length, 6);
  row.idempotency_key = "finance-os-monthly:plan:1:real";
  const accepted = await run();
  assert.equal(accepted.fulfilled, 1);
  assert.equal(accepted.ok, true);
  assert.equal(sends, 1);
});
