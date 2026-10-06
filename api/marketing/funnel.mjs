// GET /api/marketing/funnel?id= — one funnel, its pages with their words and
// HTML (the draft Chris reads before Push live), and its last build and push
// jobs (build unit X4). Contract: docs/specs/marketing-machine-api.md.
//
//   → 200 {funnel, pages:[{...page, copy, html}], jobs:[...], as_of}
//   → 404 not_found when the id is not one of this company's funnels
//
// A funnel mapped by hand in Settings answers too, with pages [] and jobs [].
// Reads only. Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING).

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import {
  staffRead, sendKnownError, sendNotReady, hasCompany, NotFoundError
} from "../../src/marketing/http.mjs";
import { funnelView } from "../../src/marketing/settings-store.mjs";
import { loadFunnel, funnelJobs, pageView } from "../../src/marketing/funnel-store.mjs";
import { funnelId } from "../../src/marketing/funnel-routes.mjs";

export const ROUTE = "marketing/funnel";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const now = deps.now ? deps.now() : new Date();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read a funnel." });
  }

  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const id = funnelId(req.query && req.query.id);
    const out = await staffRead(database, async (tx) => {
      const found = await loadFunnel(tx, orgId, id);
      if (!found) return null;
      const jobs = await funnelJobs(tx, orgId, id);
      return { ...found, jobs };
    });
    if (!out) throw new NotFoundError("That funnel was not found.");
    return res.status(200).json({
      funnel: funnelView({ ...out.funnel, pages: out.pages }),
      pages: out.pages.map((p) => pageView(p, { withHtml: true })),
      jobs: out.jobs,
      as_of: now.toISOString()
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "The funnel builder")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
