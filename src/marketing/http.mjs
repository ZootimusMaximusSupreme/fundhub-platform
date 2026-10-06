// Shared door for every api/marketing/* route: the gate, the one-transaction
// write, and the error answers. Spec docs/specs/marketing-machine-2026-10-04.md
// §4 traps 2–3 and §7.8; the request_id rule is the API contract's global rule.
//
//   gateMarketing(req, res)            signed in → owner or admin → a company.
//                                      Answers 401/403 itself and returns null.
//                                      NOTE: scripts/journeys/extract.mjs reads a
//                                      route's gate from the route file itself and
//                                      does not follow this helper. A route that
//                                      gates only through it extracts as
//                                      "unverified" and fails generate.test.mjs.
//                                      So a route writes the same three steps in
//                                      its own file: requireAuth, then
//                                      requireRole(res, staff, ROLE_SETS.MARKETING),
//                                      then hasCompany(res, staff) — as
//                                      api/marketing/settings.mjs does.
//   withRequest(db, {orgId, route,     ONE asStaff() transaction for one write:
//     requestId}, fn)                    1. lock this request_id (two copies of
//                                          the same press wait for each other)
//                                       2. look it up — same company and route:
//                                          hand back the saved answer, fn never
//                                          runs; another company or route: 400
//                                       3. fn(tx) does the write and returns the
//                                          answer body
//                                       4. INSERT the answer into
//                                          marketing_requests — the LAST statement
//                                       5. COMMIT, return the answer
//                                      fn throws → ROLLBACK: no change, no saved
//                                      answer. A copy that still hits the primary
//                                      key (a writer that skipped the lock) rolls
//                                      back and returns the first saved answer.
//   staffRead(db, fn)                  one short asStaff() read, for a GET.
//   sendInvalid / sendStale / sendNotFound / sendKnownError / sendNotReady
//                                      the error bodies, {error, message, ...},
//                                      in plain words.
//
// RULES FOR ROUTES THAT USE THIS (every later marketing write):
//   * Write through withRequest and never open asStaff() yourself inside fn —
//     fn gets the transaction; use it for every query.
//   * Never call a model, GitHub or Meta inside fn. The transaction is open.
//   * Throw InvalidError / StaleError / NotFoundError from fn to refuse; the
//     transaction rolls back and sendKnownError() writes the answer. Only a
//     finished write is saved, so a retry after a 409 is not stuck on it.
//   * The answer is saved as JSON and comes back as JSON on a repeat, so return
//     plain data (a Date becomes its ISO string either way).

import { requireAuth as defaultRequireAuth } from "../http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../http/read-api.mjs";
import { asStaff as defaultAsStaff } from "../partners/rls.mjs";

/* ── errors a route throws to refuse ────────────────────────────────────── */

export class InvalidError extends Error {
  /** @param {string} field @param {string} message */
  constructor(field, message) {
    super(message);
    this.name = "InvalidError";
    this.field = field;
  }
}

export class StaleError extends Error {
  /** @param {any} current what is saved now @param {string} [message] */
  constructor(current, message) {
    super(message || "Someone saved this after you opened it. Here is what is saved now. Look it over and save again.");
    this.name = "StaleError";
    this.current = current;
  }
}

export class NotFoundError extends Error {
  /** @param {string} [message] */
  constructor(message) {
    super(message || "That was not found.");
    this.name = "NotFoundError";
  }
}

/* ── answers ─────────────────────────────────────────────────────────────── */

export function sendInvalid(res, field, message) {
  return res.status(400).json({ error: "invalid", field, message });
}

export function sendStale(res, current, message) {
  return res.status(409).json({
    error: "stale",
    message: message || "Someone saved this after you opened it. Here is what is saved now. Look it over and save again.",
    current
  });
}

export function sendNotFound(res, message) {
  return res.status(404).json({ error: "not_found", message: message || "That was not found." });
}

/** Writes the answer for one of the three errors above. True when it did. */
export function sendKnownError(res, err) {
  if (err instanceof InvalidError) { sendInvalid(res, err.field, err.message); return true; }
  if (err instanceof StaleError) { sendStale(res, err.current, err.message); return true; }
  if (err instanceof NotFoundError) { sendNotFound(res, err.message); return true; }
  return false;
}

/* Postgres "relation does not exist" (42P01) for a marketing_* table: the
   migration that makes it has not shipped yet. That is "not live yet", not a
   crash, so it answers 503 in plain words. Any other missing table stays an
   error. */
export function isNotReady(err) {
  return !!err && err.code === "42P01" && /relation "?(public\.)?marketing_/i.test(String(err.message || ""));
}

export function sendNotReady(res, err, what = "This part of marketing") {
  if (!isNotReady(err)) return false;
  res.status(503).json({
    error: "not_ready",
    message: `${what} is built, but its database table is not live yet. It turns on with the next ship.`
  });
  return true;
}

/* ── the gate ────────────────────────────────────────────────────────────── */

/**
 * Signed in, owner or admin (ROLE_SETS.MARKETING), and a company on the session.
 * requireAuth ignores roles (CLAUDE.md §12), so the role check is its own step.
 * Returns the staff row, or null after writing the 401/403.
 */
