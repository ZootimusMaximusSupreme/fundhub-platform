// Clarity autopay — the matching rule, the write through the staff store path,
// idempotency on the Commas payment id, and the money helper stopping once an
// installment is paid. In-memory tables; no network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  matchClarityPayment, notForAPlan, applyCommasPayment, keyForPayment
} from "./clarity-autopay.mjs";
import { planView } from "./clarity-payments.mjs";
import { runForClient } from "./money-agent.mjs";
import { processCommasInboxRow } from "../adapters/commas.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { register as registerClarityAutopay } from "../handlers/clarity-autopay.mjs";

const ORG = "org-1";
const CLIENT = "f1cb0000-0000-4000-8000-000000000001";
const TODAY = "2026-10-06";
const NOW = () => new Date(`${TODAY}T15:00:00Z`);

/* ── plans as planView shapes them, for the pure matcher ───────────────── */
function plan(id, rows, extra = {}) {
  return planView({ id, kind: "clarity", owed_to: "Fundhub LLC", status: "open", original_cents: rows.reduce((s, r) => s + r[1], 0), ...extra },
    rows.map(([due_on, amount_cents, paid_cents = 0], i) => ({ id: `${id}-i${i + 1}`, seq: i + 1, due_on, amount_cents, paid_cents })), TODAY);
}
// The owner's sample: $1,500 in 3 × $500 (1 paid, 1 late), and $600 BNPL in 4 × $150 (1 paid).
const CLARITY = () => plan("p-clarity", [["2026-09-03", 50000, 50000], ["2026-10-03", 50000], ["2026-11-03", 50000]]);
const BNPL = () => plan("p-bnpl", [["2026-09-16", 15000, 15000], ["2026-10-16", 15000], ["2026-11-15", 15000], ["2026-12-15", 15000]], { kind: "bnpl" });

describe("matchClarityPayment — strongest key first, never a guess", () => {
  test("no open plan → skip (an ordinary payment, nothing written)", () => {
    assert.deepEqual(matchClarityPayment({ plans: [], amountCents: 50000 }), { outcome: "skip", reason: "no_open_plan" });
  });

  test("amount = the next unpaid installment → that plan", () => {
    const m = matchClarityPayment({ plans: [CLARITY(), BNPL()], amountCents: 15000 });
    assert.deepEqual(m, { outcome: "apply", planId: "p-bnpl", rule: "next_installment", amountCents: 15000 });
    assert.equal(matchClarityPayment({ plans: [CLARITY(), BNPL()], amountCents: 50000 }).planId, "p-clarity");
  });

  test("amount = the full remaining balance → that plan", () => {
    const m = matchClarityPayment({ plans: [CLARITY(), BNPL()], amountCents: 45000 });
    assert.deepEqual(m, { outcome: "apply", planId: "p-bnpl", rule: "full_balance", amountCents: 45000 });
  });

  test("an amount that fits nothing → unmatched, not a partial guess", () => {
    assert.deepEqual(matchClarityPayment({ plans: [CLARITY(), BNPL()], amountCents: 20000 }), { outcome: "unmatched", reason: "amount_does_not_match" });
  });

  test("more than everything owed → unmatched more_than_owed; never applies more than owed", () => {
    assert.deepEqual(matchClarityPayment({ plans: [CLARITY(), BNPL()], amountCents: 500000 }), { outcome: "unmatched", reason: "more_than_owed" });
  });

  test("two plans fit: the one whose next payment is due oldest wins; same day → unmatched", () => {
    const a = plan("p-a", [["2026-10-20", 15000], ["2026-11-20", 15000]]);
    const b = plan("p-b", [["2026-10-10", 15000], ["2026-11-10", 15000]]);
    assert.equal(matchClarityPayment({ plans: [a, b], amountCents: 15000 }).planId, "p-b");
    const c = plan("p-c", [["2026-10-20", 15000], ["2026-11-20", 15000]]);
    assert.deepEqual(matchClarityPayment({ plans: [a, c], amountCents: 15000 }), { outcome: "unmatched", reason: "two_plans_fit" });
  });

  test("plan reference: the payment's invoice ties it to the plan that mirrors it — any amount up to what is left", () => {
    const tied = plan("p-inv", [["2026-10-01", 30000], ["2026-11-01", 30000]], { invoice_id: "inv-9" });
    assert.deepEqual(matchClarityPayment({ plans: [CLARITY(), tied], amountCents: 12345, invoiceId: "inv-9" }),
      { outcome: "apply", planId: "p-inv", rule: "plan_reference", amountCents: 12345 });
    assert.deepEqual(matchClarityPayment({ plans: [tied], amountCents: 60001, invoiceId: "inv-9" }), { outcome: "unmatched", reason: "more_than_owed" });
  });

  test("an invoice no plan carries is the AR ladder's → skip, even if the amount fits a plan", () => {
    assert.deepEqual(matchClarityPayment({ plans: [CLARITY()], amountCents: 50000, invoiceId: "inv-other" }),
      { outcome: "skip", reason: "pays_an_invoice_no_plan_carries" });
  });

  test("no amount → unmatched; a settled plan is never a candidate", () => {
    assert.deepEqual(matchClarityPayment({ plans: [CLARITY()], amountCents: null }), { outcome: "unmatched", reason: "no_amount" });
    const done = { ...CLARITY(), status: "settled", left_cents: 0 };
    assert.equal(matchClarityPayment({ plans: [done], amountCents: 50000 }).outcome, "skip");
  });
});

