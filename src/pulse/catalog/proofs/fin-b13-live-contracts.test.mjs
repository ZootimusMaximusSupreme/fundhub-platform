// Guards for the batch 13 live checks (Hiring desk and Specialist desk).
//
// A live check is one read-only SQL text. This file runs that exact text over stand-in rows and shows,
// for every check:
//   1. good rows read as right (bad_count 0, the right sample_count);
//   2. every named bad condition, alone, makes the check go red on its own row;
//   3. the same row is NOT caught when that one condition is left out of the text, so each condition is
//      load-bearing and no row is double-counted;
//   4. another company's wrong row is never read.
// It also checks that every table and column in the text is a real one (db/schema and db/migrations),
// that the text is read-only, that each control is one exact row of the map, and that the registry holds
// the same text. These are tests with stand-in rows, not live reads.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  FIN_B13_CHECKS, FIN_B13_DISPLAY_CONTRACTS, FIN_B13_SOURCE_FILE, sqlFor
} from "./fin-b13-display-contracts.mjs";
import { REPO_ROOT, makeStandIn, schemaColumns, tablesIn } from "./fin-b13-sql-kit.mjs";

const ORG = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const T0 = "2026-10-10T12:00:00.000Z";
const T1 = "2026-10-11T12:00:00.000Z";
const T2 = "2026-10-12T12:00:00.000Z";

let counter = 0;
const nid = (p) => `${p}-${String(++counter).padStart(4, "0")}`;
const R = (table, row) => [table, row];

const STAGE_KEYS = ["applied", "screening", "group_interview", "one_on_one", "offer", "hired", "onboarding",
  "ramp", "performing", "rejected", "withdrawn"];
const STAGE_ROWS = STAGE_KEYS.map((key, i) => R("pipeline_stages", {
  id: `stage-${key}`, org_id: ORG, pipeline_id: "pipe-hiring", key, name: key, sort_order: i
}));
const STATUS_FOR = {
  applied: "open", screening: "open", group_interview: "open", one_on_one: "open", offer: "open",
  hired: "hired", onboarding: "hired", ramp: "hired", performing: "hired", rejected: "rejected", withdrawn: "withdrawn"
};

/* ── hiring row builders. Each gives a GOOD row; a test overrides one field to make it wrong. ── */
const STAFF = R("staff", { id: "staff-1", org_id: ORG, name: "Casey Proof" });
const cand = (o = {}) => ({
  id: nid("cand"), org_id: ORG, full_name: "Pat Doe", source: "referral",
  source_detail: null, is_demo: false, ...o
});
const app = (c, stage, o = {}) => ({
  id: nid("app"), org_id: ORG, candidate_id: c.id, stage_id: `stage-${stage}`, status: STATUS_FOR[stage], role_id: "role-closer", ...o
});
const decision = (a, o = {}) => ({
  id: nid("dec"), org_id: ORG, application_id: a.id, decision: "advance", from_stage_key: "applied",
  to_stage_key: "screening", decided_by: "staff-1", reason: null, created_at: T0, ...o
});
const feedbackTask = (a, o = {}) => R("tasks", {
  id: nid("task"), org_id: ORG, title: "Send candidate feedback", source_workflow: "hiring-candidate-feedback",
  body: `hiring:feedback:${a.id}`, ...o
});

/** A real application sitting in `stage`, with the rows a good one leaves behind. */
function applicationAt(stage, { app: appOver = {}, cand: candOver = {}, decisionOver = {}, noDecision = false, extra = [] } = {}) {
  const c = cand(candOver);
  const a = app(c, stage, appOver);
  const kind = stage === "offer" ? "offer" : stage === "rejected" ? "reject" : stage === "withdrawn" ? "withdraw" : "advance";
  const rows = [R("candidates", c), R("candidate_applications", a)];
  if (!noDecision) {
    rows.push(R("hiring_decisions", decision(a, {
      decision: kind, to_stage_key: stage, reason: stage === "rejected" ? "Not a fit for the desk" : null, ...decisionOver
    })));
  }
  if (stage === "rejected") rows.push(feedbackTask(a));
  return { rows: [...rows, ...extra], a, c };
}

const columnFix = (stage, violations) => ({
  base: [...STAGE_ROWS, STAFF],
  good: applicationAt(stage).rows,
  sample: 1,
  violations
});

