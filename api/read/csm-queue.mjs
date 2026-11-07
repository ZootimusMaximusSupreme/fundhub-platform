// GET /api/read/csm-queue — the CSM's day, in one call.
//
// "Who do I talk to today, do they owe us anything, and what do they not
// already have." Those three questions were three screens and a guess.
//
// COMPLIANCE REVIEW REQUIRED: this read surfaces an open balance next to a
// client's name so a person can ask for it on a call. It writes nothing,
// charges nothing, and takes no payment.
//
// READ-ONLY and org-scoped. Every clause carries org_id — the CSM sees the
// clients of their own company and no others.

//
// ?view=tracking — WHERE EACH CLIENT IS (unit N, owner call 2026-11-07).
// The same door, a second answer: each client's current step and days on it,
// late payments, bank seasoning and whether they can apply yet, with the
// clients falling behind first. ?view=tracking&client_id=<uuid> is one client,
// with UnderwriteIQ read and the nudge words. Owner, admin and CSM only. Read
// only — the nudge is sent by the CSM through POST /api/messages. The rules
// live in src/csm/client-tracking.mjs; this file gates.

import { db } from "../../src/db.mjs";
import { requireAuth as defaultRequireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, page, pageParams, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { toCents, fromCents } from "../../src/commissions/money.mjs";

/* Open tasks belonging to the CSM role, each with the client's name, their
   open balance, and what they already own.

   BALANCE COMES FROM v_invoice_aging, NOT FROM invoices. The view is the
   thing that already knows what is genuinely still owed after payments,
   refunds and reversals (db/migrations/031). Summing invoices here would be a
   second opinion on a number the database already answers, and a second
   opinion about money is a bug waiting for someone to act on it.

   NULL SURVIVES. A client with no invoices has balance_due_cents null, which
   means "nothing is owed" only after you have looked. It is not defaulted to
   zero — CLAUDE.md §12: an unknown amount must never render as a known one. */
const QUEUE_SQL = `
  WITH owed AS (
    SELECT client_id,
           SUM(open_balance) AS balance_amount,
           COUNT(*)          AS open_invoices,
           MAX(days_overdue) AS worst_days_overdue
      FROM v_invoice_aging
     WHERE org_id = $1
       AND open_balance > 0
     GROUP BY client_id
  ),
  owns AS (
    SELECT client_id,
           array_agg(entitlement_code ORDER BY sort_order, entitlement_code) AS codes
      FROM v_client_entitlements
     WHERE org_id = $1
       AND active
     GROUP BY client_id
  )
  SELECT t.id            AS task_id,
         t.title,
         t.due_at,
         t.source_workflow,
         t.meeting_url,
         /* WHO HAS TAKEN THIS ONE. Without it the queue screen can only show a
            claim for as long as the tab stays open, so a CSM who reloads sees
            Claim again on work they already took and the claim looks like it
            never stuck (live walk 2026-09-17, GAP 37). The claim itself is
            PATCH /api/tasks and has always persisted; this is the read that
            proves it. Null means nobody has taken it — it stays on the role
            queue for whoever gets there first. */
         t.assignee_staff_id,
         c.assigned_csm_staff_id,
         NULLIF(btrim(s.name), '') AS assigned_csm_name,
         t.client_id,
         /* There is no clients.name — first_name / last_name, either of which
            can be null. NULLIF on the trimmed join keeps an empty string from
            rendering as a name; the screen shows the client_code instead. */
         NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), '') AS client_name,
         c.client_code,
         o.balance_amount,
         o.open_invoices,
         /* HOW LATE THE BILL IS — NOT HOW LATE THE CALL IS. This is
            MAX(days_overdue) out of v_invoice_aging, so it answers "the oldest
            unpaid invoice is N days past its due date". The call's own
            lateness is t.due_at against now, and the two are unrelated: a
            client can owe a 30-day-old bill and not be due a call until next
            month. It is carried to the browser as bill_days_overdue so the
            screen cannot print it beside the call as if it were the call. */
         o.worst_days_overdue,
         COALESCE(w.codes, ARRAY[]::text[]) AS owned_codes
    FROM tasks t
    JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
    LEFT JOIN staff s ON s.id = c.assigned_csm_staff_id AND s.org_id = c.org_id
    LEFT JOIN owed o ON o.client_id = t.client_id
    LEFT JOIN owns w ON w.client_id = t.client_id
   WHERE t.org_id = $1
     AND t.assignee_role = 'csm'
     AND t.done = false
     AND c.custom_fields->>'crm_archived_at' IS NULL
   ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC
   /* $2 + 1, not $2. page() derives hasMore by seeing one row MORE than
      asked for and slicing it off, so a query that returns exactly the limit
      reports hasMore:false forever and the screen's next control never
      appears. read-api.mjs says so; it is easy to miss. */
   LIMIT $2 + 1 OFFSET $3
`;

export function presentRow(r) {
  /* v_invoice_aging.open_balance is numeric DOLLARS (500.00), not cents —
     measured, after this shipped as cents and the test caught it. Convert
     through money.mjs rather than multiplying by 100 here, because that is
     where the rounding rule for this codebase lives. NULL survives: a client
     with no invoice is unknown, not zero. */
  const cents = r.balance_amount === null || r.balance_amount === undefined
    ? null
    : toCents(r.balance_amount);
  return {
    task_id: r.task_id,
    title: r.title,
    due_at: r.due_at,
    source_workflow: r.source_workflow,
    meeting_url: r.meeting_url || null,
    client_id: r.client_id,
    client_name: r.client_name || null,
    client_code: r.client_code || null,
    assignee_staff_id: r.assignee_staff_id || null,
    assigned_csm_staff_id: r.assigned_csm_staff_id || null,
    assigned_csm_name: r.assigned_csm_name || null,
    /* Both shapes on purpose: cents for anything that does arithmetic,
       the formatted string for the screen. fromCents returns a string. */
    balance_due_cents: cents,
    balance_due: cents === null ? null : fromCents(cents),
    open_invoices: r.open_invoices === null || r.open_invoices === undefined
      ? 0 : Number(r.open_invoices),
    /* The BILL's lateness. Named for what it is — see the note in the query.
       NULL survives: no invoice means nobody has measured this. */
    bill_days_overdue: r.worst_days_overdue === null || r.worst_days_overdue === undefined
      ? null : Number(r.worst_days_overdue),
    owned_codes: Array.isArray(r.owned_codes) ? r.owned_codes : []
  };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const requireAuth = deps.requireAuth ?? defaultRequireAuth;

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  if (req.query && req.query.view !== undefined) {
    return tracking(req, res, { database, staff, deps });
  }

  const { limit, offset } = pageParams(req.query || {});

  try {
    const { rows } = await database.query(QUEUE_SQL, [orgId, limit, offset]);
    return res.status(200).json({ ok: true, ...page(rows.map(presentRow), { limit, offset }) });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}

/* The tracking view. The role gate is narrower than the queue's: the CSM desk
   roles only (TRACKING_ROLES), checked before any data is read. A client in
   another company is 404, not 403, the same as every one-client read. */
async function tracking(req, res, { database, staff, deps }) {
  const q = req.query || {};
  if (q.view !== "tracking") {
    return res.status(400).json({ ok: false, error: "invalid_parameter", message: "view must be tracking" });
  }
  const mod = deps.tracking || await import("../../src/csm/client-tracking.mjs");
  if (!requireRole(res, staff, mod.TRACKING_ROLES)) return;
  const now = typeof deps.now === "function" ? deps.now() : new Date();

  try {
    if (q.client_id !== undefined) {
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "invalid_parameter", message: "client_id must be a uuid" });
      }
      const one = await mod.readClientPosition(database, {
        orgId: staff.org_id,
        clientId: String(q.client_id).trim(),
        now,
        fundabilityFn: deps.fundability,
        readRelationshipsFn: deps.readRelationships,
        listPlansFn: deps.listPlans
      });
      if (!one) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(one);
    }
    const list = await mod.readTrackingList(database, {
      orgId: staff.org_id,
      staffId: staff.id || null,
      query: q,
      now,
      fundabilityFn: deps.fundability
    });
    return res.status(200).json(list);
  } catch (e) {
    if (e && e.code === "BAD_TRACKING_INPUT") {
      return res.status(400).json({ ok: false, error: "invalid_parameter", message: e.message });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}
