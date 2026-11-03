// Fundhub company bank reads. These rows never enter client FinanceOS tables.
import { db as sharedDb, pool } from "../db.mjs";
import { toCents } from "../commissions/money.mjs";
import { encryptPlaidToken, decryptPlaidToken } from "../banking/plaid.mjs";
import { toTransactionRow } from "../banking/plaid-transactions.mjs";
import * as plaidHttp from "../banking/providers/plaid-http.mjs";

export function companyPlaidConfig(env = process.env) {
  const names = ["OWNER_PLAID_CLIENT_ID", "OWNER_PLAID_SECRET", "OWNER_PLAID_TOKEN_ENC_KEY"];
  const missing = names.filter((name) => !env[name]);
  if (env.OWNER_PLAID_ENV !== "production") missing.push("OWNER_PLAID_ENV=production");
  if (env.OWNER_PLAID_TOKEN_ENC_KEY && Buffer.from(env.OWNER_PLAID_TOKEN_ENC_KEY, "base64").length !== 32) {
    missing.push("OWNER_PLAID_TOKEN_ENC_KEY (32 bytes, base64)");
  }
  return { ready: missing.length === 0, missing };
}

const opts = (env) => ({
  environment: "production", clientId: env.OWNER_PLAID_CLIENT_ID,
  secret: env.OWNER_PLAID_SECRET, env
});
const cipherEnv = (env) => ({ ...env, PLAID_TOKEN_ENC_KEY: env.OWNER_PLAID_TOKEN_ENC_KEY });
const cents = (value) => value === null || value === undefined ? null : toCents(value);
const safeDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const safeProviderCode = (value) => typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value)
  ? value : "PLAID_ERROR";

async function transaction(db, fn) {
  const client = typeof db.connect === "function" ? await db.connect() : db === sharedDb ? await pool().connect() : db;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if (typeof client.release === "function") client.release();
  }
}

export async function companyLinkToken({ orgId, env = process.env, provider = plaidHttp }) {
  const config = companyPlaidConfig(env);
  if (!config.ready) return { ok: false, reason: "not_configured", missing: config.missing };
  const result = await provider.createLinkToken({ clientUserId: `fundhub-company:${orgId}`, products: ["transactions"] }, opts(env));
  return result.ok
    ? { ok: true, linkToken: result.linkToken, expiration: result.expiration }
    : { ok: false, reason: "plaid_error", errorCode: result.errorCode ?? null };
}

async function saveAccounts(tx, { orgId, itemId, accounts }) {
  const saved = [];
  for (const account of accounts) {
    if (!account.plaidAccountId) continue;
    const result = await tx.query(
      `INSERT INTO company_bank_accounts
        (org_id, company_plaid_item_id, plaid_account_id, name, mask, account_type, account_subtype, holder_category,
         currency_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (company_plaid_item_id, plaid_account_id)
       DO UPDATE SET name=EXCLUDED.name, mask=EXCLUDED.mask, account_type=EXCLUDED.account_type,
         account_subtype=EXCLUDED.account_subtype, holder_category=EXCLUDED.holder_category,
         currency_code=EXCLUDED.currency_code, updated_at=now()
       RETURNING id`,
      [orgId, itemId, account.plaidAccountId, account.name ?? null, account.mask ?? null,
       account.type ?? null, account.subtype ?? null, account.holderCategory ?? null,
       account.isoCurrencyCode ?? null]
    );
    saved.push({ id: result.rows[0].id, plaidAccountId: account.plaidAccountId });
  }
  return saved;
}