export async function gateMarketing(req, res, { db, requireAuth = defaultRequireAuth } = {}) {
  const staff = await requireAuth(req, res, db ? { db } : {});
  if (!staff) return null;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return null;
  if (!hasCompany(res, staff)) return null;
  return staff;
}

/** The session names a company (org_id is a uuid). Writes the 403 when not. */
export function hasCompany(res, staff) {
  if (staff && isUuid(staff.org_id)) return true;
  res.status(403).json({ error: "forbidden", message: "Your sign-in is not tied to a company." });
  return false;
}

/* ── the body ────────────────────────────────────────────────────────────── */

/** The JSON body as a plain object. A body that is not one → 400 field "body". */
export function readBody(req) {
  let b = req && req.body;
  if (b === undefined || b === null || b === "") return {};
  if (typeof b === "string") {
    try { b = JSON.parse(b); } catch { throw new InvalidError("body", "The request body is not JSON."); }
  }
  if (typeof b !== "object" || Array.isArray(b)) {
    throw new InvalidError("body", "The request body must be a JSON object.");
  }
  return b;
}

/* A request_id is made by the screen once per press (a uuid works). Letters,
   numbers and - _ . : only, 8 to 200 of them, so a short or sloppy id cannot
   bump into somebody else's. */
export const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,200}$/;

export function checkRequestId(requestId) {
  if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) {
    throw new InvalidError(
      "request_id",
      "Every save needs a request_id: 8 to 200 letters, numbers, dashes, dots, colons or underscores. Make a new one for each press."
    );
  }
  return requestId;
}

/* ── one write, one transaction ──────────────────────────────────────────── */

const LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtextextended('marketing_requests:' || $1, 0))`;
const FIND_SQL = `SELECT org_id, route, response FROM marketing_requests WHERE request_id = $1`;
const SAVE_SQL = `INSERT INTO marketing_requests (request_id, org_id, route, response)
                  VALUES ($1, $2, $3, $4::jsonb)`;

const REUSED =
  "This request_id was already used for a different save. Make a new request_id for each press.";

/* asStaff() takes a pool. Handlers pass src/db.mjs's `db` (query only), which
   means "the app's own pool"; a test may pass a pool-shaped fake (connect()). */
function scopeDeps(db) {
  if (db && typeof db.connect === "function") return { pool: () => db };
  if (db && typeof db.pool === "function") return { pool: db.pool };
  return {};
}

/**
 * One short read transaction as staff, for a GET. Same pool rule as withRequest.
 * Forced-row-security tables (campaigns, ads, ad_sets, ad_metrics_daily) read
 * empty outside one.
 */
export function staffRead(db, fn, { asStaff = defaultAsStaff } = {}) {
  return asStaff(fn, scopeDeps(db));
}

function replay(saved, { orgId, route }) {
  if (String(saved.org_id) !== String(orgId) || saved.route !== route) {
    throw new InvalidError("request_id", REUSED);
  }
  return saved.response;
}

function isRequestPkConflict(err) {
  return !!err && err.code === "23505" &&
    (err.constraint === "marketing_requests_pkey" || /marketing_requests_pkey/.test(String(err.message || "")));
}

/**
 * Run one marketing write in one staff transaction, at most once per request_id.
 * Returns the answer body: the one fn returned, or the one saved the first time.
 *
 * @template T
 * @param {any} db                src/db.mjs `db`, or a pool-shaped object with connect()
 * @param {{orgId: string, route: string, requestId: string}} opts
 * @param {(tx: {query: Function}) => Promise<T>} fn
 * @param {{asStaff?: Function}} [deps]
 * @returns {Promise<any>}
 */
export async function withRequest(db, { orgId, route, requestId }, fn, { asStaff = defaultAsStaff } = {}) {
  if (typeof fn !== "function") throw new Error("withRequest: fn is required");
  if (!isUuid(orgId)) throw new Error("withRequest: orgId must be a uuid");
  if (typeof route !== "string" || !route.trim()) throw new Error("withRequest: route is required");
  checkRequestId(requestId);
  const deps = scopeDeps(db);

  try {
    return await asStaff(async (tx) => {
      await tx.query(LOCK_SQL, [requestId]);
      const found = await tx.query(FIND_SQL, [requestId]);
      if (found.rows[0]) return replay(found.rows[0], { orgId, route });

      const out = await fn(tx);
      if (out === undefined) throw new Error("withRequest: fn must return the answer body");
      // Saved and returned as the same JSON, so a repeat answers exactly this.
      const response = JSON.parse(JSON.stringify(out));
      await tx.query(SAVE_SQL, [requestId, orgId, route, JSON.stringify(response)]);
      return response;
    }, deps);
  } catch (err) {
    if (!isRequestPkConflict(err)) throw err;
    // Another copy of this press saved first. Ours rolled back whole — nothing
    // fn did was kept. Answer with what the first one saved.
    const saved = await asStaff(async (tx) => (await tx.query(FIND_SQL, [requestId])).rows[0] || null, deps);
    if (!saved) throw err;
    return replay(saved, { orgId, route });
  }
}
