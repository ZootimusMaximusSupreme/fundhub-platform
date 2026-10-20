import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LINKS_PER_SWEEP,
  SWEEP_CRON,
  sweepInvoiceCheckoutRetirement
} from "./invoice-checkout-retirement-sweeper.mjs";

const candidate = (id, over = {}) => ({ id, org_id: "org-1", invoice_id: "inv-1",
  provider: "commas", source: "funding_success_fee", status: "expired", ...over });

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT pl.id, pl.org_id, pl.invoice_id/.test(sql)) {
        assert.match(sql, /pl.provider = 'commas'/);
        assert.match(sql, /pl.status = 'expired'/);
        assert.match(sql, /i.source = 'funding_success_fee' OR i.invoice_type = 'success_fee'/);
        return { rows: rows.filter((row) => row.provider === "commas" && row.status === "expired" &&
          row.source === "funding_success_fee").slice(0, params[0]) };
      }
      if (/SET provider_retire_last_error =/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
    }
  };
}

test("30-minute recovery is capped and never touches non-fee or Whop rows", async () => {
  assert.equal(SWEEP_CRON, "*/30 * * * *");
  const rows = [candidate("not-whop", { provider: "whop" }), candidate("not-fee", { source: "deposit" }),
    ...Array.from({ length: 10 }, (_, index) => candidate(`link-${index}`))];
  const db = fakeDb(rows);
  const retired = [];
  const result = await sweepInvoiceCheckoutRetirement(db, {
    limit: 999,
    retireLink: async (_db, args) => retired.push(args.linkId)
  });
  assert.equal(result.scanned, MAX_LINKS_PER_SWEEP);
  assert.deepEqual(retired, ["link-0", "link-1", "link-2", "link-3"]);
  assert.deepEqual(db.calls[0].params, [MAX_LINKS_PER_SWEEP]);
});

test("zero eligible rows makes no provider call", async () => {
  const db = fakeDb([candidate("whop", { provider: "whop" })]);
  let called = 0;
  const result = await sweepInvoiceCheckoutRetirement(db, {
    retireLink: async () => { called++; }
  });
  assert.deepEqual(result, { scanned: 0, retired: 0, failed: 0 });
  assert.equal(called, 0);
});

test("failed deactivation remains expired and the next sweep can retry", async () => {
  const db = fakeDb([candidate("link-1")]);
  let calls = 0;
  await assert.rejects(sweepInvoiceCheckoutRetirement(db, {
    retireLink: async () => { calls++; throw new Error("Commas DELETE 503"); }
  }), /retirement attempts failed/);
  const failureWrite = db.calls.find((call) => /SET provider_retire_last_error =/.test(call.sql));
  assert.ok(failureWrite);
  assert.match(failureWrite.params[3], /Commas DELETE 503/);
  const recovered = await sweepInvoiceCheckoutRetirement(db, {
    retireLink: async () => { calls++; }
  });
  assert.equal(recovered.retired, 1);
  assert.equal(calls, 2);
});
