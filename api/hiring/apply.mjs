// GET/POST /api/hiring/apply — the public careers door.
//
// ══════════════════════════════════════════════════════════════════════════════
// THIS FILE IS UNAUTHENTICATED. EVERY OTHER FILE UNDER api/hiring/ IS NOT.
//
// candidates, application, postings, decisions, funnel, bench and decide all gate
// on ROLE_SETS.HIRING (owner, admin) because they carry applicant PII and the
// scoring trail of an automated employment decision tool. 053_eeo_selfid.sql's
// header states that as a flat fact about this directory. It is no longer flat,
// and this is the exception, so it is written at the top of the file rather than
// left for somebody to discover:
//
//   GET  → the list of open roles. Three columns: key, name, brief. Nothing else
//          from hiring_roles leaves — not comp, not the scorecard, not the bench
//          target, not the hiring manager.
//   POST → one application. Writes a candidate and a candidate_application in
//          `applied`, through src/hiring/pipeline.mjs's apply(), and stops.
//
// DO NOT ADD A THIRD VERB, and do not add a read of anything a stranger should
// not have. If a future endpoint here needs a login, it belongs in its own file
// with requireRole on it, not behind a flag in this one.
// ══════════════════════════════════════════════════════════════════════════════
//
// NOTHING HERE DECIDES ANYTHING. No score is computed, no stage advances, no
// status is set. 051_hiring.sql's invariant — no candidate is ever rejected by
// software — is not weakened by an intake path that cannot reject: a refused
// SUBMISSION writes no row at all, which is a request that was not accepted and
// is not an adverse action against a candidate.
//
// THE REPLY IS ALWAYS THE SAME. A new candidate, a returning one, an address
// with an application already open for that role, and a bot caught by the
// honeypot all get { ok: true, received: true }. A form that answers differently
// for an address it recognises is an account checker, and this one collects the
// email addresses of people applying for jobs.

import { db } from "../../src/db.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  parseApplyBody,
  listOpenRoles,
  checkApplyRate,
  recordAttempt,
  submitApplication,
  nextStepFor
} from "../../src/hiring/apply-public.mjs";

/* The same body reader the other public handlers use. The Netlify shim may hand
   over a parsed object, a string, or a rawBody depending on the content type. */
function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return null; }
  }
  if (typeof req.rawBody === "string") {
    try { return JSON.parse(req.rawBody || "{}"); } catch { return null; }
  }
  return null;
}

/* The source address, for the burst limiter only. It is NOT stored: candidates
   has no column for it, and an applicant's IP is one more piece of data about a
   person we would then have to defend. */
function clientIp(req) {
  const h = req.headers || {};
  const raw =
    req.socket?.remoteAddress ||
    h["x-nf-client-connection-ip"] ||
    String(h["x-forwarded-for"] || "").split(",")[0].trim() ||
    null;
  const ip = raw ? String(raw).trim() : "";
  return ip ? ip.slice(0, 100) : null;
}

const RECEIVED = { ok: true, received: true };

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let orgId;
  try {
    orgId = await resolveDefaultOrg(db);
  } catch (err) {
    return res.status(503).json({ ok: false, error: safeError(err) });
  }

  if (req.method === "GET") {
    try {
      const roles = await listOpenRoles(db, { orgId });
      /* THE CACHE HEADER GOES ON THE SUCCESS, NOT ON THE REQUEST. Setting it
         before the read cached the 500 as well, so one bad minute became a
         careers page that stayed broken for everybody for the next sixty
         seconds. A short cache, not a long one: a req closing is a change a
         candidate should stop seeing within the minute. */
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(200).json({ ok: true, roles });
    } catch (err) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(500).json({ ok: false, error: safeError(err) });
    }
  }

  res.setHeader("Cache-Control", "no-store");

  const parsed = parseApplyBody(readBody(req));
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  const ip = clientIp(req);

  try {
    /* ASK FIRST, THEN COUNT. Counting this attempt before asking made the
       request compete with itself, so a limit of five let four through. Every
       attempt is recorded either way, accepted or refused — a limiter that only
       counts successes is one an attacker never trips. */
    const rate = await checkApplyRate(db, { orgId, email: parsed.email, ip });
    await recordAttempt(db, { orgId, ip });

    if (rate.limited) {
      res.setHeader("Retry-After", String(rate.retryAfterMinutes * 60));
      return res.status(429).json({
        ok: false,
        error: "rate_limited",
        retryAfterMinutes: rate.retryAfterMinutes
      });
    }

    await submitApplication(db, parsed, { orgId });
    /* `received`, not `created`. The outcome is deliberately not in the reply —
       see the header. */
    if (parsed.funnel !== "join") return res.status(200).json(RECEIVED);

    /* The hiring funnel (/join/apply/) also needs to know which screen comes
       next: the calendar, "we'll reach out", or the thank-you. nextStepFor()
       answers from the seat and the answers sent, never from what is on file,
       so the reply still says nothing about whether the address was known. */
    const step = await nextStepFor(db, parsed, { orgId });
    return res.status(200).json({ ...RECEIVED, ...step });
  } catch (err) {
    if (err && err.code === "ROLE_UNAVAILABLE") {
      return res.status(400).json({ ok: false, error: "role_unavailable" });
    }
    /* NO PII IN THE LOG OR THE REPLY. safeError() is the repo's scrubbed error
       string; the applicant's name and address never reach either. */
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
