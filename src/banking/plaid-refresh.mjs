// Plaid account refresh — the daily re-read of every linked login's account list
// and balances.
//
// THE GAP THIS CLOSES (found 2026-10-07). Nothing re-read a client's Plaid
// accounts after the day they linked. completeLink() (plaid-link.mjs) wrote the
// account list once; from then on the balances went stale, and a card opened
// later at the same bank never reached bank_accounts. The cash-cushion and
// new-credit alerts (src/finance/file-alerts/) read bank_accounts as it stands, so
// both ran on that frozen picture. accounts-sync.mjs, which should have been the
// re-read, called the Plaid seam without the token and could never succeed.
//
// This file holds no network code. Every call to Plaid goes through
// ./providers/plaid-http.mjs (CLAUDE.md §12). The access token is decrypted here,
// in memory, for one read, and is never returned, logged or put in an error.
//
// WHAT ONE REFRESH DOES, PER LOGIN (a plaid_items row that is active, consented and
// holds a token — the same filter the transactions and liabilities reads use):
//   1. decrypt the token (AAD = Plaid's item id, the value completeLink used),
//   2. read the account list and balances from Plaid,
//   3. write every account through the existing store: saveAccounts() with the
//      completeLink() mapping (toStoreAccount). A balance that changed is updated;
//      an account that is new is created; nothing is added twice, because the
//      write is an upsert on (plaid_item_id, plaid_account_id).
//
// WHICH PLAID CALL. The default is /accounts/get. It answers from Plaid's cache,
// which an Item with transactions refreshes about once a day, and it is not billed.
// /accounts/balance/get asks the bank now; Plaid bills it per successful call and
// it is slow (about 3 seconds median, 11 at the 95th percentile, per login), so it is
// OFF unless PLAID_REALTIME_BALANCES is exactly "1". Turn it on knowing that a client
// with several logins can then run past the 26 seconds one daily-sweep step gets
// (plaid-transactions-sweeper.mjs). With it on, a real-time read that fails for any
// reason other than a broken login falls back to /accounts/get, so a flaky bank costs
// one day of freshness and never the whole refresh. Every row records which call its
// balance came from in raw.balance_source. See plaid-http.mjs fetchBalances.
//
// WHAT THIS NEVER DOES
//   * It never decides whose money an account is. entity_kind (and the container)
//     is not in the store's column list, so a refresh cannot set it or reset what a
//     person already set. A new account arrives 'unknown', like every ingest.
//   * It never deletes or closes. An account Plaid stopped listing is REPORTED in
//     `vanished` and left exactly as it was — an absence from one read is not
//     evidence an account is gone (accounts-store.mjs says the same). Plaid can
//     also issue a new account_id when a bank renames an account; that shows up
//     here as one created and one vanished, and a person decides what it is.
//   * It never turns an unknown balance into 0. NULL stays NULL (store rule 1).
//
// A LOGIN THAT NEEDS THE CLIENT. When Plaid answers ITEM_ERROR (ITEM_LOGIN_REQUIRED
// and its relatives) the client must sign in at the bank again. The row gets
// link_state='error' and last_error_code, exactly as the transactions sync marks it,
// and the report says relinkNeeded. Any other failure (rate limit, Plaid down, a
// held call) leaves the login active and just records the code. One login's failure
// never stops the next.
//
// THE NEW-CREDIT ALERT READS WHAT THIS WRITES (src/finance/file-alerts/new-credit.mjs).
// It calls a credit or loan row on a linked login "new" when the row was created
// more than 60 minutes after the login. A row created here gets created_at = now,
// so a card opened at the bank since the link IS seen, once, by the next alert run.
// Rows that already exist are updated, never re-created, so their created_at — and
// the alert's baseline — does not move.
//
// ONE EXCEPTION, AND IT IS THE FIRST READ. A login that has no stored accounts at
// all (the link died between saving the login and saving its accounts) is read for
// the first time here, possibly days after it was made. Left alone, every card on
// it would look "created more than 60 minutes after the login" and the client would
// be told, card by card, that they had opened new credit. Linking your cards is not
// opening them, so those rows are given the login's own created_at: the same
// baseline the alert already gives the accounts a normal link brings in.

import { db as sharedDb, pool } from "../db.mjs";
import { plaidConfigFromEnv, decryptPlaidToken, SEAM_REASONS } from "./plaid.mjs";
import { fetchAccounts, fetchBalances } from "./providers/plaid-http.mjs";
import { saveAccounts, AccountStoreError } from "./accounts-store.mjs";
import { toStoreAccount } from "./plaid-link.mjs";

