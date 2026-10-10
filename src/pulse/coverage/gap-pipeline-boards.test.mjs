import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGE_LIMIT_HOURS,
  AGE_SQL,
  ARCHIVED_THEN_PAID_SQL,
  BOARDS,
  BOARD_READ_LIMIT,
  CHECK_IDS,
  DEAD_APPLICATIONS_SQL,
  DEAD_CARDS_SQL,
  DEAD_STAGES,
  DEAD_STAGE_KEYS,
  HIRING_PAINTED_SQL,
  HIRING_READ_LIMIT,
  HIRING_TRUTH_SQL,
  OFF_BOARD_SQL,
  PAID_GRACE_MS,
  PAID_NO_CARD_SQL,
  TRUTH_SQL,
  WRITTEN_CLOCK_BOARDS,
  boardsWithNoLimit,
  gapChecks,
  judgeAges,
  judgeCounts,
  naVerify
} from "./gap-pipeline-boards.mjs";
import { BOARD_CARDS_SQL, BOARD_STAGES_SQL } from "./gap-crm-links.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";
import { GAP_FILES } from "./modules.mjs";
import { runGapLane } from "./run-slices.mjs";
import { laneCheckIds, makeLaneNaVerify } from "../self-audit.mjs";
import { NA_CODES, verifyNa } from "../na-conditions.mjs";
import { STAGE_SLA } from "../../repair/sla.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
// Code only. The header comments name the things this file refuses to do.
const SRC = fs
  .readFileSync(path.join(HERE, "gap-pipeline-boards.mjs"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
  .join("\n");

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-10T18:00:00.000Z");
const DEMO_SQL = "SELECT demo_mode_enabled FROM orgs WHERE id = $1";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();

/* ---------- fakes ---------- */

/** A db that answers by exact SQL text. An unknown SQL throws, so a changed query cannot slip through. */
function dbFrom(map, seen = []) {
  return {
    seen,
    async query(sql, params) {
      const key = String(sql);
      seen.push({ sql: key, params });
      if (!Object.prototype.hasOwnProperty.call(map, key)) throw new Error(`unexpected sql: ${key.slice(0, 90)}`);
      const answer = map[key];
      const out = typeof answer === "function" ? answer(params) : answer;
      return { rows: Array.isArray(out) ? out : out.rows };
    }
  };
}

const STAGES = {
  sales: ["new_lead", "booked", "closed_won"],
  funding_card_stacking: ["apply_now", "approved", "funded"],
  optimization: ["intake", "analysis", "in_transit", "awaiting_response"],
  affiliates_white_label: ["invited", "active"]
};

function stageRows(board) {
  return (STAGES[board] || []).map((key, i) => ({ id: `${board}:${key}`, key, name: key, sort_order: i }));
}

function truthRows(counts = {}) {
  const out = [];
  for (const [board, keys] of Object.entries(STAGES)) {
    keys.forEach((stage, i) => out.push({ pipeline: board, stage, sort_order: i, n: (counts[board] && counts[board][stage]) || 0 }));
  }
  return out;
}

/** The cards the board read hands back: `shown[board][stage]` cards each. */
function boardCards(shown = {}) {
  return (params) => {
    const board = params[0];
    const out = [];
    for (const [stage, n] of Object.entries(shown[board] || {})) {
      for (let i = 0; i < n; i += 1) out.push({ id: `${board}:${stage}:${i}`, stage_id: `${board}:${stage}` });
    }
    return out;
  };
}

/** Everything healthy by default: no cards, nothing late, nobody lost. */
function mapOf({ counts, shown, over = {} } = {}) {
  return {
    [DEMO_SQL]: [{ demo_mode_enabled: false }],
    [TRUTH_SQL]: truthRows(counts),
    [BOARD_STAGES_SQL]: (params) => stageRows(params[0]),
    [BOARD_CARDS_SQL]: boardCards(shown),
    [HIRING_TRUTH_SQL]: [{ n: 0 }],
    [HIRING_PAINTED_SQL]: [{ n: 0 }],
    [AGE_SQL]: [],
    [DEAD_CARDS_SQL]: [],
    [DEAD_APPLICATIONS_SQL]: [],
    [PAID_NO_CARD_SQL]: [],
    [ARCHIVED_THEN_PAID_SQL]: [],
    [OFF_BOARD_SQL]: [],
    ...over
  };
}

function byId(rows) {
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

function shape(r) {
  assert.ok(CHECK_IDS.includes(r.id), r.id);
  assert.ok(["PASS", "FAIL", "skip", "na"].includes(r.status));
  assert.equal(typeof r.detail, "string");
  assert.ok(r.detail.length > 0);
  if (r.status === "FAIL") {
    assert.equal(typeof r.suggestedFix, "string");
    assert.match(r.suggestedFix, /Do not auto-fix/);
    assert.match(r.suggestedFix, /Chris fixes reds/);
  } else {
    assert.equal(r.suggestedFix, null);
  }
  if (r.status === "na") {
    assert.equal(typeof r.na.code, "string");
    assert.ok(NA_CODES.includes(r.na.code), r.na.code);
  }
}

/* ---------- source and wiring ---------- */

test("gap pipeline boards: the source reads only and reads no file", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /\bmethod:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(SRC, /["'`]\s*(BEGIN|COMMIT|ROLLBACK|SET)\b/i);
  assert.doesNotMatch(SRC, /node:fs|readFileSync|readdirSync/);
  for (const sql of [TRUTH_SQL, HIRING_TRUTH_SQL, HIRING_PAINTED_SQL, AGE_SQL, DEAD_CARDS_SQL, DEAD_APPLICATIONS_SQL, PAID_NO_CARD_SQL, ARCHIVED_THEN_PAID_SQL, OFF_BOARD_SQL]) {
    const bare = sql.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    assert.match(bare, /^(SELECT|WITH)\b/i);
  }
});

test("gap pipeline boards: it is on the named list, exports its ids, and the codes it says na with are on the list of codes", async () => {
  assert.ok(GAP_FILES.some(([name]) => name === "gap-pipeline-boards.mjs"));
  const mod = await GAP_FILES.find(([name]) => name === "gap-pipeline-boards.mjs")[1]();
  assert.deepEqual(laneCheckIds(mod), [...CHECK_IDS]);
  assert.equal(typeof mod.gapChecks, "function");
  assert.equal(typeof mod.naVerify["no-card-on-stage"], "function");
  assert.equal(typeof mod.naVerify["no-limit-set"], "function");
  assert.ok(NA_CODES.includes("no-card-on-stage"));
  assert.ok(NA_CODES.includes("no-limit-set"));
});

test("gap pipeline boards: the lists are true to the repo (stage keys, clocks, boards)", () => {
  const seed = fs.readFileSync(path.join(ROOT, "db/seed/002_pipelines.sql"), "utf8");
  const migrations = fs.readdirSync(path.join(ROOT, "db/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .map((n) => fs.readFileSync(path.join(ROOT, "db/migrations", n), "utf8"))
    .join("\n");
  const text = `${seed}\n${migrations}`;
  for (const [board, stage] of DEAD_STAGES) {
    assert.match(text, new RegExp(`['"]${stage}['"]`), `${board}/${stage} is in no seed or migration`);
  }
  for (const b of BOARDS) {
    assert.match(text, new RegExp(`['"]${b.key}['"]`), `${b.key} is in no seed or migration`);
    for (const stage of b.done) assert.match(text, new RegExp(`['"]${stage}['"]`), `${b.key}/${stage}`);
  }
  assert.equal(DEAD_STAGES.length, 30);
  assert.equal(new Set(DEAD_STAGE_KEYS).size, 30, "no stage is listed twice");
  // Every board has a written clock or one named setting. Nothing is left without either.
  const covered = new Set([...WRITTEN_CLOCK_BOARDS, ...Object.keys(AGE_LIMIT_HOURS)]);
  assert.deepEqual([...covered].sort(), BOARDS.map((b) => b.key).sort());
  // The one written stage clock is Repair's, imported and not copied.
  assert.ok(Object.keys(STAGE_SLA).length >= 8);
  assert.deepEqual([...WRITTEN_CLOCK_BOARDS], ["optimization"]);
  assert.equal(BOARD_READ_LIMIT, 500, "api/dashboard/pipeline.mjs falls back to 500");
  assert.equal(HIRING_READ_LIMIT, 200, "src/http/read-api.mjs MAX_LIMIT");
});

test("gap pipeline boards: the board read limit and the route's own SQL are the ones in the route file", () => {
  const route = fs.readFileSync(path.join(ROOT, "api/dashboard/pipeline.mjs"), "utf8");
  assert.match(route, /fallback:\s*500/, "the route's default read size moved; update BOARD_READ_LIMIT");
  assert.match(route, /cap:\s*2000/);
  const readApi = fs.readFileSync(path.join(ROOT, "src/http/read-api.mjs"), "utf8");
  assert.match(readApi, /export const MAX_LIMIT = 200;/, "the hiring read cap moved; update HIRING_READ_LIMIT");
  assert.match(
    fs.readFileSync(path.join(ROOT, "public/app/hiring.html"), "utf8"),
    /\/api\/hiring\/candidates\?state=all&limit=200/,
    "the hiring page asks for another size; update HIRING_READ_LIMIT"
  );
});

/* ---------- P1 pipeline:count-true ---------- */

test("count-true PASS: every column shows as many cards as the database holds, read with the route's own SQL", async () => {
  const counts = { sales: { new_lead: 3, booked: 1 }, affiliates_white_label: { active: 2 } };
  const db = dbFrom(mapOf({ counts, shown: counts }));
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:count-true"];
  shape(r);
  assert.equal(r.status, "PASS", r.detail);
  assert.match(r.detail, /6 cards on 4 boards\. Every column shows as many as the database holds\./);
  // It ran the board read once per board with the route's default size, and the demo switch the route reads first.
  const reads = db.seen.filter((s) => s.sql === BOARD_CARDS_SQL);
  assert.equal(reads.length, 4);
  for (const call of reads) {
    assert.equal(call.params[1], ORG);
    assert.equal(call.params[2], BOARD_READ_LIMIT);
    assert.equal(call.params[3], false);
  }
  assert.ok(db.seen.some((s) => s.sql === DEMO_SQL));
});

test("count-true FAIL: a board holds more than the read hands back (the 500 cut)", async () => {
  const counts = { sales: { new_lead: 510 } };
  const shown = { sales: { new_lead: 500 } };
  const rows = await gapChecks({ db: dbFrom(mapOf({ counts, shown })), orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:count-true"];
  shape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /10 cards on a board are not on the screen: Sales new_lead holds 510 and shows 500/);
});

test("count-true FAIL: a column shows fewer cards than the database holds, and the Hiring page cut at 200 is named", async () => {
  const counts = { optimization: { analysis: 2 } };
  const shown = { optimization: { analysis: 1 } };
  const db = dbFrom(mapOf({ counts, shown, over: { [HIRING_TRUTH_SQL]: [{ n: 250 }], [HIRING_PAINTED_SQL]: [{ n: 200 }] } }));
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:count-true"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /51 cards on a board are not on the screen/);
  assert.match(r.detail, /Repair analysis holds 2 and shows 1/);
  assert.match(r.detail, /the Hiring page holds 250 applications and shows 200/);
});

test("count-true FAIL: a card on a stage that is not on its board is not painted, so the column count is short", async () => {
  const counts = { sales: { booked: 2 } };
  // One of the two came back with a stage id that is not one of this board's columns.
  const db = dbFrom(mapOf({
    counts,
    over: { [BOARD_CARDS_SQL]: (params) => (params[0] === "sales"
      ? [{ id: "a", stage_id: "sales:booked" }, { id: "b", stage_id: "some-other-board:stage" }]
      : []) }
  }));
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:count-true"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /Sales booked holds 2 and shows 1/);
});

test("count-true: a read that fails is a skip with the reason, never a PASS", async () => {
  const noTruth = await gapChecks({ db: dbFrom(mapOf({ over: { [TRUTH_SQL]: () => { throw new Error("connection reset"); } } })), orgId: ORG, now: NOW });
  const a = byId(noTruth)["pipeline:count-true"];
  assert.equal(a.status, "skip");
  assert.match(a.detail, /could not read the cards on every board: connection reset/);

  const noDemo = await gapChecks({ db: dbFrom(mapOf({ over: { [DEMO_SQL]: () => { throw new Error("no orgs table"); } } })), orgId: ORG, now: NOW });
  assert.equal(byId(noDemo)["pipeline:count-true"].status, "skip");

  const noColumns = await gapChecks({ db: dbFrom(mapOf({ over: { [BOARD_STAGES_SQL]: [] } })), orgId: ORG, now: NOW });
  const c = byId(noColumns)["pipeline:count-true"];
  assert.equal(c.status, "skip");
  assert.match(c.detail, /the board has no columns/);

  const noHiring = await gapChecks({ db: dbFrom(mapOf({ over: { [HIRING_PAINTED_SQL]: () => { throw new Error("relation missing"); } } })), orgId: ORG, now: NOW });
  const d = byId(noHiring)["pipeline:count-true"];
  assert.equal(d.status, "skip");
  assert.match(d.detail, /Hiring page \(relation missing\)/);

  const empty = await gapChecks({ db: dbFrom(mapOf({ over: { [TRUTH_SQL]: [] } })), orgId: ORG, now: NOW });
  assert.equal(byId(empty)["pipeline:count-true"].status, "skip");
});

test("judgeCounts: a board that could not be read is left to the caller, a short column is named", () => {
  const painted = new Map([["sales", new Map([["new_lead", 4]])]]);
  const out = judgeCounts({
    truth: [
      { pipeline: "sales", stage: "new_lead", n: 5 },
      { pipeline: "optimization", stage: "intake", n: 9 }
    ],
    painted
  });
  assert.deepEqual(out.problems, [{ board: "sales", stage: "new_lead", db: 5, shown: 4 }]);
  assert.equal(out.cards, 14);
  assert.deepEqual(out.biggest, { board: "optimization", n: 9 });
});

/* ---------- P3 pipeline:age ---------- */

const ageRow = (pipeline, stage, enteredMsAgo, extra = {}) => ({
  pipeline,
  stage,
  stage_name: stage,
  card_id: `${pipeline}:${stage}`,
  entered_at: ago(enteredMsAgo),
  response_due_at: null,
  ...extra
});

test("age PASS: Repair cards inside the written clocks are judged and none is late", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ over: { [AGE_SQL]: [
      ageRow("optimization", "analysis", 20 * 60 * 1000),
      ageRow("optimization", "intake", 1 * DAY),
      // No clock is written for these, so they are not judged and are not counted.
      ageRow("optimization", "round_complete", 60 * DAY),
      ageRow("funding_card_stacking", "approved", 30 * DAY),
      ageRow("sales", "booked", 90 * DAY)
    ] } })),
    orgId: ORG,
    now: NOW
  });
  const r = byId(rows)["pipeline:age"];
  shape(r);
  assert.equal(r.status, "PASS", r.detail);
  assert.match(r.detail, /2 cards judged against a written time limit \(Repair\)/);
});

test("age FAIL: a Repair card past its stage clock is named with the limit and how long it has waited", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ over: { [AGE_SQL]: [
      ageRow("optimization", "analysis", 5 * DAY),
      ageRow("optimization", "analysis", 2 * DAY),
      ageRow("optimization", "ready_to_send", 3 * DAY)
    ] } })),
    orgId: ORG,
    now: NOW
  });
  const r = byId(rows)["pipeline:age"];
  shape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /3 cards sit past a stage time limit/);
  assert.match(r.detail, /Repair analysis: 2 cards past 1 hour \(oldest 5 days\)/);
  assert.match(r.detail, /Repair ready_to_send: 1 card past 4 hours \(oldest 3 days\)/);
});

