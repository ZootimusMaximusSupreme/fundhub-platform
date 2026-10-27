import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRACE_MS,
  hasTape,
  isUnrecorded,
  listUnrecordedCalls,
  presentUnrecorded
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
