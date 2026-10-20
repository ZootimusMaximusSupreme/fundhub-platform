import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  systemPullUsesSimulation,
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
