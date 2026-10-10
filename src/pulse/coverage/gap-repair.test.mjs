import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { STAGE_SLA } from "../../repair/sla.mjs";
import { REPAIR_STUCK_STAGES } from "../pipeline-motion.mjs";
import { CHECKS as SLICE_15 } from "./slice-15-repair.mjs";
import {
  CARD_NO_LETTER_SQL,
  CHECK_IDS,
  CLOCK_CARDS_SQL,
  ENGINE_STAGE,
  LETTER_GRACE_MS,
  OPEN_CASE_NO_LETTER_SQL,
  PIPELINE_MOTION_STAGES,
  STALLED_CASES_SQL,
  WAITING_STAGES,
  breachedCards,
  gapChecks
} from "./gap-repair.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-08T15:00:00.000Z");
const SHAPE = ["id", "status", "detail", "suggestedFix"];
const STATUSES = new Set(["PASS", "FAIL", "skip"]);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function iso(msBefore) {
  return new Date(NOW.getTime() - msBefore).toISOString();
}

function card(clientId, stage, ago, extra = {}) {
  return { id: `card-${clientId}`, client_id: clientId, stage_key: stage, entered_at: iso(ago), ...extra };
}

// Tells the five repair reads apart by what the SQL says. Anything else throws, so
// a check that reads the wrong table cannot pass by accident.
function fakeDb({ stalled = [], waiting = [], analysis = [], openCases = [], cardsNoLetter = [], throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ text, params });
      if (!/^\s*SELECT\b/i.test(text)) throw new Error(`write sql is not allowed: ${text.slice(0, 60)}`);
      if (throwOn && throwOn.test(text)) throw new Error("connection refused");
      if (/dc\.status = 'stalled'/.test(text)) return { rows: stalled };
      if (/dc\.status = 'open'/.test(text)) return { rows: openCases };
      if (/ps\.key IN \('letters_generated', 'ready_to_send'\)/.test(text)) return { rows: cardsNoLetter };
      if (/ps\.key = ANY\(\$2::text\[\]\)/.test(text)) {
        return { rows: params[1].includes(ENGINE_STAGE) ? analysis : waiting };
      }
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

function assertShape(rows) {
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), SHAPE);
    assert.equal(typeof row.id, "string");
    assert.ok(STATUSES.has(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Recon \(AG-07\) is the only tripwire/);
      assert.match(row.suggestedFix, /Do not add a second watchdog/);
      assert.match(row.suggestedFix, /Do not send bureau mail/);
      assert.match(row.suggestedFix, /Do not pull credit/);
      assert.match(row.suggestedFix, /Do not rewrite a dispute letter that contradicts itself/);
      assert.match(row.suggestedFix, /Do not auto-fix/);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

test("gapChecks skips both reads when there is no database", async () => {
  for (const ctx of [undefined, null, {}, { db: {} }, { db: { query() {} } }, { orgId: ORG }]) {
    const rows = await gapChecks(ctx);
    assertShape(rows);
    assert.equal(rows[0].status, "skip");
    assert.equal(rows[1].status, "skip");
    assert.match(rows[0].detail, /no database/);
    assert.match(rows[1].detail, /no database/);
  }
});

test("the stage lists agree with the clocks and with the pipeline check that already reds them", () => {
  // If pipeline-motion changes its stages, this file must change with it.
  assert.deepEqual([...PIPELINE_MOTION_STAGES], [...REPAIR_STUCK_STAGES]);
  assert.deepEqual([...WAITING_STAGES], ["intake", "awaiting_documents", "in_transit", "awaiting_response"]);
  for (const stage of WAITING_STAGES) {
    assert.ok(STAGE_SLA[stage], `${stage} has a clock`);
    assert.equal(PIPELINE_MOTION_STAGES.includes(stage), false);
  }
  assert.ok(STAGE_SLA[ENGINE_STAGE]);
  assert.equal(STAGE_SLA[ENGINE_STAGE].hours, 1);
  assert.equal(LETTER_GRACE_MS, 30 * 60 * 1000);
  // The ids are not the workflow list slice 15 already carries.
  const taken = new Set(SLICE_15.map((row) => row.id));
  for (const id of CHECK_IDS) assert.equal(taken.has(id), false);
});

test("gapChecks passes when nothing is stuck and no letter round is missing, reading only", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  assertShape(rows);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "PASS");
  assert.match(rows[0].detail, /no stuck repair cases/);
  assert.match(rows[1].detail, /no letter round is waiting/);
  assert.equal(db.calls.length, 5);
  for (const call of db.calls) assert.match(call.text, /^\s*SELECT\b/i);
  const waiting = db.calls.find((c) => /ps\.key = ANY/.test(c.text) && !c.params[1].includes("analysis"));
  assert.deepEqual(waiting.params, [ORG, [...WAITING_STAGES]]);
  const analysis = db.calls.find((c) => /ps\.key = ANY/.test(c.text) && c.params[1].includes("analysis"));
  assert.deepEqual(analysis.params, [ORG, ["analysis"]]);
  const open = db.calls.find((c) => /dc\.status = 'open'/.test(c.text));
  assert.equal(open.params[0], ORG);
  assert.equal(open.params[1].getTime(), NOW.getTime() - LETTER_GRACE_MS);
});

