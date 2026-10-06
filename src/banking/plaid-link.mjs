// Plaid Link, start to finish: open a link, then trade the public_token for a
// stored item and its accounts.
//
// This file holds no network code. Every call to Plaid goes through
// ./providers/plaid-http.mjs (CLAUDE.md §12), and the token is encrypted by
// ./plaid.mjs before it is carried anywhere.
//
// ALL ACCOUNT KINDS. Checking, savings and credit cards all come back from
// /accounts/get and land in bank_accounts with their Plaid type ('depository',
// 'credit', ...). Personal vs business is NOT decided here: entity_kind stays
// 'unknown' (migration 082). Plaid's own holder_category is kept in `raw`.
//
// SANDBOX ROWS SAY SO. An item linked against the sandbox host gets
// "(Plaid sandbox — test data)" on its institution name, so no screen can show
// fake balances as a real person's money.
import { toCents } from "../commissions/money.mjs";
import { plaidConfigFromEnv, linkAccount, getAccounts, SEAM_REASONS } from "./plaid.mjs";
import { saveAccounts, ACCOUNT_TYPES } from "./accounts-store.mjs";

const SANDBOX_LABEL = "(Plaid sandbox — test data)";

/* Plaid balances are dollars; the store wants integer cents. null stays null —
   money.mjs's toCents turns null into 0, which would read as a real zero. */
const cents = (v) => (v === null || v === undefined ? null : toCents(v));

/** One /accounts/get row → the shape accounts-store.mjs writes. */
export function toStoreAccount(a, { asOf }) {
  return {
    providerAccountId: a.plaidAccountId,
    name: a.name,
    officialName: a.officialName,
    mask: a.mask,
    accountType: ACCOUNT_TYPES.includes(a.type) ? a.type : (a.type ? "other" : null),
    accountSubtype: a.subtype,
    currencyCode: a.isoCurrencyCode,
    availableBalanceCents: cents(a.availableBalance),
    currentBalanceCents: cents(a.currentBalance),
    creditLimitCents: cents(a.creditLimit),
    balanceAsOf: asOf,
    raw: {
      source: "plaid",
      plaid_type: a.type ?? null,
      plaid_subtype: a.subtype ?? null,
      holder_category: a.holderCategory ?? null
    }
  };
}

/**
 * startLink({ clientId, env }) → { ok, linkToken, expiration } | { ok:false, reason, ... }
 */
export async function startLink({ clientId, env = process.env } = {}) {
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) {
    return { ok: false, reason: SEAM_REASONS.NOT_CONFIGURED, missing: [...cfg.missing, ...cfg.problems] };
  }
  if (!clientId) return { ok: false, reason: SEAM_REASONS.BAD_REQUEST, missing: ["clientId is required"] };

  const { createLinkToken } = await import("./providers/plaid-http.mjs");
  const r = await createLinkToken({ clientUserId: clientId }, {
    environment: cfg.environment, clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env
  });
  if (!r.ok) {
    return {
      ok: false,
      reason: r.blocked ? SEAM_REASONS.HELD : SEAM_REASONS.UPSTREAM_ERROR,
      errorCode: r.errorCode ?? null,
      error: r.error ?? null
    };
  }
  return { ok: true, linkToken: r.linkToken, expiration: r.expiration, environment: cfg.environment };
}

/**
 * completeLink(db, { orgId, clientId, publicToken, institution, asOf, env })
 *
 * Exchange → store the item (encrypted token, consent stamped: the client
 * finishing Link IS the consent) → read accounts → save them.
 *
 * @returns {{ ok, reason?, itemRowId, environment, written, accounts }}
 */
export async function completeLink(db, {
  orgId, clientId, publicToken, institution = null, asOf, env = process.env
} = {}) {
  if (!orgId || !clientId || !asOf) {
    return { ok: false, reason: SEAM_REASONS.BAD_REQUEST, missing: ["orgId, clientId and asOf are required"] };
  }

  const linked = await linkAccount({ clientId, publicToken, env });
  if (!linked.ok) return { ok: false, reason: linked.reason, missing: linked.missing ?? [], error: linked.error ?? null };

  const { plaidItemId, encryptedAccessToken, environment } = linked.item;
  const baseName = institution?.name ? String(institution.name).slice(0, 200) : null;
  const institutionName = environment === "sandbox"
    ? `${baseName || "Plaid bank"} ${SANDBOX_LABEL}`
    : baseName;

  const item = await db.query(
    `INSERT INTO plaid_items
       (org_id, client_id, plaid_item_id, plaid_institution_id, institution_name,
        encrypted_access_token, link_state, consent_granted_at, consent_scope)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8::jsonb)
     ON CONFLICT (org_id, plaid_item_id) WHERE plaid_item_id IS NOT NULL
     DO UPDATE SET encrypted_access_token = EXCLUDED.encrypted_access_token,
                   link_state = 'active',
                   updated_at = now()
     RETURNING id`,
    [orgId, clientId, plaidItemId, institution?.institution_id ?? null, institutionName,
     encryptedAccessToken, asOf, JSON.stringify(["accounts"])]
  );
  const itemRowId = item.rows[0].id;

  /* AAD is Plaid's item id — the same value linkAccount encrypted with. */
  const got = await getAccounts({ itemId: plaidItemId, encryptedAccessToken, env });
  if (!got.ok) {
    await db.query(
      `UPDATE plaid_items SET link_state = 'error', last_error_code = $2, last_error_at = now(), updated_at = now()
        WHERE id = $1`,
      [itemRowId, got.errorCode ?? got.reason]
    );
    return { ok: false, reason: got.reason, itemRowId, environment, error: got.error ?? null, missing: got.missing ?? [] };
  }

  const saved = await saveAccounts(db, got.accounts.map((a) => toStoreAccount(a, { asOf })), {
    orgId, clientId, provider: "plaid", plaidItemId: itemRowId
  });

  return { ok: true, itemRowId, environment, institutionName, written: saved.written, accounts: saved.accounts };
}

export default { startLink, completeLink, toStoreAccount };
