// The self-audit (src/pulse/self-audit.mjs). Every audit row has a test that
// passes and a test that fails for the right reason, so none of them can be a
// row that only ever says green.
//
// Two helpers built in the same batch are injected here, so this file runs on
// its own: verifyNa (the nothing-to-judge checker) and the scorecard mapping
// for `na` rows. A_CONTRACT below is that mapping as the batch contract
// writes it. The tests with no `na` row use the real scorecard instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Inngest } from "inngest";

import {
  AUDIT_BUDGET_MS,
  AUDIT_COVERS,
  AUDIT_ROW_IDS,
  BRIEFS_SENT_SQL,
  NAMED_PULSE_IDS,
  auditPulse,
  buildManifest,
  loadManifest,
  makeLaneNaVerify,
  notLiveIds
} from "./self-audit.mjs";
import { INNGEST_JOBS, JOBS } from "./heartbeats.mjs";
import { PULSE_REGISTRY } from "./registry.mjs";
import { runDailyPulse } from "./daily-pulse.mjs";
import { loadGapModules, loadSliceModules, namespaceGapId, runCoverageSlices, runGapLane } from "./coverage/run-slices.mjs";
import { GAP_FILES } from "./coverage/modules.mjs";
import { functions as bundledFunctions } from "../workflows/index.mjs";
import { inngest } from "../workflows/client.mjs";

// ── fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date("2026-10-09T13:00:00Z"); // 6:00 a.m. in Arizona; yesterday is 2026-10-08
const SHARED = { name: "the shared client" };
const OTHER = { name: "some other client" };
const CRON_JOB = INNGEST_JOBS[0][0];

/* The status mapping the batch contract gives the scorecard (piece A): `na`
   with a valid na object lands na; PASS/up needs a proof line to be green. */
const A_CONTRACT = {
  toContractCheck(c) {
    const raw = String(c.status || "");
    const proof = String(c.detail || "").trim();
    let status = "not_checked";
    if (raw === "PASS" || raw === "up") status = proof ? "green" : "not_checked";
    else if (raw === "FAIL" || raw === "down") status = "red";
    else if (raw === "na" && c.na && typeof c.na.code === "string" && c.na.args && typeof c.na.args === "object") status = "na";
    return { id: String(c.id), status };
  },
  countChecks(checks) {
    const n = { green: 0, red: 0, na: 0, not_checked: 0 };
    for (const c of checks) n[c.status] = (n[c.status] || 0) + 1;
    return n;
  }
};

const okVerify = async () => ({ ok: true, reason: "" });

function fn(id, triggers, client = SHARED) {
  return { opts: { id, triggers }, client };
}

function briefsDb(rowOrNull, calls = []) {
  return {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: rowOrNull ? [rowOrNull] : [] };
    }
  };
}

const SENT = { delivery_status: "sent", delivery_error: null };

/** A clean run: every audit row is green. `na: false` swaps the na rows for PASS rows. */
function fixture({ na = true, db = briefsDb(SENT) } = {}) {
  const functions = [
    fn(CRON_JOB, [{ cron: "*/15 * * * *" }]),
    fn("evt-a", [{ event: "round.started" }]),
    fn("evt-off", [])
  ];
  const wfA = na
    ? {
      id: "wf:evt-a",
      kind: "coverage",
      group: "jobs",
      status: "na",
      detail: "No round.started event came since 10-06. Judged the day one comes.",
      na: { code: "no-demand", args: { names: ["round.started"], since: "2026-10-06T13:00:00.000Z" } }
    }
    : { id: "wf:evt-a", kind: "coverage", group: "jobs", status: "PASS", detail: "Ran fine." };
  const wfOff = na
    ? {
      id: "wf:evt-off",
      kind: "coverage",
      group: "jobs",
      status: "na",
      detail: "Turned off in code (no trigger). Judged the day a trigger is put back.",
      na: { code: "no-trigger", args: { id: "evt-off" } }
    }
    : { id: "wf:evt-off", kind: "coverage", group: "jobs", status: "PASS", detail: "Turned off." };
  const checks = [
    { id: "health", status: "PASS", detail: "strict health answered 200" },
    { id: "reg:home", kind: "registry", path: "/", status: "up", detail: "/ 200" },
    { id: `job:${CRON_JOB}`, group: "jobs", status: "PASS", detail: "last run ok" },
    wfA,
    wfOff,
    { id: "06-briefs:evening-brief", sliceId: "06-briefs", checkId: "evening-brief", kind: "coverage", status: "PASS", detail: "ran" },
    {
      id: "06-briefs:morning-brief",
      sliceId: "06-briefs",
      checkId: "morning-brief",
      kind: "coverage",
      status: "not checked",
      detail: "Not checked. No last-success time in the database."
    },
    { id: "gap-ads:pacing", sliceId: "gap-ads", checkId: "pacing", kind: "coverage", status: "PASS", detail: "fine" }
  ];
  const manifest = buildManifest({
    registry: [{ id: "home" }],
    jobs: [{ job: CRON_JOB }],
    functions,
    sliceModules: [{ sliceId: "06-briefs", CHECKS: [{ id: "morning-brief" }, { id: "evening-brief" }] }],
    gapModules: [{ sliceId: "gap-ads", mod: { CHECK_IDS: ["pacing"] } }],
    namedIds: ["health"],
    notLive: []
  });
  return { checks, functions, manifest, db };
}

