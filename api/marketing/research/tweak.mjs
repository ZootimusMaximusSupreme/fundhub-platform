// /api/marketing/research/tweak — Tweak a deep research report (J20): one line, such as
// "go deeper on bank overlays", starts a short re-run (a Quick look) of the same question
// that goes deeper on that line. The first report stays as it is.
//
// Route key "marketing/research/tweak". Design docs/specs/command-center-design-2026-10-05.md
// §3.2 item 5 and "Endpoints"; contract docs/specs/marketing-machine-api.md §6.10. Unit X2.
//
//   POST {id, note, request_id} → 202 {ok, started, already_running, job, poll}
//     400 invalid (bad id, empty note, run still going) · 404 not this company's run
//     400 cap_reached (the month cap is used) · 503 no_model | not_ready
//
// One research run in flight per company: when one is already running, that run comes back
// with already_running true and nothing new starts.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import { withRequest, readBody, checkRequestId, sendKnownError, hasCompany, InvalidError } from "../../../src/marketing/http.mjs";
import { getOrCreateSettings } from "../../../src/marketing/settings-store.mjs";
import { monthUsedUsd } from "../../../src/marketing/research/usage.mjs";
import {
  tweakResearch, researchJobView, researchNotReady, hasModelKey, monthState, monthCapSentence, NO_MODEL_SENTENCE, Refusal
} from "../../../src/marketing/research/store.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/research/tweak";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to tweak a report." });
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
    if (typeof body.note !== "string" || !body.note.trim()) throw new InvalidError("note", "Type one line: what should it look at more closely?");
    if (!hasModelKey(env)) return res.status(503).json({ error: "no_model", message: NO_MODEL_SENTENCE });
    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const settings = await getOrCreateSettings(tx, orgId);
      const m = monthState(settings, await monthUsedUsd(tx, orgId));
      if (m.capped) throw new Refusal(400, { error: "cap_reached", message: monthCapSentence(m.month_cap_usd) });
      const { job, already_running } = await tweakResearch(tx, { orgId, id: String(body.id), note: body.note, staffId: staff.id ?? null });
      return { status: 202, body: { ok: true, queued: true, started: !already_running, already_running, job: researchJobView(job), poll: `marketing/research?id=${job.id}` } };
    });
    if (answer.status === 202 && answer.body.started) await (deps.wake ?? wakeWorker)(env).catch(() => null);
    return res.status(answer.status).json(answer.body);
  } catch (err) {
    if (err instanceof Refusal) return res.status(err.status).json(err.body);
    if (sendKnownError(res, err)) return;
    if (researchNotReady(err)) {
      return res.status(503).json({ error: "not_ready", message: "Research is built, but its database change is not live yet. It turns on with the next ship." });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
