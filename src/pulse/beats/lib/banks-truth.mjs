// Banks missing on the money screen. Report only. Read-only SQL.
//
// Slice 07 lists Finance OS jobs. Slice 08 lists whether the bank sync is on
// the machine list and whether the sync doors are in the registry. This file
// does not repeat either list. It reads rows that mean a bank is saved but
// the money screen would not show it.
//
// The money screen is GET /api/money/overview (src/finance/money-overview.mjs
// ACCOUNT_SQL). It keeps an account only when client and company match, then
// drops closed accounts on purpose. A closed account is not a gap.
//
// No Plaid call. No token exchange. The access token column is never selected.
// Recon (AG-07) is the one tripwire. Do not add another watcher.
//
// Review notes (Claude, 2026-10-08): the "sync stale" check used to read the
// plaid-transactions-sweeper job receipt. That job is already watched twice,
// by job:plaid-transactions-sweeper (src/pulse/heartbeats.mjs) and by the
// slice 08 sweeper row, both red after 3 times the daily schedule. A third
// copy added noise and nothing else. It now reads each live LOGIN instead.
// The sweeper never throws for the whole pass and skips quietly when Plaid is
// not configured, so its receipt can say "ok" while one login has not synced
// for days. That is the gap this check closes.

// ONE JUDGE, TWO CLOCKS (2026-10-20). This file used to be src/pulse/coverage/gap-banks.mjs. It moved
// here so the morning lane (gap-banks.mjs, now a thin adapter) and the hourly beat bank-links run the same
// SQL and verdicts. A beat may import only from src/pulse/beats/lib, so the bank sync's schedule (job id,
// cron, red-after) is handed in by the caller: gap-banks.mjs works it out from the sweeper and
// src/pulse/heartbeats.mjs; the beat carries the same three values and its test holds them equal.

const HOUR_MS = 60 * 60 * 1000;

export const ERROR_SQL = `
  SELECT count(*)::int AS n,
         (array_agg(last_error_code ORDER BY last_error_at DESC NULLS LAST))[1] AS last_code
    FROM plaid_items
   WHERE link_state = 'error'
     AND ($1::uuid IS NULL OR org_id = $1::uuid)`;

/* Open linked account the overview WHERE would miss for the login's client.
   Closed rows are left out of this count on purpose. */
export const HIDDEN_SQL = `
  SELECT count(*)::int AS n
    FROM bank_accounts a
    JOIN plaid_items p ON p.id = a.plaid_item_id
    LEFT JOIN clients c ON c.id = a.client_id
   WHERE a.plaid_item_id IS NOT NULL
     AND a.closed_at IS NULL
     AND ($1::uuid IS NULL OR a.org_id = $1::uuid OR p.org_id = $1::uuid)
     AND (
       c.id IS NULL
       OR a.org_id IS DISTINCT FROM c.org_id
       OR a.client_id IS DISTINCT FROM p.client_id
       OR a.org_id IS DISTINCT FROM p.org_id
     )`;

/* Per live login: when did it last read? The sweeper writes two stamps (the
   transactions read and the balance read). The OLDER of the two is used, so a
   login whose transactions read fine but whose balances did not (or the other
   way round) still shows up. Closed
   accounts and accounts with no balance time are ignored. Mock logins are
   skipped the way plaid-refresh skips them. */
export const STALE_SQL = `
  SELECT count(*)::int AS active_links,
         count(*) FILTER (WHERE live.last_read < $2::timestamptz)::int AS stale_links,
         min(live.last_read) FILTER (WHERE live.last_read < $2::timestamptz) AS oldest,
         (array_agg(live.last_error_code ORDER BY live.last_read)
            FILTER (WHERE live.last_read < $2::timestamptz AND live.last_error_code IS NOT NULL))[1] AS last_code
    FROM (
      SELECT p.last_error_code,
             LEAST(
               COALESCE(p.transactions_synced_at, p.created_at),
               (SELECT max(a.balance_as_of)
                  FROM bank_accounts a
                 WHERE a.plaid_item_id = p.id AND a.closed_at IS NULL)
             ) AS last_read
        FROM plaid_items p
       WHERE p.link_state = 'active'
         AND p.consent_granted_at IS NOT NULL
         AND p.encrypted_access_token IS NOT NULL
         AND p.plaid_item_id IS NOT NULL
         AND p.plaid_item_id NOT LIKE 'mock:%'
         AND ($1::uuid IS NULL OR p.org_id = $1::uuid)
    ) live`;