async function run(over = {}, fx = fixture()) {
  return auditPulse({
    checks: fx.checks,
    folded: 3,
    manifest: fx.manifest,
    functions: fx.functions,
    gapLanes: ["gap-ads"],
    db: fx.db,
    now: NOW,
    verifyNa: okVerify,
    sharedClient: SHARED,
    contract: A_CONTRACT,
    ...over
  });
}

const rowOf = (res, id) => res.rows.find((r) => r.id === id);

// ── the clean run ────────────────────────────────────────────────────────────

test("a clean run makes every audit row green, in the contract order", async () => {
  const res = await run();
  assert.deepEqual(res.rows.map((r) => r.id), [
    "audit:not-checked",
    "audit:na-verified",
    "audit:totals",
    "audit:expected-present",
    "audit:lanes-ran",
    "audit:workflow-coverage",
    "audit:briefs-sent"
  ]);
  for (const r of res.rows) {
    assert.equal(r.status, "PASS", `${r.id}: ${r.detail}`);
    assert.equal(r.group, "backend");
    assert.ok(r.detail.length > 10, `${r.id} needs a proof line`);
  }
});

test("the audit rows are one row each and stay unique when the audit runs", async () => {
  const res = await run();
  const ids = res.rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  const all = [...res.checks, ...res.rows].map((r) => r.id);
  assert.equal(new Set(all).size, all.length);
});

test("the audit never changes the rows it was handed", async () => {
  const fx = fixture();
  fx.checks.push({ id: "gone", status: "na", detail: "x", na: { code: "no-demand", args: {} } });
  const before = structuredClone(fx.checks);
  const res = await run({ verifyNa: async (row) => ({ ok: row.id !== "gone", reason: "no" }) }, fx);
  assert.deepEqual(fx.checks, before);
  assert.notEqual(res.checks, fx.checks);
});

test("with no contract given, the real scorecard mapping is used (a PASS with no proof goes red)", async () => {
  const fx = fixture({ na: false });
  assert.equal(rowOf(await run({ contract: null }, fx), "audit:not-checked").status, "PASS");
  fx.checks.push({ id: "reg:bare", status: "up", detail: "" });
  const bad = rowOf(await run({ contract: null }, fx), "audit:not-checked");
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /reg:bare/);
});

// ── audit:not-checked ────────────────────────────────────────────────────────

test("audit:not-checked is red and names the ids when a row lands not checked", async () => {
  const fx = fixture();
  fx.checks.push({ id: "slice-x:one", status: "skip", detail: "key masked" });
  const r = rowOf(await run({}, fx), "audit:not-checked");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^1 check was not checked: slice-x:one\./);
  assert.match(r.detail, /A live thing that is not checked is a break in the heartbeat/);
  assert.match(r.suggestedFix, /src\/pulse\/na-conditions\.mjs/);
});

test("audit:not-checked is one row, lists only the first ten ids, and counts the rest", async () => {
  const fx = fixture();
  for (let i = 0; i < 30; i++) fx.checks.push({ id: `bulk:${i}`, status: "not checked", detail: "Not checked." });
  const res = await run({}, fx);
  assert.equal(res.rows.filter((r) => r.id === "audit:not-checked").length, 1);
  const r = rowOf(res, "audit:not-checked");
  assert.match(r.detail, /^30 checks were not checked: /);
  assert.match(r.detail, /bulk:9/);
  assert.doesNotMatch(r.detail, /bulk:10\b/);
  assert.match(r.detail, /and 20 more/);
});

test("audit:not-checked also counts the audit's own skip rows", async () => {
  const fx = fixture({ db: null });
  const res = await run({}, fx);
  assert.equal(rowOf(res, "audit:briefs-sent").status, "skip");
  const r = rowOf(res, "audit:not-checked");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /audit:briefs-sent/);
});

// ── audit:na-verified ────────────────────────────────────────────────────────

test("audit:na-verified is green and counts the nothing-to-judge rows that are still true", async () => {
  const r = rowOf(await run(), "audit:na-verified");
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /^All 2 "nothing to judge" rows were checked again and are still true\./);
});

