// "Ready to get funded" — FinanceOS's door into the Capital Blueprint's closing
// prep, and the upsell / side-sell between the two products.
//
// FinanceOS wave 5, unit W5. Owner (2026-10-06): "Blueprint and FinanceOS work
// together: Blueprint can be an upsell from FinanceOS; FinanceOS a side sell to
// the Blueprint. Journey: get prepped through FinanceOS → when ready to get
// funded, press a button in your portal → CSM reaches out (same process as
// Blueprint)."
//
// SAME PROCESS, NOT A COPY. The press calls createBlueprintCsmPrepCallTask
// (src/blueprint/closer-ready.mjs) — the exact task the hourly Blueprint gate
// (src/workflows/blueprint-closer-ready-sweeper.mjs) opens when a Blueprint file
// is ready: same title ("Blueprint closing prep call"), same source_workflow
// ('blueprint-csm-prep'), same owner (the CSM on the client's file when there is
// one, else the CSM role queue), same dedupe key. So the CSM queue shows it the
// way it shows every Blueprint prep call, and for a Blueprint buyer the sweeper
// reads the same row: once the CSM marks the call done and UnderwriteIQ says the
// file is fundable with the checklist closed, it alerts the closer as it always
// has. A FinanceOS-only client stops at the CSM — the closer alert's own words
// say "Blueprint client", so it is not raised for someone who is not one.
//
// ONE OPEN REQUEST. createTask dedupes on (client, source, body). Round 1 is the
// Blueprint's own key, 'blueprint-csm-prep-call'. After a CSM marks that call
// done, a new press opens round 2 ('blueprint-csm-prep-call:r2'), and so on. A
// press while a round is open writes nothing and answers with that round.
//
// STATUS, from the newest round's task:
//   none          no prep call on file
//   requested     open, on the CSM queue, nobody holds it yet
//   csm_assigned  open, and a CSM holds it: the task's own assignee, or the
//                 CSM assigned to the client's file (clients.assigned_csm_staff_id)
//   done          the CSM marked the prep call done (tasks.done)
//
// The press is also one money_agent_log row (action 'ready_to_fund',
// migration 464), keyed 'ready-to-fund:<client>:r<round>', so a double press
// writes one row. Nothing here texts anyone and nothing moves money.

import {
  createBlueprintCsmPrepCallTask, CSM_PREP_SOURCE, PREP_CALL_DEDUPE
} from "../blueprint/closer-ready.mjs";
import { isCapitalBlueprintBuyer } from "../blueprint/coach-exception.mjs";
import { financeOsEntitlement } from "./finance-os-entitlement.mjs";
import { logMoneyAction } from "./clarity-payments.mjs";
import { BOOK_CALL_URL } from "../deliverables/chrome.mjs";

export const READY_STATUSES = Object.freeze(["none", "requested", "csm_assigned", "done"]);
export const READY_KEY_PREFIX = "ready-to-fund";
/** Where a client without FinanceOS sets it up: the Setup tab of the one page. */
export const FINANCEOS_SETUP_URL = "/app/financeos.html#setup";
export const BLUEPRINT_NAME = "Capital Blueprint";

const ROUND_RE = /^blueprint-csm-prep-call:r(\d{1,4})$/;

/** The createTask body (= dedupe key) for a round. Round 1 is the Blueprint's own key. */
export function roundBody(round) {
  return Number.isInteger(round) && round > 1 ? `${PREP_CALL_DEDUPE}:r${round}` : PREP_CALL_DEDUPE;
}

/** Which round a prep-call task body is, or null when it is not one. */
export function roundOfBody(body) {
  if (body === PREP_CALL_DEDUPE) return 1;
  const m = ROUND_RE.exec(String(body ?? ""));
  return m ? Number(m[1]) : null;
}

const iso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * readyStatus(rows, { assignedCsm }) — pure. `rows` are prep-call tasks
 * ({ id, body, done, assignee_staff_id, created_at, updated_at }).
 */
export function readyStatus(rows = [], { assignedCsm = null } = {}) {
  const calls = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.id && roundOfBody(r.body) !== null)
    .map((r) => ({ ...r, round: roundOfBody(r.body) }))
    .sort((a, b) => b.round - a.round);
  const latest = calls[0];
  if (!latest) {
    return { status: "none", round: 0, task_id: null, requested_at: null, done_at: null };
  }
  const held = !!(latest.assignee_staff_id || assignedCsm);
  return {
    status: latest.done ? "done" : held ? "csm_assigned" : "requested",
    round: latest.round,
    task_id: String(latest.id),
    requested_at: iso(latest.created_at),
    // tasks has no done_at; updated_at is when the row last changed — the
    // moment it was marked done, for a row nobody touches after that.
    done_at: latest.done ? iso(latest.updated_at) : null
  };
}