describe("notForAPlan", () => {
  test("known products, product link purposes and the setup link are not plan payments", () => {
    assert.equal(notForAPlan({ product: "crs" }), "product:crs");
    assert.equal(notForAPlan({ product: "deposit" }), "product:deposit");
    assert.equal(notForAPlan({ purpose: "diagnostic" }), "link_purpose:diagnostic");
    assert.equal(notForAPlan({ purpose: "custom", setupLink: true }), "financeos_setup_link");
    assert.equal(notForAPlan({ product: "unmatched", purpose: "custom" }), null);
    assert.equal(notForAPlan({ product: "success_fee" }), null);
  });
});

/* ── in-memory tables, answering the REAL store SQL ──────────────────────
   listClarityPayments / recordClarityPayment / logMoneyAction from
   clarity-payments.mjs run unchanged against this, so the write is the same
   path the staff "Record payment" button takes. */
function clarityWorld({ plans = [], installments = [], log = [] } = {}) {
  const state = { plans: plans.map((p) => ({ ...p })), inst: installments.map((i) => ({ ...i })), log: log.map((r) => ({ ...r })) };
  const db = {
    state,
    async query(sql, params = []) {
      if (/FROM clarity_payments\s+WHERE org_id = \$1 AND client_id = \$2 AND status <> 'cancelled'/.test(sql)) {
        return { rows: state.plans.filter((p) => p.org_id === params[0] && p.client_id === params[1] && p.status !== "cancelled") };
      }
      if (/FROM clarity_payment_installments\s+WHERE org_id = \$1 AND clarity_payment_id = ANY/.test(sql)) {
        return { rows: state.inst.filter((i) => i.org_id === params[0] && params[1].includes(i.clarity_payment_id)).sort((a, b) => a.seq - b.seq) };
      }
      if (/FROM clarity_payments WHERE id = \$1 AND org_id = \$2 AND client_id = \$3/.test(sql)) {
        return { rows: state.plans.filter((p) => p.id === params[0] && p.org_id === params[1] && p.client_id === params[2]) };
      }
      if (/FROM clarity_payment_installments\s+WHERE org_id = \$1 AND clarity_payment_id = \$2 ORDER BY seq/.test(sql)) {
        return { rows: state.inst.filter((i) => i.org_id === params[0] && i.clarity_payment_id === params[1]).sort((a, b) => a.seq - b.seq) };
      }
      if (/UPDATE clarity_payment_installments i/.test(sql)) {
        const [ids, froms, tos, at, org, planId] = params;
        const out = [];
        ids.forEach((id, k) => {
          const row = state.inst.find((i) => i.id === id && i.org_id === org && i.clarity_payment_id === planId);
          if (!row || Number(row.paid_cents) !== Number(froms[k])) return;
          if (Number(tos[k]) > Number(row.amount_cents)) throw Object.assign(new Error("overpaid"), { code: "23514" });
          row.paid_cents = Number(tos[k]);
          if (row.paid_cents === Number(row.amount_cents)) row.paid_at = at;
          out.push({ id });
        });
        return { rows: out };
      }
      if (/UPDATE clarity_payments p SET status = 'settled'/.test(sql)) {
        const p = state.plans.find((x) => x.id === params[0] && x.org_id === params[1] && x.status === "open");
        if (!p || state.inst.some((i) => i.clarity_payment_id === p.id && Number(i.paid_cents) < Number(i.amount_cents))) return { rows: [] };
        p.status = "settled"; p.settled_at = params[2];
        return { rows: [{ id: p.id }] };
      }
      if (/INSERT INTO money_agent_log/.test(sql)) {
        const [orgId, clientId, itemKind, itemId, itemLabel, decidedOn, action, actor, brain, reason, texts, , amount, key, detail] = params;
        if (action === "payment_unmatched" || action === "payment_recorded") {
          // the 455 / 443 checks the real table enforces
          assert.ok(["agent", "staff", "client"].includes(actor));
          assert.equal(actor === "agent", brain !== null);
        }
        if (key && state.log.some((r) => r.org_id === orgId && r.idempotency_key === key)) return { rows: [] };
        if (texts && state.log.some((r) => r.client_id === clientId && r.decided_on === decidedOn && r.texts_client)) return { rows: [] };
        const id = `log-${state.log.length + 1}`;
        state.log.push({ id, org_id: orgId, client_id: clientId, item_kind: itemKind, item_id: itemId, item_label: itemLabel, decided_on: decidedOn,
          action, actor, brain, reason, texts_client: texts, amount_cents: amount, idempotency_key: key, detail: detail ? JSON.parse(detail) : null });
        return { rows: [{ id }] };
      }
      if (/UPDATE money_agent_log/.test(sql)) return { rows: [] };
      // the money helper's reads
      if (/EXISTS \(SELECT 1 FROM opt_outs/.test(sql)) return { rows: [{ opted_out: false, escalated: false, handed: false }] };
      if (/SELECT idempotency_key FROM money_agent_log/.test(sql)) return { rows: state.log.map((r) => ({ idempotency_key: r.idempotency_key })) };
      if (/FROM account_statement_cycles/.test(sql)) return { rows: [] };
      if (/FROM clarity_payment_installments i\s+JOIN clarity_payments p/.test(sql)) {
        /* DELIBERATELY UNFILTERED on paid state: every installment of every
           open plan comes back, so the test proves the helper's own brain
           refuses a paid one — not just the SQL's WHERE. */
        return {
          rows: state.inst.map((i) => {
            const p = state.plans.find((x) => x.id === i.clarity_payment_id);
            return { ...i, plan_id: p.id, kind: p.kind, owed_to: p.owed_to, label: p.label, invoice_id: p.invoice_id, status: p.status };
          }).filter((r) => r.status === "open")
        };
      }
      throw new Error(`unexpected SQL: ${sql.slice(0, 90)}`);
    }
  };
  return db;
}

/* A transaction double: snapshot, run, restore everything on a throw. */
async function fakeTx(conn, fn) {
  const snap = JSON.stringify(conn.state);
  try { return await fn(conn); } catch (e) {
    const back = JSON.parse(snap);
    conn.state.plans.splice(0, Infinity, ...back.plans);
    conn.state.inst.splice(0, Infinity, ...back.inst);
    conn.state.log.splice(0, Infinity, ...back.log);
    throw e;
  }
}

function sampleWorld() {
  const P1 = "a159a137-0000-4000-8000-00000000c1a1";
  const P2 = "349f9ed9-0000-4000-8000-00000000b2b2";
  const base = { org_id: ORG, client_id: CLIENT, owed_to: "Fundhub LLC", label: null, status: "open", settled_at: null, invoice_id: null, created_at: "2026-09-01" };
  const inst = (planId, seq, due_on, amount_cents, paid_cents = 0) => ({ id: `${planId.slice(0, 4)}-${seq}`, org_id: ORG, clarity_payment_id: planId, seq, due_on, amount_cents, paid_cents, paid_at: paid_cents ? "2026-09-03T17:00:00Z" : null });
  return {
    P1, P2,
    db: clarityWorld({
      plans: [{ ...base, id: P1, kind: "clarity", original_cents: 150000 }, { ...base, id: P2, kind: "bnpl", original_cents: 60000, created_at: "2026-09-02" }],
      installments: [
        inst(P1, 1, "2026-09-03", 50000, 50000), inst(P1, 2, "2026-10-03", 50000), inst(P1, 3, "2026-11-03", 50000),
        inst(P2, 1, "2026-09-16", 15000, 15000), inst(P2, 2, "2026-10-16", 15000), inst(P2, 3, "2026-11-15", 15000), inst(P2, 4, "2026-12-15", 15000)
      ]
    })
  };
}
const deps = { withTransaction: fakeTx, now: NOW };

describe("applyCommasPayment — the write", () => {
  test("$500 lands → the late Clarity installment is paid, logged 'Paid via Commas' by the agent", async () => {
    const { db, P1 } = sampleWorld();
    const r = await applyCommasPayment(db, { orgId: ORG, clientId: CLIENT, paymentId: "pay_A1", amountCents: 50000 }, deps);
    assert.deepEqual(r, { outcome: "applied", planId: P1, rule: "next_installment", settled: false });
    const i2 = db.state.inst.find((i) => i.clarity_payment_id === P1 && i.seq === 2);
    assert.equal(i2.paid_cents, 50000);
    assert.ok(i2.paid_at);
    assert.equal(db.state.log.length, 1);
    const row = db.state.log[0];
    assert.equal(row.action, "payment_recorded");
    assert.equal(row.actor, "agent");
    assert.equal(row.brain, "rules");
    assert.equal(row.idempotency_key, keyForPayment("pay_A1"));
    assert.equal(row.detail.via, "commas");
    assert.equal(row.detail.payment_id, "pay_A1");
    assert.match(row.reason, /Paid via Commas/);
  });

  test("the same Commas payment again applies NOTHING (idempotent on the payment id)", async () => {
    const { db, P1 } = sampleWorld();
    await applyCommasPayment(db, { orgId: ORG, clientId: CLIENT, paymentId: "pay_A1", amountCents: 50000 }, deps);
    const again = await applyCommasPayment(db, { orgId: ORG, clientId: CLIENT, paymentId: "pay_A1", amountCents: 50000 }, deps);
    assert.equal(again.outcome, "already_done");
    // installment 3 untouched
    assert.equal(db.state.inst.find((i) => i.clarity_payment_id === P1 && i.seq === 3).paid_cents, 0);
    assert.equal(db.state.log.length, 1);
  });

  test("paying the full remaining BNPL balance settles the plan", async () => {
    const { db, P2 } = sampleWorld();
    const r = await applyCommasPayment(db, { orgId: ORG, clientId: CLIENT, paymentId: "pay_B9", amountCents: 45000 }, deps);
    assert.equal(r.outcome, "applied");
    assert.equal(r.rule, "full_balance");
    assert.equal(r.settled, true);
    assert.equal(db.state.plans.find((p) => p.id === P2).status, "settled");
  });

  test("an amount that fits no plan: nothing applied, one 'payment_unmatched' row for staff", async () => {
    const { db } = sampleWorld();
    const r = await applyCommasPayment(db, { orgId: ORG, clientId: CLIENT, paymentId: "pay_X", amountCents: 20000, paymentLinkId: "link-1" }, deps);
    assert.deepEqual(r, { outcome: "unmatched", reason: "amount_does_not_match" });
    assert.equal(db.state.inst.reduce((s, i) => s + i.paid_cents, 0), 65000); // unchanged
    assert.equal(db.state.log.length, 1);
    assert.equal(db.state.log[0].action, "payment_unmatched");
    assert.equal(db.state.log[0].amount_cents, 20000);
    assert.equal(db.state.log[0].detail.reason, "amount_does_not_match");
    // and a repeat writes no second row
    assert.equal((await applyCommasPayment(db, { orgId: ORG, clientId: CLIENT, paymentId: "pay_X", amountCents: 20000 }, deps)).outcome, "already_done");
    assert.equal(db.state.log.length, 1);
  });

  test("a client with no open plan: skip, nothing written at all", async () => {
    const db = clarityWorld();
    const r = await applyCommasPayment(db, { orgId: ORG, clientId: CLIENT, paymentId: "pay_Q", amountCents: 3200 }, deps);
    assert.deepEqual(r, { outcome: "skip", reason: "no_open_plan" });
    assert.equal(db.state.log.length, 0);
  });

  test("no payment id or no client → skip before any read", async () => {
    const db = { query: async () => { throw new Error("should not read"); } };
    assert.equal((await applyCommasPayment(db, { orgId: ORG, clientId: CLIENT, amountCents: 50000 }, deps)).reason, "no_payment_id");
    assert.equal((await applyCommasPayment(db, { orgId: ORG, paymentId: "p", amountCents: 50000 }, deps)).reason, "no_client");
  });

  test("if the plan refuses the write (someone else just changed it), the claim rolls back too", async () => {
    const { db } = sampleWorld();
    const refuse = async () => ({ ok: false, error: "conflict" });
    await assert.rejects(
      applyCommasPayment(db, { orgId: ORG, clientId: CLIENT, paymentId: "pay_C", amountCents: 50000 }, { ...deps, recordClarityPayment: refuse }),
      /refused the payment \(conflict\)/
    );
    assert.equal(db.state.log.length, 0, "no claim left behind, so a replay can still apply it");
    // the replay, with the plan back to normal, applies it
    assert.equal((await applyCommasPayment(db, { orgId: ORG, clientId: CLIENT, paymentId: "pay_C", amountCents: 50000 }, deps)).outcome, "applied");
  });
});

describe("the money helper stops chasing a paid installment", () => {
  test("before: it acts on the late $500. After Commas pays it: no step for that installment", async () => {
    const before = sampleWorld();
    const sends = [];
    const send = async (_db, a) => { sends.push(a); return { sent: true }; };
    const task = async () => ({ created: true, id: "t1" });
    const r0 = await runForClient(before.db, { orgId: ORG, clientId: CLIENT, todayIso: TODAY, send, createTask: task });
    assert.ok(r0.actions.some((a) => /clarity_installment:a159-2/.test(a.key)), "late installment is chased before payment");

    const after = sampleWorld();
    await applyCommasPayment(after.db, { orgId: ORG, clientId: CLIENT, paymentId: "pay_A1", amountCents: 50000 }, deps);
    const sends2 = [];
    const r1 = await runForClient(after.db, {
      orgId: ORG, clientId: CLIENT, todayIso: TODAY,
      send: async (_db, a) => { sends2.push(a); return { sent: true }; }, createTask: task
    });
    assert.equal(r1.actions.filter((a) => /a159-2/.test(a.key)).length, 0, "paid installment is never chased");
    assert.equal(sends2.filter((s) => /a159-2/.test(s.eventId)).length, 0);
    assert.equal(r1.tasks, 0);
  });
});

/* ── a stored Commas row, all the way through ────────────────────────────
   Payload shapes copied from the commas_inbox rows on file (2026-10-06), with
   every personal value replaced. Two shapes are stored:
     * the checkout-session shape — data.buyer / data.item / data.amount and
       data.api_metadata.data { link_ref, client_id, org_id, payment_type };
     * the walkthrough shape — data.fan / data.product / data.amount and the
       same api_metadata bag.
   Amount is in DOLLARS on the wire; the payment id is data.payment_id. */
const REAL_SHAPE = (paymentId, dollars, linkRef) => JSON.stringify({
  id: `evt_${paymentId}`, type: "payment.succeeded", created_at: "2026-10-06T15:00:00Z",
  data: {
    payment_id: paymentId, event_type: "payment.succeeded", status: "succeeded",
    amount: dollars, total_price: dollars, unit_price: dollars.toFixed(2), currency: "USD",
    payment_type: "onetime", payment_method: "card", quantity: 1,
    buyer: { id: "b-000", email: "sample.client@example.com", name: "Sample Client", phone: null, address: null },
    item: { id: "itm00", title: "Payment plan installment", type: "onetime" },
    additional_params: { card_brand: "visa", last4: "0000", source: "checkout" },
    api_metadata: { data: { link_ref: linkRef, client_id: CLIENT, org_id: ORG, payment_type: "onetime" } }
  }
});
const SIM_SHAPE = (paymentId, dollars) => JSON.stringify({
  id: `evt_${paymentId}`, type: "payment.succeeded",
  data: {
    payment_id: paymentId, amount: dollars, currency: "USD",
    fan: { email: "sample.client@example.com" }, product: { title: "Buy now, pay later — payment 2" },
    simulated: true, simulated_notice: "sample",
    api_metadata: { data: { link_ref: "sim_ref_000", client_id: CLIENT, org_id: ORG } }
  }
});

/* The tables the adapter itself reads, in front of the clarity world. */
function e2eDb(world, { links = [] } = {}) {
  const events = [];
  return {
    state: world.state, events,
    async query(sql, params = []) {
      if (/FROM payment_links pl/.test(sql)) {
        const byRef = /pl\.link_ref = \$1/.test(sql);
        const hit = links.find((l) => (byRef ? l.link_ref === params[0] : l.commas_session_id === params[0]));
        return { rows: hit ? [hit] : [] };
      }
      if (/SELECT purpose, description FROM payment_links WHERE id = \$1/.test(sql)) {
        return { rows: links.filter((l) => l.id === params[0]) };
      }
      if (/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)) {
        return { rows: params[0] === CLIENT && params[1] === ORG ? [{ id: CLIENT }] : [] };
      }
      if (/INSERT INTO events/.test(sql)) {
        if (events.some((e) => e.key === params[3])) return { rows: [] };
        events.push({ key: params[3], name: params[1], clientId: params[4] });
        return { rows: [{ id: `ev-${events.length}` }] };
      }
      return world.query(sql, params);
    }
  };
}
const inboxRow = (paymentId, raw) => ({
  id: `row-${paymentId}`, org_id: ORG, payment_id: paymentId, event_type: "payment.succeeded",
  dedupe_key: `${paymentId}:payment.succeeded`, raw_body: raw
});
const freshBus = () => { clearHandlers(); registerClarityAutopay(); };

