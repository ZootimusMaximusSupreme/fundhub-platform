// FinanceOS money moves — the 15-minute pass (wave 5, W7). No Inngest, no
// Postgres, no Plaid.
import { test } from "node:test";
import assert from "node:assert/strict";

import { sweep, SWEEP_CRON, financeOsMoneyTransfers } from "./finance-os-money-transfers.mjs";

test("every 15 minutes, under its own id", () => {
  assert.equal(SWEEP_CRON, "*/15 * * * *");
  assert.equal(financeOsMoneyTransfers.id(), "finance-os-money-transfers");
});

test("off: returns at once, and touches no database", async () => {
  const db = { query: async () => { throw new Error("no query may run while transfers are off"); } };
  const r = await sweep(db, { env: { PLAID_ENV: "sandbox" }, now: new Date("2026-10-07T15:00:00Z") });
  assert.deepEqual(r, { ok: true, skipped: "transfers_disabled", why: "limits_not_set" });
});

test("passes db, env, clock, provider and step through to the engine's pass", async () => {
  const seen = [];
  const pass = async (conn, args) => { seen.push([conn, args]); return { ok: true }; };
  const db = {}, env = { X: 1 }, now = new Date(), provider = {}, step = { run: (_n, fn) => fn() };
  await sweep(db, { env, now, provider, step, pass });
  assert.equal(seen[0][0], db);
  assert.deepEqual(seen[0][1], { env, now, provider, step });
});
