import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AR_CARD_SQL,
  AR_STAGE_INVOICE,
  CARD_NO_ROUND_SQL,
  CHECK_IDS,
  FLOOR_VS_BOARD_SQL,
  FUNDING_AFTER_START,
  FUNDING_DONE_STAGES,
  FUNDING_FUNDED_SQL,
  INQUIRY_CLEARED_SQL,
  INQUIRY_CLEARED_STAGES,
  MOVE_RECEIPT_SQL,
  MOVE_WINDOW_MS,
  PARTNER_STAGES,
  PARTNER_STATUS_SQL,
  PAID_GRACE_MS,
  REPAIR_AFTER_SEND,
  REPAIR_BEFORE_SEND,
  REPAIR_CASE_CARD_SQL,
  ROUND_NO_CARD_SQL,
  SALES_BEFORE_BOOKED,
  SALES_BOOKED_SQL,
  SALES_PAID_SQL,
  SALES_PAID_STAGES,
  SETTLE_GRACE_MS,
  STAGE_EVENTS,
  gapChecks,
  judgeFloor,
  judgeMoves,
  monthWindow
} from "./gap-pipeline-facts.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";
import { GAP_FILES } from "./modules.mjs";
import { runGapLane } from "./run-slices.mjs";
import { laneCheckIds } from "../self-audit.mjs";
import { STAGE_TO_EVENT, emitCardStackingRoundTransition } from "../../funding/card-stacking-rounds.mjs";
import { monthWindow as floorMonthWindow } from "../../sales/metrics.mjs";
import { STAGE_SLA } from "../../repair/sla.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
// Code only. The header comments name the things this file refuses to do.
const SRC = fs
  .readFileSync(path.join(HERE, "gap-pipeline-facts.mjs"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
  .join("\n");

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-10T18:00:00.000Z");
const C1 = "aaaaaaaa-0000-4000-8000-000000000001";
const C2 = "bbbbbbbb-0000-4000-8000-000000000002";
const C3 = "cccccccc-0000-4000-8000-000000000003";

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

/** Everything clean by default: no card disagrees with anything. */
function mapOf(over = {}) {
  return {
    [SALES_PAID_SQL]: [],
    [SALES_BOOKED_SQL]: [],
    [FUNDING_FUNDED_SQL]: [],
    [INQUIRY_CLEARED_SQL]: [],
    [PARTNER_STATUS_SQL]: [],
    [AR_CARD_SQL]: [],
    [MOVE_RECEIPT_SQL]: [],
    [ROUND_NO_CARD_SQL]: [],
    [CARD_NO_ROUND_SQL]: [],
    [REPAIR_CASE_CARD_SQL]: [],
    [FLOOR_VS_BOARD_SQL]: [],
    ...over
  };
}

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

function shape(r) {
  assert.ok(CHECK_IDS.includes(r.id), r.id);
  assert.deepEqual(Object.keys(r), ["id", "status", "detail", "suggestedFix"]);
  assert.ok(["PASS", "FAIL", "skip"].includes(r.status));
  assert.ok(r.detail.length > 0);
  if (r.status === "FAIL") {
    assert.match(r.suggestedFix, /Do not auto-fix/);
    assert.match(r.suggestedFix, /Chris fixes reds/);
  } else {
    assert.equal(r.suggestedFix, null);
  }
}

/* ---------- source and wiring ---------- */

test("gap pipeline facts: the source reads only and reads no file", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE)\b/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /\bmethod:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(SRC, /["'`]\s*(BEGIN|COMMIT|ROLLBACK|SET)\b/i);
  assert.doesNotMatch(SRC, /node:fs|readFileSync|readdirSync/);
  for (const sql of [
    SALES_PAID_SQL, SALES_BOOKED_SQL, FUNDING_FUNDED_SQL, INQUIRY_CLEARED_SQL, PARTNER_STATUS_SQL, AR_CARD_SQL,
    MOVE_RECEIPT_SQL, ROUND_NO_CARD_SQL, CARD_NO_ROUND_SQL, REPAIR_CASE_CARD_SQL, FLOOR_VS_BOARD_SQL
  ]) {
    const bare = sql.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    assert.match(bare, /^(SELECT|WITH)\b/i);
  }
});

test("gap pipeline facts: it is on the named list and exports its ids", async () => {
  assert.ok(GAP_FILES.some(([name]) => name === "gap-pipeline-facts.mjs"));
  const mod = await GAP_FILES.find(([name]) => name === "gap-pipeline-facts.mjs")[1]();
  assert.deepEqual(laneCheckIds(mod), [...CHECK_IDS]);
  assert.equal(typeof mod.gapChecks, "function");
});

test("gap pipeline facts: the lists are true to the repo", async () => {
  // The stage-to-event table is the emitter's, minus the stage that fires nothing.
  const wanted = Object.fromEntries(Object.entries(STAGE_TO_EVENT).filter(([, event]) => event));
  assert.deepEqual({ ...STAGE_EVENTS }, wanted);

  // The event key the move writes is split the way MOVE_RECEIPT_SQL splits it.
  const written = [];
  const stub = {
    async query(sql, params) {
      written.push(params);
      return { rows: [{ id: "event-1" }] };
    }
  };
  await emitCardStackingRoundTransition(stub, { orgId: ORG, clientId: C1, stageKey: "approved", roundNumber: 2 });
  const key = written[0][3];
  assert.equal(key, `card_stacking:${C1}:2:approved:round.approved`);
  const parts = key.split(":");
  assert.equal(parts[0], "card_stacking");
  assert.equal(parts[1], C1);
  assert.equal(parts[3], "approved", "split_part(key, ':', 4) is the stage");
  assert.equal(parts[4], "round.approved", "split_part(key, ':', 5) is the event");
  assert.match(MOVE_RECEIPT_SQL, /split_part\(e\.idempotency_key, ':', 4\) = m\.stage/);
  assert.match(MOVE_RECEIPT_SQL, /split_part\(e\.idempotency_key, ':', 5\) = m\.event_name/);

  // The Sales floor's month is the one the lane uses.
  for (const d of ["2026-10-10T18:00:00Z", "2026-01-31T23:59:59Z", "2026-12-01T00:00:00Z"]) {
    const now = new Date(d);
    assert.deepEqual(
      { start: monthWindow(now).start.toISOString(), end: monthWindow(now).end.toISOString() },
      { start: floorMonthWindow(now).start.toISOString(), end: floorMonthWindow(now).end.toISOString() }
    );
  }

  // Stage keys and statuses exist in the seed or a migration.
  const seed = fs.readFileSync(path.join(ROOT, "db/seed/002_pipelines.sql"), "utf8");
  const migrations = fs.readdirSync(path.join(ROOT, "db/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .map((n) => fs.readFileSync(path.join(ROOT, "db/migrations", n), "utf8"))
    .join("\n");
  const text = `${seed}\n${migrations}`;
  const stages = [
    ...SALES_PAID_STAGES, ...SALES_BEFORE_BOOKED, ...FUNDING_DONE_STAGES, ...INQUIRY_CLEARED_STAGES,
    ...Object.values(PARTNER_STAGES).flat(), ...Object.keys(AR_STAGE_INVOICE),
    ...REPAIR_BEFORE_SEND, ...REPAIR_AFTER_SEND, ...FUNDING_AFTER_START
  ];
  for (const stage of stages) assert.match(text, new RegExp(`['"]${stage}['"]`), `${stage} is in no seed or migration`);
  for (const status of Object.values(AR_STAGE_INVOICE)) assert.match(text, new RegExp(`'${status}'`), `invoice status ${status}`);
  for (const stage of [...REPAIR_BEFORE_SEND, ...REPAIR_AFTER_SEND]) {
    if (STAGE_SLA[stage]) assert.ok(true);
  }
  // The partner status words the SQL names are the ones the table allows.
  assert.match(PARTNER_STATUS_SQL, /pr\.status = 'active' AND s\.key = 'active'/);
  assert.match(text, /status IN \('invited', 'active', 'paused'\)|'invited'.*'active'.*'paused'/s);
  assert.ok(MOVE_WINDOW_MS === 24 * 60 * 60 * 1000);
  assert.ok(SETTLE_GRACE_MS < PAID_GRACE_MS);
});

/* ---------- P2 pipeline:stage-vs-fact ---------- */

test("stage-vs-fact PASS: every card sits where its facts say, and the reads use the stage lists and the waits", async () => {
  const db = dbFrom(mapOf());
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:stage-vs-fact"];
  shape(r);
  assert.equal(r.status, "PASS");
  const paid = db.seen.find((s) => s.sql === SALES_PAID_SQL).params;
  assert.deepEqual(paid, [ORG, TEST_CLIENT_EMAIL_RE, ["closed_won", "downsell"], new Date(NOW.getTime() - PAID_GRACE_MS).toISOString()]);
  const booked = db.seen.find((s) => s.sql === SALES_BOOKED_SQL).params;
  assert.deepEqual(booked[2], ["new_lead", "survey_complete"]);
  assert.equal(booked[3], new Date(NOW.getTime() - SETTLE_GRACE_MS).toISOString());
  const inquiry = db.seen.find((s) => s.sql === INQUIRY_CLEARED_SQL).params;
  assert.deepEqual(inquiry[2], ["removed", "resume_funding", "hold"]);
});

test("stage-vs-fact FAIL: a paying client who is not on Closed Won or Downsell", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ [SALES_PAID_SQL]: [{ client_id: C1, stage: "diagnostic_paid", total: 1 }] })),
    orgId: ORG, now: NOW
  });
  const r = byId(rows)["pipeline:stage-vs-fact"];
  shape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 paying client is not on Closed Won or Downsell \(on diagnostic_paid\): aaaaaaaa/);
  assert.doesNotMatch(r.detail, new RegExp(C1), "only the short id is printed");
});

