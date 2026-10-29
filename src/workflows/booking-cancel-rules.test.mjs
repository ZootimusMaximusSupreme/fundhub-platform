// The shared 15-minute reminder and no-show scheduler must never stop a job
// because another organization's customer reuses an email or provider UID.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CANCEL_RULES, RESCHEDULE_CANCEL_RULES } from "./booking-cancel-rules.mjs";

test("shared booking cancellation rules require a non-null matching organization", () => {
  const groups = [
    ["booking.cancelled", CANCEL_RULES],
    ["booking.rescheduled", RESCHEDULE_CANCEL_RULES]
  ];
  for (const [eventName, rules] of groups) {
    assert.equal(rules.length, 2);
    assert.ok(rules.every((rule) => rule.event === eventName));
    for (const rule of rules) {
      assert.match(rule.if, /event\.data\.orgId != null/);
      assert.match(rule.if, /event\.data\.orgId == async\.data\.orgId/);
      assert.match(rule.if, /event\.data\.payload\.(email|bookingUid)/);
    }
  }
  assert.ok(RESCHEDULE_CANCEL_RULES.every((r) => r.if.includes("startTime !=")),
    "reschedule must cancel old time, not the run started at the new time");
});
