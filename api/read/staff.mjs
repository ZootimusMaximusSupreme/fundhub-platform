// GET /api/read/staff — staff directory — password_hash is stripped by redact() and never selected
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs. hiddenCount is how many rows this list keeps off
// screen (owner, seeded test logins, TEST — names, and demo rows when demo is off).
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";
import { SEED_FURNITURE_EMAILS } from "../../src/auth/seed-staff.mjs";
import { orgDemoModeEnabled } from "../../src/demo/exclude-demo.mjs";

/* THE ORG COMES FROM THE SESSION AND IS REQUIRED (audit C1).
   A session with no org binds NULL, and `org_id = NULL::uuid` matches no row —
   it fails CLOSED. That is deliberate: the alternative, omitting the clause when
   the org is unknown, turns a broken session into a firehose over every
   company's rows. See src/http/read-api.mjs:150-153, which records the decision
   to leave scoping to each endpoint's own SQL — a decision that then went
   unimplemented in ten endpoints while the comment stayed. */
const orgOf = (staff) => (staff && staff.org_id) || null;

const seedEmails = () => SEED_FURNITURE_EMAILS.map((e) => e.toLowerCase());

function demoHideSql(demoOn) {
  return demoOn ? "" : `
       AND s.name NOT ILIKE 'DEMO %'
       AND s.email NOT LIKE '%@demo.fundhub.local'
       AND s.email NOT LIKE '%@example.com'`;
}

function demoHiddenSql(demoOn) {
  return demoOn ? "FALSE" : `(
         s.name ILIKE 'DEMO %'
         OR s.email LIKE '%@demo.fundhub.local'
         OR s.email LIKE '%@example.com'
       )`;
}

async function hiddenCountFor(database, staff) {
  const orgId = orgOf(staff);
  if (!orgId) return 0;
  const demoOn = await orgDemoModeEnabled(database, orgId);
  const row = (await database.query(
    `SELECT count(*)::int AS n
       FROM staff s
      WHERE s.org_id = $1::uuid
        AND s.removed_at IS NULL
        AND ($3::uuid IS NULL OR s.id <> $3::uuid)
        AND (
          s.role = 'owner'
          OR lower(s.email) = ANY($2::text[])
          OR s.name ILIKE 'TEST —%'
          OR ${demoHiddenSql(demoOn)}
        )`,
    [orgId, seedEmails(), (staff && staff.id) || null]
  )).rows[0];
  return row ? row.n : 0;
}

export default async function handler(req, res) {
  let hiddenCount = 0;
  const origJson = typeof res.json === "function" ? res.json.bind(res) : null;
  if (origJson) {
    res.json = (body) => {
      if (body && body.ok === true) body.hiddenCount = hiddenCount;
      return origJson(body);
    };
  }

  const run = readHandler({
    roles: ROLE_SETS.FINANCE,
    fetch: async (database, { limit, offset, query, staff }) => {
      hiddenCount = await hiddenCountFor(database, staff);
      const demoOn = await orgDemoModeEnabled(database, orgOf(staff));
      const demoHide = demoHideSql(demoOn);
      return database.query(`SELECT s.id, s.name, s.email, s.role, s.status, s.assignment_order,
           s.last_assigned_at, s.created_at, s.phone, s.start_date, s.employee_code,
           s.notify_booked_call_sms, s.monitoring_consent_at, s.hubstaff_user_id,
           (SELECT count(*)::int FROM tasks t
             WHERE t.assignee_staff_id = s.id AND t.done = false) AS open_tasks,
           (SELECT count(*)::int FROM shifts sh
             WHERE sh.staff_id = s.id AND sh.ended_at IS NULL) AS open_shift,
           (SELECT count(*)::int FROM staff_events se
             WHERE se.staff_id = s.id
               AND se.kind IN ('monitor_activity','monitor_screenshot')
               AND se.created_at >= date_trunc('day', now())) AS monitor_events_today
      FROM staff s
     WHERE s.org_id = $4::uuid
       AND s.removed_at IS NULL
       AND ($3::text IS NULL OR s.role = $3)
       /* The caller's OWN row always comes back, whatever the filters below
          say. Without it the owner could never see a clock in/out button on
          their own line, because the owner row is one of the hidden ones. */
       AND ($6::uuid IS NOT NULL AND s.id = $6::uuid OR (
             s.role <> 'owner'
             AND lower(s.email) <> ALL($5::text[])
             AND s.name NOT ILIKE 'TEST —%'
             ${demoHide}
           ))
     ORDER BY s.name
     LIMIT $1 OFFSET $2`, [
        limit + 1, offset, query.role || null, orgOf(staff),
        seedEmails(), (staff && staff.id) || null
      ]).then((r) => r.rows);
    }
  });

  return run(req, res, { db, requireAuth });
}
