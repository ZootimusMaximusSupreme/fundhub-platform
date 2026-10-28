// Sales Floor and the hourly Pulse read share real-customer counting rules.
// These contracts exercise every monthly/today SQL path without touching a database.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  FLOOR_CASH_SQL, FLOOR_BOOKED_SQL, FLOOR_OUTCOMES_SQL,
  DEPOSIT_TO_FUNDED_SQL, depositToFundedSql
} from "./sales-totals-truth.mjs";

function liveOutcome(sql, label) {
  assert.match(sql, /FROM call_outcomes o/, label);
  assert.match(sql, /JOIN clients c ON c\.id = o\.client_id AND c\.org_id = o\.org_id/, label);
  assert.match(sql, /o\.org_id = \$1/, label);
  assert.match(sql, /COALESCE\(o\.is_demo, false\) = false/, label);
  assert.match(sql, /COALESCE\(c\.is_demo, false\) = false/, label);
}
function liveBooking(sql, label) {
  assert.match(sql, /FROM events e/, label);
  assert.match(sql, /JOIN clients c ON c\.id = e\.client_id AND c\.org_id = e\.org_id/, label);
  assert.match(sql, /e\.org_id = \$1/, label);
  assert.match(sql, /COALESCE\(c\.is_demo, false\) = false/, label);
  assert.match(sql, /e\.payload->>'simulated', 'false'\) <> 'true'/, label);
  assert.match(sql, /e\.payload->>'environment', ''\) <> 'simulated'/, label);
}

test("monthly manager cash, funnel and funding rate reject demo call or client rows", () => {
  liveOutcome(FLOOR_CASH_SQL, "cash");
  liveOutcome(FLOOR_OUTCOMES_SQL, "held/deposits/downsells");
  liveOutcome(DEPOSIT_TO_FUNDED_SQL, "deposit to funded");
  liveOutcome(depositToFundedSql("AND o.staff_id = $4"), "closer deposit to funded");
  assert.match(depositToFundedSql("AND o.staff_id = $4"), /AND o\.staff_id = \$4/);
});

test("monthly manager booking count rejects demo clients and explicitly simulated events", () => {
  liveBooking(FLOOR_BOOKED_SQL, "monthly bookings");
});

test("today's sales floor uses the same demo and tenant boundaries as the monthly floor", () => {
  const src = fs.readFileSync(new URL("../../../sales/metrics.mjs", import.meta.url), "utf8");
  const day = src.split("/** Same funnel counts, one America/Phoenix civil day. */")[1]
    .split("/** Owner-set:")[0];
  const queries = [...day.matchAll(/`([\s\S]*?)`/g)].map((m) => m[1]);
  assert.equal(queries.length, 2);
  liveBooking(queries[0], "today bookings");
  liveOutcome(queries[1], "today held/deposits");
  assert.match(queries[0], /AT TIME ZONE 'America\/Phoenix'/);
  assert.match(queries[1], /AT TIME ZONE 'America\/Phoenix'/);
});
