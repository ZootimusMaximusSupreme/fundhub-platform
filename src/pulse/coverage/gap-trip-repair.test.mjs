// trip:repair, both ways. A file stuck on a step the company owes goes red and names the step. A file
// waiting on the customer, a person or the bureau inside its clock stays green. No database.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHECK_IDS, IDENTITY_GATE_FROM, LETTER_ENGINE_MS, ROUND_DONE_STAGES, ROW_CAP, STEPS, TRIP_SQL, WINDOW_MS,
  clockText, gapChecks, judgeRepair, naVerify, stageStall, toTripRow, tripParams
} from "./gap-trip-repair.mjs";
import { COUNT_SQL } from "./gap-trip-repair.mjs";
import { LOOKBACK_MS } from "./gap-money-funding.mjs";
import { PAID_GRACE_MS, SETTLE_GRACE_MS } from "./gap-pipeline-facts.mjs";
import { STAGE_SLA } from "../../repair/sla.mjs";
import { BY, walkTrip } from "./trip-kit.mjs";
import { tagDb } from "./money-test-kit.mjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A Wednesday at 18:00 UTC, after the identity gate date.
const NOW = new Date("2026-10-14T18:00:00.000Z");
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const ORG = "11111111-1111-4111-8111-111111111111";

function sqlRow(over = {}) {
  return {
    client_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", client_code: "FH-000201",
    purchase_at: null, enrolled_at: null, program_status: null,
    verified_at: null, credit_file_at: null, authorized_at: null,
    letters_made_at: null, letters_mailed_at: null, later_round_at: null,
    answer_read_at: null, card_stage: null, card_entered_at: null, response_due_at: null,
    ...over
  };
}

function walkRow(over) {
  const t = toTripRow(sqlRow(over), NOW);
  return walkTrip({ steps: STEPS, facts: t.facts, now: NOW, notOwed: t.notOwed, ended: t.ended, stall: t.stall, detail: t.detail });
}

/* ---------- the numbers ---------- */

test("the check id is the one in the brief", () => {
  assert.deepEqual([...CHECK_IDS], ["trip:repair"]);
});

test("the waits are the other lanes' and the desk's own, and every system step names where its wait comes from", () => {
  const by = Object.fromEntries(STEPS.map((s) => [s.key, s]));
  assert.equal(by.enrolled.graceMs, PAID_GRACE_MS);
  assert.equal(by.letters_made.graceMs, LETTER_ENGINE_MS);
  assert.equal(LETTER_ENGINE_MS, STAGE_SLA.analysis.hours * HOUR);
  assert.equal(LETTER_ENGINE_MS, HOUR);
  assert.equal(by.round_complete.graceMs, SETTLE_GRACE_MS);
  assert.equal(WINDOW_MS, LOOKBACK_MS);
  for (const s of STEPS) {
    if (s.by === BY.SYSTEM) {
      assert.ok(s.from && s.graceMs > 0 && /\w/.test(s.source || ""), `${s.key} names its anchor, wait and source`);
    }
  }
});

test("the ladder is the brief's seven steps in order", () => {
  assert.deepEqual(STEPS.map((s) => s.key), [
    "repair_purchase", "enrolled", "documents_in", "letters_made", "letters_mailed", "answer_read", "round_complete"
  ]);
  assert.equal(STEPS.find((s) => s.key === "documents_in").required, true);
});

test("the SELECT writes nothing and uses every parameter, once each in order", () => {
  const bare = TRIP_SQL.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  assert.match(bare, /^SELECT\b/i);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|BEGIN|COMMIT|ROLLBACK)\b/i.test(bare));
  const used = new Set([...TRIP_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  assert.deepEqual([...used].sort(), [1, 2, 3]);
  assert.equal(tripParams(ORG, NOW).length, 3);
  assert.match(TRIP_SQL, new RegExp(`LIMIT ${ROW_CAP}\\b`));
  assert.match(TRIP_SQL, /dc\.round = 'R1'/);
});

