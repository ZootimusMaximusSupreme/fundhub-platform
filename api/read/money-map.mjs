// GET /api/read/money-map?client_id=<uuid>[&days=<1..365>][&amount=<dollars>]
//
// One client's whole money picture in one read: card payment due dates,
// recurring bills across every account, cash in and out over a window,
// utilization from three named engines, what is coming that somebody should act
// on, and what could be drawn.
//
// SIX TABLES, ONE ROUND TRIP. tradelines, card_liabilities, bank_accounts,
// recurring_bills, cashflow_reminders — read here, plus money coming in from
// src/banking/income.mjs loadIncome() — assembled by
// src/finance/money-map.mjs, which is pure and holds every rule. This file
// fetches and gates; it decides nothing about the numbers.
//
//
// THE ROLE GATE IS TWO CALLS, NOT ONE ARGUMENT.
//
// requireAuth's third parameter is { db, env } and goes straight to
// authenticate(), which destructures exactly those two names — a `roles` key
// there is accepted by the object literal and silently dropped.
// api/read/tradelines.mjs shipped that once and the effective rule became "any
// authenticated staff session, any role" on an endpoint serving a named client's
// credit limits. So: requireAuth, then a real requireRole().
//
// ROLE_SETS.STAFF, matching api/read/tradelines.mjs, api/read/finance-os.mjs and
// api/read/banking-surface.mjs, which serve the same rows this one gathers.
// Gating the summary more tightly than the detail would buy nothing: anyone
// refused here can read the underlying lines from the endpoints next door.
//
//
// ORG SCOPING COMES FROM THE SESSION, AND IT FAILS CLOSED.
//
// This is the part the neighbouring endpoints do not do, and it is the reason
// this file has a client lookup before it has any data query. `staff.org_id` is
// attached by requireAuth from the sessions row — it is never read from the
// query string, because a caller-supplied org id is not a scope, it is a wish.
//
// Two refusals, both deliberate:
//
//   * A session with NO org_id gets 403. Not "fall back to the default org" and
//     not "read across all orgs" — a session that cannot say which tenant it
//     belongs to may not read a named person's bank balances. Every table below
//     carries org_id (schema rule 7), so proceeding without one would mean
//     dropping the scope entirely.
//   * A client that exists in ANOTHER org gets 404, not 403. The distinction
//     between "no such client" and "that client is not yours" is only useful to
//     somebody enumerating uuids.
//
// After the check, every query is filtered on org_id AS WELL as client_id.
// Belt and braces: the client is already proven in-org, and the second filter
// means a row mis-attributed by an ingest still cannot cross a tenant boundary.
//
//
// DATE COLUMNS ARE CAST TO text IN SQL, ON PURPOSE.
//
// node-postgres parses a `date` into a Date at LOCAL midnight; readDate() then
// reads it back with toISOString(), which is UTC. East of UTC that is an
// off-by-one on a payment due date — the single most consequential number on
// this screen. `::text` removes the class of bug rather than working around it.
//
// SELECTED COLUMNS, NOT `SELECT *`. plaid_items.encrypted_access_token lives one
// join away from bank_accounts and a read endpoint has no business being one
// typo from it.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { moneyMap } from "../../src/finance/money-map.mjs";
import { loadThresholds } from "../../src/banking/settings.mjs";
import { loadIncome } from "../../src/banking/income.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/* The window. 30 days is the horizon a monthly billing cycle needs to be fully
   visible; it is a DEFAULT and the caller can move it, not a rule. The cap
   exists because project() itself caps the horizon and a request for ten years
   of daily rows is a way to make a serverless function time out. */
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;

const TRADELINE_COLUMNS = `
  id, client_id, lender, kind,
  credit_limit_cents, balance_cents, apr,
  source, account_ref, as_of::text AS as_of, closed_at`;

