// GET /api/money/fundability[?client_id=<uuid>]
//
// The Fundability section of FinanceOS (/app/money-fundability.html): the
// fundability score now, the same file looked at 3, 6 and 12 months ahead, and
// each business read on its own. The rules live in src/finance/fundability.mjs
// (how the score is counted is written at the top of that file); this file
// gates and fetches. Read only. It never runs a pull and never writes.
//
// TWO CALLERS — the same gate as api/money/overview.mjs, line for line.
//
//   * A signed-in CLIENT (an account session) sees their own file and nothing
//     else. The client_id comes off the SESSION; a `client_id` in the query
//     string is never read on this branch.
//   * STAFF: a staff session + requireRole(ROLE_SETS.FINANCE_OS) + requireClientInOrg
//     on ?client_id=. The role check is its own call; requireAuth drops a `roles`
//     key (CLAUDE.md §12).
//
// A client in another org is 404, not 403.
//
// TWO MORE VIEWS (owner-set 2026-11-07, the Fundhub score and the look-ahead):
//
//   * ?view=lookahead[&months=N] — the Fundhub score now and at month N (1–24,
//     default 9) with the 3/6/9/12 quick picks, each point re-run through
//     UnderwriteIQ (src/finance/fundhub-lookahead.mjs). Client or staff, the
//     same gate as the plain read.
//   * ?view=plan[&months=N] — the same, plus the closer's dated roadmap and
//     closing line. STAFF ONLY: closers and CSMs (Chris: "a card ... for closers
//     and CSMs"), so the role set is FINANCE_OS plus csm for this view alone. A
//     client session asking for it is 403.
// Neither view ships the score's formula: only the number, the band and the
// top three reasons.
//
// `paths` (Finance OS wave 4, unit FUND): "Your funding paths" — fund it
// yourself, fund other people, Fundhub funds you — built by
// src/finance/funding-paths.mjs from this same payload plus the client's own
// referral, ready-to-fund and payment-plan rows. UnderwriteIQ is not run twice.
// A failed paths read is { ok: false } and the fundability answer still stands.
// It rides on the plain read only; the two views above do not carry it.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { fundability } from "../../src/finance/fundability.mjs";
import { fundhubLookahead, parseLookaheadMonth } from "../../src/finance/fundhub-lookahead.mjs";
import { fundingPaths } from "../../src/finance/funding-paths.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/** The plan view's roles: the FinanceOS staff set plus csm (owner-set 2026-11-07).
 *  Written out as a literal so scripts/journeys/extract.mjs can read who reaches
 *  this route; src/http/fundhub-lookahead-endpoint.test.mjs fails if it ever
 *  stops being ROLE_SETS.FINANCE_OS plus csm. */
export const PLAN_VIEW_ROLES = new Set(["owner", "admin", "sales_manager", "closer", "csm"]);
const VIEWS = new Set(["lookahead", "plan"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const build = deps.fundability || fundability;
  const lookahead = deps.lookahead || fundhubLookahead;
  const paths = deps.fundingPaths || fundingPaths;
  const clock = deps.now || (() => new Date());

  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return;

  const rawView = req.query && req.query.view;
  const view = rawView === undefined || rawView === null || rawView === "" ? null : String(rawView);
  if (view !== null && !VIEWS.has(view)) {
    return res.status(400).json({ ok: false, error: "view must be lookahead or plan" });
  }
  const months = parseLookaheadMonth(req.query && req.query.months);
  if (Number.isNaN(months)) {
    return res.status(400).json({ ok: false, error: "months must be a whole number from 1 to 24" });
  }

  let orgId;
  let clientId;

  if (principal.kind === "client") {
    /* PINNED TO SELF. Same block as api/money/overview.mjs. */
    clientId = principal.clientId || null;
    orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      return res.status(403).json({
        ok: false,
        error: "forbidden",
        message: "Your login is not attached to a client file."
      });
    }
    if (view === "plan") {
      return res.status(403).json({ ok: false, error: "forbidden", message: "This view is for staff." });
    }
  } else {
    const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
    if (!requireRole(res, staff, view === "plan" ? PLAN_VIEW_ROLES : ROLE_SETS.FINANCE_OS)) return;
    const qid = req.query && req.query.client_id;
    if (!isUuid(qid)) {
      return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    }
    clientId = String(qid).trim();
    if (!(await requireClientInOrg(res, database, staff, clientId))) return;
    orgId = staff.org_id;
  }

  try {
    const asOf = clock();
    const payload = view
      ? await lookahead(database, { orgId, clientId, asOf, view, ...(months === null ? {} : { months }) })
      : await build(database, { orgId, clientId, asOf });
    if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
    if (view) return res.status(200).json(payload);
    /* The plain read also carries the client-safe Fundhub score look-ahead
       (month 9 and the quick picks), so the Fundability section paints the
       score card from this one read. If the look-ahead fails, the section
       still loads; the card just stays away. */
    try {
      payload.fundhub_lookahead = await lookahead(database, { orgId, clientId, asOf, view: "lookahead" });
    } catch (e) {
      console.error("money/fundability: Fundhub score look-ahead failed", e && e.message ? e.message : e);
      payload.fundhub_lookahead = null;
    }
    let fundingWays;
    try {
      fundingWays = await paths(database, {
        orgId, clientId, fundability: payload, asOf, viewer: principal.kind === "client" ? "client" : "staff"
      });
    } catch {
      fundingWays = { ok: false };
    }
    return res.status(200).json({ ...payload, paths: fundingWays });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}
