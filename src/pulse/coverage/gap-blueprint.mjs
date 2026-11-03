// Blueprint delivery exceptions for the existing deep/hourly pulse. Report
// counts only: no customer identity, provider call, send or automatic repair.
import { OFFERS } from "../../config/offers.mjs";
import { PAID_TRANSACTION_STATUS } from "../../entitlements/entitlements.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";

export const CHECK_IDS = Object.freeze([
  "blueprint:real-advisor",
  "blueprint:monthly-delivery",
  "blueprint:coach-call-delivery",
  "blueprint:preparation-evidence"
]);

// Same real-client exclusions as the existing consent and portal checks.
//
// blueprint:real-advisor — owner-set 2026-10-20: the CSM is the AI coaches
// plus the team CSM queue, so a paid buyer with NO staff link is normal and
// green. Red means a saved staff link points at a demo, disabled, suspended
// or other-company person: a real break. The check id is kept unchanged.
const REAL_CLIENT = `COALESCE(c.is_demo, false) = false
  AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
  AND COALESCE(c.email, '') !~* $3::text`;

export const REAL_ADVISOR_SQL = `
  /* gap:blueprint-real-advisor */
  SELECT count(*)::int AS n
    FROM clients c
   WHERE c.org_id = $1::uuid
     AND ${REAL_CLIENT}
     AND EXISTS (
       SELECT 1 FROM transactions t
       JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
         AND p.org_id = t.org_id
       WHERE t.org_id = c.org_id AND t.client_id = c.id
         AND lower(p.code) = lower($4::text)
         AND lower(btrim(COALESCE(t.status, ''))) = $5::text
         AND COALESCE(t.is_demo, false) = false
     )
     AND EXISTS (
       SELECT 1 FROM subscriptions s
       WHERE s.org_id = c.org_id AND s.client_id = c.id
         AND s.tier = 'finance-os' AND s.status = 'active'
         AND s.effective_from <= $2::timestamptz
         AND (s.effective_to IS NULL OR s.effective_to > $2::timestamptz)
         AND (s.current_period_start IS NULL OR s.current_period_start <= $2::timestamptz)
         AND (s.current_period_end IS NULL OR s.current_period_end > $2::timestamptz)
     )
     AND c.assigned_csm_staff_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM staff s
       WHERE s.org_id = c.org_id AND s.id = c.assigned_csm_staff_id
         AND lower(btrim(COALESCE(s.role, ''))) = 'csm'
         AND s.status = 'active' AND s.active = true AND s.is_demo = false
     )
`;

// Do not hide unfinished delivery just because the access year ended. The
// owner must complete the saved-result recovery and close the existing task.
export const MONTHLY_DELIVERY_SQL = `
  /* gap:blueprint-monthly-delivery */
  SELECT count(*)::int AS n
    FROM tasks t
    JOIN clients c ON c.org_id = t.org_id AND c.id = t.client_id
   WHERE t.org_id = $1::uuid
     AND t.source_workflow = $2::text
     AND t.done = false AND COALESCE(t.is_demo, false) = false
     AND ${REAL_CLIENT}
`;

// The existing hourly clock gives an unresolved claim one sweep to finish.
// Provider-accepted calls must retain both their message and webhook identity;
// a lost return leg is a delivery failure, never permission to dial again.
export const COACH_CALL_DELIVERY_SQL = `
  /* gap:blueprint-coach-call-delivery */
  SELECT count(*)::int AS n FROM (
    SELECT n.id
      FROM waypoint_nudges n
      JOIN clients c ON c.org_id = n.org_id AND c.id = n.client_id
     WHERE n.org_id = $1::uuid AND n.step = 5 AND n.kind = 'voice_call'
       AND n.channel = 'voice' AND n.template_key = 'BP-COACH-VOICE'
       AND ${REAL_CLIENT}
       AND (
         (n.outcome = 'claimed' AND n.created_at < $2::timestamptz - interval '1 hour')
         OR (n.outcome = 'queued' AND NOT EXISTS (
           SELECT 1 FROM messages m
           JOIN outbound_calls oc ON oc.call_id = m.provider_message_id
             AND oc.org_id = m.org_id AND oc.client_id = m.client_id
           WHERE m.id = n.message_id AND m.org_id = n.org_id AND m.client_id = n.client_id
             AND m.channel = 'voice' AND m.direction = 'outbound'
             AND m.status = 'sent' AND m.provider = 'bland'
             AND m.provider_ref = n.idempotency_key
             AND m.provider_message_id IS NOT NULL AND btrim(m.provider_message_id) <> ''
         ))
       )
    UNION ALL
    SELECT t.id
      FROM tasks t
      JOIN clients c ON c.org_id = t.org_id AND c.id = t.client_id
     WHERE t.org_id = $1::uuid AND t.source_workflow = 'blueprint-coach-call'
       AND t.done = false AND COALESCE(t.is_demo, false) = false
       AND ${REAL_CLIENT}
  ) failures
`;

