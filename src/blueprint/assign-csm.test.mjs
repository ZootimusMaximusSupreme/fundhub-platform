import test from "node:test";
import assert from "node:assert/strict";
import { assignCsmForBlueprintPurchase, pickCsmStaffId } from "./assign-csm.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";
const CSM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CSM_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

function mockDb(state) {
  return {
    async query(sql, params) {
      if (/^\s*SELECT/i.test(sql) && /FROM staff s/i.test(sql)) {
        assert.match(sql, /s\.active = true/);
        assert.match(sql, /s\.is_demo = false/);
        assert.match(sql, /s\.status = 'active'/);
        return { rows: state.csmRows || [] };
      }
      if (/SELECT/i.test(sql) && /assigned_csm_staff_id/i.test(sql) && /FROM clients/i.test(sql)) {
        return { rows: [{ assigned_csm_staff_id: state.assigned || null,
          real_csm_staff_id: state.invalidAssignment ? null : state.assigned || null }] };
      }
      if (/UPDATE clients/i.test(sql) && /assigned_csm_staff_id/i.test(sql)) {
        if (state.assigned) return { rows: [] };
        state.assigned = params[2];
        return { rows: [{ assigned_csm_staff_id: state.assigned }] };
      }
      if (/SELECT id FROM tasks/.test(sql)) return { rows: state.exception ? [{ id: state.exception.id }] : [] };
      if (/INSERT INTO tasks/.test(sql)) {
        assert.equal(params[6], "owner");
        state.exception = { id: "owner-exception", orgId: params[0], clientId: params[1], title: params[2], key: params[3], done: false };
        state.taskWrites = (state.taskWrites || 0) + 1;
        return { rows: [{ id: state.exception.id }] };
      }
      if (/UPDATE tasks SET done = false/.test(sql)) {
        state.exception.done = false;
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
}

test("assignCsmForBlueprintPurchase skips non-blueprint products", async () => {
  const db = mockDb({});
  const out = await assignCsmForBlueprintPurchase(db, {
    orgId: ORG, clientId: CLIENT, productCode: "not-a-product"
  });
  assert.equal(out.reason, "not_blueprint_product");
});

test("no eligible real advisor creates one deduped owner exception and never assigns a substitute", async () => {
  const state = { csmRows: [] };
  const db = mockDb(state);
  const input = { orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE };
  const first = await assignCsmForBlueprintPurchase(db, input);
  assert.equal(first.assigned, false);
  assert.equal(first.reason, "no_active_csm");
  assert.equal(first.exceptionTask.created, true);
  assert.equal(state.exception.orgId, ORG);
  assert.equal(state.exception.clientId, CLIENT);
  assert.equal(state.assigned, undefined);
  state.exception.done = true;
  const again = await assignCsmForBlueprintPurchase(db, input);
  assert.equal(again.exceptionTask.created, false);
  assert.equal(state.taskWrites, 1);
  assert.equal(state.exception.done, false, "a recurring shortage reopens its owner task");
});

test("an existing unavailable advisor remains saved but is reported to the owner", async () => {
  const state = { assigned: CSM_A, invalidAssignment: true, csmRows: [{ id: CSM_B }] };
  const out = await assignCsmForBlueprintPurchase(mockDb(state), {
    orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(out.assigned, false);
  assert.equal(out.reason, "assignment_unavailable");
  assert.equal(state.assigned, CSM_A, "do not silently reassign an existing client");
  assert.equal(state.exception.clientId, CLIENT);
});

test("an owner exception write failure stays visible to the purchase caller", async () => {
  const base = mockDb({ csmRows: [] });
  const db = { async query(sql, params) {
    if (/INSERT INTO tasks/.test(sql)) throw new Error("owner queue unavailable");
    return base.query(sql, params);
  } };
  await assert.rejects(assignCsmForBlueprintPurchase(db, {
    orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE
  }), /owner queue unavailable/);
});

test("an unavailable advisor saved during assignment still creates owner work", async () => {
  const state = { csmRows: [{ id: CSM_A }] };
  const base = mockDb(state);
  const db = { async query(sql, params) {
    if (/UPDATE clients/.test(sql)) {
      state.assigned = CSM_B;
      state.invalidAssignment = true;
      return { rows: [] };
    }
    return base.query(sql, params);
  } };
  const out = await assignCsmForBlueprintPurchase(db, {
    orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(out.assigned, false);
  assert.equal(out.reason, "advisor_unavailable");
  assert.equal(state.assigned, CSM_B);
  assert.equal(state.exception.clientId, CLIENT);
});

test("assignCsmForBlueprintPurchase picks CSM with fewest clients", async () => {
  const db = mockDb({
    csmRows: [{ id: CSM_B }, { id: CSM_A }]
  });
  const id = await pickCsmStaffId(db, { orgId: ORG });
  assert.equal(id, CSM_B);
});

test("assignCsmForBlueprintPurchase writes once", async () => {
  const state = { csmRows: [{ id: CSM_A }] };
  const db = mockDb(state);
  const first = await assignCsmForBlueprintPurchase(db, {
    orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(first.assigned, true);
  assert.equal(first.staffId, CSM_A);
  const second = await assignCsmForBlueprintPurchase(db, {
    orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(second.reason, "already_assigned");
});
