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

test("survey-resume: green when the door answers its own 400, every come-back email is signed and no text carries a link", async () => {
  const result = await runBeat(beat, ctxWith());
  assert.equal(result.ok, true);
  assert.equal(result.detail, "3 come-back link checks passed");
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

test("survey-resume: a text that carries a come-back link is red, counted, never copied (review 2026-10-31)", async () => {
  const result = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(result.ok, false);
  assert.equal(result.step, "survey-resume-no-link-in-texts");
  assert.equal(result.detail, "1 of 5 texts in the last 24 hours carry a come-back link, which opens the person's saved answers to whoever holds that phone");
});

test("survey-resume: come-back emails without a signed link are red, counted, never copied", async () => {
  const result = await runBeat(beat, ctxWith({ rows: [{ total: 3, signed: 1, texts: 5, texts_with_link: 0 }] }));
  assert.equal(result.ok, false);
  assert.equal(result.step, "survey-resume-links-signed");
  assert.equal(result.detail, "2 of 3 come-back emails in the last 24 hours have no signed link, so they open the survey at the top");
});

test("survey-resume: no come-back email and no text in a day is nothing to judge, never green", async () => {
  const result = await runBeat(beat, ctxWith({ rows: [{ total: 0, signed: 0, texts: 0, texts_with_link: 0 }] }));
  assert.equal(result.ok, true);
  assert.match(result.detail, /^1 come-back link checks passed; 2 had nothing safe to judge$/);
  assert.ok(result.steps.find((step) => step.name === "survey-resume-links-signed").skipped);
  assert.ok(result.steps.find((step) => step.name === "survey-resume-no-link-in-texts").skipped);
});

test("survey-resume: the read is one SELECT on come-back emails and every text, real people only", () => {
  const sql = truth.COME_BACK_LINKS_SQL;
  assert.match(sql, /^\/\* beat:survey-resume-links \*\//);
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate|grant|begin|commit|rollback)\b/i);
  assert.match(sql, /'EMAIL-S02-RESUME-%'/);
  assert.match(sql, /m\.channel = 'sms'/, "every text is read for a leaked link, not only the come-back ones");
  assert.doesNotMatch(sql, /S00/, "the welcome email is left out: it carries the plain /apply link");
  assert.match(sql, /COALESCE\(c\.is_demo, false\) = false/);
  assert.match(sql, /example\.com/);
  assert.ok(sql.includes("apply\\.fundhub\\.ai/apply\\?r=[A-Za-z0-9_-]{20,}"), "a signed link is the /apply page with a code of 20 or more characters");
});

test("survey-resume: the door it covers names the three hourly checks and the 6 a.m. one", () => {
  const wire = TRIPWIRES["route:public/survey-resume"];
  assert.ok(wire, "route:public/survey-resume is not a tripwire");
  for (const checkId of beat.checkIds) assert.ok(wire.checks.includes(checkId), `the tripwire needs ${checkId}`);
  assert.ok(wire.checks.includes("survey:resume-link-opens"));
});