// Saved data integrity only; incomplete client work is not a delivery failure.
export const PREPARATION_EVIDENCE_SQL = `
  /* gap:blueprint-preparation-evidence */
  WITH scoped_clients AS (
    SELECT c.id, c.org_id, c.custom_fields->'blueprint_business_plans' AS state
      FROM clients c
     WHERE c.org_id = $1::uuid
       AND ${REAL_CLIENT}
       AND EXISTS (
         SELECT 1 FROM entitlements e
         JOIN transactions t ON t.id = e.source_transaction_id
           AND t.org_id = e.org_id AND t.client_id = e.client_id
         JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
           AND p.org_id = t.org_id
         WHERE e.org_id = c.org_id AND e.client_id = c.id
           AND e.entitlement_code = 'credit-optimization-roadmap' AND e.revoked_at IS NULL
           AND (e.expires_at IS NULL OR e.expires_at > $2::timestamptz)
           AND lower(btrim(p.code)) = lower($4::text)
           AND lower(btrim(COALESCE(t.status, ''))) = $5::text
           AND COALESCE(t.is_demo, false) = false
           AND t.created_at <= $2::timestamptz
           AND t.created_at + interval '12 months' > $2::timestamptz
       )
  ), saved AS (
    SELECT * FROM scoped_clients
     WHERE state IS NOT NULL AND state NOT IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb)
       AND NOT (jsonb_typeof(state) = 'object' AND NOT (state ? 'version')
         AND state - 'businesses' - 'stepProgress' = '{}'::jsonb
         AND COALESCE(state->'businesses', '[]'::jsonb) = '[]'::jsonb
         AND COALESCE(state->'stepProgress', '[]'::jsonb) = '[]'::jsonb)
  ), plans AS (
    SELECT s.id AS client_id, s.org_id, p.plan
      FROM saved s CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.state->'businesses') = 'array' THEN s.state->'businesses' ELSE '[]'::jsonb END
      ) AS p(plan)
  ), evidence AS (
    SELECT p.client_id, p.org_id, p.plan->>'id' AS plan_id, p.plan->>'entityId' AS entity_id,
      e.key AS evidence_kind, e.value->>'documentId' AS document_id
      FROM plans p CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(p.plan->'evidence') = 'object' THEN p.plan->'evidence' ELSE '{}'::jsonb END
      ) e
     WHERE e.key IN ('formation', 'ein') AND e.value->>'documentId' IS NOT NULL
  )
  SELECT count(*)::int AS n FROM saved s
   WHERE jsonb_typeof(s.state) IS DISTINCT FROM 'object'
      OR s.state->>'version' IS DISTINCT FROM '1'
      OR COALESCE(s.state->>'targetBusinessCount', '') NOT IN ('3', '4')
      OR CASE WHEN jsonb_typeof(s.state->'businesses') = 'array'
           THEN jsonb_array_length(s.state->'businesses') > 4 ELSE true END
      OR jsonb_typeof(s.state->'stepProgress') IS DISTINCT FROM 'array'
      OR EXISTS (
        SELECT 1 FROM plans p WHERE p.client_id = s.id AND p.org_id = s.org_id
          AND (jsonb_typeof(p.plan) IS DISTINCT FROM 'object'
            OR COALESCE(p.plan->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            OR COALESCE(p.plan->>'formationStatus', '') NOT IN ('planned', 'reported_formed'))
      )
      OR EXISTS (
        SELECT 1 FROM evidence e WHERE e.client_id = s.id AND e.org_id = s.org_id
          AND (NOT EXISTS (
            SELECT 1 FROM documents d LEFT JOIN document_vault_reviews r
              ON r.document_id = d.id AND r.org_id = d.org_id AND r.client_id = d.client_id
             WHERE d.org_id = e.org_id AND d.client_id = e.client_id AND d.id::text = e.document_id
               AND d.kind = 'client_upload'
               AND d.subtype = CASE e.evidence_kind WHEN 'formation' THEN 'articles_of_organization' ELSE 'ein_letter' END
               AND (COALESCE(NULLIF(d.metadata->>'entity_id', ''), r.entity_id::text) IS NULL
                 OR COALESCE(NULLIF(d.metadata->>'entity_id', ''), r.entity_id::text) = e.entity_id)
          ) OR EXISTS (
            SELECT 1 FROM evidence other WHERE other.org_id = e.org_id AND other.client_id = e.client_id
              AND other.document_id = e.document_id AND other.plan_id IS DISTINCT FROM e.plan_id
          ))
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(s.state->'stepProgress') = 'array' THEN s.state->'stepProgress' ELSE '[]'::jsonb END
        ) AS progress(step)
        WHERE jsonb_typeof(step) IS DISTINCT FROM 'object'
          OR COALESCE(step->>'status', '') NOT IN ('not_started', 'in_progress', 'reported_complete', 'blocked')
          OR COALESCE(step->>'verification', 'client_reported') <> 'client_reported'
          OR (step->>'businessPlanId' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM plans p WHERE p.org_id = s.org_id AND p.client_id = s.id
              AND p.plan->>'id' = step->>'businessPlanId'
          ))
      )
`;

