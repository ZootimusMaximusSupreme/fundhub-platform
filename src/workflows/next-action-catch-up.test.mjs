/* The next-step catch-up (hole 12, round 3, 2026-09-18).
 *
 * Every five minutes it works the control panel's step out again for every
 * file holding a saved step, and saves it only when it differs. These tests
 * pin the four promises in its header: it corrects drift, it leaves a match
 * alone, it touches one key and nothing else, and it sends nothing.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  catchUp, handle, nextActionCatchUp, CATCH_UP_CRON, CATCH_UP_BATCH
} from "./next-action-catch-up.mjs";
import { functions } from "./index.mjs";
import { inngest } from "./client.mjs";
import { withPanelReads } from "./test-support.mjs";

const OPEN_CASE = (id) => ({ client_id: id, case_status: "Queued", fraud_alert_after: null });
const APPLY_NOW = { pipeline_key: "funding_card_stacking", stage_key: "apply_now" };

/* A clients table that answers the catch-up's own three statements, and
   records every statement it is sent. */
function clientsTable(clients) {
  const seen = [];
  const blank = (v) => v == null || String(v).trim() === "";
  const withStep = () => clients.filter((c) => !blank(c.custom_fields?.employee_next_action));
  return {
    clients,
    seen,
    async query(sql, params = []) {
      const text = String(sql);
      seen.push({ text, params });
      if (/SELECT count\(\*\)::int AS n/.test(text)) return { rows: [{ n: withStep().length }] };
      if (/LIMIT \$1 OFFSET \$2/.test(text)) {
        const rows = withStep()
          .slice()
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(params[1], params[1] + params[0])
          .map((c) => ({ id: c.id, saved: c.custom_fields.employee_next_action }));
        return { rows };
      }
      if (/jsonb_build_object/.test(text)) {
        const c = clients.find((x) => x.id === params[0]);
        if (!c || c.custom_fields?.employee_next_action !== params[2]) return { rows: [] };
        c.custom_fields = { ...c.custom_fields, employee_next_action: params[1] };
        return { rows: [{ id: c.id }] };
      }
      return { rows: [] };
    }
  };
}

const file = (id, saved, cf = {}) => ({
  id, org_id: "org-1", outcome_tier: "FULL_FUNDING", tags: [],
  custom_fields: { crs_paid: true, ...(saved === undefined ? {} : { employee_next_action: saved }), ...cf }
});

/* #8 and #11 as they stood live at 15:56 UTC on 2026-09-18. */
const PANEL = {
  "id-08": { realCrs: 1, inquiryCases: [OPEN_CASE("id-08")] },            // panel: Remove Inquiries
  "id-11": { realCrs: 1, card: APPLY_NOW },                                // panel: Apply for Funding
  "id-99": { consent: "throws" }                                           // panel: not worked out
};
const panelFor = (id) => PANEL[id] || { realCrs: 1, card: APPLY_NOW };

/* Nothing may leave: no event, no fetch. */
let sent;
let realSend;
let realFetch;
before(() => {
  realSend = inngest.send;
  realFetch = globalThis.fetch;
  inngest.send = async (...a) => { sent.push(["inngest.send", a]); return { ids: [] }; };
  globalThis.fetch = async (...a) => { sent.push(["fetch", a]); throw new Error("no network in this test"); };
});
after(() => { inngest.send = realSend; globalThis.fetch = realFetch; });

test("corrects a drifted saved step and leaves a matching one alone", async () => {
  sent = [];
  const table = clientsTable([file("id-08", "Pull CRS"), file("id-11", "Apply for Funding")]);
  const db = withPanelReads(table, panelFor);

  const out = await catchUp(db);

  assert.equal(out.ok, true);
  assert.equal(table.clients[0].custom_fields.employee_next_action, "Remove Inquiries", "#8 was not put back in line");
  assert.equal(table.clients[1].custom_fields.employee_next_action, "Apply for Funding");
  assert.equal(out.corrected, 1);
  assert.equal(out.same, 1);
  assert.deepEqual(out.changes, [{ client_id: "id-08", from: "Pull CRS", to: "Remove Inquiries" }]);
  const writes = table.seen.filter((s) => /\bUPDATE\b/i.test(s.text));
  assert.equal(writes.length, 1, "a file already in line must not be written at all");
  assert.equal(writes[0].params[0], "id-08");
});

