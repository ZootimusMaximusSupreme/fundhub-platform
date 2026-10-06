// Plaid charges and deposits → bank_transactions, then the repeating-bill
// detector over what landed.
//
// This file holds no network code. Every call to Plaid goes through
// ./providers/plaid-http.mjs (CLAUDE.md §12). The access token is decrypted
// here, in memory, for one sync, and is never returned, logged or put in an
// error string.
//
// *** THE SIGN FLIP HAPPENS HERE AND NOWHERE ELSE. ***
// Plaid: a POSITIVE amount is money LEAVING the account.
// This repo (085 section 1, recurring.mjs section 1): NEGATIVE = money left,
// POSITIVE = money came in. So every Plaid amount is negated in toTransactionRow()
// below — a $2,500 rent payment Plaid sends as 2500 lands as -250000, and a
// $5,000 payroll deposit Plaid sends as -5000 lands as +500000. `raw` keeps
// Plaid's original number, so the flip can always be checked.
//
// UPSERT, NEVER APPEND. Rows key on (bank_account_id, provider_transaction_id),
// 085's total unique index. Re-syncing the same history is an UPDATE.
//
// PLAID'S "REMOVED" ROWS ARE NOT DELETED. When Plaid says a transaction is gone
// (most often a pending charge that later posted under a NEW id), the row stays
// and is marked: raw gains `fundhub_removed_at` and `fundhub_removed_by`.
// Readers that add up money must skip rows where `raw ? 'fundhub_removed_at'`.
// If Plaid ever sends the same id back, the upsert overwrites raw and the mark
// goes with it. Deleting financial history is not something this file does.
//
// CONSENT. Only items with consent_granted_at set are read — 080 says nothing
// may read a client's bank data on a row where it is NULL. completeLink() stamps
// it when the client finishes Plaid Link.
//
// THE CURSOR COLUMN (431) MAY NOT EXIST YET. Until 431 ships, the item read
// falls back to no cursor and the sync reads the full history every time —
// still correct, because every row upserts. The cursor is then simply not saved.
import { db as sharedDb, pool } from "../db.mjs";
import { toCents } from "../commissions/money.mjs";
import { plaidConfigFromEnv, decryptPlaidToken, SEAM_REASONS } from "./plaid.mjs";
import { syncTransactions } from "./providers/plaid-http.mjs";
import { detectRecurringBills } from "./recurring.mjs";
import { saveDetection } from "./store.mjs";

/** Rows per INSERT. One statement per chunk, not one per transaction — a busy
 *  account's first sync is thousands of rows and a round trip each would not
 *  finish inside a function budget. */
const CHUNK = 500;

/** How many transactions one detection run reads. Same cap and same reason as
 *  api/finance/bills.mjs TX_CAP. */
const DETECT_TX_CAP = 5000;

