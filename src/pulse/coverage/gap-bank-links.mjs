// Bank logins and merchant connections that stopped working. Report only. Read-only SQL.
//
// Two questions a client would feel:
//
//   banks:login-broken   "My bank stopped refreshing and nobody told me."
//   banks:merchant-sync  "My card processor sales stopped showing up."
//
// gap-banks.mjs already counts every login whose link_state is 'error'. That
// count never goes down: a client who signs in at the bank again makes a NEW
// plaid_items row (Plaid Link has no update mode here, see
// src/banking/providers/plaid-http.mjs createLinkToken), and no code retires the
// old row, so banks-plaid-item-error keeps counting a login the client already
// replaced. This file judges the NEWEST login per bank instead, and it only
// goes red when nobody has told the client or opened a staff task.
//
// What "the same bank" means: the same client, and the same Plaid institution id
// (plaid_institution_id). A row with no institution id falls back to the
// institution name, then to its own id (so it can never hide behind another row).
//
// What "told" means: after the login broke, a staff task, or an outbound message
// that really left (status sent, delivered or complained: the same three
// src/messaging/outbox.mjs SENT_TODAY_STATUSES counts), for that client, whose
// words are about the bank login (BANK_TOLD_RE). The repo
// has no code that does this today (measured 2026-10-10: no template, no task
// title), so a real broken login is red until a person follows it up. That is
// the point of the check.
//
// No Plaid call. No token exchange. The access token column is never selected.
// Nothing is written. A read that fails is a skip, never a PASS.

/** A login in error this long, with nobody told, is red. One daily sweep has run
 *  since it broke. The money helper's own first late rung is also one day
 *  (src/finance/money-agent.mjs LADDER). */
export const LOGIN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A live pull connection with no sync in this long is red. The sweeper is daily
 *  (src/workflows/merchant-pull-sweeper.mjs SWEEP_CRON), so two days is one
 *  missed pass. Owner-set in the W5 brief. */
export const MERCHANT_QUIET_MS = 2 * 24 * 60 * 60 * 1000;

/** Words that make a task or a message "about the bank login". Postgres regex,
 *  case blind. Bank word near a sign-in / link / connect word, either order. */
export const BANK_TOLD_RE =
  "(bank|plaid).{0,60}(log ?in|sign ?in|link|connect|re-?link|re-?connect|re-?auth)" +
  "|(log ?in|sign ?in|link|connect|re-?link|re-?connect|re-?auth).{0,60}(bank|plaid)";

export const CHECK_IDS = Object.freeze([
  "banks:login-broken",
  "banks:merchant-sync"
]);

/* One row per (client, bank): the newest login. Only a login whose newest row is
   in error can be red. Mock logins (plaid_item_id 'mock:<client>') are skipped the
   way the sweeper skips them. The told test runs only for a late row. */
export const LOGIN_SQL = `
  /* gap:bank-login-broken */
  WITH logins AS (
    SELECT p.id, p.org_id, p.client_id, p.link_state, p.last_error_code, p.created_at,
           COALESCE(p.last_error_at, p.updated_at, p.created_at) AS broke_at,
           COALESCE(NULLIF(btrim(p.plaid_institution_id), ''),
                    lower(NULLIF(btrim(p.institution_name), '')),
                    p.id::text) AS bank_key
      FROM plaid_items p
     WHERE ($1::uuid IS NULL OR p.org_id = $1::uuid)
       AND COALESCE(p.plaid_item_id, '') NOT LIKE 'mock:%'
  ),
  newest AS (
    SELECT DISTINCT ON (org_id, client_id, bank_key) *
      FROM logins
     ORDER BY org_id, client_id, bank_key, created_at DESC, id DESC
  ),
  judged AS (
    SELECT n.*,
           (n.link_state = 'error' AND n.broke_at < $2::timestamptz) AS late,
           CASE WHEN n.link_state = 'error' AND n.broke_at < $2::timestamptz THEN
             (EXISTS (
                SELECT 1 FROM tasks t
                 WHERE t.org_id = n.org_id AND t.client_id = n.client_id
                   AND t.created_at >= n.broke_at
                   AND (t.title ~* $3::text OR COALESCE(t.body, '') ~* $3::text))
              OR EXISTS (
                SELECT 1 FROM messages m
                 WHERE m.org_id = n.org_id AND m.client_id = n.client_id
                   AND m.direction = 'outbound'
                   AND m.created_at >= n.broke_at
                   AND m.status IN ('sent', 'delivered', 'complained')
                   AND (COALESCE(m.template_key, '') ~* $3::text OR COALESCE(m.rendered_body, '') ~* $3::text)))
           ELSE false END AS told
      FROM newest n
  )
  SELECT count(*)::int AS banks,
         count(*) FILTER (WHERE link_state = 'error')::int AS in_error,
         count(*) FILTER (WHERE late AND NOT told)::int AS broken,
         count(*) FILTER (WHERE late AND told)::int AS followed_up,
         count(DISTINCT client_id) FILTER (WHERE late AND NOT told)::int AS clients,
         min(broke_at) FILTER (WHERE late AND NOT told) AS oldest,
         (array_agg(last_error_code ORDER BY broke_at) FILTER (WHERE late AND NOT told))[1] AS last_code
    FROM judged`;

