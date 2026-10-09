import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { functions } from "../../workflows/index.mjs";
import { ALLOWED_UNMONITORED, PULSE_REGISTRY, coverageKey } from "../registry.mjs";
import { TRIPWIRES } from "../tripwires.mjs";
import { CHECK_IDS as CONTRACT_CHECK_IDS } from "./gap-contracts.mjs";
import { SLICE_FILES } from "./modules.mjs";
import { loadSliceModules, runCoverageSlices } from "./run-slices.mjs";
import {
  ALIASES,
  LEFT_TO_AUDIT,
  NOT_LIVE_ROWS,
  NOT_REGISTERED_ROWS,
  buildFoldIndex,
  countByTargetKind,
  foldCoverage,
  foldTargetFor,
  isNotLive,
  notRegisteredFor,
  pointAuditClaims
} from "./link.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, "../../../ops/workflows/zero-unchecked-2026-10-09/slice-link-map.json");
const NOW = new Date("2026-10-09T13:00:00Z");

function fakeFn(id, triggers) {
  return { opts: { id, triggers }, id: () => id };
}

/** A slice claim row as run-slices makes it. */
function claim(sliceId, checkId, foldInto, extra = {}) {
  return {
    id: `${sliceId}:${checkId}`,
    checkId,
    sliceId,
    kind: "coverage",
    group: "backend",
    status: "not checked",
    detail: "Not checked. Slice note: PASS",
    foldInto,
    ...extra
  };
}

function target(id, status = "up", extra = {}) {
  return { id, kind: "registry", status, detail: `${id} answered`, ...extra };
}

// ---- ALIASES, LEFT_TO_AUDIT --------------------------------------------------

test("aliases: only contracts/sign today, and morning-brief is not aliased", () => {
  assert.deepEqual(Object.keys(ALIASES), ["contracts/sign"]);
  assert.equal(ALIASES["contracts/sign"], "contracts:sign-route");
  assert.equal(Object.prototype.hasOwnProperty.call(ALIASES, "morning-brief"), false);
  // The alias points at a check the contracts lane really writes.
  assert.ok(CONTRACT_CHECK_IDS.includes(ALIASES["contracts/sign"]));
  assert.ok(TRIPWIRES["route:contracts/sign"], "the route is a money-or-customer surface");
});

test("morning-brief is left to the audit: the registry desk of the same name does not take it", () => {
  const real = buildFoldIndex({ functions });
  assert.equal(foldTargetFor({ id: "morning-brief" }, real, "06-briefs"), null);
  // Why the list is needed: another slice's row with that id WOULD fold into the page ping.
  assert.equal(foldTargetFor({ id: "morning-brief" }, real, "some-other-slice"), "reg:morning-brief");
  assert.ok(Object.keys(LEFT_TO_AUDIT).every((key) => /^\d\d-[a-z-]+:[^:]+$/.test(key)));
});

test("audit-owned claims: pointed at their audit row, a second fold takes them in; with no audit row they stay red", () => {
  assert.equal(LEFT_TO_AUDIT["06-briefs:morning-brief"].target, "audit:briefs-sent");
  const morning = claim("06-briefs", "morning-brief", undefined);
  delete morning.foldInto;
  const other = claim("06-briefs", "evening-brief", undefined);
  delete other.foldInto;

  const pointed = pointAuditClaims([morning, other]);
  assert.equal(pointed[0].foldInto, "audit:briefs-sent");
  assert.equal(pointed[1].foldInto, undefined, "only the audit-owned claim is pointed");
  assert.equal(morning.foldInto, undefined, "the input row is not changed");

  // The first fold leaves the claim alone, because it has no foldInto yet.
  const first = foldCoverage([morning, target("job:daily-pulse", "PASS")]);
  assert.equal(first.folded, 0);
  assert.deepEqual(first.dangling, []);

  // Audit row ran: the claim folds into it.
  const withAudit = foldCoverage(pointAuditClaims([morning, target("audit:briefs-sent", "PASS")]));
  assert.equal(withAudit.folded, 1);
  assert.deepEqual(withAudit.checks.map((c) => c.id), ["audit:briefs-sent"]);
  assert.deepEqual(withAudit.checks[0].also, ["06-briefs:morning-brief"]);

  // Audit row did not run: the claim stays, as a skip with the reason.
  const without = foldCoverage(pointAuditClaims([morning]));
  assert.equal(without.folded, 0);
  assert.deepEqual(without.dangling, ["06-briefs:morning-brief"]);
  assert.equal(without.checks[0].status, "skip");
  assert.match(without.checks[0].detail, /audit:briefs-sent did not run today/);
});