test("the gate date is the day the letters were gated on a verified name", () => {
  assert.equal(IDENTITY_GATE_FROM, "2026-09-06T00:00:00.000Z");
  assert.deepEqual([...ROUND_DONE_STAGES], ["round_complete", "program_complete"]);
});

test("clockText says each kind of desk clock in plain words", () => {
  assert.equal(clockText(STAGE_SLA.analysis), "1 hour");
  assert.equal(clockText(STAGE_SLA.letters_generated), "30 minutes");
  assert.equal(clockText(STAGE_SLA.intake), "3 business days");
  assert.equal(clockText(STAGE_SLA.awaiting_documents), "14 days");
  assert.equal(clockText(STAGE_SLA.awaiting_response), "5 days after the bureau's due date");
});

/* ---------- RED ---------- */

test("RED: bought 3 hours ago and no repair program was opened", () => {
  const w = walkRow({ purchase_at: ago(3 * HOUR) });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "enrolled");
});

test("RED: every letter gate is in place 3 hours ago and no letters exist", () => {
  const w = walkRow({
    purchase_at: ago(10 * DAY), enrolled_at: ago(10 * DAY), verified_at: ago(3 * HOUR),
    credit_file_at: ago(9 * DAY), authorized_at: ago(8 * DAY), card_stage: "analysis", card_entered_at: ago(3 * HOUR)
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "letters_made");
  assert.match(w.why, /the last of the ID read, the credit file and the signed agreement/);
});

test("RED: the answer was confirmed 20 minutes ago and the card did not reach Round Complete", () => {
  const w = walkRow({
    purchase_at: ago(40 * DAY), enrolled_at: ago(40 * DAY), verified_at: ago(39 * DAY),
    letters_made_at: ago(30 * DAY), letters_mailed_at: ago(29 * DAY), answer_read_at: ago(20 * MIN),
    card_stage: "response_received", card_entered_at: ago(2 * HOUR)
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "round_complete");
});

test("RED: a file in Analysis for two hours is past the desk's one-hour clock, and names what the engine waits on", () => {
  const w = walkRow({
    purchase_at: ago(10 * DAY), enrolled_at: ago(10 * DAY), verified_at: ago(9 * DAY),
    card_stage: "analysis", card_entered_at: ago(2 * HOUR)
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "letters_made");
  assert.match(w.why, /past its clock of 1 hour/);
  assert.match(w.why, /waiting on a credit file on record, a signed repair agreement or a live dispute authorization/);
});

test("RED: letters made and sitting at Ready to Send for 5 hours (the clock is 4)", () => {
  const w = walkRow({
    purchase_at: ago(10 * DAY), enrolled_at: ago(10 * DAY), verified_at: ago(9 * DAY),
    letters_made_at: ago(6 * HOUR), card_stage: "ready_to_send", card_entered_at: ago(5 * HOUR)
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "letters_mailed");
  assert.match(w.why, /"Ready to Send" past its clock of 4 hours/);
});

test("RED: mailed and still In Transit after 11 days (the clock is 10)", () => {
  const w = walkRow({
    purchase_at: ago(30 * DAY), enrolled_at: ago(30 * DAY), verified_at: ago(29 * DAY),
    letters_made_at: ago(20 * DAY), letters_mailed_at: ago(12 * DAY), card_stage: "in_transit", card_entered_at: ago(11 * DAY)
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "answer_read");
});

test("RED: awaiting a bureau answer 6 days past its due date (the clock is 5)", () => {
  const w = walkRow({
    purchase_at: ago(60 * DAY), enrolled_at: ago(60 * DAY), verified_at: ago(59 * DAY),
    letters_made_at: ago(45 * DAY), letters_mailed_at: ago(44 * DAY),
    card_stage: "awaiting_response", card_entered_at: ago(40 * DAY), response_due_at: ago(6 * DAY)
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "answer_read");
  assert.match(w.why, /5 days after the bureau's due date/);
});

test("RED: the file is in Stalled", () => {
  const w = walkRow({
    purchase_at: ago(10 * DAY), enrolled_at: ago(10 * DAY), verified_at: ago(9 * DAY),
    card_stage: "stalled", card_entered_at: ago(DAY)
  });
  assert.equal(w.state, "broken");
  assert.match(w.why, /"Stalled"/);
});

test("RED: letters made after the gate date and no ID was ever read", () => {
  const w = walkRow({
    purchase_at: ago(20 * DAY), enrolled_at: ago(20 * DAY), letters_made_at: ago(5 * DAY)
  });
  assert.equal(w.state, "broken");
  assert.equal(w.step.key, "documents_in");
  assert.match(w.why, /never happened/);
});

/* ---------- GREEN ---------- */

test("GREEN: bought 20 minutes ago, still inside the hour", () => {
  const w = walkRow({ purchase_at: ago(20 * MIN) });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "enrolled");
});

test("GREEN: enrolled and waiting on the customer's documents (inside the 14 day clock)", () => {
  const w = walkRow({
    purchase_at: ago(6 * DAY), enrolled_at: ago(6 * DAY), card_stage: "awaiting_documents", card_entered_at: ago(5 * DAY)
  });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "documents_in");
  assert.equal(w.step.by, BY.CLIENT);
});

test("GREEN: the ID is in but there is no credit file or signed paper yet: the engine is not owed", () => {
  const w = walkRow({
    purchase_at: ago(6 * DAY), enrolled_at: ago(6 * DAY), verified_at: ago(5 * DAY),
    card_stage: "intake", card_entered_at: ago(2 * HOUR)
  });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "letters_made");
});

test("GREEN: letters waiting for the person who presses Send inside the four hour clock", () => {
  const w = walkRow({
    purchase_at: ago(6 * DAY), enrolled_at: ago(6 * DAY), verified_at: ago(5 * DAY),
    letters_made_at: ago(2 * HOUR), card_stage: "ready_to_send", card_entered_at: ago(90 * MIN)
  });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.by, BY.PERSON);
});

test("GREEN: mailed, waiting on the bureau, inside the clock", () => {
  const w = walkRow({
    purchase_at: ago(20 * DAY), enrolled_at: ago(20 * DAY), verified_at: ago(19 * DAY),
    letters_made_at: ago(10 * DAY), letters_mailed_at: ago(9 * DAY),
    card_stage: "awaiting_response", card_entered_at: ago(6 * DAY), response_due_at: ago(-20 * DAY)
  });
  assert.equal(w.state, "waiting");
  assert.equal(w.step.key, "answer_read");
});

test("GREEN: round 1 complete is a finished trip", () => {
  const w = walkRow({
    purchase_at: ago(50 * DAY), enrolled_at: ago(50 * DAY), verified_at: ago(49 * DAY),
    letters_made_at: ago(40 * DAY), letters_mailed_at: ago(39 * DAY), answer_read_at: ago(10 * DAY),
    card_stage: "round_complete", card_entered_at: ago(10 * DAY)
  });
  assert.equal(w.state, "finished");
});

test("GREEN: a client already on a later round has been through round 1", () => {
  const w = walkRow({
    purchase_at: ago(55 * DAY), enrolled_at: ago(55 * DAY), verified_at: ago(54 * DAY),
    later_round_at: ago(5 * DAY), card_stage: "letters_generated", card_entered_at: ago(10 * MIN)
  });
  assert.equal(w.state, "finished");
});

test("GREEN: a letter made before the gate date does not owe an ID read", () => {
  const w = walkRow({
    purchase_at: ago(50 * DAY), enrolled_at: ago(50 * DAY), letters_made_at: "2026-08-20T10:00:00.000Z",
    letters_mailed_at: "2026-08-21T10:00:00.000Z", card_stage: "awaiting_response", card_entered_at: ago(40 * DAY),
    response_due_at: ago(-5 * DAY)
  });
  assert.notEqual(w.state, "broken");
});

test("GREEN: a cancelled card is an ended trip", () => {
  const w = walkRow({ purchase_at: ago(30 * DAY), enrolled_at: ago(30 * DAY), card_stage: "cancelled", card_entered_at: ago(2 * DAY) });
  assert.equal(w.state, "ended");
});

test("GREEN: the Awaiting Response clock needs a due date; with none it is not breached", () => {
  assert.equal(stageStall({ card_stage: "awaiting_response", card_entered_at: ago(90 * DAY), response_due_at: null }, NOW), null);
  assert.equal(stageStall({ card_stage: "round_complete", card_entered_at: ago(90 * DAY) }, NOW), null);
  assert.equal(stageStall({ card_stage: null }, NOW), null);
});

test("a paid repair link counts as the purchase even with no sale row", () => {
  const sql = TRIP_SQL.replace(/\s+/g, " ");
  assert.match(sql, /pl\.purpose = 'repair'/);
});

/* ---------- the verdict and the lane ---------- */

test("judgeRepair: nobody started is a verified nothing-to-judge", () => {
  const r = judgeRepair({ rows: [], now: NOW });
  assert.equal(r.status, "na");
  assert.equal(r.na.code, "low-traffic");
  assert.equal(r.na.args.check, "trip:repair");
});

test("judgeRepair: one stuck file is FAIL with the customer and the step", () => {
  const r = judgeRepair({ rows: [sqlRow({ client_code: "FH-000999", purchase_at: ago(3 * HOUR) })], now: NOW });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /FH-000999 stopped at "repair program opened"/);
});

test("judgeRepair: customers waiting are PASS and counted by step", () => {
  const r = judgeRepair({
    rows: [sqlRow({ purchase_at: ago(6 * DAY), enrolled_at: ago(6 * DAY), card_stage: "awaiting_documents", card_entered_at: ago(5 * DAY) })],
    now: NOW
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /1 waiting \(1 at "ID read and accepted"\)/);
});

test("gapChecks: reads once and returns the verdict; a failed read is a skip; no db is a skip", async () => {
  const seen = [];
  const db = tagDb({ "trip-repair": [sqlRow({ purchase_at: ago(3 * HOUR) })] }, seen);
  const out = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.equal(out[0].status, "FAIL");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].tag, "trip-repair");

  const bad = await gapChecks({ db: { async query() { throw new Error("relation \"repair_programs\" does not exist"); } }, orgId: ORG, now: NOW });
  assert.equal(bad[0].status, "skip");
  assert.match(bad[0].detail, /repair_programs/);

  const none = await gapChecks({ orgId: ORG });
  assert.equal(none[0].status, "skip");
});

test("naVerify: true while nobody is on the trip, false the day someone is", async () => {
  const none = tagDb({ "trip-repair": [], "trip-repair-count": [{ n: 0 }] });
  const some = tagDb({ "trip-repair": [sqlRow({ purchase_at: ago(DAY) })], "trip-repair-count": [{ n: 1 }] });
  assert.equal(await naVerify["low-traffic"]({ check: "trip:repair" }, { db: none, orgId: ORG, now: NOW }), true);
  assert.equal(await naVerify["low-traffic"]({ check: "trip:repair" }, { db: some, orgId: ORG, now: NOW }), false);
});

test("the light count behind the nothing-to-judge proof is one read-only SELECT on parameters 1 to 3", () => {
  const bare = COUNT_SQL.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  assert.match(bare, /^SELECT\b/i);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|BEGIN|COMMIT|ROLLBACK)\b/i.test(bare));
  const used = [...new Set([...COUNT_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  assert.deepEqual(used, [1, 2, 3]);
  assert.ok(!/\bLIMIT\s+(?!1\b)\d+/i.test(bare), "a count is not capped (LIMIT 1 inside a lookup is fine)");
});
