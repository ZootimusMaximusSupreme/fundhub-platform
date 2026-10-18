// GET /api/read/commissions — staff commission ledger — who earned what, and whether it is settled
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

/* THE ORG COMES FROM THE SESSION AND IS REQUIRED (audit C1).
   A session with no org binds NULL, and `org_id = NULL::uuid` matches no row —
   it fails CLOSED. That is deliberate: the alternative, omitting the clause when
   the org is unknown, turns a broken session into a firehose over every
   company's rows. See src/http/read-api.mjs:150-153, which records the decision
   to leave scoping to each endpoint's own SQL — a decision that then went
   unimplemented in ten endpoints while the comment stayed. */
const orgOf = (staff) => (staff && staff.org_id) || null;

const run = readHandler({
  roles: ROLE_SETS.FINANCE,
  fetch: (db, { limit, offset, query, staff }) =>
    db.query(`SELECT l.id, l.staff_id, s.name AS staff_name, l.employee_code, l.client_id,
           l.client_code, NULLIF(BTRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '') AS client_name,
           l.role, l.basis, l.base_amount, l.amount, l.currency, l.status, l.split_percent,
           l.rule_id, l.rule_snapshot,
           l.product_name_at_earning, l.earned_at, l.approved_at, l.paid_at,
           l.void_reason, l.created_at
      FROM commission_ledger l
      LEFT JOIN staff s ON s.id = l.staff_id
      LEFT JOIN clients c ON c.id = l.client_id AND c.org_id = l.org_id
     WHERE l.org_id = $5::uuid
       AND ($3::uuid IS NULL OR l.client_id = $3)
       AND ($4::text IS NULL OR l.status = $4)
       AND COALESCE(l.is_demo, false) = false
     ORDER BY l.earned_at DESC NULLS LAST, l.created_at DESC
     LIMIT $1 OFFSET $2`, [limit + 1, offset, query.client_id || null, query.status || null, orgOf(staff)]).then((r) => r.rows)
});

export default (req, res) => run(req, res, { db, requireAuth });
