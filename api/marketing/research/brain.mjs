// /api/marketing/research/brain — "Save to the brain": put a finished deep research report
// into Company Brain so the brain can answer from it (J20).
//
// Route key "marketing/research/brain". Design docs/specs/command-center-design-2026-10-05.md
// §3.2 item 5 ("Save to the brain (owner tier; disabled with 'The brain cannot save new pages
// right now: its embedding key has no credit.' when that is true)") and "Endpoints"; contract
// docs/specs/marketing-machine-api.md §6.10. Unit X2.
//
//   POST {id, request_id} → 200 {ok, brain_file_id, chunks, unchanged}
//     400 invalid (bad id, or the run is not finished) · 404 not this company's run
//     409 {error:'brain_unavailable', message}  the brain could not take the page
//
// Reuses src/company-brain/ingest-generated.mjs upsertGeneratedDocument (source type
// "deep-research", key = the run's id, access tier owner). The same report saved twice is
// skipped ("unchanged"), so a second tap never pays for embedding again. NO transaction is
// held across the embedding call (CLAUDE.md §12, spec §4 trap 3): the run is read first,
// then the brain write runs on its own.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import { staffRead, readBody, checkRequestId, sendKnownError, hasCompany, InvalidError } from "../../../src/marketing/http.mjs";
import { upsertGeneratedDocument } from "../../../src/company-brain/ingest-generated.mjs";
import { researchNotReady, DEEP_KIND } from "../../../src/marketing/research/store.mjs";

export const ROUTE = "marketing/research/brain";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The brain's refusal in plain words. */
export function brainSentence(reason) {
  const r = String(reason || "");
  if (/credit|quota|429|insufficient/i.test(r)) return "The brain cannot save new pages right now: its embedding key has no credit.";
  if (/key|401|not set|masked/i.test(r)) return "The brain cannot save new pages right now: its embedding key is not set.";
  return `The brain could not save this page: ${r.slice(0, 200) || "no reason given"}.`;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to save a report to the brain." });
  }
  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const body = readBody(req);
    checkRequestId(body.request_id);
    if (!UUID.test(String(body.id || ""))) throw new InvalidError("id", "id must be a research run's id.");
    const row = await staffRead(database, async (tx) => (await tx.query(
      `SELECT id, status, payload, result FROM marketing_jobs WHERE id = $1 AND org_id = $2 AND kind = '${DEEP_KIND}'`,
      [String(body.id), orgId]
    )).rows[0] || null);
    if (!row) return res.status(404).json({ error: "not_found", message: "No research run with that id." });
    const rep = row.result && row.result.report;
    if (row.status !== "done" || !rep || !rep.markdown) throw new InvalidError("id", "Only a finished report can be saved to the brain.");

    const save = deps.upsertGeneratedDocument ?? upsertGeneratedDocument;
    const out = await save(database, {
      orgId,
      sourceType: "deep-research",
      sourceKey: String(row.id),
      title: `Research: ${String((row.payload && row.payload.question) || "").slice(0, 160)}`,
      text: rep.markdown,
      accessTier: "owner",
      env
    });
    if (!out || !out.ok) {
      return res.status(409).json({ error: "brain_unavailable", message: brainSentence(out && out.reason) });
    }
    return res.status(200).json({ ok: true, brain_file_id: out.fileId, chunks: out.chunkCount || 0, unchanged: out.skipped === true });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (researchNotReady(err)) {
      return res.status(503).json({ error: "not_ready", message: "Research is built, but its database change is not live yet. It turns on with the next ship." });
    }
    if (dbDown(res, err)) return;
    throw err;
  }
}