/* ── specialist row builders ── */
const inquiry = (o = {}) => ({
  id: nid("inq"), org_id: ORG, client_id: "client-1", bureau: "EX", status: "Filed", outcome: null, call_attempts: 0,
  is_open: true, is_demo: false, confirmed_at: null, worked_by: null, worked_at: null, ...o
});
const attempt = (l, o = {}) => ({
  id: nid("att"), org_id: ORG, inquiry_id: l.id, staff_id: "staff-1", kind: "call", outcome: null, note: null,
  created_at: T0, ...o
});
const kase = (o = {}) => ({
  id: nid("case"), org_id: ORG, client_id: "client-1", case_id: nid("IRC"), case_status: "In Progress",
  selected_bureaus_raw: "EX", portal_confirmation: null, letter_provider_id: null, is_demo: false, ...o
});
const linked = (k, o = {}) => inquiry({ inquiry_removal_case_id: k.id, case_id: k.id, ...o });

/* ── bench: a role, its view output, and the applications a recount reads ── */
const BENCH_VIEW = ["org_id", "role_id", "role_key", "role_name", "bench_target", "hiring_manager_staff_id",
  "open_applications", "bench_count", "bench_shortfall"];
const benchRow = (o = {}) => ({
  org_id: ORG, role_id: "role-closer", role_key: "closer", role_name: "Closer", bench_target: 4,
  hiring_manager_staff_id: "staff-1", open_applications: 3, bench_count: 1, bench_shortfall: 3, ...o
});
const benchApps = (roleId = "role-closer") => {
  const out = [];
  for (const stage of ["applied", "one_on_one", "group_interview"]) {
    const c = cand();
    out.push(R("candidates", c), R("candidate_applications", app(c, stage, { role_id: roleId })));
  }
  // A hired person is not an open application and not on the bench.
  const hiredC = cand();
  out.push(R("candidates", hiredC), R("candidate_applications", app(hiredC, "hired", { role_id: roleId })));
  return out;
};

