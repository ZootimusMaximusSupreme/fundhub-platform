// Shared plumbing for the Creative Factory read APIs.
//
// The sibling of src/http/read-api.mjs, which serves STAFF endpoints. This one
// serves endpoints a PARTNER reaches, and the difference is the whole point:
//
//   read-api.mjs         → requireAuth (employees), role sets, no tenancy filter
//   partner-read-api.mjs → requirePrincipal(["partner","staff"]), and every query
//                          runs inside withPartnerScope so RLS applies
//
// THREE LOCKS ON EVERY READ, and they are deliberately redundant:
//
//   1. requirePrincipal refuses a kind the endpoint did not name, so a client or
//      affiliate session cannot reach a partner's campaign list.
//   2. withPartnerScope opens the transaction as that partner, so the RLS
//      policies from 045/046 filter every row. A query that forgets its WHERE
//      returns nothing.
//   3. redact() strips storage keys, token ciphertext and anything else forbidden
//      before the body is written, whatever the SQL selected.
//
// Any one of these would mostly work. All three means a mistake in one is not an
// incident, which is the posture the spec asks for: one partner seeing another's
// spend is the worst bug this module can produce.
//
// STAFF READ WITH AN EXPLICIT partner_id, NOT IMPLICITLY EVERYTHING. A staff
// session hitting these endpoints must pass ?partner_id=, and gets that partner's
// view. Letting a staff call with no partner_id return the union of every partner
// would make the same endpoint mean two different things depending on who called
// it — and the screens would render a merged book that belongs to nobody.

import { requirePrincipal } from "./middleware/requirePrincipal.mjs";
import { withPartnerScope } from "../partners/rls.mjs";
import { redact, pageParams, page, CLIENT_DATA_ERRORS } from "./read-api.mjs";
import { redactConnection } from "../adplatforms/tokens.mjs";

/* partnerReadHandler({ fetch, single })

   `fetch(tx, { limit, offset, query, partnerId, principal })` returns rows and
   runs inside the scoped transaction. It should SELECT limit+1 so `hasMore` is
   accurate, matching read-api.mjs. */
export function partnerReadHandler({ fetch, single = false, mapRow = null }) {
  return async function handler(req, res, deps = {}) {
    const { db } = deps;
    if (req.method && req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const principal = await requirePrincipal(req, res, ["partner", "staff"], { db });
    if (!principal) return;

    const query = req.query || {};
    const partnerId = resolvePartnerId(principal, query);
    if (!partnerId) {
      // A staff caller without ?partner_id= is a caller who has not said whose
      // book they want. Answering with everything would be a different endpoint.
      return res.status(400).json({
        ok: false, error: "partner_id_required",
        message: "staff sessions must name a partner_id; partner sessions are scoped to their own"
      });
    }

    try {
      const { limit, offset } = pageParams(query);
      // The scope is always the RESOLVED partner, never a value from the query
      // string for a partner principal — see resolvePartnerId.
      /* deps.pool is a test seam only: the isolation tests hand in the
         unprivileged pool (src/testing/rls-pool.mjs) so the policy is what they
         measure. Production passes nothing and gets the default pool. */
      const rows = await withPartnerScope({ kind: "partner", partnerId }, (tx) =>
        fetch(tx, { limit, offset, query, partnerId, principal }), { pool: deps.pool });

      const shaped = mapRow ? (Array.isArray(rows) ? rows.map(mapRow) : mapRow(rows)) : rows;

      if (single) {
        const row = Array.isArray(shaped) ? shaped[0] : shaped;
        if (!row) return res.status(404).json({ ok: false, error: "not_found" });
        return res.status(200).json({ ok: true, ...redact(row) });
      }
      return res.status(200).json({ ok: true, ...page(shaped, { limit, offset }) });
    } catch (err) {
      // A malformed parameter is the CALLER's error, not ours. Same reasoning as
      // read-api.mjs: reporting a bad query string as a 500 tells every screen
      // "the database is unreachable" (public/app/data.js) when the backend is
      // perfectly healthy and only the request was wrong. Classify on the code,
      // never the message — messages are localised and version-dependent.
      //
      // Three families land here, and all three are 400s:
      //   BAD_STATE    — stateFilter() rejected an unknown ?state=. The allowed
      //                  list is echoed back, because a screen filtering on a
      //                  typo needs to be told which values exist.
      //   BAD_REQUEST  — a handler's own precondition, e.g. detail.mjs with no ?id=.
      //   SQLSTATE 22  — Postgres data exception, e.g. ?id=zzz against a uuid.
      if (err && err.code === "BAD_STATE") {
        return res.status(400).json({ ok: false, error: "bad_state", message: safeMessage(err) });
      }
      if (err && err.code === "BAD_REQUEST") {
        return res.status(400).json({ ok: false, error: "bad_request", message: safeMessage(err) });
      }
      if (CLIENT_DATA_ERRORS.has(err && err.code)) {
        return res.status(400).json({ ok: false, error: "invalid_parameter" });
      }
      return res.status(500).json({ ok: false, error: "query_failed", message: safeMessage(err) });
    }
  };
}

/* resolvePartnerId — where the tenancy decision is made, once.

   A PARTNER principal is scoped to its own id, and a partner_id in the query
   string is IGNORED rather than honoured or rejected. Honouring it would be the
   leak; rejecting it with an error would tell a prober whether the id they guessed
   exists. Ignoring it means the parameter simply has no effect for them. */
export function resolvePartnerId(principal, query = {}) {
  if (principal.kind === "partner") {
    return principal.partnerId || principal.partner_id || null;
  }
  if (principal.kind === "staff") return query.partner_id || null;
  return null;
}

/* safeMessage — a query error can quote a DSN or a constraint containing data.
   Same treatment as read-api.mjs, plus token ciphertext for this module. */
export function safeMessage(err) {
  return String(err && err.message || "query failed")
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]")
    .replace(/v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/g, "[token redacted]")
    .slice(0, 200);
}

/* stateFilter — the `?state=` every list endpoint supports.

   Validated against an allowlist and bound as a parameter. An unknown value is a
   400 rather than being ignored, because a screen filtering on a typo would
   silently show the unfiltered list and look like it worked. */
export function stateFilter(query, column, allowed) {
  const raw = query.state;
  if (raw === undefined || raw === null || raw === "" || raw === "all") {
    return { sql: "TRUE", params: [] };
  }
  const values = String(raw).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = values.filter((v) => !allowed.includes(v));
  if (bad.length) {
    const e = new Error(`unknown state ${bad.join(", ")} — expected one of ${allowed.join(", ")}`);
    e.code = "BAD_STATE";
    throw e;
  }
  return { sql: `${column} = ANY($$)`, params: [values] };
}

export { redactConnection };