/** The cost switch. Exactly "1" turns real-time balances on; anything else is off. */
export const REALTIME_ENV = "PLAID_REALTIME_BALANCES";

export const REFRESH_REASONS = Object.freeze({
  NO_LINKED_BANK: "no_linked_bank",
  NO_READABLE_ITEM: "no_readable_item",
  WRITE_FAILED: "write_failed"
});

/** Where a stored balance came from, for raw.balance_source. */
export const BALANCE_SOURCES = Object.freeze({
  CACHED: "accounts_get",
  REALTIME: "accounts_balance_get"
});

const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function realtimeBalancesOn(env = process.env) {
  return env?.[REALTIME_ENV] === "1";
}

/**
 * toRefreshAccount(a, { asOf, source }) — one parsed Plaid account → the input the
 * store takes. Pure. The completeLink() mapping, plus the call the balance came
 * from: /accounts/get answers from Plaid's cache, so `balance_as_of` (the instant we
 * asked) can be up to about a day ahead of the figures, and the row says so.
 */
export function toRefreshAccount(a, { asOf, source = BALANCE_SOURCES.CACHED } = {}) {
  const row = toStoreAccount(a, { asOf });
  return { ...row, raw: { ...row.raw, balance_source: source } };
}

/** Logins this client has that can be read, oldest first. `itemRowId` narrows it to
 *  one (a plaid_items.id). created_at comes along for the first-read rule above. */
export async function readRefreshItems(db, { orgId, clientId, itemRowId = null }) {
  const res = await db.query(
    `SELECT id, plaid_item_id, institution_name, encrypted_access_token, created_at
       FROM plaid_items
      WHERE org_id = $1 AND client_id = $2
        AND link_state = 'active'
        AND consent_granted_at IS NOT NULL
        AND encrypted_access_token IS NOT NULL
        AND plaid_item_id IS NOT NULL
        AND plaid_item_id NOT LIKE 'mock:%'
        AND ($3::uuid IS NULL OR id = $3::uuid)
      ORDER BY created_at ASC`,
    [orgId, clientId, itemRowId]
  );
  return res.rows;
}

const BEFORE_SQL = `
  SELECT id, plaid_account_id, name, mask, account_type, closed_at,
         current_balance_cents, available_balance_cents
    FROM bank_accounts
   WHERE org_id = $1 AND client_id = $2 AND plaid_item_id = $3`;

const BASELINE_SQL = `
  UPDATE bank_accounts
     SET created_at = LEAST(created_at, $4::timestamptz)
   WHERE org_id = $1 AND client_id = $2 AND plaid_item_id = $3
     AND id = ANY($5::uuid[])`;

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** The balance moves between a stored row and the row just written; null when
 *  nothing about the balance changed. Unknown (null) is a value, not zero. */
function balanceMove(prev, next) {
  const cur = [num(prev.current_balance_cents), num(next.current_balance_cents)];
  const avl = [num(prev.available_balance_cents), num(next.available_balance_cents)];
  if (cur[0] === cur[1] && avl[0] === avl[1]) return null;
  return {
    id: next.id, name: next.name ?? null, mask: next.mask ?? null,
    current: { before: cur[0], after: cur[1] },
    available: { before: avl[0], after: avl[1] }
  };
}

const view = (a) => ({
  id: a.id, name: a.name ?? null, mask: a.mask ?? null,
  account_type: a.account_type ?? null, account_subtype: a.account_subtype ?? null
});

const emptyTotals = () => ({
  items: 0, itemsOk: 0, itemsFailed: 0, relink: 0,
  written: 0, created: 0, vanished: 0, balancesChanged: 0
});

const refused = (reason, extra = {}) => ({
  ok: false, reason, ran: false, environment: null, balanceSource: null,
  items: [], totals: emptyTotals(), accounts: [], created: [], vanished: [], missing: [],
  ...extra
});

/**
 * refreshItem — one Plaid login. Never throws for a Plaid failure; returns it.
 * `rows` on the report is the store's rows for the accounts it wrote (the caller
 * lifts them out; they are not part of the per-login report).
 */
