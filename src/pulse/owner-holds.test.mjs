// Owner holds (src/pulse/owner-holds.mjs): a late file on hold is named, not judged; any other late file is red.
// Tests both ways for the hold list, the "owner-hold" nothing-to-judge code, and every check that uses it.
import test from "node:test";
import assert from "node:assert/strict";

import {
  HELD_CODES, OWNER_HOLD_CODE, OWNER_HOLDS, heldCodesOf, heldCodesSqlList, isHeldCode, ownerHoldNote,
  ownerHoldRow, splitHeld, stillOwnerHold
} from "./owner-holds.mjs";
import { NA_CONDITIONS, naProblem, verifyNa } from "./na-conditions.mjs";
import * as fulfillment from "./coverage/gap-fulfillment.mjs";
import * as repair from "./coverage/gap-repair.mjs";
import * as boards from "./coverage/gap-pipeline-boards.mjs";
import { judgeRepair, judgeRepairWithHolds } from "./coverage/gap-trip-repair.mjs";
import { judgeDisplayResult } from "./coverage/gap-catalog-display.mjs";
import { STAGE_ANALYSIS_SQL } from "./catalog/proofs/fin-b07-sql-repair.mjs";
import catalog from "./catalog/generated.json" with { type: "json" };

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-20T20:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms);
const HELD = "FH-000507";
const OTHER = "FH-000901";

/* ---------- the list ---------- */

test("the hold list is the owner's one client, and only real client codes are held", () => {
  assert.deepEqual([...HELD_CODES], [HELD]);
  assert.equal(OWNER_HOLDS[0].since, "2026-10-09");
  assert.equal(isHeldCode("fh-000507"), true);
  assert.equal(isHeldCode(OTHER), false);
  assert.equal(isHeldCode(null), false);
  assert.equal(heldCodesSqlList(), "('FH-000507')");
  assert.match(ownerHoldNote(), /FH-000507/);
});

test("splitHeld keeps every other file open, and the held one apart", () => {
  const rows = [{ c: HELD }, { c: OTHER }, { c: null }];
  const { open, held } = splitHeld(rows, (r) => r.c);
  assert.deepEqual(open.map((r) => r.c), [OTHER, null]);
  assert.deepEqual(held.map((r) => r.c), [HELD]);
  assert.deepEqual(heldCodesOf([{ c: "fh-000507" }, { c: HELD }], (r) => r.c), [HELD]);
});

test("stillOwnerHold is true only for the same owner-hold claim", () => {
  const row = ownerHoldRow("x:y", ORG, [HELD]);
  assert.equal(stillOwnerHold(row, row.na.args), true);
  assert.equal(stillOwnerHold({ ...row, status: "FAIL" }, row.na.args), false);
  assert.equal(stillOwnerHold(row, { clients: [] }), false);
  assert.equal(stillOwnerHold(null, row.na.args), false);
});

/* ---------- the nothing-to-judge code ---------- */

test("the owner-hold code accepts a held client and refuses anyone else", () => {
  assert.equal(NA_CONDITIONS[OWNER_HOLD_CODE].verify, "lane");
  assert.equal(naProblem({ code: OWNER_HOLD_CODE, args: { check: "pipeline:age", orgId: ORG, clients: [HELD] } }), null);
  assert.match(naProblem({ code: OWNER_HOLD_CODE, args: { check: "pipeline:age", clients: [OTHER] } }), /not on the owner hold list/);
  assert.match(naProblem({ code: OWNER_HOLD_CODE, args: { check: "pipeline:age", clients: [] } }), /not a list/);
  assert.match(naProblem({ code: OWNER_HOLD_CODE, args: { clients: [HELD] } }), /check is missing/);
});

test("verifyNa asks the lane, and a lane that says no is not true", async () => {
  const row = { ...ownerHoldRow("pipeline:age", ORG, [HELD]), sliceId: "gap-pipeline-boards" };
  const yes = await verifyNa(row, { laneNaVerify: async () => true });
  assert.equal(yes.ok, true);
  const no = await verifyNa(row, { laneNaVerify: async () => false });
  assert.equal(no.ok, false);
});

