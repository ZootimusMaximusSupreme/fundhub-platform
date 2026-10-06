// /api/marketing/research/approve — Approve a finished deep research report (J20).
//
// Route key "marketing/research/approve". Design docs/specs/command-center-design-2026-10-05.md
// §3.2 item 5 ("Approve (free)") and "Endpoints"; contract docs/specs/marketing-machine-api.md
// §6.10. Unit X2.
//
//   POST {id, request_id} → 200 {ok, job}
//     400 invalid (bad id, or the run is not finished) · 404 not this company's run
//     503 not_ready
//
// Free. Stores who approved and when (migration 429's approved_by / approved_at — a
// person's tap only) and saves the same report file again with status approved through the
// repo outbox. Approving twice changes nothing the second time.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import { withRequest, readBody, checkRequestId, sendKnownError, hasCompany, InvalidError } from "../../../src/marketing/http.mjs";
import { approveResearch, researchJobView, researchNotReady } from "../../../src/marketing/research/store.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/research/approve";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to approve a report." });
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
    if (!UUID.test(String(body.id || ""))) throw new InvalidError("id", "id must be a research run's id.");
    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const row = await approveResearch(tx, { orgId, id: String(body.id), staffId: staff.id ?? null });
      return { ok: true, job: researchJobView(row) };
    });
    await (deps.wake ?? wakeWorker)(env).catch(() => null);
    return res.status(200).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (researchNotReady(err)) {
      return res.status(503).json({ error: "not_ready", message: "Research is built, but its database change is not live yet. It turns on with the next ship." });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
