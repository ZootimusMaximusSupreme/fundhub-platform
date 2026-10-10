// Account alerts — did the text the client was promised actually go out? Read only. Report only.
//
// W4 of the 2026-10-10 coverage batch (ops/workflows/coverage-every-surface-2026-10-10.md, item 8).
// Two promises the app makes to a Finance OS or Capital Blueprint client by text:
//
//   1. A file-protection alert (pay before the statement closes, promo ending, cash cushion, new credit).
//      The daily job (src/workflows/blueprint-finance-os-alerts.mjs) writes one file_protection_alerts row
//      when it queues the text, with the message id on it. Question: does that message exist, and did it
//      leave and arrive, or is it stuck, failed or held?
//   2. A card-due reminder (the daily job src/workflows/finance-os-card-due-reminders.mjs, 9 a.m. Arizona).
//      A card or loan whose payment is due in 0 to 3 days is owed ONE text. Question: for every reminder the
//      job owed at its last pass, is there a text?
//
// One id, one yes-or-no: alerts:texts-went-out.
//
// What this does not do: it does not decide who is OWED a file-protection alert (the four planners in
// src/finance/file-alerts/ do, and re-deriving them here would be a second copy). It reads what went out.
// The card-due plan IS re-derived, because planCardDue and planLoanDue are pure and exported: this file runs
// the job's own planners on the job's own rows, with the date of the job's last pass.
//
// RULES (heartbeat law): SELECT only. No text, no email, no web call. A failed read is a skip with the reason.
// Test traffic (demo flag, synthetic client, test address) is left out. Under 20 seconds.

import { planCardDue, planLoanDue, TEMPLATE_KEY as CARD_DUE_TEMPLATE_KEY } from "../../banking/card-due-reminders.mjs";
import { TEST_ADDRESS_RE } from "./gap-sms.mjs";

export const CHECK_IDS = Object.freeze(["alerts:texts-went-out"]);