test("audit:na-verified goes red when a reason is no longer true, and the row stops being quiet", async () => {
  const verifyNa = async (row) => (row.id === "wf:evt-a"
    ? { ok: false, reason: "3 round.started events came." }
    : { ok: true, reason: "" });
  const res = await run({ verifyNa });
  const r = rowOf(res, "audit:na-verified");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^1 of 2 "nothing to judge" rows was not true any more: wf:evt-a\./);

  const replaced = res.checks.find((c) => c.id === "wf:evt-a");
  assert.equal(replaced.status, "skip");
  assert.equal("na" in replaced, false);
  assert.equal(replaced.kind, "coverage");
  assert.match(replaced.detail, /^Said nothing to judge, but ".*" is not true\. 3 round\.started events came\.$/);
  assert.match(replaced.detail, /No round\.started event came since 10-06/);
  // The other quiet row is left alone.
  assert.equal(res.checks.find((c) => c.id === "wf:evt-off").status, "na");
  // The replaced row lands not checked, so the one aggregate row names it.
  const nc = rowOf(res, "audit:not-checked");
  assert.equal(nc.status, "FAIL");
  assert.match(nc.detail, /wf:evt-a/);
});

test("an unknown code or missing args (verifyNa says not ok) cannot stay quiet", async () => {
  const fx = fixture();
  fx.checks.push({ id: "wf:no-object", status: "na", detail: "Nothing to judge." });
  const verifyNa = async (row) => (row.na ? { ok: true, reason: "" } : { ok: false, reason: "It gave no condition." });
  const res = await run({ verifyNa }, fx);
  assert.equal(rowOf(res, "audit:na-verified").status, "FAIL");
  assert.equal(res.checks.find((c) => c.id === "wf:no-object").status, "skip");
});

test("a verify that throws counts as not true and the error text is kept", async () => {
  const res = await run({ verifyNa: async () => { throw new Error("events table gone"); } });
  assert.equal(rowOf(res, "audit:na-verified").status, "FAIL");
  assert.match(res.checks.find((c) => c.id === "wf:evt-a").detail, /events table gone/);
});

test("verifyNa gets the row and the pulse's own handles", async () => {
  const seen = [];
  const laneNaVerify = async () => true;
  const scope = async (f) => f({});
  const db = briefsDb(SENT);
  await run({
    db,
    scope,
    laneNaVerify,
    verifyNa: async (row, ctx) => { seen.push([row.id, ctx]); return { ok: true, reason: "" }; }
  }, fixture({ db }));
  assert.equal(seen.length, 2);
  for (const [, ctx] of seen) {
    assert.equal(ctx.db, db);
    assert.equal(ctx.scope, scope);
    assert.equal(ctx.now, NOW);
    assert.equal(ctx.laneNaVerify, laneNaVerify);
    assert.ok(Array.isArray(ctx.functions));
  }
});

test("rows with the same code, args and lane are checked once; different args are checked again", async () => {
  const fx = fixture();
  const same = { code: "no-demand", args: { names: ["a.b"], since: "2026-10-06" } };
  fx.checks.push(
    { id: "wf:m1", status: "na", detail: "x.", na: same },
    { id: "wf:m2", status: "na", detail: "x.", na: { code: same.code, args: { since: "2026-10-06", names: ["a.b"] } } },
    { id: "wf:m3", status: "na", detail: "x.", na: { code: same.code, args: { names: ["c.d"], since: "2026-10-06" } } }
  );
  let calls = 0;
  await run({ verifyNa: async () => { calls += 1; return { ok: true, reason: "" }; } }, fx);
  assert.equal(calls, 4); // wf:evt-a, wf:evt-off, one for m1+m2 together, one for m3
});

test("at most eight nothing-to-judge checks run at the same time", async () => {
  const fx = fixture();
  for (let i = 0; i < 40; i++) {
    fx.checks.push({ id: `wf:c${i}`, status: "na", detail: "x.", na: { code: "no-demand", args: { n: i } } });
  }
  let open = 0;
  let peak = 0;
  await run({
    verifyNa: async () => {
      open += 1;
      peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 5));
      open -= 1;
      return { ok: true, reason: "" };
    }
  }, fx);
  assert.ok(peak > 1 && peak <= 8, `peak was ${peak}`);
});

test("a nothing-to-judge check that never answers is cut off inside the budget and counts as not true", async () => {
  const started = Date.now();
  const res = await run({ budgetMs: 60, verifyNa: () => new Promise(() => {}) });
  assert.ok(Date.now() - started < 1500, "the audit must not wait forever");
  assert.equal(rowOf(res, "audit:na-verified").status, "FAIL");
  assert.match(res.checks.find((c) => c.id === "wf:evt-a").detail, /took too long|ran out of time/);
  assert.ok(AUDIT_BUDGET_MS <= 3000);
});

test("a row that is not na is never sent to verifyNa", async () => {
  const fx = fixture({ na: false });
  let calls = 0;
  await run({ verifyNa: async () => { calls += 1; return { ok: true, reason: "" }; } }, fx);
  assert.equal(calls, 0);
});

// ── audit:totals ─────────────────────────────────────────────────────────────