describe("a stored-shape Commas payment → the handler → the plan", () => {
  test("checkout-session shape, $150 through a custom link → BNPL payment 2 paid; replay applies nothing", async () => {
    freshBus();
    const { db: world, P2 } = sampleWorld();
    const link = { id: "link-0001", org_id: ORG, client_id: CLIENT, purpose: "custom", description: "BNPL payment 2", link_ref: "pl_ref_0001",
      invoice_id: null, product_id: null, product_code: null, sale_id: null, sale_motion: null, closer_staff_id: null, sales_manager_staff_id: null };
    const db = e2eDb(world, { links: [link] });

    const out = await processCommasInboxRow(inboxRow("pay_real_0001", REAL_SHAPE("pay_real_0001", 150, "pl_ref_0001")), db);
    assert.equal(out.ok, true);
    assert.ok(out.emitted.some((e) => e.name === "payment.received"));
    assert.equal(db.state.inst.find((i) => i.clarity_payment_id === P2 && i.seq === 2).paid_cents, 15000);
    assert.equal(db.state.log.at(-1).detail.payment_link_id, "link-0001");
    assert.equal(db.state.log.at(-1).detail.via, "commas");

    // The same bytes again (a second sweeper, a replay): nothing more is paid.
    await processCommasInboxRow(inboxRow("pay_real_0001", REAL_SHAPE("pay_real_0001", 150, "pl_ref_0001")), db);
    assert.equal(db.state.inst.find((i) => i.clarity_payment_id === P2 && i.seq === 3).paid_cents, 0);
    assert.equal(db.state.log.length, 1);
    clearHandlers();
  });

  test("even if the event row is replayed past its own dedupe, the claim key still applies nothing", async () => {
    freshBus();
    const { db: world, P1 } = sampleWorld();
    const db = e2eDb(world);
    await processCommasInboxRow(inboxRow("pay_sim_0002", SIM_SHAPE("pay_sim_0002", 500)), db);
    db.events.length = 0; // forget the event row, as a dead-letter replay would re-dispatch
    await processCommasInboxRow(inboxRow("pay_sim_0002", SIM_SHAPE("pay_sim_0002", 500)), db);
    assert.equal(db.state.inst.find((i) => i.clarity_payment_id === P1 && i.seq === 3).paid_cents, 0);
    assert.equal(db.state.log.length, 1);
    clearHandlers();
  });

  test("walkthrough shape, client from checkout metadata, $500 → the late Clarity payment paid", async () => {
    freshBus();
    const { db: world, P1 } = sampleWorld();
    const db = e2eDb(world);
    await processCommasInboxRow(inboxRow("pay_sim_0001", SIM_SHAPE("pay_sim_0001", 500)), db);
    assert.equal(db.state.inst.find((i) => i.clarity_payment_id === P1 && i.seq === 2).paid_cents, 50000);
    clearHandlers();
  });

  test("a $32 assessment from the same client is not a plan payment: nothing applied, nothing logged", async () => {
    freshBus();
    const { db: world } = sampleWorld();
    const db = e2eDb(world);
    const raw = JSON.stringify({ type: "payment.succeeded", data: { payment_id: "pay_crs_0001", amount: 32, currency: "USD",
      fan: { email: "sample.client@example.com" }, product: { title: "Business Financial Assessment" },
      api_metadata: { data: { link_ref: "x", client_id: CLIENT, org_id: ORG } } } });
    await processCommasInboxRow(inboxRow("pay_crs_0001", raw), db);
    assert.equal(db.state.log.length, 0);
    assert.equal(db.state.inst.reduce((s, i) => s + i.paid_cents, 0), 65000);
    clearHandlers();
  });
});
