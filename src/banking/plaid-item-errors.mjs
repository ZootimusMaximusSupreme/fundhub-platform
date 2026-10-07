// Why a bank login stops working, in words a client can read — and what the
// screen should offer them. Pure: a code in, a sentence and an action out. No
// database, no network, no clock.
//
// WHERE THE CODES COME FROM. plaid_items.last_error_code holds whatever Plaid said
// last: its own error_code (src/banking/plaid-refresh.mjs and plaid-transactions.mjs
// write `errorCode ?? errorType ?? "upstream_error"`), or one of this repo's own
// words (completeLink writes the seam's `reason`). link_state flips to 'error' for
// ANY error_type of ITEM_ERROR, so every ITEM_ERROR code below can be sitting in an
// 'error' row. The other codes (a bank that is down, a rate limit) are recorded
// while the login stays 'active'.
//
// THE WORDS ARE OURS, THE FACTS ARE PLAID'S. Each row below is read off Plaid's own
// pages (checked 2026-10-06) and paraphrased in short sentences for the client. The
// pages, so a disputed row can be checked against the source:
//   Item errors (ITEM_ERROR codes) ........ https://plaid.com/docs/errors/item/
//   Institution errors .................... https://plaid.com/docs/errors/institution/
//   Rate limits ........................... https://plaid.com/docs/errors/rate-limit-exceeded/
//   Item webhooks (PENDING_EXPIRATION,
//     PENDING_DISCONNECT, USER_*_REVOKED) .. https://plaid.com/docs/api/items/#webhooks
//   Link update mode (the fix) ............ https://plaid.com/docs/link/update-mode/
// The webhook-only codes are mapped for the day a Plaid webhook route exists; there
// is none today (no api/webhooks adapter for Plaid), so nothing stores them yet.
//
// WHAT THE SCREEN SHOULD OFFER — the `fix`:
//   reconnect      Open Plaid Link in update mode (POST /api/banking/relink
//                  {action:"start"}), then tell us it is done ({action:"finish"}).
//                  Plaid's own remedy for ITEM_LOGIN_REQUIRED and the codes that
//                  say "sign in again". Some of these need something done at the
//                  bank FIRST (`firstAtBank`); the words say so.
//   check_again    Nothing is wrong with the person's login. The bank or Plaid is
//                  busy, or still getting data ready. {action:"finish"} reads the
//                  bank again and says what happened; no Link needed.
//   connect_again  Plaid says this login cannot be repaired. Connect the bank as a
//                  new login (POST /api/banking/link-token, then link-exchange).
//
// WHO GETS A TEXT — `notify`. Only the `reconnect` codes. A text that says "needs a
// quick reconnect" must be true: it is not for a bank that is down (nothing the
// client can do) or a login Plaid cannot repair (a reconnect would not work). An
// unmapped code is shown with the generic words and the reconnect fix — the screen
// can still try — but is never texted, because nobody has checked it is fixable.
//
// NO JARGON IN `plain`. These sentences reach a client, at a 4th grade level
// (CLAUDE.md, owner-set 2026-10-05). They never say "Plaid", "token", "API" or show
// a code. The code travels beside them for staff.

export const FIX = Object.freeze({
  RECONNECT: "reconnect",
  CHECK_AGAIN: "check_again",
  CONNECT_AGAIN: "connect_again"
});

const row = (fix, plain, { firstAtBank = false } = {}) =>
  Object.freeze({ fix, plain, firstAtBank, notify: fix === FIX.RECONNECT });

