// Practice test for the server half of the Repair queue and Repair row: GET /api/read/repair-cases, the
// REAL handler and the REAL list and file builders (src/repair/cases.mjs), with the database answered by
// stand-in rows. Three things the older repair read tests do not pin, each of which would put a wrong
// word on the desk:
//
//   * the need-me flag follows the STAGE (letters made, ready to send, answer in, stuck), so the queue's
//     "Needs" tiles and its need-me-first order have something to stand on;
//   * the Due the queue shows is the file's EARLIEST open due time (the statement says MIN), not the latest;
//   * a letter's words come back only while it is still sendable (generated or ready). A letter already
//     sent or delivered carries no body, so the expanded row can never offer to send it again.
// Plus what the expanded row reads is read for this company and this client only.

import assert from "node:assert/strict";
import test from "node:test";

import handler from "../../../../api/read/repair-cases.mjs";
import { callShared } from "../../../testing/s3-handler-call.mjs";
import { ORG_ID, req, staffSession } from "../../../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const STAGES = [
  ["intake", false], ["analysis", false], ["letters_generated", true], ["ready_to_send", true],
  ["in_transit", false], ["awaiting_response", false], ["response_received", true], ["stalled", true], ["program_complete", false],
];
const fileRow = (key, n) => ({
  card_id: `d${n}000000-0000-4000-8000-00000000000${n}`, client_id: `c${n}000000-0000-4000-8000-00000000000${n}`,
  first_name: `Client${n}`, last_name: "Test", email: `c${n}@example.test`, stage_key: key,
  updated_at: "2026-10-12T10:00:00Z", entered_at: "2026-10-11T10:00:00Z", round: "R1", bureaus: ["EX"],
  response_due_at: key === "awaiting_response" ? "2026-10-20T00:00:00Z" : null,
  case_count: 1, letters_ready: key === "ready_to_send" ? 2 : 0, letters_sent: key === "in_transit" ? 1 : 0, queue_total: String(STAGES.length),
});

function listRules() {
  return [
    [/FROM cards c/, () => STAGES.map(([key], i) => fileRow(key, i + 1))],
    // every client has a live signed authorization, so no file is red on the agreement chip
    [/FROM client_consents/, (_sql, params) => params[1].map((client_id) => ({ client_id, is_valid: true }))],
  ];
}

test("the need-me flag follows the stage, and the tiles count the files that carry it", async () => {
  const { res, fake } = await callShared(handler, req("GET", { query: {} }), [staffSession({ role: "inquiry_specialist" }), ...listRules()]);
  assert.equal(res.statusCode, 200);
  const flags = Object.fromEntries(res.body.files.map((f) => [f.stage_key, f.need_me]));
  for (const [key, needMe] of STAGES) assert.equal(flags[key], needMe, `${key}: need_me`);
  assert.equal(res.body.need_me, 4, "four stages are a person's turn");
  assert.equal(res.body.total, STAGES.length);
  const list = fake.find(/FROM cards c/)[0];
  assert.equal(list.params[0], ORG_ID);
  assert.deepEqual([...list.params[1]].sort(), ["letters_generated", "ready_to_send", "response_received", "stalled"]);
});

test("the queue's Due is the earliest open due time of the file, read for the optimization board and this company", async () => {
  const { fake } = await callShared(handler, req("GET", { query: {} }), [staffSession({ role: "inquiry_specialist" }), ...listRules()]);
  const sql = fake.find(/FROM cards c/)[0].sql.replace(/\s+/g, " ");
  assert.match(sql, /MIN\(response_due_at\) AS response_due_at/, "the earliest due, never the latest");
  assert.match(sql, /JOIN pipelines p ON p\.id = c\.pipeline_id AND p\.key = 'optimization'/);
  assert.match(sql, /WHERE c\.org_id = \$1::uuid/);
  assert.match(sql, /status NOT IN \('closed', 'cancelled'\)/, "closed and cancelled cases are not what the file is waiting on");
  assert.match(sql, /ORDER BY \(sub\.stage_key = ANY\(\$2::text\[\]\)\) DESC, sub\.updated_at DESC/, "need-me stages first, then the most recent");
});

