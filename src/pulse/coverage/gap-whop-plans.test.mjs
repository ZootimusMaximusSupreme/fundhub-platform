// payments:whop-plans-current — an old Whop copy on a client's Payments screen goes red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECK_IDS, STALE_HOURS, WHOP_PLANS_STALE_SQL, gapChecks } from "./gap-whop-plans.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-07T17:00:00Z");

test("one scoped, read-only question about real clients' open Whop plans", () => {
  assert.deepEqual(CHECK_IDS, ["payments:whop-plans-current"]);
  assert.equal(STALE_HOURS, 36);
  assert.doesNotMatch(WHOP_PLANS_STALE_SQL, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|BEGIN|COMMIT|SET)\b/);
  assert.match(WHOP_PLANS_STALE_SQL, /w\.org_id = \$1::uuid/);
  assert.match(WHOP_PLANS_STALE_SQL, /w\.unlinked_at IS NULL/);
  assert.match(WHOP_PLANS_STALE_SQL, /is_demo/);
  assert.match(WHOP_PLANS_STALE_SQL, /synced_at < \$2::timestamptz/);
  assert.match(WHOP_PLANS_STALE_SQL, /period_end_on < \(\$3::date - 1\)/);
});

test("PASS only on an explicit zero, with the read window and Arizona's day as inputs", async () => {
  const reads = [];
  const out = await gapChecks({ db: { query: async (sql, params) => { reads.push(params); return { rows: [{ n: 0, not_read: 0 }] }; } }, orgId: ORG, now: NOW });
  assert.deepEqual(out.map((r) => r.status), ["PASS"]);
  assert.match(out[0].detail, /^0 Whop plans/);
  assert.deepEqual(reads[0], [ORG, "2026-11-06T05:00:00.000Z", "2026-11-07"]);
  // 03:00 UTC is still the evening before in Arizona.
  await gapChecks({ db: { query: async (sql, params) => { reads.push(params); return { rows: [{ n: 0, not_read: 0 }] }; } }, orgId: ORG, now: new Date("2026-11-08T03:00:00Z") });
  assert.equal(reads[1][2], "2026-11-07");
});

test("FAIL names how many and why: not read lately, or a charge day already gone", async () => {
  const both = await gapChecks({ db: { query: async () => ({ rows: [{ n: 3, not_read: 2 }] }) }, orgId: ORG, now: NOW });
  assert.equal(both[0].status, "FAIL");
  assert.match(both[0].detail, /^3 Whop plans are out of date/);
  assert.match(both[0].detail, /2 not read from Whop in 36 hours; 1 with a charge day that has passed/);
  assert.ok(both[0].suggestedFix);
  const one = await gapChecks({ db: { query: async () => ({ rows: [{ n: 1, not_read: 0 }] }) }, orgId: ORG, now: NOW });
  assert.match(one[0].detail, /^1 Whop plan is out of date .*\(1 with a charge day that has passed\)/);
});

test("an unreadable or malformed answer is a FAIL; no database is a skip, never a PASS", async () => {
  for (const db of [
    { query: async () => { throw new Error("relation whop_memberships does not exist"); } },
    { query: async () => ({ rows: [] }) },
    { query: async () => ({ rows: [{ n: "x", not_read: 0 }] }) },
    { query: async () => ({ rows: [{ n: 2 }] }) }
  ]) {
    const out = await gapChecks({ db, orgId: ORG, now: NOW });
    assert.equal(out[0].status, "FAIL");
  }
  assert.equal((await gapChecks({}))[0].status, "skip");
  assert.equal((await gapChecks({ db: { query: async () => ({ rows: [{ n: 0, not_read: 0 }] }) } }))[0].status, "skip");
});