// ---- the fold order ------------------------------------------------------------

test("fold order: alias, then registry, then allow-list tripwire, then job, then workflow", () => {
  const index = buildFoldIndex({
    registry: [
      { id: "auth/login", kind: "api", path: "/api/auth/login" },
      { id: "pipeline", kind: "desk", path: "/app/pipeline.html" },
      { id: "home", kind: "public_static", file: "index.html", path: "/" },
      { id: "shared", kind: "api", path: "/api/shared" }
    ],
    allowed: { "public/vsl-watch": "POST only.", "contracts/sign": "404 on purpose." },
    tripwires: {
      "route:public/vsl-watch": { impact: "customer", checks: ["reg:public/vsl-watch", "job:x", "vsl:watch-stored"] }
    },
    jobs: [
      { job: "daily-thing", cron: "0 * * * *", runner: "inngest" },
      { job: "shared", cron: "0 * * * *", runner: "inngest" },
      { job: "public/vsl-watch", cron: "0 * * * *", runner: "inngest" }
    ],
    functions: [
      fakeFn("evt-flow", [{ event: "a.b" }]),
      fakeFn("cron-flow", [{ cron: "* * * * *" }]),
      fakeFn("no-trigger", []),
      fakeFn("daily-thing", [{ cron: "0 * * * *" }])
    ],
    aliases: { "old-name": "new:check", "auth/login": "aliased:login" }
  });
  const to = (id) => foldTargetFor({ id }, index);
  assert.equal(to("old-name"), "new:check");
  assert.equal(to("auth/login"), "aliased:login", "an alias beats the registry");
  assert.equal(to("pipeline.html"), "reg:pipeline", "registry by coverage key");
  assert.equal(to("pipeline"), "reg:pipeline", "registry by row id");
  assert.equal(to("index.html"), "reg:home");
  assert.equal(to("shared"), "reg:shared", "the registry beats the job list");
  assert.equal(to("public/vsl-watch"), "vsl:watch-stored", "allow-list tripwire: first check that is not a ping");
  assert.equal(to("contracts/sign"), null, "allow-listed but no tripwire entry: nothing to fold into");
  assert.equal(to("daily-thing"), "job:daily-thing");
  assert.equal(to("evt-flow"), "wf:evt-flow");
  assert.equal(to("no-trigger"), "wf:no-trigger");
  assert.equal(to("cron-flow"), null, "a cron function is a job: row, never a wf: row");
  assert.equal(to("nothing-like-this"), null);
  assert.equal(foldTargetFor({ id: "" }, index), null);
  assert.equal(foldTargetFor(null, index), null);
});

test("fold order: with no function list a workflow claim finds no target", () => {
  const index = buildFoldIndex({ registry: [], allowed: {}, tripwires: {}, jobs: [], functions: null, aliases: {} });
  assert.equal(foldTargetFor({ id: "evt-flow" }, index), null);
  assert.equal(index.hasFunctions, false);
});

test("fold order on the real tree: contracts/sign goes to its deep check, a door goes to its ping", () => {
  const index = buildFoldIndex({ functions });
  assert.equal(foldTargetFor({ id: "contracts/sign" }, index), "contracts:sign-route");
  assert.equal(foldTargetFor({ id: "auth/login" }, index), "reg:auth/login");
  assert.equal(foldTargetFor({ id: "message-dispatch-sweeper" }, index), "job:message-dispatch-sweeper");
  assert.equal(foldTargetFor({ id: "f-01-funding-intake" }, index), "wf:f-01-funding-intake");
  // The no-trigger workflows are real wf: rows (the workflow-runs piece gives them "nothing to judge").
  assert.equal(foldTargetFor({ id: "n-01-cold-nurture" }, index), "wf:n-01-cold-nurture");
});

// ---- foldCoverage ----------------------------------------------------------------

