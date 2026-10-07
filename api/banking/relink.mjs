// /api/banking/relink — fix a bank login that stopped working (Plaid update mode).
//
//   GET  [?client_id=<uuid>]
//        → { ok, as_of, environment, plaid_ready, needs_reconnect, logins[] }
//          every bank login of the client: its state, when it was last read, and
//          what is wrong in plain words. Staff add client_id.
//   POST { action: "start",  item_id, add_accounts?, client_id? }
//        → { ok, link_token, expiration, environment, item_id, institution }
//          a Link token in UPDATE MODE for that one login. The browser opens Plaid
//          Link with it; the client signs in at their bank again.
//   POST { action: "finish", item_id, client_id? }
//        → { ok, item_id, state, already_active, institution, refreshed_at, written,
//            accounts[], created[], vanished[], login }
//          "I am done." We read the bank again; only a read that works leaves the
//          login active. It is also the "check again" button — no Link needed.
//
// The rules and the JSON are in src/banking/plaid-relink.mjs and
// docs/finance/bank-relink.md. The words for every error code are in
// src/banking/plaid-item-errors.mjs.
//
// TWO CALLERS, the same gate as link-token and link-exchange:
//   * A signed-in CLIENT (account session), for their OWN file only. The client_id
//     comes off the SESSION; a client_id in the query or body is never read. The
//     login is looked up by org AND client, so another client's item_id is a 404,
//     identical to one that never existed.
//   * STAFF with ROLE_SETS.FINANCE (owner / admin / sales_manager), as its own
//     requireRole() call — requireAuth drops a `roles` key. The client is named by
//     client_id (query on GET, body on POST) and must be in the staff member's org;
//     a client in another org is 404, not 403. Any other principal kind (affiliate,
//     partner) is refused.
//
// THE ACCESS TOKEN NEVER APPEARS IN A RESPONSE. start returns Plaid's short-lived
// link token and nothing from the stored credential; finish returns accounts. org_id
// is never read from a request.
//
// NOT HERE: a Plaid webhook. No Plaid adapter exists under api/webhooks, so Plaid's
// "login repaired" and "consent expiring" calls are not received (see the header of
// src/banking/plaid-relink.mjs).
import { db } from "../../src/db.mjs";
import { requireAuth, AUTH_UNAVAILABLE } from "../../src/http/middleware/requireAuth.mjs";
import { resolvePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { plaidConfigFromEnv } from "../../src/banking/plaid.mjs";
import {
  listBankLoginStatus, startRelink, finishRelink, RelinkInputError
} from "../../src/banking/plaid-relink.mjs";
import { describeAccount } from "../../src/banking/accounts-store.mjs";
import { readBody } from "./sync-accounts.mjs";

export const ACTIONS = Object.freeze(["start", "finish"]);

/* A refusal from the service → a status. 409 says "the login is not in a state where
   that can happen" and keeps 5xx for something that broke. A bank or Plaid that could
   not answer is 502, like link-token. */
const STATUS = Object.freeze({
  not_configured: 503,
  bad_request: 400,
  no_such_login: 404,
  not_reconnectable: 409,
  still_needs_reconnect: 409,
  token_unreadable: 409,
  write_failed: 500
});

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const resolve = deps.resolvePrincipal || resolvePrincipal;
  const list = deps.listBankLoginStatus || listBankLoginStatus;
  const start = deps.startRelink || startRelink;
  const finish = deps.finishRelink || finishRelink;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;

  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let body = null;
  if (method === "POST") {
    body = readBody(req.body);
    if (body === null) return res.status(400).json({ ok: false, error: "body must be JSON" });
  }

  const scope = await clientScope(req, res, { database, auth, resolve, env, body });
  if (!scope) return;
  const { orgId, clientId } = scope;
  const now = clock();

  try {
    if (method === "GET") {
      const logins = await list(database, { orgId, clientId });
      const cfg = plaidConfigFromEnv(env);
      return res.status(200).json({
        ok: true,
        as_of: now.toISOString(),
        /* null when Plaid is not set up: the screen hides Reconnect and says so. */
        environment: cfg.ready ? cfg.environment : null,
        plaid_ready: cfg.ready,
        needs_reconnect: logins.filter((l) => l.state === "needs_reconnect").length,
        logins
      });
    }

    const action = body.action;
    if (!ACTIONS.includes(action)) {
      return res.status(400).json({ ok: false, error: "unknown_action", actions: ACTIONS });
    }
    if (!isUuid(body.item_id)) {
      return res.status(400).json({ ok: false, error: "item_id must be a uuid" });
    }
    const itemRowId = String(body.item_id).trim();

    if (action === "start") {
      const r = await start(database, {
        orgId, clientId, itemRowId, accountSelection: body.add_accounts === true, env
      });
      if (!r.ok) return refuse(res, r);
      return res.status(200).json({
        ok: true,
        link_token: r.linkToken,
        expiration: r.expiration,
        environment: r.environment,
        item_id: r.itemRowId,
        institution: r.institution
      });
    }

    // finish
    const asOf = now.toISOString();
    const r = await finish(database, { orgId, clientId, itemRowId, asOf, env });
    /* The login as it stands NOW, so the screen repaints the one row from this answer
       and needs no second read. After a refusal that says no_such_login there is none. */
    const login = r.reason === "no_such_login"
      ? null
      : ((await list(database, { orgId, clientId, itemRowId }))[0] || null);
    if (!r.ok) return refuse(res, r, { login });
    return res.status(200).json({
      ok: true,
      item_id: r.itemRowId,
      state: r.state,
      already_active: r.alreadyActive,
      institution: r.institution,
      refreshed_at: r.alreadyActive ? null : asOf,
      written: r.written,
      accounts: r.accounts.map((a) => ({
        id: a.id,
        summary: describeAccount(a),
        name: a.name,
        mask: a.mask,
        type: a.account_type,
        subtype: a.account_subtype,
        entity_kind: a.entity_kind
      })),
      /* Accounts that were not stored before this read (the client picked new ones),
         and stored accounts the bank no longer listed — reported, never closed. */
      created: r.created,
      vanished: r.vanished,
      login
    });
  } catch (e) {
    if (e instanceof RelinkInputError) return res.status(e.status).json({ ok: false, error: "bad_request", message: e.message });
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (dbDown(res, e)) return;
    throw e;
  }
}

