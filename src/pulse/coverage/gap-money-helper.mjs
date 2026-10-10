// FinanceOS money helper rows that are stuck. Report only. Read-only SQL.
//
// One question a client would feel: "I pressed Do task, or I asked the helper
// something, and nothing happened."
//
//   helper:rows-stuck
//     1. a "Do task" row the agent should claim, still queued
//     2. a row the agent claimed and never finished (and did not hold on purpose)
//     3. a money proposal still waiting on the client after the engine's own
//        expiry day (the 15-minute transfer job should have closed it)
//     4. a chat turn still queued or running, with no answer
//     5. a chat turn that failed in the last day (the client got no answer)
//     6. an "I'm ready to get funded" press with no CSM prep-call task
//
// WHO WORKS THESE ROWS. Only the Mac runner (src/finance/money-helper-runner.mjs,
// npm run money:run-queue) claims queued "Do task" rows: sweepAgentTasks has no
// other caller (measured 2026-10-10). So when the runner is off, rows 1 and 4
// pile up with no error anywhere. That is the break this lane watches for.
//
// THE WINDOWS ARE THE CODE'S OWN, NOT NEW ONES:
//   STUCK_AFTER_MS      10 minutes. src/finance/money-helper.mjs STALE_RUNNING_MS:
//                       a running turn whose runner went quiet this long is
//                       taken back. The runner looks every 3 seconds, so a row
//                       nobody touched in 10 minutes has no runner.
//   PROPOSAL_GRACE_DAYS 3 days. src/finance/money-transfers.mjs
//                       EXECUTION_GRACE_DAYS. The same date rule as
//                       overdueProposals (greatest of the due day and the day
//                       it was made, New York dates).
//   READY_PRESS_GRACE   1 hour. The press makes the CSM task in the same
//                       request (src/finance/ready-to-fund.mjs), so an hour is
//                       generous.
//   FAILED_TURN_LOOK    1 day. A failed turn is a thing that happened, not a
//                       state, so it stays red for one morning report.
//
// A row held on purpose is not stuck: result.in_progress = true means the helper
// did its part and a step is still the client's (src/finance/money-agent-tasks.mjs
// holdTask). A "person" row waits on its CSM task and is not the helper's.
//
// Test clients are left out (the same pattern as the consent and portal lanes).
// Money rows that are approved or being sent belong to the transfer lane
// (money_transfers). Nothing is written. A read that fails is a skip.

import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";

export const STUCK_AFTER_MS = 10 * 60 * 1000;
export const PROPOSAL_GRACE_DAYS = 3;
export const READY_PRESS_GRACE_MS = 60 * 60 * 1000;
export const FAILED_TURN_LOOK_MS = 24 * 60 * 60 * 1000;

/** The prep-call task the "ready to get funded" press opens (src/blueprint/closer-ready.mjs). */
export const CSM_PREP_SOURCE = "blueprint-csm-prep";
export const PREP_CALL_BODY = "blueprint-csm-prep-call";

export const CHECK_IDS = Object.freeze(["helper:rows-stuck"]);

function notTest(alias) {
  return `($2::boolean OR NOT EXISTS (
            SELECT 1 FROM clients tc
             WHERE tc.id = ${alias}.client_id AND tc.org_id = ${alias}.org_id
               AND (COALESCE(tc.is_demo, false)
                    OR COALESCE(tc.custom_fields ->> 'synthetic', '') = 'true'
                    OR COALESCE(tc.email, '') ~* $3::text)))`;
}

/* $1 org (null = every org) · $2 demoOn · $3 test-client pattern · $4 stuck cut
   · $5 proposal cut-off day · $6 failed-turn start · $7 ready-press cut
   · $8 prep-call source · $9 prep-call body (round 1). */
export const STUCK_SQL = `
  /* gap:helper-rows-stuck */
  SELECT
    (SELECT count(*)::int FROM money_agent_tasks t
      WHERE t.assignee = 'agent' AND t.status = 'queued'
        AND t.created_at < $4::timestamptz
        AND ($1::uuid IS NULL OR t.org_id = $1::uuid)
        AND ${notTest("t")}) AS tasks_queued,
    (SELECT count(*)::int FROM money_agent_tasks t
      WHERE t.status = 'claimed'
        AND COALESCE(t.claimed_at, t.updated_at) < $4::timestamptz
        AND COALESCE(t.result ->> 'in_progress', '') <> 'true'
        AND ($1::uuid IS NULL OR t.org_id = $1::uuid)
        AND ${notTest("t")}) AS tasks_claimed,
    (SELECT count(*)::int FROM money_agent_tasks t
      WHERE t.status = 'needs_approval' AND t.moves_money
        AND GREATEST(COALESCE(t.due_on, (t.created_at AT TIME ZONE 'America/New_York')::date),
                     (t.created_at AT TIME ZONE 'America/New_York')::date) < $5::date
        AND ($1::uuid IS NULL OR t.org_id = $1::uuid)
        AND ${notTest("t")}) AS proposals_late,
    (SELECT count(*)::int FROM money_helper_turns h
      WHERE h.status IN ('queued', 'running')
        AND COALESCE(h.claimed_at, h.created_at) < $4::timestamptz
        AND ($1::uuid IS NULL OR h.org_id = $1::uuid)
        AND ${notTest("h")}) AS turns_open,
    (SELECT count(*)::int FROM money_helper_turns h
      WHERE h.status = 'failed'
        AND h.updated_at > $6::timestamptz
        AND ($1::uuid IS NULL OR h.org_id = $1::uuid)
        AND ${notTest("h")}) AS turns_failed,
    (SELECT count(*)::int FROM money_agent_log l
      WHERE l.action = 'ready_to_fund'
        AND l.created_at < $7::timestamptz
        AND ($1::uuid IS NULL OR l.org_id = $1::uuid)
        AND ${notTest("l")}
        AND NOT EXISTS (
          SELECT 1 FROM tasks k
           WHERE k.org_id = l.org_id AND k.client_id = l.client_id
             AND k.source_workflow = $8::text
             AND k.body = CASE
               WHEN COALESCE(substring(l.idempotency_key from ':r([0-9]+)$')::int, 1) > 1
               THEN $9::text || ':r' || substring(l.idempotency_key from ':r([0-9]+)$')
               ELSE $9::text END)) AS ready_no_task`;