/**
 * The client row and every prep-call task on it. null when the client is not
 * in this org (the caller answers 404).
 */
export async function readPrepCalls(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT c.assigned_csm_staff_id,
            t.id, t.body, t.done, t.assignee_staff_id, t.created_at, t.updated_at
       FROM clients c
       LEFT JOIN tasks t
              ON t.client_id = c.id
             AND t.org_id = c.org_id
             AND t.source_workflow = $3
             AND (t.body = $4 OR t.body LIKE $5)
      WHERE c.id = $1 AND c.org_id = $2`,
    [clientId, orgId, CSM_PREP_SOURCE, PREP_CALL_DEDUPE, `${PREP_CALL_DEDUPE}:r%`]
  );
  if (!r.rows.length) return null;
  return {
    assignedCsm: r.rows[0].assigned_csm_staff_id || null,
    rows: r.rows.filter((x) => x.id)
  };
}

/** Status for one client, or null when the client is not in this org. */
export async function readyToFundStatus(db, { orgId, clientId }) {
  const found = await readPrepCalls(db, { orgId, clientId });
  if (!found) return null;
  return { ...readyStatus(found.rows, { assignedCsm: found.assignedCsm }), process: CSM_PREP_SOURCE };
}

/**
 * requestReadyToFund — the press. Opens the Blueprint's CSM closing prep call
 * (createBlueprintCsmPrepCallTask) unless a round is already open, and writes
 * the money_agent_log row once per round.
 *
 * @returns {Promise<null | { created: boolean, status, round, task_id, requested_at, done_at, process }>}
 *          null when the client is not in this org.
 */
export async function requestReadyToFund(db, {
  orgId, clientId, actor = "client", todayIso,
  createPrepCall = createBlueprintCsmPrepCallTask, log = logMoneyAction
} = {}) {
  const before = await readyToFundStatus(db, { orgId, clientId });
  if (!before) return null;
  if (before.status === "requested" || before.status === "csm_assigned") {
    return { created: false, ...before };
  }
  const round = before.status === "done" ? before.round + 1 : 1;
  const task = await createPrepCall(db, { orgId, clientId, eventId: roundBody(round) });

  const entry = await log(db, {
    orgId,
    clientId,
    itemKind: "client",
    itemId: clientId,
    itemLabel: "Ready to get funded",
    decidedOn: todayIso,
    action: "ready_to_fund",
    actor: actor === "staff" ? "staff" : "client",
    reason: round > 1 ? `asked again — round ${round}` : "ready to get funded",
    idempotencyKey: `${READY_KEY_PREFIX}:${clientId}:r${round}`,
    detail: { round, process: CSM_PREP_SOURCE, via: "financeos" }
  });
  if (entry?.created && entry.id && task?.id) {
    await db.query(`UPDATE money_agent_log SET task_id = $2 WHERE id = $1`, [entry.id, task.id]);
  }

  const after = await readyToFundStatus(db, { orgId, clientId });
  return { created: !!task?.created, ...(after || before) };
}

/**
 * productOffers — which of the two doors this client already owns.
 *
 *   blueprint.owned     a paid Capital Blueprint (consulting-package), read by
 *                       isCapitalBlueprintBuyer — the same test the Blueprint's
 *                       coach, CSM and closer paths use.
 *   blueprint.sell      how the Blueprint is sold today when not owned: on a
 *                       call ("Pricing is set on your call", the portal tile),
 *                       booked on the owner-set page BOOK_CALL_URL
 *                       (src/deliverables/chrome.mjs). No new product, no price.
 *   financeos.entitled  an active 'finance-os' subscription (financeOsEntitlement).
 *                       A Blueprint purchase starts one for 12 months.
 */
export async function productOffers(db, {
  orgId, clientId, asOf = new Date(),
  isBlueprint = isCapitalBlueprintBuyer, entitlement = financeOsEntitlement
} = {}) {
  const [owned, fos] = await Promise.all([
    isBlueprint(db, { orgId, clientId }),
    entitlement(db, { orgId, clientId, asOf })
  ]);
  const hasBlueprint = owned === true;
  const hasFinanceOs = !!(fos && fos.entitled);
  return {
    blueprint: {
      owned: hasBlueprint,
      name: BLUEPRINT_NAME,
      sell: hasBlueprint ? null : { how: "call", url: BOOK_CALL_URL }
    },
    financeos: {
      entitled: hasFinanceOs,
      setup_url: hasFinanceOs ? null : FINANCEOS_SETUP_URL
    }
  };
}

export default { readyStatus, readyToFundStatus, requestReadyToFund, productOffers, roundBody, roundOfBody };