/** A file-protection alert is read for this long after it was queued, and on the day it is about. */
export const ALERT_LOOKBACK_DAYS = 3;
/** A queued or sending text that was due more than this long ago is stuck. (A text queued at night waits for 8 a.m.) */
export const STUCK_HOURS = 2;
/** A text handed to the phone company with no receipt after this long was not seen to arrive. */
export const RECEIPT_HOURS = 24;
/** The job runs at 16:00 UTC (9 a.m. Arizona). A pass is judged one hour after it should have started. */
export const PASS_HOUR_UTC = 16;
export const PASS_GRACE_HOURS = 1;
export const FINANCE_OS_TIER = "finance-os";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const TAIL = "Do not send from this check. Do not change the outbound switch. Do not re-run the job from here.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function clip(value, max = 120) {
  const s = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function toMs(v) {
  if (v == null || v === "") return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

async function readRows(db, sql, params) {
  try {
    const got = await db.query(sql, params);
    return { rows: got && Array.isArray(got.rows) ? got.rows : null };
  } catch (err) {
    return { error: clip((err && err.message) || err, 160) };
  }
}

/* The people a customer text may be about: not demo, not synthetic, not a test address. Same filter as gap-sms.mjs. */
function realClient(alias, p) {
  return `COALESCE(${alias}.is_demo, false) = false
   AND COALESCE(${alias}.custom_fields ->> 'synthetic', '') <> 'true'
   AND COALESCE(${alias}.email, '') !~* ${p}::text`;
}

// ── file-protection alerts ───────────────────────────────────────────────────

/**
 * $1 org, $2 since, $3 today (a date), $4 TEST_ADDRESS_RE.
 * Every alert that says a text was queued, with the message it points at. The message may be gone (a null id).
 */
export const ALERT_TEXTS_SQL = `
SELECT a.kind,
       a.due_on,
       a.sent_at,
       m.id AS message_id,
       m.status,
       m.blocked_reason,
       m.created_at AS message_created_at,
       COALESCE(m.scheduled_at, m.created_at) AS due_at,
       m.last_attempt_at
  FROM file_protection_alerts a
  JOIN clients c ON c.id = a.client_id AND c.org_id = a.org_id
  LEFT JOIN messages m ON m.id = a.message_id AND m.org_id = a.org_id
 WHERE a.org_id = $1::uuid
   AND a.delivery = 'text'
   AND (a.sent_at >= $2::timestamptz OR a.due_on = $3::date)
   AND ${realClient("c", "$4")}
 ORDER BY a.sent_at DESC
 LIMIT 300`.trim();

/** One alert row. Returns null when the text is fine, or a short reason it is not. Pure. */
export function alertProblem(r, now) {
  if (!r.message_id) return "its message row is gone";
  const status = String(r.status || "");
  if (status === "delivered" || status === "complained") return null;
  if (status === "failed" || status === "bounced") return `the text ${status}`;
  if (status === "blocked") return r.blocked_reason === "opted_out" ? null : `our own gate held it (${clip(r.blocked_reason || "no reason", 40)})`;
  if (status === "queued" || status === "sending") {
    const due = toMs(r.due_at);
    if (due !== null && now.getTime() - due > STUCK_HOURS * HOUR) return `it has been ${status} since it was due`;
    return null;
  }
  if (status === "sent") {
    const at = toMs(r.last_attempt_at) ?? toMs(r.message_created_at);
    if (at !== null && now.getTime() - at > RECEIPT_HOURS * HOUR) return `it left and no delivery receipt came back in ${RECEIPT_HOURS} hours`;
    return null;
  }
  return `its status is ${clip(status || "empty", 20)}`;
}

// ── card-due reminders ───────────────────────────────────────────────────────

/**
 * $1 org, $2 as-of (the clock the job's entitlement read uses), $3 TEST_ADDRESS_RE.
 * The job's own two reads (providerCycles, loanCycles) for every Finance OS client, in one statement:
 * Plaid cards (source provider, not a loan, not closed) and any loan (hand-entered too), not closed.
 * sms_opted_out is true for a person who said STOP: sendTemplated writes no row for them, by design.
 */
export const CARD_CYCLES_SQL = `
SELECT c.id AS cycle_id,
       c.client_id,
       c.bank_account_id,
       c.payment_due_day,
       c.minimum_payment_cents,
       c.last_statement_balance_cents,
       c.last_statement_date,
       c.raw,
       a.name,
       a.mask,
       a.current_balance_cents,
       (a.account_type = 'loan') AS is_loan,
       EXISTS (
         SELECT 1 FROM opt_outs o
          WHERE o.client_id = c.client_id AND o.channel = 'sms' AND o.opted_in_at IS NULL
       ) AS sms_opted_out
  FROM account_statement_cycles c
  JOIN bank_accounts a ON a.id = c.bank_account_id AND a.org_id = c.org_id
  JOIN subscriptions s
    ON s.client_id = c.client_id AND s.org_id = c.org_id
   AND s.tier = '${FINANCE_OS_TIER}' AND s.status = 'active'
   AND s.effective_from <= $2::timestamptz
   AND (s.effective_to IS NULL OR s.effective_to > $2::timestamptz)
  JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
 WHERE c.org_id = $1::uuid
   AND a.closed_at IS NULL
   AND (
        (a.account_type IS DISTINCT FROM 'loan' AND c.source = 'provider')
     OR a.account_type = 'loan'
   )
   AND ${realClient("cl", "$3")}
 LIMIT 500`.trim();

/** $1 org, $2 the references the job would have written (workflow:<template>:card-due:<account>:<due date>). */
export const CARD_TEXTS_SQL = `
SELECT m.provider_ref, m.status, m.blocked_reason,
       COALESCE(m.scheduled_at, m.created_at) AS due_at,
       m.last_attempt_at, m.created_at AS message_created_at, m.id AS message_id
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.provider_ref = ANY($2::text[])`.trim();

export const CARD_TEMPLATE_SQL =
  "SELECT compliance_passed FROM message_templates WHERE org_id = $1::uuid AND template_key = $2::text LIMIT 1";

/** The UTC date of the job's last pass that has had its hour. At 06:00 UTC that is yesterday's. Pure. */
export function lastPassDate(now) {
  return new Date(now.getTime() - (PASS_HOUR_UTC + PASS_GRACE_HOURS) * HOUR).toISOString().slice(0, 10);
}

/** What the job owed at its last pass: [{ ref, label, dueOn, optedOut, kind }]. Pure. */
export function owedReminders(cycles, today) {
  const owed = [];
  for (const c of cycles) {
    const plan = c.is_loan ? planLoanDue(c, { today }) : planCardDue(c, { today });
    if (!plan || plan.remind !== true || !plan.eventId) continue;
    owed.push({
      ref: `workflow:${CARD_DUE_TEMPLATE_KEY}:${plan.eventId}`,
      label: clip(plan.label || "card", 40),
      dueOn: plan.dueOn,
      optedOut: c.sms_opted_out === true,
      kind: c.is_loan ? "loan" : "card"
    });
  }
  return owed;
}

const FIX =
  "Read the file_protection_alerts row and the message it points at, or the account_statement_cycles row and the " +
  "messages row for the card. A missing text means the job did not queue it (template not approved, job did not " +
  "run, or the client has no phone). A failed or held text means the provider or our own gate stopped it. " +
  `A person fixes it, not this check. ${TAIL}`;

function judge({ alerts, cycles, texts, template, now }) {
  const id = "alerts:texts-went-out";
  const bad = [];
  const unread = [];
  const seen = [];

  // 1. file-protection alerts
  if (alerts.error || !alerts.rows) {
    unread.push(`file-protection alerts could not be read (${alerts.error || "no rows came back"})`);
  } else {
    let checked = 0;
    const why = new Map();
    for (const r of alerts.rows) {
      checked += 1;
      const p = alertProblem(r, now);
      if (p) {
        const key = `${r.kind}: ${p}`;
        why.set(key, (why.get(key) || 0) + 1);
      }
    }
    if (why.size > 0) {
      const total = [...why.values()].reduce((a, b) => a + b, 0);
      const parts = [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} x${n}`);
      bad.push(`${total} of ${checked} file-protection ${plural(checked, "alert", "alerts")} did not go out: ${parts.join("; ")}`);
    }
    seen.push(`${checked} file-protection ${plural(checked, "alert", "alerts")}`);
  }

  // 2. card-due reminders
  if (cycles.error || !cycles.rows) {
    unread.push(`card and loan cycles could not be read (${cycles.error || "no rows came back"})`);
  } else if (texts.error || !texts.rows) {
    unread.push(`card-due texts could not be read (${texts.error || "no rows came back"})`);
  } else {
    const today = lastPassDate(now);
    const owed = owedReminders(cycles.rows, today);
    const have = new Map(texts.rows.map((t) => [String(t.provider_ref), t]));
    const templateOk = template && template.rows && template.rows[0] ? template.rows[0].compliance_passed === true : null;
    let judged = 0;
    const missing = [];
    const stuck = [];
    for (const o of owed) {
      if (o.optedOut) continue;
      judged += 1;
      const t = have.get(o.ref);
      if (!t) {
        missing.push(`${o.label} due ${o.dueOn}`);
        continue;
      }
      const p = alertProblem({ message_id: t.message_id, status: t.status, blocked_reason: t.blocked_reason, due_at: t.due_at, last_attempt_at: t.last_attempt_at, message_created_at: t.message_created_at }, now);
      if (p) stuck.push(`${o.label} due ${o.dueOn}: ${p}`);
    }
    if (missing.length > 0) {
      const why = templateOk === false ? ". The card-due template is not approved, so the job queues nothing" : "";
      const more = missing.length > 3 ? `, ${missing.length - 3} more` : "";
      bad.push(`${missing.length} of ${judged} payment ${plural(judged, "reminder", "reminders")} the job owed ${plural(missing.length, "has", "have")} no text (${missing.slice(0, 3).join(", ")}${more})${why}`);
    }
    if (stuck.length > 0) {
      bad.push(`${stuck.length} card-due ${plural(stuck.length, "text", "texts")} did not go out (${stuck.slice(0, 3).join("; ")}${stuck.length > 3 ? `; ${stuck.length - 3} more` : ""})`);
    }
    seen.push(`${judged} payment ${plural(judged, "reminder", "reminders")} owed at the ${today} pass`);
  }

  if (bad.length > 0) {
    const tail = unread.length ? ` Not read: ${unread.join("; ")}.` : "";
    return row(id, "FAIL", `${bad.join(". ")}.${tail}`, FIX);
  }
  if (unread.length > 0) return row(id, "skip", `Alert texts not fully read: ${unread.join("; ")}.`);
  return row(id, "PASS", `Every text went out: ${seen.join(" and ")}, each with a text that left, arrived, or is waiting for its hour.`);
}

/**
 * gapChecks — one read-only row, alerts:texts-went-out.
 * ctx: { db, orgId, now }. SELECT only. Never sends.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db;
  const orgId = ctx.orgId;
  const id = CHECK_IDS[0];
  if (!db || typeof db.query !== "function") return [row(id, "skip", "No database in this run. Alert texts not read.")];
  if (!orgId) return [row(id, "skip", "No company in this run. Alert texts not read.")];
  const now = ctx.now instanceof Date && Number.isFinite(ctx.now.getTime()) ? ctx.now : new Date();

  try {
    const since = new Date(now.getTime() - ALERT_LOOKBACK_DAYS * DAY).toISOString();
    const [alerts, cycles, template] = await Promise.all([
      readRows(db, ALERT_TEXTS_SQL, [orgId, since, now.toISOString().slice(0, 10), TEST_ADDRESS_RE]),
      readRows(db, CARD_CYCLES_SQL, [orgId, now.toISOString(), TEST_ADDRESS_RE]),
      readRows(db, CARD_TEMPLATE_SQL, [orgId, CARD_DUE_TEMPLATE_KEY])
    ]);
    let texts = { rows: [] };
    if (cycles.rows) {
      const refs = owedReminders(cycles.rows, lastPassDate(now)).map((o) => o.ref);
      if (refs.length > 0) texts = await readRows(db, CARD_TEXTS_SQL, [orgId, refs]);
    }
    return [judge({ alerts, cycles, texts, template, now })];
  } catch (err) {
    return [row(id, "skip", `${id} could not run: ${clip((err && err.message) || err, 160)}.`)];
  }
}