const TAIL = "Do not move money. Do not text anyone. Do not auto-fix. Chris fixes reds.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
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

function noun(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The New York calendar day (YYYY-MM-DD) of a moment. The engine's proposal rule uses New York dates. */
export function newYorkDay(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(isoDay, delta) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** The first day that is NOT overdue: a proposal dated before this is past its grace. */
export function proposalCutoffDay(now) {
  return addDays(newYorkDay(now), -PROPOSAL_GRACE_DAYS);
}

export function judge(row) {
  const id = "helper:rows-stuck";
  const parts = [];
  const queued = num(row.tasks_queued);
  const claimed = num(row.tasks_claimed);
  const proposals = num(row.proposals_late);
  const turnsOpen = num(row.turns_open);
  const turnsFailed = num(row.turns_failed);
  const ready = num(row.ready_no_task);
  if (queued) {
    parts.push(`${noun(queued, "Do task row is", "Do task rows are")} still queued after 10 minutes (the Mac runner claims these, so it may be off)`);
  }
  if (claimed) {
    parts.push(`${noun(claimed, "Do task row was", "Do task rows were")} claimed and never finished`);
  }
  if (proposals) {
    parts.push(`${noun(proposals, "money proposal is", "money proposals are")} still waiting on the client after its ${PROPOSAL_GRACE_DAYS}-day expiry (the 15-minute transfer job should have closed ${proposals === 1 ? "it" : "them"})`);
  }
  if (turnsOpen) {
    parts.push(`${noun(turnsOpen, "helper chat message has", "helper chat messages have")} no answer after 10 minutes`);
  }
  if (turnsFailed) {
    parts.push(`${noun(turnsFailed, "helper chat message", "helper chat messages")} failed in the last day`);
  }
  if (ready) {
    parts.push(`${noun(ready, "client pressed", "clients pressed")} "ready to get funded" and ${ready === 1 ? "has" : "have"} no CSM prep-call task`);
  }
  if (!parts.length) {
    return check(id, "PASS", "No Do task row, helper chat message or ready-to-get-funded press is stuck.");
  }
  return check(
    id,
    "FAIL",
    `${parts.join("; ")}.`,
    "Check that the money helper runner is on (npm run money:run-queue) and that the transfer job is running. " +
      `A ready-to-get-funded press needs its CSM prep-call task (the same task the Blueprint opens). ${TAIL}`
  );
}

/**
 * gapChecks(ctx) → [{ id, status, detail, suggestedFix }]
 * ctx: { db } or { scope }, optional { now, orgId, demoOn }. SELECT only.
 */
export async function gapChecks(ctx = {}) {
  const id = "helper:rows-stuck";
  const run = reader(ctx);
  if (!run) return [check(id, "skip", "No database in this run, so the helper rows were not read.")];
  const now = toDate(ctx.now) || new Date();
  const params = [
    ctx.orgId || null,
    ctx.demoOn === true,
    TEST_CLIENT_EMAIL_RE,
    new Date(now.getTime() - STUCK_AFTER_MS).toISOString(),
    proposalCutoffDay(now),
    new Date(now.getTime() - FAILED_TURN_LOOK_MS).toISOString(),
    new Date(now.getTime() - READY_PRESS_GRACE_MS).toISOString(),
    CSM_PREP_SOURCE,
    PREP_CALL_BODY
  ];
  try {
    const res = await run((db) => db.query(STUCK_SQL, params));
    const row = res && Array.isArray(res.rows) ? res.rows[0] : null;
    if (!row) return [check(id, "skip", "The helper read came back with no row, so nothing was judged.")];
    return [judge(row)];
  } catch (err) {
    return [check(id, "skip", `The helper rows could not be read: ${clip((err && err.message) || err)}.`)];
  }
}
