// Daily pass over people on the roadmap drip.
// One email. Then the same lane repeats three days later.
// Paid people are taken off. Copy is the seeded templates. This file only picks.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { hasPaidDiagnostic } from "./slo-genuine-followup.mjs";
import { discountCheckoutUrl, DISCOUNT_REF_KEY } from "../slo/discount-197.mjs";
import {
  DRIP_NEXT,
  DRIP_ON,
  DRIP_STEP,
  dripGapDays,
  dripTemplate,
  nextDripAt,
  sloLane
} from "../slo/drip-plan.mjs";

export const SWEEP_CRON = "0 15 * * *";
export const SOURCE_WORKFLOW = "slo-infinite-drip";

const CHRIS = { sender_name: "Chris", sender: { name: "Chris" } };

/* The send key for one person at one step. sendTemplated makes the message's
   provider_ref from it (workflow:<template>:<key>), and that ref is unique per
   company. With eventId null the ref was workflow:<template>:null, the same for
   everyone, so the second person to reach a step was folded into the first
   person's row and got nothing (measured 2026-10-09: FH-000532 on step 3 with 0
   drip emails; FH-000531 holds all four rows). Person + step makes it one row
   per person per step: a rerun of the same step finds that person's own row
   and sends nothing twice. The step counts up forever, so a wrapped lane
   (step 7 is template 1 again) is still a new key. */
export function dripSendKey(clientId, step) {
  return `${SOURCE_WORKFLOW}:${clientId}:${step}`;
}

export async function laneForClient(db, clientId, fields = {}) {
  const paid = await hasPaidDiagnostic(db, { clientId });
  if (paid) return null;
  const r = await db.query(
    `SELECT DISTINCT name FROM events WHERE client_id = $1
       AND name = ANY($2)`,
    [clientId, ["slo.contact_started", "slo.checkout_started", "message.inbound"]]
  );
  const names = new Set(r.rows.map((row) => row.name));
  return sloLane({
    paid: false,
    checkout: names.has("slo.checkout_started"),
    replied: Boolean(fields.slo_replied_at) || names.has("message.inbound"),
    contact: names.has("slo.contact_started")
  });
}

export async function sendDueDrip(db, row) {
  const fields = row.custom_fields || {};
  const lane = await laneForClient(db, row.id, fields);
  if (!lane) {
    await mergeCustomFields(db, row.id, { [DRIP_ON]: "0" });
    return { id: row.id, sent: false, reason: "paid" };
  }
  const step = Number(fields[DRIP_STEP] || 0);
  const templateKey = dripTemplate(lane, step);
  const ref = fields[DISCOUNT_REF_KEY] || "";
  const context = {
    ...CHRIS,
    pay_url: ref ? discountCheckoutUrl(ref) : "https://apply.fundhub.ai/roadmap/#fhw"
  };
  const email = await sendTemplated(db, {
    orgId: row.org_id,
    clientId: row.id,
    channel: "email",
    templateKey,
    eventId: dripSendKey(row.id, step),
    context
  });
  /* Move the step only when the email row is there for this person. A send
     that did not queue (template not ready, draft copy) leaves the step where
     it is, so the next run tries the same email again. */
  if (!email || email.sent !== true) {
    const reason = (email && email.reason) || "not_queued";
    console.warn(`[slo-infinite-drip] ${templateKey} not queued for client ${row.id}: ${reason}. Step stays ${step}.`);
    return { id: row.id, sent: false, lane, templateKey, reason, email };
  }
  await mergeCustomFields(db, row.id, {
    [DRIP_STEP]: String(step + 1),
    [DRIP_NEXT]: nextDripAt(new Date(), dripGapDays(lane, step))
  });
  return { id: row.id, sent: true, lane, templateKey, email };
}

export async function sweepSloDrip(db, now = new Date()) {
  const r = await db.query(
    `SELECT id, org_id, custom_fields
       FROM clients
      WHERE custom_fields->>$1 = '1'
        AND (custom_fields->>$2 IS NULL OR custom_fields->>$2 <= $3)
      LIMIT 50`,
    [DRIP_ON, DRIP_NEXT, now.toISOString()]
  );
  const results = [];
  for (const row of r.rows) {
    results.push(await sendDueDrip(db, row));
  }
  return { ok: true, scanned: r.rows.length, results };
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron with no
   event: it sweeps whatever database it is handed. */
export async function handle({ db: handleDb = db, step } = {}) {
  const run = () => sweepSloDrip(handleDb);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const sloInfiniteDrip = inngest.createFunction(
  { id: "slo-infinite-drip", name: "SLO — infinite roadmap drip" },
  { cron: SWEEP_CRON },
  () => sweepSloDrip(db)
);
