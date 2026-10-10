// Plaid Transfer as a money-movement PROVIDER for FinanceOS (wave 5, unit W7).
//
// The engine (src/finance/money-transfers.mjs) speaks in legs: "debit this
// account $20.00", "credit that one", "what happened since event 41". This file
// turns a leg into Plaid calls. It holds no network code — every request goes
// through ./providers/plaid-http.mjs (CLAUDE.md §12) — and it is the only place
// a stored access token is decrypted for a transfer. The plaintext lives for one
// call and is never returned, logged or put in an error.
//
// HOW PLAID MOVES MONEY (https://plaid.com/docs/transfer/flow-of-funds/):
//   debit  — pulls money from the client's linked account INTO Fundhub's Plaid
//            Ledger balance (pending, then available after a hold).
//   credit — pays money OUT of the Ledger's available balance to a linked account.
// So a move from account A to account B is two transfers: debit A, wait for
// funds_available, then credit B. A move to Fundhub is the debit alone.
//
// ONE PROVIDER INTERFACE, TWO IMPLEMENTATIONS:
//   plaidTransferProvider — the real one, pinned to the environment the gate
//                           allowed (sandbox unless both production switches).
//   transfersNotEnabledProvider — every call answers { ok:false,
//                           reason:"plaid_transfer_not_enabled" } and sends
//                           nothing. Used when Plaid says Transfer is not on for
//                           this account, so the rest of FinanceOS (proposals,
//                           approvals, the ledger, the screen) still runs.
import { decryptPlaidToken } from "./plaid.mjs";
import {
  authorizeTransfer, createTransfer, getTransfer, cancelTransfer, syncTransferEvents,
  getTransferLedger, sandboxSimulateTransfer, sandboxSimulateLedgerAvailable
} from "./providers/plaid-http.mjs";

export const PROVIDER_NAME = "plaid_transfer";
export const NOT_ENABLED = "plaid_transfer_not_enabled";

/* What the bank prints on the statement, ≤ 10 characters on ACH. Plaid's own
   suggestions: "TRANSFER" for a transfer between a user's accounts, "PAYMENT"
   for a consumer debit (https://plaid.com/docs/transfer/creating-transfers/,
   "Description field recommendations"). */
export const DESCRIPTIONS = Object.freeze({ bank_account: "TRANSFER", fundhub: "PAYMENT" });

/**
 * centsToPlaidAmount(2000) → "20.00". Integer maths only: Plaid wants a decimal
 * string with two digits, and a float would turn 1999 into "19.990000000000002".
 */
export function centsToPlaidAmount(cents) {
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  const whole = Math.floor(cents / 100);
  const part = String(cents % 100).padStart(2, "0");
  return `${whole}.${part}`;
}

/**
 * achClassFor({ entityKind, type }) — the ACH SEC code.
 * https://plaid.com/docs/transfer/creating-transfers/#ach-sec-codes
 *   business account          → ccd (corporate credit or debit)
 *   personal / unknown, debit → web (the client said yes in our web app)
 *   personal / unknown, credit→ ppd (credits allow ccd or ppd only)
 * Unknown is read as personal on purpose: a business code on a consumer
 * account invites an R05 return, the consumer code does not.
 */
export function achClassFor({ entityKind, type }) {
  if (entityKind === "business") return "ccd";
  return type === "credit" ? "ppd" : "web";
}

const fail = (reason, extra = {}) => ({ ok: false, reason, retryable: false, ...extra });

function fromPlaid(r) {
  return {
    ok: false,
    reason: r.blocked ? "held" : "provider_error",
    blocked: !!r.blocked,
    retryable: !!r.retryable,
    errorCode: r.errorCode ?? null,
    errorType: r.errorType ?? null,
    error: r.error ?? null,
    status: r.status ?? 0
  };
}

/* The stored token for one account, decrypted for one call. */
function tokenFor(account, env) {
  const item = account && account.item;
  if (!item || !item.plaid_item_id || !item.encrypted_access_token) return { error: "no_bank_login" };
  if (item.link_state !== "active" || !item.consent_granted_at) return { error: "bank_login_not_active" };
  try {
    return { token: decryptPlaidToken(item.encrypted_access_token, { itemId: item.plaid_item_id, env }) };
  } catch {
    return { error: "token_unreadable" };
  }
}