/* A live login with no account row under it, or a client with a live login and
   not one OPEN account anywhere. The money screen reads bank_accounts and drops
   closed rows, so either one leaves that client looking at no bank. A client who
   re-linked (an older login with only closed accounts, a newer one with open
   accounts) is fine and is not counted. */
export const EMPTY_SQL = `
  SELECT count(*)::int AS items,
         count(DISTINCT p.client_id)::int AS clients
    FROM plaid_items p
   WHERE p.link_state = 'active'
     AND p.consent_granted_at IS NOT NULL
     AND p.encrypted_access_token IS NOT NULL
     AND p.plaid_item_id IS NOT NULL
     AND ($1::uuid IS NULL OR p.org_id = $1::uuid)
     AND (
       NOT EXISTS (
         SELECT 1 FROM bank_accounts a
          WHERE a.plaid_item_id = p.id
            AND a.org_id = p.org_id
            AND a.client_id = p.client_id
       )
       OR NOT EXISTS (
         SELECT 1 FROM bank_accounts a
          WHERE a.client_id = p.client_id
            AND a.org_id = p.org_id
            AND a.closed_at IS NULL
       )
     )`;

export const SQL = Object.freeze([ERROR_SQL, HIDDEN_SQL, STALE_SQL, EMPTY_SQL]);

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function fix(what) {
  return (
    `${what} Recon (AG-07) reports this on the morning pulse. ` +
    "Do not call Plaid. Do not exchange tokens. Do not add another watcher. Do not auto-fix."
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function noun(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function ageWords(ms) {
  const h = ms / HOUR_MS;
  if (h < 36) return `${Math.max(1, Math.round(h))} hours`;
  return `${Math.round(h / 24)} days`;
}

function judgeError(row) {
  const id = "banks-plaid-item-error";
  const n = num(row && row.n);
  if (n === 0) return check(id, "PASS", "No bank login is in error.");
  const code = row && row.last_code ? ` Last code: ${clip(row.last_code, 80)}.` : "";
  return check(
    id,
    "FAIL",
    `${noun(n, "bank login is", "bank logins are")} in error, so the money screen cannot refresh ${n === 1 ? "that bank" : "those banks"}.${code}`,
    fix("The client has to sign in at the bank again.")
  );
}

function judgeHidden(row) {
  const id = "banks-linked-not-on-screen";
  const n = num(row && row.n);
  if (n === 0) {
    return check(id, "PASS", "Every open linked bank account matches the client and company the money screen reads.");
  }
  return check(
    id,
    "FAIL",
    `${noun(n, "open bank account is", "open bank accounts are")} saved and linked, but the money screen read would not return ${n === 1 ? "it" : "them"}. The client or company on the account does not match the bank login.`,
    fix("Read bank_accounts against plaid_items and clients. Do not change rows from this check.")
  );
}

function judgeStale(row, now, { redAfterMs: RED_AFTER_MS, cron: PLAID_SYNC_CRON, job: PLAID_SYNC_JOB_ID } = {}) {
  const id = "banks-sync-stale";
  const active = num(row && row.active_links);
  if (active === 0) {
    return check(id, "skip", "No live bank login, so a quiet sync is not a missing bank on the screen.");
  }
  if (RED_AFTER_MS == null) {
    return check(id, "skip", `Schedule "${PLAID_SYNC_CRON}" is a shape this check does not read.`);
  }
  const stale = num(row && row.stale_links);
  if (stale === 0) {
    return check(id, "PASS", `${noun(active, "live bank login has", "live bank logins have")} synced inside 3 days.`);
  }
  const oldest = toDate(row && row.oldest);
  const age = oldest ? ` The oldest read was ${ageWords(now.getTime() - oldest.getTime())} ago.` : "";
  const code = row && row.last_code ? ` Last error code: ${clip(row.last_code, 80)}.` : "";
  return check(
    id,
    "FAIL",
    `${noun(stale, "live bank login has", "live bank logins have")} not synced in 3 days (the daily sync is late after 3 days), so banks on the money screen can be old or missing.${age}${code}`,
    fix(
      `Read plaid_items.last_error_code for that login and the ${PLAID_SYNC_JOB_ID} pass tally (${PLAID_SYNC_CRON}). ` +
      "The job receipt can look fine while one login is stuck."
    )
  );
}

function judgeEmpty(row) {
  const id = "banks-active-link-no-accounts";
  const clients = num(row && row.clients);
  const items = num(row && row.items);
  if (clients === 0 && items === 0) {
    return check(id, "PASS", "Every live bank login has an account saved, and every client with a live login has at least one open account on the money screen.");
  }
  const who = clients > 0
    ? noun(clients, "client has", "clients have")
    : noun(items, "bank login has", "bank logins have");
  const extra = clients > 0 && items > clients
    ? ` That is ${noun(items, "login", "logins")} with no open account under them.`
    : "";
  return check(
    id,
    "FAIL",
    `${who} a live bank login and no account saved, so the money screen shows no bank for that login.${extra} Closed accounts are not shown.`,
    fix("The login is active and no open account row sits under it (none saved, or every one closed).")
  );
}

async function one(run, id, sql, params, judge) {
  try {
    const res = await run((db) => db.query(sql, params));
    const row = res && Array.isArray(res.rows) ? res.rows[0] : null;
    return judge(row || {});
  } catch (err) {
    return check(
      id,
      "FAIL",
      `Could not read ${id}: ${clip((err && err.message) || err)}`,
      fix("Fix the read. Do not change bank rows from this check.")
    );
  }
}

// Named BANK_SCREEN_CHECK_IDS, not CHECK_IDS: gap-banks.mjs re-exports this file, and a lane CHECK_IDS
// list joins the morning self-audit manifest. This move does not change that manifest.
export const BANK_SCREEN_CHECK_IDS = Object.freeze([
  "banks-plaid-item-error",
  "banks-linked-not-on-screen",
  "banks-sync-stale",
  "banks-active-link-no-accounts"
]);

/**
 * runBanksChecks(io, opts) → [{ id, status, detail, suggestedFix }]
 * status is PASS, FAIL, or skip.
 * io: { run, now, orgId, schedule: { redAfterMs, cron, job } }. run(fn) hands fn something with
 * query(sql, params): the staff scope in the morning lane, the read box in the hourly beat.
 * opts.only: the check ids to run (default all four, in BANK_SCREEN_CHECK_IDS order).
 * SELECT only. Never calls Plaid.
 */
export async function runBanksChecks(io = {}, { only = BANK_SCREEN_CHECK_IDS } = {}) {
  const run = typeof io.run === "function" ? io.run : null;
  if (!run) {
    return [
      check("banks-plaid-item-error", "skip", "No database in this run. Bank logins were not read."),
      check("banks-linked-not-on-screen", "skip", "No database in this run. Bank accounts were not read."),
      check("banks-sync-stale", "skip", "No database in this run. The bank sync receipt was not read."),
      check("banks-active-link-no-accounts", "skip", "No database in this run. Bank logins were not read.")
    ];
  }
  const now = toDate(io.now) || new Date();
  const orgId = io.orgId || null;
  const schedule = io.schedule || {};
  const staleBefore = new Date(now.getTime() - (schedule.redAfterMs ?? 0));
  const reads = {
    "banks-plaid-item-error": () => one(run, "banks-plaid-item-error", ERROR_SQL, [orgId], judgeError),
    "banks-linked-not-on-screen": () => one(run, "banks-linked-not-on-screen", HIDDEN_SQL, [orgId], judgeHidden),
    "banks-sync-stale": () => one(run, "banks-sync-stale", STALE_SQL, [orgId, staleBefore.toISOString()], (row) => judgeStale(row, now, schedule)),
    "banks-active-link-no-accounts": () => one(run, "banks-active-link-no-accounts", EMPTY_SQL, [orgId], judgeEmpty)
  };
  return Promise.all(BANK_SCREEN_CHECK_IDS.filter((id) => only.includes(id)).map((id) => reads[id]()));
}
