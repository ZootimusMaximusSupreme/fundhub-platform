// FinanceOS trend snapshots — the daily pass (wave 4, H6). No Inngest, no Postgres.
import { test } from "node:test";
import assert from "node:assert/strict";

import { sweep, SWEEP_CRON, financeOsTrendSnapshots } from "./finance-os-trend-snapshots.mjs";

test("runs after the 07:00 Plaid pull, every day", () => {
  assert.equal(SWEEP_CRON, "30 7 * * *");
  assert.equal(financeOsTrendSnapshots.id(), "finance-os-trend-snapshots");
});

test("one pass: snapshot then backfill for each client, on today's UTC day", async () => {
  const calls = [];
  const tally = await sweep({}, {
    now: new Date("2026-10-06T07:30:00Z"),
    list: async () => [{ org_id: "o1", client_id: "c1" }, { org_id: "o1", client_id: "c2" }],
    snapshot: async (_c, a) => { calls.push(["snap", a.clientId, a.day]); return { accounts: 3 }; },
    backfill: async (_c, a) => { calls.push(["back", a.clientId, a.today]); return { rollupRows: 10 }; }
  });
  assert.deepEqual(calls, [
    ["snap", "c1", "2026-10-06"], ["back", "c1", "2026-10-06"],
    ["snap", "c2", "2026-10-06"], ["back", "c2", "2026-10-06"]
  ]);
  assert.equal(tally.checked, 2);
  assert.equal(tally.snapshotted, 2);
  assert.equal(tally.accounts, 6);
  assert.equal(tally.estimatedDays, 20);
});

test("one client's failure is recorded and the next client still runs", async () => {
  const seen = [];
  const tally = await sweep({}, {
    now: new Date("2026-10-06T07:30:00Z"),
    list: async () => [{ org_id: "o", client_id: "bad" }, { org_id: "o", client_id: "good" }],
    snapshot: async (_c, a) => { seen.push(a.clientId); if (a.clientId === "bad") throw new Error("boom"); return { accounts: 1 }; },
    backfill: async () => ({ rollupRows: 0 })
  });
  assert.deepEqual(seen, ["bad", "good"]);
  assert.equal(tally.snapshotted, 1);
  assert.equal(tally.failed.length, 1);
  assert.equal(tally.failed[0].clientId, "bad");
});

test("each client is its own Inngest step when a step is given", async () => {
  const names = [];
  await sweep({}, {
    now: new Date("2026-10-06T07:30:00Z"),
    step: { run: async (name, fn) => { names.push(name); return fn(); } },
    list: async () => [{ org_id: "o", client_id: "c1" }],
    snapshot: async () => ({ accounts: 1 }),
    backfill: async () => ({ rollupRows: 0 })
  });
  assert.deepEqual(names, ["list-clients", "snapshot-c1"]);
});