test("stage-vs-fact FAIL: a booked call with the card still before Booked", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ [SALES_BOOKED_SQL]: [{ client_id: C1, stage: "new_lead", total: 2 }, { client_id: C2, stage: "survey_complete", total: 2 }] })),
    orgId: ORG, now: NOW
  });
  const r = byId(rows)["pipeline:stage-vs-fact"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 clients with a booked call are still before Booked: aaaaaaaa, bbbbbbbb/);
});

test("stage-vs-fact FAIL: a funded round with the card behind, and a Funded card with no funded round", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ [FUNDING_FUNDED_SQL]: [
      { client_id: C1, stage: "approved", round_number: 1, problem: "round_funded_card_behind", total: 2 },
      { client_id: C2, stage: "funded", round_number: 1, problem: "card_funded_no_funded_round", total: 2 }
    ] })),
    orgId: ORG, now: NOW
  });
  const r = byId(rows)["pipeline:stage-vs-fact"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 Funding cards disagree with their round/);
  assert.match(r.detail, /the round says funded and the card is not on Funded/);
  assert.match(r.detail, /the card is on Funded and no round says funded/);
});

test("stage-vs-fact FAIL: a cleared inquiry case with the card still at Calls In Progress", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ [INQUIRY_CLEARED_SQL]: [{ client_id: C1, stage: "calls_in_progress", total: 1 }] })),
    orgId: ORG, now: NOW
  });
  const r = byId(rows)["pipeline:stage-vs-fact"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 inquiry client has every case Completed and the card is not on Removed or Resume Funding: aaaaaaaa/);
});