async function refreshItem(db, item, { orgId, clientId, env, asOf, cfg, realtime, fetchImpl }) {
  const out = {
    itemRowId: item.id, institution: item.institution_name ?? null,
    ok: false, reason: null, errorCode: null, errorType: null, error: null, retryable: false,
    relinkNeeded: false, balanceSource: null, realtimeError: null, firstRead: false,
    read: 0, skippedNoId: 0, written: 0,
    created: [], vanished: [], balancesChanged: [], rows: []
  };

  let accessToken;
  try {
    // AAD is Plaid's item id — the value completeLink encrypted with.
    accessToken = decryptPlaidToken(item.encrypted_access_token, { itemId: item.plaid_item_id, env });
  } catch (e) {
    out.reason = SEAM_REASONS.BAD_REQUEST;
    out.errorCode = "token_decrypt_failed";
    out.error = `stored access token could not be decrypted: ${e.message}`;
    return out;
  }

  const opts = {
    environment: cfg.environment, clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env, fetchImpl
  };
  let usedSource = BALANCE_SOURCES.CACHED;
  let r;
  if (realtime) {
    r = await fetchBalances(accessToken, {
      ...opts,
      // Plaid needs a floor for Capital One cards; the rest ignore it. A day old is
      // the oldest balance a daily job should accept.
      minLastUpdatedDatetime: new Date(Date.parse(asOf) - DAY_MS).toISOString()
    });
    usedSource = BALANCE_SOURCES.REALTIME;
    /* A broken login or a held call will fail the same way on /accounts/get, so
       only the other failures fall back. The real-time failure is kept on the
       report so nobody wonders why a "real-time" run read the cache. */
    if (!r.ok && !r.blocked && r.errorType !== "ITEM_ERROR") {
      out.realtimeError = r.errorCode ?? r.error ?? "real_time_read_failed";
      r = await fetchAccounts(accessToken, opts);
      usedSource = BALANCE_SOURCES.CACHED;
    }
  } else {
    r = await fetchAccounts(accessToken, opts);
  }
  accessToken = null;
  out.balanceSource = usedSource;

  if (!r.ok) {
    out.reason = r.blocked ? SEAM_REASONS.HELD : SEAM_REASONS.UPSTREAM_ERROR;
    out.errorCode = r.errorCode ?? null;
    out.errorType = r.errorType ?? null;
    out.error = r.error ?? null;
    out.retryable = !!r.retryable;
    if (!r.blocked) {
      /* ITEM_ERROR is Plaid saying the client must log in again. Anything else
         (rate limit, Plaid down) leaves the link alone and just records it. The
         state only ever moves off 'active': a login that is no longer active by
         the time this runs is left as it is. */
      out.relinkNeeded = r.errorType === "ITEM_ERROR";
      await db.query(
        `UPDATE plaid_items
            SET last_error_code = $3, last_error_at = now(),
                link_state = CASE WHEN $4 AND link_state = 'active' THEN 'error' ELSE link_state END,
                updated_at = now()
          WHERE id = $1 AND org_id = $2`,
        [item.id, orgId, r.errorCode ?? r.errorType ?? "upstream_error", out.relinkNeeded]
      );
    }
    return out;
  }

  /* An account with no Plaid id could not be matched on tomorrow's read, so the
     upsert would add it again every day. Plaid always sends one; this is the
     guard against the day it does not. */
  const usable = r.accounts.filter((a) => a.plaidAccountId);
  out.read = r.accounts.length;
  out.skippedNoId = r.accounts.length - usable.length;

  const before = (await db.query(BEFORE_SQL, [orgId, clientId, item.id])).rows;
  const beforeByPlaidId = new Map(before.map((b) => [b.plaid_account_id, b]));

  /* saveAccounts opens a real transaction only when it is handed something with
     connect() — a pool. The shared handle is { query } and nothing else, so on it
     every upsert would be its own autocommit statement and a failure half way
     would leave some balances fresh and some not. */
  const writer = db === sharedDb ? pool() : db;
  let saved;
  try {
    saved = await saveAccounts(
      writer,
      usable.map((a) => toRefreshAccount(a, { asOf, source: usedSource })),
      { orgId, clientId, provider: "plaid", plaidItemId: item.id }
    );
  } catch (e) {
    // A shape the store refused is this login's problem. Anything else is ours.
    if (!(e instanceof AccountStoreError)) throw e;
    out.reason = REFRESH_REASONS.WRITE_FAILED;
    out.error = e.message;
    return out;
  }

  const seen = new Set(saved.accounts.map((a) => a.plaid_account_id));
  out.written = saved.written;
  out.rows = saved.accounts;
  const createdRows = saved.accounts.filter((a) => !beforeByPlaidId.has(a.plaid_account_id));
  out.created = createdRows.map(view);
  for (const a of saved.accounts) {
    const prev = beforeByPlaidId.get(a.plaid_account_id);
    const move = prev ? balanceMove(prev, a) : null;
    if (move) out.balancesChanged.push(move);
  }
  /* Only OPEN stored accounts count as vanished: Plaid stops listing a closed
     account, which is expected and not news. */
  out.vanished = before
    .filter((b) => b.plaid_account_id && !b.closed_at && !seen.has(b.plaid_account_id))
    .map((b) => ({
      ...view(b),
      note: "this account was stored before and did not appear in the latest read. " +
        "It has NOT been closed or removed — an absence from one read is not evidence an account is gone."
    }));

  /* The first read of this login: see the header. Its own statement after the
     save commits, and only for the rows this read just created. LEAST means a row
     is never moved later than it already is. */
  if (before.length === 0 && createdRows.length > 0) {
    out.firstRead = true;
    await db.query(BASELINE_SQL, [orgId, clientId, item.id, item.created_at, createdRows.map((a) => a.id)]);
  }

  out.ok = true;
  return out;
}

