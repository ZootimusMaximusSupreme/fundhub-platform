// GET /api/marketing/costs — what each paid job cost last time, and the caps.
//
// Route key "marketing/costs" (netlify/functions/api.mjs ROUTES; the key is this file's
// path under api/). Design docs/specs/command-center-design-2026-10-05.md §3.1
// Endpoints and §5 rule 3: every cost line on the Command Center reads this. Unit X1.
//
//   GET → 200 {ok, as_of,
//              kinds:{offer, script, opening, quick_copy, brief, avatar, ad_research,
//                     copy, ad_strategy, funnel (unit GL),
//                     research, page_draft, proof_read, proof_check, testimonial_hook,
//                     testimonial_frames, testimonial_check},
//                 each null ("unknown, not measured yet") or {last_cost_usd,
//                 last_minutes, measured_at, last_searches, last_fetches, last_calls,
//                 unpriced_calls, job_id} (avatar also run_cap_usd),
//              month:{used_usd, cap_usd, unpriced_calls},
//              run_caps:{avatar, …}, limits:{avatar:{steps, max_searches, max_search_usd}},
//              submagic:null, avatar_line}
//   avatar_line is the sentence under "Build the avatar" (src/marketing/costs.mjs
//   avatarCostLine), so the page never builds its own cost words.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING) (requireAuth
// ignores roles, CLAUDE.md §12), then a company on the session. Reads only; the first
// read makes the settings row with its defaults, as GET marketing/settings does.

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { staffRead, sendNotReady, hasCompany } from "../../src/marketing/http.mjs";
import { getOrCreateSettings } from "../../src/marketing/settings-store.mjs";
import { readCosts, avatarCostLine } from "../../src/marketing/costs.mjs";

export const ROUTE = "marketing/costs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read the costs." });
  }

  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const body = await staffRead(database, async (tx) => {
      const settings = await getOrCreateSettings(tx, orgId);
      return readCosts(tx, { orgId, settings, now: deps.now ? deps.now() : new Date() });
    });
    return res.status(200).json({ ...body, avatar_line: avatarCostLine(body) });
  } catch (err) {
    if (sendNotReady(res, err, "The cost reader")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