export const ITEM_ERRORS = Object.freeze({
  /* ── reconnect: Plaid says the person must sign in again (update mode) ──────── */
  ITEM_LOGIN_REQUIRED: row(FIX.RECONNECT, "Your bank needs you to sign in again."),
  INVALID_CREDENTIALS: row(FIX.RECONNECT, "Your bank did not take your username or password. Sign in again."),
  INVALID_MFA: row(FIX.RECONNECT, "Your bank did not take the security answer. Try again."),
  INVALID_OTP: row(FIX.RECONNECT, "Your bank did not take the one-time code. Try again."),
  INVALID_PHONE_NUMBER: row(FIX.RECONNECT, "Your bank did not take that phone number. Try again."),
  INVALID_UPDATED_USERNAME: row(FIX.RECONNECT,
    "That username is not the one we have. Use the same username, or connect your bank again."),
  INSUFFICIENT_CREDENTIALS: row(FIX.RECONNECT,
    "You did not finish signing in at your bank. Try again and finish each step."),
  ACCESS_NOT_GRANTED: row(FIX.RECONNECT,
    "You did not share the accounts we need. Reconnect and pick what to share."),
  PENDING_EXPIRATION: row(FIX.RECONNECT,
    "Your OK to share this bank is about to run out. Reconnect to keep it going."),
  PENDING_DISCONNECT: row(FIX.RECONNECT,
    "Your bank is about to cut this connection. Reconnect to keep it going."),
  USER_PERMISSION_REVOKED: row(FIX.RECONNECT,
    "You took back your OK to share this bank. Reconnect if you want us to see it again."),
  USER_ACCOUNT_REVOKED: row(FIX.RECONNECT,
    "You took back access at your bank. Reconnect to share it again."),

  /* ── reconnect, but something has to happen at the bank first ────────────────── */
  PASSWORD_RESET_REQUIRED: row(FIX.RECONNECT,
    "Your bank wants you to reset your password. Do that at your bank first. Then reconnect.",
    { firstAtBank: true }),
  USER_SETUP_REQUIRED: row(FIX.RECONNECT,
    "Your bank needs you to finish a step on its website first. Do that. Then reconnect.",
    { firstAtBank: true }),
  ITEM_LOCKED: row(FIX.RECONNECT,
    "Your bank locked this account. Ask your bank to unlock it first. Then reconnect.",
    { firstAtBank: true }),

  /* ── check_again: not the person's doing; the bank or Plaid is busy ──────────── */
  PRODUCT_NOT_READY: row(FIX.CHECK_AGAIN, "Your bank is still getting your data ready. Check again in a few minutes."),
  INSTITUTION_DOWN: row(FIX.CHECK_AGAIN, "Your bank is down for now. We will keep trying."),
  INSTITUTION_NOT_RESPONDING: row(FIX.CHECK_AGAIN, "Your bank is not answering right now. We will keep trying."),
  INSTITUTION_NOT_AVAILABLE: row(FIX.CHECK_AGAIN, "We cannot reach your bank right now. We will keep trying."),
  RATE_LIMIT_EXCEEDED: row(FIX.CHECK_AGAIN, "We asked your bank too many times. We will try again soon."),
  /* This repo's own words, not Plaid's: a timeout or a 5xx with no error body
     (refresh writes "upstream_error"), and a call the adapters fence held. */
  upstream_error: row(FIX.CHECK_AGAIN, "We could not reach your bank just now. We will try again."),
  held: row(FIX.CHECK_AGAIN, "We could not check your bank just now. Try again in a little while."),

  /* ── connect_again: Plaid says this login cannot be repaired ─────────────────── */
  ITEM_NOT_FOUND: row(FIX.CONNECT_AGAIN, "This bank connection was removed. Connect your bank again."),
  ITEM_CONCURRENTLY_DELETED: row(FIX.CONNECT_AGAIN, "This bank connection was removed. Connect your bank again."),
  ITEM_NOT_SUPPORTED: row(FIX.CONNECT_AGAIN, "We cannot read this bank account. Connect a different one."),
  MFA_NOT_SUPPORTED: row(FIX.CONNECT_AGAIN,
    "Your bank uses a security step we cannot handle. Connect a different account."),
  NO_ACCOUNTS: row(FIX.CONNECT_AGAIN,
    "We found no open accounts at this bank. Connect a different bank or account."),
  INSTITUTION_NO_LONGER_SUPPORTED: row(FIX.CONNECT_AGAIN, "We can no longer connect to this bank."),
  PRODUCT_NOT_ENABLED: row(FIX.CONNECT_AGAIN,
    "This connection was set up without something we need. Connect your bank again."),
  PRODUCTS_NOT_SUPPORTED: row(FIX.CONNECT_AGAIN,
    "This connection was set up without something we need. Connect your bank again.")
});

const RATE_LIMIT_CODE = /^[A-Z][A-Z_]*_LIMIT$/;

/** A code nobody has mapped. Shown, offered the reconnect fix, never texted. */
const UNKNOWN = Object.freeze({
  fix: FIX.RECONNECT,
  plain: "Your bank connection stopped working. Reconnect it to keep your balances fresh.",
  firstAtBank: false,
  notify: false
});

/** Every code a text may go out for. The notice query filters on this list. */
export const NOTIFY_CODES = Object.freeze(
  Object.keys(ITEM_ERRORS).filter((code) => ITEM_ERRORS[code].notify)
);

/**
 * describeItemError(code) → { code, plain, fix, firstAtBank, notify, known }
 *
 * Total: any input gives an answer. null, "" and a code nobody mapped all get the
 * generic words (`known: false`). A code is looked up as an OWN key, so
 * "constructor" and "__proto__" are unknown codes, not objects off the prototype.
 */
export function describeItemError(code) {
  const key = typeof code === "string" ? code.trim() : "";
  const hit = key && Object.prototype.hasOwnProperty.call(ITEM_ERRORS, key) ? ITEM_ERRORS[key] : null;
  if (hit) return { code: key, ...hit, known: true };
  /* A rate limit is stored under the ENDPOINT'S code, not under its error_type
     (plaid-refresh and plaid-transactions write `errorCode ?? errorType`). Plaid
     names those codes per endpoint — ACCOUNTS_LIMIT, TRANSACTIONS_LIMIT,
     ITEM_GET_LIMIT, RATE_LIMIT and so on — and answers every one with error_type
     RATE_LIMIT_EXCEEDED (https://plaid.com/docs/errors/rate-limit-exceeded/). They
     all read the same to a client: busy, try again soon. */
  if (RATE_LIMIT_CODE.test(key)) return { code: key, ...ITEM_ERRORS.RATE_LIMIT_EXCEEDED, known: true };
  return { code: key || null, ...UNKNOWN, known: false };
}

export default { FIX, ITEM_ERRORS, NOTIFY_CODES, describeItemError };
