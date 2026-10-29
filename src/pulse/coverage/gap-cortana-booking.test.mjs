import { test } from "node:test";
import assert from "node:assert/strict";
import { CORTANA_UNDELIVERED_SQL, gapChecks } from "./gap-cortana-booking.mjs";

test("Cortana tripwire goes red for a confirmed call without a delivery receipt", async () => {
  let observed;
  const now = new Date("2026-10-29T21:00:00Z");
  const db = { query: async (sql, params) => {
    observed = { sql, params };
    return { rows: [{ undelivered: 2 }] };
  } };
  const [row] = await gapChecks({ db, now });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 confirmed ClickFunnels calls/);
  assert.equal(observed.sql, CORTANA_UNDELIVERED_SQL);
  assert.equal(observed.params[0], now);
  assert.match(observed.sql, /cortana_booking_sends/);
  assert.match(observed.sql, /20 minutes/);
});

test("Cortana tripwire passes only with a readable zero; unavailable evidence skips", async () => {
  const green = await gapChecks({ db: { query: async () => ({ rows: [{ undelivered: 0 }] }) } });
  assert.equal(green[0].status, "PASS");
  assert.equal((await gapChecks())[0].status, "skip");
  const failed = await gapChecks({ db: { query: async () => { throw Error("database offline"); } } });
  assert.equal(failed[0].status, "skip");
});