test("age FAIL: an Awaiting Response card is late only 5 days after the bureau answer was due", async () => {
  const due = (daysFromNow) => new Date(NOW.getTime() + daysFromNow * DAY).toISOString();
  const fine = await gapChecks({
    db: dbFrom(mapOf({ over: { [AGE_SQL]: [ageRow("optimization", "awaiting_response", 40 * DAY, { response_due_at: due(-4) })] } })),
    orgId: ORG, now: NOW
  });
  assert.equal(byId(fine)["pipeline:age"].status, "PASS");
  const late = await gapChecks({
    db: dbFrom(mapOf({ over: { [AGE_SQL]: [ageRow("optimization", "awaiting_response", 40 * DAY, { response_due_at: due(-6) })] } })),
    orgId: ORG, now: NOW
  });
  assert.equal(byId(late)["pipeline:age"].status, "FAIL");
  // With no due date there is no clock to be late against, so it is not called late.
  const none = await gapChecks({
    db: dbFrom(mapOf({ over: { [AGE_SQL]: [ageRow("optimization", "awaiting_response", 400 * DAY)] } })),
    orgId: ORG, now: NOW
  });
  assert.equal(byId(none)["pipeline:age"].status, "PASS");
});

test("age: a read that fails is a skip with the reason, never a PASS", async () => {
  const rows = await gapChecks({ db: dbFrom(mapOf({ over: { [AGE_SQL]: () => { throw new Error("statement timeout"); } } })), orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:age"];
  assert.equal(r.status, "skip");
  assert.match(r.detail, /could not read the cards and their ages: statement timeout/);
});

test("judgeAges: a board with a limit set judges its open stages and never its finished ones", () => {
  const limits = { ...AGE_LIMIT_HOURS, sales: 48, funding_card_stacking: 72 };
  const out = judgeAges([
    ageRow("sales", "booked", 3 * DAY),
    ageRow("sales", "closed_won", 30 * DAY),
    ageRow("sales", "new_lead", 5 * HOUR),
    ageRow("funding_card_stacking", "approved", 4 * DAY),
    ageRow("funding_card_stacking", "funded", 40 * DAY),
    ageRow("hiring", "applied", 90 * DAY)
  ], NOW, limits);
  assert.equal(out.judged, 3, "the finished cards and the board with no limit are not judged");
  assert.deepEqual(out.over.map((o) => `${o.board}/${o.stage}/${o.limit}`), ["sales/booked/48 hours", "funding_card_stacking/approved/72 hours"]);
});

test("age-no-limit: the boards with no written clock are named and the row is a verified nothing-to-judge", async () => {
  const rows = await gapChecks({ db: dbFrom(mapOf()), orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:age-no-limit"];
  shape(r);
  assert.equal(r.status, "na");
  assert.equal(r.na.code, "no-limit-set");
  assert.deepEqual(r.na.args.boards, [
    "affiliates_white_label", "ar_collections", "funding_altfin", "funding_card_stacking", "hiring", "inquiry_removal", "sales"
  ]);
  assert.match(r.detail, /no stage time limit written/);
  assert.match(r.detail, /AGE_LIMIT_HOURS/);
  assert.deepEqual(boardsWithNoLimit({ sales: 48, hiring: null }), ["hiring"]);
  assert.deepEqual(boardsWithNoLimit({ sales: 48, hiring: 24 }), []);
});

test("age-no-limit: the audit proves it again, and the claim stops holding once a limit is set", async () => {
  const naOk = naVerify["no-limit-set"];
  const args = { check: "pipeline:age-no-limit", boards: ["sales", "hiring"] };
  assert.equal(await naOk(args), true);
  assert.equal(await naOk({ ...args, check: "pipeline:age" }), false, "a proof about another row");
  assert.equal(await naOk({ check: "pipeline:age-no-limit", boards: [] }), false);
  assert.equal(await naOk({ check: "pipeline:age-no-limit", boards: ["not-a-board"] }), false);
  // End to end through the audit's own door.
  const laneNaVerify = makeLaneNaVerify({ gapFiles: GAP_FILES });
  const row = { id: "gap-pipeline-boards:pipeline:age-no-limit", sliceId: "gap-pipeline-boards", na: { code: "no-limit-set", args } };
  const out = await verifyNa(row, { laneNaVerify });
  assert.equal(out.ok, true, out.reason);
  const bad = await verifyNa({ ...row, na: { code: "no-limit-set", args: { ...args, check: "other" } } }, { laneNaVerify });
  assert.equal(bad.ok, false);
});

/* ---------- P5 pipeline:dead-stage ---------- */

test("dead-stage na: no card sits on any of the 30 stages, and the row carries a proof the audit can check", async () => {
  const db = dbFrom(mapOf());
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:dead-stage"];
  shape(r);
  assert.equal(r.status, "na");
  assert.equal(r.na.code, "no-card-on-stage");
  assert.equal(r.na.args.stages.length, 30);
  assert.equal(r.na.args.orgId, ORG);
  assert.match(r.detail, /30 stages have no automatic mover and no card sits on one/);
  // The read is the lane's SQL with the keys and the test-client pattern.
  const call = db.seen.find((s) => s.sql === DEAD_CARDS_SQL);
  assert.deepEqual(call.params, [ORG, [...DEAD_STAGE_KEYS], TEST_CLIENT_EMAIL_RE]);
});

test("dead-stage FAIL: a card lands on Sales Confirmed, and a Hiring application on Ramp", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ over: {
      [DEAD_CARDS_SQL]: [{ pipeline: "sales", stage: "confirmed", n: 1 }],
      [DEAD_APPLICATIONS_SQL]: [{ pipeline: "hiring", stage: "ramp", n: 2 }]
    } })),
    orgId: ORG,
    now: NOW
  });
  const r = byId(rows)["pipeline:dead-stage"];
  shape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /3 cards landed on 2 stages nothing moves a card to/);
  assert.match(r.detail, /Sales confirmed holds 1 \(no code moves a card to Confirmed\)/);
  assert.match(r.detail, /Hiring ramp holds 2 \(no working transition reaches Ramp\)/);
  assert.equal(r.na, undefined, "a red row carries no nothing-to-judge proof");
});