test("audit:totals is green and shows how the numbers add up", async () => {
  const r = rowOf(await run(), "audit:totals");
  assert.equal(r.status, "PASS");
  // 8 checks - 1 claim the audit folds = 7, plus the 7 audit rows = 14.
  assert.match(r.detail, /14 rows = 12 green \+ 0 red \+ 2 with nothing to judge \+ 0 not checked\./);
  assert.match(r.detail, /3 claims were folded/);
});

test("audit:totals goes red when two rows share one id", async () => {
  const fx = fixture();
  fx.checks.push({ id: "health", status: "PASS", detail: "again" });
  const r = rowOf(await run({}, fx), "audit:totals");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /health appears 2 times/);
});

test("audit:totals goes red on a status the report does not use", async () => {
  const fx = fixture();
  fx.checks.push({ id: "odd", status: "WARN", detail: "maybe" });
  const r = rowOf(await run({}, fx), "audit:totals");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /odd has an unknown status "WARN"/);
});

test("audit:totals goes red when a row lands outside the four stored statuses", async () => {
  const contract = {
    toContractCheck: (c) => ({ ...A_CONTRACT.toContractCheck(c), status: c.id === "health" ? "maybe" : A_CONTRACT.toContractCheck(c).status }),
    countChecks: A_CONTRACT.countChecks
  };
  const r = rowOf(await run({ contract }), "audit:totals");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /health landed on a status outside the four/);
});

test("audit:totals goes red when the four counts do not add up to the rows", async () => {
  const contract = { ...A_CONTRACT, countChecks: () => ({ green: 1, red: 0, na: 0, not_checked: 0 }) };
  const r = rowOf(await run({ contract }), "audit:totals");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /the four counts add to 1, but there are 14 rows/);
});

test("audit:totals goes red on a folded count that is not a whole number, and ignores none", async () => {
  assert.equal(rowOf(await run({ folded: -2 }), "audit:totals").status, "FAIL");
  assert.equal(rowOf(await run({ folded: "3" }), "audit:totals").status, "FAIL");
  assert.equal(rowOf(await run({ folded: undefined }), "audit:totals").status, "PASS");
  assert.equal(rowOf(await run({ folded: null }), "audit:totals").status, "PASS");
});

// ── audit:expected-present ───────────────────────────────────────────────────

test("audit:expected-present is green when every manifest id is in the run, or in an also list", async () => {
  const r = rowOf(await run(), "audit:expected-present");
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /^All 8 checks that should run showed up\./);
});

test("audit:expected-present goes red and names a check that went missing", async () => {
  const fx = fixture();
  fx.checks = fx.checks.filter((c) => c.id !== "wf:evt-a" && c.id !== "reg:home");
  const r = rowOf(await run({}, fx), "audit:expected-present");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^2 checks that should have run did not show up: reg:home, wf:evt-a\./);
});

test("audit:expected-present counts an id that was folded into another row's also list", async () => {
  const fx = fixture();
  fx.checks = fx.checks.filter((c) => c.id !== "gap-ads:pacing");
  fx.checks.find((c) => c.id === "health").also = ["gap-ads:pacing"];
  assert.equal(rowOf(await run({}, fx), "audit:expected-present").status, "PASS");
});

test("audit:expected-present finds a lane id even when a duplicate got a #2 suffix", async () => {
  const fx = fixture();
  const lane = fx.checks.find((c) => c.id === "gap-ads:pacing");
  lane.id = "gap-ads:pacing#2";
  assert.equal(rowOf(await run({}, fx), "audit:expected-present").status, "PASS");
});

test("audit:expected-present goes red when the list itself is empty", async () => {
  const fx = fixture();
  const r = rowOf(await run({ manifest: { ids: new Set(), byGroup: {} } }, fx), "audit:expected-present");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /is empty/);
});

test("audit:expected-present builds the live list when none is given, and flags what a bare fixture lacks", async () => {
  const fx = fixture();
  const res = await run({ manifest: null, notLiveRows: [] }, fx);
  const r = rowOf(res, "audit:expected-present");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /did not show up: /);
  assert.match(r.detail, /and \d+ more/);
});

test("audit:expected-present is a skip, not a pass, when the list cannot be built", async () => {
  const bomb = new Proxy([], { get(t, p) { if (p === "map") throw new Error("link.mjs is broken"); return Reflect.get(t, p); } });
  const res = await run({ manifest: null, notLiveRows: bomb });
  const r = rowOf(res, "audit:expected-present");
  assert.equal(r.status, "skip");
  assert.match(r.detail, /link\.mjs is broken/);
  assert.equal(rowOf(res, "audit:not-checked").status, "FAIL");
});

// ── audit:lanes-ran ──────────────────────────────────────────────────────────

test("audit:lanes-ran is green when every lane gave a row and nothing failed to load", async () => {
  const r = rowOf(await run(), "audit:lanes-ran");
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /^The 1 gap lane answered and no slice file failed to load\./);
});