/**
 * refreshClientAccounts(db, { orgId, clientId, env, asOf, itemRowId, fetchImpl })
 *
 * Every readable Plaid login of one client → bank_accounts. `itemRowId` (a
 * plaid_items.id) refreshes just that login.
 *
 * @param {string} orgId    from the SESSION or the sweeper's own list — never a body.
 * @param {string} asOf     ISO instant of the read. Required: this module has no
 *                          clock, so every balance is stamped with what the caller said.
 *
 * @returns {{ ok, reason, ran, environment, balanceSource, items[], totals,
 *             accounts[], created[], vanished[], missing[] }}
 *
 * `ok` is true when at least one login was read. `items` is the per-login report;
 * `accounts` is every stored row written (the shape accounts-sync hands the
 * endpoint); `created` and `vanished` are the logins' lists joined. A refusal
 * (not configured, bad input, no such login) writes nothing and says why.
 */
export async function refreshClientAccounts(db, {
  orgId, clientId, env = process.env, asOf, itemRowId = null, fetchImpl = undefined
} = {}) {
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) {
    return refused(SEAM_REASONS.NOT_CONFIGURED, { missing: [...cfg.missing, ...cfg.problems] });
  }
  if (!orgId || !clientId || !asOf || Number.isNaN(Date.parse(asOf))) {
    return refused(SEAM_REASONS.BAD_REQUEST, { missing: ["orgId, clientId and a valid asOf are required"] });
  }
  if (itemRowId !== null && itemRowId !== undefined && !UUID_RE.test(String(itemRowId))) {
    return refused(SEAM_REASONS.BAD_REQUEST, { missing: ["itemId must be the plaid_items row id (a uuid)"] });
  }
  const named = itemRowId ? String(itemRowId).trim() : null;

  const realtime = realtimeBalancesOn(env);
  const items = await readRefreshItems(db, { orgId, clientId, itemRowId: named });
  if (items.length === 0) {
    return named
      ? refused(REFRESH_REASONS.NO_READABLE_ITEM, {
        environment: cfg.environment,
        missing: ["no active, consented bank login with that id for this client"]
      })
      : {
        ...refused(REFRESH_REASONS.NO_LINKED_BANK, { environment: cfg.environment }),
        ok: true
      };
  }

  const totals = emptyTotals();
  const reports = [];
  const accounts = [];
  const created = [];
  const vanished = [];
  for (const item of items) {
    const { rows, ...report } = await refreshItem(db, item, { orgId, clientId, env, asOf, cfg, realtime, fetchImpl });
    reports.push(report);
    totals.items += 1;
    if (report.ok) totals.itemsOk += 1; else totals.itemsFailed += 1;
    if (report.relinkNeeded) totals.relink += 1;
    totals.written += report.written;
    totals.created += report.created.length;
    totals.vanished += report.vanished.length;
    totals.balancesChanged += report.balancesChanged.length;
    accounts.push(...rows);
    created.push(...report.created);
    vanished.push(...report.vanished);
  }

  const anyOk = totals.itemsOk > 0;
  return {
    ok: anyOk,
    reason: anyOk ? null : (reports[0]?.reason || SEAM_REASONS.UPSTREAM_ERROR),
    ran: true,
    environment: cfg.environment,
    balanceSource: realtime ? BALANCE_SOURCES.REALTIME : BALANCE_SOURCES.CACHED,
    items: reports,
    totals,
    accounts,
    created,
    vanished,
    missing: []
  };
}

export default { refreshClientAccounts, readRefreshItems, toRefreshAccount, realtimeBalancesOn };