test("every SQL here is a SELECT, skips demo clients, and stays in the optimization board", () => {
  for (const sql of [STALLED_CASES_SQL, CLOCK_CARDS_SQL, OPEN_CASE_NO_LETTER_SQL, CARD_NO_LETTER_SQL]) {
    assert.match(sql, /^\s*SELECT\b/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
    assert.match(sql, /COALESCE\(cl\.is_demo, false\) = false/);
  }
  assert.match(CLOCK_CARDS_SQL, /p\.key = 'optimization'/);
  assert.match(CARD_NO_LETTER_SQL, /p\.key = 'optimization'/);
  assert.match(CLOCK_CARDS_SQL, /dc\.status NOT IN \('closed', 'cancelled'\)/);
});

test("a stalled repair case fails only the stuck check", async () => {
  const rows = await gapChecks({
    db: fakeDb({ stalled: [{ id: "case-9" }, { id: "case-2" }] }),
    orgId: ORG, now: NOW
  });
  assertShape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /2 repair cases are marked stalled/);
  assert.match(rows[0].detail, /case case-9/);
  assert.equal(rows[1].status, "PASS");
});

test("a file past the clock in a waiting stage fails the stuck check, and one inside the clock does not", async () => {
  const cases = [
    ["awaiting_documents", 15 * DAY, true],
    ["awaiting_documents", 13 * DAY, false],
    ["in_transit", 11 * DAY, true],
    ["in_transit", 9 * DAY, false],
    ["intake", 4 * DAY, true],
    ["intake", 2 * DAY, false]
  ];
  for (const [stage, ago, fails] of cases) {
    const rows = await gapChecks({
      db: fakeDb({ waiting: [card("c-1", stage, ago)] }), orgId: ORG, now: NOW
    });
    assertShape(rows);
    assert.equal(rows[0].status, fails ? "FAIL" : "PASS", `${stage} ${ago}`);
    assert.equal(rows[1].status, "PASS");
    if (fails) {
      assert.match(rows[0].detail, /1 repair file is past its clock/);
      assert.match(rows[0].detail, new RegExp(`c-1 \\(${stage}\\)`));
    }
  }
  const due = await gapChecks({
    db: fakeDb({ waiting: [card("c-late", "awaiting_response", 30 * DAY, { response_due_at: iso(6 * DAY) })] }),
    orgId: ORG, now: NOW
  });
  assert.equal(due[0].status, "FAIL");
  const inside = await gapChecks({
    db: fakeDb({ waiting: [card("c-ok", "awaiting_response", 30 * DAY, { response_due_at: iso(4 * DAY) })] }),
    orgId: ORG, now: NOW
  });
  assert.equal(inside[0].status, "PASS");
});