/* ---------- fulfillment:next-action ---------- */

function nextDb(rows) {
  return {
    async query(sql) {
      const text = String(sql);
      if (/gap:fulfillment-next-action/.test(text)) return { rows };
      if (/gap:fulfillment-desk-clients/.test(text)) return { rows: [] };
      if (/gap:fulfillment-apply-blocked/.test(text)) return { rows: [{ n: 0 }] };
      throw new Error(`unexpected sql: ${text.slice(0, 60)}`);
    }
  };
}
const lateCard = (code, id) => ({
  id, client_id: `client-${id}`, client_code: code, stage_key: "analysis",
  entered_at: ago(15 * DAY), updated_at: ago(15 * DAY), response_due_at: null
});
const noStep = async () => ({ found: true, fulfillment: { degraded: false, next_action: null } });

test("fulfillment:next-action: only the held file late -> nothing to judge, owner-hold, re-checks true", async () => {
  const db = nextDb([lateCard(HELD, "a")]);
  const rows = await fulfillment.gapChecks({ db, orgId: ORG, now: NOW, readShownStep: noStep });
  const row = rows.find((r) => r.id === "fulfillment:next-action");
  assert.equal(row.status, "na");
  assert.equal(row.na.code, OWNER_HOLD_CODE);
  assert.deepEqual(row.na.args.clients, [HELD]);
  assert.match(row.detail, /FH-000507/);
  assert.equal(await fulfillment.naVerify[OWNER_HOLD_CODE](row.na.args, { db, now: NOW }), true);
});

test("fulfillment:next-action: another late file with no step -> red by name, and the hold claim fails", async () => {
  const db = nextDb([lateCard(HELD, "a"), lateCard(OTHER, "b")]);
  const rows = await fulfillment.gapChecks({ db, orgId: ORG, now: NOW, readShownStep: noStep });
  const row = rows.find((r) => r.id === "fulfillment:next-action");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /client-b/);
  assert.doesNotMatch(row.detail, /client-a/);
  const args = { check: "fulfillment:next-action", orgId: ORG, clients: [HELD] };
  assert.equal(await fulfillment.naVerify[OWNER_HOLD_CODE](args, { db, now: NOW }), false);
});

/* ---------- repair-letter-round ---------- */

function repairDb({ analysis = [], cases = [], cards = [] } = {}) {
  return {
    async query(sql, params) {
      const text = String(sql);
      if (/dc\.status = 'stalled'/.test(text)) return { rows: [] };
      if (/dispute_items/.test(text)) return { rows: cases };
      if (/'letters_generated', 'ready_to_send'/.test(text)) return { rows: cards };
      if (/ps\.key = ANY/.test(text)) return { rows: (params[1] || []).includes("analysis") ? analysis : [] };
      throw new Error(`unexpected sql: ${text.slice(0, 60)}`);
    }
  };
}

test("repair-letter-round: only the held file in analysis past its hour -> owner-hold, re-checks true", async () => {
  const db = repairDb({ analysis: [lateCard(HELD, "a")] });
  const row = (await repair.gapChecks({ db, orgId: ORG, now: NOW })).find((r) => r.id === "repair-letter-round");
  assert.equal(row.status, "na");
  assert.equal(row.na.code, OWNER_HOLD_CODE);
  assert.equal(await repair.naVerify[OWNER_HOLD_CODE](row.na.args, { db, now: NOW }), true);
});

test("repair-letter-round: another client's open case with no letter -> red, and the hold claim fails", async () => {
  const db = repairDb({ analysis: [lateCard(HELD, "a")], cases: [{ id: "case-9", round: "R1", client_code: OTHER }] });
  const row = (await repair.gapChecks({ db, orgId: ORG, now: NOW })).find((r) => r.id === "repair-letter-round");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /case-9/);
  assert.equal(await repair.naVerify[OWNER_HOLD_CODE](
    { check: "repair-letter-round", orgId: ORG, clients: [HELD] }, { db, now: NOW }), false);
});

