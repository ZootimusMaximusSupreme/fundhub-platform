import test from "node:test";
import assert from "node:assert/strict";
import { assignCsmForBlueprintPurchase, pickCsmStaffId } from "./assign-csm.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const CLIENT = "550e8400-e29b-41d4-a716-446655440000";
const CSM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CSM_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const CSM_DEMO = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

// A demo staff row is the seeded csm@demo.fundhub.local account
// (db/migrations/290_csm_role.sql, is_demo = true). The mock only drops demo
// rows when the SQL the picker sent really carries the is_demo filter, so a
// picker that forgets the filter hands the demo row back, exactly like the
// real database would.
const DEMO_FILTER = /COALESCE\(\s*s\.is_demo\s*,\s*false\s*\)\s*=\s*false/i;

function mockDb(state) {
  return {
    async query(sql, params) {
      if (/FROM staff s/i.test(sql)) {
        (state.staffQueries ||= []).push(sql);
        const rows = state.csmRows || [];
        return { rows: DEMO_FILTER.test(sql) ? rows.filter((r) => r.is_demo !== true) : rows };
      }
      if (/SELECT/i.test(sql) && /assigned_csm_staff_id/i.test(sql) && /FROM clients/i.test(sql)) {
        return { rows: [{ assigned_csm_staff_id: state.assigned || null }] };
      }
      if (/UPDATE clients/i.test(sql) && /assigned_csm_staff_id/i.test(sql)) {
        if (state.assigned) return { rows: [] };
        state.assigned = params[2];
        return { rows: [{ assigned_csm_staff_id: state.assigned }] };
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

test("pickCsmStaffId never picks a demo staff row", async () => {
  // The demo CSM sorts first (fewest clients, oldest row). A real CSM exists.
  const state = { csmRows: [{ id: CSM_DEMO, is_demo: true }, { id: CSM_A, is_demo: false }] };
  const id = await pickCsmStaffId(mockDb(state), { orgId: ORG });
  assert.equal(id, CSM_A);
  assert.notEqual(id, CSM_DEMO);
});

test("pickCsmStaffId asks the database to leave demo staff out", async () => {
  const state = { csmRows: [{ id: CSM_A }] };
  await pickCsmStaffId(mockDb(state), { orgId: ORG });
  assert.equal(state.staffQueries.length, 1);
  assert.match(state.staffQueries[0], DEMO_FILTER);
});

test("pickCsmStaffId returns null when only a demo CSM exists", async () => {
  const state = { csmRows: [{ id: CSM_DEMO, is_demo: true }] };
  assert.equal(await pickCsmStaffId(mockDb(state), { orgId: ORG }), null);
});

test("a Blueprint purchase with only a demo CSM assigns nobody and says why", async () => {
  const state = { csmRows: [{ id: CSM_DEMO, is_demo: true }] };
  const out = await assignCsmForBlueprintPurchase(mockDb(state), {
    orgId: ORG, clientId: CLIENT, productCode: BLUEPRINT_PRODUCT_CODE
  });
  assert.equal(out.assigned, false);
  assert.equal(out.reason, "no_active_csm");
  assert.equal(state.assigned, undefined, "the client must stay unassigned, never on the demo row");
});
