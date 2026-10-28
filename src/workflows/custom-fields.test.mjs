/* The saved next step is the screen's step (hole 12, round 3, 2026-09-18).
 *
 * Live on 2026-09-18: #8's panel said "Remove Inquiries" while its saved step
 * said "Pull CRS" — S-06 fired on a late deposit at 15:18 and saved its fixed
 * word over the top. Every job that saves employee_next_action goes through
 * mergeCustomFields, so that is where the fixed word is replaced.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCustomFields } from "./custom-fields.mjs";
import { handle as s06 } from "./s-06-post-call-funding-purchased.mjs";
import { pgFake, fakeStep, ev, withPanelReads } from "./test-support.mjs";

const OPEN_CASE = { client_id: "cl-8", case_status: "Queued", fraud_alert_after: null };
const eight = (cf = {}) => ({
  id: "cl-8", org_id: "org-1", email: "eight@example.com", outcome_tier: "FULL_FUNDING",
  tags: [], custom_fields: { crs_paid: true, employee_next_action: "Remove Inquiries", ...cf }
});

test("a saver's fixed word is replaced by the step the control panel shows", async () => {
  const inner = pgFake({ clients: [eight()] });
  const db = withPanelReads(inner, () => ({ realCrs: 1, inquiryCases: [OPEN_CASE] }));

  await mergeCustomFields(db, "cl-8", { employee_next_action: "Pull CRS" });

  assert.equal(inner.clients[0].custom_fields.employee_next_action, "Remove Inquiries",
    "the job's fixed word was saved over the screen's step");
});

test("S-06 on #8's shape: the late deposit no longer saves 'Pull CRS' over 'Remove Inquiries'", async () => {
  const inner = pgFake({ clients: [eight()] });
  const db = withPanelReads(inner, () => ({ realCrs: 1, inquiryCases: [OPEN_CASE] }));
  // A deposit event by itself is not proof that funding was purchased.
  // This test is about the saved next step AFTER a verified paid funding sale.
  const originalQuery = db.query.bind(db);
  db.query = async (sql, params) => {
    if (String(sql).includes("SELECT DISTINCT pr.category AS category")) {
      assert.deepEqual(params, ["org-1", "cl-8"]);
      return { rows: [{ category: "funding" }] };
    }
    return originalQuery(sql, params);
  };

  const res = await s06({ event: ev("deposit.paid", {}, { clientId: "cl-8" }), db, step: fakeStep() });

  assert.equal(res.done, true);
  const cf = inner.clients[0].custom_fields;
  assert.equal(cf.employee_next_action, "Remove Inquiries");
  assert.equal(cf.lifecycle_status, "Funding Client", "the rest of the job's write is untouched");
  assert.equal(cf.product_path, "Funding");
});

test("the step is worked out with the same write laid over the record", async () => {
  const inner = pgFake({ clients: [eight()] });
  const db = withPanelReads(inner, () => ({ realCrs: 1, inquiryCases: [OPEN_CASE] }));

  // A hold saved in the same write as a stale word: the hold decides the step.
  await mergeCustomFields(db, "cl-8", { round_hold_reason: "Fraud Alert", employee_next_action: "Pull CRS" });

  assert.equal(inner.clients[0].custom_fields.employee_next_action, "Clear Fraud Alert");
  assert.equal(inner.clients[0].custom_fields.round_hold_reason, "Fraud Alert");
});

test("when the screen's step cannot be worked out, the job's words are kept — never a blank", async () => {
  const inner = pgFake({ clients: [eight({ crs_paid: false })] });
  const db = withPanelReads(inner, () => ({ consent: "throws" }));

  await mergeCustomFields(db, "cl-8", { employee_next_action: "Collect Documents" });

  assert.equal(inner.clients[0].custom_fields.employee_next_action, "Collect Documents");
});

test("a write that does not set the step is one statement, exactly as before", async () => {
  const inner = pgFake({ clients: [eight()] });
  const seen = [];
  const db = { query: async (sql, params) => { seen.push(String(sql)); return inner.query(sql, params); } };

  await mergeCustomFields(db, "cl-8", { last_progress_action: "docs_uploaded" });

  assert.equal(seen.length, 1);
  assert.match(seen[0], /UPDATE clients SET custom_fields = custom_fields \|\| \$2::jsonb WHERE id = \$1/);
  assert.equal(inner.clients[0].custom_fields.last_progress_action, "docs_uploaded");
  assert.equal(inner.clients[0].custom_fields.employee_next_action, "Remove Inquiries");
});
