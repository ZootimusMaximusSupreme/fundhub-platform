// POST /api/banking/sync-accounts — ask a bank provider for a client's accounts
// and write what comes back into `bank_accounts`.
//
// THE FIRST WRITER THIS TABLE HAS EVER HAD. Migration 081 shipped in a state
// where the only `INSERT INTO bank_accounts` in the repository was inside a pg
// test, which is why four sections of the Money Map are empty and cannot be
// exercised. src/banking/plaid.mjs's getAccounts() names "a separate store
// module" that did not exist; src/banking/accounts-store.mjs is now that module
// and this is what reaches it.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THIS IS A WRITE ENDPOINT AND IT IS GATED HARDER THAN THE READS NEXT DOOR
// ═══════════════════════════════════════════════════════════════════════════
// ROLE_SETS.FINANCE — {owner, admin, sales_manager} — not ROLE_SETS.STAFF.
// (sales_manager joined that set by an owner decision recorded at
// src/http/read-api.mjs, H-6, 2026-08-01. This comment said {owner, admin} until
// 2026-08-18 and was simply out of date; the gate itself never changed. A
// funding_advisor can READ balances next door and still cannot create one here.)
//
// api/read/money-map.mjs, read/finance-os and read/banking-surface all serve
// STAFF, and that is right for a read: a closer working a file needs to see it.
// This one CREATES financial rows that every one of those screens then totals
// and that a funding decision rests on. A setter who can read a balance has a
// reason to; a setter who can conjure one does not. Widening this to STAFF would
// mean six roles can put numbers on an owner's money screen.
//
// THE ROLE GATE IS TWO CALLS, NOT ONE ARGUMENT. requireAuth's third parameter is
// { db, env } and goes straight to authenticate(), which reads exactly those two
// names — a `roles` key there is accepted by the object literal and silently
// dropped. api/read/tradelines.mjs shipped that once.
//
// ORG SCOPING COMES FROM THE SESSION AND FAILS CLOSED. A session with no org_id
// is refused before any query. A client in another org reads as 404, because the
// difference between "no such client" and "that client is not yours" is only
// useful to somebody enumerating uuids.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE PROVIDER IS ALWAYS NAMED, AND 'mock' IS NOT A DEFAULT
// ═══════════════════════════════════════════════════════════════════════════
// `provider` is a required parameter. There is no fallback and no default,
// because a default provider is exactly how a mock ends up running in
// production. The mock is additionally gated by its own environment variable
// (`BANKING_MOCK_PROVIDER=1`, exact string) and refuses without it, so turning it
// on is two deliberate acts and neither is a typo.
//
// Rows written by the mock carry `provider = 'mock'` in a NOT NULL column with a
// CHECK (migration 091). api/read/money-map.mjs returns it and the screen prints
// a warning. A made-up balance says so everywhere it appears.
//
// NOTHING TRANSMITS ON THE 'mock' PATH. It reads a fixture in this repository.
// The 'plaid' path DOES transmit: it re-reads the client's linked bank logins from
// Plaid and writes what comes back — src/banking/plaid-refresh.mjs, the same code
// the daily sweep runs. `item_id` (a plaid_items uuid) narrows it to one login;
// without it every readable login is refreshed. A login Plaid says needs the
// client to sign in again is marked link_state='error' and reported per item
// (`relink_needed`), not hidden. Not configured, or Plaid refused: a refusal with
// the reason, passed straight through rather than dressed up as a failure.
//
//
// NOTHING IS DELETED, EVER. An account that has stopped appearing in a
// provider's list is reported in `vanished` and left exactly as it was. An
// absence from one read is not evidence an account was closed, and marking
// `closed_at` on it would be a claim about a real person's finances derived from
// a missing row.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { syncBankAccounts, PROVIDERS } from "../../src/banking/accounts-sync.mjs";
import { describeAccount } from "../../src/banking/accounts-store.mjs";

/* A body may arrive parsed or as a string — netlify/functions/api.mjs parses it
   only when the content-type says JSON, and a caller that forgot the header
   should get a clear answer rather than a crash on `body.provider`. */