const LIABILITY_COLUMNS = `
  id, client_id, tradeline_id, as_of::text AS as_of,
  statement_balance_cents, current_balance_cents, minimum_payment_cents,
  past_due_cents, last_payment_cents, last_payment_date::text AS last_payment_date,
  statement_date::text AS statement_date, payment_due_date::text AS payment_due_date,
  apr, payment_status, source`;

const BANK_ACCOUNT_COLUMNS = `
  id, client_id, name, official_name, mask,
  provider,
  account_type, account_subtype, currency_code,
  available_balance_cents, current_balance_cents, credit_limit_cents,
  balance_as_of, entity_kind, entity_kind_source, entity_kind_set_at, closed_at`;

const BILL_COLUMNS = `
  id, org_id, bank_account_id, client_id,
  merchant_key, merchant_display, cadence, typical_amount_cents,
  next_expected_on::text AS next_expected_on, next_expected_unknown_reason,
  anchor_day_of_month,
  confidence_pct, confidence_label, is_business, occurrence_count,
  first_seen_on::text AS first_seen_on, last_seen_on::text AS last_seen_on,
  detected_as_of`;

const REMINDER_COLUMNS = `
  id, org_id, client_id, subject_kind, subject_id, subject_label,
  reminder_kind, body, surface_at, acknowledged_at`;

/* days — a whole number in [1, MAX_DAYS], or the default. A malformed value is
   REJECTED rather than coerced: "days=banana" silently becoming 30 is how a
   screen ends up showing a window nobody asked for. */
export function readDays(raw) {
  if (raw === undefined || raw === null || raw === "") return { days: DEFAULT_DAYS };
  const n = Number(String(raw).trim());
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_DAYS) {
    return { error: `days must be a whole number between 1 and ${MAX_DAYS}` };
  }
  return { days: n };
}

/* amount — dollars for the funding waterfall, or nothing. Absent means "do not
   run an allocation", which is a different request from "allocate zero". */
export function readAmount(raw) {
  if (raw === undefined || raw === null || raw === "") return { amount: null };
  const n = Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return { error: "amount must be a non-negative number of dollars" };
  return { amount: n };
}

/* The clock, at the edge, once. src/finance/money-map.mjs takes `asOf` as a
   parameter and has no clock of its own — that is what makes it testable. This
   is the only place a real date enters, and it is UTC so that the same request
   from two regions describes the same day. */