export async function companyCompleteLink(db, {
  orgId, staffId, publicToken, accountId, businessConfirmed, consentText, institutionName = null, env = process.env,
  provider = plaidHttp, now = new Date()
}) {
  if (!accountId || businessConfirmed !== true || typeof consentText !== "string" || !consentText.trim()) {
    return { ok: false, reason: "business_account_confirmation_required" };
  }
  const config = companyPlaidConfig(env);
  if (!config.ready) return { ok: false, reason: "not_configured", missing: config.missing };
  const exchanged = await provider.exchangePublicToken(publicToken, opts(env));
  if (!exchanged.ok) return { ok: false, reason: "plaid_error", errorCode: exchanged.errorCode ?? null };
  const fetched = await provider.fetchAccounts(exchanged.accessToken, opts(env));
  if (!fetched.ok) return { ok: false, reason: "plaid_error", errorCode: fetched.errorCode ?? null };
  const chosen = fetched.accounts.find((account) => account.plaidAccountId === accountId);
  if (!chosen || chosen.type !== "depository" || chosen.holderCategory === "personal" ||
    chosen.isoCurrencyCode !== "USD") {
    return { ok: false, reason: "business_depository_account_required" };
  }
  const encrypted = encryptPlaidToken(exchanged.accessToken, {
    itemId: exchanged.itemId, env: cipherEnv(env)
  });
  const asOf = now.toISOString();
  const result = await transaction(db, async (tx) => {
    await tx.query("SELECT id FROM orgs WHERE id=$1 FOR UPDATE", [orgId]);
    const item = await tx.query(
      `INSERT INTO company_plaid_items
        (org_id, plaid_item_id, institution_name, encrypted_access_token, consent_text, consent_granted_at, linked_by_staff_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (plaid_item_id) DO UPDATE SET
         encrypted_access_token=EXCLUDED.encrypted_access_token, consent_text=EXCLUDED.consent_text,
         consent_granted_at=EXCLUDED.consent_granted_at, linked_by_staff_id=EXCLUDED.linked_by_staff_id, updated_at=now()
       WHERE company_plaid_items.org_id=EXCLUDED.org_id
       RETURNING id`,
      [orgId, exchanged.itemId, institutionName, encrypted, consentText.trim(), asOf, staffId]
    );
    if (!item.rows[0]) throw new Error("company Plaid Item belongs to another org");
    const accounts = await saveAccounts(tx, { orgId, itemId: item.rows[0].id, accounts: fetched.accounts });
    const selected = accounts.find((account) => account.plaidAccountId === accountId);
    if (!selected) throw new Error("selected business account was not saved");
    await tx.query("UPDATE company_bank_accounts SET selected_for_cash=false,updated_at=now() WHERE org_id=$1 AND selected_for_cash", [orgId]);
    await tx.query(`UPDATE company_bank_accounts SET selected_for_cash=true,business_confirmed_at=$3,
      business_confirmed_by_staff_id=$4,updated_at=now() WHERE id=$1 AND org_id=$2`,
      [selected.id, orgId, asOf, staffId]);
    return { itemId: item.rows[0].id, accountCount: accounts.length, selectedAccount: { id: selected.id, mask: chosen.mask ?? null, name: chosen.name ?? null } };
  });
  return { ok: true, ...result };
}

const UPSERT_TRANSACTIONS = `
  INSERT INTO company_bank_transactions
    (org_id, company_bank_account_id, plaid_transaction_id, amount_cents, posted_on,
     authorized_on, merchant_name, category, is_pending)
  SELECT $1::uuid, r.bank_account_id, r.provider_transaction_id, r.amount_cents,
         r.posted_on, r.authorized_on, r.merchant_name, r.category, r.is_pending
    FROM jsonb_to_recordset($2::jsonb) AS r(
      bank_account_id uuid, provider_transaction_id text, amount_cents bigint,
      posted_on date, authorized_on date, merchant_name text, category text, is_pending boolean)
  ON CONFLICT (company_bank_account_id, plaid_transaction_id)
  DO UPDATE SET amount_cents=EXCLUDED.amount_cents, posted_on=EXCLUDED.posted_on,
    authorized_on=EXCLUDED.authorized_on, merchant_name=EXCLUDED.merchant_name,
    category=EXCLUDED.category, is_pending=EXCLUDED.is_pending,
    removed_at=NULL, updated_at=now()`;