test("dead-stage: a read that fails is a skip, never a nothing-to-judge", async () => {
  const rows = await gapChecks({ db: dbFrom(mapOf({ over: { [DEAD_APPLICATIONS_SQL]: () => { throw new Error("relation missing"); } } })), orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:dead-stage"];
  assert.equal(r.status, "skip");
  assert.equal(r.na, undefined);
});

test("dead-stage: the audit re-reads the cards, and the proof fails the day a card lands", async () => {
  const stages = [...DEAD_STAGE_KEYS];
  const args = { check: "pipeline:dead-stage", orgId: ORG, stages };
  const empty = dbFrom(mapOf());
  assert.equal(await naVerify["no-card-on-stage"](args, { db: empty }), true);
  const landed = dbFrom(mapOf({ over: { [DEAD_CARDS_SQL]: [{ pipeline: "inquiry_removal", stage: "removed", n: 1 }] } }));
  assert.equal(await naVerify["no-card-on-stage"](args, { db: landed }), false);
  assert.equal(await naVerify["no-card-on-stage"]({ ...args, check: "pipeline:age" }, { db: empty }), false);
  assert.equal(await naVerify["no-card-on-stage"]({ ...args, stages: [] }, { db: empty }), false);
  assert.equal(await naVerify["no-card-on-stage"](args, {}), false, "no database is not a proof");
  assert.equal(await naVerify["no-card-on-stage"]({ ...args, orgId: "nope" }, { db: empty }), false);
  // Through the audit's own door, with the proof the lane really wrote.
  const live = await gapChecks({ db: empty, orgId: ORG, now: NOW });
  const proof = byId(live)["pipeline:dead-stage"];
  const laneNaVerify = makeLaneNaVerify({ db: empty, gapFiles: GAP_FILES });
  const ok = await verifyNa({ id: "gap-pipeline-boards:pipeline:dead-stage", sliceId: "gap-pipeline-boards", na: proof.na }, { laneNaVerify });
  assert.equal(ok.ok, true, ok.reason);
  const laneNaVerifyLanded = makeLaneNaVerify({ db: landed, gapFiles: GAP_FILES });
  const red = await verifyNa({ id: "gap-pipeline-boards:pipeline:dead-stage", sliceId: "gap-pipeline-boards", na: proof.na }, { laneNaVerify: laneNaVerifyLanded });
  assert.equal(red.ok, false);
});

/* ---------- P6 pipeline:nobody-lost ---------- */

test("nobody-lost PASS: the three reads are clean", async () => {
  const db = dbFrom(mapOf());
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:nobody-lost"];
  shape(r);
  assert.equal(r.status, "PASS");
  // The paid read waits an hour after the payment and leaves test clients out.
  const call = db.seen.find((s) => s.sql === PAID_NO_CARD_SQL);
  assert.equal(call.params[0], ORG);
  assert.equal(call.params[1], new Date(NOW.getTime() - PAID_GRACE_MS).toISOString());
  assert.equal(call.params[2], TEST_CLIENT_EMAIL_RE);
});

test("nobody-lost FAIL: a paying client with no card, an archived client who paid, and a card off its board", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ over: {
      [PAID_NO_CARD_SQL]: [
        { client_id: "aaaaaaaa-0000-4000-8000-000000000001", category: "funding", total: 2 },
        { client_id: "bbbbbbbb-0000-4000-8000-000000000002", category: "repair", total: 2 }
      ],
      [ARCHIVED_THEN_PAID_SQL]: [{ client_id: "cccccccc-0000-4000-8000-000000000003", total: 1 }],
      [OFF_BOARD_SQL]: [{ pipeline: "sales", n: 3 }]
    } })),
    orgId: ORG,
    now: NOW
  });
  const r = byId(rows)["pipeline:nobody-lost"];
  shape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 paying clients have no card on the board that owns what they bought: aaaaaaaa \(funding\), bbbbbbbb \(repair\)/);
  assert.match(r.detail, /1 client paid after being archived and is on no board: cccccccc/);
  assert.match(r.detail, /3 cards sit on a stage its own board does not have: Sales 3/);
  assert.doesNotMatch(r.detail, /@/, "no address is printed");
});