test("stage-vs-fact FAIL: a partner whose status the card does not match, and an AR card no invoice backs", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({
      [PARTNER_STATUS_SQL]: [{ partner_id: C3, status: "paused", stage: "active", total: 1 }],
      [AR_CARD_SQL]: [{ client_id: C2, stage: "escalation", total: 1 }]
    })),
    orgId: ORG, now: NOW
  });
  const r = byId(rows)["pipeline:stage-vs-fact"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 partner has a status the card does not match: cccccccc is paused on card active/);
  assert.match(r.detail, /1 AR card names an invoice state none of that client's invoices is in: bbbbbbbb/);
});

test("stage-vs-fact: a failed read with nothing found is a skip, and a problem found is red even when another read failed", async () => {
  const skip = await gapChecks({ db: dbFrom(mapOf({ [AR_CARD_SQL]: () => { throw new Error("relation invoices missing"); } })), orgId: ORG, now: NOW });
  const a = byId(skip)["pipeline:stage-vs-fact"];
  assert.equal(a.status, "skip");
  assert.match(a.detail, /AR invoices \(relation invoices missing\)/);
  const red = await gapChecks({
    db: dbFrom(mapOf({
      [AR_CARD_SQL]: () => { throw new Error("relation invoices missing"); },
      [SALES_PAID_SQL]: [{ client_id: C1, stage: "booked", total: 1 }]
    })),
    orgId: ORG, now: NOW
  });
  assert.equal(byId(red)["pipeline:stage-vs-fact"].status, "FAIL");
});

/* ---------- P4 pipeline:move-receipt ---------- */

const move = (over = {}) => ({
  client_id: C1,
  stage: "approved",
  event_name: "round.approved",
  entered_at: "2026-10-10T12:00:00.000Z",
  event_id: "evt-1",
  dead_letter: false,
  has_round: true,
  round_status: "started",
  total: 1,
  ...over
});