const FIX = {
  "hiring-column-screening": columnFix("screening", {
    "a closed application is still sitting in an open stage": [
      ...applicationAt("screening", { app: { status: "rejected" } }).rows],
    "nothing recorded the move into screening": [...applicationAt("screening", { noDecision: true }).rows]
  }),
  "hiring-column-offer": columnFix("offer", {
    "a closed application is still sitting in an open stage": [...applicationAt("offer", { app: { status: "hired" } }).rows],
    // An offer decision that points at a different stage still names a person, so only the move is missing.
    "nothing recorded the move into offer": [...applicationAt("offer", { decisionOver: { to_stage_key: "one_on_one" } }).rows],
    "an offer was made by nobody": [...applicationAt("offer", { decisionOver: { decided_by: null } }).rows]
  }),
  "hiring-column-hired": columnFix("hired", {
    "a person is in a hired stage but the application is not marked hired": [
      ...applicationAt("hired", { app: { status: "open" } }).rows],
    "nothing recorded the move into hired": [...applicationAt("hired", { noDecision: true }).rows]
  }),
  "hiring-column-onboarding": columnFix("onboarding", {
    "a person is in a hired stage but the application is not marked hired": [
      ...applicationAt("onboarding", { app: { status: "open" } }).rows],
    "nothing recorded the move into onboarding": [...applicationAt("onboarding", { noDecision: true }).rows]
  }),
  "hiring-column-ramp": columnFix("ramp", {
    "a person is in a hired stage but the application is not marked hired": [
      ...applicationAt("ramp", { app: { status: "open" } }).rows],
    "nothing recorded the move into ramp": [...applicationAt("ramp", { noDecision: true }).rows]
  }),
  "hiring-column-performing": columnFix("performing", {
    "a person is in a hired stage but the application is not marked hired": [
      ...applicationAt("performing", { app: { status: "open" } }).rows],
    "nothing recorded the move into performing": [...applicationAt("performing", { noDecision: true }).rows]
  }),
  "hiring-column-rejected": columnFix("rejected", {
    "the application sits in rejected but its status is not rejected": [
      ...applicationAt("rejected", { app: { status: "open" } }).rows],
    "nothing recorded the move into rejected": (() => {
      // A turn-down decision that points at the wrong stage still counts as a person and a reason,
      // but it is not a move into rejected.
      const x = applicationAt("rejected", { decisionOver: { to_stage_key: "screening" } });
      return x.rows;
    })(),
    // Two wrong turn-downs, one with nobody named and one with a person but no words; each alone trips it.
    "turned down with no named person or no written reason": {
      bad: 2,
      rows: [
        ...applicationAt("rejected", { decisionOver: { decided_by: null } }).rows,
        ...applicationAt("rejected", { decisionOver: { reason: "   " } }).rows]
    }
  }),
  "hiring-column-withdrawn": columnFix("withdrawn", {
    "the application sits in withdrawn but its status is not withdrawn": [
      ...applicationAt("withdrawn", { app: { status: "open" } }).rows],
    "nothing recorded the move into withdrawn": [...applicationAt("withdrawn", { noDecision: true }).rows]
  }),
  "hiring-advance": (() => {
    const mover = (o) => {
      const c = cand();
      const a = app(c, o.stage, o.app || {});
      return { c, a, rows: [R("candidates", c), R("candidate_applications", a)] };
    };
    const good = (() => {
      const m = mover({ stage: "screening" });
      return [...m.rows, R("hiring_decisions", decision(m.a, { decision: "advance", from_stage_key: "applied", to_stage_key: "screening" }))];
    })();
    const row = (stage, decisionOver, appOver) => {
      const m = mover({ stage, app: appOver });
      return [...m.rows, R("hiring_decisions", decision(m.a, decisionOver))];
    };
    return {
      base: [...STAGE_ROWS, STAFF],
      good,
      sample: 1,
      violations: {
        "an offer was logged as a plain move, or a plain move was logged as an offer": row("offer", {
          decision: "advance", from_stage_key: "one_on_one", to_stage_key: "offer" }),
        "a move names no forward stage": row("screening", { to_stage_key: "rejected" }, { stage_id: "stage-rejected", status: "rejected" }),
        "a move does not say where the person started": row("screening", { from_stage_key: "  " }),
        "the move was logged but the person never moved": row("applied", { to_stage_key: "screening" }),
        "the person was moved to Hired but the application is not marked hired": row("hired", {
          from_stage_key: "offer", to_stage_key: "hired" }, { status: "open" })
      }
    };
  })(),
  "hiring-reject": (() => {
    const x = (decisionOver, appOver, stage = "rejected", withTask = true) => {
      const c = cand();
      const a = app(c, stage, appOver);
      const rows = [R("candidates", c), R("candidate_applications", a), R("hiring_decisions", decision(a, {
        decision: "reject", from_stage_key: "screening", to_stage_key: "rejected", reason: "Wrote nothing back", ...decisionOver
      }))];
      if (withTask) rows.push(feedbackTask(a));
      return rows;
    };
    return {
      base: [...STAGE_ROWS, STAFF],
      good: x({}, {}),
      sample: 1,
      violations: {
        "turned down with no named person": x({ decided_by: "staff-gone" }),
        "turned down with no written reason": x({ reason: "   " }),
        "the turn-down does not end at Not Moving Forward": x({ to_stage_key: "withdrawn" }),
        "the application is not marked rejected": x({}, { status: "open" }),
        "the person is not in the Not Moving Forward stage": x({}, { stage_id: "stage-screening" }),
        "no job was raised to tell the candidate": x({}, {}, "rejected", false)
      }
    };
  })(),
  "hiring-postings": {
    base: [],
    good: [
      R("hiring_job_postings", { id: nid("post"), org_id: ORG, role_id: "role-closer", channel: "linkedin", status: "posted",
        title: "Closer", posted_at: T0, external_id: "li-1", is_demo: false }),
      R("hiring_job_postings", { id: nid("post"), org_id: ORG, role_id: "role-closer", channel: "internal", status: "draft",
        title: "Setter", is_demo: false }),
      R("hiring_job_postings", { id: nid("post"), org_id: ORG, role_id: "role-closer", channel: "internal", status: "closed",
        title: "Old", posted_at: T0, closed_at: T1, is_demo: false })
    ],
    sample: 3,
    violations: {
      "a failed posting keeps no reason": [R("hiring_job_postings", { id: nid("post"), org_id: ORG, role_id: "role-closer",
        channel: "facebook", status: "failed", title: "F", last_error: "  ", is_demo: false })],
      "a posted posting has no posted date": [R("hiring_job_postings", { id: nid("post"), org_id: ORG, role_id: "role-closer",
        channel: "internal", status: "posted", title: "P", posted_at: null, is_demo: false })],
      "a closed posting has no closed date": [R("hiring_job_postings", { id: nid("post"), org_id: ORG, role_id: "role-closer",
        channel: "internal", status: "closed", title: "C", posted_at: T0, closed_at: null, is_demo: false })],
      "a posting is marked posted on an outside channel but was never published": [R("hiring_job_postings", {
        id: nid("post"), org_id: ORG, role_id: "role-closer", channel: "job_board", status: "posted", title: "J",
        posted_at: T0, external_id: null, is_demo: false })],
      "a posting closed before it was posted": [R("hiring_job_postings", { id: nid("post"), org_id: ORG, role_id: "role-closer",
        channel: "internal", status: "paused", title: "B", posted_at: T2, closed_at: T0, is_demo: false })]
    }
  },
  "hiring-bench-tiles": {
    base: [...STAGE_ROWS],
    views: { v_hiring_bench: BENCH_VIEW },
    good: [...benchApps(), R("v_hiring_bench", benchRow())],
    sample: 1,
    violations: {
      // Each wrong row is its own role, with its own applications, so the good row's recount never moves.
      "the open applications number is not the open applications on file": [
        ...benchApps("role-setter"), R("v_hiring_bench", benchRow({ role_id: "role-setter", role_key: "setter", open_applications: 9 }))],
      "the bench number is not the people at 1:1 or Offer": [
        ...benchApps("role-coord"), R("v_hiring_bench", benchRow({ role_id: "role-coord", role_key: "coord", bench_count: 3, bench_shortfall: 3 }))],
      "the short-by number is not the target minus the bench": [
        ...benchApps("role-x"), R("v_hiring_bench", benchRow({ role_id: "role-x", role_key: "x", bench_shortfall: 0 }))]
    }
  },
  "specialist-stat-tiles": (() => {
    const worked = inquiry({ call_attempts: 2, worked_by: "staff-1", worked_at: T0 });
    const confirmed = inquiry({ status: "Removed", confirmed_at: T0, is_open: false });
    const badAttempts = inquiry({ call_attempts: 3, worked_by: "staff-1", worked_at: T0 });
    const unattributed = inquiry({ call_attempts: 1, worked_by: null, worked_at: null });
    return {
      base: [],
      good: [R("inquiry_log", worked), R("inquiry_attempts", attempt(worked, { kind: "call" })),
        R("inquiry_attempts", attempt(worked, { kind: "letter" })), R("inquiry_attempts", attempt(worked, { kind: "note" })),
        R("inquiry_log", confirmed)],
      sample: 2,
      violations: {
        "a removal is confirmed but the status does not say removed": [
          R("inquiry_log", inquiry({ status: "Pending Removal", confirmed_at: T0, is_open: false }))],
        "a removal is confirmed but the inquiry still reads open": [
          R("inquiry_log", inquiry({ status: "Removed", confirmed_at: T0, is_open: true }))],
        "the attempt count is not the number of attempts logged for the row": [
          R("inquiry_log", badAttempts), R("inquiry_attempts", attempt(badAttempts, { kind: "call" })),
          R("inquiry_attempts", attempt(badAttempts, { kind: "portal" }))],
        "attempts were logged but nobody and no time is recorded as having worked the row": [
          R("inquiry_log", unattributed), R("inquiry_attempts", attempt(unattributed, { kind: "call" }))]
      }
    };
  })(),
  "specialist-bureau-chips": {
    base: [],
    good: [R("inquiry_log", inquiry({ bureau: "EX" })), R("inquiry_log", inquiry({ bureau: "Equifax" })),
      R("inquiry_log", inquiry({ bureau: "trans union" })), R("inquiry_log", inquiry({ bureau: "Experian" })),
      R("inquiry_log", inquiry({ bureau: "TU" })), R("inquiry_log", inquiry({ bureau: " eq " })),
      // A finished removal is not counted by any chip, so its bureau is not judged.
      R("inquiry_log", inquiry({ bureau: "", status: "Removed", confirmed_at: T0 }))],
    sample: 6,
    violations: {
      "an open inquiry names no bureau a chip counts": [R("inquiry_log", inquiry({ bureau: "Innovis" }))]
    }
  },
  "specialist-send-options": (() => {
    const portalCase = kase({ portal_confirmation: "EX-REF-1", selected_bureaus_raw: "EX" });
    const portalInq = linked(portalCase);
    const mailCase = kase({ letter_provider_id: "pg_letter_1", selected_bureaus_raw: "TU" });
    const mailInq = linked(mailCase);
    const portalOk = [R("inquiry_removal_cases", portalCase), R("inquiry_log", portalInq),
      R("inquiry_attempts", attempt(portalInq, { kind: "portal", outcome: "uploaded", note: "experian_ref:EX-REF-1" }))];
    const mailOk = [R("inquiry_removal_cases", mailCase), R("inquiry_log", mailInq),
      R("inquiry_attempts", attempt(mailInq, { kind: "letter", outcome: "sent", note: "provider:pg_letter_1" }))];
    const freshPortal = (over = {}, withAttempt = true) => {
      const k = kase({ portal_confirmation: "EX-REF-9", selected_bureaus_raw: "EX", ...over });
      const l = linked(k);
      return [R("inquiry_removal_cases", k), R("inquiry_log", l),
        ...(withAttempt ? [R("inquiry_attempts", attempt(l, { kind: "portal", outcome: "uploaded" }))] : [])];
    };
    const freshMail = (over = {}, withAttempt = true) => {
      const k = kase({ letter_provider_id: "pg_letter_9", ...over });
      const l = linked(k);
      return [R("inquiry_removal_cases", k), R("inquiry_log", l),
        ...(withAttempt ? [R("inquiry_attempts", attempt(l, { kind: "letter", outcome: "sent" }))] : [])];
    };
    // laterGood true: failed, then re-sent (fine). laterGood false: sent once, then a later one failed (wrong:
    // an earlier success does not excuse the last letter failing).
    const failed = (laterGood) => {
      const l = inquiry({ id: nid("inq") });
      return laterGood
        ? [R("inquiry_log", l),
          R("inquiry_attempts", attempt(l, { kind: "letter", outcome: "mail_failed:return_address_required", created_at: T0 })),
          R("inquiry_attempts", attempt(l, { kind: "letter", outcome: "sent", created_at: T1 }))]
        : [R("inquiry_log", l),
          R("inquiry_attempts", attempt(l, { kind: "letter", outcome: "sent", created_at: T0 })),
          R("inquiry_attempts", attempt(l, { kind: "letter", outcome: "mail_failed:return_address_required", created_at: T1 }))];
    };
    return {
      base: [],
      good: [...portalOk, ...mailOk, ...failed(true)],
      // portal case part: 1, mail case part: 1, failed-letter part: 1 (the failed one that was re-sent)
      sample: 3,
      violations: {
        "a portal upload was saved on a case that is not Experian": freshPortal({ selected_bureaus_raw: "TU" }),
        "a portal reference was saved but no portal attempt was logged": freshPortal({}, false),
        "a portal upload was saved but the case still reads waiting": freshPortal({ case_status: "Queued" }),
        "a mail provider id was saved but no letter attempt was logged": freshMail({}, false),
        "a letter was handed to the mail provider but the case still reads waiting": freshMail({ case_status: "Blocked" }),
        "a letter failed to mail and no later letter went out for that inquiry": failed(false)
      }
    };
  })()
};

