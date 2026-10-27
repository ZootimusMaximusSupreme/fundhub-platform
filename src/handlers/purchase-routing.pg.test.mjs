// Real-Postgres proof for purchase-routing: a payment lands, the client lands on
// the board that pays for the work.
// SKIPS unless DATABASE_URL is set.
//
// Driven through the REAL BUS (emit -> dispatch) with registerAll(), not by
// calling the handler directly, because registration order is part of what is
// under test: money-chain must have written the sale before purchase-routing
// reads it to decide which board the client belongs on.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { emit, _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers, getHandlers } from "../events/registry.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { registerAll, _resetRegistered } from "../register-all.mjs";
import {
  onPurchaseRoute, ROUTED_EVENTS, FUNDING_PIPELINE, FUNDING_STAGE,
  REPAIR_PIPELINE, REPAIR_STAGE, FUNDING_TAG
} from "./purchase-routing.mjs";
import { FUNDING_PAUSED_HOLD } from "../inquiry-ops/doc-gate.mjs";
import { PAUSED_TAG } from "../crs/snapshot-negatives.mjs";
import { handle as s06Handle } from "../workflows/s-06-post-call-funding-purchased.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const MARK = "purchaserouting_pg";

describe("purchase-routing", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  let fundingProductId, repairProductId, diagProductId;

  async function wipe() {
    const clients = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`,
      [`${MARK}%`]
    )).rows.map((r) => r.id);
    if (!clients.length) return;
    await db.query(`ALTER TABLE commission_ledger DISABLE TRIGGER trg_commission_ledger_no_delete`);
    try {
      await db.query(`DELETE FROM commission_ledger WHERE client_id = ANY($1)`, [clients]);
    } finally {
      await db.query(`ALTER TABLE commission_ledger ENABLE TRIGGER trg_commission_ledger_no_delete`);
    }
    await db.query(`ALTER TABLE entitlements DISABLE TRIGGER trg_entitlements_no_delete`);
    try {
      await db.query(`DELETE FROM entitlements WHERE client_id = ANY($1)`, [clients]);
    } finally {
      await db.query(`ALTER TABLE entitlements ENABLE TRIGGER trg_entitlements_no_delete`);
    }
    await db.query(`DELETE FROM sale_payments WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
    await db.query(`DELETE FROM sale_attributions WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
    await db.query(`DELETE FROM funding_round_sales WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clients]);
    await db.query(`DELETE FROM funding_rounds WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM sales WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM transactions WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM tasks WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM cards WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM messages WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM conversations WHERE client_id = ANY($1)`, [clients]);
    await db.query(`DELETE FROM failed_events WHERE client_id = ANY($1)`, [clients]).catch(() => {});
    await db.query(`DELETE FROM events WHERE client_id = ANY($1) OR payload->>'email' LIKE $2`, [clients, `${MARK}%`]);
    await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [clients]);
  }

  async function seedClient(suffix, { outcomeTier = null } = {}) {
    const r = await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, phone, outcome_tier, custom_fields)
       VALUES ($1,$2,'Route',$3,'+15550002222',$4,'{}'::jsonb)
       RETURNING id`,
      [org, `${MARK}.${suffix}@example.com`, suffix, outcomeTier]
    );
    return { id: r.rows[0].id, email: `${MARK}.${suffix}@example.com` };
  }

  /* Write a sale straight in, the way a purchase months ago would already be on
     file. Used where the test needs a purchase WITHOUT re-running the whole
     money chain for it. */
  async function seedSale(clientId, productId, price, { paid = true } = {}) {
    const row = (await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, status, sold_at)
       VALUES ($1,$2,$3,$4,'active', now()) RETURNING id`,
      [org, clientId, productId, price]
    )).rows[0];
    // The pre-existing seed models a purchased sale, not a signed but unpaid offer.
    if (paid) {
      await db.query(
        `INSERT INTO sale_payments (org_id, sale_id, product_id, kind, amount)
         VALUES ($1,$2,$3,'deposit',$4)`,
        [org, row.id, productId, price]
      );
    }
    return row.id;
  }

  async function cardStage(clientId, pipelineKey) {
    const r = await db.query(
      `SELECT ps.key AS stage_key
         FROM cards c
         JOIN pipelines p ON p.id = c.pipeline_id
         JOIN pipeline_stages ps ON ps.id = c.stage_id
        WHERE c.client_id = $1 AND p.key = $2 AND p.org_id = $3
        LIMIT 1`,
      [clientId, pipelineKey, org]
    );
    return r.rows[0]?.stage_key || null;
  }

  async function clientRow(clientId) {
    const r = await db.query(
      `SELECT tags, custom_fields FROM clients WHERE id = $1`,
      [clientId]
    );
    return r.rows[0];
  }

  async function moveCardTo(clientId, pipelineKey, stageKey) {
    await db.query(
      `UPDATE cards SET stage_id = (
         SELECT ps.id FROM pipeline_stages ps
           JOIN pipelines p ON p.id = ps.pipeline_id
          WHERE p.key = $2 AND ps.key = $3 AND p.org_id = $4 LIMIT 1)
        WHERE client_id = $1
          AND pipeline_id = (SELECT id FROM pipelines WHERE key = $2 AND org_id = $4)`,
      [clientId, pipelineKey, stageKey, org]
    );
  }

  before(async () => {
    _resetOrgCache();
    clearHandlers();
    _resetRegistered();
    registerAll();
    org = await resolveDefaultOrg(db);
    await wipe();

    const byCode = async (code) => (await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND code = $2 LIMIT 1`,
      [org, code]
    )).rows[0]?.id || null;
    fundingProductId = await byCode("card-stacking-dfy");
    repairProductId = await byCode("repair-bundle");
    diagProductId = await byCode("diagnostic");
    assert.ok(fundingProductId, "card-stacking-dfy product missing — migrations not applied");
    assert.ok(repairProductId, "repair-bundle product missing — migrations not applied");
  });

  after(async () => {
    await wipe();
    clearHandlers();
    _resetRegistered();
    await close().catch(() => {});
  });

  // ── registration: a handler file is not a handler ──

  test("purchase-routing is registered on every payment event, and after money-chain", () => {
    for (const name of ROUTED_EVENTS) {
      const handlers = getHandlers(name);
      const mine = handlers.findIndex((fn) => fn === onPurchaseRoute);
      assert.ok(mine >= 0, `purchase-routing is not registered on ${name}`);
      const money = handlers.findIndex((fn) => String(fn.name).endsWith("Money"));
      assert.ok(money >= 0, `money-chain is not registered on ${name}`);
      assert.ok(
        money < mine,
        `purchase-routing runs before money-chain on ${name} — the sale will not exist yet`
      );
    }
  });

  test("purchase-routing never listens on diagnostic.paid, round.started or round.funded", () => {
    for (const name of ["diagnostic.paid", "round.started", "round.funded"]) {
      assert.ok(
        !getHandlers(name).includes(onPurchaseRoute),
        `${name} must not route a client to a fulfilment board`
      );
    }
  });

  // ── the four situations ──

  test("bought card stacking: the card lands on funding_card_stacking / apply_now", async () => {
    const c = await seedClient("funding", { outcomeTier: "FULL_FUNDING" });
    await emit(db, "deposit.paid", { email: c.email, amount: 3000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:funding:1`
    });

    assert.equal(await cardStage(c.id, FUNDING_PIPELINE), FUNDING_STAGE);
    assert.equal(await cardStage(c.id, REPAIR_PIPELINE), null, "a funding-only buyer got a repair card");

    // Landing on apply_now is what fires the cascade.
    const started = await db.query(
      `SELECT id FROM events WHERE client_id = $1 AND name = 'round.started'`, [c.id]
    );
    assert.equal(started.rows.length, 1, "round.started did not fire once");

    // Nothing was routed to the boards that must never receive an automatic move.
    assert.equal(await cardStage(c.id, "funding_altfin"), null);
    assert.equal(await cardStage(c.id, "inquiry_removal"), null);

    // The card is NOT held: a funding-only buyer has nothing to clear first.
    const row = await clientRow(c.id);
    assert.ok(!row.custom_fields?.round_hold_reason, "a funding-only buyer was put on hold");
  });

  /* WHERE A REPAIR CARD ACTUALLY COMES TO REST, since 2026-09-06.
     placeCard still drops it on intake. Enrolment then runs, and enrolment asks
     the client for their identity documents (repair.docs.needed), which walks
     the card on to awaiting_documents. A seeded client has no documents on
     file, so this is deterministic — and it is the whole point of the fix: a
     repair card parked on intake with nothing behind it was the defect. */
  const ENROLLED_STAGE = "awaiting_documents";

  async function repairProgramRow(clientId) {
    const r = await db.query(
      `SELECT program, rounds_cap, price_total, status FROM repair_programs
        WHERE org_id = $1 AND client_id = $2`,
      [org, clientId]
    );
    return r.rows[0] || null;
  }

  test("bought repair: the card lands on the optimization board and no funding card exists", async () => {
    const c = await seedClient("repair", { outcomeTier: "REPAIR_ONLY" });
    await emit(db, "sale.closed", { email: c.email, product: "repair", amount: 1000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:repair:1`
    });

    assert.equal(await cardStage(c.id, REPAIR_PIPELINE), ENROLLED_STAGE);
    assert.equal(await cardStage(c.id, FUNDING_PIPELINE), null, "a repair-only buyer got a funding card");

    // REPAIR_ONLY is not a funding path, so no funding is owed and no tag is set.
    const row = await clientRow(c.id);
    assert.ok(!(row.tags || []).includes(FUNDING_TAG), "a repair-only buyer was tagged as owing funding");
  });

  /* ── the repair program itself ─────────────────────────────────────────────
     Before 2026-09-06 a repair purchase placed a card and stopped. The $1,000
     buyer measured on production had no program, no rounds, no document
     request, no email and no task, while a $200 trial buyer who happened to be
     enrolled by hand had all of them. These pin the automatic version. */

  test("the six-round bundle enrols on six rounds, not the button's two", async () => {
    const c = await seedClient("bundlerounds", { outcomeTier: "REPAIR_ONLY" });
    await emit(db, "sale.closed", { email: c.email, product: "repair", amount: 1000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:bundlerounds:1`
    });

    const prog = await repairProgramRow(c.id);
    assert.ok(prog, "a paid repair client was left with no program at all");
    assert.equal(prog.program, "full");
    assert.equal(prog.rounds_cap, 6, "the full program was capped at the trial's rounds");
    assert.equal(Number(prog.price_total), 1000, "the price was not the price they agreed");
    assert.equal(prog.status, "active");
  });

  test("enrolling tells somebody to do something", async () => {
    const c = await seedClient("repairtasks", { outcomeTier: "REPAIR_ONLY" });
    await emit(db, "sale.closed", { email: c.email, product: "repair", amount: 1000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:repairtasks:1`
    });

    const t = await db.query(
      `SELECT title, assignee_role, due_at FROM tasks
        WHERE client_id = $1 AND source_workflow = 'repair-enrollment' ORDER BY title`,
      [c.id]
    );
    assert.equal(t.rows.length, 2, "a paid repair client had nobody told to do anything");
    for (const row of t.rows) {
      assert.equal(row.assignee_role, "inquiry_specialist");
      assert.ok(row.due_at, "a repair task with no date is a task nobody chases");
    }
  });

  test("one repair purchase grants the letter pack once, not twice", async () => {
    const c = await seedClient("onegrant", { outcomeTier: "REPAIR_ONLY" });
    await emit(db, "sale.closed", { email: c.email, product: "repair", amount: 1000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:onegrant:1`
    });

    const g = await db.query(
      `SELECT count(*)::int AS n FROM v_client_entitlements
        WHERE client_id = $1 AND entitlement_code = 'metro2-letter-pack' AND active`,
      [c.id]
    );
    assert.equal(g.rows[0].n, 1,
      "the payment and the enrolment behind it each granted the letter pack");
  });

  test("a replayed payment does not open a second program or a second set of tasks", async () => {
    const c = await seedClient("repairreplay", { outcomeTier: "REPAIR_ONLY" });
    for (const key of ["a", "b"]) {
      await emit(db, "sale.closed", { email: c.email, product: "repair", amount: 1000 }, {
        orgId: org, clientId: c.id, idempotencyKey: `${MARK}:repairreplay:${key}`
      });
    }
    const progs = await db.query(
      `SELECT count(*)::int AS n FROM repair_programs WHERE client_id = $1`, [c.id]);
    assert.equal(progs.rows[0].n, 1);
    const t = await db.query(
      `SELECT count(*)::int AS n FROM tasks WHERE client_id = $1 AND source_workflow = 'repair-enrollment'`,
      [c.id]);
    assert.equal(t.rows[0].n, 2);
  });

  test("a funding-only buyer is never enrolled in repair", async () => {
    const c = await seedClient("fundingnoprog", { outcomeTier: "FULL_FUNDING" });
    await emit(db, "deposit.paid", { email: c.email, amount: 3000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:fundingnoprog:1`
    });
    assert.equal(await repairProgramRow(c.id), null,
      "a card-stacking buyer was opened a credit repair program");
  });

  test("both active: both boards, and the funding card starts held", async () => {
    const c = await seedClient("both", { outcomeTier: "FUNDING_PLUS_REPAIR" });
    // Repair already bought and on the board.
    await emit(db, "sale.closed", { email: c.email, product: "repair", amount: 1000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:both:repair`
    });
    assert.equal(await cardStage(c.id, REPAIR_PIPELINE), ENROLLED_STAGE);
    assert.equal(await cardStage(c.id, FUNDING_PIPELINE), null);

    // Now they buy funding too.
    await emit(db, "deposit.paid", { email: c.email, amount: 3000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:both:funding`
    });

    assert.equal(await cardStage(c.id, REPAIR_PIPELINE), ENROLLED_STAGE, "the repair card moved");
    assert.equal(await cardStage(c.id, FUNDING_PIPELINE), FUNDING_STAGE);

    const row = await clientRow(c.id);
    assert.equal(row.custom_fields?.round_hold_reason, FUNDING_PAUSED_HOLD,
      "the funding card was not held while repair is still running");
    assert.ok((row.tags || []).includes(PAUSED_TAG),
      "the existing funding:paused tag was not set, so the existing release path cannot clear it");
  });

  test("repair now, funding signed for later: repair board only, funding tag, no funding card", async () => {
    const c = await seedClient("later", { outcomeTier: "FUNDING_PLUS_REPAIR" });
    await emit(db, "sale.closed", { email: c.email, product: "repair", amount: 1000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:later:repair`
    });

    assert.equal(await cardStage(c.id, REPAIR_PIPELINE), ENROLLED_STAGE);
    assert.equal(await cardStage(c.id, FUNDING_PIPELINE), null,
      "funding was only signed for, not bought — there must be no funding card");

    const row = await clientRow(c.id);
    assert.ok((row.tags || []).includes(FUNDING_TAG),
      "nothing marks that funding is still owed, so it will never be picked up");
    // No funding card means no round, so the cascade must not have fired.
    const started = await db.query(
      `SELECT id FROM events WHERE client_id = $1 AND name = 'round.started'`, [c.id]
    );
    assert.equal(started.rows.length, 0, "a round started for a client who has not bought funding");
  });

  // ── safe to fire twice ──

  test("the same payment twice: one move, and the cascade fires once", async () => {
    const c = await seedClient("replay", { outcomeTier: "FULL_FUNDING" });
    const payload = { email: c.email, amount: 3000, providerRef: `${MARK}-replay-ref` };

    await emit(db, "deposit.paid", payload, { orgId: org, clientId: c.id });
    await emit(db, "deposit.paid", payload, { orgId: org, clientId: c.id });

    const cards = await db.query(
      `SELECT c.id FROM cards c JOIN pipelines p ON p.id = c.pipeline_id
        WHERE c.client_id = $1 AND p.key = $2`,
      [c.id, FUNDING_PIPELINE]
    );
    assert.equal(cards.rows.length, 1, "a second delivery created a second card");
    assert.equal(await cardStage(c.id, FUNDING_PIPELINE), FUNDING_STAGE);

    const started = await db.query(
      `SELECT id FROM events WHERE client_id = $1 AND name = 'round.started'`, [c.id]
    );
    assert.equal(started.rows.length, 1, "the cascade fired twice");
    const rounds = await db.query(
      `SELECT id FROM funding_rounds WHERE client_id = $1`, [c.id]
    );
    assert.equal(rounds.rows.length, 1, "a second round was opened on a replayed payment");
  });

  test("a card already at funded is never dragged back to apply_now", async () => {
    const c = await seedClient("funded", { outcomeTier: "FULL_FUNDING" });
    await emit(db, "deposit.paid", { email: c.email, amount: 3000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:funded:deposit`
    });
    assert.equal(await cardStage(c.id, FUNDING_PIPELINE), FUNDING_STAGE);

    // The round runs its course and the card reaches Funded.
    await moveCardTo(c.id, FUNDING_PIPELINE, "funded");
    assert.equal(await cardStage(c.id, FUNDING_PIPELINE), "funded");

    // A late instalment on the same deal arrives.
    await emit(db, "payment.received", { email: c.email, amount: 500 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:funded:instalment`
    });

    assert.equal(await cardStage(c.id, FUNDING_PIPELINE), "funded",
      "a later payment dragged a funded client back to the start of the pipeline");
  });

  test("a client already mid-funding who buys repair is not put on hold", async () => {
    const c = await seedClient("midfunding", { outcomeTier: "FUNDING_PLUS_REPAIR" });
    await emit(db, "deposit.paid", { email: c.email, amount: 3000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:mid:deposit`
    });
    await moveCardTo(c.id, FUNDING_PIPELINE, "round_submitted");

    await emit(db, "sale.closed", { email: c.email, product: "repair", amount: 1000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:mid:repair`
    });

    assert.equal(await cardStage(c.id, REPAIR_PIPELINE), ENROLLED_STAGE);
    assert.equal(await cardStage(c.id, FUNDING_PIPELINE), "round_submitted",
      "buying repair reset a funding round that was already running");
    const row = await clientRow(c.id);
    assert.ok(!row.custom_fields?.round_hold_reason,
      "a live funding round was paused because the client also bought repair");
  });

  test("an existing hold reason is never overwritten", async () => {
    const c = await seedClient("heldalready", { outcomeTier: "FUNDING_PLUS_REPAIR" });
    await db.query(
      `UPDATE clients SET custom_fields = custom_fields || '{"round_hold_reason":"New Inquiries"}'::jsonb
        WHERE id = $1`, [c.id]
    );
    await seedSale(c.id, repairProductId, 1000);
    await emit(db, "deposit.paid", { email: c.email, amount: 3000 }, {
      orgId: org, clientId: c.id, idempotencyKey: `${MARK}:held:deposit`
    });

    const row = await clientRow(c.id);
    assert.equal(row.custom_fields?.round_hold_reason, "New Inquiries",
      "why the client is actually held was overwritten");
  });

  // ── nothing to route ──

  test("only net-paid funding and repair sales can enter fulfillment", async () => {
    const scenarios = ["unpaid_funding", "unpaid_repair", "success_fee_only", "fully_refunded"];
    for (const scenario of scenarios) {
      const c = await seedClient(`moneygate-${scenario}`);
      const productId = scenario === "unpaid_repair" ? repairProductId : fundingProductId;
      const paid = scenario === "fully_refunded";
      const saleId = await seedSale(c.id, productId, 3000, { paid });
      if (scenario === "success_fee_only" || scenario === "fully_refunded") {
        const kind = scenario === "success_fee_only" ? "success_fee" : "refund";
        await db.query(
          `INSERT INTO sale_payments (org_id, sale_id, product_id, kind, amount)
           VALUES ($1,$2,$3,$4,3000)`, [org, saleId, productId, kind]
        );
      }
      // An unrelated $32 diagnostic cannot turn an unpaid sale into work.
      const out = await onPurchaseRoute(
        { id: null, name: "payment.received", orgId: org, clientId: c.id,
          payload: { product: "diagnostic", amount: 32 } }, db
      );
      assert.equal(out.routed, false, `${scenario}: not routed`);
      assert.equal(out.reason, "no_product_path", `${scenario}: why not routed`);
      assert.equal(await cardStage(c.id, FUNDING_PIPELINE), null, `${scenario}: funding`);
      assert.equal(await cardStage(c.id, REPAIR_PIPELINE), null, `${scenario}: repair`);
    }
  });

  test("no resolvable path: a named no-op that writes nothing", async () => {
    const c = await seedClient("nopath");
    await seedSale(c.id, diagProductId, 32);

    const before = await db.query(`SELECT count(*)::int AS n FROM cards WHERE client_id = $1`, [c.id]);
    const out = await onPurchaseRoute(
      { id: null, name: "payment.received", orgId: org, clientId: c.id, payload: {} },
      db
    );
    const after = await db.query(`SELECT count(*)::int AS n FROM cards WHERE client_id = $1`, [c.id]);

    assert.equal(out.routed, false);
    assert.equal(out.reason, "no_product_path");
    assert.equal(after.rows[0].n, before.rows[0].n, "a no-op wrote a card");
    assert.equal(after.rows[0].n, 0);
  });

  test("no client: a named no-op, and no client is invented", async () => {
    const stranger = `${MARK}.never-seen@example.com`;
    const out = await onPurchaseRoute(
      { id: null, name: "payment.received", orgId: org, payload: { email: stranger } },
      db
    );
    assert.equal(out.routed, false);
    assert.equal(out.reason, "no_client");
    const made = await db.query(`SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2`, [org, stranger]);
    assert.equal(made.rows.length, 0, "a stray payment minted a phantom client");
  });

  test("no org: a named no-op", async () => {
    const out = await onPurchaseRoute({ id: null, name: "payment.received", payload: {} }, db);
    assert.equal(out.routed, false);
    assert.equal(out.reason, "no_org");
  });

  // ── the handoff task ──
  //
  // S-06 is an Inngest workflow, not a bus handler, so it is driven through its
  // own handle() against the same real Postgres. Its task is the one a funding
  // advisor actually picks up.

  test("the funding intake task is owned by a funding advisor and has a due date", async () => {
    const c = await seedClient("task", { outcomeTier: "FULL_FUNDING" });
    const step = { run: async (_name, fn) => fn() };
    await s06Handle({
      event: { id: `${MARK}-task-evt`, orgId: org, clientId: c.id, payload: {} },
      db,
      step
    });

    const t = await db.query(
      `SELECT title, assignee_role, due_at FROM tasks
        WHERE client_id = $1 AND source_workflow = 's-06-post-call-funding-purchased'`,
      [c.id]
    );
    assert.equal(t.rows.length, 1, "no funding intake task was created");
    assert.equal(t.rows[0].assignee_role, "funding_advisor",
      "fulfilment work was assigned to a closer");
    assert.ok(t.rows[0].due_at, "no due date — the calendar drops tasks with none, so nobody sees it");
    assert.ok(t.rows[0].due_at > new Date(), "the task is already overdue the moment it is made");
  });

  test("the funding intake task still dedupes on a replayed event", async () => {
    const c = await seedClient("taskdup", { outcomeTier: "FULL_FUNDING" });
    const step = { run: async (_name, fn) => fn() };
    const event = { id: `${MARK}-taskdup-evt`, orgId: org, clientId: c.id, payload: {} };
    await s06Handle({ event, db, step });
    await s06Handle({ event, db, step });

    const t = await db.query(
      `SELECT id FROM tasks WHERE client_id = $1 AND source_workflow = 's-06-post-call-funding-purchased'`,
      [c.id]
    );
    assert.equal(t.rows.length, 1, "a replayed event created a second intake task");
  });
});
