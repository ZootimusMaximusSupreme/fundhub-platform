// /api/pii — identity data, per the Item 2 visibility spec.
//
//   GET  ?client_id=<uuid>              → { ok, identity }  masked: ssn_last4 only
//   GET  ?client_id=<uuid>&history=1    → { ok, access }     who has revealed it
//   POST { client_id, action: "reveal", reason }  → { ok, ssn }   ACCESS-LOGGED
//        reason is REQUIRED — a reveal with no stated purpose is a 400.
//   POST { client_id, action: "store", ssn?, dob?, addresses? } → { ok, identity }
//
// THE ROLE GATE IS NARROWER THAN ROLE_SETS.STAFF, DELIBERATELY. STAFF includes
// setters and closers, who have no reason to see a client's social security
// number; the inquiry specialist does, because disputing an inquiry with a
// bureau requires identifying the consumer. Widening this set is a decision
// someone should have to make on purpose, in this file, rather than inherit by
// reusing a convenient constant.
//
// The reveal is a POST even though it reads. It is a disclosure with a
// side effect — a log row — and GETs get retried, prefetched, cached and
// logged with their query strings.
import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { isUuid, CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import { readIdentity, revealSsn, storeIdentity, accessHistory, PiiError } from "../src/pii/index.mjs";

const IDENTITY_ROLES = new Set(["owner", "admin", "inquiry_specialist", "funding_advisor"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const auth = deps.requirePrincipal ?? requirePrincipal;
  const principal = await auth(req, res, ["staff"], { db: database });
  if (!principal) return;

  if (!IDENTITY_ROLES.has(String(principal.role || "").toLowerCase())) {
    // 403, not 404: the caller is authenticated and the resource exists. Hiding
    // that fact from a logged-in employee buys nothing and confuses the person
    // who has to explain why the button did nothing.
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const orgId = principal.orgId;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "no_org_on_session" });
  }

  const clientBelongsToSession = async (clientId) => {
    const found = await database.query(
      `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    if (!found.rows[0]) {
      res.status(404).json({ ok: false, error: "not_found" });
      return false;
    }
    return true;
  };

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      if (!await clientBelongsToSession(q.client_id)) return;
      if (q.history === "1" || q.history === "true") {
        return res.status(200).json({ ok: true, access: await accessHistory(database, { orgId, clientId: q.client_id }) });
      }
      const identity = await readIdentity(database, { orgId, clientId: q.client_id });
      return res.status(200).json({ ok: true, identity });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (!isUuid(body.client_id)) return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      if (!await clientBelongsToSession(body.client_id)) return;

      if (body.action === "reveal") {
        // RULE 4 OF src/pii/index.mjs IS ENFORCED HERE, NOT IN THE BROWSER.
        // "A reason is required" was documented in the service module and
        // checked only by the screen, while revealSsn() defaults reason to
        // null and degrades the log row to a bare "ssn". That was invisible
        // for as long as this route 404'd. It is reachable now, so the rule
        // has to hold for curl and for a script, not just for the one screen
        // that happens to ask. An unexplained disclosure is indistinguishable
        // from every other one, which is the state rule 4 exists to prevent.
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason) {
          return res.status(400).json({ ok: false, error: "reason is required — every reveal is written to pii_access_log" });
        }
        const { ssn } = await revealSsn(database, {
          orgId,
          clientId: body.client_id,
          // The session's staff id, never a name from the request body: an
          // attributable log entry cannot let the caller choose its own
          // attribution.
          accessedBy: principal.staffId,
          reason
        });
        return res.status(200).json({ ok: true, ssn });
      }

      if (body.action === "store") {
        const identity = await storeIdentity(database, {
          orgId,
          clientId: body.client_id,
          ssn: body.ssn ?? null,
          dob: body.dob ?? null,
          addresses: body.addresses ?? []
        });
        return res.status(200).json({ ok: true, identity });
      }

      return res.status(400).json({ ok: false, error: "action must be one of: reveal, store" });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    if (e instanceof PiiError) return res.status(e.status).json({ ok: false, error: e.message });
    if (CLIENT_DATA_ERRORS.has(e.code)) return res.status(400).json({ ok: false, error: "bad request parameter" });
    throw e;
  }
}