/* The live pull connections, the same list the sweeper works
   (src/merchant/store.mjs listPullConnections), judged on the row itself. A
   connection that never synced counts from the day it was made. */
export const MERCHANT_SQL = `
  /* gap:merchant-sync */
  SELECT count(*)::int AS live,
         count(*) FILTER (WHERE last_sync_error IS NOT NULL)::int AS errored,
         count(*) FILTER (WHERE COALESCE(last_synced_at, created_at) < $2::timestamptz)::int AS quiet,
         count(*) FILTER (
           WHERE last_sync_error IS NOT NULL OR COALESCE(last_synced_at, created_at) < $2::timestamptz
         )::int AS late,
         min(COALESCE(last_synced_at, created_at)) FILTER (
           WHERE last_sync_error IS NOT NULL OR COALESCE(last_synced_at, created_at) < $2::timestamptz
         ) AS oldest,
         (array_agg(left(last_sync_error, 120) ORDER BY COALESCE(last_synced_at, created_at))
            FILTER (WHERE last_sync_error IS NOT NULL))[1] AS sample_error
    FROM merchant_connections
   WHERE mode = 'pull'
     AND status = 'active'
     AND encrypted_api_key IS NOT NULL
     AND ($1::uuid IS NULL OR org_id = $1::uuid)`;

export const SQL = Object.freeze([LOGIN_SQL, MERCHANT_SQL]);

const HOUR_MS = 60 * 60 * 1000;

const TAIL = "Do not call Plaid. Do not exchange tokens. Do not auto-fix. Chris fixes reds.";

function check(id, status, detail, suggestedFix = null, extra = null) {
  return extra ? { id, status, detail, suggestedFix, ...extra } : { id, status, detail, suggestedFix };
}

