import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as beat from "./beat-survey-resume.mjs";
import * as truth from "./lib/survey-resume-truth.mjs";
import { checkBeatSelfTest, pinBeatSource, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOOR = `GET https://fundhub.ai${truth.DOOR_PATH}`;
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv123456ZYXWVUTSRQPONMLKJ";

/** The beat with its own self-test answers, some changed. */
function ctxWith({ rows, door } = {}) {
  const spec = laneSelfTest({
    ...beat.LANE,
    selfTest: {
      passRows: rows ? [[truth.COME_BACK_LINKS_SQL, rows]] : beat.LANE.selfTest.passRows,
      passHttp: { [DOOR]: door ?? beat.LANE.selfTest.passHttp[DOOR] }
    }
  });
  return makeFakeCtx(beat, spec);
}

test("survey-resume is a valid beat, passes the static pin and its own self test", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-survey-resume.mjs" }), []);
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "beat-survey-resume.mjs"), "utf8")), []);
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "lib", "survey-resume-truth.mjs"), "utf8"), { role: "lib" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.equal(beat.kind, "probe");
  assert.equal(beat.box, false);
  assert.deepEqual(beat.covers, ["route:public/survey-resume"]);
  assert.deepEqual(beat.reads, [{ host: "SITE", methods: ["GET"] }]);
});

test("survey-resume: green when the door answers its own 400 and no follow-up carries a resume code", async () => {
  const result = await runBeat(beat, ctxWith());
  assert.equal(result.ok, true);
  assert.equal(result.detail, "2 come-back link checks passed");
  assert.deepEqual(result.steps.map((s) => s.name), beat.steps);
});

test("survey-resume: a 404 at the door is red at the door step, with the path and the status only", async () => {
  const result = await runBeat(beat, ctxWith({ door: { status: 404, body: `{"error":"not_found","r":"${TOKEN}"}` } }));
  assert.equal(result.ok, false);
  assert.equal(result.step, "survey-resume-door-answers");
  assert.equal(result.detail, "GET /api/public/survey-resume answered 404, wanted 400 token_required");
  assert.doesNotMatch(result.detail, new RegExp(TOKEN));
});

test("survey-resume: a 400 that is not the door's own answer is red too", async () => {
  const result = await runBeat(beat, ctxWith({ door: { status: 400, body: "<html>Bad Request</html>" } }));
  assert.equal(result.ok, false);
  assert.equal(result.step, "survey-resume-door-answers");
});

test("survey-resume: a follow-up that carries a resume code is red, counted, never copied", async () => {
  const result = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(result.ok, false);
  assert.equal(result.step, "survey-resume-links-signed");
  assert.equal(result.detail, "1 of 3 welcome and come-back messages in the last 24 hours carry a resume code, which can reach a phone nobody proved is the lead's");
});

test("survey-resume: no come-back message in a day is nothing to judge, never green", async () => {
  const result = await runBeat(beat, ctxWith({ rows: [{ total: 0, coded: 0 }] }));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^1 come-back link checks passed; 1 had nothing safe to judge$/);
  assert.ok(result.steps.find((step) => step.name === "survey-resume-links-signed").skipped);
});

test("survey-resume: the read is one SELECT on the welcome and come-back keys only, real people only", () => {
  const sql = truth.COME_BACK_LINKS_SQL;
  assert.match(sql, /^\/\* beat:survey-resume-links \*\//);
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate|grant|begin|commit|rollback)\b/i);
  assert.match(sql, /'SMS-S02-RESUME-%'/);
  assert.match(sql, /'EMAIL-S02-RESUME-%'/);
  assert.match(sql, /'SMS-S00-WELCOME'/, "the welcome text is checked too: it went to the same unproved phone");
  assert.match(sql, /'EMAIL-S00-WELCOME'/);
  assert.match(sql, /COALESCE\(c\.is_demo, false\) = false/);
  assert.match(sql, /example\.com/);
  assert.ok(sql.includes("apply\\.fundhub\\.ai/apply\\?r="), "any /apply link with an r= code counts as coded");
});

test("survey-resume: the door it covers names both hourly checks and the 6 a.m. one", () => {
  const wire = TRIPWIRES["route:public/survey-resume"];
  assert.ok(wire, "route:public/survey-resume is not a tripwire");
  for (const checkId of beat.checkIds) assert.ok(wire.checks.includes(checkId), `the tripwire needs ${checkId}`);
  assert.ok(wire.checks.includes("survey:resume-link-opens"));
});