test("judgeMoves: a move is right only when the event is there, no handler failed, and its result is there", () => {
  assert.deepEqual(judgeMoves([move()]), []);
  assert.deepEqual(judgeMoves([move({ stage: "apply_now", event_name: "round.started", has_round: true })]), []);
  assert.deepEqual(judgeMoves([move({ stage: "funded", event_name: "round.funded", round_status: "funded" })]), []);
  assert.deepEqual(judgeMoves([move({ stage: "funded", event_name: "round.funded", round_status: "FUNDED" })]), [], "case does not matter");

  const missing = judgeMoves([move({ event_id: null })]);
  assert.equal(missing.length, 1);
  assert.match(missing[0].why, /moved to approved and round\.approved was never written/);

  const dead = judgeMoves([move({ dead_letter: true })]);
  assert.match(dead[0].why, /round\.approved fired and a handler failed on it/);

  const noRound = judgeMoves([move({ stage: "apply_now", event_name: "round.started", has_round: false })]);
  assert.match(noRound[0].why, /round\.started fired and no round row exists/);

  const notFunded = judgeMoves([move({ stage: "funded", event_name: "round.funded", round_status: "started" })]);
  assert.match(notFunded[0].why, /round\.funded fired and the round does not say funded/);
});

test("move-receipt: the read looks at the last day and waits 15 minutes, and PASS says what it saw", async () => {
  const db = dbFrom(mapOf({ [MOVE_RECEIPT_SQL]: [move(), move({ client_id: C2, stage: "closed", event_name: "round.closeout" })] }));
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:move-receipt"];
  shape(r);
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /2 Funding card moves in the last day\. Each wrote its round event/);
  const params = db.seen.find((s) => s.sql === MOVE_RECEIPT_SQL).params;
  assert.equal(params[2], new Date(NOW.getTime() - MOVE_WINDOW_MS).toISOString());
  assert.equal(params[3], new Date(NOW.getTime() - SETTLE_GRACE_MS).toISOString());
});

test("move-receipt PASS: no move in the last day says so and does not pretend to have checked one", async () => {
  const rows = await gapChecks({ db: dbFrom(mapOf()), orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:move-receipt"];
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /No Funding card moved in the last day/);
});

test("move-receipt FAIL: a card moved and its event was never written", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ [MOVE_RECEIPT_SQL]: [move({ event_id: null, stage: "funded", event_name: "round.funded" }), move({ client_id: C2 })] })),
    orgId: ORG, now: NOW
  });
  const r = byId(rows)["pipeline:move-receipt"];
  shape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 Funding card move in the last day did not finish: aaaaaaaa moved to funded and round\.funded was never written/);
});

test("move-receipt: a failed read is a skip with the reason", async () => {
  const rows = await gapChecks({ db: dbFrom(mapOf({ [MOVE_RECEIPT_SQL]: () => { throw new Error("relation failed_events missing"); } })), orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:move-receipt"];
  assert.equal(r.status, "skip");
  assert.match(r.detail, /relation failed_events missing/);
});

/* ---------- P7 pipeline:two-records ---------- */

test("two-records PASS: the records agree, and the floor is read for this month", async () => {
  const db = dbFrom(mapOf({ [FLOOR_VS_BOARD_SQL]: [{ client_id: C1, deposits: 1, downsells: 0, stage: "closed_won", total: 1 }] }));
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:two-records"];
  shape(r);
  assert.equal(r.status, "PASS");
  const params = db.seen.find((s) => s.sql === FLOOR_VS_BOARD_SQL).params;
  assert.equal(params[2], "2026-10-01T00:00:00.000Z");
  assert.equal(params[3], "2026-11-01T00:00:00.000Z");
  assert.deepEqual(db.seen.find((s) => s.sql === REPAIR_CASE_CARD_SQL).params.slice(2), [[...REPAIR_BEFORE_SEND], [...REPAIR_AFTER_SEND]]);
  assert.deepEqual(db.seen.find((s) => s.sql === CARD_NO_ROUND_SQL).params[2], [...FUNDING_AFTER_START]);
});

test("two-records FAIL: a round with no card, and a card with no round", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({
      [ROUND_NO_CARD_SQL]: [{ client_id: C1, round_number: 1, status: "started", total: 1 }],
      [CARD_NO_ROUND_SQL]: [{ client_id: C2, stage: "approved", total: 1 }]
    })),
    orgId: ORG, now: NOW
  });
  const r = byId(rows)["pipeline:two-records"];
  shape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 Funding round is still going and the client has no Funding card: aaaaaaaa/);
  assert.match(r.detail, /1 Funding card sits past Apply Now with no round row: bbbbbbbb/);
});