/**
 * plaidTransferProvider({ env, environment, fetchImpl })
 *
 * `environment` comes from the gate (transferMode in money-transfers.mjs) and
 * is the only host this provider will ever use. plaid-http.mjs refuses the
 * production host again unless both production switches are set.
 */
export function plaidTransferProvider({ env = process.env, environment = "sandbox", fetchImpl = undefined } = {}) {
  const opts = { environment, clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env, fetchImpl };

  return {
    name: PROVIDER_NAME,
    environment,
    enabled: true,

    async authorizeLeg({ type, account, amountCents, network = "ach", legalName, idempotencyKey }) {
      const amount = centsToPlaidAmount(amountCents);
      if (!amount) return fail("bad_amount");
      if (!account || !account.plaid_account_id) return fail("no_bank_login");
      const t = tokenFor(account, env);
      if (t.error) return fail(t.error);
      const r = await authorizeTransfer(t.token, {
        accountId: account.plaid_account_id,
        type,
        network,
        amount,
        achClass: achClassFor({ entityKind: account.entity_kind, type }),
        legalName,
        idempotencyKey,
        userPresent: false
      }, opts);
      if (!r.ok) return fromPlaid(r);
      return {
        ok: true,
        authorizationId: r.authorization.id,
        decision: r.authorization.decision,
        rationaleCode: r.authorization.rationaleCode,
        rationaleDescription: r.authorization.rationaleDescription
      };
    },

    async createLeg({ account, authorizationId, amountCents, description, metadata }) {
      const amount = centsToPlaidAmount(amountCents);
      if (!amount) return fail("bad_amount");
      if (!account || !account.plaid_account_id) return fail("no_bank_login");
      const t = tokenFor(account, env);
      if (t.error) return fail(t.error);
      const r = await createTransfer(t.token, {
        accountId: account.plaid_account_id, authorizationId, amount, description, metadata
      }, opts);
      if (!r.ok) return fromPlaid(r);
      return { ok: true, transferId: r.transfer.id, status: r.transfer.status, transfer: r.transfer };
    },

    async getLeg(transferId) {
      const r = await getTransfer({ transferId }, opts);
      if (!r.ok) return fromPlaid(r);
      return { ok: true, transfer: r.transfer };
    },

    async cancelLeg(transferId) {
      const r = await cancelTransfer(transferId, opts);
      if (!r.ok) return fromPlaid(r);
      return { ok: true };
    },

    async eventsPage(afterId) {
      const r = await syncTransferEvents({ afterId, count: 500 }, opts);
      if (!r.ok) return fromPlaid(r);
      return { ok: true, events: r.events, hasMore: r.hasMore, lastId: r.lastId };
    },

    async ledger() {
      const r = await getTransferLedger(opts);
      if (!r.ok) return fromPlaid(r);
      return { ok: true, ledger: r.ledger };
    },

    /* Sandbox only. plaid-http.mjs refuses these on any other host. */
    async simulate(transferId, eventType) {
      if (environment !== "sandbox") return fail("sandbox_only");
      const r = await sandboxSimulateTransfer(transferId, eventType, {}, opts);
      if (!r.ok) return fromPlaid(r);
      return { ok: true };
    },

    async ledgerAvailable() {
      if (environment !== "sandbox") return fail("sandbox_only");
      const r = await sandboxSimulateLedgerAvailable(opts);
      if (!r.ok) return fromPlaid(r);
      return { ok: true };
    }
  };
}

/**
 * transfersNotEnabledProvider(detail) — the "plaid-transfer not enabled" state.
 * Same methods, nothing sent, every answer says why.
 */
export function transfersNotEnabledProvider(detail = null) {
  const no = async () => fail(NOT_ENABLED, { error: detail });
  return {
    name: PROVIDER_NAME,
    environment: null,
    enabled: false,
    authorizeLeg: no, createLeg: no, getLeg: no, cancelLeg: no, eventsPage: no, ledger: no,
    simulate: no, ledgerAvailable: no
  };
}

export default { plaidTransferProvider, transfersNotEnabledProvider, centsToPlaidAmount, achClassFor };
