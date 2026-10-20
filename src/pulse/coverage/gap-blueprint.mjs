// Blueprint delivery exceptions for the existing deep/hourly pulse. Report
// counts only: no customer identity, provider call, send or automatic repair.
import { OFFERS } from "../../config/offers.mjs";
import { PAID_TRANSACTION_STATUS } from "../../entitlements/entitlements.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";

export const CHECK_IDS = Object.freeze([
  "blueprint:real-advisor",
  "blueprint:monthly-delivery",
  "blueprint:coach-call-delivery"
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

const TRIP = "Recon (AG-07) is the one tripwire. Do not auto-fix from this pulse. Do not send to clients.";
const ADVISOR_FIX = `Open the existing blueprint-csm-assignment owner work and clear or fix the broken staff link through the staff flow. No staff person is needed; the AI coaches and team CSM queue cover the client. ${TRIP}`;
const DELIVERY_FIX = `Open the blueprint-monthly-delivery owner task and finish the plan and letters from its saved credit result. Do not request another paid credit pull. ${TRIP}`;
const COACH_CALL_FIX = `Open blueprint-coach-call advisor work and reconcile the saved call receipt with Bland and outbound_calls. Do not redial an uncertain provider result. ${TRIP}`;

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
      "Blueprint coach-call delivery exceptions or unresolved receipts", COACH_CALL_FIX]
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