test("nobody-lost: a failed read with no problem found is a skip, and a problem found wins over a failed read", async () => {
  const skip = await gapChecks({ db: dbFrom(mapOf({ over: { [OFF_BOARD_SQL]: () => { throw new Error("timeout"); } } })), orgId: ORG, now: NOW });
  const a = byId(skip)["pipeline:nobody-lost"];
  assert.equal(a.status, "skip");
  assert.match(a.detail, /cards off the board \(timeout\)/);
  const both = await gapChecks({
    db: dbFrom(mapOf({ over: {
      [OFF_BOARD_SQL]: () => { throw new Error("timeout"); },
      [PAID_NO_CARD_SQL]: [{ client_id: "aaaaaaaa-0000-4000-8000-000000000001", category: "funding", total: 1 }]
    } })),
    orgId: ORG, now: NOW
  });
  assert.equal(byId(both)["pipeline:nobody-lost"].status, "FAIL");
});

/* ---------- the lane ---------- */

test("gap pipeline boards: no database, or no company, is five skips and never a PASS", async () => {
  for (const ctx of [{}, { db: dbFrom(mapOf()) }, { db: dbFrom(mapOf()), orgId: "not-a-uuid" }]) {
    const rows = await gapChecks(ctx);
    assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
    for (const r of rows) {
      shape(r);
      assert.equal(r.status, "skip");
    }
  }
});

