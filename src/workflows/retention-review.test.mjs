import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewRetention, retentionReview, REVIEW_CRON } from "./retention-review.mjs";
import { scheduled } from "./scheduled.mjs";
import { CLOCK_JOBS } from "../pulse/heartbeats.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";

test("monthly review is registered on the Netlify clock and heartbeat list", () => {
  assert.equal(REVIEW_CRON, "0 4 1 * *");
  assert.ok(scheduled.includes(retentionReview));
  assert.ok(CLOCK_JOBS.some(([id, cron]) => id === "retention-review" && cron === REVIEW_CRON));
});

test("monthly review saves only counts and never changes consumer records", async () => {
  const calls = [];
  const conn = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM orgs")) return { rows: [{ id: ORG }] };
      if (sql.includes("INSERT INTO retention_run_receipts")) return { rows: [{ id: "receipt-1" }] };
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  const makePlan = async (_db, { orgId }) => {
    assert.equal(orgId, ORG);
    return { items: [{ dataClass: "bank_transactions", action: "de_identify", retainDays: 731,
      signedOff: true, expired: 3, reportOnly: [{ email: "must-not-store@example.test" }] }] };
  };
  const result = await reviewRetention(conn, { asOf: new Date("2026-11-02T00:00:00Z"), makePlan });
  assert.deepEqual(result, { ok: true, count: 1, recorded: 1, month: "2026-11" });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ sql }) => !/\b(DELETE|UPDATE|TRUNCATE)\b/i.test(sql)));
  const receipt = calls[1];
  assert.equal(receipt.params[0], ORG);
  assert.equal(receipt.params[1], "2026-11");
  assert.deepEqual(JSON.parse(receipt.params[2]), [{ dataClass: "bank_transactions",
    action: "de_identify", retainDays: 731, signedOff: true, expired: 3, skipped: null }]);
  assert.doesNotMatch(receipt.params[2], /must-not-store/);
});

test("an org error makes the scheduled run red after reviewing other orgs", async () => {
  const conn = {
    async query(sql) {
      if (sql.includes("FROM orgs")) return { rows: [{ id: ORG }, { id: "22222222-2222-4222-8222-222222222222" }] };
      return { rows: [{ id: "receipt-1" }] };
    }
  };
  const makePlan = async (_db, { orgId }) => {
    if (orgId === ORG) throw new Error("read failed");
    return { items: [] };
  };
  await assert.rejects(() => reviewRetention(conn, { makePlan }), /failed for 1 org/);
});
