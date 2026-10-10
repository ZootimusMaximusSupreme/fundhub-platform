// Plaid update mode — let a client fix a bank login that stopped working.
//
// THE GAP THIS CLOSES (FinanceOS F2). When a real bank login breaks (Plaid says
// ITEM_LOGIN_REQUIRED, or any other ITEM_ERROR), src/banking/plaid-refresh.mjs and
// plaid-transactions.mjs set plaid_items.link_state = 'error' and last_error_code,
// and from then on the login is never read again. Nothing let the client put it
// right. This file is that, in three calls:
//
//   listBankLoginStatus  what the screen shows: every login, its state, when it was
//                        last read, and what is wrong in plain words.
//   startRelink          a Link token in UPDATE MODE for one login — the browser
//                        opens Link on the client's existing bank so they can sign in
//                        again.
//   finishRelink         the client says "done". We do NOT take their word for it:
//                        we read the bank again, and only a read that works leaves
//                        the login active.
//
// PLAID'S RULES FOR UPDATE MODE (https://plaid.com/docs/link/update-mode/, read
// 2026-10-06), and what this does about each:
//   * The link token is made WITH the Item's access_token, and WITHOUT products. The
//     token is decrypted here, in memory, for that one call (AAD = Plaid's item id,
//     like every reader) and is never returned, logged or put in an error.
//   * NO public_token exchange. Plaid: the access_token does not change in update
//     mode. So finishRelink takes no public_token; there is nothing to exchange.
//   * The Link flow's `onSuccess` fires in update mode, but its public_token is
//     not used. The browser's only job afterwards is to call finish.
//   * `update.account_selection_enabled` lets the person pick NEW accounts at the
//     same bank. startRelink sends it only when asked (`accountSelection`).
//   * An Item restored from ITEM_LOGIN_REQUIRED catches up on what it missed: the
//     next /transactions/sync from the saved cursor returns everything since the
//     last good connection, so no charges are lost while a login was broken. The
//     daily 07:00 sweep reads them; finish reads accounts and balances only.
//
// NOTHING HERE TRANSMITS BY ITSELF. Every Plaid call goes through
// ./providers/plaid-http.mjs (CLAUDE.md §12): createLinkToken here, and
// fetchAccounts inside refreshClientAccounts.
//
// ─────────────────────────────────────────────────────────────────────────────
// A LOGIN IS ACTIVE ONLY AFTER A READ PROVED IT. THE ORDER IN finishRelink:
//
//   1. claim    one UPDATE: link_state 'error' → 'active', last_error_* cleared.
//               Atomic, so two finishes at once cannot both go on. This is needed
//               because refreshClientAccounts reads active logins only.
//   2. refresh  refreshClientAccounts for this one login (the daily job's own
//               code: upserts accounts, never closes or deletes, never sets
//               entity_kind, an unknown balance stays null).
//   3. judge    - the read worked: the login stays active and its "we texted you"
//                 marker is cleared (below).
//               - Plaid still says the client must sign in: refresh already put it
//                 back to 'error' with the new code. We report still_needs_reconnect.
//               - anything else (Plaid or the bank busy, a held call, a token that
//                 will not decrypt): we have NO proof the login works, so it is put
//                 back to 'error' — keeping whatever code the refresh recorded, or
//                 the one it had before. A login must never read "Connected" on the
//                 strength of a button press.
//               - Plaid answered but our own write was refused (write_failed): the
//                 login works, so it stays active, its marker is cleared the same
//                 way, and the failure is reported.
//
// ONE TEXT PER ERROR EPISODE. plaid_items.reconnect_notified_at (migration 474) is
// set when the "needs a quick reconnect" text is queued (src/finance/
// bank-reconnect-notice.mjs) and cleared HERE, only after a read proved the login
// works. That is what ends an episode. A failed finish leaves it alone, so a client
// who tries and fails is not texted again; a login that breaks again later starts a
// new episode and is texted once more.
//
// NO PLAID WEBHOOK ROUTE EXISTS TODAY (api/webhooks/[provider].mjs has no Plaid
// adapter), so Plaid's LOGIN_REPAIRED, PENDING_EXPIRATION and PENDING_DISCONNECT
// webhooks are not received, and nothing here pretends they are. A login Plaid
// repaired on its own stays 'error' here until the client taps the button again.

