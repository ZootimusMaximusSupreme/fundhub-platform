import { test } from "node:test";
import assert from "node:assert/strict";
import { closerNow } from "./closer-now.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const STAFF = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-17T18:00:00.000Z");

const CURRENT = {
  task_id: "t-now",
  client_id: "22222222-2222-4222-8222-222222222222",
  due_at: "2026-08-17T17:00:00.000Z",
  meeting_url: null,
  title: "Close",
  name: "Dana Whitfield"
};
const NEXT = {
  task_id: "t-next",
  client_id: "44444444-4444-4444-8444-444444444444",
  due_at: "2026-08-17T20:00:00.000Z",
  meeting_url: null,
  title: "Close",
  name: "Riley Chen"
};

function fakeDb(rows) {
  return {
    async query(sql, params) {
      assert.match(sql, /t\.org_id = \$1/);
      assert.match(sql, /assignee_role = 'closer'/);
      assert.match(sql, /date_trunc\('day'/);
      assert.match(sql, /NOT EXISTS\s*\(\s*SELECT 1 FROM call_outcomes o/);
      assert.match(sql, /o\.org_id = t\.org_id AND o\.client_id = t\.client_id/);
      assert.match(sql, /o\.task_id = t\.id/);
      assert.match(sql, /NULLIF\(btrim\(t\.body\), ''\) IS NOT NULL AND o\.booking_ref = t\.body/);
      assert.doesNotMatch(sql, /LEFT JOIN call_outcomes o/);
      assert.equal(params[0], ORG);
      assert.equal(params[1], STAFF);
      assert.equal(params[2], NOW.toISOString());
      return { rows };
    }
  };
}

test("closerNow requires org and staff", async () => {
  await assert.rejects(() => closerNow({}, {}), /orgId and staffId required/);
});

test("closerNow returns current and next from today's unlogged closer tasks", async () => {
  const out = await closerNow(fakeDb([CURRENT, NEXT]), {
    orgId: ORG, staffId: STAFF, now: NOW
  });
  assert.deepEqual(out.current, CURRENT);
  assert.deepEqual(out.next, NEXT);
});

test("closerNow next is null when only one call is booked", async () => {
  const out = await closerNow(fakeDb([CURRENT]), {
    orgId: ORG, staffId: STAFF, now: NOW
  });
  assert.deepEqual(out.current, CURRENT);
  assert.equal(out.next, null);
});

test("closerNow is empty when no booked calls — does not invent people", async () => {
  const out = await closerNow(fakeDb([]), {
    orgId: ORG, staffId: STAFF, now: NOW
  });
  assert.equal(out.current, null);
  assert.equal(out.next, null);
});
