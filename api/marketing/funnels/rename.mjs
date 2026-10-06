// POST /api/marketing/funnels/rename — give a draft funnel the address Chris
// types (build unit X4; owner order 2026-10-05: "or allow me to name them in
// the dash"). Contract: docs/specs/marketing-machine-api.md.
//
//   {request_id, id, path} → 200 {funnel}
//
// Refused (400, field named) when the address is reserved, is already a page on
// the live ClickFunnels workspace (a read; nothing there changes), is used by
// another of our funnels, or when this funnel is live: a live page and its
// address never change. The tag does not change with the address. Built pages
// are drawn again from their saved words so the links between them follow the
// new address; no model is called.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING).

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany
} from "../../../src/marketing/http.mjs";
import { funnelView } from "../../../src/marketing/settings-store.mjs";
import { renameFunnel } from "../../../src/marketing/funnel-store.mjs";
import { renderPage } from "../../../src/marketing/funnel-pages.mjs";
import {
  validateRename, liveTakenPaths, sendLiveUnreadable, knownConflict
} from "../../../src/marketing/funnel-routes.mjs";

export const ROUTE = "marketing/funnels/rename";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to rename a funnel." });
  }

  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    const { id, base } = validateRename(body);

    const live = await (deps.liveTaken ?? liveTakenPaths)({ env });
    if (!live.ok) return sendLiveUnreadable(res, live.error, "Nothing was renamed.");

    const rerender = (page, funnel, paths) => (page.page_copy
      ? renderPage({ funnel, page, copy: { [page.role]: page.page_copy }, paths, env })
      : null);

    try {
      const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
        const moved = await renameFunnel(tx, { orgId, id, base, liveTaken: live.taken, rerender });
        return { funnel: funnelView({ ...moved.funnel, pages: moved.pages }) };
      });
      return res.status(200).json(answer);
    } catch (err) {
      const known = knownConflict(err);
      if (known) throw known;
      throw err;
    }
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "The funnel builder")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