test("audit:lanes-ran goes red and names a lane that gave no rows", async () => {
  const r = rowOf(await run({ gapLanes: ["gap-ads", "gap-keys"] }), "audit:lanes-ran");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^1 group of checks did not finish: gap-keys\.mjs \(gave no rows\)\./);
});

for (const [checkId, why] of [
  ["step", "did not finish"],
  ["threw", "threw, or would not load"],
  ["not-listed", "is not on the list in modules.mjs"],
  ["bad-row", "sent back an empty row"]
]) {
  test(`audit:lanes-ran goes red when a lane's row says ${checkId}`, async () => {
    const fx = fixture();
    fx.checks.push({ id: `gap-ads:${checkId}`, sliceId: "gap-ads", checkId, kind: "coverage", status: "skip", detail: "it died" });
    const r = rowOf(await run({}, fx), "audit:lanes-ran");
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, new RegExp(`gap-ads\\.mjs \\(${why.replace(/[.,]/g, "\\$&")}\\)`));
  });
}

test("audit:lanes-ran reads the step skip the 6 a.m. job writes (its sliceId carries ':step')", async () => {
  const fx = fixture();
  fx.checks.push({ id: "gap-ads:step", sliceId: "gap-ads:step", checkId: "step", kind: "coverage", status: "skip", detail: "x" });
  const r = rowOf(await run({}, fx), "audit:lanes-ran");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /gap-ads\.mjs \(did not finish\)/);
});

test("audit:lanes-ran names the slice file that would not load", async () => {
  const fx = fixture();
  fx.checks.push({
    id: "slice-99-x:load-error",
    sliceId: "slice-99-x",
    checkId: "load-error",
    kind: "coverage",
    status: "not checked",
    detail: "Not checked. No last-success time in the database. Slice note: Could not load slice-99-x.mjs: Cannot find module. Not checked."
  });
  const r = rowOf(await run({}, fx), "audit:lanes-ran");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /slice-99-x\.mjs \(could not load\)/);
});

test("audit:lanes-ran also catches the slice pass dying as a whole", async () => {
  const fx = fixture();
  fx.checks.push({ id: "coverage-slices", sliceId: "coverage-slices", checkId: "step", kind: "coverage", status: "skip", detail: "x" });
  const r = rowOf(await run({}, fx), "audit:lanes-ran");
  assert.match(r.detail, /coverage-slices \(did not finish\)/);
});

test("audit:lanes-ran is a skip, not a pass, when it was not told which lanes ran", async () => {
  const r = rowOf(await run({ gapLanes: null }), "audit:lanes-ran");
  assert.equal(r.status, "skip");
});

// ── audit:workflow-coverage ──────────────────────────────────────────────────

test("audit:workflow-coverage is green when all three rules hold", async () => {
  const r = rowOf(await run(), "audit:workflow-coverage");
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /^All 3 bundled workflows/);
});

test("audit:workflow-coverage goes red for a workflow not made on the shared client", async () => {
  const fx = fixture();
  fx.functions.push(fn("rogue", [{ event: "x.y" }], OTHER));
  fx.checks.push({ id: "wf:rogue", status: "PASS", detail: "ok" });
  const r = rowOf(await run({}, fx), "audit:workflow-coverage");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /rogue \(not on the shared client/);
});

test("audit:workflow-coverage goes red for a cron that is not on INNGEST_JOBS", async () => {
  const fx = fixture();
  fx.functions.push(fn("not-a-listed-job", [{ cron: "0 * * * *" }]));
  const r = rowOf(await run({}, fx), "audit:workflow-coverage");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /not-a-listed-job \(a cron that is not on INNGEST_JOBS\)/);
});

test("audit:workflow-coverage goes red for an event workflow with no wf: row", async () => {
  const fx = fixture();
  fx.checks = fx.checks.filter((c) => c.id !== "wf:evt-a");
  const r = rowOf(await run({}, fx), "audit:workflow-coverage");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /evt-a \(no wf: row\)/);
});

test("audit:workflow-coverage is a skip, not a pass, with no workflow list", async () => {
  assert.equal(rowOf(await run({ functions: null }), "audit:workflow-coverage").status, "skip");
});

test("audit:workflow-coverage uses the real shared client when none is injected", async () => {
  const fx = fixture();
  const real = [fn(CRON_JOB, [{ cron: "*/15 * * * *" }], inngest), fn("evt-a", [{ event: "round.started" }], inngest), fn("evt-off", [], inngest)];
  const ok = await run({ sharedClient: null, functions: real }, fx);
  assert.equal(rowOf(ok, "audit:workflow-coverage").status, "PASS");
  const stranger = new Inngest({ id: "somebody-else" });
  const bad = await run({ sharedClient: null, functions: [...real, fn("x", [{ event: "a.b" }], stranger)] }, fx);
  assert.equal(rowOf(bad, "audit:workflow-coverage").status, "FAIL");
});

