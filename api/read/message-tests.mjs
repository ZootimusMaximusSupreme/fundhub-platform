// GET /api/read/message-tests — how the A/B message tests are doing (owner GO 2026-10-31,
// board ops/workflows/backend-selling-lanes-2026-10-30.md section 6e).
//
// The Message tests card on the Marketing overview page reads this. For each test in
// src/messaging/experiments.mjs: how many people got version A and version B, how many of
// each did the goal within the test's window, and a plain-English verdict
// (src/messaging/experiment-report.mjs). Read only: one SELECT, nothing written, nothing sent.
// It never switches a version.
//
// ROLE GATE — requireAuth, then a SEPARATE requireRole(ROLE_SETS.MARKETING). requireAuth ignores a
// `roles` option (CLAUDE.md §12), so the role check is its own line. MARKETING is owner and admin,
// the same people the Marketing menu shows to. The company is the session's, never one from the
// query string. The answer carries counts only: no name, address or message text.
//
// messages, events, clients and message_templates do not use row-level security, so the read runs
// on the pool; the company is in the SQL.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { experimentReport } from "../../src/messaging/experiment-report.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const auth = deps.requireAuth ?? requireAuth;
  const now = deps.now ? deps.now() : new Date();

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });

  try {
    const tests = await experimentReport(database, { orgId: staff.org_id, now });
    return res.status(200).json({ ok: true, as_of: now.toISOString(), tests });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