function tableNamesFor(spec, ...rowLists) {
  const names = new Set(tablesIn(sqlFor(spec)));
  for (const list of rowLists) for (const [table] of list) names.add(table);
  return [...names];
}

function runOn(spec, fixture, rows, { sql = sqlFor(spec), orgId = ORG } = {}) {
  const standIn = makeStandIn(tableNamesFor(spec, fixture.base || [], fixture.good, rows), { views: fixture.views || {} });
  try {
    for (const [table, row] of [...(fixture.base || []), ...fixture.good, ...rows]) standIn.insert(table, row);
    return standIn.run(sql, orgId);
  } finally {
    standIn.close();
  }
}

test("every live check has a fixture, and every fixture names real conditions", () => {
  assert.deepEqual(Object.keys(FIX).sort(), FIN_B13_CHECKS.map((spec) => spec.key).sort());
  for (const spec of FIN_B13_CHECKS) {
    const names = spec.parts.flatMap((part) => part.bad.map(([name]) => name)).sort();
    assert.deepEqual(Object.keys(FIX[spec.key].violations).sort(), names, `${spec.key}: one violation per named condition`);
  }
});

for (const spec of FIN_B13_CHECKS) {
  const fixture = FIX[spec.key];

  test(`${spec.key}: good rows read as right`, () => {
    const out = runOn(spec, fixture, []);
    assert.deepEqual(out, { sample_count: fixture.sample, bad_count: 0 });
  });

  for (const [name, violation] of Object.entries(fixture.violations)) {
    // A violation is its rows, or { rows, bad } when it holds more than one wrong row.
    const rows = Array.isArray(violation) ? violation : violation.rows;
    const wrong = Array.isArray(violation) ? 1 : violation.bad;
    test(`${spec.key}: "${name}" goes red on its own row, and only that condition catches it`, () => {
      const red = runOn(spec, fixture, rows);
      assert.equal(red.bad_count, wrong, `the check must catch every wrong row for: ${name}`);
      assert.equal(red.sample_count > fixture.sample, true, "the wrong row must be a counted sample");
      // Same rows, with that one condition left out of the text: now it reads as right.
      const blind = runOn(spec, fixture, rows, { sql: sqlFor(spec, { without: [name] }) });
      assert.equal(blind.bad_count, 0, `${name}: the row is caught by something else, so the condition is not load-bearing`);
    });
  }

  test(`${spec.key}: another company's wrong rows are never read`, () => {
    const foreign = Object.values(fixture.violations).flatMap((v) => (Array.isArray(v) ? v : v.rows))
      .map(([table, row]) => [table, "org_id" in row && table !== "pipeline_stages" ? { ...row, org_id: OTHER } : row]);
    const out = runOn(spec, fixture, foreign);
    assert.deepEqual(out, { sample_count: fixture.sample, bad_count: 0 });
  });
}

