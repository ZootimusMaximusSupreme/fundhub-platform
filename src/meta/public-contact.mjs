// Match only contact details the applicant submitted on a public survey.
// The private receipt is an unguessable event id returned by that survey.
// It never appears on the Meta wire. A conversion does not require a match.
import { hashEmail, hashPhone } from "./user-data.mjs";
import { classifyVisitor } from "../slo/visitor.mjs";

const CONTACT_SQL = `
  SELECT DISTINCT receipt.client_id, receipt.payload->>'email' AS email,
                  receipt.payload->>'phone' AS phone
    FROM events link
    LEFT JOIN events receipt
      ON receipt.org_id = link.org_id AND receipt.name = 'survey.completed'
     AND receipt.id = CASE WHEN (link.payload->'props'->>'public_contact_receipt')
          ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN (link.payload->'props'->>'public_contact_receipt')::uuid END
     AND receipt.client_id IS NOT NULL
     AND receipt.created_at BETWEEN link.created_at - interval '30 minutes' AND link.created_at
     AND ((link.payload->>'page' = '/home' AND link.payload->'props'->>'survey' = 'home'
           AND receipt.payload->>'source' = 'website:home' AND receipt.idempotency_key LIKE 'website-survey:%:completed')
       OR (link.payload->>'page' = '/apply' AND link.payload->'props'->>'survey' = 'apply'
           AND receipt.payload->>'source' = 'clickfunnels' AND receipt.payload->>'funnel' = 'apply-survey'))
   WHERE link.org_id = $1 AND link.name = 'funnel.survey_answer'
     AND link.created_at >= now() - interval '1 day'
     AND link.payload->>'session_id' = $2 AND link.payload->'props'->'last' = 'true'::jsonb
     AND link.payload->'props'->'completion_acknowledged' = 'true'::jsonb
     AND link.payload->>'page' IN ('/home','/apply')
   LIMIT 2`;

export async function publicContact(db, orgId, sessionId) {
  if (!orgId || !sessionId) return null;
  try {
    const { rows } = await db.query(CONTACT_SQL, [orgId, sessionId]);
    // A reused session, changed contact, or unlinked completion is ambiguous.
    if (rows.length !== 1 || !rows[0].client_id) return null;
    const { email, phone, client_id: clientId } = rows[0];
    return { clientId, emailHash: hashEmail(email), phoneHash: hashPhone(phone), actor: classifyVisitor({ email }).actor };
  } catch {
    // A failed optional lookup must not drop the underlying conversion.
    return null;
  }
}
