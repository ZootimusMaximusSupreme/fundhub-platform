// Parked features (owner answers B6 and B8, 2026-10-20). Every parked feature has a
// test where it is still not in use (the row may say "nothing to judge") and a test
// where it is in use (the real red comes back, and the old claim fails verifyNa).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PARKED_FEATURES, PARKED_KEYS, parkedFeature, parkedState, parkRow, parksRow, setUpSettings, unusable
} from "./parked-features.mjs";
import { verifyNa } from "./na-conditions.mjs";
import { checkMachine, MACHINE_CHECKS } from "./machine.mjs";
import { gapChecks as jobGapChecks, FINAL_JOB_GAP_ROWS } from "./coverage/gap-door-batch-jobs.mjs";
import { gapChecks as webhookGapChecks } from "./coverage/gap-door-batch-webhooks.mjs";
import { launchSecretsPresent, LAUNCH_SECRETS } from "./coverage/gap-keys.mjs";

const NOW = new Date("2026-10-20T13:00:00Z");

/* A staff scope over a fake db. `answers` maps a feature key to its one row. */
function staff(answers = {}, { fail = false } = {}) {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (fail) throw new Error("permission denied");
      const key = /parked:([a-z-]+)/.exec(String(sql))?.[1];
      return { rows: key && answers[key] ? [answers[key]] : [] };
    }
  };
  const scope = (fn) => fn(db);
  scope.calls = calls;
  return scope;
}

const QUIET = {
  "meta-ads": { running: 0, delivered: 0 },
  "bureau-calls": { real_calls: 0, placed: 0 },
  lendflow: { captures: 0 }
};
const NO_KEYS = {};

const INQUIRY_ID = FINAL_JOB_GAP_ROWS.find((r) => r.surface === "workflow:inquiry-call-sweeper").id;

test("the parked list is Meta ad sync, AI bureau calling and Lendflow; Brain and push are green live, so not parked", () => {
  assert.deepEqual([...PARKED_KEYS].sort(), ["bureau-calls", "lendflow", "meta-ads"]);
  assert.equal(PARKED_FEATURES["meta-ads"].code, "feature-not-set-up");
  assert.equal(PARKED_FEATURES["bureau-calls"].code, "feature-not-set-up");
  assert.equal(PARKED_FEATURES.lendflow.code, "owner-paused");
  assert.equal(parkedFeature("toString"), null, "an inherited name is not a feature");
  for (const id of ["brain:embed-key", "native-push:configured", "opt-out:unsubscribe-link"]) {
    assert.equal(PARKED_KEYS.some((k) => parksRow(k, id)), false, id);
  }
});

test("each feature parks only its own rows, bare or with its lane prefix", () => {
  assert.ok(parksRow("meta-ads", "meta-sync"));
  assert.ok(parksRow("meta-ads", "meta-server-events"));
  assert.ok(!parksRow("meta-ads", "dying-ad-scan"));
  assert.ok(parksRow("bureau-calls", INQUIRY_ID));
  assert.ok(parksRow("bureau-calls", `gap-door-batch-jobs:${INQUIRY_ID}`));
  assert.ok(!parksRow("bureau-calls", `gap-other:${INQUIRY_ID}`));
  assert.ok(!parksRow("bureau-calls", "catalog-job:jobs.json:workflow:contract-chaser:chases unsigned contracts"));
  assert.ok(parksRow("lendflow", "door-batch:webhook-lendflow-contract"));
  assert.ok(parksRow("lendflow", "gap-door-batch-webhooks:door-batch:webhook-lendflow-contract"));
  assert.ok(!parksRow("lendflow", "door-batch:webhook-ad-video-worker"));
});

test("PASS: each feature is parked while the staff read says it is not in use", async () => {
  for (const key of PARKED_KEYS) {
    const state = await parkedState(key, { scope: staff(QUIET), env: NO_KEYS, now: NOW });
    assert.equal(state.parked, true, `${key}: ${state.why}`);
  }
});

test("FAIL: in use, a failed read, no staff view, or no answer is never parked", async () => {
  const inUse = {
    "meta-ads": [{ running: 1, delivered: 0 }, { running: 0, delivered: 3 }],
    "bureau-calls": [{ real_calls: 1, placed: 0 }, { real_calls: 0, placed: 2 }],
    lendflow: [{ captures: 1 }]
  };
  for (const [key, rows] of Object.entries(inUse)) {
    for (const r of rows) {
      const state = await parkedState(key, { scope: staff({ [key]: r }), env: NO_KEYS, now: NOW });
      assert.equal(state.parked, false, `${key} ${JSON.stringify(r)}`);
    }
    assert.equal((await parkedState(key, { scope: staff(QUIET, { fail: true }), env: NO_KEYS })).parked, false, `${key} read fails`);
    assert.equal((await parkedState(key, { env: NO_KEYS })).parked, false, `${key} no staff view`);
    assert.equal((await parkedState(key, { scope: staff({}), env: NO_KEYS })).parked, false, `${key} empty answer`);
  }
  assert.equal((await parkedState("nope", { scope: staff(QUIET) })).parked, false);
});