// Demo Mode rows are counted nowhere on these screens, so a wrong demo row must never turn a check red.
const DEMO_SIGNS = {
  "the demo flag": (table, row) => (table === "candidates" ? { ...row, is_demo: true } : row),
  "the seeder's source_detail": (table, row) => (table === "candidates" ? { ...row, source_detail: "platform_demo" } : row),
  "a name that starts DEMO": (table, row) => (table === "candidates" ? { ...row, full_name: "DEMO Candidate \u2014 Juniper Vale" } : row)
};
const ROW_FLAG_TABLES = new Set(["hiring_job_postings", "inquiry_log", "inquiry_removal_cases"]);

for (const spec of FIN_B13_CHECKS) {
  if (spec.key === "hiring-bench-tiles") continue; // the bench view counts every application, and the page takes demo rows off itself
  const fixture = FIX[spec.key];
  const allRows = Object.values(fixture.violations).flatMap((v) => (Array.isArray(v) ? v : v.rows));
  const hasCandidates = allRows.some(([table]) => table === "candidates");
  const signs = hasCandidates ? Object.entries(DEMO_SIGNS) : [["the demo flag", (table, row) => (ROW_FLAG_TABLES.has(table) ? { ...row, is_demo: true } : row)]];
  for (const [sign, mark] of signs) {
    test(`${spec.key}: wrong rows marked demo by ${sign} are never read`, () => {
      const demo = allRows.map(([table, row]) => [table, mark(table, ROW_FLAG_TABLES.has(table) ? { ...row, is_demo: true } : row)]);
      const out = runOn(spec, fixture, demo);
      assert.deepEqual(out, { sample_count: fixture.sample, bad_count: 0 });
    });
  }
}

