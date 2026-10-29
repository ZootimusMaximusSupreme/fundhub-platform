// repair-enrollment — the paid-for repair program actually starts itself.
//
// THE DEFECT THIS EXISTS FOR, measured on production 2026-09-06.
//
//   Walk3 Trial ($200, repair-trial):  repair.enrolled -> repair.docs.needed ->
//                                      message.queued -> welcome email delivered
//   Walk2 Full  ($1,000, repair-bundle): payment.received. Then nothing.
//
// The obvious reading is that the trial product auto-enrols and the full one
// does not. IT IS NOT WHAT HAPPENED. Walk3's repair.enrolled row is stamped
// 11:11:44 and its payment.received 12:50:11 — the enrolment came an hour and a
// half BEFORE the money. Somebody pressed the Enrol button by hand. Nothing in
// this codebase has ever enrolled anybody on a payment: not for the trial, not
// for the bundle. Walk2 is not a product-specific bug, it is every repair buyer
// who nobody happened to click, and the click is only available on a screen
// that lists clients who are already enrolled.
//
// So this module is the missing automatic enrolment, hung off the payment the
// way funding hangs off round.started. src/handlers/purchase-routing.mjs is
// already registered on deposit.paid / sale.closed / payment.received and
// already works out that the client bought repair, so it calls this last.
//
// HOW MANY ROUNDS. From the product, never from the button. The CRM's Enrol
// control hardcodes program "trial" at $200, which caps rounds_cap at 2 — press
// it for a client who bought the six-round bundle and rounds 3 to 6 are refused
// later, long after anyone remembers why. Here the trial is the named
// exception and everything else in the repair category is the full six-round
// program, so a repair product added tomorrow gets the full course rather than
// silently capping a paying client at two rounds.
//
// NEVER OVERWRITE A LIVE PROGRAM. enrollRepairProgram() upserts on
// (org_id, client_id) and would happily rewrite program, rounds_cap and the
// money on a client sitting mid-round-four. So this only ever enrols a client
// who has NO repair_programs row. An upgrade from the trial to the full bundle
// is therefore still a human decision — see the report; it is not something a
// late installment payment gets to do behind everyone's back.
//
// SAFE TO FIRE TWICE, like everything else on this path. Three payment events
// can route the same purchase and a webhook can be redelivered. The enrolment
// is skipped once a program row exists, and the tasks dedupe on their titles.

import { enrollRepairProgram } from "../repair/enroll.mjs";
import { createTask } from "../lib/create-task.mjs";
import { STAGE_SLA } from "../repair/sla.mjs";
import { addBusinessDays } from "../repair/croa.mjs";

/** products.category that owns the repair rail — same value purchase-routing uses. */
export const REPAIR_CATEGORY = "repair";

/** The one product that is deliberately a short course. Migration 181 created
 *  'repair-trial' ("Repair Test Run") as a two-round taster of the same letter
 *  pack. Everything else filed under the repair category is the full program. */
export const TRIAL_PRODUCT_CODE = "repair-trial";

export const SOURCE_WORKFLOW = "repair-enrollment";

/** Who does repair work. inquiry_specialist is the credit-file role — the same
 *  people C-02 and C-03 hand inquiry work to — and there are four of them on
 *  production. A task with no owner reaches nobody (src/lib/create-task.mjs). */
export const REPAIR_TASK_ROLE = "inquiry_specialist";

/** One greppable line per skip, in the style of purchase-routing's NO_ROUTE. */
export const NOT_ENROLLED = "[repair-enrollment] not enrolled";

function skip(reason, { orgId, clientId, detail = "" } = {}) {
  console.warn(
    `${NOT_ENROLLED}: ${reason} (org=${orgId || "?"} client=${clientId || "?"}` +
    `${detail ? ` ${detail}` : ""}). The repair board card stands; no program was opened.`
  );
  return { enrolled: false, reason };
}