test("foldCoverage: a claim whose target ran is removed and listed on the target", () => {
  const checks = [
    target("reg:auth/login"),
    claim("01-auth", "auth/login", "reg:auth/login"),
    claim("26-client-journey", "auth/login", "reg:auth/login"),
    target("job:x", "PASS")
  ];
  const out = foldCoverage(checks);
  assert.equal(out.folded, 2);
  assert.deepEqual(out.dangling, []);
  assert.deepEqual(out.notLive, []);
  assert.deepEqual(out.checks.map((c) => c.id), ["reg:auth/login", "job:x"]);
  const login = out.checks[0];
  assert.deepEqual(login.also, ["01-auth:auth/login", "26-client-journey:auth/login"]);
  assert.equal(login.status, "up", "the target keeps its own status");
  assert.equal(login.detail, "reg:auth/login answered", "the target keeps its own proof");
  assert.equal(out.checks[1].also, undefined, "a row nobody claims gets no also list");
});

test("foldCoverage: a claim whose target did not run stays, as a skip with the reason", () => {
  const checks = [claim("01-auth", "auth/login", "reg:auth/login", { status: "PASS" })];
  const out = foldCoverage(checks);
  assert.equal(out.folded, 0);
  assert.deepEqual(out.dangling, ["01-auth:auth/login"]);
  assert.equal(out.checks.length, 1);
  assert.equal(out.checks[0].status, "skip");
  assert.equal(out.checks[0].detail, "Claims covered by reg:auth/login, but reg:auth/login did not run today.");
  assert.equal(out.checks[0].foldInto, undefined, "a kept claim is not folded a second time");
  assert.equal(out.checks[0].id, "01-auth:auth/login");
});

test("foldCoverage: a claim never folds into another claim", () => {
  const checks = [
    claim("a", "one", "a:two"),
    claim("a", "two", "reg:end"),
    target("reg:end")
  ];
  const out = foldCoverage(checks);
  assert.equal(out.folded, 1, "only a:two reached a real row");
  assert.deepEqual(out.dangling, ["a:one"]);
  assert.deepEqual(out.checks.map((c) => c.id), ["a:one", "reg:end"]);
  assert.deepEqual(out.checks[1].also, ["a:two"]);
});

test("foldCoverage: keeps an also list that is already there, and never lists a claim twice", () => {
  const checks = [
    target("reg:door", "up", { also: ["old:claim"] }),
    claim("a", "x", "reg:door"),
    claim("a", "x", "reg:door")
  ];
  const out = foldCoverage(checks);
  assert.equal(out.folded, 2);
  assert.deepEqual(out.checks[0].also, ["old:claim", "a:x"]);
});

test("foldCoverage: finds a gap-lane target by its lane-free check id, and only a gap-lane row", () => {
  const checks = [
    target("gap-leads:lead:pipe-cut", "PASS", { checkId: "lead:pipe-cut", sliceId: "gap-leads" }),
    claim("a", "x", "lead:pipe-cut")
  ];
  const out = foldCoverage(checks);
  assert.equal(out.folded, 1);
  assert.deepEqual(out.checks[0].also, ["a:x"]);

  // A slice row that happens to share the check id is not a target.
  const stranger = [
    target("t:lead:pipe-cut", "PASS", { checkId: "lead:pipe-cut", sliceId: "t" }),
    claim("a", "x", "lead:pipe-cut")
  ];
  const none = foldCoverage(stranger);
  assert.equal(none.folded, 0);
  assert.deepEqual(none.dangling, ["a:x"]);
});

test("foldCoverage: rows that are not live surfaces leave the scorecard and are not counted as folded", () => {
  const checks = [
    claim("02-daily-pulse", "pulse-never-fixes", null, { foldInto: undefined }),
    claim("03-marketing", "clock", null, { foldInto: undefined }),
    target("reg:x")
  ];
  const out = foldCoverage(checks);
  assert.deepEqual(out.notLive, ["02-daily-pulse:pulse-never-fixes"]);
  assert.equal(out.folded, 0);
  assert.deepEqual(out.checks.map((c) => c.id), ["03-marketing:clock", "reg:x"]);
});