test("audit:workflow-coverage agrees with today's real bundle: no false red for the real workflows", async () => {
  const wf = bundledFunctions
    .filter((f) => !f.opts.triggers.some((t) => t.cron))
    .map((f) => ({ id: `wf:${f.opts.id}`, kind: "coverage", group: "jobs", status: "PASS", detail: "ok" }));
  assert.ok(wf.length >= 60, `expected about 65 non-cron workflows, got ${wf.length}`);
  const res = await auditPulse({
    checks: wf,
    functions: bundledFunctions,
    gapLanes: [],
    manifest: { ids: new Set(["wf:x"]), byGroup: {} },
    db: briefsDb(SENT),
    now: NOW,
    verifyNa: okVerify,
    contract: A_CONTRACT
  });
  const r = rowOf(res, "audit:workflow-coverage");
  assert.equal(r.status, "PASS", r.detail);
});

// ── audit:briefs-sent ────────────────────────────────────────────────────────

test("audit:briefs-sent is green when yesterday's morning report was sent, and asks for the right day", async () => {
  const calls = [];
  const db = briefsDb(SENT, calls);
  const r = rowOf(await run({ db }, fixture({ db })), "audit:briefs-sent");
  assert.equal(r.status, "PASS");
  assert.equal(r.detail, "The morning report for 2026-10-08 was sent.");
  assert.equal(calls.length, 1, "one read");
  assert.equal(calls[0].sql, BRIEFS_SENT_SQL);
  assert.deepEqual(calls[0].params, [null, "2026-10-08"]);
  assert.match(BRIEFS_SENT_SQL, /kind = 'morning'/);
  assert.doesNotMatch(BRIEFS_SENT_SQL, /evening/);
});

test("audit:briefs-sent uses the Arizona day, not the UTC day", async () => {
  const calls = [];
  const db = briefsDb(SENT, calls);
  // 05:00 UTC is 10 p.m. the evening before in Arizona.
  await run({ db, now: new Date("2026-10-09T05:00:00Z") }, fixture({ db }));
  assert.deepEqual(calls[0].params, [null, "2026-10-07"]);
});

test("audit:briefs-sent passes a named company through", async () => {
  const calls = [];
  const db = briefsDb(SENT, calls);
  await run({ db, orgId: "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6" }, fixture({ db }));
  assert.equal(calls[0].params[0], "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6");
});

test("audit:briefs-sent goes red when there is no row for yesterday", async () => {
  const db = briefsDb(null);
  const r = rowOf(await run({ db }, fixture({ db })), "audit:briefs-sent");
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^No morning report was sent for 2026-10-08\. There is no row for that day\./);
  assert.equal(r.customerSees, "Chris did not get the morning report.");
});

for (const [status, error, expected] of [
  ["held_quiet_hours", null, /held back for the quiet hours and never sent/],
  ["failed", "Twilio 21614", /Sending it failed\. Error: Twilio 21614/],
  ["dry_run", null, /only a dry run/],
  ["no_number", null, /no phone number/]
]) {
  test(`audit:briefs-sent goes red when yesterday's row says ${status}`, async () => {
    const db = briefsDb({ delivery_status: status, delivery_error: error });
    const r = rowOf(await run({ db }, fixture({ db })), "audit:briefs-sent");
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, expected);
  });
}

test("audit:briefs-sent is a skip, not a pass, when the read fails or there is no database", async () => {
  const dead = { query: async () => { throw new Error("connection refused"); } };
  const r1 = rowOf(await run({ db: dead }, fixture({ db: dead })), "audit:briefs-sent");
  assert.equal(r1.status, "skip");
  assert.match(r1.detail, /connection refused/);
  const r2 = rowOf(await run({ db: null }, fixture({ db: null })), "audit:briefs-sent");
  assert.equal(r2.status, "skip");
});

test("audit:briefs-sent gives up on a read that hangs", async () => {
  const hang = { query: () => new Promise(() => {}) };
  const started = Date.now();
  const r = rowOf(await run({ db: hang }, fixture({ db: hang })), "audit:briefs-sent");
  assert.ok(Date.now() - started < 3500);
  assert.equal(r.status, "skip");
  assert.match(r.detail, /took too long/);
});

test("the morning-brief claim folds into audit:briefs-sent (the audit does it, same meaning as foldCoverage)", async () => {
  assert.deepEqual([...AUDIT_COVERS["audit:briefs-sent"]], ["06-briefs:morning-brief"]);
  const res = await run();
  assert.equal(res.checks.some((c) => c.id === "06-briefs:morning-brief"), false);
  assert.deepEqual(rowOf(res, "audit:briefs-sent").also, ["06-briefs:morning-brief"]);
  assert.equal(res.folded, 1);
  // It was present in the manifest and is still counted present, through the also list.
  assert.equal(rowOf(res, "audit:expected-present").status, "PASS");
});