function reader(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  const db = ctx && ctx.db;
  if (db && typeof db.query === "function") return (fn) => fn(db);
  return null;
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

/* A processor error is plain words by contract (src/merchant/store.mjs
   saveSyncError: "never a key"), but a long run of letters and digits could still
   be one. Any run of 24 or more is dropped before it reaches the morning text. */
function scrub(s) {
  return clip(s, 120).replace(/[A-Za-z0-9_\-]{24,}/g, "[removed]");
}

function noun(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function ageWords(ms) {
  const h = ms / HOUR_MS;
  if (h < 36) return `${Math.max(1, Math.round(h))} hours`;
  return `${Math.round(h / 24)} days`;
}

async function one(run, sql, params) {
  const res = await run((db) => db.query(sql, params));
  const row = res && Array.isArray(res.rows) ? res.rows[0] : null;
  if (!row) throw new Error("the read came back with no row");
  return row;
}

// ── banks:login-broken ───────────────────────────────────────────────────────

export function judgeLogins(row, now) {
  const id = "banks:login-broken";
  const banks = num(row.banks);
  const broken = num(row.broken);
  if (broken === 0) {
    const inError = num(row.in_error);
    const note = inError === 0
      ? "none is in error"
      : `${inError} ${inError === 1 ? "is" : "are"} in error, but ${inError === 1 ? "it is" : "they are"} inside the first day or already followed up`;
    return check(id, "PASS", `No client is waiting on a broken bank login. ${noun(banks, "bank login", "bank logins")} read (newest per bank); ${note}.`);
  }
  const clients = num(row.clients);
  const oldest = toDate(row.oldest);
  const age = oldest ? ` The oldest broke ${ageWords(now.getTime() - oldest.getTime())} ago.` : "";
  const code = row.last_code ? ` Plaid code: ${clip(row.last_code, 60)}.` : "";
  return check(
    id,
    "FAIL",
    `${noun(broken, "bank login is", "bank logins are")} in error for over a day with no message to the client and no staff task ` +
      `(${noun(clients, "client", "clients")}). The money screen cannot refresh ${broken === 1 ? "that bank" : "those banks"}.${age}${code}`,
    `Tell the client to connect the same bank again (Connect a bank on the money screen) or open a staff task for it. ${TAIL}`
  );
}

// ── banks:merchant-sync ──────────────────────────────────────────────────────

export function judgeMerchants(row, now) {
  const id = "banks:merchant-sync";
  const live = num(row.live);
  if (live === 0) {
    return check(
      id,
      "na",
      "No client has a live merchant pull connection, so there is no sync to be late. Judged the day one is connected.",
      null,
      { na: { code: "not-connected", args: { check: id, what: "Merchant pull" } } }
    );
  }
  const late = num(row.late);
  if (late === 0) {
    return check(id, "PASS", `${noun(live, "live merchant pull connection has", "live merchant pull connections have")} synced inside 2 days with no error.`);
  }
  const errored = num(row.errored);
  const oldest = toDate(row.oldest);
  const age = oldest ? ` The oldest good read was ${ageWords(now.getTime() - oldest.getTime())} ago.` : "";
  const sample = row.sample_error ? ` Last error: ${scrub(row.sample_error)}` : "";
  return check(
    id,
    "FAIL",
    `${noun(late, "merchant pull connection is", "merchant pull connections are")} late: ` +
      `${errored} with a sync error, ${num(row.quiet)} with no sync in 2 days (of ${live} live).${age}${sample}`,
    "Read last_sync_error on the merchant connection. A bad or expired processor key shows there. The client re-saves the key on the Connections page. " +
      "Never print the key. Do not auto-fix. Chris fixes reds."
  );
}

/**
 * naVerify["not-connected"](args, ctx) → boolean. The claim "no live pull
 * connection" is read again, the same way, before the audit lets it stand.
 */
export const naVerify = Object.freeze({
  "not-connected": async (args, ctx = {}) => {
    if (!args || args.check !== "banks:merchant-sync") return false;
    const run = reader(ctx);
    if (!run) return false;
    try {
      const cut = new Date((toDate(ctx.now) || new Date()).getTime() - MERCHANT_QUIET_MS);
      const row = await one(run, MERCHANT_SQL, [ctx.orgId || null, cut.toISOString()]);
      return num(row.live) === 0;
    } catch {
      return false;
    }
  }
});

function readFailed(id, err) {
  return check(id, "skip", `The read for ${id} did not come back: ${clip((err && err.message) || err)}.`);
}

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }]
 * status is PASS, FAIL, skip or na (with a code the audit can re-check).
 * ctx: { db } or { scope }, optional { now, orgId }. SELECT only.
 */
export async function gapChecks(ctx = {}) {
  const run = reader(ctx);
  if (!run) {
    return CHECK_IDS.map((id) => check(id, "skip", "No database in this run, so nothing was read."));
  }
  const now = toDate(ctx.now) || new Date();
  const orgId = ctx.orgId || null;
  const loginCut = new Date(now.getTime() - LOGIN_WINDOW_MS).toISOString();
  const merchantCut = new Date(now.getTime() - MERCHANT_QUIET_MS).toISOString();

  const [login, merchant] = await Promise.all([
    one(run, LOGIN_SQL, [orgId, loginCut, BANK_TOLD_RE])
      .then((row) => judgeLogins(row, now))
      .catch((err) => readFailed("banks:login-broken", err)),
    one(run, MERCHANT_SQL, [orgId, merchantCut])
      .then((row) => judgeMerchants(row, now))
      .catch((err) => readFailed("banks:merchant-sync", err))
  ]);
  return [login, merchant];
}