test("gap pipeline boards: the staff scope works when no plain database is given, and the lane stays inside the morning runner", async () => {
  const db = dbFrom(mapOf());
  const rows = await gapChecks({ scope: (fn) => fn(db), orgId: ORG, now: NOW });
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  assert.ok(rows.every((r) => r.status !== "skip"), JSON.stringify(rows.map((r) => r.status)));
  // Through the runner the 6 a.m. job uses: every id is there, once, and the proofs ride along.
  const run = await runGapLane("gap-pipeline-boards", { db: dbFrom(mapOf()), orgId: ORG, now: NOW });
  assert.equal(run.length, CHECK_IDS.length);
  assert.deepEqual(run.map((r) => r.checkId), [...CHECK_IDS]);
  for (const r of run.filter((x) => x.status === "na")) assert.ok(r.na && r.na.code);
});

test("gap pipeline boards: it finishes well inside the 20 second step even when every read waits", async () => {
  const slow = dbFrom(mapOf());
  const real = slow.query.bind(slow);
  slow.query = async (sql, params) => {
    await new Promise((r) => setTimeout(r, 5));
    return real(sql, params);
  };
  const t0 = Date.now();
  await gapChecks({ db: slow, orgId: ORG, now: NOW });
  assert.ok(Date.now() - t0 < 5000);
});
