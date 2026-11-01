// GET /api/dashboard/client?id=<uuid>
// Read-only closer dashboard — full detail for one client.
// Returns the client row + related transactions[], crs_results[], messages[], tasks[].
// No writes. SELECT only. ESM. Mirrors api/health.mjs style.
import { db } from "../../src/db.mjs";
import { redact, isUuid, requireRole, ROLE_SETS, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";
import { resolvePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { AUTH_UNAVAILABLE } from "../../src/http/middleware/requireAuth.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { requireSessionOrg } from "../../src/http/session-org.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  readClientStepRows,
  readActiveInquiryCase,
  workOutClientStep
} from "../../src/fulfillment/client-step.mjs";

/* The step this page paints is worked out in src/fulfillment/client-step.mjs,
   the ONE place the saved step (custom_fields.employee_next_action) is also
   worked out from — hole 12, 2026-09-18. The reads it needs and the work-out
   itself moved there; this handler calls them and paints the answer. */

export default async function handler(req, res) {
  // A signed-in client (or any non-staff principal) is refused here. Do this
  // before requireDashboardAccess: that gate only sees staff tokens, so an
  // account token used to look unsigned-in (401). No-token callers still fall
  // through so the DASHBOARD_SECRET header fallback keeps working.
  const principal = await resolvePrincipal(req, { db });
  if (principal === AUTH_UNAVAILABLE) {
    return res.status(503).json({ ok: false, error: "auth_unavailable", db: "down" });
  }
  if (principal && principal.kind !== "staff") {
    return res.status(403).json({
      ok: false,
      error: "forbidden",
      message: "this endpoint serves staff"
    });
  }

  // Staff session first; the DASHBOARD_SECRET gate stays as the fallback until
  // cutover, so existing links keep working while staff accounts roll out.
  const staff = await requireDashboardAccess(req, res, { db });
  if (!staff) return;
  /* Same gap as api/dashboard/clients.mjs, and worse here: this response carries
     phone, message bodies, and the consent / do-not-contact flags for a named
     person. A session alone was enough, so role='partner' — an external
     white-label operator — could read all of it. ROLE_SETS.STAFF excludes
     'partner' and denies unknown roles by default.
     `true` is the DASHBOARD_SECRET fallback caller, which has no role to check. */
  if (staff !== true && !requireRole(res, staff, ROLE_SETS.STAFF)) return;

  // Org from the session ONLY. A shared-secret caller has no org — refuse rather
  // than open every company's client book. Confirmed P0 (2026-08-04): this
  // endpoint used to SELECT FROM clients WHERE id = $1 with no org filter, so
  // any staff who knew a UUID could read another company's file.
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  const { id } = req.query ?? {};
  if (!id) return res.status(400).json({ ok: false, error: "?id= required" });
  // A malformed id is a bad request, not a server fault. Without this the seven
  // queries below all fail on SQLSTATE 22P02 and the screen was told the whole
  // backend was unreachable.
  if (!isUuid(id)) return res.status(400).json({ ok: false, error: "invalid_id" });

  // 404 (not 403) for cross-org — same oracle defence as requireClientInOrg.
  if (!await requireClientInOrg(res, db, staff, id)) return;

  try {
    /* The six reads the step is worked out from come from the shared piece;
       only the two this page paints and the step never reads stay here. */
    const [rows, txRes, msgRes] = await Promise.all([
      readClientStepRows(db, { orgId, clientId: id }),
      db.query(
        `SELECT id, product_name, amount_paid, status, provider, provider_ref, created_at
         FROM transactions WHERE client_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
        [id, orgId]
      ),
      db.query(
        `SELECT id, direction, channel, template_key, rendered_body,
                provider, status, created_at
         FROM messages WHERE client_id = $1 AND org_id = $2
         ORDER BY created_at DESC LIMIT 100`,
        [id, orgId]
      )
    ]);

    if (!rows.client || rows.client.custom_fields?.crm_archived_at) {
      return res.status(404).json({ ok: false, error: "client not found" });
    }

    const client = rows.client;
    const inquiry_removal_case = await readActiveInquiryCase(db, { orgId, clientId: id });

    // The step, the safe blocker labels and the detail extras — one work-out,
    // shared with the saved step. See src/fulfillment/client-step.mjs.
    const { extras, open_blockers, fulfillment } = await workOutClientStep(db, {
      orgId,
      clientId: id,
      rows,
      inquiryCase: inquiry_removal_case
    });

    res.status(200).json(redact({
      ok: true,
      client,
      transactions:  txRes.rows,
      crs_results:   rows.crsResults,
      messages:      msgRes.rows,
      tasks:         rows.tasks,
      funding_rounds: rows.fundingRounds,
      invoices:      rows.invoices,
      inquiry_removal_case,
      // Derived, never stored — see src/http/client-detail.mjs for why each of
      // these explains rather than recomputes.
      ...extras,
      /* AFTER ...extras on purpose — this replaces the raw open_blockers that
         spread carries. Same rows, same ids, same details; only a pull-credit
         label on a client without established permission is rewritten, and the
         words on the record survive on `recorded_label`. See the Gate A block
         in src/fulfillment/client-step.mjs. */
      open_blockers,
      /* Derived, never stored. Absent entirely when the derivation could not
         run — see src/fulfillment/client-step.mjs. `next_action_degraded` true means one signal
         could not be read, so the screen should fall back to today's display
         rather than trust a partial answer. */
      ...(fulfillment ? {
        next_action:          fulfillment.next_action,
        active_blockers:      fulfillment.active_blockers,
        funding_round:        fulfillment.funding_round,
        next_action_degraded: fulfillment.degraded
      } : {})
    }));
  } catch (err) {
    if (CLIENT_DATA_ERRORS.has(err && err.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    // err.message can quote the DSN on a connection failure — scrub it the same
    // way health.mjs does rather than handing a host and password to the client.
    res.status(500).json({ ok: false, error: safeError(err) });
  }
}