import { plaidConfigFromEnv, decryptPlaidToken, SEAM_REASONS } from "./plaid.mjs";
import { createLinkToken } from "./providers/plaid-http.mjs";
import { refreshClientAccounts, REFRESH_REASONS } from "./plaid-refresh.mjs";
import { describeItemError, FIX } from "./plaid-item-errors.mjs";

export const RELINK_REASONS = Object.freeze({
  NO_SUCH_LOGIN: "no_such_login",
  NOT_RECONNECTABLE: "not_reconnectable",
  TOKEN_UNREADABLE: "token_unreadable",
  STILL_NEEDS_RECONNECT: "still_needs_reconnect",
  WRITE_FAILED: REFRESH_REASONS.WRITE_FAILED
});

/** Thrown for a caller bug (a bad uuid). The handler turns it into a 400. */
export class RelinkInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "RelinkInputError";
    this.status = 400;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());

/* ── the status read ────────────────────────────────────────────────────────── */

/* link_state → what a screen says. 080's CHECK allows exactly these five. */
const STATES = Object.freeze({
  active: { state: "active", label: "Connected" },
  error: { state: "needs_reconnect", label: "Needs reconnect" },
  revoked: { state: "revoked", label: "Disconnected" },
  pending: { state: "pending", label: "Connecting" },
  unlinked: { state: "not_connected", label: "Not connected" }
});

const toMs = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isNaN(t) ? null : t;
};
const toIso = (v) => {
  const t = toMs(v);
  return t === null ? null : new Date(t).toISOString();
};

/**
 * bankLoginView(row) — one status-read row → the JSON a screen reads. Pure.
 *
 * `last_good_refresh_at` is the later of the last balance read and the last
 * transactions read: the last time WE SUCCESSFULLY READ this login. null = never.
 *
 * `error` is non-null only when something is wrong NOW:
 *   - the login is in 'error' (needs_reconnect): always, with Plaid's last code; or
 *   - the login is 'active' but its latest attempt failed AFTER its last good read
 *     (a bank that was down this morning). An older failure that a later read
 *     outlived is not shown — the transactions sync clears it, and a stale
 *     sentence would tell the client something that is no longer true.
 */
export function bankLoginView(row) {
  const st = STATES[row.link_state] || STATES.unlinked;
  const goodMs = Math.max(toMs(row.balances_as_of) ?? -Infinity, toMs(row.transactions_synced_at) ?? -Infinity);
  const lastGood = Number.isFinite(goodMs) ? new Date(goodMs).toISOString() : null;
  const itemId = typeof row.plaid_item_id === "string" ? row.plaid_item_id : "";

  let error = null;
  const errAt = toMs(row.last_error_at);
  const wrongNow = st.state === "needs_reconnect"
    || (st.state === "active" && row.last_error_code && errAt !== null && (!Number.isFinite(goodMs) || errAt > goodMs));
  if (wrongNow) {
    const d = describeItemError(row.last_error_code);
    error = { code: row.last_error_code ?? null, plain: d.plain, fix: d.fix, at: toIso(row.last_error_at) };
  }

  return {
    item_id: row.id,
    /* 080: a screen must say "unknown bank", never guess one. */
    institution: row.institution_name || "Unknown bank",
    state: st.state,
    state_label: st.label,
    /* false for a practice login (the mock provider's mock:<client> id) and for a
       placeholder row that never had a Plaid Item. Reconnect does not apply. */
    real: itemId !== "" && !itemId.startsWith("mock:"),
    account_count: Number(row.account_count) || 0,
    connected_at: toIso(row.created_at),
    last_good_refresh_at: lastGood,
    error
  };
}

