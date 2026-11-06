// A cleared Fundhub payment can trigger internal fulfillment, never Meta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerAll } from "../register-all.mjs";
import { getHandlers } from "../events/registry.mjs";
import { sendMetaEvents } from "../messaging/providers/meta-capi.mjs";

test("none of the four real money-event registrations publishes Meta conversions", () => {
  registerAll();
  for (const event of ["payment.received", "diagnostic.paid", "deposit.paid", "sale.closed"]) {
    assert.ok(getHandlers(event).length > 0, event);
    assert.equal(getHandlers(event).some(fn => /meta.?purchase|onMoneyEventForMeta/i.test(fn.name)), false, event);
  }
});

test("stale financial senders cannot send a credit purchase under a transaction id or a UUID", async () => {
  let calls = 0;
  const result = await sendMetaEvents(["purchase.slo_foo", "11111111-1111-4000-8000-111111111111"].map(event_id => ({
    event_name: "Purchase", event_id, event_source_url: "https://apply.fundhub.ai/roadmap",
    action_source: "website", custom_data: { value: 147, content_name: "SOFT_PULL" }
  })), { env: { META_CAPI_ENABLED: "1", ADAPTERS_DRY_RUN: "0" }, fetchImpl: () => { calls++; } });
  assert.equal(calls, 0);
  assert.deepEqual(result, { ok: true, sent: 0, skipped: "no_events" });
});
