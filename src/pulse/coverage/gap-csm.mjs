// Client success queue gaps for the morning pulse. Read only. Report only.
//
// Slice 30 already lists owner desks, sales-manager desks, and whether the
// client success doors are on the morning list. The registry rows
// reg:read/csm-queue and reg:csm-queue already go red when the queue door or the
// queue page stops answering. This file does not repeat those. It looks for three
// breaks: the queue read fails, a client success task is overdue with nobody
// assigned, and a client who paid or was funded never got their accountability call.
//
// Tripwire is existing Recon (AG-07). No second watchdog. Never text a client.
//
// Nothing here reads a repo file. The shipped function holds no source tree, so a
// file read there fails every morning whether or not the product is fine.

import readCsmQueue from "../../../api/read/csm-queue.mjs";
import {
  ASSIGNEE_ROLE,
  MID_SOURCE_WORKFLOW as MID_WORKFLOW,
  SOURCE_WORKFLOW as POST_WORKFLOW
} from "../../handlers/customer-insights.mjs";

export const CHECK_IDS = Object.freeze([
  "csm:queue-api",
  "csm:overdue-unassigned",
  "csm:missing-step"
]);

export const QUEUE_PATH = "/api/read/csm-queue";

/** Money-in events that must open the halfway accountability call. */
export const MONEY_IN_EVENTS = Object.freeze([
  "deposit.paid",
  "sale.closed",
  "payment.received"
]);

export const MID_SOURCE_WORKFLOW = MID_WORKFLOW;

/** Each client success step: what happens to the client, and the task that must follow. */
export const STEPS = Object.freeze([
  Object.freeze({ label: "halfway accountability call", workflow: MID_WORKFLOW, events: MONEY_IN_EVENTS }),
  Object.freeze({ label: "results accountability call", workflow: POST_WORKFLOW, events: Object.freeze(["round.funded"]) })
]);

/** A task due this long ago with nobody on it is a miss. Due this morning is not. */
export const OVERDUE_GRACE_MS = 24 * 60 * 60 * 1000;
/** The event handler runs within minutes. Younger events are not judged. */
export const STEP_GRACE_MS = 10 * 60 * 1000;
export const STEP_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000;

export const OVERDUE_UNASSIGNED_SQL = `
  /* gap:csm-overdue-unassigned */
  SELECT count(*)::int AS n
    FROM tasks t
    JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
   WHERE t.org_id = $1::uuid
     AND t.assignee_role = '${ASSIGNEE_ROLE}'
     AND t.done = false
     AND COALESCE(t.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
     AND t.due_at IS NOT NULL
     AND t.due_at < $2::timestamptz
     AND t.assignee_staff_id IS NULL
`;

/** Per step: how many clients got the event and have no task from that step's workflow. */
export const MISSING_STEP_SQL = `
  /* gap:csm-missing-step */
  SELECT m.source_workflow AS workflow,
         count(DISTINCT e.client_id)::int AS n
    FROM events e
    JOIN (
      SELECT * FROM unnest($2::text[], $3::text[]) AS u(event_name, source_workflow)
    ) m ON m.event_name = e.name
    JOIN clients c ON c.id = e.client_id AND c.org_id = e.org_id
   WHERE e.org_id = $1::uuid
     AND e.client_id IS NOT NULL
     AND COALESCE(e.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
     AND e.created_at >= $4::timestamptz
     AND e.created_at <= $5::timestamptz
     AND NOT EXISTS (
       SELECT 1
         FROM tasks t
        WHERE t.org_id = e.org_id
          AND t.client_id = e.client_id
          AND t.source_workflow = m.source_workflow
     )
   GROUP BY m.source_workflow
`;

const TRIPWIRE =
  "Recon (AG-07) is the one tripwire. Do not invent a second watchdog. " +
  "Do not text clients. Do not auto-fix from this pulse.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String(err?.message || err).replace(/\s+/g, " ").slice(0, 180);
}