function toNumber(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * repairPurchase — what this client actually bought on the repair rail.
 *
 * Reads the sales table, never the event payload: the payload of a renewal or a
 * second installment says nothing about which program they are on, and
 * purchase-routing already re-derives everything from sales for the same
 * reason.
 *
 * Returns null when no repair sale has POSITIVE NET front-end money.
 * A signed but unpaid full bundle must never override a paid $200 trial;
 * refunds and success fees do not count toward a purchased program. This
 * exactly matches purchase-routing's same-sale paid category gate.
 */
export async function repairPurchase(db, { orgId, clientId } = {}) {
  if (!db?.query || !orgId || !clientId) return null;
  const { rows } = await db.query(
    `SELECT s.id AS sale_id, pr.code AS product_code, s.agreed_price,
            paid.net_paid AS paid_so_far
       FROM sales s
       JOIN products pr ON pr.id = s.product_id AND pr.org_id = s.org_id
       CROSS JOIN LATERAL (
         SELECT COALESCE(SUM(CASE
                  WHEN sp.kind IN ('deposit', 'installment') THEN sp.amount
                  WHEN sp.kind = 'refund' THEN -sp.amount
                  ELSE 0
                END), 0) AS net_paid
           FROM sale_payments sp
          WHERE sp.org_id = s.org_id AND sp.sale_id = s.id
       ) paid
      WHERE s.org_id = $1 AND s.client_id = $2 AND s.status = 'active'
        AND pr.category = $3 AND paid.net_paid > 0
      ORDER BY s.sold_at DESC`,
    [orgId, clientId, REPAIR_CATEGORY]
  );
  if (!rows.length) return null;

  /* A client who bought the trial and then the bundle is on the bundle. Pick
     the first sale that is not the trial; fall back to the newest. */
  const chosen = rows.find((r) => String(r.product_code) !== TRIAL_PRODUCT_CODE) || rows[0];
  const isTrial = String(chosen.product_code) === TRIAL_PRODUCT_CODE;

  /* THE PRICE MUST BE A REAL NUMBER OR NONE AT ALL. agreed_price is what they
     signed for; when it is NULL the money that has actually landed on the sale
     is the next honest answer. If neither can be read we do not enrol with a
     zero — a $1,000 program recorded as $0 is a worse lie than an unopened one,
     and the skip is logged where somebody can act on it. */
  const priceTotal = toNumber(chosen.agreed_price) ?? toNumber(chosen.paid_so_far);

  return {
    saleId: chosen.sale_id,
    productCode: String(chosen.product_code),
    program: isTrial ? "trial" : "full",
    roundsCap: isTrial ? 2 : 6,
    priceTotal,
    amountPaid: toNumber(chosen.paid_so_far) ?? 0
  };
}

/** Does this client already have a repair program open? */
export async function existingProgram(db, { orgId, clientId } = {}) {
  const { rows } = await db.query(
    `SELECT id, program, rounds_cap, status FROM repair_programs
      WHERE org_id = $1 AND client_id = $2 LIMIT 1`,
    [orgId, clientId]
  );
  return rows[0] || null;
}

/**
 * firstRepairTasks — the two jobs that exist the moment a repair file opens.
 *
 * MODELLED ON WHAT THE FUNDING PATH ALREADY DOES, because a repair client
 * currently gets none at all while a funding client gets five. Funding's first
 * two are the same two shapes: somebody owns the file (F-01's "Assign pod roles
 * for funding client") and somebody clears the gate the next stage needs (C-05's
 * "Pre-funding review"). Repair's equivalents are: confirm the plan with the
 * client, and collect the two identity documents that awaiting_documents is
 * waiting for.
 *
 * THE DUE DATES ARE NOT INVENTED. Both come from STAGE_SLA in
 * src/repair/sla.mjs, which is the written spec for how long a card may sit on
 * each stage: intake is three business days, awaiting_documents is fourteen.
 * A task due after its own stage has already breached would be pointless, so
 * they are the same numbers.
 */
export function firstRepairTasks({ roundsCap, now = new Date() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const intakeDue = new Date(`${addBusinessDays(day, STAGE_SLA.intake.days)}T12:00:00Z`);
  const docsDue = new Date(new Date(now).getTime() + STAGE_SLA.awaiting_documents.days * 86_400_000);

  const rounds = Number.isFinite(Number(roundsCap)) ? Number(roundsCap) : null;
  return [
    {
      title: "Start the repair program — confirm the plan with the client",
      body: rounds
        ? `${rounds} rounds are paid for. Talk the client through the plan before the first round goes out.`
        : "Talk the client through the plan before the first round goes out.",
      dueAt: intakeDue
    },
    {
      title: "Collect photo identification and proof of address",
      body: "No dispute letter can be written until both documents are on file.",
      dueAt: docsDue
    }
  ];
}

/**
 * createRepairStartTasks — put the two jobs on somebody's list.
 *
 * Deduped on TITLE, not on the event id. A repair file opens once, so the
 * question these answer is asked once; keying on the event would give the same
 * client a second copy of both every time a payment event replayed.
 */
export async function createRepairStartTasks(db, {
  orgId, clientId, roundsCap = null, now = new Date()
} = {}) {
  const created = [];
  for (const t of firstRepairTasks({ roundsCap, now })) {
    // Title dedupe alone is read-then-insert. Two concurrent paid events can
    // read "no task" simultaneously while a trial/full plan changes; the
    // human-readable task body then differs (2 vs 6 rounds), so the database's
    // UNIQUE (client, workflow, body) index does NOT stop duplicate plan tasks.
    // Use one stable body key per job for durable race/replay dedupe, while
    // keeping the readable instructions in the separate detail column.
    const stableTaskKey = `repair-start:${orgId}:${clientId}:${t.title}`;
    const r = await createTask(db, {
      orgId,
      clientId,
      title: t.title,
      body: stableTaskKey,
      detail: t.body,
      dueAt: t.dueAt,
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: REPAIR_TASK_ROLE,
      dedupeOn: "title"
    });
    if (r.created) created.push(t.title);
  }
  return { created, count: created.length };
}

/**
 * ensureRepairEnrollment — a repair purchase is paid for, so start it.
 *
 * Called by src/handlers/purchase-routing.mjs after the boards are settled.
 * Errors are allowed to escape: the bus dead-letters each handler separately,
 * so a failure here lands on /api/read/failed-events where somebody sees it,
 * and cannot damage the money row or the card that were written before it.
 */
export async function ensureRepairEnrollment(db, {
  orgId, clientId, eventId = null, staffId = null, now = new Date()
} = {}) {
  if (!db?.query || !orgId || !clientId) return { enrolled: false, reason: "missing_ids" };

  const purchase = await repairPurchase(db, { orgId, clientId });
  if (!purchase) return skip("no_active_repair_sale", { orgId, clientId });

  const already = await existingProgram(db, { orgId, clientId });
  if (already) {
    /* Leave the program exactly as it is — see the header. The tasks are still
       asserted, because a client enrolled by hand before this existed has none
       and the whole point is that somebody is told to do something. */
    const tasks = await createRepairStartTasks(db, {
      orgId, clientId, eventId, roundsCap: already.rounds_cap, now
    });
    return {
      enrolled: false,
      reason: "already_enrolled",
      program: already.program,
      roundsCap: already.rounds_cap,
      tasks
    };
  }

  if (purchase.priceTotal == null) {
    return skip("price_unknown", {
      orgId, clientId, detail: `product=${purchase.productCode} sale=${purchase.saleId}`
    });
  }

  const enrolment = await enrollRepairProgram(db, {
    orgId,
    clientId,
    program: purchase.program,
    priceTotal: purchase.priceTotal,
    amountPaid: purchase.amountPaid,
    staffId
  });

  const tasks = await createRepairStartTasks(db, {
    orgId, clientId, eventId, roundsCap: purchase.roundsCap, now
  });

  return {
    enrolled: true,
    reason: null,
    productCode: purchase.productCode,
    program: purchase.program,
    roundsCap: purchase.roundsCap,
    priceTotal: purchase.priceTotal,
    tasks,
    checklist: enrolment?.checklist || null
  };
}

export default ensureRepairEnrollment;