/* The credential column is NOT selected, here or anywhere on this read. */
const STATUS_SQL = `/* relink:status */
  SELECT i.id, i.institution_name, i.plaid_item_id, i.link_state,
         i.last_error_code, i.last_error_at, i.transactions_synced_at, i.created_at,
         (SELECT count(*)::int FROM bank_accounts a
           WHERE a.plaid_item_id = i.id AND a.org_id = i.org_id AND a.closed_at IS NULL) AS account_count,
         (SELECT max(a.balance_as_of) FROM bank_accounts a
           WHERE a.plaid_item_id = i.id AND a.org_id = i.org_id AND a.closed_at IS NULL) AS balances_as_of
    FROM plaid_items i
   WHERE i.org_id = $1 AND i.client_id = $2
     AND ($3::uuid IS NULL OR i.id = $3::uuid)
   ORDER BY i.created_at ASC, i.id ASC`;

/**
 * listBankLoginStatus(db, { orgId, clientId, itemRowId }) → views[]
 *
 * Every bank login of ONE client, oldest first, as bankLoginView() shapes them.
 * `itemRowId` narrows it to one login. Org and client are in the WHERE clause, so
 * another client's login is simply not in the answer.
 */
export async function listBankLoginStatus(db, { orgId, clientId, itemRowId = null } = {}) {
  if (!isUuid(orgId)) throw new RelinkInputError("orgId must be a uuid");
  if (!isUuid(clientId)) throw new RelinkInputError("clientId must be a uuid");
  if (itemRowId !== null && itemRowId !== undefined && !isUuid(itemRowId)) {
    throw new RelinkInputError("itemRowId must be a uuid");
  }
  const res = await db.query(STATUS_SQL, [orgId.trim(), clientId.trim(), itemRowId ? String(itemRowId).trim() : null]);
  return res.rows.map(bankLoginView);
}

/* ── shared pieces ──────────────────────────────────────────────────────────── */

/* One login, scoped to the org AND the client. The credential column is not named:
   this read decides whether a repair may go ahead, and has no use for the secret. */
const READ_LOGIN_SQL = `/* relink:read */
  SELECT id, client_id, plaid_item_id, institution_name, link_state, consent_granted_at,
         last_error_code, last_error_at,
         (encrypted_access_token IS NOT NULL) AS has_access_token
    FROM plaid_items
   WHERE id = $1 AND org_id = $2 AND client_id = $3`;

/* The ONE statement that names the credential, called by startRelink only, after
   the login has been judged repairable. */
const READ_TOKEN_SQL = `/* relink:token */
  SELECT encrypted_access_token
    FROM plaid_items
   WHERE id = $1 AND org_id = $2 AND client_id = $3 AND plaid_item_id IS NOT NULL`;

const CLAIM_SQL = `/* relink:claim */
  UPDATE plaid_items
     SET link_state = 'active', last_error_code = NULL, last_error_at = NULL, updated_at = now()
   WHERE id = $1 AND org_id = $2 AND client_id = $3
     AND link_state = 'error'
     AND encrypted_access_token IS NOT NULL
     AND consent_granted_at IS NOT NULL
     AND plaid_item_id IS NOT NULL
     AND plaid_item_id NOT LIKE 'mock:%'
  RETURNING id`;

const REVERT_SQL = `/* relink:revert */
  UPDATE plaid_items
     SET link_state = 'error',
         last_error_code = COALESCE(last_error_code, $3, 'upstream_error'),
         last_error_at = COALESCE(last_error_at, $4::timestamptz, now()),
         updated_at = now()
   WHERE id = $1 AND org_id = $2 AND link_state = 'active'`;

const END_EPISODE_SQL = `/* relink:episode-end */
  UPDATE plaid_items
     SET reconnect_notified_at = NULL
   WHERE id = $1 AND org_id = $2 AND link_state = 'active' AND reconnect_notified_at IS NOT NULL`;

const readLogin = async (db, { orgId, clientId, itemRowId }) =>
  (await db.query(READ_LOGIN_SQL, [itemRowId, orgId, clientId])).rows[0] || null;

