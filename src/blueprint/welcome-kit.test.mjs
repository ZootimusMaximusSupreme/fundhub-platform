import assert from "node:assert/strict";
import test from "node:test";

import {
  createWelcomeKitTaskForPurchase,
  WELCOME_KIT_CHECKLIST,
  WELCOME_KIT_SOURCE
} from "./welcome-kit.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT_A = "550e8400-e29b-41d4-a716-446655440001";
const CLIENT_B = "550e8400-e29b-41d4-a716-446655440002";
const KIT_TITLE = "Ship Capital Blueprint welcome kit";

function fakeDb() {
  const state = { prequal: 200_000, tasks: [], queries: [], rejectDetail: false };
  return {
    state,
    async query(sql, params = []) {
      state.queries.push({ sql, params });
      if (/SELECT first_name, last_name, custom_fields FROM clients/i.test(sql)) {
        return { rows: [{
          first_name: "Sample", last_name: "Buyer",
          custom_fields: { total_funding_estimate: state.prequal }
        }] };
      }
      if (/SELECT result FROM crs_results/i.test(sql)) return { rows: [] };
      if (/SELECT id FROM tasks/i.test(sql) && /title\s*=\s*\$3/i.test(sql)) {
        const [clientId, workflow, title] = params;
        const existing = state.tasks.find((row) =>
          row.clientId === clientId && row.source === workflow && row.title === title
        );
        return { rows: existing ? [{ id: existing.id }] : [] };
      }
      if (/INSERT INTO tasks/i.test(sql)) {
        const hasDetail = /\bdetail\b/i.test(sql);
        if (state.rejectDetail && hasDetail) {
          const err = new Error("tasks.detail does not exist on this older database");
          err.code = "42703";
          throw err;
        }
        if (!state.rejectDetail) {
          assert.equal(hasDetail, true, "kit contents must be visible to the advisor as task detail");
        }
        const [orgId, clientId, title, body, , source, role, , , storedDetail] = params;
        const detail = hasDetail ? storedDetail : null;
        assert.equal(orgId, ORG);
        assert.equal(source, WELCOME_KIT_SOURCE);
        assert.equal(role, "funding_advisor");
        // Models the database UNIQUE (client_id, source_workflow, body) conflict.
        const existing = state.tasks.find((row) =>
          row.clientId === clientId && row.source === source && row.body === body
        );
        if (existing) return { rows: [] };
        const row = { id: `kit-task-${state.tasks.length + 1}`, clientId, title, source, body, detail };
        state.tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      throw new Error(`Unexpected welcome-kit SQL: ${sql.slice(0, 160)}`);
    }
  };
}

test("Blueprint paid welcome kit creates one advisor task with stable id and readable items", async () => {
  const db = fakeDb();
  const first = await createWelcomeKitTaskForPurchase(db, {
    orgId: ORG, clientId: CLIENT_A, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(first.created, true);
  assert.equal(db.state.tasks.length, 1);
  const task = db.state.tasks[0];
  assert.equal(task.body, `blueprint-welcome-kit:${CLIENT_A}`,
    "mutable funding snapshots must not be the unique task body");
  assert.equal(task.source, WELCOME_KIT_SOURCE);
  assert.equal(task.title, KIT_TITLE);
  for (const item of WELCOME_KIT_CHECKLIST) {
    assert.ok(task.detail.includes(item), `missing physical kit item ${item}`);
  }
  assert.match(task.detail, /\$200,000/);
});

test("a replay after the funding snapshot changes never schedules a second package", async () => {
  const db = fakeDb();
  await createWelcomeKitTaskForPurchase(db, {
    orgId: ORG, clientId: CLIENT_A, productCode: BLUEPRINT_PRODUCT_CODE
  });
  db.state.prequal = 350_000;
  const second = await createWelcomeKitTaskForPurchase(db, {
    orgId: ORG, clientId: CLIENT_A, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(second.created, false);
  assert.equal(second.reason, "duplicate_title");
  assert.equal(db.state.tasks.length, 1, "a changed snapshot created a second physical shipment");
  assert.match(db.state.tasks[0].detail, /\$200,000/,
    "existing package instructions should not silently change when reprocessed");
});

test("old JSON-body welcome-kit tasks are recognized on replay, without adding new ones", async () => {
  const db = fakeDb();
  db.state.tasks.push({
    id: "legacy-kit", clientId: CLIENT_A, source: WELCOME_KIT_SOURCE, title: KIT_TITLE,
    body: JSON.stringify({ kitChecklist: ["old"], fundingSnapshot: { prequalDisplay: "$200,000" } }),
    detail: null
  });
  db.state.prequal = 400_000;
  const second = await createWelcomeKitTaskForPurchase(db, {
    orgId: ORG, clientId: CLIENT_A, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.deepEqual(second, { created: false, id: "legacy-kit", reason: "duplicate_title" });
  assert.equal(db.state.tasks.length, 1);
});

test("a database missing tasks.detail still receives a stable, deduped welcome-kit task", async () => {
  const db = fakeDb();
  db.state.rejectDetail = true;
  const first = await createWelcomeKitTaskForPurchase(db, {
    orgId: ORG, clientId: CLIENT_A, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(first.created, true);
  assert.equal(db.state.tasks.length, 1);
  assert.equal(db.state.tasks[0].body, `blueprint-welcome-kit:${CLIENT_A}`);
  assert.equal(db.state.tasks[0].detail, null);
  db.state.prequal = 500_000;
  const replay = await createWelcomeKitTaskForPurchase(db, {
    orgId: ORG, clientId: CLIENT_A, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(replay.created, false);
  assert.equal(db.state.tasks.length, 1);
});

test("the dedupe key stays client-specific and non-Blueprint purchases create no kit", async () => {
  const db = fakeDb();
  for (const clientId of [CLIENT_A, CLIENT_B]) {
    const res = await createWelcomeKitTaskForPurchase(db, {
      orgId: ORG, clientId, productCode: BLUEPRINT_PRODUCT_CODE
    });
    assert.equal(res.created, true);
  }
  assert.equal(db.state.tasks.length, 2);
  assert.notEqual(db.state.tasks[0].body, db.state.tasks[1].body);
  const before = db.state.queries.length;
  const other = await createWelcomeKitTaskForPurchase(db, {
    orgId: ORG, clientId: CLIENT_A, productCode: "card-stacking-dfy"
  });
  assert.deepEqual(other, { created: false, reason: "not_blueprint_product" });
  assert.equal(db.state.queries.length, before, "unrelated products must not read or create a kit");
});
