// One judge, two clocks: the morning repair lanes and the hourly repair-trip beat run the same SQL and
// the same verdicts, and every value the lib copies from outside stays equal to its source.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as tripTruth from "./repair-trip-truth.mjs";
import * as deskTruth from "./repair-desk-truth.mjs";
import * as motionTruth from "./repair-motion-truth.mjs";
import * as holdLib from "./owner-hold.mjs";
import * as tripLane from "../../coverage/gap-trip-repair.mjs";
import * as deskLane from "../../coverage/gap-repair.mjs";
import * as motion from "../../pipeline-motion.mjs";
import * as hold from "../../owner-hold.mjs";
import { CONSENT_VALID_SQL } from "../../../consent/index.mjs";
import { LOOKBACK_MS } from "../../coverage/gap-money-funding.mjs";
import { PAID_GRACE_MS, SETTLE_GRACE_MS } from "../../coverage/gap-pipeline-facts.mjs";
import { INTERNAL_CLIENT_EMAIL_RE } from "../../coverage/gap-portal.mjs";
import { STAGE_SLA } from "../../../repair/sla.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMPORT_RE = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

test("repair truth: the morning lanes hand out the very same SQL and judges the beat runs", () => {
  assert.equal(tripLane.TRIP_SQL, tripTruth.TRIP_SQL);
  assert.equal(tripLane.judgeRepair, tripTruth.judgeRepair);
  assert.equal(tripLane.judgeRepairWithHolds, tripTruth.judgeRepairWithHolds);
  assert.equal(tripLane.tripParams, tripTruth.tripParams);
  assert.deepEqual([...tripLane.CHECK_IDS], ["trip:repair"]);
  for (const name of ["STALLED_CASES_SQL", "CLOCK_CARDS_SQL", "OPEN_CASE_NO_LETTER_SQL", "CARD_NO_LETTER_SQL", "stuckCheck", "letterCheck", "breachedCards"]) {
    assert.equal(deskLane[name], deskTruth[name], name);
  }
  assert.deepEqual([...deskLane.CHECK_IDS], ["repair-case-stuck", "repair-letter-round"]);
  assert.equal(typeof deskLane.naVerify[holdLib.OWNER_HOLD_CODE], "function", "the audit's re-check stays on the lane");
  assert.equal(motion.REPAIR_STUCK_STAGES, motionTruth.REPAIR_STUCK_STAGES);
});

test("repair truth: the owner hold is one list, read the same by the lanes and the beat", () => {
  for (const name of Object.keys(holdLib)) assert.equal(hold[name], holdLib[name], name);
  assert.deepEqual(Object.keys(hold).sort(), Object.keys(holdLib).sort());
  assert.equal(holdLib.onOwnerHold("FH-000507"), true);
});

test("repair truth: every value copied into the lib equals its source", () => {
  assert.equal(tripTruth.CONSENT_VALID_SQL, CONSENT_VALID_SQL);
  assert.equal(tripTruth.WINDOW_MS, LOOKBACK_MS);
  const by = Object.fromEntries(tripTruth.STEPS.map((step) => [step.key, step]));
  assert.equal(by.enrolled.graceMs, PAID_GRACE_MS);
  assert.equal(by.round_complete.graceMs, SETTLE_GRACE_MS);
  assert.equal(tripTruth.LETTER_ENGINE_MS, STAGE_SLA.analysis.hours * 60 * 60 * 1000);
  assert.deepEqual(tripTruth.tripParams("org", new Date("2026-10-14T00:00:00.000Z"))[2], INTERNAL_CLIENT_EMAIL_RE);
  assert.equal(deskTruth.LETTER_GRACE_MS, STAGE_SLA.letters_generated.minutes * 60 * 1000);
});

test("repair truth: pipeline:repair says the same words both ways, and an empty count is never green", async () => {
  const daily = await motion.checkPipelineMotion({
    db: { query: async (sql) => ({ rows: /FROM cards c/.test(sql) ? [{ n: 2 }] : (/FROM clients/.test(sql) ? [] : [{ n: 0 }]) }) },
    orgId: "11111111-1111-4111-8111-111111111111"
  });
  const hourly = await motionTruth.readRepairMotion({ read: async () => ({ rows: [{ n: 2 }] }), orgId: "o" });
  assert.deepEqual(hourly, daily.find((row) => row.id === "pipeline:repair"));
  assert.equal(hourly.status, "FAIL");
  assert.equal((await motionTruth.readRepairMotion({ read: async () => ({ rows: [{ n: 0 }] }), orgId: "o" })).status, "PASS");
  assert.equal((await motionTruth.readRepairMotion({ read: async () => ({ rows: [] }), orgId: "o" })).status, "skip");
  assert.equal((await motionTruth.readRepairMotion({ read: async () => { throw new Error("timeout"); }, orgId: "o" })).status, "skip");
});

test("repair truth: the trip read is a skip when it cannot read, never a PASS", async () => {
  const out = await tripTruth.readRepairTrip({ read: async () => { throw new Error("statement timeout"); }, orgId: "o", now: new Date() });
  assert.equal(out.status, "skip");
  assert.match(out.detail, /statement timeout/);
});

test("repair truth: the import closure stays inside beats/lib", () => {
  const seen = new Set();
  const visit = (file) => {
    const full = path.resolve(HERE, file);
    assert.equal(full.startsWith(`${HERE}${path.sep}`), true, `${file} left beats/lib`);
    if (seen.has(full)) return;
    seen.add(full);
    for (const match of fs.readFileSync(full, "utf8").matchAll(IMPORT_RE)) {
      assert.equal(match[1].startsWith("./"), true, `${path.basename(full)} imports ${match[1]}`);
      visit(match[1]);
    }
  };
  for (const file of ["repair-trip-truth.mjs", "repair-desk-truth.mjs", "repair-motion-truth.mjs", "documents-truth.mjs", "owner-hold.mjs", "repair-sla.mjs"]) visit(file);
  assert.ok(seen.has(path.join(HERE, "trip-truth-kit.mjs")));
});