const notConfigured = (cfg) => ({
  ok: false, reason: SEAM_REASONS.NOT_CONFIGURED, missing: [...cfg.missing, ...cfg.problems]
});
const badRequest = (message) => ({ ok: false, reason: SEAM_REASONS.BAD_REQUEST, missing: [message] });
const noSuchLogin = () => ({ ok: false, reason: RELINK_REASONS.NO_SUCH_LOGIN });
const notReconnectable = (message) => ({
  ok: false, reason: RELINK_REASONS.NOT_RECONNECTABLE, plain: message, fix: FIX.CONNECT_AGAIN
});

/** Why a login cannot go through update mode at all, in words — or null if it can.
 *  Only an active or errored login with a stored credential and consent can. */
function ineligible(row) {
  const plaidItemId = typeof row.plaid_item_id === "string" ? row.plaid_item_id : "";
  if (!row.has_access_token || !plaidItemId) {
    return "There is no saved bank connection to fix. Connect your bank again.";
  }
  if (plaidItemId.startsWith("mock:")) {
    return "This is a practice connection, not a real bank. There is nothing to fix.";
  }
  if (row.link_state !== "active" && row.link_state !== "error") {
    return "This bank was disconnected. Connect your bank again.";
  }
  if (!row.consent_granted_at) {
    return "We do not have your OK to read this bank. Connect your bank again.";
  }
  return null;
}

/** Validate the three ids every call takes. Returns a refusal or null. */
function checkIds({ orgId, clientId, itemRowId }) {
  if (!isUuid(orgId) || !isUuid(clientId)) return badRequest("orgId and clientId are required uuids");
  if (!isUuid(itemRowId)) return badRequest("itemRowId must be the plaid_items row id (a uuid)");
  return null;
}

/* ── start ──────────────────────────────────────────────────────────────────── */

/**
 * startRelink(db, { orgId, clientId, itemRowId, accountSelection, env, fetchImpl })
 *   → { ok:true, linkToken, expiration, environment, itemRowId, institution }
 *   | { ok:false, reason, ... }
 *
 * A Link token in update mode for ONE login of ONE client. The browser opens Link
 * with it; the client signs in again at their bank.
 *
 * @param {string} orgId     from the SESSION — never a request body.
 * @param {string} clientId  from the client's own session, or (staff) a client in
 *                           the staff member's org. The login is looked up by org
 *                           AND client, so another client's login is no_such_login.
 * @param {boolean} [accountSelection=false] also let the person pick NEW accounts
 *                           at this bank (Plaid: update.account_selection_enabled).
 *
 * Refusals, all before anything is sent to Plaid: not_configured, bad_request,
 * no_such_login, not_reconnectable (a revoked, unlinked, pending or practice login,
 * or one with no stored credential or no consent), token_unreadable (the stored
 * credential will not decrypt — a key problem, not the client's). A Plaid refusal
 * comes back as upstream_error (or held) with the code, and `plain` and `fix`: an
 * ITEM_NOT_FOUND here says "connect your bank again" rather than "try again".
 */
