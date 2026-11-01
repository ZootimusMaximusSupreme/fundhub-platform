import { test } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../db.mjs";
import { setterNumbers } from "../setter/dashboard.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(url.hostname)
      && (url.pathname === "/fundhub_ci" || /^\/fundhub_pr315_[a-z0-9]+$/.test(url.pathname));
  } catch {
    return false;
  }
})();

test("setter KPI SQL scopes Phoenix day, org, archived leads and demo data",
  { skip: !SCRATCH }, async () => {
    const conn = await pool().connect();
    try {
      await conn.query("BEGIN");
      await conn.query(`CREATE TEMP TABLE clients (
        id text, org_id text, custom_fields jsonb, is_demo boolean
      ) ON COMMIT DROP`);
      await conn.query(`CREATE TEMP TABLE bookings (
        id text, org_id text, client_id text, status text, created_at timestamptz
      ) ON COMMIT DROP`);
      await conn.query(`CREATE TEMP TABLE call_outcomes (
        org_id text, client_id text, outcome text, logged_at timestamptz, is_demo boolean
      ) ON COMMIT DROP`);

      const handoff = (dials, extra = {}) => JSON.stringify({
        setter_handoff: { setter_staff_id: "setter-a", lead_type: "opt_in",
          dial_attempt_days: { "2026-11-01": dials } }, ...extra
      });
      await conn.query(`INSERT INTO clients (id, org_id, custom_fields, is_demo) VALUES
        ('real', 'org-a', $1::jsonb, false),
        ('archived', 'org-a', $2::jsonb, false),
        ('demo', 'org-a', $3::jsonb, true),
        ('foreign', 'org-b', $4::jsonb, false),
        ('transferred', 'org-a', $5::jsonb, false)`, [
        handoff(2), handoff(99, { crm_archived_at: "2026-10-31T00:00:00Z" }),
        handoff(3), handoff(99), JSON.stringify({ setter_handoff: {
          setter_staff_id: "setter-b", lead_type: "opt_in",
          dial_attempt_days: { "2026-11-01": 4 },
          dial_attempts_by_setter: {
            "setter-a": { "2026-11-01": 3 }, "setter-b": { "2026-11-01": 1 }
          }
        } })
      ]);
      await conn.query(`INSERT INTO bookings (id, org_id, client_id, status, created_at) VALUES
        ('real-in', 'org-a', 'real', 'booked', '2026-11-01T16:00:00Z'),
        ('real-out', 'org-a', 'real', 'booked', '2026-11-02T07:00:00Z'),
        ('archived', 'org-a', 'archived', 'booked', '2026-11-01T16:00:00Z'),
        ('demo', 'org-a', 'demo', 'booked', '2026-11-01T16:00:00Z'),
        ('foreign', 'org-b', 'foreign', 'booked', '2026-11-01T16:00:00Z')`);
      await conn.query(`INSERT INTO call_outcomes
        (org_id, client_id, outcome, logged_at, is_demo) VALUES
        ('org-a', 'real', 'showed', '2026-11-01T16:00:00Z', false),
        ('org-a', 'real', 'no_show', '2026-11-01T17:00:00Z', false),
        ('org-a', 'real', 'showed', '2026-11-02T07:00:00Z', false),
        ('org-a', 'archived', 'showed', '2026-11-01T16:00:00Z', false),
        ('org-a', 'demo', 'showed', '2026-11-01T16:00:00Z', true),
        ('org-b', 'foreign', 'showed', '2026-11-01T16:00:00Z', false)`);

      const staff = { org_id: "org-a", id: "setter-a" };
      const now = new Date("2026-11-01T18:00:00Z");
      assert.deepEqual(await setterNumbers(conn, staff, { now, includeDemo: false }), {
        dials: 5, booked: 1, dial_to_book_rate: 0.2,
        showed: 1, no_shows: 1, show_rate: 0.5
      });
      assert.deepEqual(await setterNumbers(conn, staff, { now, includeDemo: true }), {
        dials: 8, booked: 2, dial_to_book_rate: 0.25,
        showed: 2, no_shows: 1, show_rate: 2 / 3
      });
      assert.deepEqual(await setterNumbers(conn, { org_id: "org-a", id: "setter-b" }, { now, includeDemo: false }), {
        dials: 1, booked: 0, dial_to_book_rate: 0,
        showed: 0, no_shows: 0, show_rate: null
      });
    } finally {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
      await close();
    }
  });