test("repair-letter-round: nothing late at all -> green, not a hold", async () => {
  const row = (await repair.gapChecks({ db: repairDb(), orgId: ORG, now: NOW })).find((r) => r.id === "repair-letter-round");
  assert.equal(row.status, "PASS");
});

/* ---------- pipeline:age ---------- */

function boardsDb(ageRows) {
  return {
    async query(sql) {
      const text = String(sql);
      if (/gap:pipeline-age/.test(text)) return { rows: ageRows };
      return { rows: [] };
    }
  };
}
const ageRow = (code, id) => ({
  pipeline: "optimization", stage: "analysis", stage_name: "Analysis", card_id: id, client_code: code,
  entered_at: ago(15 * DAY), response_due_at: null
});

test("pipeline:age: only the held card past its limit -> owner-hold, re-checks true", async () => {
  const db = boardsDb([ageRow(HELD, "a")]);
  const row = (await boards.gapChecks({ db, orgId: ORG, now: NOW })).find((r) => r.id === "pipeline:age");
  assert.equal(row.status, "na");
  assert.equal(row.na.code, OWNER_HOLD_CODE);
  assert.equal(await boards.naVerify[OWNER_HOLD_CODE](row.na.args, { db, now: NOW }), true);
});

test("pipeline:age: another card past its limit -> red, and the hold claim fails", async () => {
  const db = boardsDb([ageRow(HELD, "a"), ageRow(OTHER, "b")]);
  const row = (await boards.gapChecks({ db, orgId: ORG, now: NOW })).find((r) => r.id === "pipeline:age");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 card sits past/);
  assert.equal(await boards.naVerify[OWNER_HOLD_CODE](
    { check: "pipeline:age", orgId: ORG, clients: [HELD] }, { db, now: NOW }), false);
});

/* ---------- trip:repair ---------- */

const tripRow = (code) => ({
  client_id: `client-${code}`, client_code: code,
  purchase_at: ago(20 * DAY), enrolled_at: ago(20 * DAY), program_status: "active",
  verified_at: ago(18 * DAY), credit_file_at: ago(18 * DAY), authorized_at: null,
  letters_made_at: null, letters_mailed_at: null, later_round_at: null, answer_read_at: null,
  card_stage: "analysis", card_entered_at: ago(15 * DAY), response_due_at: null
});

test("trip:repair: the held trip is stuck and the only one -> green that names the hold", () => {
  assert.equal(judgeRepair({ rows: [tripRow(HELD)], now: NOW }).status, "FAIL", "the fixture is a stuck trip");
  const row = judgeRepairWithHolds({ rows: [tripRow(HELD)], now: NOW });
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /owner hold/);
  assert.match(row.detail, /FH-000507/);
});

test("trip:repair: another customer's trip is stuck -> red, about that customer", () => {
  const row = judgeRepairWithHolds({ rows: [tripRow(HELD), tripRow(OTHER)], now: NOW });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 of 1 customer/);
});

/* ---------- the repair stage columns on the screen ---------- */

test("the stage columns leave held files out of the count, and their green line says so", () => {
  assert.match(STAGE_ANALYSIS_SQL, /NOT IN \('FH-000507'\)/);
  const entry = catalog.displayResultCases.find((e) => e.contract?.sql?.includes("display-result:fin-b07-stage-analysis"));
  assert.ok(entry, "the analysis column contract is compiled");
  assert.match(entry.contract.heldNote, /FH-000507/);
  const quiet = judgeDisplayResult(entry, { sample_count: 0, bad_count: 0 });
  assert.equal(quiet.status, "PASS");
  assert.match(quiet.detail, /not counted: FH-000507/);
  const wrong = judgeDisplayResult(entry, { sample_count: 2, bad_count: 1 });
  assert.equal(wrong.status, "FAIL");
});