export async function startRelink(db, {
  orgId, clientId, itemRowId, accountSelection = false, env = process.env, fetchImpl = undefined
} = {}) {
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) return notConfigured(cfg);
  const bad = checkIds({ orgId, clientId, itemRowId });
  if (bad) return bad;

  const row = await readLogin(db, { orgId, clientId, itemRowId });
  if (!row) return noSuchLogin();
  const why = ineligible(row);
  if (why) return notReconnectable(why);

  let accessToken = null;
  try {
    const stored = (await db.query(READ_TOKEN_SQL, [itemRowId, orgId, clientId])).rows[0];
    // AAD is Plaid's item id — the value completeLink sealed it with, and the one
    // every reader decrypts with.
    accessToken = decryptPlaidToken(stored?.encrypted_access_token, { itemId: row.plaid_item_id, env });
  } catch {
    // Never the error's own text: this path is about a credential.
    accessToken = null;
  }
  if (!accessToken) {
    return {
      ok: false, reason: RELINK_REASONS.TOKEN_UNREADABLE,
      plain: "We could not open this saved connection. Connect your bank again.", fix: FIX.CONNECT_AGAIN
    };
  }

  const r = await createLinkToken({ clientUserId: clientId, accessToken, accountSelection: accountSelection === true }, {
    environment: cfg.environment, clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env, fetchImpl
  });
  accessToken = null;

  if (!r.ok) {
    const words = describeItemError(r.errorCode ?? (r.blocked ? "held" : "upstream_error"));
    return {
      ok: false,
      reason: r.blocked ? SEAM_REASONS.HELD : SEAM_REASONS.UPSTREAM_ERROR,
      errorCode: r.errorCode ?? null,
      error: r.error ?? null,
      retryable: !!r.retryable,
      plain: words.plain,
      fix: words.fix
    };
  }
  return {
    ok: true,
    linkToken: r.linkToken,
    expiration: r.expiration,
    environment: cfg.environment,
    itemRowId: row.id,
    institution: row.institution_name ?? null
  };
}

/* ── finish ─────────────────────────────────────────────────────────────────── */

/**
 * finishRelink(db, { orgId, clientId, itemRowId, asOf, env, fetchImpl })
 *   → { ok:true, state:'active', alreadyActive, environment, itemRowId, institution,
 *       written, accounts, created, vanished, balancesChanged }
 *   | { ok:false, reason, state, errorCode?, error?, plain, fix, ... }
 *
 * "The client says it is fixed." Brings the login back to 'active' and refreshes it
 * — but only a read that works keeps it there. See the order in the header.
 *
 * It is also the "check again" button for a login that stopped for a reason that is
 * not the client's (a bank that was down): no Link session is needed first, and a
 * login that is still broken simply comes back as still_needs_reconnect.
 *
 * A login that is ALREADY active is a no-op: no Plaid call, `alreadyActive: true`,
 * `accounts: []`. That keeps this from becoming a button anyone can use to ask Plaid
 * for balances on demand, and makes a second tap on Done harmless.
 *
 * @param {string} asOf ISO instant of the read. Required: this module has no clock,
 *                      so every balance it writes carries what the caller said.
 *
 * Failure reasons: not_configured, bad_request, no_such_login, not_reconnectable,
 * still_needs_reconnect (Plaid still says the client must sign in), token_unreadable,
 * write_failed (Plaid answered; our write was refused), and held / upstream_error
 * (the bank or Plaid could not answer now — the login is back in 'error' and
 * `fix` is check_again).
 */