test("touches one key and nothing else, and never a file without a saved step", async () => {
  sent = [];
  const table = clientsTable([
    file("id-08", "Pull CRS", { lifecycle_status: "Funding Client", round_hold_reason: "New Inquiries" }),
    file("id-20", undefined, { lifecycle_status: "Lead" }),
    file("id-21", "   ")
  ]);
  const before08 = { ...table.clients[0].custom_fields };
  const before20 = JSON.stringify(table.clients[1]);
  const before21 = JSON.stringify(table.clients[2]);

  await catchUp(withPanelReads(table, panelFor));

  const after08 = table.clients[0].custom_fields;
  assert.deepEqual({ ...after08, employee_next_action: before08.employee_next_action }, before08,
    "a key other than employee_next_action changed");
  assert.equal(JSON.stringify(table.clients[1]), before20, "a file with no saved step was touched");
  assert.equal(JSON.stringify(table.clients[2]), before21, "a blank saved step is not a saved step");
  const write = table.seen.find((s) => /\bUPDATE\b/i.test(s.text));
  assert.match(write.text, /custom_fields \|\| jsonb_build_object\('employee_next_action', \$2::text\)/);
  assert.match(write.text, /custom_fields->>'employee_next_action' = \$3/,
    "the write must only land if the saved words are still the ones read");
});

test("when the panel cannot work the step out, the saved words stay — never a blank", async () => {
  sent = [];
  const table = clientsTable([file("id-99", "Collect Documents", { crs_paid: false })]);

  const out = await catchUp(withPanelReads(table, panelFor));

  assert.equal(table.clients[0].custom_fields.employee_next_action, "Collect Documents");
  assert.equal(out.kept, 1);
  assert.equal(out.corrected, 0);
});

test("a job that saved in between is not overwritten with an older answer", async () => {
  sent = [];
  const table = clientsTable([file("id-08", "Pull CRS")]);
  const db = withPanelReads(table, panelFor);
  const query = db.query;
  db.query = async (sql, params) => {
    if (/jsonb_build_object/.test(String(sql))) table.clients[0].custom_fields.employee_next_action = "Clear Fraud Alert";
    return query(sql, params);
  };

  const out = await catchUp(db);

  assert.equal(table.clients[0].custom_fields.employee_next_action, "Clear Fraud Alert");
  assert.equal(out.raced, 1);
  assert.equal(out.corrected, 0);
});

test("sends nothing: no message, no event, no task, no network", async () => {
  sent = [];
  const table = clientsTable([file("id-08", "Pull CRS"), file("id-11", "Collect Documents"), file("id-99", "Pull CRS")]);

  await catchUp(withPanelReads(table, panelFor));

  assert.deepEqual(sent, [], "something tried to leave: " + JSON.stringify(sent));
  for (const { text } of table.seen) {
    assert.doesNotMatch(text, /\b(INSERT|DELETE)\b/i, text);
    assert.doesNotMatch(text, /\b(messages|events|tasks|cards)\b\s*(\(|SET)/i, text);
    if (/\bUPDATE\b/i.test(text)) assert.match(text, /^\s*UPDATE clients\b/, text);
  }
});

test("bounded: one pass looks at one page, and the pages turn with the clock", async () => {
  sent = [];
  const ids = ["id-a", "id-b", "id-c", "id-d", "id-e"];
  const table = clientsTable(ids.map((id) => file(id, "Collect Documents")));
  const db = withPanelReads(table, panelFor);
  const SLOT = 5 * 60 * 1000;

  const checked = [];
  for (let slot = 0; slot < 3; slot++) {
    const out = await catchUp(db, { limit: 2, now: slot * SLOT });
    assert.ok(out.checked <= 2, "a pass looked at more than its batch");
    checked.push(...out.changes.map((c) => c.client_id));
  }
  assert.deepEqual(checked.sort(), ids, "three passes of two must reach all five files");
  assert.ok(table.clients.every((c) => c.custom_fields.employee_next_action === "Apply for Funding"));
  assert.ok(CATCH_UP_BATCH > 0 && CATCH_UP_BATCH <= 200);
});

test("never throws: a broken database is an answer, not a crash", async () => {
  const broken = { query: async () => { throw new Error("connection reset"); } };
  const out = await catchUp(broken);
  assert.equal(out.ok, false);
  assert.match(out.error, /connection reset/);

  const empty = await catchUp(clientsTable([]));
  assert.equal(empty.ok, true);
  assert.equal(empty.checked, 0);
});

test("registered hourly, and callable the way the journey runner calls it", async () => {
  assert.equal(CATCH_UP_CRON, "5 * * * *");
  assert.ok(functions.includes(nextActionCatchUp), "nextActionCatchUp is not in src/workflows/index.mjs");
  assert.equal(nextActionCatchUp.id(), "next-action-catch-up");
  const steps = [];
  const out = await handle({ db: clientsTable([]), step: { run: (id, fn) => { steps.push(id); return fn(); } } });
  assert.equal(out.ok, true);
  assert.deepEqual(steps, ["catch-up"]);
});