export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const clock = deps.now || (() => new Date());
  const incomeOf = deps.loadIncome || loadIncome;

  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  /* FAIL CLOSED. No org on the session means no scope, and no scope means no
     read. There is deliberately no fallback to a default org here: this endpoint
     serves one named person's bank balances and card statements. */
  const orgId = staff.org_id;
  if (!orgId) {
    return res.status(403).json({
      ok: false,
      error: "no_org_scope",
      message: "this session is not attached to an organisation, so no client data can be read"
    });
  }

  const query = req.query || {};
  if (!isUuid(query.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }
  const clientId = String(query.client_id).trim();

  const d = readDays(query.days);
  if (d.error) return res.status(400).json({ ok: false, error: d.error });
  const a = readAmount(query.amount);
  if (a.error) return res.status(400).json({ ok: false, error: a.error });

  try {
    /* THE SCOPE CHECK, BEFORE ANY DATA QUERY. A client in another org is
       reported as not found — the difference between "no such client" and "that
       client is not yours" is only useful to somebody probing uuids. */
    const client = await database.query(
      `SELECT id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    if (client.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "no_such_client" });
    }

    const asOf = today(clock());

    /* Closed lines and closed accounts are FETCHED, not filtered out here. "This
       client had six cards and two are closed" is a different fact from "this
       client has four cards", and the modules downstream are what decide that a
       closed line has no headroom and a closed account's last balance is not
       money anybody can reach. */
    /* THE ORG'S OWN THRESHOLDS, read through the module that owns them rather
       than as a sixth hand-written SELECT. An org with no row gets `{}` and
       loadThresholds deliberately creates nothing — a read that wrote a default
       row would bake "somebody decided zero" into the database on first read.
       project() then reports each unset threshold as a gap, which the screen
       prints under "Read this first". */
    /* MONEY COMING IN, through the module that owns it (src/banking/income.mjs).
       Scoped by the session's org and the proven client. loadIncome never
       throws on a failed bank read: it answers { ok: false }, and moneyMap
       then says income was not read instead of failing the whole map. */
    const [thresholds, income, tradelines, liabilities, bankAccounts, recurringBills, reminders] = await Promise.all([
      loadThresholds(database, { orgId }),
      incomeOf(database, { orgId, clientId, asOf }),
      database.query(
        `SELECT ${TRADELINE_COLUMNS} FROM tradelines
          WHERE client_id = $1 AND org_id = $2
          ORDER BY apr ASC NULLS LAST, lender ASC`,
        [clientId, orgId]
      ),
      database.query(
        `SELECT ${LIABILITY_COLUMNS} FROM card_liabilities
          WHERE client_id = $1 AND org_id = $2
          ORDER BY payment_due_date ASC NULLS LAST, as_of DESC`,
        [clientId, orgId]
      ),
      database.query(
        `SELECT ${BANK_ACCOUNT_COLUMNS} FROM bank_accounts
          WHERE client_id = $1 AND org_id = $2
          ORDER BY entity_kind, name NULLS LAST, id`,
        [clientId, orgId]
      ),
      /* ACROSS ALL ACCOUNTS, which is the point of the section: a bill detected
         on a savings account the client forgot about counts. Scoped by client
         and org, not by bank_account_id. */
      database.query(
        `SELECT ${BILL_COLUMNS} FROM recurring_bills
          WHERE client_id = $1 AND org_id = $2
            AND confidence_label IN ('medium', 'high')
          ORDER BY typical_amount_cents ASC, merchant_key ASC`,
        [clientId, orgId]
      ),
      /* Due and not yet acknowledged. Reading one changes nothing — there is no
         surfaced_at stamped anywhere in this endpoint. */
      database.query(
        `SELECT ${REMINDER_COLUMNS} FROM cashflow_reminders
          WHERE client_id = $1 AND org_id = $2
            AND acknowledged_at IS NULL
            AND surface_at <= now()
          ORDER BY surface_at ASC, created_at ASC
          LIMIT 200`,
        [clientId, orgId]
      )
    ]);

    const payload = moneyMap({
      asOf,
      horizonDays: d.days,
      tradelines: tradelines.rows,
      liabilities: liabilities.rows,
      bankAccounts: bankAccounts.rows,
      recurringBills: recurringBills.rows,
      reminders: reminders.rows,
      requestedAmount: a.amount,
      thresholds,
      income
    });

    const row = client.rows[0];
    return res.status(200).json({
      ok: true,
      client: {
        id: row.id,
        /* Enough to prove the right file is open, and nothing more. No email, no
           phone, no identifiers — this is a money screen. */
        name: [row.first_name, row.last_name].filter(Boolean).join(" ") || null
      },
      ...payload
    });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e.code)) {
      return res.status(400).json({ ok: false, error: "bad request parameter" });
    }
    /* A DATABASE THAT DID NOT ANSWER IS NOT OUR CODE THROWING, AND THE SCREEN
       MUST NOT BE TOLD IT WAS. Everything above this line has already claimed
       the faults it can name; what is left reaches netlify/functions/api.mjs as
       a bare 500 internal_error, which public/app/data.js words as "something
       went wrong on our side ... The database did not report a problem." That
       sentence is false during an outage and it is how the funding-capacity read
       reported a dead database as a bug in this file. 503 + db:"down" is the
       shape data.js already reads as "the database is not answering".
       See src/http/db-down.mjs — it stays narrow, so anything it cannot
       positively identify still falls through to the 500 it got before. */
    if (dbDown(res, e)) return;

    throw e;
  }
}
