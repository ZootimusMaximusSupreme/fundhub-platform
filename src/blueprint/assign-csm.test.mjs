import test from "node:test";
import assert from "node:assert/strict";
import { assignCsmForBlueprintPurchase, pickCsmStaffId, BLUEPRINT_CSM_AUTO_ASSIGN } from "./assign-csm.mjs";
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

test("owner-set 2026-10-20: the auto-assign switch is off, so the AI coaches and team CSM queue are the CSM", () => {
  assert.equal(BLUEPRINT_CSM_AUTO_ASSIGN, false);
});

test("a buyer with zero real CSMs gets reason ai_csm, no owner exception task and no substitute", async () => {
  const state = { csmRows: [] };
  const input = { orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE };
  for (const autoAssign of [undefined, true]) {
    const out = await assignCsmForBlueprintPurchase(mockDb(state), { ...input, autoAssign });
    assert.equal(out.assigned, false);
    assert.equal(out.reason, "ai_csm");
    assert.equal(out.exceptionTask, undefined);
  }
  assert.equal(state.assigned, undefined);
  assert.equal(state.taskWrites, undefined, "no 'assign a real advisor' owner task per buyer");
});

test("an active non-demo CSM row (the Elena Brooks test login shape) is never auto-assigned while the switch is off", async () => {
  const state = { csmRows: [{ id: CSM_A }] };
  let staffReads = 0;
  const base = mockDb(state);
  const db = { async query(sql, params) {
    if (/FROM staff s/i.test(sql) && /^\s*SELECT/i.test(sql)) staffReads += 1;
    return base.query(sql, params);
  } };
  const out = await assignCsmForBlueprintPurchase(db, {
    orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.deepEqual(out, { assigned: false, reason: "ai_csm" });
  assert.equal(state.assigned, undefined, "nobody is linked to the buyer");
  assert.equal(staffReads, 0, "the picker is not even consulted");
  assert.equal(state.taskWrites, undefined);
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
  const base = mockDb({ assigned: CSM_A, invalidAssignment: true, csmRows: [] });
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
    orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE, autoAssign: true
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

test("with the owner switch on, assignCsmForBlueprintPurchase writes once", async () => {
  const state = { csmRows: [{ id: CSM_A }] };
  const db = mockDb(state);
  const first = await assignCsmForBlueprintPurchase(db, {
    orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE, autoAssign: true
  });
  assert.equal(first.assigned, true);
  assert.equal(first.staffId, CSM_A);
  const second = await assignCsmForBlueprintPurchase(db, {
    orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(second.reason, "already_assigned");
});
