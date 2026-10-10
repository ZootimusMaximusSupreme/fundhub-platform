#!/usr/bin/env node
// One-off: seed the Payments page sample for the Finance OS test client.
//
// WHAT IT WRITES (owner-set 2026-10-06: sample data is fine):
//   * a $1,500 Clarity Payment owed to Fundhub LLC, 3 payments of $500 —
//     payment 1 paid, payment 2 four days late, payment 3 coming up;
//   * a $600 buy now, pay later plan owed to Fundhub LLC, 4 payments of $150 —
//     payment 1 paid, the rest coming up;
//   * the staff steps (plan added, payment recorded) in money_agent_log;
//   * the money helper's past steps for the late payment (reminder, check-in,
//     second check-in), marked message_status = 'sample_not_sent'. NO TEXT IS
//     SENT OR QUEUED BY THIS SCRIPT. Writing those steps also means the helper
//     sees rungs 0-2 as done, so its next step on that payment is the day-7 CSM
//     task — not a text.
//
// Dates are relative to --today (default: today, UTC), so "four days late" is
// true on the day it runs.
//
// SAFE TO RE-RUN: each plan carries an external_ref; a plan already there is
// skipped, and every log row has an idempotency key.
//
// Needs migrations 443 + 444 live first (ship), then:
//   DATABASE_URL=... node scripts/seed-clarity-sample.mjs            # dry run, writes nothing
//   DATABASE_URL=... node scripts/seed-clarity-sample.mjs --apply    # writes
//
// Never deletes anything.

import { db, close } from "../src/db.mjs";
import { addClarityPayment, recordClarityPayment, logMoneyAction } from "../src/finance/clarity-payments.mjs";
import { keyFor } from "../src/finance/money-agent.mjs";
import { financeOsEntitlement } from "../src/finance/finance-os-entitlement.mjs";

const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const todayArg = argv.includes("--today") ? argv[argv.indexOf("--today") + 1] : null;
const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(todayArg || "") ? todayArg : new Date().toISOString().slice(0, 10);

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const at = (iso) => new Date(`${iso}T17:00:00Z`);

const PLANS = [
  {
    ref: "sample:p4-clarity-1500",
    input: {
      kind: "clarity", owed_to: "Fundhub LLC", label: null,
      installments: [
        { due_on: addDays(TODAY, -34), amount_cents: 50000 },
        { due_on: addDays(TODAY, -4), amount_cents: 50000 },
        { due_on: addDays(TODAY, 27), amount_cents: 50000 }
      ]
    },
    paid: [{ on: addDays(TODAY, -34), cents: 50000 }],
    // the helper's past steps on payment 2 (due TODAY-4)
    history: [{ seq: 2, rung: 0, action: "reminder", on: addDays(TODAY, -7) },
      { seq: 2, rung: 1, action: "late_check_in", on: addDays(TODAY, -3) },
      { seq: 2, rung: 2, action: "second_check_in", on: addDays(TODAY, -1) }],
    what: "Fundhub payment plan"
  },
  {
    ref: "sample:p4-bnpl-600",
    input: {
      kind: "bnpl", owed_to: "Fundhub LLC", label: null,
      installments: [
        { due_on: addDays(TODAY, -21), amount_cents: 15000 },
        { due_on: addDays(TODAY, 9), amount_cents: 15000 },
        { due_on: addDays(TODAY, 39), amount_cents: 15000 },
        { due_on: addDays(TODAY, 69), amount_cents: 15000 }
      ]
    },
    paid: [{ on: addDays(TODAY, -21), cents: 15000 }],
    history: [{ seq: 1, rung: 0, action: "reminder", on: addDays(TODAY, -24) }],
    what: "buy now, pay later plan with Fundhub LLC"
  }
];

async function main() {
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — client ${CLIENT}, org ${ORG}, today ${TODAY}`);
  const c = await db.query(`SELECT id FROM clients WHERE id = $1 AND org_id = $2`, [CLIENT, ORG]);
  if (!c.rows.length) throw new Error("test client not found in that org");

  const ent = await financeOsEntitlement(db, { orgId: ORG, clientId: CLIENT });
  console.log(`finance-os entitlement: ${ent.entitled ? "active" : `none (${ent.reason}) — the daily helper skips this client`}`);

  for (const plan of PLANS) {
    const have = await db.query(`SELECT id FROM clarity_payments WHERE org_id = $1 AND external_ref = $2`, [ORG, plan.ref]);
    if (have.rows.length) { console.log(`skip ${plan.ref} — already there (${have.rows[0].id})`); continue; }
    const total = plan.input.installments.reduce((s, i) => s + i.amount_cents, 0);
    console.log(`plan ${plan.ref}: ${plan.input.kind}, ${total} cents, ${plan.input.installments.map((i) => i.due_on).join(" / ")}`);
    if (!APPLY) continue;

    const added = await addClarityPayment(db, { orgId: ORG, clientId: CLIENT, input: plan.input, externalRef: plan.ref });
    const planId = added.id;
    await logMoneyAction(db, {
      orgId: ORG, clientId: CLIENT, itemKind: "clarity_payment", itemId: planId, itemLabel: plan.input.kind,
      decidedOn: addDays(TODAY, -35), action: "plan_added", actor: "staff", amountCents: total,
      reason: "sample plan (scripts/seed-clarity-sample.mjs)", idempotencyKey: `${plan.ref}:added`
    });

    for (const p of plan.paid) {
      const r = await recordClarityPayment(db, { orgId: ORG, clientId: CLIENT, planId, amountCents: p.cents, paidAt: at(p.on) });
      if (!r.ok) throw new Error(`record payment failed: ${r.error}`);
      await logMoneyAction(db, {
        orgId: ORG, clientId: CLIENT, itemKind: "clarity_payment", itemId: planId, itemLabel: plan.input.kind,
        decidedOn: p.on, action: "payment_recorded", actor: "staff", amountCents: p.cents,
        reason: "sample payment", idempotencyKey: `${plan.ref}:paid:${p.on}`
      });
    }

    const inst = await db.query(
      `SELECT id, seq, due_on::text AS due_on FROM clarity_payment_installments WHERE clarity_payment_id = $1 ORDER BY seq`, [planId]);
    for (const h of plan.history) {
      const row = inst.rows.find((x) => x.seq === h.seq);
      const key = keyFor(`clarity_installment:${row.id}`, h.rung);
      const r = await logMoneyAction(db, {
        orgId: ORG, clientId: CLIENT, itemKind: "clarity_installment", itemId: row.id,
        itemLabel: `${plan.what} — payment ${h.seq}`, decidedOn: h.on, action: h.action, actor: "agent", brain: "rules",
        reason: `${h.action}: sample history`, textsClient: false, amountCents: plan.input.installments[h.seq - 1].amount_cents,
        idempotencyKey: key, detail: { sample: true, due_on: row.due_on, rung: h.rung }
      });
      if (r.created) await db.query(`UPDATE money_agent_log SET message_status = 'sample_not_sent' WHERE id = $1`, [r.id]);
    }
    console.log(`  wrote ${planId}`);
  }
  if (!APPLY) console.log("dry run: nothing written. Add --apply to write.");
}

main().then(() => close(), async (e) => { console.error(e?.message || e); await close(); process.exit(1); });
