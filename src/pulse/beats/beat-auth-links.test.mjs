import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-auth-links.mjs";
import * as truth from "./lib/auth-truth.mjs";
import * as lane from "../coverage/gap-auth.mjs";
import { DRAFT_RE, isDraftTemplateRow } from "../../messaging/draft-guard.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { laneSelfTest } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const withRows = (rows) => laneSelfTest({ ...beat.LANE, selfTest: { passRows: rows } });
const replace = (sql, value) => beat.LANE.selfTest.passRows.map(([s, v]) => (s === sql ? [s, value] : [s, v]));

test("auth-links is valid, green when links send and sign-ins make sessions, red on a link with no email", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-auth-links.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.equal(passed.detail, "2 sign-in checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "gap-auth-magic-link-dead");
  assert.match(failed.detail, /1 sign-in link in 24 hours had no email queued/);
});

test("auth-links: a missing or draft template is red, and a sign-in with no session is red", async () => {
  const missing = await runBeat(beat, makeFakeCtx(beat, withRows(replace(truth.MAGIC_TEMPLATE_SQL, []))));
  assert.equal(missing.step, "gap-auth-magic-link-dead");
  assert.match(missing.detail, /EMAIL-PORTAL-MAGIC-LINK is missing/);
  const draft = [{ template_key: truth.MAGIC_LINK_TEMPLATE_KEY, compliance_passed: true, subject: "[DRAFT] link", body: "x" }];
  const drafted = await runBeat(beat, makeFakeCtx(beat, withRows(replace(truth.MAGIC_TEMPLATE_SQL, draft))));
  assert.equal(drafted.step, "gap-auth-magic-link-dead");
  const noSession = [{ staff_ok: 3, staff_no_session: 1, links_used: 0, links_no_session: 0 }];
  const broken = await runBeat(beat, makeFakeCtx(beat, withRows(replace(truth.SIGNIN_NO_SESSION_SQL, noSession))));
  assert.equal(broken.ok, false);
  assert.equal(broken.step, "gap-auth-signin-no-session");
  assert.match(broken.detail, /1 of 3 staff sign-ins said yes and made no session/);
});

test("auth-links: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.MAGIC_DEAD_SQL, truth.MAGIC_DEAD_SQL);
  assert.equal(lane.MAGIC_TEMPLATE_SQL, truth.MAGIC_TEMPLATE_SQL);
  assert.equal(lane.SIGNIN_NO_SESSION_SQL, truth.SIGNIN_NO_SESSION_SQL);
  assert.ok(lane.READ_ONLY_SQL.includes(truth.MAGIC_DEAD_SQL));
});

test("auth-links: the copied draft test equals src/messaging/draft-guard.mjs", () => {
  assert.equal(truth.DRAFT_RE.source, DRAFT_RE.source);
  assert.equal(truth.DRAFT_RE.flags, DRAFT_RE.flags);
  for (const row of [{}, { body: "[DRAFT] hi" }, { subject: "[draft] x" }, { body: "fine", subject: "fine" }, { body: null }, { subject: "[DRAFTED" }, { body: "[DRAFT-1]" }]) {
    assert.equal(truth.isDraftTemplateRow(row), isDraftTemplateRow(row), JSON.stringify(row));
  }
});

test("auth-links: every surface it covers has every named deep check run here", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId), `${surface} needs ${checkId}`);
  }
});
