// A settled/void/written-off invoice cannot become a new payment demand.
// No provider or messaging mock is needed because refusal precedes those calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emailInvoice } from "./notify.mjs";

function fakeInvoice(status) {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(String(sql));
      if (/FROM invoices i\s+JOIN clients c/.test(sql)) {
        return { rows: [{
          id: "00000000-0000-4000-8000-00000000a155",
          org_id: "00000000-0000-4000-8000-00000000a001",
          client_id: "00000000-0000-4000-8000-00000000a002",
          status, amount_due: 250, client_email: "invoice-test@example.invalid"
        }] };
      }
      throw new Error("invoice email reached an external or write path: " + sql);
    }
  };
  return { db, queries };
}

for (const [status, reason] of [
  ["draft", "not_issued"],
  ["paid", "already_paid"],
  ["void", "voided"],
  ["written_off", "written_off"],
  ["unrecognized", "not_collectible"]
]) {
  test(`invoice email refuses ${status} without a message row or provider request`, async () => {
    const { db, queries } = fakeInvoice(status);
    const result = await emailInvoice(db, {
      orgId: "00000000-0000-4000-8000-00000000a001",
      invoiceId: "00000000-0000-4000-8000-00000000a155",
      purpose: "manual-resend"
    });
    assert.deepEqual({ ok: result.ok, reason: result.reason }, { ok: false, reason });
    assert.equal(queries.length, 1, "refuse before destination lookup, message insert, or outbox drain");
  });
}

test("unknown invoice refuses before queuing any payment demand", async () => {
  const db = { query: async () => ({ rows: [] }) };
  const out = await emailInvoice(db, {
    orgId: "00000000-0000-4000-8000-00000000a001",
    invoiceId: "00000000-0000-4000-8000-00000000a155"
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "not_found");
});
