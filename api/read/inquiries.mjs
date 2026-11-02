// GET /api/read/inquiries — the inquiry-removal work queue.
//
// Read-only. Auth + role gate + pagination + redaction come from
// src/http/read-api.mjs; this file is its SQL and nothing else.
//
// NOTE ON THE SOURCE. This reads the LOCAL inquiry_log table, which is not the
// same thing as /api/inquiry — that endpoint proxies the external spreadsheet
// runtime and returns its shape. The screen's Work Queue columns map 1:1 onto
// inquiry_log, so it reads the table directly rather than the proxy.
//
// client_name is joined here rather than left to the caller because the screen
// shows a person, and making every consumer do a second round-trip per row to
// turn a uuid into a name is how a six-row table becomes seven requests.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

/* THE ORG COMES FROM THE SESSION AND IS REQUIRED (audit C1).
   A session with no org binds NULL, and `org_id = NULL::uuid` matches no row —
   it fails CLOSED. That is deliberate: omitting the clause when the org is
   unknown turns a broken session into a firehose over every company's consumer
   dispute records. */
const orgOf = (staff) => (staff && staff.org_id) || null;

const run = readHandler({
  roles: ROLE_SETS.SPECIALIST_DESK,
  fetch: (db, { limit, offset, query, staff }) =>
    db.query(
      `SELECT i.id, i.client_id, i.case_id, i.bureau, i.inquiry, i.inquiry_name,
              i.expected_name,
              i.status, i.call_state, i.is_open, i.call_attempts, i.outcome,
              i.cleared_at, i.confirmed_at, i.created_at, i.updated_at,
              TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS client_name
         FROM inquiry_log i
         LEFT JOIN clients c ON c.id = i.client_id AND c.org_id = i.org_id
           AND c.custom_fields->>'crm_archived_at' IS NULL
        WHERE i.org_id = $6::uuid
          AND (i.client_id IS NULL OR c.id IS NOT NULL)
          AND ($3::uuid IS NULL OR i.client_id = $3)
          AND ($4::text IS NULL OR i.bureau = $4)
          AND ($5::text IS NULL OR i.status = $5)
        ORDER BY i.updated_at DESC, i.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit + 1, offset, query.client_id || null, query.bureau || null, query.status || null,
       orgOf(staff)]
    ).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
