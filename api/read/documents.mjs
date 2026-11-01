// GET /api/read/documents — document METADATA only — storage_key is stripped by redact()
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
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
  roles: ROLE_SETS.STAFF,
  fetch: (db, { limit, offset, query, staff }) =>
    // client_name is joined here for the same reason as read/inquiries: the
    // screen shows a person, and making the caller do a round-trip per row to
    // turn a uuid into a name is how a 200-row page becomes 201 requests.
    db.query(`SELECT d.id, d.client_id, d.document_key, d.kind, d.subtype, d.title, d.invoice_id,
           d.current_version, d.mime_type, d.byte_size, d.generated_at, d.delivered_at,
           d.delivery_channel, d.delivery_status, d.signature_required, d.signed_at,
           d.signer_name, d.expires_at, d.created_at,
           TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS client_name
      FROM documents d
      LEFT JOIN clients c ON c.id = d.client_id AND c.org_id = d.org_id
        AND c.custom_fields->>'crm_archived_at' IS NULL
     WHERE d.org_id = $5::uuid
       AND (d.client_id IS NULL OR c.id IS NOT NULL)
       AND ($3::uuid IS NULL OR d.client_id = $3)
       AND ($4::text IS NULL OR d.kind = $4)
     ORDER BY d.created_at DESC
     LIMIT $1 OFFSET $2`, [
      limit + 1,
      offset,
      // UI + staff callers often send camelCase clientId.
      query.client_id || query.clientId || null,
      query.kind || null,
      orgOf(staff)
    ]).then((r) => r.rows)
});

export default async (req, res) => {
  // A signed-in client (or any non-staff principal) must be refused as
  // forbidden, not treated as "no session". requireAuth only sees staff
  // tokens, so an account token used to look unsigned-in (401).
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;
  return run(req, res, { db, requireAuth });
};