function detailRules() {
  return [
    [/FROM cards c[\s\S]*AND c\.client_id = \$2::uuid/, () => [{ ...fileRow("ready_to_send", 1), client_id: CLIENT }]],
    [/FROM dispute_letters\s+WHERE org_id = \$1::uuid AND client_id = \$2::uuid/, () => [
      { id: "11111111-1111-4111-8111-111111111111", bureau: "EX", round: "R1", status: "generated", body_text: "Round 1 words", rule_ids: ["r-1"], target: "bureau" },
      { id: "22222222-2222-4222-8222-222222222222", bureau: "EQ", round: "R1", status: "ready", body_text: "Equifax words", rule_ids: ["r-2"], target: "bureau" },
      { id: "33333333-3333-4333-8333-333333333333", bureau: "TU", round: "R1", status: "sent", body_text: "Already mailed words", rule_ids: ["r-3"], target: "bureau" },
      { id: "44444444-4444-4444-8444-444444444444", bureau: "EX", round: "R1", status: "ready", body_text: "", rule_ids: [], target: "furnisher" },
    ]],
    [/FROM dispute_items di/, () => [
      { id: "55555555-5555-4555-8555-555555555555", rule_id: "METRO2-17", severity: "deletion", field: "balance", creditor: "ACME", account_last4: "4412", round: "R1", status: "open", outcome: null, bureau: "EX" },
    ]],
    [/FROM repair_decision_log/, () => [{ ts: "2026-10-12T10:00:00Z", action: "repair.letters.generated", payload: {} }]],
  ];
}

test("the expanded row reads this client's letters, items and timeline, and only a sendable letter carries its words", async () => {
  const request = req("GET", { query: { client_id: CLIENT } });
  const { res, fake } = await callShared(handler, request, [staffSession({ role: "inquiry_specialist" }), ...detailRules()]);
  assert.equal(res.statusCode, 200);

  const byId = Object.fromEntries(res.body.letters.map((l) => [l.id.slice(0, 2), l]));
  assert.equal(byId["11"].html, "Round 1 words");
  assert.equal(byId["11"].can_send, true);
  assert.equal(byId["22"].html, "Equifax words");
  assert.equal(byId["22"].can_send, true);
  assert.equal(byId["33"].html, null, "a letter already sent carries no words");
  assert.equal(byId["33"].can_send, false, "and cannot be offered for sending again");
  assert.equal(byId["44"].can_send, false, "a ready letter with no words cannot be sent");
  assert.equal(res.body.can_send, true);

  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].creditor, "ACME");
  assert.equal(res.body.timeline.length >= 1, true, "the timeline is read from the decision log");

  const items = fake.find(/FROM dispute_items di/)[0];
  assert.deepEqual([items.params[0], items.params[1]], [ORG_ID, CLIENT], "items are read for this company and this client");
  const letters = fake.find(/FROM dispute_letters\s+WHERE org_id = \$1::uuid AND client_id = \$2::uuid/)[0];
  assert.deepEqual([letters.params[0], letters.params[1]], [ORG_ID, CLIENT]);
  assert.match(letters.sql.replace(/\s+/g, " "), /ORDER BY created_at DESC LIMIT 50/, "the file's letters, newest first, up to fifty");
  assert.match(items.sql.replace(/\s+/g, " "), /LIMIT 100/, "up to a hundred items");
});

test("a role off this desk is refused before anything is read", async () => {
  const { res, fake } = await callShared(handler, req("GET", { query: {} }), [staffSession({ role: "setter" }), ...listRules()]);
  assert.equal(res.statusCode, 403);
  assert.equal(fake.find(/FROM cards c/).length, 0);
});
