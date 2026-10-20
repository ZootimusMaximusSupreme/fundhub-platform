// 492 / owner-set 2026-10-20: an affiliate is paid as soon as the client's
// money clears. A payout ready to send for over a day is a break the hourly
// partner beat names. Both directions, so the rule cannot silently go dead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toAffiliateRow } from "./trip-partner-truth.mjs";

const base = { name: "Rail Tester", status: "active", applied_at: "2026-10-01T00:00:00Z", tracking_id: "AFF-1",
  license_ok: true, tax_ok: true, converted_n: 1, rated_n: 1, unrated_n: 0, payable_usd: 0 };

test("a payout ready over a day and not sent is a payout_paid defect", () => {
  const row = toAffiliateRow({ ...base, waiting_n: 1 });
  const d = row.defects.find((x) => x.key === "payout_paid");
  assert.ok(d, "no defect raised");
  assert.match(d.why, /1 payout ready to send for over a day and not sent/);
});

test("no waiting payout raises no payout defect", () => {
  const row = toAffiliateRow({ ...base, waiting_n: 0 });
  assert.equal(row.defects.filter((x) => x.key === "payout_paid").length, 0);
});

test("a held payout is named first, not as waiting", () => {
  const row = toAffiliateRow({ ...base, held_n: 1, waiting_n: 1, tax_ok: false });
  const d = row.defects.find((x) => x.key === "payout_paid");
  assert.match(d.why, /on hold/);
});