test("FAIL: Lendflow is not paused the day a Lendflow key is set on the server; a mask is not a key", async () => {
  const set = await parkedState("lendflow", { scope: staff(QUIET), env: { LENDFLOW_API_KEY: "lf_live_real_value" } });
  assert.equal(set.parked, false);
  assert.match(set.why, /LENDFLOW_API_KEY is set on the server/);
  const scope = staff(QUIET);
  const masked = await parkedState("lendflow", { scope, env: { LENDFLOW_WEBHOOK_SECRET: "****************abcd" } });
  assert.equal(masked.parked, true);
  assert.deepEqual(setUpSettings("lendflow", { LENDFLOW_WEBHOOK_SECRET: "  " }), []);
  assert.deepEqual(setUpSettings("lendflow", { LENDFLOW_WEBHOOK_SECRET: "real" }), ["LENDFLOW_WEBHOOK_SECRET"]);
  assert.equal(unusable("****"), true);
  assert.equal(unusable("abc"), false);
});

test("parkRow: a red row of a parked feature becomes nothing-to-judge with a code; PASS and other rows are untouched", async () => {
  const red = { id: "meta-sync", kind: "machine", status: "FAIL", detail: "Meta call failed", suggestedFix: "Read last_error" };
  const parked = await parkRow(red, "meta-ads", { scope: staff(QUIET), env: NO_KEYS, now: NOW });
  assert.equal(parked.status, "na");
  assert.deepEqual(parked.na, { code: "feature-not-set-up", args: { feature: "meta-ads" } });
  assert.equal(parked.kind, "machine");
  assert.equal(parked.suggestedFix, null);
  assert.match(parked.detail, /Meta ad sync is a future feature the owner has not set up yet \(2026-10-20\): no Meta ad is running/);

  const green = { ...red, status: "PASS" };
  assert.equal(await parkRow(green, "meta-ads", { scope: staff(QUIET) }), green);
  const other = { ...red, id: "dying-ad-scan" };
  assert.equal(await parkRow(other, "meta-ads", { scope: staff(QUIET) }), other);
  const running = await parkRow(red, "meta-ads", { scope: staff({ "meta-ads": { running: 2, delivered: 0 } }), now: NOW });
  assert.equal(running, red, "an ad running means the real red stands");
});

test("verifyNa: feature-not-set-up and owner-paused hold while parked and fail once in use", async () => {
  const meta = { id: "meta-sync", status: "na", na: { code: "feature-not-set-up", args: { feature: "meta-ads" } } };
  const ok = await verifyNa(meta, { scope: staff(QUIET), now: NOW });
  assert.deepEqual(ok, { ok: true, reason: "Meta ad sync is still not in use." });
  const live = await verifyNa(meta, { scope: staff({ "meta-ads": { running: 1, delivered: 0 } }), now: NOW });
  assert.equal(live.ok, false);
  assert.match(live.reason, /Meta ad sync is in use or cannot be read: 1 Meta ad is running\./);

  const lendflow = { id: "gap-door-batch-webhooks:door-batch:webhook-lendflow-contract", status: "na", na: { code: "owner-paused", args: { feature: "lendflow" } } };
  const paused = await verifyNa(lendflow, { scope: staff(QUIET), now: NOW });
  assert.equal(paused.ok, true, paused.reason);
  const arrived = await verifyNa(lendflow, { scope: staff({ lendflow: { captures: 1 } }), now: NOW });
  assert.equal(arrived.ok, false);

  const bureau = { id: `gap-door-batch-jobs:${INQUIRY_ID}`, status: "na", na: { code: "feature-not-set-up", args: { feature: "bureau-calls" } } };
  assert.equal((await verifyNa(bureau, { scope: staff(QUIET), now: NOW })).ok, true);
  assert.equal((await verifyNa(bureau, { scope: staff({ "bureau-calls": { real_calls: 1, placed: 0 } }), now: NOW })).ok, false);
  assert.equal((await verifyNa(bureau, { db: { query: async () => ({ rows: [QUIET["bureau-calls"]] }) }, now: NOW })).ok, false,
    "the plain app role can read row-security tables as empty, so it never proves a park");
});

