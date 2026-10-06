// Shared plumbing for the read APIs — pagination, role gating, and redaction.
//
// Every GET endpoint added in Unit 9 goes through these, so the three rules that
// matter are enforced in one place instead of being remembered eleven times:
//
//   PAGINATE       — no endpoint may return an unbounded result set
//   ROLE GATE      — sensitive reads name the roles allowed, and the default is
//                    deny; an endpoint that forgets to say gets nobody
//   NEVER RETURN   — storage keys and SSNs do not leave the process, whatever the
//                    caller asks for
//
// Framework-agnostic like the rest of src/http: plain values in, plain values
// out, so this is testable without an HTTP layer.

// Columns that must never reach a client, whatever the query selected. Matched
// case-insensitively against the key name, so a future `ssn_last4` or
// `storage_key_v2` is caught by the same rule rather than needing a new one.
const FORBIDDEN_KEY = /(^|_)(ssn|social_security)(_|$)|storage_key|storage_path|s3_key|object_key|password|password_hash|token_hash/i;

// Keys that are allowed through despite matching above, because they are the
// safe derived form the screens actually need.
const ALLOWED_EXACT = new Set(["ssn_present", "has_ssn"]);

/* redact — strip forbidden keys from a row or array of rows. Recurses into nested
   objects, because a joined document row arrives as a nested object and would
   otherwise carry its storage key straight through. */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!ALLOWED_EXACT.has(k) && FORBIDDEN_KEY.test(k)) continue;
    out[k] = (v && typeof v === "object" && !(v instanceof Date)) ? redact(v) : v;
  }
  return out;
}

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;

/* Postgres SQLSTATE codes that mean "the value you sent does not fit the
   column", i.e. a 400 rather than a 500. Class 22 is "data exception".
   22P02 is the one that actually bites — `?id=zzz` against a uuid column —
   but a bad date or an over-large number arrives the same way. */
export const CLIENT_DATA_ERRORS = new Set([
  "22P02", // invalid_text_representation — bad uuid, bad numeric
  "22003", // numeric_value_out_of_range
  "22007", // invalid_datetime_format
  "22008"  // datetime_field_overflow
]);

/* boundedLimit — for the handlers that roll their own pagination rather than
   going through readHandler (dashboard/clients, dashboard/pipeline, tasks).

   Each of them did `Math.min(parseInt(v) || fallback, cap)`, which has no LOWER
   bound: ?limit=-1 parses to -1, survives Math.min, reaches Postgres and raises
   "LIMIT must not be negative" as a 500. A caller's bad number is not a server
   fault. NaN and empty fall back; anything below 1 clamps to 1. */
export function boundedLimit(raw, { fallback, cap }) {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(n, cap));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* isUuid — cheap guard for handlers that take an `?id=`. Catching a malformed
   id here avoids firing a fan-out of parallel queries that cannot match, and
   turns what used to be a 500 into an honest 400. */
export function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

/* unitFraction — a query parameter that must be a fraction in (0, 1].
   Returns { present, value, valid } so a handler can tell "absent" apart from
   "present and wrong"; absent is fine and falls through to a default, wrong is a 400.

   THIS EXISTS BECAUSE A GUARDRAIL WAS BYPASSABLE FROM THE URL BAR.
   api/read/tradelines.mjs took the closer's utilization ceiling straight off the
   query string as a bare Number(). `?utilization_threshold=999` set the ceiling to
   99,900%, which no card can breach, and `=abc` produced NaN — every comparison
   against NaN is false, so that disabled the guardrail too, while looking like a
   number. Bounds are the whole point of a bound, so they are checked here rather
   than trusted at each call site.

   Deliberately NOT clamping, unlike pageParams above. A caller asking for 1000 rows
   plainly wants "as many as possible" and 200 answers that. A caller asking for a
   99,900% utilization ceiling is not asking for 100% — quietly substituting one is
   how the control gets bypassed without anyone seeing an error. */
export function unitFraction(raw) {
  const present = raw != null && raw !== "";
  if (!present) return { present: false, value: undefined, valid: true };
  const value = Number(raw);
  return { present: true, value, valid: Number.isFinite(value) && value > 0 && value <= 1 };
}

/* ── ?days= — ONE definition, for every endpoint that takes a date window ────

   A whole number of days in [1, MAX_DAYS], or the default. A malformed value is
   REFUSED rather than coerced: "days=banana" quietly becoming 30 is how a screen
   ends up showing a window nobody asked for.

   THIS LIVES HERE BECAUSE IT WAS COPIED. api/read/finance-command.mjs and
   api/read/ad-spine.mjs held byte-identical copies, which is the bug CLAUDE.md §8
   names — two definitions of what a valid window is, and the next person to move
   the ceiling moves only one of them. Both now import this one.

   api/read/transactions.mjs and api/read/money-map.mjs still hold their own
   copies. They are not in this lane's scope and their own tests import from them
   directly; they are named here so the next person to touch either one knows
   where the shared copy is.

   DIGITS ONLY, which the copies were not. Number("1e2") is 100 and Number("0x1E")
   is 30, and both slipped through Number.isSafeInteger. Neither is a thing a
   person types into a URL on purpose, so both are now the caller's mistake. */
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;

