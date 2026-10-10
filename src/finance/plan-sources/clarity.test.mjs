// Payments owed to Fundhub as plan pins. The plan views are built with the same
// planView() the read uses, from rows shaped like the FinanceOS test client's two
// real plans (read only, 2026-10-07): a $1,500 Clarity Payment in 3 (payment 2
// late) and a $600 BNPL plan in 4 (payment 2 paid early).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildClarityPins, name } from "./clarity.mjs";
import { planView } from "../clarity-payments.mjs";

const TODAY = "2026-10-07";
const CLARITY = planView({ id: "p1", kind: "clarity", owed_to: "Fundhub LLC", label: null, original_cents: "150000", status: "open" }, [
  { id: "i1", seq: 1, due_on: "2026-09-03", amount_cents: "50000", paid_cents: "50000", paid_at: "2026-09-03T17:00:00.000Z" },
  { id: "i2", seq: 2, due_on: "2026-10-03", amount_cents: "50000", paid_cents: "0", paid_at: null },
  { id: "i3", seq: 3, due_on: "2026-11-03", amount_cents: "50000", paid_cents: "0", paid_at: null }
], TODAY);
const BNPL = planView({ id: "p2", kind: "bnpl", owed_to: "Fundhub LLC", label: null, original_cents: "60000", status: "open" }, [
  { id: "j1", seq: 1, due_on: "2026-09-16", amount_cents: "15000", paid_cents: "15000", paid_at: "2026-09-16T17:00:00.000Z" },
  { id: "j2", seq: 2, due_on: "2026-10-16", amount_cents: "15000", paid_cents: "15000", paid_at: "2026-10-07T01:26:56.202Z" },
  { id: "j3", seq: 3, due_on: "2026-11-15", amount_cents: "15000", paid_cents: "0", paid_at: null },
  { id: "j4", seq: 4, due_on: "2026-12-15", amount_cents: "15000", paid_cents: "0", paid_at: null }
], TODAY);
const OCT = { from: "2026-10-01", to: "2026-10-31" };

describe("buildClarityPins", () => {
  test("October: the late payment is missed, the early one is done", () => {
    const pins = buildClarityPins([CLARITY, BNPL], OCT);
    assert.deepEqual(pins.map((p) => `${p.date} ${p.status} ${p.amount_cents}`), [
      "2026-10-03 missed 50000",
      "2026-10-16 done 15000"
    ]);
    const late = pins[0];
    assert.equal(late.title, "Fundhub payment plan: payment 2 of 3");
    assert.equal(late.detail, "Owed to Fundhub LLC. 4 days late.");
    assert.equal(late.id, "clarity:i2");
    const paid = pins[1];
    assert.equal(paid.title, "Buy now, pay later plan with Fundhub LLC: payment 2 of 4");
    assert.equal(paid.detail, "Paid on Oct 7.");
  });

  test("November: both payments still to come are planned, with what is left", () => {
    const pins = buildClarityPins([CLARITY, BNPL], { from: "2026-11-01", to: "2026-11-30" });
    assert.deepEqual(pins.map((p) => `${p.date} ${p.status} ${p.amount_cents} ${p.detail}`), [
      "2026-11-03 planned 50000 Owed to Fundhub LLC.",
      "2026-11-15 planned 15000 Owed to Fundhub LLC."
    ]);
  });

  test("a part-paid installment shows what is left and says what was paid", () => {
    const plan = planView({ id: "p3", kind: "clarity", owed_to: "Fundhub LLC", original_cents: "50000", status: "open" }, [
      { id: "k1", seq: 1, due_on: "2026-10-20", amount_cents: "50000", paid_cents: "20000", paid_at: null }
    ], TODAY);
    const [p] = buildClarityPins([plan], OCT);
    assert.equal(p.amount_cents, 30000);
    assert.equal(p.status, "planned");
    assert.equal(p.detail, "Owed to Fundhub LLC. $200.00 paid so far.");
  });

  test("a settled plan keeps only what was paid; a cancelled plan is not a date", () => {
    const settled = planView({ id: "p4", kind: "bnpl", owed_to: "Fundhub LLC", original_cents: "30000", status: "settled", settled_at: "2026-10-05T00:00:00Z" }, [
      { id: "m1", seq: 1, due_on: "2026-10-02", amount_cents: "15000", paid_cents: "15000", paid_at: "2026-10-02T00:00:00Z" },
      { id: "m2", seq: 2, due_on: "2026-10-30", amount_cents: "15000", paid_cents: "0", paid_at: null }
    ], TODAY);
    assert.deepEqual(buildClarityPins([settled], OCT).map((p) => `${p.id} ${p.status}`), ["clarity:m1 done"]);
    const cancelled = { ...CLARITY, status: "cancelled" };
    assert.deepEqual(buildClarityPins([cancelled], OCT), []);
  });

  test("every pin is kind due, from this source, with no bank, no container and no mark", () => {
    for (const p of buildClarityPins([CLARITY, BNPL], { from: "2026-09-01", to: "2026-12-31" })) {
      assert.equal(p.kind, "due");
      assert.equal(p.source, name);
      assert.equal(p.bank, null);
      assert.equal(p.container_id, null);
      assert.deepEqual(p.can_mark, []);
    }
  });

  test("a bad window gives nothing", () => {
    assert.deepEqual(buildClarityPins([CLARITY], { from: "", to: "2026-10-31" }), []);
  });
});