export const DROP_REASONS = Object.freeze({
  NO_ID: "no_transaction_id",
  NO_AMOUNT: "no_amount",
  ZERO_AMOUNT: "zero_amount",
  UNKNOWN_ACCOUNT: "account_not_saved",
  NO_DATE: "no_date"
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (v) => (typeof v === "string" && DAY.test(v) ? v : null);

async function withTransaction(db, fn) {
  const acquire = typeof db?.connect === "function"
    ? () => db.connect()
    : (db === sharedDb ? () => pool().connect() : null);
  if (!acquire) return fn(db);
  const client = await acquire();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * toTransactionRow(t, { bankAccountId }) → { row } | { dropped: reason }
 *
 * One Plaid transaction → one bank_transactions row (minus org/client, which
 * the writer adds). Pure. A row 085 would refuse is dropped with a named
 * reason here, before it can fail the whole batch at the database.
 */
export function toTransactionRow(t, { bankAccountId }) {
  if (!t || typeof t.transaction_id !== "string" || t.transaction_id.trim() === "") {
    return { dropped: DROP_REASONS.NO_ID };
  }
  if (!bankAccountId) return { dropped: DROP_REASONS.UNKNOWN_ACCOUNT };
  if (typeof t.amount !== "number" || !Number.isFinite(t.amount)) {
    return { dropped: DROP_REASONS.NO_AMOUNT };
  }

  /* THE FLIP. Plaid positive = money out; ours negative = money out. */
  const cents = -toCents(t.amount);
  if (cents === 0) return { dropped: DROP_REASONS.ZERO_AMOUNT };

  const pending = t.pending === true;
  const date = day(t.date);
  let authorizedOn = day(t.authorized_date);
  /* A pending charge has not settled, so it has no posted date (085's
     posted_date_ck). Plaid's `date` on a pending row is when it happened, which
     is the authorised day when Plaid did not send one. */
  const postedOn = pending ? null : date;
  if (pending && !authorizedOn) authorizedOn = date;
  /* 085: a settled row must say when it settled; any row must have some date. */
  if (!pending && !postedOn) return { dropped: DROP_REASONS.NO_DATE };
  if (!postedOn && !authorizedOn) return { dropped: DROP_REASONS.NO_DATE };
  /* 085's date_order_ck: settled cannot be before authorised. A bank that sends
     that pair has sent a bad authorised date; it is kept in `raw`, not here. */
  if (postedOn && authorizedOn && authorizedOn > postedOn) authorizedOn = null;

  const pfc = t.personal_finance_category;
  const category = pfc?.detailed || pfc?.primary
    || (Array.isArray(t.category) && t.category.length ? t.category.join(" > ") : null);

  return {
    row: {
      bank_account_id: bankAccountId,
      amount_cents: cents,
      posted_on: postedOn,
      authorized_on: authorizedOn,
      /* Plaid's `name` first: it is the bank's own descriptor, which is what 085
         says this column holds (verbatim) and what normaliseMerchant() in
         recurring.mjs is built to clean. Plaid's enriched merchant_name is not
         applied to every row — measured in sandbox 2026-10-06, the same rent
         came back as "Oakwood Apartments" once and null twice, which split one
         bill into two groups. merchant_name stays in `raw`. */
      merchant_name: t.name || t.merchant_name || null,
      category: category || null,
      is_pending: pending,
      provider_transaction_id: t.transaction_id,
      raw: t
    }
  };
}

/** Items this client has that can be read. Falls back when 431 has not shipped. */
async function readItems(db, { orgId, clientId }) {
  const where = `WHERE org_id = $1 AND client_id = $2
                   AND link_state = 'active'
                   AND plaid_item_id IS NOT NULL
                   AND encrypted_access_token IS NOT NULL
                   AND consent_granted_at IS NOT NULL
                 ORDER BY created_at ASC`;
  try {
    const r = await db.query(
      `SELECT id, plaid_item_id, encrypted_access_token, transactions_cursor FROM plaid_items ${where}`,
      [orgId, clientId]
    );
    return { items: r.rows, cursorColumn: true };
  } catch (e) {
    if (e?.code !== "42703") throw e; // undefined_column: 431 not applied yet
    const r = await db.query(
      `SELECT id, plaid_item_id, encrypted_access_token, NULL::text AS transactions_cursor FROM plaid_items ${where}`,
      [orgId, clientId]
    );
    return { items: r.rows, cursorColumn: false };
  }
}

const UPSERT_SQL = `
  INSERT INTO bank_transactions
    (org_id, client_id, bank_account_id, amount_cents, posted_on, authorized_on,
     merchant_name, category, is_pending, provider_transaction_id, provider, raw)
  SELECT $1::uuid, $2::uuid, r.bank_account_id, r.amount_cents, r.posted_on, r.authorized_on,
         r.merchant_name, r.category, r.is_pending, r.provider_transaction_id, 'plaid', r.raw
    FROM jsonb_to_recordset($3::jsonb) AS r(
      bank_account_id uuid, amount_cents bigint, posted_on date, authorized_on date,
      merchant_name text, category text, is_pending boolean,
      provider_transaction_id text, raw jsonb)
  ON CONFLICT (bank_account_id, provider_transaction_id)
  DO UPDATE SET amount_cents = EXCLUDED.amount_cents,
                posted_on = EXCLUDED.posted_on,
                authorized_on = EXCLUDED.authorized_on,
                merchant_name = EXCLUDED.merchant_name,
                category = EXCLUDED.category,
                is_pending = EXCLUDED.is_pending,
                raw = EXCLUDED.raw,
                updated_at = now()`;

const MARK_REMOVED_SQL = `
  UPDATE bank_transactions t
     SET raw = t.raw || jsonb_build_object('fundhub_removed_at', $3::text,
                                           'fundhub_removed_by', 'plaid /transactions/sync'),
         updated_at = now()
    FROM jsonb_to_recordset($4::jsonb) AS r(bank_account_id uuid, provider_transaction_id text)
   WHERE t.org_id = $1 AND t.client_id = $2 AND t.provider = 'plaid'
     AND t.bank_account_id = r.bank_account_id
     AND t.provider_transaction_id = r.provider_transaction_id
     AND NOT (t.raw ? 'fundhub_removed_at')`;

/**
 * syncItem — one Plaid login: read every page, then write rows + cursor in one
 * database transaction. Never throws for a Plaid failure; returns it.
 */
async function syncItem(db, item, { orgId, clientId, env, asOf, cfg, cursorColumn, fetchImpl }) {
  const out = {
    itemRowId: item.id, ok: false, reason: null, errorCode: null, error: null,
    added: 0, modified: 0, removed: 0, written: 0, markedRemoved: 0,
    dropped: {}, pages: 0, capped: false, updateStatus: null, cursorSaved: false
  };

  let accessToken;
  try {
    accessToken = decryptPlaidToken(item.encrypted_access_token, { itemId: item.plaid_item_id, env });
  } catch (e) {
    out.reason = SEAM_REASONS.BAD_REQUEST;
    out.error = `stored access token could not be decrypted: ${e.message}`;
    return out;
  }

  const r = await syncTransactions(accessToken, { cursor: item.transactions_cursor || null }, {
    environment: cfg.environment, clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env, fetchImpl
  });
  accessToken = null;

  if (!r.ok) {
    out.reason = r.blocked ? SEAM_REASONS.HELD : SEAM_REASONS.UPSTREAM_ERROR;
    out.errorCode = r.errorCode ?? null;
    out.error = r.error ?? null;
    if (!r.blocked) {
      /* ITEM_ERROR is Plaid saying the client must log in again. Anything else
         (rate limit, Plaid down) leaves the link alone and just records it. */
      await db.query(
        `UPDATE plaid_items
            SET last_error_code = $2, last_error_at = now(),
                link_state = CASE WHEN $3 THEN 'error' ELSE link_state END,
                updated_at = now()
          WHERE id = $1`,
        [item.id, r.errorCode ?? r.errorType ?? "upstream_error", r.errorType === "ITEM_ERROR"]
      );
    }
    return out;
  }

  out.added = r.added.length;
  out.modified = r.modified.length;
  out.removed = r.removed.length;
  out.pages = r.pages;
  out.capped = r.capped;
  out.updateStatus = r.updateStatus;

  const acc = await db.query(
    `SELECT id, plaid_account_id FROM bank_accounts
      WHERE org_id = $1 AND client_id = $2 AND plaid_item_id = $3 AND plaid_account_id IS NOT NULL`,
    [orgId, clientId, item.id]
  );
  const accountFor = new Map(acc.rows.map((a) => [a.plaid_account_id, a.id]));

  /* added then modified, keyed so the later version wins. Two copies of one key
     in a single INSERT ... ON CONFLICT is an error in Postgres. */
  const byKey = new Map();
  for (const t of [...r.added, ...r.modified]) {
    const mapped = toTransactionRow(t, { bankAccountId: accountFor.get(t?.account_id) ?? null });
    if (mapped.dropped) {
      out.dropped[mapped.dropped] = (out.dropped[mapped.dropped] || 0) + 1;
      continue;
    }
    byKey.set(`${mapped.row.bank_account_id} ${mapped.row.provider_transaction_id}`, mapped.row);
  }
  const rows = [...byKey.values()];

  const gone = [];
  for (const x of r.removed) {
    const bankAccountId = accountFor.get(x?.account_id);
    if (bankAccountId && typeof x.transaction_id === "string") {
      gone.push({ bank_account_id: bankAccountId, provider_transaction_id: x.transaction_id });
    }
  }

  const removedAt = new Date(asOf).toISOString();
  await withTransaction(db, async (tx) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const res = await tx.query(UPSERT_SQL, [orgId, clientId, JSON.stringify(rows.slice(i, i + CHUNK))]);
      out.written += res.rowCount ?? 0;
    }
    for (let i = 0; i < gone.length; i += CHUNK) {
      const res = await tx.query(MARK_REMOVED_SQL, [orgId, clientId, removedAt, JSON.stringify(gone.slice(i, i + CHUNK))]);
      out.markedRemoved += res.rowCount ?? 0;
    }
    if (cursorColumn) {
      await tx.query(
        `UPDATE plaid_items
            SET transactions_cursor = $2, transactions_synced_at = $3::timestamptz,
                last_error_code = NULL, last_error_at = NULL, updated_at = now()
          WHERE id = $1`,
        [item.id, r.nextCursor, removedAt]
      );
      out.cursorSaved = true;
    }
  });

  out.ok = true;
  return out;
}

/**
 * redetectClientBills(db, { orgId, clientId, now })
 *
 * Reads the client's stored transactions and runs the existing detector
 * (recurring.mjs) and store (store.mjs saveDetection). Same read as
 * api/finance/bills.mjs's redetect — scoped through the account — plus it skips
 * rows Plaid removed.
 */
export async function redetectClientBills(db, { orgId, clientId, now }) {
  const accounts = (await db.query(
    `SELECT id, entity_kind FROM bank_accounts WHERE org_id = $1 AND client_id = $2`,
    [orgId, clientId]
  )).rows;
  if (accounts.length === 0) return { ran: false, reason: "no_bank_accounts" };

  const accountIsBusiness = {};
  for (const a of accounts) {
    if (a.entity_kind === "business") accountIsBusiness[a.id] = true;
    else if (a.entity_kind === "personal") accountIsBusiness[a.id] = false;
    // 'unknown' stays absent — "nobody has said" is not "personal".
  }

  const r = await db.query(
    `SELECT t.id, t.bank_account_id, COALESCE(t.client_id, a.client_id) AS client_id,
            t.provider_transaction_id, t.amount_cents, t.posted_on, t.merchant_name, t.is_pending
       FROM bank_transactions t
       JOIN bank_accounts a ON a.id = t.bank_account_id AND a.org_id = t.org_id
      WHERE t.org_id = $1 AND a.client_id = $2
        AND NOT (t.raw ? 'fundhub_removed_at')
      ORDER BY t.posted_on DESC NULLS LAST, t.id ASC
      LIMIT $3`,
    [orgId, clientId, DETECT_TX_CAP + 1]
  );
  const capped = r.rows.length > DETECT_TX_CAP;
  const rows = capped ? r.rows.slice(0, DETECT_TX_CAP) : r.rows;
  if (rows.length === 0) return { ran: false, reason: "no_transactions" };

  const result = detectRecurringBills(rows, {
    now,
    accountIsBusiness,
    accountIds: accounts.map((a) => String(a.id))
  });
  const saved = await saveDetection(db, result, { orgId });
  return { ran: true, detectedAsOf: result.detectedAsOf, transactionsRead: rows.length, capped, ...saved };
}

/**
 * syncClientTransactions(db, { orgId, clientId, env, asOf, fetchImpl })
 *
 * Every readable Plaid login for one client → bank_transactions, then one
 * detection run over the client's whole stored history.
 *
 * @returns {{ ok, reason?, missing?, environment, ran, items[], totals, bills,
 *             cursorColumn }}
 */
export async function syncClientTransactions(db, {
  orgId, clientId, env = process.env, asOf, fetchImpl = undefined
} = {}) {
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) {
    return { ok: false, reason: SEAM_REASONS.NOT_CONFIGURED, missing: [...cfg.missing, ...cfg.problems] };
  }
  if (!orgId || !clientId || !asOf) {
    return { ok: false, reason: SEAM_REASONS.BAD_REQUEST, missing: ["orgId, clientId and asOf are required"] };
  }

  const { items, cursorColumn } = await readItems(db, { orgId, clientId });
  const totals = { written: 0, markedRemoved: 0, dropped: 0 };
  if (items.length === 0) {
    return {
      ok: true, ran: false, reason: "no_linked_bank", environment: cfg.environment,
      items: [], totals, bills: null, cursorColumn
    };
  }

  const results = [];
  for (const item of items) {
    const one = await syncItem(db, item, { orgId, clientId, env, asOf, cfg, cursorColumn, fetchImpl });
    results.push(one);
    totals.written += one.written;
    totals.markedRemoved += one.markedRemoved;
    totals.dropped += Object.values(one.dropped).reduce((s, n) => s + n, 0);
  }

  const anyOk = results.some((x) => x.ok);
  const bills = anyOk ? await redetectClientBills(db, { orgId, clientId, now: new Date(asOf) }) : null;

  return {
    ok: anyOk,
    reason: anyOk ? null : (results[0]?.reason || SEAM_REASONS.UPSTREAM_ERROR),
    ran: true,
    environment: cfg.environment,
    items: results,
    totals,
    bills,
    cursorColumn
  };
}

/**
 * clientsWithPlaid(db) — every (org, client) holding a readable Plaid login.
 * The daily sweep's list. Same filter as readItems.
 */
export async function clientsWithPlaid(db) {
  const r = await db.query(
    `SELECT DISTINCT org_id, client_id
       FROM plaid_items
      WHERE link_state = 'active'
        AND plaid_item_id IS NOT NULL
        AND encrypted_access_token IS NOT NULL
        AND consent_granted_at IS NOT NULL
      ORDER BY org_id, client_id`
  );
  return r.rows;
}

export default { toTransactionRow, syncClientTransactions, redetectClientBills, clientsWithPlaid, DROP_REASONS };