function countOf(result) {
  const n = Number(result?.rows?.[0]?.n ?? 0);
  return Number.isFinite(n) ? n : null;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

/**
 * Run the queue's own GET handler in this process, as a read-only staff caller,
 * against ctx.db. This runs the queue's real SQL and its real row mapping, so a
 * dropped view, a missing column, or a row the mapper cannot read all fail here.
 * One row is asked for. Nothing is written.
 */
export async function openCsmQueue({ db, orgId, handler = readCsmQueue } = {}) {
  const res = mockRes();
  const req = { method: "GET", headers: {}, query: { limit: "1" } };
  const deps = {
    db,
    requireAuth: async () => ({ id: null, role: "owner", org_id: orgId, name: "Morning pulse" })
  };
  try {
    await handler(req, res, deps);
    return { status: res.statusCode, body: res.body, thrown: null };
  } catch (err) {
    return { status: res.statusCode, body: res.body, thrown: err };
  }
}

async function checkQueueApi({ db, orgId, handler }) {
  const id = "csm:queue-api";
  if (!db || !orgId) return row(id, "skip", "no database in this run — CSM queue read not run");
  const out = await openCsmQueue({ db, orgId, handler });
  if (out.thrown) {
    return row(id, "FAIL", `CSM queue read threw: ${clip(out.thrown)}`, `${TRIPWIRE} Restore GET ${QUEUE_PATH}.`);
  }
  const body = out.body;
  if (out.status === 200 && body && body.ok === true && Array.isArray(body.items)) {
    return row(id, "PASS", `CSM queue read answered 200 (${plural(body.count ?? body.items.length, "row")} asked for, the real queue query ran)`);
  }
  const why = body && (body.error || body.message) ? ` (${clip(body.error || body.message)})` : "";
  return row(
    id,
    "FAIL",
    `CSM queue read answered ${out.status || "no status"}${why}.`,
    `${TRIPWIRE} Restore GET ${QUEUE_PATH}.`
  );
}

async function checkOverdue({ db, orgId, now }) {
  const id = "csm:overdue-unassigned";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — overdue client success tasks not read");
  }
  try {
    const result = await db.query(OVERDUE_UNASSIGNED_SQL, [orgId, new Date(now.getTime() - OVERDUE_GRACE_MS).toISOString()]);
    const n = countOf(result);
    if (n == null) {
      return row(id, "FAIL", "overdue client success task count was not a number", `${TRIPWIRE} Read tasks for the client success role.`);
    }
    if (n === 0) {
      return row(id, "PASS", "no client success task is more than a day overdue with nobody assigned");
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "client success task")} more than a day overdue and nobody is assigned.`,
      `${TRIPWIRE} Open the client success queue and assign the overdue call.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read overdue client success tasks: ${clip(err)}`,
      `${TRIPWIRE} Read tasks for the client success role.`
    );
  }
}

async function checkMissingStep({ db, orgId, now }) {
  const id = "csm:missing-step";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — client success steps not read");
  }
  const eventNames = [];
  const workflows = [];
  for (const step of STEPS) {
    for (const name of step.events) {
      eventNames.push(name);
      workflows.push(step.workflow);
    }
  }
  try {
    const result = await db.query(MISSING_STEP_SQL, [
      orgId,
      eventNames,
      workflows,
      new Date(now.getTime() - STEP_LOOKBACK_MS).toISOString(),
      new Date(now.getTime() - STEP_GRACE_MS).toISOString()
    ]);
    const byWorkflow = new Map();
    for (const r of Array.isArray(result?.rows) ? result.rows : []) {
      const n = Number(r && r.n);
      if (r && r.workflow && Number.isFinite(n) && n > 0) byWorkflow.set(String(r.workflow), n);
    }
    const parts = [];
    for (const step of STEPS) {
      const n = byWorkflow.get(step.workflow);
      if (!n) continue;
      const who = n === 1 ? "1 client has" : `${n} clients have`;
      parts.push(`${who} no ${step.label}`);
    }
    if (parts.length === 0) {
      return row(id, "PASS", "every client who paid or was funded in the last 60 days has their accountability call");
    }
    return row(
      id,
      "FAIL",
      `client success step does not exist: ${parts.join("; ")}.`,
      `${TRIPWIRE} Open the accountability call for the client who paid or was funded and has none.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read the client success steps: ${clip(err)}`,
      `${TRIPWIRE} Read tasks for the accountability call steps.`
    );
  }
}

/**
 * Three read-only checks. ctx: { db, orgId, now, queueHandler? }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const c = ctx || {};
  const db = c.db && typeof c.db.query === "function" ? c.db : null;
  const orgId = c.orgId || null;
  const now = c.now instanceof Date ? c.now : new Date();
  const handler = typeof c.queueHandler === "function" ? c.queueHandler : readCsmQueue;
  return [
    await checkQueueApi({ db, orgId, handler }),
    await checkOverdue({ db, orgId, now }),
    await checkMissingStep({ db, orgId, now })
  ];
}
