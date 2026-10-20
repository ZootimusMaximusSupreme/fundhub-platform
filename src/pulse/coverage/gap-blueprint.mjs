// Blueprint delivery exceptions for the existing deep/hourly pulse. Report
// counts only: no customer identity, provider call, send or automatic repair.
import { OFFERS } from "../../config/offers.mjs";
import { PAID_TRANSACTION_STATUS } from "../../entitlements/entitlements.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";

export const CHECK_IDS = Object.freeze([
  "blueprint:real-advisor",
  "blueprint:monthly-delivery"
]);

// Same real-client exclusions as the existing consent and portal checks.
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

const TRIP = "Recon (AG-07) is the one tripwire. Do not auto-fix from this pulse. Do not send to clients.";
const ADVISOR_FIX = `Open the existing blueprint-csm-assignment owner work and assign a real active advisor through the staff flow. ${TRIP}`;
const DELIVERY_FIX = `Open the blueprint-monthly-delivery owner task and finish the plan and letters from its saved credit result. Do not request another paid credit pull. ${TRIP}`;

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
      "active paid Blueprint clients without a real assigned advisor", ADVISOR_FIX],
    [CHECK_IDS[1], MONTHLY_DELIVERY_SQL,
      [orgId, "blueprint-monthly-delivery", TEST_CLIENT_EMAIL_RE],
      "open Blueprint monthly-delivery exceptions", DELIVERY_FIX]
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