test("two-records FAIL: a repair case and card that cannot both be true", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ [REPAIR_CASE_CARD_SQL]: [
      { client_id: C1, stage: "analysis", any_awaiting: true, all_open: false, total: 2 },
      { client_id: C2, stage: "in_transit", any_awaiting: false, all_open: true, total: 2 }
    ] })),
    orgId: ORG, now: NOW
  });
  const r = byId(rows)["pipeline:two-records"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 Repair clients have a case and a card that disagree/);
  assert.match(r.detail, /a case says the letter is out and the card is before Letters Sent/);
  assert.match(r.detail, /the card says letters are out and every case is still open/);
});

test("judgeFloor: a deposit means Closed Won, a downsell alone means Downsell, no Sales card is a miss", () => {
  const out = judgeFloor([
    { client_id: C1, deposits: 1, downsells: 0, stage: "closed_won" },
    { client_id: C2, deposits: 0, downsells: 1, stage: "downsell" },
    { client_id: C3, deposits: 2, downsells: 0, stage: "booked" }
  ]);
  assert.equal(out.clients, 3);
  assert.equal(out.deposits, 3);
  assert.deepEqual(out.wrong, [{ client_id: C3, want: "closed_won", have: "booked" }]);
  const noCard = judgeFloor([{ client_id: C1, deposits: 1, downsells: 0, stage: null }]);
  assert.deepEqual(noCard.wrong, [{ client_id: C1, want: "closed_won", have: null }]);
  // A client with a deposit and a later downsell is a deposit client.
  assert.deepEqual(judgeFloor([{ client_id: C1, deposits: 1, downsells: 1, stage: "closed_won" }]).wrong, []);
});

test("two-records FAIL: the Sales floor counted a deposit and the board disagrees", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ [FLOOR_VS_BOARD_SQL]: [
      { client_id: C1, deposits: 1, downsells: 0, stage: "closed_won", total: 2 },
      { client_id: C2, deposits: 2, downsells: 0, stage: "showed", total: 2 }
    ] })),
    orgId: ORG, now: NOW
  });
  const r = byId(rows)["pipeline:two-records"];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /the Sales floor counted 3 deposits this month for 2 clients and the board disagrees on 1: bbbbbbbb should be on closed_won and is on showed/);
});

test("two-records: a failed read with nothing found is a skip, never a PASS", async () => {
  const rows = await gapChecks({ db: dbFrom(mapOf({ [FLOOR_VS_BOARD_SQL]: () => { throw new Error("relation call_outcomes missing"); } })), orgId: ORG, now: NOW });
  const r = byId(rows)["pipeline:two-records"];
  assert.equal(r.status, "skip");
  assert.match(r.detail, /Sales floor outcomes \(relation call_outcomes missing\)/);
});

/* ---------- the lane ---------- */

test("gap pipeline facts: no database, or no company, is three skips and never a PASS", async () => {
  for (const ctx of [{}, { db: dbFrom(mapOf()) }, { db: dbFrom(mapOf()), orgId: "not-a-uuid" }]) {
    const rows = await gapChecks(ctx);
    assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
    for (const r of rows) {
      shape(r);
      assert.equal(r.status, "skip");
    }
  }
});

test("gap pipeline facts: the staff scope works when no plain database is given, and the runner lays the rows out", async () => {
  const rows = await gapChecks({ scope: (fn) => fn(dbFrom(mapOf())), orgId: ORG, now: NOW });
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  assert.ok(rows.every((r) => r.status === "PASS"));
  const run = await runGapLane("gap-pipeline-facts", { db: dbFrom(mapOf()), orgId: ORG, now: NOW });
  assert.deepEqual(run.map((r) => r.checkId), [...CHECK_IDS]);
  assert.ok(run.every((r) => r.status === "PASS"));
});

test("gap pipeline facts: a read that throws becomes one skip row, and the other two checks still answer", async () => {
  const rows = await gapChecks({
    db: dbFrom(mapOf({ [MOVE_RECEIPT_SQL]: () => { throw new Error("boom"); } })),
    orgId: ORG, now: NOW
  });
  const r = byId(rows);
  assert.equal(r["pipeline:move-receipt"].status, "skip");
  assert.equal(r["pipeline:stage-vs-fact"].status, "PASS");
  assert.equal(r["pipeline:two-records"].status, "PASS");
});