test("breachedCards uses the repair clocks and ignores stages with none", () => {
  const rows = [
    card("a", "analysis", 2 * HOUR),
    card("b", "analysis", 20 * 60000),
    card("c", "on_hold", 90 * DAY),
    null
  ];
  assert.deepEqual(breachedCards(rows, NOW).map((r) => r.client_id), ["a"]);
});

test("a file stuck in analysis past its hour means the letter engine did not finish: FAIL", async () => {
  const rows = await gapChecks({
    db: fakeDb({ analysis: [card("c-bram", "analysis", 3 * DAY)] }), orgId: ORG, now: NOW
  });
  assertShape(rows);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /1 repair file has sat in analysis past the 1 hour clock with no letters made/);
  assert.match(rows[1].detail, /c-bram \(analysis\)/);
  assert.match(rows[1].suggestedFix, /Do not mail it/);
  const fresh = await gapChecks({
    db: fakeDb({ analysis: [card("c-new", "analysis", 20 * 60000)] }), orgId: ORG, now: NOW
  });
  assert.equal(fresh[1].status, "PASS");
});

test("an open case with items and no letter fails only the letter check", async () => {
  const rows = await gapChecks({
    db: fakeDb({ openCases: [{ id: "case-3", round: "R2" }] }), orgId: ORG, now: NOW
  });
  assertShape(rows);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /1 open case has dispute items and no letter/);
  assert.match(rows[1].detail, /case case-3 R2/);
});

test("a card that says letters were made when none exist fails the letter check", async () => {
  const rows = await gapChecks({
    db: fakeDb({ cardsNoLetter: [{ id: "card-4", stage_key: "ready_to_send" }] }), orgId: ORG, now: NOW
  });
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /1 card says letters were made and none exist/);
});

test("both breaks can fail in one read", async () => {
  const rows = await gapChecks({
    db: fakeDb({
      stalled: [{ id: "case-1" }],
      analysis: [card("c-a", "analysis", 2 * DAY)],
      openCases: [{ id: "case-8", round: "R1" }]
    }),
    orgId: ORG, now: NOW
  });
  assertShape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /1 repair case is marked stalled/);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /case case-8 R1/);
  assert.match(rows[1].detail, /c-a \(analysis\)/);
});

test("a read error fails that check with the reason and leaves the other one alone", async () => {
  const rows = await gapChecks({
    db: fakeDb({ throwOn: /dc\.status = 'stalled'/ }), orgId: ORG, now: NOW
  });
  assertShape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /connection refused/);
  assert.equal(rows[1].status, "PASS");
  const other = await gapChecks({
    db: fakeDb({ throwOn: /dc\.status = 'open'/ }), orgId: ORG, now: NOW
  });
  assert.equal(other[0].status, "PASS");
  assert.equal(other[1].status, "FAIL");
  assert.match(other[1].detail, /connection refused/);
});

test("the module only reads, and it does not repeat the repair workflow list", () => {
  const src = fs.readFileSync(new URL("./gap-repair.mjs", import.meta.url), "utf8");
  assert.match(src, /export async function gapChecks/);
  assert.match(src, /slice-15-repair\.mjs/);
  assert.doesNotMatch(src, /c-00-crs-soft-pull|ds-02-diy-letters|repair-bureau-response-reader/);
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|fetch\(|postgrid|sendRepair|analyzeAndGenerate|body_text|crs_)\b/i);
  assert.match(src, /status = 'stalled'/);
  assert.match(src, /dispute_items/);
  assert.match(src, /letters_generated/);
  assert.match(src, /ready_to_send/);
  assert.doesNotMatch(src, /variance_failed/);
});