export function readDays(raw) {
  if (raw === undefined || raw === null || raw === "") return { days: DEFAULT_DAYS };
  const text = String(raw).trim();
  const n = Number(text);
  if (!/^[0-9]+$/.test(text) || !Number.isSafeInteger(n) || n < 1 || n > MAX_DAYS) {
    return { error: `days must be a whole number between 1 and ${MAX_DAYS}` };
  }
  return { days: n };
}

/* pageParams — limit/offset from a query string, bounded. The unit's rule is
   "paginated above 200 rows", so 200 is the ceiling and a caller asking for more
   silently gets 200 rather than an error: a screen requesting 1000 should still
   render, just not drag the whole table across the wire. */
export function pageParams(query = {}) {
  const rawLimit = parseInt(query.limit ?? String(DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const rawOffset = parseInt(query.offset ?? "0", 10);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  return { limit, offset };
}

/* page — the response envelope every list endpoint returns. `hasMore` is derived
   by asking for one row more than requested, so a screen knows whether to show a
   "next" control without a second count query. */
export function page(rows, { limit, offset }) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { count: items.length, limit, offset, hasMore, items: redact(items) };
}

/* ROLE GATING. Deny by default: an endpoint that does not list roles admits
   nobody, so forgetting to configure one fails closed rather than open. */
export const ROLE_SETS = {
  /* Money and people. Commission rates, invoices, staff records, payouts.

     sales_manager is here by an explicit owner decision (H-6 in Ticket 8,
     answered 2026-08-01), NOT by an agent's judgement — the ticket names this
     as a call an agent must not make on its own. The decision was company-wide
     commission visibility rather than own-team-only, and the reasoning
     recorded with it is that closers are the only commissioned staff, so the
     two scopes are the same set of people today.

     Worth knowing when that stops being true: FINANCE is broader than
     commissions. It also gates invoices, staff records and payouts, and this
     set has no notion of "their own team" to narrow to. If a second
     commissioned role ever appears, this is the line to revisit. Decided, not
     open — logged here so nobody re-derives it, not so it gets re-argued. */
  FINANCE: new Set(["owner", "admin", "sales_manager"]),
  // Operational reads any employee needs to do their job.
  // csm added 2026-09-05 (db/migrations/290_csm_role.sql). Without it a CSM
  // 403s on every client read they need to do the job they were created for.
  STAFF: new Set(["owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter", "sales_manager", "csm"]),
  // Platform health. Failed events name handlers and payload shapes.
  OPS: new Set(["owner", "admin"]),
  // Recruiting. Deliberately NOT the STAFF set: these reads carry job-applicant
  // PII and the scoring trail of an automated employment decision tool, which is
  // material a closer has no reason to see and real exposure if it circulates.
  // Widen this only by naming a recruiting role, never by reusing STAFF.
  HIRING: new Set(["owner", "admin"]),
  /* Bias-audit aggregates — v_eeo_aggregate only. Same people as HIRING today but
     a separate gate from api/hiring/* so demographic summaries never ride alongside
     applicant PII and scoring trails (053_eeo_selfid.sql). */
  COMPLIANCE: new Set(["owner", "admin"]),
  /* The lender database. Chris's call, 2026-08-17: the Lenders list is
     commercial relationship data the funding advisor maintains — who each
     lender is, what they pull, the terms and the insider notes — and it is not
     something the rest of the floor needs to do its job. It was on STAFF, which
     meant a closer could read the whole lender book with one request.

     `admin` is in alongside `owner` because every other set here pairs them.
     Cutting admin is one word out of this line.

     Worth revisiting if a second role ever takes over maintaining lender
     records, or if a screen outside the Lenders list needs the raw rows.

     NOT the whole story: `read/lender-matches` is deliberately still on STAFF.
     It is a different feature — the "which lenders fit this client" box on the
     closer dashboard — and Chris did not name it. Locking it here would break a
     closer's daily screen. Leave it alone unless Chris says otherwise. */
  LENDERS: new Set(["owner", "admin", "funding_advisor"]),
  /* The Specialist desk — inquiry-removal cases and the credit-repair queue.

     These two reads were on STAFF, which meant a setter could open
     public/app/inquiry-remover.html and read every client's dispute file: which
     items are being disputed, which bureau, which round, and what the letters
     say. That is the same class of material /api/pii already refuses a setter
     and a closer, and this set is deliberately the same four roles that
     endpoint's own IDENTITY_ROLES names, for the same reason — a dispute queue
     and a social security number are read by the same two desks and nobody
     else.

     Narrower than the WRITE side on purpose: api/repair/enroll.mjs keeps
     `closer` because a closer enrolls a client from their own screen and never
     needs to read the queue back. Widen this only by naming a role that works
     one of these two desks. */
  SPECIALIST_DESK: new Set(["owner", "admin", "inquiry_specialist", "funding_advisor"]),
  /* The Marketing Command Center and every api/marketing/* read behind it:
     ad spend, unreleased ad copy and the offer work. Owner and admin, the
     same people the Marketing menu shows to (public/app/shell.js
     OWNER_ADMIN_ONLY). Named in docs/specs/marketing-machine-2026-10-04.md §4
     trap 2. Widen it by naming a role, never by reaching for STAFF. */
  MARKETING: new Set(["owner", "admin"])
};

export function allowsRole(roleSet, role) {
  if (!roleSet || typeof roleSet.has !== "function") return false;
  return roleSet.has(String(role || "").trim().toLowerCase());
}

/* requireRole — returns true if the request may proceed, else writes the 403 and
   returns false. Mirrors requireAuth's shape so call sites read the same way.

   403, not 404: the caller is authenticated, so hiding the endpoint's existence
   buys nothing and makes a permissions bug undiagnosable. */
export function requireRole(res, staff, roleSet) {
  if (allowsRole(roleSet, staff && staff.role)) return true;
  res.status(403).json({
    ok: false,
    error: "forbidden",
    message: "this endpoint is limited to " + [...(roleSet || [])].join(", ")
  });
  return false;
}

/* readHandler — the wrapper every Unit 9 endpoint uses. Handles method checking,
   auth, role gating, pagination and error shaping so each endpoint file is just
   its SQL and its mapping.

   `fetch(db, { limit, offset, query, staff })` must return an array of rows; it
   should SELECT limit+1 so `hasMore` is accurate. */
/* PRINCIPALS. `principals` names the NON-STAFF kinds an endpoint serves —
   {"client"}, {"partner"} — and is absent by default, so every endpoint keeps
   admitting staff only unless it opts in.

   This is what src/partners/scope.mjs was written for and was never wired to.
   Nothing called it, no api/read/* query filtered partner_id, and the
   consequence was quiet rather than dangerous: a client or partner could sign in
   and then read NOTHING, because every endpoint 401'd them. client-portal and
   partner-galaxy showed a signed-in principal a wireframe.

   When an endpoint opts in, `fetch` receives the resolved `principal` and MUST
   scope its own SQL with it. There is no automatic scoping here on purpose: a
   wrapper that silently appended a WHERE clause would be one refactor away from
   silently not appending it. The endpoint's SQL says who it is for, in the open,
   where a reviewer reads it. */
export function readHandler({ roles, fetch, single = false, principals = null }) {
  return async function handler(req, res, deps) {
    const { db, requireAuth, requirePrincipal } = deps;
    if (req.method && req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    let staff = null;
    let principal = null;

    if (principals && principals.size) {
      if (typeof requirePrincipal !== "function") {
        // Fail closed: an endpoint that declares principals but was not given
        // the resolver must not fall back to the staff-only path and quietly
        // serve staff data to nobody's satisfaction.
        return res.status(500).json({ ok: false, error: "misconfigured_endpoint" });
      }
      principal = await requirePrincipal(req, res, ["staff", ...principals], { db });
      if (!principal) return;
      if (principal.kind === "staff") {
        staff = principal.staff || { role: principal.role };
        if (!requireRole(res, staff, roles)) return;
      }
      // A non-staff principal is admitted by KIND; roles do not apply to it.
    } else {
      staff = await requireAuth(req, res, { db });
      if (!staff) return;
      if (!requireRole(res, staff, roles)) return;
    }

    try {
      const query = req.query || {};
      const { limit, offset } = pageParams(query);
      const rows = await fetch(db, { limit, offset, query, staff, principal });
      if (single) {
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (!row) return res.status(404).json({ ok: false, error: "not_found" });
        return res.status(200).json({ ok: true, ...redact(row) });
      }
      return res.status(200).json({ ok: true, ...page(rows, { limit, offset }) });
    } catch (err) {
      // A malformed parameter is the CALLER's error, not ours. Postgres raises
      // SQLSTATE class 22 (data exception) for `?id=zzz` against a uuid column,
      // and reporting that as a 500 told every screen "the backend is down" when
      // only the query string was wrong. Classify on the code, not the message —
      // the message is localised and version-dependent.
      if (CLIENT_DATA_ERRORS.has(err && err.code)) {
        return res.status(400).json({ ok: false, error: "invalid_parameter" });
      }
      // A handler's own precondition — api/hiring/application.mjs throws this
      // when ?id= is missing. It is the caller's error for the same reason a bad
      // uuid is, and was reaching the 500 branch below, so a screen that simply
      // forgot the id was told the database had fallen over.
      if (err && err.code === "BAD_REQUEST") {
        const safe = String(err && err.message || "bad request")
          .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]")
          .slice(0, 200);
        return res.status(400).json({ ok: false, error: "bad_request", message: safe });
      }
      if (err && err.code === "FORBIDDEN") {
        return res.status(403).json({
          ok: false,
          error: "no_org_on_session",
          message: "this endpoint needs a staff session that belongs to a company"
        });
      }
      // The message can quote a DSN on a connection failure, same as health.
      const safe = String(err && err.message || "query failed")
        .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]")
        .slice(0, 200);
      return res.status(500).json({ ok: false, error: "query_failed", message: safe });
    }
  };
}