export async function finishRelink(db, {
  orgId, clientId, itemRowId, asOf, env = process.env, fetchImpl = undefined
} = {}) {
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) return notConfigured(cfg);
  const bad = checkIds({ orgId, clientId, itemRowId });
  if (bad) return bad;
  if (!asOf || Number.isNaN(Date.parse(asOf))) return badRequest("asOf is required and must be a valid time");

  const row = await readLogin(db, { orgId, clientId, itemRowId });
  if (!row) return noSuchLogin();
  const why = ineligible(row);
  if (why) return notReconnectable(why);

  const alreadyActive = (login) => ({
    ok: true, state: "active", alreadyActive: true, environment: cfg.environment,
    itemRowId: login.id, institution: login.institution_name ?? null,
    written: 0, accounts: [], created: [], vanished: [], balancesChanged: []
  });
  if (row.link_state === "active") return alreadyActive(row);

  // 1. claim. Zero rows means another finish (or a revoke) got there first.
  const claimed = await db.query(CLAIM_SQL, [itemRowId, orgId, clientId]);
  if (!claimed.rowCount) {
    const again = await readLogin(db, { orgId, clientId, itemRowId });
    if (!again) return noSuchLogin();
    if (again.link_state === "active") return alreadyActive(again);
    return notReconnectable("This connection changed while we were checking it. Try again.");
  }

  // 2. refresh — the daily job's own code, for this one login.
  const putBack = () => db.query(REVERT_SQL, [itemRowId, orgId, row.last_error_code ?? null, row.last_error_at ?? null]);
  let r;
  try {
    r = await refreshClientAccounts(db, { orgId, clientId, env, asOf, itemRowId, fetchImpl });
  } catch (e) {
    // We claimed the login and could not read it. Do not leave it looking healthy.
    await putBack().catch(() => {});
    throw e;
  }
  const item = Array.isArray(r.items) ? r.items[0] : null;

  // 3. judge.
  if (r.ok && item && item.ok) {
    await db.query(END_EPISODE_SQL, [itemRowId, orgId]);
    return {
      ok: true, state: "active", alreadyActive: false, environment: cfg.environment,
      itemRowId, institution: row.institution_name ?? null,
      written: item.written, accounts: r.accounts,
      created: item.created, vanished: item.vanished, balancesChanged: item.balancesChanged
    };
  }

  if (!item) {
    // refreshClientAccounts refused before reading anything (the login stopped
    // being readable between the claim and now). Nothing proved it works.
    await putBack();
    return r.reason === REFRESH_REASONS.NO_READABLE_ITEM
      ? noSuchLogin()
      : { ok: false, reason: r.reason || SEAM_REASONS.UPSTREAM_ERROR, state: "needs_reconnect",
          ...wordsFor(null, r.reason) };
  }

  if (item.reason === REFRESH_REASONS.WRITE_FAILED) {
    // Plaid answered, so the login works; only our own write was refused. Active
    // stays true — reverting would tell the client to reconnect something that is fine.
    // The bank answered, so the error episode is over too: clear the "we texted you"
    // marker. Left set, a break months from now would find a login that is already
    // marked as told, and the client would never be texted. Best effort — the database
    // that refused one write may refuse this one, and the answer below must still come
    // back as write_failed rather than a 500. If it is refused too, the marker stays
    // set, which is no worse than before this call existed.
    try {
      await db.query(END_EPISODE_SQL, [itemRowId, orgId]);
    } catch {
      // Nothing more to do here: the failure is reported below.
    }
    return {
      ok: false, reason: RELINK_REASONS.WRITE_FAILED, state: "active",
      error: item.error ?? null,
      plain: "Your bank answered, but we could not save the new numbers. We will try again tomorrow.",
      fix: FIX.CHECK_AGAIN
    };
  }

  if (item.relinkNeeded) {
    // refreshItem already put the login back to 'error' and recorded the code.
    return {
      ok: false, reason: RELINK_REASONS.STILL_NEEDS_RECONNECT, state: "needs_reconnect",
      errorCode: item.errorCode ?? null, error: item.error ?? null,
      ...wordsFor(item.errorCode, item.reason)
    };
  }

  // No proof the login works. Back to 'error'.
  await putBack();
  if (item.reason === SEAM_REASONS.BAD_REQUEST) {
    return {
      ok: false, reason: RELINK_REASONS.TOKEN_UNREADABLE, state: "needs_reconnect",
      plain: "We could not open this saved connection. Connect your bank again.", fix: FIX.CONNECT_AGAIN
    };
  }
  return {
    ok: false,
    reason: item.reason === SEAM_REASONS.HELD ? SEAM_REASONS.HELD : SEAM_REASONS.UPSTREAM_ERROR,
    state: "needs_reconnect",
    errorCode: item.errorCode ?? null, error: item.error ?? null, retryable: !!item.retryable,
    ...wordsFor(item.errorCode, item.reason)
  };
}

/* The sentence and the action for a failed read. A code Plaid sent wins; else the
   seam's own word (held, upstream_error). */
function wordsFor(errorCode, reason) {
  const d = describeItemError(errorCode ?? (reason === SEAM_REASONS.HELD ? "held" : "upstream_error"));
  return { plain: d.plain, fix: d.fix };
}

export default { listBankLoginStatus, bankLoginView, startRelink, finishRelink, RELINK_REASONS, RelinkInputError };
