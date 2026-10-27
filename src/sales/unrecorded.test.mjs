import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRACE_MS,
  hasTape,
  isUnrecorded,
  listUnrecordedCalls,
  presentUnrecorded,
  countUnrecorded
} from "./unrecorded.mjs";

const NOW = new Date("2026-08-26T18:00:00Z");
const OLD = new Date(NOW.getTime() - GRACE_MS - 60 * 1000).toISOString();
const FRESH = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();

test("call with no tape after the wait is flagged", () => {
  assert.equal(
    isUnrecorded(
      { outcome: "deposit", logged_at: OLD, recording_url: null, transcript: null },
      { now: NOW }
    ),
    true
  );
});

test("call with a transcript is not flagged", () => {
  assert.equal(
    isUnrecorded(
      {
        outcome: "deposit",
        logged_at: OLD,
        recording_url: null,
        transcript: "three thousand is a start"
      },
      { now: NOW }
    ),
    false
  );
});

test("call with a recording link is not flagged", () => {
  assert.equal(hasTape({ recording_url: "https://drive.google.com/file/d/rec" }), true);
  assert.equal(
    isUnrecorded(
      {
        outcome: "callback",
        logged_at: OLD,
        recording_url: "https://drive.google.com/file/d/rec",
        transcript: null
      },
      { now: NOW }
    ),
    false
  );
});

test("no-show without tape is not flagged", () => {
  assert.equal(
    isUnrecorded(
      { outcome: "no_show", logged_at: OLD, recording_url: null, transcript: null },
      { now: NOW }
    ),
    false
  );
});

test("a fresh call waits unless Drive already scanned after it", () => {
  const row = { outcome: "deposit", logged_at: FRESH, recording_url: null, transcript: "" };
  assert.equal(isUnrecorded(row, { now: NOW }), false);
  assert.equal(
    isUnrecorded(row, { now: NOW, driveSyncedAt: "2026-08-26T17:56:00Z" }),
    true
  );
});