test("a claim that already has a real answer is not folded away", async () => {
  const fx = fixture();
  fx.checks.find((c) => c.id === "06-briefs:morning-brief").status = "PASS";
  const res = await run({}, fx);
  assert.equal(res.checks.some((c) => c.id === "06-briefs:morning-brief"), true);
  assert.equal(rowOf(res, "audit:briefs-sent").also, undefined);
  assert.equal(res.folded, 0);
});

test("a claim folded into a red briefs row is still carried, so the red is not lost", async () => {
  const db = briefsDb(null);
  const res = await run({ db }, fixture({ db }));
  assert.equal(rowOf(res, "audit:briefs-sent").status, "FAIL");
  assert.deepEqual(rowOf(res, "audit:briefs-sent").also, ["06-briefs:morning-brief"]);
  assert.equal(res.checks.some((c) => c.id === "06-briefs:morning-brief"), false);
});

// ── audit:crashed ────────────────────────────────────────────────────────────

test("if the audit itself breaks, the input comes back unchanged with one red audit:crashed row", async () => {
  const checks = [{ id: "health", status: "PASS", detail: "ok" }, null];
  const res = await auditPulse({ checks, manifest: { ids: new Set(["health"]) }, functions: [], gapLanes: [], db: briefsDb(SENT), now: NOW, verifyNa: okVerify, contract: A_CONTRACT });
  assert.equal(res.checks, checks);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].id, "audit:crashed");
  assert.equal(res.rows[0].status, "FAIL");
  assert.match(res.rows[0].detail, /The self-audit itself failed: /);
});

test("auditPulse never throws, even with nothing", async () => {
  const res = await auditPulse();
  assert.equal(res.rows[0].id, "audit:crashed");
  assert.deepEqual(res.checks, []);
});

// ── buildManifest, loadManifest, helpers ─────────────────────────────────────

test("buildManifest lists every group and leaves crons out of the workflow group", () => {
  const m = buildManifest({
    registry: [{ id: "a" }, { id: "b" }],
    jobs: [{ job: "j1" }, { job: "j2" }],
    functions: [fn("c1", [{ cron: "* * * * *" }]), fn("e1", [{ event: "x.y" }]), fn("off", [])],
    sliceModules: [{ sliceId: "01-s", CHECKS: [{ id: "one" }, { id: "load-error" }] }],
    gapModules: [{ sliceId: "gap-leads", mod: { CHECK_IDS: ["lead:pipe-cut", "leads:own", 7] } }, { sliceId: "gap-ads", mod: {} }],
    namedIds: ["health"]
  });
  assert.deepEqual(m.byGroup.reg, ["reg:a", "reg:b"]);
  assert.deepEqual(m.byGroup.job, ["job:j1", "job:j2"]);
  assert.deepEqual(m.byGroup.wf, ["wf:e1", "wf:off"]);
  assert.deepEqual(m.byGroup.slice, ["01-s:one"]);
  assert.deepEqual(m.byGroup.gap, ["gap-leads:lead:pipe-cut", "leads:own"]);
  assert.deepEqual(m.byGroup.named, ["health"]);
  assert.equal(m.ids.size, 10);
});

test("buildManifest leaves out claims that left the scorecard (NOT_LIVE_ROWS) in every shape", () => {
  const base = { sliceModules: [{ sliceId: "02-daily-pulse", CHECKS: [{ id: "keep" }, { id: "script-dry-run-default" }] }] };
  const shapes = [
    ["02-daily-pulse:script-dry-run-default"],
    [{ id: "02-daily-pulse:script-dry-run-default", reason: "gone" }],
    { "02-daily-pulse:script-dry-run-default": "gone" },
    new Set(["02-daily-pulse:script-dry-run-default"]),
    new Map([["02-daily-pulse:script-dry-run-default", "gone"]])
  ];
  for (const notLive of shapes) {
    const m = buildManifest({ registry: [], jobs: [], namedIds: [], ...base, notLive });
    assert.deepEqual(m.byGroup.slice, ["02-daily-pulse:keep"]);
  }
  assert.deepEqual(buildManifest({ registry: [], jobs: [], namedIds: [], ...base, notLive: [] }).byGroup.slice.length, 2);
});

test("notLiveIds copes with nothing and with junk", () => {
  assert.equal(notLiveIds(null).size, 0);
  assert.equal(notLiveIds(undefined).size, 0);
  assert.equal(notLiveIds(7).size, 0);
  assert.deepEqual([...notLiveIds([null, "", { id: "a" }, { claim: "b" }, "c"])], ["a", "b", "c"]);
});

