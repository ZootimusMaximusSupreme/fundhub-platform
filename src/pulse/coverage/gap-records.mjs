// Customer records and the settings behind them. Report only. Read-only SQL.
//
// Four questions a client, or a client's bureau call, would feel:
//
//   privacy:erasure           "I asked to be erased and nothing happened."
//   privacy:pii-company       "Someone from another company opened my identity."
//   bureau-config:complete    "The AI caller has no number or menu for a bureau."
//   consent:recording-and-ads "Our recording or our ad has no permission behind it."
//
// Each is one SELECT. Nothing is written. A read that fails is a skip, never a PASS.
//
// ERASURE. Both erasure paths (src/privacy/erasure.mjs eraseClient and
// src/banking/revoke.mjs revokeBankLogin) write one erasure_requests row as
// 'completed', inside the same transaction as the removal. So 'requested' and
// 'failed' rows should not exist today. They are the shape a future queued or
// half-done path would leave, and the table allows them (migration 102). This
// check goes red the day one is left behind. A request that a later 'completed'
// row for the same person (and the same bank login) replaced is not red.
// The window for a 'requested' row is ERASURE_WINDOW_MS (below). No written
// window exists in the repo, so this is the pulse's own line: one morning report.
//
// PII COMPANY. api/pii.mjs checks the client id and the staff role, and no
// company (board leftover card, 2026-10-10). A reveal writes pii_access_log with
// the CLIENT's company and the staff member's id (accessed_by). So a row whose
// accessed_by is a staff id from a different company is a reveal across
// companies. Only reveals are logged (a masked read is not), so this sees
// reveals only. A system label in accessed_by (src/inquiry-ops/bureau-call.mjs
// writes "inquiry-bureau-call") has no staff row and cannot be judged; the PASS
// line says how many were that.
//
// BUREAU CONFIG. The AI caller dials three bureaus (BUREAU_CONFIGS in
// src/inquiry-ops/bureau-call.mjs: EX, EQ, TU). The table that holds each
// bureau's number and phone-menu path ships empty on purpose (migration 140,
// "do not invent phone numbers"). Measured 2026-10-10: nothing that places the
// call reads service_number or menu_path from this table (the call builders in
// vendor/inquiry-remover carry their own). Owner answer B7 (2026-10-20): the
// numbers and menu steps are already saved, so the check reads them where they
// really live: the caller's own scripts (src/inquiry-ops/bureau-dial-plan.mjs,
// the number from the Netlify *_DISPUTE_NUMBER setting or the script, the menu
// from the script's IVR steps). A bureau passes when the script OR the table
// gives it a usable number and a menu. Red when neither does.
//
// CONSENT. call_recording and marketing_use (migration 291). Two readings, one
// row:
//   a recording saved (customer_insights.recording_url) for a client who had no
//     live call_recording consent when the row was saved;
//   a recording cleared for ads (marketing_cleared) whose client no longer holds
//     a live marketing_use consent. v_insight_ad_eligible already hides it from
//     the ad picker; the red is the reminder that a human cut or cleared it and
//     must now pull it.
// The live-consent rule is the one in src/consent/index.mjs (CONSENT_VALID_SQL).

// ONE JUDGE, TWO CLOCKS (2026-10-20). The SQL and the judges live in
// src/pulse/beats/lib/records-truth.mjs, so this morning lane and the hourly beat customer-records
// run the same code. This lane hands in the dial plan it reads from the caller's own scripts.

import { bureauDialPlan } from "../../inquiry-ops/bureau-dial-plan.mjs";
import { recordsChecks } from "../beats/lib/records-truth.mjs";

export {
  ERASURE_WINDOW_MS,
  PII_LOOKBACK_DAYS,
  PII_LOOKBACK_MS,
  DIALED_BUREAUS,
  CHECK_IDS,
  ERASURE_SQL,
  PII_COMPANY_SQL,
  BUREAU_SQL,
  CONSENT_SQL,
  SQL,
  assertRead,
  judgeErasure,
  judgePiiCompany,
  judgeBureauConfig,
  judgeRecordingConsent
} from "../beats/lib/records-truth.mjs";

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }]
 * ctx: { db } or { scope }, optional { now, orgId, demoOn, dialPlan }. SELECT only.
 */
export async function gapChecks(ctx = {}) {
  // What the caller's own scripts dial (owner answer B7). Tests hand in their own plan.
  const dialPlan = Array.isArray(ctx.dialPlan) ? ctx.dialPlan : bureauDialPlan();
  return recordsChecks(ctx, { dialPlan });
}
