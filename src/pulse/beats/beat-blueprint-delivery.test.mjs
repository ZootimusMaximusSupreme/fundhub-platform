import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as beat from "./beat-blueprint-delivery.mjs";
import { validateBeat, pinBeatSource, checkBeatSelfTest, runBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog, FAKE_NOW } from "./ctx.mjs";
import { assertReadOnlySql } from "./readbox.mjs";
import * as gap from "../coverage/gap-blueprint.mjs";
import { TEST_CLIENT_EMAIL_RE } from "../coverage/gap-consent.mjs";

const world = (step, rows) => ({ read: beat.selfTest.pass().read.map((entry) =>
  step && String(entry.match).includes(step) ? { ...entry, rows } : entry) });
const go = (fixture = world()) => runBeat(beat, makeFakeCtx(beat, fixture));

test("Blueprint hourly beat passes the contract, strict read-only pin and both self-tests", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-blueprint-delivery.mjs" }), []);
  assert.deepEqual(pinBeatSource(readFileSync(new URL("./beat-blueprint-delivery.mjs", import.meta.url), "utf8")), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.deepEqual(beat.covers, ["desk:csm-queue.html", "job:finance-os-pull-sweeper", "job:waypoint-nudge-sweeper", "route:blueprint/plan", "route:blueprint/business-plans"]);
  assert.deepEqual(beat.CHECK_IDS, gap.CHECK_IDS);
  assert.deepEqual(beat.steps, ["real-advisor", "monthly-delivery", "coach-call-delivery", "preparation-evidence"]);
});

test("hourly SQL and parameters stay identical to the existing scoped deep checks", async () => {
  assert.equal(beat.REAL_ADVISOR_SQL, gap.REAL_ADVISOR_SQL);
  assert.equal(beat.MONTHLY_DELIVERY_SQL, gap.MONTHLY_DELIVERY_SQL);
  assert.equal(beat.COACH_CALL_DELIVERY_SQL, gap.COACH_CALL_DELIVERY_SQL);
  assert.equal(beat.PREPARATION_EVIDENCE_SQL, gap.PREPARATION_EVIDENCE_SQL);
  assert.equal(beat.TEST_CLIENT_EMAIL_RE, TEST_CLIENT_EMAIL_RE);
  for (const sql of [beat.ORG_SQL, beat.REAL_ADVISOR_SQL, beat.MONTHLY_DELIVERY_SQL, beat.COACH_CALL_DELIVERY_SQL, beat.PREPARATION_EVIDENCE_SQL]) assert.doesNotThrow(() => assertReadOnlySql(sql));
  const ctx = makeFakeCtx(beat, world());
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.notRun, []);
  const reads = ctxLog(ctx).reads;
  const expected = [];
  await gap.gapChecks({ orgId: reads[1].params[0], now: FAKE_NOW,
    db: { async query(sql, params) { expected.push({ sql, params }); return { rows: [{ n: 0 }] }; } } });
  assert.deepEqual(reads.slice(1), expected);
  assert.equal(reads.length, 5);
  assert.equal(ctxLog(ctx).http.length, 0);
  assert.match(result.detail, /do not prove a live customer delivery/);
});

test("either Blueprint exception independently turns its exact step red", async () => {
  for (const step of beat.steps) {
    const out = await go(world(`blueprint-${step}`, [{ n: 1 }]));
    assert.equal(out.ok, false);
    assert.equal(out.step, step);
    assert.match(out.detail, /^1 /);
  }
});

test("missing or malformed counts cannot become green and do not expose customer values", async () => {
  for (const step of beat.steps) {
    for (const n of [null, undefined, "", false, -1, 0.5, "buyer@secretcompany.com", {}]) {
      const out = await go(world(`blueprint-${step}`, n === undefined ? [] : [{ n }]));
      assert.equal(out.ok, false);
      assert.equal(out.step, step);
      assert.doesNotMatch(out.detail, /buyer@secretcompany/);
    }
  }
});

test("missing or ambiguous Fundhub identity fails before counting another company's clients", async () => {
  for (const rows of [[], [{ id: null }], [{ id: "not-an-org" }],
    [{ id: "00000000-0000-4000-8000-000000000001" }, { id: "00000000-0000-4000-8000-000000000002" }]]) {
    const ctx = makeFakeCtx(beat, world("FROM orgs", rows));
    const out = await runBeat(beat, ctx);
    assert.equal(out.ok, false);
    assert.equal(out.step, "real-advisor");
    assert.equal(ctxLog(ctx).reads.length, 1);
  }
  assert.equal(beat.ORG_SQL, "SELECT id FROM orgs WHERE slug = 'fundhub'");
});


test("preparation count reports a real integrity exception without exposing client/document values", async () => {
  const out = await go(world("blueprint-preparation-evidence", [{ n: 2 }]));
  assert.equal(out.ok, false);
  assert.equal(out.step, "preparation-evidence");
  assert.match(out.detail, /^2 active Blueprint clients have malformed preparation state or invalid linked evidence/);
  assert.match(beat.fixGuide, /authenticated Blueprint flow/);
  for (const predicate of ["e.org_id = c.org_id AND e.client_id = c.id", "e.revoked_at IS NULL",
    "d.org_id = e.org_id AND d.client_id = e.client_id", "d.id::text = e.document_id", "d.kind = 'client_upload'",
    "other.plan_id IS DISTINCT FROM e.plan_id", "step->>'businessPlanId'"]) {
    assert.ok(beat.PREPARATION_EVIDENCE_SQL.includes(predicate), predicate);
  }
});


test("preparation hourly evidence uses the canonical staff-reviewed business before upload metadata", () => {
  const canonical = "COALESCE(r.entity_id::text, NULLIF(d.metadata->>'entity_id', ''))";
  assert.equal(beat.PREPARATION_EVIDENCE_SQL.split(canonical).length - 1, 2);
  assert.equal(beat.PREPARATION_EVIDENCE_SQL, gap.PREPARATION_EVIDENCE_SQL);
  assert.doesNotMatch(beat.PREPARATION_EVIDENCE_SQL, /COALESCE\(NULLIF\(d\.metadata/);
});