export async function companySync(db, { orgId, itemId, env = process.env, provider = plaidHttp, now = new Date() }) {
  const config = companyPlaidConfig(env);
  if (!config.ready) return { ok: false, reason: "not_configured", missing: config.missing };
  const rows = await db.query(
    `SELECT id, plaid_item_id, encrypted_access_token, transactions_cursor
       FROM company_plaid_items WHERE id=$1 AND org_id=$2 AND consent_granted_at IS NOT NULL`,
    [itemId, orgId]
  );
  const item = rows.rows[0];
  if (!item) return { ok: false, reason: "not_found" };
  const accessToken = decryptPlaidToken(item.encrypted_access_token, {
    itemId: item.plaid_item_id, env: cipherEnv(env)
  });
  const asOf = now.toISOString();
  const failed = async code => {
    const errorCode = safeProviderCode(code);
    await db.query(`UPDATE company_plaid_items SET last_error_code=$3,
      last_sync_attempt_at=$4,updated_at=now() WHERE id=$1 AND org_id=$2`,
    [item.id, orgId, errorCode, asOf]);
    return { ok: false, reason: "plaid_error", errorCode };
  };
  let accounts, changes;
  try {
    [accounts, changes] = await Promise.all([
      provider.fetchAccounts(accessToken, opts(env)),
      provider.syncTransactions(accessToken, { cursor: item.transactions_cursor }, opts(env))
    ]);
  } catch { return failed("PLAID_ERROR"); }
  if (!accounts?.ok || !changes?.ok) {
    return failed(accounts?.errorCode ?? changes?.errorCode);
  }
  let result;
  try { result = await transaction(db, async (tx) => {
    const saved = await saveAccounts(tx, { orgId, itemId: item.id, accounts: accounts.accounts });
    const byPlaidId = new Map(saved.map((a) => [a.plaidAccountId, a.id]));
    const mapped = [];
    for (const entry of [...changes.added, ...changes.modified]) {
      const row = toTransactionRow(entry, { bankAccountId: byPlaidId.get(entry.account_id) });
      if (row.row) {
        const { raw, ...stored } = row.row;
        mapped.push(stored);
      }
    }
    for (let start = 0; start < mapped.length; start += 500) {
      await tx.query(UPSERT_TRANSACTIONS, [orgId, JSON.stringify(mapped.slice(start, start + 500))]);
    }
    for (const removed of changes.removed) {
      const accountId = byPlaidId.get(removed.account_id);
      if (!accountId || !removed.transaction_id) continue;
      await tx.query(
        `UPDATE company_bank_transactions SET removed_at=$4, updated_at=now()
          WHERE org_id=$1 AND company_bank_account_id=$2 AND plaid_transaction_id=$3 AND removed_at IS NULL`,
        [orgId, accountId, removed.transaction_id, asOf]
      );
    }
    const updated = await tx.query(
      `UPDATE company_plaid_items SET transactions_cursor=$3, last_synced_at=$4,
         last_sync_attempt_at=$4,last_error_code=NULL, updated_at=now()
       WHERE id=$1 AND org_id=$2 AND transactions_cursor IS NOT DISTINCT FROM $5
       RETURNING id`,
      [item.id, orgId, changes.nextCursor, asOf, item.transactions_cursor]
    );
    if (!updated.rows[0]) {
      const conflict = new Error("company Plaid sync changed concurrently");
      conflict.code = "COMPANY_SYNC_CONFLICT";
      throw conflict;
    }
    return { accountCount: saved.length, transactionCount: mapped.length, removedCount: changes.removed.length };
  }); } catch (error) {
    if (error.code === "COMPANY_SYNC_CONFLICT") {
      return { ok: false, reason: "sync_conflict", retryable: true };
    }
    throw error;
  }
  return { ok: true, ...result, syncedAt: asOf };
}

export async function companyBankRead(db, { orgId, limit = 100 }) {
  const items = await db.query(`SELECT id, institution_name, last_synced_at, last_sync_attempt_at,
                     last_error_code, created_at
                FROM company_plaid_items WHERE org_id=$1 ORDER BY created_at DESC`, [orgId]);
  const accounts = await db.query(`SELECT id, company_plaid_item_id, name, mask, account_type, account_subtype, holder_category, selected_for_cash, business_confirmed_at,
                     currency_code, available_balance_cents, current_balance_cents, balance_as_of
                FROM company_bank_accounts WHERE org_id=$1 ORDER BY name, id`, [orgId]);
  const transactions = await db.query(`SELECT id, company_bank_account_id, amount_cents, posted_on, authorized_on,
                     merchant_name, category, owner_category, is_pending
                FROM company_bank_transactions
               WHERE org_id=$1 AND removed_at IS NULL
               ORDER BY posted_on DESC NULLS LAST, id DESC LIMIT $2`, [orgId, limit]);
  return { items: items.rows, accounts: accounts.rows, transactions: transactions.rows };
}

export async function companyPaymentMatches(db, { orgId, obligationId, beforePostedOn = null,
  beforeId = null, limit = 25 }) {
  const pageSize = Math.max(1, Math.min(50, Math.trunc(limit) || 25));
  const result = await db.query(`SELECT t.id,t.posted_on,t.amount_cents,t.merchant_name,t.owner_category
    FROM company_cash_obligations o
    JOIN company_bank_accounts a ON a.org_id=o.org_id AND a.selected_for_cash=true
      AND a.business_confirmed_at IS NOT NULL AND a.account_type='depository'
      AND a.holder_category IS DISTINCT FROM 'personal' AND a.currency_code='USD'
    JOIN company_bank_transactions t ON t.company_bank_account_id=a.id AND t.org_id=o.org_id
    WHERE o.id=$2 AND o.org_id=$1 AND o.status IN ('planned','approved')
      AND o.amount_cents IS NOT NULL AND t.amount_cents=-o.amount_cents AND t.amount_cents<0
      AND t.posted_on IS NOT NULL AND NOT t.is_pending AND t.removed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM company_cash_obligations used
        WHERE used.org_id=o.org_id AND used.paid_bank_transaction_id=t.id)
      AND ($3::date IS NULL OR (t.posted_on,t.id)<($3::date,$4::uuid))
    ORDER BY t.posted_on DESC,t.id DESC LIMIT $5`,
  [orgId, obligationId, beforePostedOn, beforeId, pageSize + 1]);
  const hasMore = result.rows.length > pageSize;
  const transactions = result.rows.slice(0, pageSize).map(row => ({
    id: row.id, posted_on: row.posted_on instanceof Date ? row.posted_on.toISOString().slice(0, 10) : row.posted_on,
    amount_cents: row.amount_cents, merchant_name: row.merchant_name,
    owner_category: row.owner_category
  }));
  const last = hasMore ? transactions.at(-1) : null;
  return { obligation_id: obligationId, transactions, has_more: hasMore,
    next_before_posted_on: last?.posted_on ?? null, next_before_id: last?.id ?? null };
}

