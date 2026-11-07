// The daily Whop plans job: one sync pass, its count on the receipt, and an error that
// reaches the receipt when Whop cannot be read. No Whop call and no database here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sweep, SWEEP_CRON, SOURCE_WORKFLOW, financeOsWhopPlansSweeper } from "./finance-os-whop-plans-sweeper.mjs";
import { itemCountOf } from "../pulse/heartbeats.mjs";

test("registered as a daily 07:00 UTC cron, before the 07:30 alerts pass", () => {
  assert.equal(SWEEP_CRON, "0 7 * * *");
  assert.equal(SOURCE_WORKFLOW, "finance-os-whop-plans-sweeper");
  assert.equal(financeOsWhopPlansSweeper.id(), "finance-os-whop-plans-sweeper");
});

test("one pass of the sync, in a step, and the saved count on the receipt", async () => {
  const calls = [];
  const conn = { tag: "db" };
  const steps = [];
  const out = await sweep(conn, {
    now: new Date("2026-11-07T07:00:00Z"), env: { WHOP_API_KEY: "k" },
    sync: async (c, opts) => { calls.push({ c, opts }); return { ok: true, saved: 3, listed: 4 }; },
    step: { run: async (name, fn) => { steps.push(name); return fn(); } }
  });
  assert.deepEqual(steps, ["read-whop-plans"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].c, conn);
  assert.equal(calls[0].opts.now.toISOString(), "2026-11-07T07:00:00.000Z");
  assert.equal(out.count, 3);
  assert.equal(itemCountOf(out), 3);
});

test("a sync that cannot read Whop throws, so the receipt says error", async () => {
  await assert.rejects(sweep({}, { sync: async () => { throw Object.assign(new Error("Whop did not accept the API key (401)"), { code: "whop_unauthorized" }); } }),
    { code: "whop_unauthorized" });
  const skipped = await sweep({}, { sync: async () => ({ ok: true, skipped: true, reason: "whop_not_configured", saved: 0 }) });
  assert.equal(skipped.count, 0);
});