test("the live checks are read-only and use only real tables and columns", () => {
  const schema = schemaColumns();
  for (const spec of FIN_B13_CHECKS) {
    const sql = sqlFor(spec);
    assert.match(sql, /\/\* display-result:[^*]+ \*\//);
    assert.match(sql, /\$1::uuid/);
    assert.match(sql, /sample_count/);
    assert.match(sql, /bad_count/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
    for (const table of tablesIn(sql)) {
      if (table === "v_hiring_bench") continue;
      assert.ok(schema.has(table), `${spec.key}: ${table} is not a real table`);
    }
  }
});

test("each control is one exact row of the desks-c map, and the registry holds the same text", () => {
  const rows = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "ops/workflows/coverage-every-surface-2026-10-10", FIN_B13_SOURCE_FILE), "utf8"));
  const seen = new Set();
  for (const spec of FIN_B13_CHECKS) {
    const matches = rows.filter((row) => row.surface === spec.surface && row.control === spec.control);
    assert.equal(matches.length, 1, `${spec.key}: ${spec.control}`);
    assert.equal(seen.has(spec.control), false, "controls are unique");
    seen.add(spec.control);
  }
  assert.equal(FIN_B13_DISPLAY_CONTRACTS.length, FIN_B13_CHECKS.length);
  for (const [i, spec] of FIN_B13_CHECKS.entries()) {
    const contract = FIN_B13_DISPLAY_CONTRACTS[i];
    assert.equal(contract.control, spec.control);
    assert.equal(contract.mode, "query");
    assert.equal(contract.sql, sqlFor(spec));
    assert.equal(contract.anyImpact, true);
    assert.equal(contract.emptyAs, spec.emptyAs);
    assert.ok(contract.requirement.length > 40);
  }
});