test("verifyNa: a park claim copied onto another row, or the wrong code for a feature, is refused before any read", async () => {
  const scope = staff(QUIET);
  const copied = await verifyNa({ id: "clickfunnels-night-job", na: { code: "feature-not-set-up", args: { feature: "meta-ads" } } }, { scope, now: NOW });
  assert.equal(copied.ok, false);
  assert.match(copied.reason, /not one that meta-ads parks/);
  const wrongCode = await verifyNa({ id: "door-batch:webhook-lendflow-contract", na: { code: "feature-not-set-up", args: { feature: "lendflow" } } }, { scope, now: NOW });
  assert.equal(wrongCode.ok, false);
  const noFeature = await verifyNa({ id: "meta-sync", na: { code: "owner-paused", args: {} } }, { scope, now: NOW });
  assert.equal(noFeature.ok, false);
  assert.equal(scope.calls.length, 0);
});

test("machine: meta-sync and meta-server-events are parked with the staff view, and stay real without it", async () => {
  const metaChecks = MACHINE_CHECKS.filter((c) => c.park === "meta-ads");
  assert.deepEqual(metaChecks.map((c) => c.id), ["meta-sync", "meta-server-events"]);
  const db = {
    async query(sql) {
      const s = String(sql);
      if (/parked:meta-ads/.test(s)) return { rows: [QUIET["meta-ads"]] };
      if (/FROM ad_platform_connections WHERE platform = 'meta'\) AS connections/.test(s)) {
        return { rows: [{ last_saved: NOW.toISOString(), last_day: "2026-10-11", connections: 5, errors: "Invalid initialization vector" }] };
      }
      return { rows: [{ eligible: 4, answered: 4, sent_ok: 0, errors: 0, skipped: 4 }] };
    }
  };
  const scope = (fn) => fn(db);
  const rows = await checkMachine({ scope, now: NOW, checks: metaChecks });
  assert.deepEqual(rows.map((r) => r.status), ["na", "na"]);
  for (const r of rows) assert.equal(r.na.code, "feature-not-set-up");

  const plain = await checkMachine({ db, now: NOW, checks: metaChecks });
  assert.deepEqual(plain.map((r) => r.status), ["FAIL", "skip"], "no staff view: the real answers stand");
});

test("door-batch jobs: only the AI bureau call job is parked; every other final-job gap stays red", async () => {
  const scope = staff(QUIET);
  const rows = await jobGapChecks({ scope, now: NOW });
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get(INQUIRY_ID).status, "na");
  assert.equal(byId.get(INQUIRY_ID).na.args.feature, "bureau-calls");
  for (const row of FINAL_JOB_GAP_ROWS) {
    if (row.id !== INQUIRY_ID) assert.equal(byId.get(row.id).status, "FAIL", row.id);
  }
  const inUse = await jobGapChecks({ scope: staff({ ...QUIET, "bureau-calls": { real_calls: 1, placed: 0 } }), now: NOW });
  assert.equal(inUse.find((r) => r.id === INQUIRY_ID).status, "FAIL");
});

test("door-batch webhooks: the Lendflow contract row is owner-paused while paused, and red the day a key is set", async () => {
  const paused = await webhookGapChecks({ scope: staff(QUIET), env: NO_KEYS, now: NOW });
  const lf = paused.find((r) => r.id === "door-batch:webhook-lendflow-contract");
  assert.equal(lf.status, "na");
  assert.deepEqual(lf.na, { code: "owner-paused", args: { feature: "lendflow" } });
  const keyed = await webhookGapChecks({ scope: staff(QUIET), env: { LENDFLOW_WEBHOOK_SECRET: "real-secret-value" }, now: NOW });
  assert.equal(keyed.find((r) => r.id === "door-batch:webhook-lendflow-contract").status, "FAIL");
});

test("keys: an unset Lendflow secret is named as not judged only while Lendflow is proved paused", () => {
  const env = { NETLIFY: "true", CONTEXT: "production" };
  for (const { name } of LAUNCH_SECRETS) env[name] = `real-${name.toLowerCase()}-value`;
  delete env.LENDFLOW_WEBHOOK_SECRET;
  const red = launchSecretsPresent(env);
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /LENDFLOW_WEBHOOK_SECRET/);
  const parked = launchSecretsPresent(env, { parked: [{ name: "LENDFLOW_WEBHOOK_SECRET", why: "Lendflow is paused by the owner" }] });
  assert.equal(parked.status, "PASS", parked.detail);
  assert.match(parked.detail, /All 20 launch keys judged are set to real values on the live site\. Not judged: LENDFLOW_WEBHOOK_SECRET \(Lendflow is paused by the owner\)\./);
  // Another missing key is still red while Lendflow is parked.
  delete env.RESEND_API_KEY;
  const other = launchSecretsPresent(env, { parked: [{ name: "LENDFLOW_WEBHOOK_SECRET", why: "paused" }] });
  assert.equal(other.status, "FAIL");
  assert.match(other.detail, /RESEND_API_KEY/);
  assert.doesNotMatch(other.detail.split("Not judged")[0], /LENDFLOW_WEBHOOK_SECRET/);
});