/* One refusal, one shape. `message` is the sentence the client reads and `fix` is the
   button to offer (reconnect | check_again | connect_again). `detail` is Plaid's own
   text, for staff — it can name a bank, never a credential. */
function refuse(res, r, extra = {}) {
  return res.status(STATUS[r.reason] ?? 502).json({
    ok: false,
    error: r.reason,
    message: r.plain ?? null,
    fix: r.fix ?? null,
    code: r.errorCode ?? null,
    state: r.state ?? null,
    missing: r.missing ?? [],
    detail: r.error ?? null,
    ...extra
  });
}

/* clientScope — who is asking, and for which file. Returns { orgId, clientId } or
   writes the refusal and returns null. Same block as link-token.mjs and
   link-exchange.mjs, kept in this file on purpose: the journey extractor and
   src/http/cross-org-guard.mjs read each handler's own text for its gate.

   A CLIENT session is pinned to its own client_id from the session. Staff go through
   the staff gate: requireAuth, FINANCE, client_id (query on GET, body on POST),
   client in their org. Any other principal kind (affiliate, partner) is refused. No
   session at all falls through to requireAuth, which answers 401. */
async function clientScope(req, res, { database, auth, resolve, env, body } = {}) {
  const who = await resolve(req, { db: database, env });
  if (who === AUTH_UNAVAILABLE) {
    res.status(503).json({ ok: false, error: "auth_unavailable", db: "down" });
    return null;
  }

  if (who && who.kind === "client") {
    const clientId = who.clientId || null;
    const orgId = who.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    if (!(await requireClientInOrg(res, database, { org_id: orgId }, clientId))) return null;
    return { orgId, clientId };
  }
  if (who && who.kind !== "staff") {
    res.status(403).json({ ok: false, error: "forbidden", message: "this endpoint serves staff, client" });
    return null;
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return null;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return null;

  const clientId = (body && body.client_id) ?? (req.query && req.query.client_id);
  if (!isUuid(clientId)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  if (!(await requireClientInOrg(res, database, staff, String(clientId).trim()))) return null;
  return { orgId: staff.org_id, clientId: String(clientId).trim() };
}