test("foldCoverage: a switched-off workflow becomes a nothing-to-judge row the audit can re-check", () => {
  const clarity = claim("05-funnels", "clarity-insights-sweeper", undefined);
  delete clarity.foldInto;
  const near = claim("05-funnels", "some-other-row", undefined);
  delete near.foldInto;
  const out = foldCoverage([clarity, near]);
  assert.deepEqual(out.notRegistered, ["05-funnels:clarity-insights-sweeper"]);
  assert.equal(out.folded, 0);
  const row = out.checks[0];
  assert.equal(row.id, "05-funnels:clarity-insights-sweeper");
  assert.equal(row.status, "na");
  assert.deepEqual(row.na, { code: "not-registered", args: { id: "clarity-insights-sweeper" } });
  assert.match(row.detail, /Built but not switched on/);
  // Any other row is left exactly as it was.
  assert.equal(out.checks[1].status, "not checked");
  assert.equal(out.checks[1].na, undefined);
});

test("foldCoverage: is pure and survives bad input", () => {
  const checks = [target("reg:a"), claim("a", "x", "reg:a"), claim("a", "y", "reg:missing")];
  const before = JSON.stringify(checks);
  foldCoverage(checks);
  assert.equal(JSON.stringify(checks), before, "the input list and its rows are not changed");
  assert.deepEqual(foldCoverage(null), { checks: [], folded: 0, dangling: [], notLive: [], notRegistered: [] });
  assert.deepEqual(foldCoverage([null, undefined]).checks, [null, undefined]);
});

test("countByTargetKind: counts claims by where they fold", () => {
  assert.deepEqual(
    countByTargetKind([
      { foldInto: "reg:a" }, { foldInto: "reg:b" }, { foldInto: "job:c" }, { foldInto: "wf:d" },
      { foldInto: "contracts:sign-route" }, { id: "no fold" }, null
    ]),
    { reg: 2, job: 1, wf: 1, check: 1 }
  );
});

// ---- NOT_LIVE_ROWS and NOT_REGISTERED_ROWS ------------------------------------------

async function allSliceRowKeys() {
  const keys = new Set();
  for (const [, load] of SLICE_FILES) {
    const mod = await load();
    for (const row of mod.CHECKS || []) keys.add(`${mod.SLICE_ID}:${row.id}`);
  }
  return keys;
}

/** NOT_LIVE keys that are no longer a row in any slice. */
function staleKeys(map, rowKeys) {
  return Object.keys(map).filter((key) => !rowKeys.has(key));
}

test("not-live rows: each has a reason of 40+ characters and still exists in its slice", async () => {
  const keys = Object.keys(NOT_LIVE_ROWS);
  assert.equal(keys.length, 5);
  for (const key of keys) assert.ok(NOT_LIVE_ROWS[key].length >= 40, `${key} reason is too short`);
  assert.deepEqual(staleKeys(NOT_LIVE_ROWS, await allSliceRowKeys()), []);
});

test("not-live rows: the stale check goes red for a row that is gone", async () => {
  const rowKeys = await allSliceRowKeys();
  assert.deepEqual(staleKeys({ "99-nope:gone-row": "x".repeat(50) }, rowKeys), ["99-nope:gone-row"]);
});

test("not-live rows: the nurture workflow is still not built, and the list says so", () => {
  const reason = NOT_LIVE_ROWS["16-nurture:n-05-repair-complete-nurture"];
  assert.match(reason, /does not exist/);
  const ids = functions.map((fn) => fn.opts.id);
  assert.equal(ids.includes("n-05-repair-complete-nurture"), false,
    "n-05 is built now: take it off NOT_LIVE_ROWS so it gets a wf: row");
});

test("not-live rows: isNotLive is exact", () => {
  assert.equal(isNotLive("03-marketing", "page_seen"), true);
  assert.equal(isNotLive("03-marketing", "clock"), false);
  assert.equal(isNotLive("99-other", "page_seen"), false);
});

test("not-registered rows: clarity is built, not switched on, and says so with a code the audit can re-check", async () => {
  const row = notRegisteredFor("05-funnels", "clarity-insights-sweeper");
  assert.deepEqual(row.na, { code: "not-registered", args: { id: "clarity-insights-sweeper" } });
  assert.match(row.detail, /not switched on/);
  assert.equal(notRegisteredFor("05-funnels", "some-other-row"), null);
  assert.deepEqual(staleKeys(NOT_REGISTERED_ROWS, await allSliceRowKeys()), []);
  // The condition the audit re-checks is true today.
  assert.equal(functions.some((fn) => fn.opts.id === "clarity-insights-sweeper"), false);
});

// ---- the 176 registry claims, and where every slice row ends ------------------------