const TRIP = "Recon (AG-07) is the one tripwire. Do not auto-fix from this pulse. Do not send to clients.";
const ADVISOR_FIX = `Open the existing blueprint-csm-assignment owner work and clear or fix the broken staff link through the staff flow. No staff person is needed; the AI coaches and team CSM queue cover the client. ${TRIP}`;
const DELIVERY_FIX = `Open the blueprint-monthly-delivery owner task and finish the plan and letters from its saved credit result. Do not request another paid credit pull. ${TRIP}`;
const COACH_CALL_FIX = `Open blueprint-coach-call advisor work and reconcile the saved call receipt with Bland and outbound_calls. Do not redial an uncertain provider result. ${TRIP}`;
const PREPARATION_FIX = `Review the saved Blueprint plan through its authenticated workflow. Repair malformed state or the missing/wrong-client evidence link; keep reported work separate from reviewed proof. ${TRIP}`;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export async function gapChecks(ctx = {}) {
  const run = typeof ctx.scope === "function" ? (fn) => ctx.scope(fn)
    : ctx.db?.query ? (fn) => fn(ctx.db) : null;
  const orgId = typeof ctx.orgId === "string" ? ctx.orgId.trim() : null;
  const now = ctx.now == null ? new Date() : new Date(ctx.now);
  const definitions = [
    [CHECK_IDS[0], REAL_ADVISOR_SQL,
      [orgId, Number.isFinite(now.getTime()) ? now.toISOString() : null, TEST_CLIENT_EMAIL_RE,
        OFFERS.UWIQ_DELIVERABLES.productCode, PAID_TRANSACTION_STATUS],
      "active paid Blueprint clients linked to a demo, disabled or other-company staff person", ADVISOR_FIX],
    [CHECK_IDS[1], MONTHLY_DELIVERY_SQL,
      [orgId, "blueprint-monthly-delivery", TEST_CLIENT_EMAIL_RE],
      "open Blueprint monthly-delivery exceptions", DELIVERY_FIX],
    [CHECK_IDS[2], COACH_CALL_DELIVERY_SQL,
      [orgId, Number.isFinite(now.getTime()) ? now.toISOString() : null, TEST_CLIENT_EMAIL_RE],
      "Blueprint coach-call delivery exceptions or unresolved receipts", COACH_CALL_FIX],
    [CHECK_IDS[3], PREPARATION_EVIDENCE_SQL,
      [orgId, Number.isFinite(now.getTime()) ? now.toISOString() : null, TEST_CLIENT_EMAIL_RE,
        OFFERS.UWIQ_DELIVERABLES.productCode, PAID_TRANSACTION_STATUS],
      "active Blueprint clients with malformed preparation state or invalid linked evidence", PREPARATION_FIX]
  ];
  const out = [];
  for (const [id, sql, params, description, fix] of definitions) {
    if (!run || !orgId) {
      out.push(row(id, "skip", "No scoped database; Blueprint delivery was not checked"));
      continue;
    }
    try {
      if (!Number.isFinite(now.getTime())) throw new Error("Invalid check time");
      const result = await run((db) => db.query(sql, params));
      const raw = result?.rows?.[0]?.n;
      const n = typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw)) ? Number(raw) : NaN;
      if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid check count");
      out.push(row(id, n ? "FAIL" : "PASS", `${n} ${description}`, n ? fix : null));
    } catch {
      // Database error messages may contain customer values. Keep them out of
      // the pulse; an unreadable state is red, never an invented zero.
      out.push(row(id, "FAIL", "Blueprint delivery state could not be read", fix));
    }
  }
  return out;
}
