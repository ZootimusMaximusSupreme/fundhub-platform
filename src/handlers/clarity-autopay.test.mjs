// payment.received → clarity autopay: which payments are handed over, and how.
// The rule and the write are tested in src/finance/clarity-autopay.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { onPaymentReceivedForClarity, register } from "./clarity-autopay.mjs";
import { getHandlers, clearHandlers } from "../events/registry.mjs";
import { registerAll, _resetRegistered } from "../register-all.mjs";
import { SETUP_PURPOSE, SETUP_DESCRIPTION } from "../finance/money-setup.mjs";

const CLIENT = "f1cb0000-0000-4000-8000-000000000001";
const ev = (payload, clientId = CLIENT) => ({ id: "ev-1", name: "payment.received", orgId: "org-1", clientId, payload });
const base = { source: "commas", paymentId: "pay_1", amount: 150, product: "unmatched", purpose: null };

function spyApply() {
  const calls = [];
  const fn = async (_db, args) => { calls.push(args); return { outcome: "applied" }; };
  fn.calls = calls;
  return fn;
}
const noDb = { query: async () => { throw new Error("no read expected"); } };

test("a Commas payment with a client is handed over in integer cents with its keys", async () => {
  const apply = spyApply();
  await onPaymentReceivedForClarity(ev({ ...base, amount: 150.1, invoiceId: "inv-1", paymentLinkId: null }), noDb, { apply });
  assert.deepEqual(apply.calls[0], {
    orgId: "org-1", clientId: CLIENT, paymentId: "pay_1", amountCents: 15010, invoiceId: "inv-1", paymentLinkId: null
  });
});

test("not Commas, no payment id, or no client → nothing", async () => {
  const apply = spyApply();
  assert.equal((await onPaymentReceivedForClarity(ev({ ...base, source: "clickfunnels" }), noDb, { apply })).reason, "not_commas");
  assert.equal((await onPaymentReceivedForClarity(ev({ ...base, paymentId: null }), noDb, { apply })).reason, "no_payment_id");
  assert.equal((await onPaymentReceivedForClarity(ev(base, null), noDb, { apply })).reason, "no_client");
  assert.equal(apply.calls.length, 0);
});

test("a known product or a product link is not a plan payment", async () => {
  const apply = spyApply();
  assert.equal((await onPaymentReceivedForClarity(ev({ ...base, product: "crs" }), noDb, { apply })).reason, "product:crs");
  assert.equal((await onPaymentReceivedForClarity(ev({ ...base, purpose: "deposit", product: "deposit" }), noDb, { apply })).reason, "product:deposit");
  assert.equal((await onPaymentReceivedForClarity(ev({ ...base, purpose: "repair" }), noDb, { apply })).reason, "link_purpose:repair");
  assert.equal(apply.calls.length, 0);
});

test("the FinanceOS setup-fee link is skipped; any other custom link goes through", async () => {
  const apply = spyApply();
  const db = (row) => ({ query: async (sql) => (/FROM payment_links WHERE id/.test(sql) ? { rows: row ? [row] : [] } : { rows: [] }) });
  const setupRow = { purpose: SETUP_PURPOSE, description: SETUP_DESCRIPTION };
  assert.equal((await onPaymentReceivedForClarity(ev({ ...base, purpose: "custom", paymentLinkId: "l1" }), db(setupRow), { apply })).reason, "financeos_setup_link");
  await onPaymentReceivedForClarity(ev({ ...base, purpose: "custom", paymentLinkId: "l2" }), db({ purpose: "custom", description: "BNPL payment 2" }), { apply });
  assert.equal(apply.calls.length, 1);
});

test("an amount that is not a number is unknown (null), never guessed", async () => {
  const apply = spyApply();
  await onPaymentReceivedForClarity(ev({ ...base, amount: "abc" }), noDb, { apply });
  assert.equal(apply.calls[0].amountCents, null);
});

test("registered on payment.received, once, by the boot wiring", () => {
  clearHandlers();
  _resetRegistered();
  registerAll();
  assert.equal(getHandlers("payment.received").filter((f) => f === onPaymentReceivedForClarity).length, 1);
  register();
  assert.equal(getHandlers("payment.received").filter((f) => f === onPaymentReceivedForClarity).length, 1);
  clearHandlers();
  _resetRegistered();
});