test("listUnrecordedCalls binds the session company and excludes calls with a transcript", async () => {
  let seen = null;
  const orgId = "00000000-0000-4000-8000-000000000001";
  const db = {
    async query(sql, params) {
      if (/FROM call_outcomes/i.test(sql)) {
        seen = { sql, params };
        return { rows: [] };
      }
      if (/brain_drive_sync/i.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  await listUnrecordedCalls(db, { orgId, now: NOW });
  assert.ok(seen, "call_outcomes query ran");
  assert.match(seen.sql, /o\.org_id\s*=\s*\$1/);
  assert.equal(seen.params[0], orgId);
  assert.match(seen.sql, /o\.transcript/i);
  assert.match(seen.sql, /o\.transcript IS NULL OR btrim\(o\.transcript\) = ''/i);
});

test("listUnrecordedCalls does not query without a company", async () => {
  let queried = false;
  const db = { async query() { queried = true; return { rows: [] }; } };
  const rows = await listUnrecordedCalls(db, { orgId: null, now: NOW });
  assert.deepEqual(rows, []);
  assert.equal(queried, false);
});

test("listUnrecordedCalls returns the no-tape row and skips the transcript row", async () => {
  const db = {
    async query(sql) {
      if (/brain_drive_sync/i.test(sql)) return { rows: [] };
      if (/FROM call_outcomes/i.test(sql)) {
        return {
          rows: [
            {
              id: "co-empty",
              client_id: "c1",
              staff_id: "s1",
              outcome: "deposit",
              recording_url: null,
              transcript: null,
              logged_at: OLD,
              client_name: "Jane Doe"
            },
            {
              id: "co-words",
              client_id: "c2",
              staff_id: "s1",
              outcome: "deposit",
              recording_url: null,
              transcript: "hello from the call",
              logged_at: OLD,
              client_name: "Sam Lee"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };
  const rows = await listUnrecordedCalls(db, {
    orgId: "00000000-0000-4000-8000-000000000001",
    now: NOW
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "co-empty");
  assert.equal(rows[0].flag, "unrecorded");
  assert.equal(presentUnrecorded(rows[0]).client_name, "Jane Doe");
});

test("eligible unrecorded calls are selected before the SQL result limit", async () => {
  const orgId = "00000000-0000-4000-8000-000000000001";
  const fresh = { id: "fresh", outcome: "callback", logged_at: FRESH, recording_url: null, transcript: null };
  const old = { id: "old", outcome: "callback", logged_at: OLD, recording_url: null, transcript: null };
  const db = {
    async query(sql, params) {
      if (/FROM brain_drive_sync/i.test(sql)) return { rows: [] };
      if (/FROM call_outcomes/i.test(sql)) {
        assert.match(sql, /o\.logged_at <= \$3::timestamptz/);
        assert.match(sql, /o\.logged_at < \$4::timestamptz/);
        assert.equal(params.length, 5, "org, window, grace cutoff, Drive sync, cap");
        assert.equal(params[0], orgId);
        assert.equal(params[3], null, "no Drive sync makes only age eligible");
        assert.equal(params[4], 1);
        // Simulate WHERE before LIMIT, including the SQL's exact time boundaries.
        const eligible = [fresh, old].filter((row) =>
          row.logged_at <= params[2] || (params[3] && row.logged_at < params[3])
        );
        return { rows: eligible.slice(0, params[4]) };
      }
      return { rows: [] };
    }
  };
  const rows = await listUnrecordedCalls(db, { orgId, now: NOW, limit: 1 });
  assert.deepEqual(rows.map((r) => r.id), ["old"]);
});

test("Drive sync eligibility and setter scope are bound before the result cap", async () => {
  const orgId = "00000000-0000-4000-8000-000000000001";
  const staffId = "00000000-0000-4000-8000-000000000002";
  const driveSyncedAt = new Date("2026-08-26T17:56:00Z");
  const db = {
    async query(sql, params) {
      if (/FROM brain_drive_sync/i.test(sql)) return { rows: [{ last_sync_at: driveSyncedAt }] };
      assert.match(sql, /o\.staff_id = \$5/);
      assert.match(sql, /LIMIT \$6/);
      assert.equal(params[3], driveSyncedAt);
      assert.equal(params[4], staffId);
      assert.equal(params[5], 1);
      assert.equal(FRESH < params[3].toISOString(), true);
      return { rows: [{
        id: "fresh-synced", outcome: "deposit", logged_at: FRESH,
        recording_url: null, transcript: null, staff_id: staffId, client_name: "Client"
      }] };
    }
  };
  const rows = await listUnrecordedCalls(db, { orgId, staffId, now: NOW, limit: 1 });
  assert.deepEqual(rows.map((r) => r.id), ["fresh-synced"]);
});

test("countUnrecorded reports all eligible missing tapes beyond the 200-row page cap", async () => {
  const orgId = "00000000-0000-4000-8000-000000000001";
  let countQuery = null;
  const db = {
    async query(sql, params) {
      if (/FROM brain_drive_sync/i.test(sql)) return { rows: [] };
      countQuery = { sql, params };
      return { rows: [{ total: "275" }] };
    }
  };
  const total = await countUnrecorded(db, { orgId, now: NOW });
  assert.equal(total, 275);
  assert.match(countQuery.sql, /SELECT count\\(\\*\\)::int AS total/);
  assert.doesNotMatch(countQuery.sql, /LIMIT/i, "totals must not be capped");
  assert.match(countQuery.sql, /o\\.org_id = \\$1/);
  assert.match(countQuery.sql, /o\\.transcript IS NULL OR btrim\\(o\\.transcript\\) = ''/);
  assert.match(countQuery.sql, /o\\.logged_at <= \\$3::timestamptz/);
  assert.match(countQuery.sql, /o\\.logged_at < \\$4::timestamptz/);
  assert.equal(countQuery.params.length, 4);
  assert.equal(countQuery.params[3], null);
});

test("countUnrecorded scopes totals to one staff member", async () => {
  const orgId = "00000000-0000-4000-8000-000000000001";
  const staffId = "00000000-0000-4000-8000-000000000002";
  const db = {
    async query(sql, params) {
      if (/FROM brain_drive_sync/i.test(sql)) return { rows: [] };
      assert.match(sql, /o\\.staff_id = \\$5/);
      assert.equal(params[0], orgId);
      assert.equal(params[4], staffId);
      assert.equal(params.length, 5);
      return { rows: [{ total: 3 }] };
    }
  };
  assert.equal(await countUnrecorded(db, { orgId, staffId, now: NOW }), 3);
  assert.equal(await countUnrecorded(db, { orgId: null, staffId, now: NOW }), 0);
});