export function readBody(raw) {
  if (raw === null || raw === undefined || raw === "") return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return null;
  }
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const sync = deps.syncBankAccounts || syncBankAccounts;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;

  const orgId = staff.org_id;
  if (!orgId) {
    return res.status(403).json({
      ok: false,
      error: "no_org_scope",
      message: "this session is not attached to an organisation, so nothing can be written"
    });
  }

  const body = readBody(req.body);
  if (body === null) {
    return res.status(400).json({ ok: false, error: "body must be JSON" });
  }

  const clientId = body.client_id ?? req.query?.client_id;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  const providerName = body.provider ?? req.query?.provider;
  if (!providerName || typeof providerName !== "string") {
    return res.status(400).json({
      ok: false,
      error: "provider is required",
      message: "name the provider explicitly — there is no default, on purpose",
      known: Object.keys(PROVIDERS)
    });
  }
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, providerName)) {
    return res.status(400).json({
      ok: false,
      error: "unknown_provider",
      known: Object.keys(PROVIDERS)
    });
  }

  const itemId = body.item_id ?? null;
  if (itemId !== null && !isUuid(itemId)) {
    return res.status(400).json({ ok: false, error: "item_id must be a uuid" });
  }

  try {
    /* Scope check BEFORE anything is written. */
    const client = await database.query(
      `SELECT id FROM clients WHERE id = $1 AND org_id = $2`,
      [String(clientId).trim(), orgId]
    );
    if (client.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "no_such_client" });
    }

    /* The clock, at the edge, once. Every balance written is stamped with the
       instant the caller asked, not with a time the store invented — 081:
       balance_as_of is when the figures were TRUE, and NULL there means we do
       not know how stale they are. */
    const asOf = clock().toISOString();

    const result = await sync(database, {
      orgId,
      clientId: String(clientId).trim(),
      providerName,
      asOf,
      itemId,
      env
    });

    if (!result.ok) {
      /* A provider that will not answer is not a server error. 409 says "the
         thing you asked for is not in a state where it can happen" and keeps a
         genuine 500 meaning something broke. The provider's own reason is passed
         through unchanged: "not_configured" and "bad_request" send somebody to
         two different places. A named login this client does not have (or that is
         not readable) is the one 404. */
      return res.status(result.reason === "no_readable_item" ? 404 : 409).json({
        ok: false,
        error: result.reason,
        provider: result.provider ?? providerName,
        missing: result.missing ?? [],
        known: result.known,
        detail: result.detail,
        items: (result.items ?? []).map(itemView),
        written: 0
      });
    }

    return res.status(200).json({
      ok: true,
      provider: result.provider,
      /* The flag the caller must not be able to miss. */
      real: result.real,
      warning: result.real
        ? null
        : "These accounts are NOT REAL. They came from a stand-in provider and every screen showing them says so.",
      as_of: asOf,
      /* false only when nobody was asked: a plaid client with no linked bank. */
      ran: result.ran ?? true,
      reason: result.reason ?? null,
      written: result.written,
      accounts: result.accounts.map((a) => ({
        id: a.id,
        summary: describeAccount(a),
        /* Always 'unknown' on a fresh write, and that is the point: an account
           arriving from a provider carries no ownership this product can trust,
           and somebody has to place it before it counts as the client's money. */
        entity_kind: a.entity_kind
      })),
      /* New since the last read, per login — plaid only. */
      created: result.created ?? [],
      items: (result.items ?? []).map(itemView),
      vanished: result.vanished,
      next: "Open the Money Map for this client to see them: /app/money-map.html?client_id=" + String(clientId).trim()
    });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    throw e;
  }
}

/* One bank login's report, hand-picked field by field — the way sync-transactions
   does it. Nothing from plaid_items' token or cursor columns, and no raw payload. */
function itemView(x) {
  return {
    item_id: x.itemRowId,
    institution: x.institution ?? null,
    ok: x.ok,
    error: x.reason ?? null,
    error_code: x.errorCode ?? null,
    detail: x.error ?? null,
    /* true = Plaid says the client must sign in at the bank again. link_state is
       now 'error' and last_error_code holds why; no screen shows that yet. */
    relink_needed: x.relinkNeeded ?? false,
    balance_source: x.balanceSource ?? null,
    realtime_error: x.realtimeError ?? null,
    /* the login had no stored accounts, so everything on it counted as the baseline */
    first_read: x.firstRead ?? false,
    accounts_read: x.read ?? 0,
    written: x.written ?? 0,
    created: x.created ?? [],
    vanished: x.vanished ?? [],
    balances_changed: x.balancesChanged ?? []
  };
}