test("makeLaneNaVerify calls the lane's own naVerify with the pulse's handles", async () => {
  const seen = [];
  const mod = { naVerify: { "no-real-lead": async (args, ctx) => { seen.push([args, ctx]); return true; } } };
  const db = {};
  const scope = () => {};
  const verify = makeLaneNaVerify({
    db,
    scope,
    now: NOW,
    gapFiles: [["gap-leads.mjs", async () => mod], ["gap-bare.mjs", async () => ({})]]
  });
  assert.equal(await verify("gap-leads", "no-real-lead", { days: 3 }), true);
  assert.deepEqual(seen[0][0], { days: 3 });
  assert.equal(seen[0][1].db, db);
  assert.equal(seen[0][1].scope, scope);
  assert.equal(seen[0][1].now, NOW);
  assert.equal(await verify("gap-leads.mjs", "no-real-lead", {}), true);
  assert.equal(await verify("gap-leads", "other-code", {}), undefined, "no verifier for that code");
  assert.equal(await verify("gap-bare", "no-real-lead", {}), undefined, "lane has no naVerify");
  assert.equal(await verify("gap-missing", "no-real-lead", {}), undefined, "no such lane");
});

test("makeLaneNaVerify finds the real lane files by id (no verifier yet is undefined, not a throw)", async () => {
  const verify = makeLaneNaVerify({ gapFiles: GAP_FILES });
  const out = await verify("gap-closer", "no-real-lead", {});
  assert.ok(out === undefined || typeof out === "boolean");
});

// ── the manifest against the real code ───────────────────────────────────────

function tmpBoard() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "self-audit-"));
}

test("the manifest's registry, job and named ids are all in a real pulse run (drift guard)", async () => {
  const board = tmpBoard();
  const result = await runDailyPulse({
    dryRun: true,
    now: NOW,
    fetchImpl: async () => ({ status: 200, text: async () => "" }),
    boardDir: board,
    env: {},
    gateRelayDirs: null,
    sendPulseText: false,
    recordRun: false,
    coverageRows: [],
    sendWhatsApp: async () => ({ status: "sent" })
  });
  const emitted = new Set(result.checks.map((c) => c.id));
  const m = buildManifest({ functions: [], sliceModules: [], gapModules: [] });
  const missing = [...m.byGroup.reg, ...m.byGroup.job, ...m.byGroup.named].filter((id) => !emitted.has(id));
  assert.deepEqual(missing, []);
  assert.equal(m.byGroup.reg.length, new Set(PULSE_REGISTRY.map((r) => r.id)).size);
  assert.equal(m.byGroup.job.length, JOBS.length);
  for (const id of ["health", "login", "apply", "funnel:roadmap-sales", "suggestions", "gate-relay", "recon", "unrecorded", "gmail"]) {
    assert.ok(NAMED_PULSE_IDS.includes(id), id);
  }
});

test("every real slice claim in the manifest is a row the slice pass really emits", async () => {
  const slices = await loadSliceModules();
  const m = buildManifest({ registry: [], jobs: [], namedIds: [], sliceModules: slices });
  assert.ok(m.byGroup.slice.length > 300, `only ${m.byGroup.slice.length} slice claims`);
  const rows = await runCoverageSlices({ db: null, modules: slices, gaps: false, now: NOW });
  const emitted = new Set(rows.map((r) => r.id));
  assert.deepEqual(m.byGroup.slice.filter((id) => !emitted.has(id)), []);
});

test("every gap lane that lists CHECK_IDS emits every one of them, even with a dead database", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("no network in this test"); };
  try {
    const modules = await loadGapModules();
    const withList = modules.filter((m) => Array.isArray(m.mod.CHECK_IDS));
    assert.ok(withList.length >= 25, `only ${withList.length} lanes list their ids`);
    const dead = { query: async () => { throw new Error("no database here"); } };
    for (const item of withList) {
      const rows = await runGapLane(item.sliceId, {
        db: dead,
        scope: null,
        now: NOW,
        fetchImpl: async () => { throw new Error("no network in this test"); },
        baseUrl: "https://fundhub.ai",
        env: {}
      });
      const have = new Set(rows.flatMap((r) => [r.id, r.checkId && namespaceGapId(r.checkId, item.sliceId)]));
      const missing = item.mod.CHECK_IDS.map((id) => namespaceGapId(id, item.sliceId)).filter((id) => !have.has(id));
      assert.deepEqual(missing, [], `${item.sliceId} did not emit ${missing.join(", ")}`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("loadManifest builds the live list from the named slice and gap files", async () => {
  const m = await loadManifest({ functions: bundledFunctions, notLiveRows: [] });
  assert.equal(m.byGroup.reg.length, new Set(PULSE_REGISTRY.map((r) => r.id)).size);
  assert.equal(m.byGroup.job.length, JOBS.length);
  assert.ok(m.byGroup.wf.length >= 60);
  assert.ok(m.byGroup.slice.length > 300);
  assert.ok(m.byGroup.gap.length > 50);
  assert.equal(m.ids.size, Object.values(m.byGroup).flat().length, "no id is listed twice");
});
