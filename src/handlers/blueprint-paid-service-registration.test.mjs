import assert from "node:assert/strict";
import test from "node:test";
import { ensureRegistered } from "../register-all.mjs";
import { getHandlers } from "../events/registry.mjs";
import { onBlueprintPaidServicePaymentReceived, onPaidServicePaymentReceived } from "./paid-service-payment.mjs";

test("normal boot registers one Blueprint payment listener without activating the legacy paid-round listener", async () => {
  ensureRegistered();
  ensureRegistered();
  const handlers = getHandlers("payment.received");
  assert.equal(handlers.filter(handler => handler === onBlueprintPaidServicePaymentReceived).length, 1);
  assert.ok(!handlers.includes(onPaidServicePaymentReceived));
  const orgId = "965da7a3-41ce-4d02-8fdc-c0a288d1878e";
  const clientId = "485a6bba-c045-4cd2-b122-61d4e308e246";
  const requestId = "ee51e21e-60db-4a99-ad8a-4620e24fd970";
  const event = {orgId, clientId, payload: { paidServiceRequestId: requestId, amountCents: 3200 }};
  const noQueries = {query: async () => assert.fail("an unscoped payment cannot read or mutate a paid request")};
  for (const item of [{orgId, clientId, payload:{}}, {...event,orgId:null}, {...event,clientId:null}]) {
    assert.equal((await onBlueprintPaidServicePaymentReceived(item, noQueries)).done, false);
  }
  let queries = 0;
  const legacy = {query: async sql => {
    assert.match(sql, /^SELECT \* FROM paid_service_requests/);
    queries++;
    return {rows: [{client_id:clientId,idempotency_key:"legacy-dispute-round",price_total_cents:3200}]};
  }};
  assert.equal((await onBlueprintPaidServicePaymentReceived(event, legacy)).done, false);
  assert.equal(queries,1);
});