let slicesOnce = null;
function sliceRows() {
  if (!slicesOnce) {
    slicesOnce = loadSliceModules().then((loaded) =>
      runCoverageSlices({ modules: loaded, now: NOW, gaps: false, functions }));
  }
  return slicesOnce;
}

test("fixture: all 176 registry claims fold into the reg: row the live scorecard had", async () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  assert.equal(fixture.length, 176);
  const rows = await sliceRows();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const registryIds = new Set(PULSE_REGISTRY.map((r) => `reg:${r.id}`));
  for (const f of fixture) {
    const row = byId.get(f.sliceRow);
    assert.ok(row, `${f.sliceRow} is not a slice row any more`);
    assert.equal(row.foldInto, f.linkedScorecardId, f.sliceRow);
    assert.ok(registryIds.has(row.foldInto), `${row.foldInto} is not a registry row`);
  }
});

test("fixture: folding 176 claims into the registry rows that ran leaves none dangling", async () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const rows = await sliceRows();
  const wanted = new Set(fixture.map((f) => f.sliceRow));
  const claims = rows.filter((r) => wanted.has(r.id));
  const targets = PULSE_REGISTRY.map((r) => target(`reg:${r.id}`));
  const out = foldCoverage([...targets, ...claims]);
  assert.equal(out.folded, 176);
  assert.deepEqual(out.dangling, []);
  const listed = out.checks.flatMap((c) => c.also || []);
  assert.equal(new Set(listed).size, 176);
  // 176 claims sit on 127 distinct doors (measure.md section 1).
  assert.equal(out.checks.filter((c) => (c.also || []).length > 0).length, 127);
});

/** Slice rows that end with no fold target, each with the reason it is allowed. */
const EXPECTED_UNFOLDED = Object.freeze({
  "02-daily-pulse:ag-07-cron-daily-pulse": "own evaluation: the agent_runs read",
  "02-daily-pulse:script-dry-run-default": "NOT_LIVE_ROWS",
  "02-daily-pulse:pulse-never-fixes": "NOT_LIVE_ROWS",
  "02-daily-pulse:proof-does-not-text": "NOT_LIVE_ROWS",
  "03-marketing:clock": "own evaluation: the marketing heartbeat read",
  "03-marketing:worker": "own evaluation: the marketing heartbeat read",
  "03-marketing:outbox_drain": "own evaluation: the marketing heartbeat read",
  "03-marketing:page_seen": "NOT_LIVE_ROWS",
  "05-funnels:clarity-insights-sweeper": "NOT_REGISTERED_ROWS (foldCoverage makes it a nothing-to-judge row)",
  "06-briefs:morning-brief": "LEFT_TO_AUDIT (audit:briefs-sent)",
  "16-nurture:n-05-repair-complete-nurture": "NOT_LIVE_ROWS",
  "33-fulfillment:repair-stage-moves": "leftover: no deep check reads stage moves yet",
  "33-fulfillment:repair.docs.complete": "leftover: no deep check reads the letter build yet"
});

test("every slice row ends somewhere known: a fold target, or a written reason", async () => {
  const rows = await sliceRows();
  const unfolded = rows.filter((r) => !r.foldInto).map((r) => r.id).sort();
  assert.deepEqual(unfolded, Object.keys(EXPECTED_UNFOLDED).sort(),
    "A slice row with no fold target needs a check behind it, or a line in link.mjs saying why not.");
  const kinds = countByTargetKind(rows);
  assert.ok(kinds.reg >= 176);
  assert.equal(kinds.reg + kinds.job + kinds.wf + kinds.check + unfolded.length, rows.length);
});

test("every slice row ends somewhere known: the test goes red when a new row has no target", async () => {
  const rows = await sliceRows();
  const withStranger = [...rows, { id: "99-new:stranger", sliceId: "99-new", checkId: "stranger", status: "not checked" }];
  const unfolded = withStranger.filter((r) => !r.foldInto).map((r) => r.id).sort();
  assert.notDeepEqual(unfolded, Object.keys(EXPECTED_UNFOLDED).sort());
});

test("the registry and the allow-list still cover what the fold order reads", () => {
  // The fold order reads these imports; an empty one would fold nothing and say nothing.
  assert.ok(PULSE_REGISTRY.length > 100);
  assert.ok(Object.keys(ALLOWED_UNMONITORED).length > 0);
  assert.ok(PULSE_REGISTRY.every((r) => typeof coverageKey(r) === "string"));
});
