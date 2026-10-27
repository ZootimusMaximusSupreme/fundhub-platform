import { test } from "node:test";
import assert from "node:assert";
import { advanceCardToStage, moveCardToStage } from "./cards.mjs";
import { pgFake } from "./test-support.mjs";

const SALES = [
  { org_id: "org-1", pipeline_key: "sales", stage_key: "new_lead", pipeline_id: "pipe-sales", stage_id: "st-new", sort_order: 0 },
  { org_id: "org-1", pipeline_key: "sales", stage_key: "survey_complete", pipeline_id: "pipe-sales", stage_id: "st-survey", sort_order: 1 },
  { org_id: "org-1", pipeline_key: "sales", stage_key: "booked", pipeline_id: "pipe-sales", stage_id: "st-booked", sort_order: 2 }
];

test("Closed Won requires a paid funding deposit", async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM pipeline_stages ps/.test(sql)) return { rows: [{ stage_id: "won", pipeline_id: "sales" }] };
    if (/FROM sale_payments sp/.test(sql)) return { rows: [] };
    throw new Error("card must not move");
  } };
  const result = await moveCardToStage(db, { orgId: "org-1", clientId: "cl-1", pipelineKey: "sales", stageKey: "closed_won" });
  assert.equal(result.reason, "deposit_payment_required");
  assert.match(calls[1].sql, /p.code = 'card-stacking-dfy'/);
  assert.match(calls[1].sql, /sp.amount > 0/);
});

test("Closed Won moves after a paid funding deposit", async () => {
  const db = { query: async (sql) => {
    if (/FROM pipeline_stages ps/.test(sql)) return { rows: [{ stage_id: "won", pipeline_id: "sales" }] };
    if (/FROM sale_payments sp/.test(sql)) return { rows: [{ ok: 1 }] };
    if (/SELECT id FROM cards/.test(sql)) return { rows: [] };
    if (/INSERT INTO cards/.test(sql)) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  const result = await moveCardToStage(db, { orgId: "org-1", clientId: "cl-1", pipelineKey: "sales", stageKey: "closed_won" });
  assert.equal(result.moved, true);
});

test("advanceCardToStage: creates card when none exists", async () => {
  const db = pgFake({ pipelineStages: SALES });
  const res = await advanceCardToStage(db, {
    orgId: "org-1", clientId: "cl-1", pipelineKey: "sales", stageKey: "new_lead"
  });
  assert.equal(res.moved, true);
  assert.equal(db.cards[0].stage_id, "st-new");
});

test("advanceCardToStage: moves forward new_lead → survey_complete → booked", async () => {
  const db = pgFake({ pipelineStages: SALES });
  await advanceCardToStage(db, {
    orgId: "org-1", clientId: "cl-1", pipelineKey: "sales", stageKey: "new_lead"
  });
  await advanceCardToStage(db, {
    orgId: "org-1", clientId: "cl-1", pipelineKey: "sales", stageKey: "survey_complete"
  });
  assert.equal(db.cards[0].stage_id, "st-survey");
  await advanceCardToStage(db, {
    orgId: "org-1", clientId: "cl-1", pipelineKey: "sales", stageKey: "booked"
  });
  assert.equal(db.cards[0].stage_id, "st-booked");
});

test("advanceCardToStage: refuses to demote booked → new_lead", async () => {
  const db = pgFake({
    pipelineStages: SALES,
    cards: [{ id: "card-1", org_id: "org-1", client_id: "cl-1", pipeline_id: "pipe-sales", stage_id: "st-booked" }]
  });
  const res = await advanceCardToStage(db, {
    orgId: "org-1", clientId: "cl-1", pipelineKey: "sales", stageKey: "new_lead"
  });
  assert.equal(res.moved, false);
  assert.equal(res.reason, "already_at_or_past");
  assert.equal(db.cards[0].stage_id, "st-booked");
});

test("moveCardToStage still demotes (escape hatch for staff tools)", async () => {
  const db = pgFake({
    pipelineStages: SALES,
    cards: [{ id: "card-1", org_id: "org-1", client_id: "cl-1", pipeline_id: "pipe-sales", stage_id: "st-booked" }]
  });
  const res = await moveCardToStage(db, {
    orgId: "org-1", clientId: "cl-1", pipelineKey: "sales", stageKey: "new_lead"
  });
  assert.equal(res.moved, true);
  assert.equal(db.cards[0].stage_id, "st-new");
});

const FUNDING = [
  { org_id: "org-1", pipeline_key: "funding_card_stacking", stage_key: "apply_now", pipeline_id: "pipe-fund", stage_id: "st-apply", sort_order: 0 },
  { org_id: "org-1", pipeline_key: "funding_card_stacking", stage_key: "closed", pipeline_id: "pipe-fund", stage_id: "st-closed", sort_order: 5 },
  { org_id: "org-1", pipeline_key: "funding_card_stacking", stage_key: "action_required", pipeline_id: "pipe-fund", stage_id: "st-action", sort_order: 3 }
];

test("funding gate does not block Apply Now when documents are pending", async () => {
  const db = pgFake({
    pipelineStages: FUNDING,
    clients: [{ id: "cl-1", org_id: "org-1", custom_fields: { round_hold_reason: "Documents Pending Approval" } }]
  });
  const res = await moveCardToStage(db, {
    orgId: "org-1", clientId: "cl-1", pipelineKey: "funding_card_stacking", stageKey: "apply_now"
  });
  assert.equal(res.moved, true);
});

test("funding gate still blocks later stages when documents are pending", async () => {
  const db = pgFake({
    pipelineStages: [
      ...FUNDING,
      { org_id: "org-1", pipeline_key: "funding_card_stacking", stage_key: "round_submitted", pipeline_id: "pipe-fund", stage_id: "st-round", sort_order: 1 }
    ],
    clients: [{ id: "cl-1", org_id: "org-1", custom_fields: { round_hold_reason: "Documents Pending Approval" } }]
  });
  const res = await moveCardToStage(db, {
    orgId: "org-1", clientId: "cl-1", pipelineKey: "funding_card_stacking", stageKey: "round_submitted"
  });
  assert.equal(res.moved, false);
  assert.equal(res.reason, "funding_gate_closed");
});

test("funding gate still allows Closed", async () => {
  const db = pgFake({
    pipelineStages: FUNDING,
    clients: [{ id: "cl-1", org_id: "org-1", custom_fields: { round_hold_reason: "Funding Paused" } }]
  });
  const res = await moveCardToStage(db, {
    orgId: "org-1", clientId: "cl-1", pipelineKey: "funding_card_stacking", stageKey: "closed"
  });
  assert.equal(res.moved, true);
});
