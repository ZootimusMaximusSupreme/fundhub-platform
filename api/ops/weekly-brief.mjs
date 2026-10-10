// POST /api/ops/weekly-brief — generate this week's ops brief and file it
// into Company Brain, where it becomes askable through the same chat screen
// Chris already uses (public/app/company-brain.html).
//
// WHY A REPO FILE IS NOT PART OF THIS. A Netlify function has no persistent
// filesystem and no git access at runtime — it cannot write to ops/
// the way this session can. Company Brain IS the delivery mechanism: the
// brief lands there, owner-tier, and Chris asks for it the same way he
// would ask any other question. There is nothing else to build for "where
// does he read it" — the screen already exists.
//
// MANUAL TRIGGER FOR NOW, ON PURPOSE. CLAUDE.md 3c: marketing/ops tooling
// this session builds runs from a person asking, not a schedule this
// session invents blind. Chris said "briefs every week" — the cadence is
// his call, not a cron this file should assume. Wiring this to a weekly
// Inngest job (src/workflows/index.mjs already has the pattern) is a
// five-minute follow-up once he says when he wants it to fire.
//
// Superseded by docs/specs/marketing-machine-2026-10-04.md (owner-approved 2026-10-05): spec v3 §2 item 1 replaces the chat-only §3c cited above (the marketing machine runs on a schedule and on command, and saves to the repo through a GitHub token limited to the marketing folders); this file's code is unchanged and the brief still runs only when asked.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { generateWeeklyBrief } from "../../src/ops/weekly-brief.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!orgId) return res.status(403).json({ ok: false, error: "forbidden" });

  // Default window: the 7 days ending now. A caller may pass an explicit
  // to= (ISO date) to regenerate an older week — the source key is derived
  // from `to`, so re-running the same week updates one document rather than
  // creating a new one each time.
  let to = new Date();
  if (req.body?.to) {
    const parsed = new Date(String(req.body.to));
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ ok: false, error: "to must be an ISO date" });
    }
    to = parsed;
  }
  const from = new Date(to.getTime() - 7 * DAY_MS);

  try {
    const result = await generateWeeklyBrief(database, { orgId, from, to });
    if (!result.ok) {
      return res.status(500).json({ ok: false, error: result.reason || "brief_generation_failed" });
    }
    return res.status(200).json({
      ok: true,
      sourceKey: result.sourceKey,
      modelUsed: result.modelUsed,
      chunkCount: result.ingestion?.chunkCount ?? 0,
      brief: result.brief
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: safeError(e) });
  }
}