export async function companySelectAccount(db, { orgId, staffId, accountId, confirmed, now = new Date() }) {
  if (confirmed !== true) return { ok: false, reason: "business_account_confirmation_required" };
  return transaction(db, async tx => {
    await tx.query("SELECT id FROM orgs WHERE id=$1 FOR UPDATE", [orgId]);
    const found = await tx.query(`SELECT id,name,mask FROM company_bank_accounts
      WHERE id=$1 AND org_id=$2 AND account_type='depository'
        AND holder_category IS DISTINCT FROM 'personal' AND currency_code='USD' FOR UPDATE`, [accountId, orgId]);
    if (!found.rows[0]) return { ok: false, reason: "business_depository_account_required" };
    await tx.query("UPDATE company_bank_accounts SET selected_for_cash=false,updated_at=now() WHERE org_id=$1 AND selected_for_cash", [orgId]);
    await tx.query(`UPDATE company_bank_accounts SET selected_for_cash=true,
      business_confirmed_at=$3,business_confirmed_by_staff_id=$4,updated_at=now()
      WHERE id=$1 AND org_id=$2`, [accountId, orgId, now.toISOString(), staffId]);
    return { ok: true, account: found.rows[0] };
  });
}

// Balance is a billable, real-time Plaid call. It runs only for this explicit owner action.
export async function companyRefreshBalance(db, { orgId, itemId, env = process.env,
  provider = plaidHttp, now = new Date() }) {
  const config = companyPlaidConfig(env);
  if (!config.ready) return { ok: false, reason: "not_configured", missing: config.missing };
  if (env.OWNER_PLAID_REALTIME_BALANCE_ENABLED !== "1") {
    return { ok: false, reason: "realtime_balance_not_enabled" };
  }
  const result = await db.query(`SELECT i.plaid_item_id,i.encrypted_access_token,
      a.id AS account_id,a.plaid_account_id,a.account_type,a.holder_category,a.currency_code
    FROM company_plaid_items i JOIN company_bank_accounts a
      ON a.company_plaid_item_id=i.id AND a.org_id=i.org_id AND a.selected_for_cash=true
    WHERE i.id=$1 AND i.org_id=$2 AND i.consent_granted_at IS NOT NULL`, [itemId, orgId]);
  const selected = result.rows[0];
  if (!selected) return { ok: false, reason: "selected_account_not_found" };
  if (selected.account_type !== "depository" || selected.holder_category === "personal" ||
    selected.currency_code !== "USD") return { ok: false, reason: "business_depository_account_required" };
  const accessToken = decryptPlaidToken(selected.encrypted_access_token, {
    itemId: selected.plaid_item_id, env: cipherEnv(env)
  });
  const fetched = await provider.fetchBalances(accessToken, opts(env));
  if (!fetched.ok) return { ok: false, reason: "plaid_error", errorCode: fetched.errorCode ?? null };
  const account = fetched.accounts.find(row => row.plaidAccountId === selected.plaid_account_id);
  if (!account || account.type !== "depository" || account.holderCategory === "personal" ||
    account.isoCurrencyCode !== "USD") return { ok: false, reason: "business_depository_account_required" };
  if (typeof account.currentBalance !== "number" || !Number.isFinite(account.currentBalance)) {
    return { ok: false, reason: "balance_unavailable" };
  }
  const current = cents(account.currentBalance);
  const available = typeof account.availableBalance === "number" && Number.isFinite(account.availableBalance)
    ? cents(account.availableBalance) : null;
  const asOf = now.toISOString();
  const saved = await db.query(`UPDATE company_bank_accounts SET current_balance_cents=$3,
      available_balance_cents=$4,balance_as_of=$5,account_type=$6,holder_category=$7,
      currency_code=$8,updated_at=now()
    WHERE id=$1 AND org_id=$2 AND selected_for_cash=true RETURNING id`,
  [selected.account_id, orgId, current, available, asOf, account.type,
    account.holderCategory ?? null, account.isoCurrencyCode]);
  return saved.rows[0] ? { ok: true, accountId: selected.account_id, balanceAsOf: asOf } :
    { ok: false, reason: "selected_account_changed" };
}
