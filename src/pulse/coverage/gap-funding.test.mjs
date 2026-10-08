import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  MAX_FILES_READ,
  STUCK_AFTER_MS,
  TERMINAL_ROUND_STATUSES,
  WAITING_STAGE_KEYS,
  gapChecks,
  showsNextStep
} from "./gap-funding.mjs";
import { FUNDING_WORKFLOW_IDS } from "./slice-14-funding.mjs";
import { CHECKS as ADVISOR_CHECKS } from "./slice-28-funding-advisor.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T19:00:00.000Z");
const NO_BOOK_ROOT = os.tmpdir();

// A fake database that tells the five funding reads apart by what the SQL says,
// and refuses anything that is not a SELECT. The answers are numbers or rows
// the test sets, so a check that reads the wrong table or the wrong column
// shows up as an unexpected-sql throw instead of a silent PASS.
function fakeDb(answers = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (!/^\s*SELECT\b/i.test(text)) throw new Error(`write sql is not allowed: ${text}`);
      if (/FROM agents\b/.test(text)) throw new Error("this lane must not read agents (daily-pulse does)");
      if (/GREATEST\(/.test(text)) return { rows: [{ n: answers.stuck ?? 0 }] };
      if (/a\.status = 'Apply'/.test(text)) return { rows: [{ n: answers.applyWaiting ?? 0 }] };
      if (/FROM lenders\b/.test(text)) return { rows: [{ n: answers.lenders ?? 4 }] };
      if (/FROM cards c\b/.test(text)) return { rows: answers.queue ?? [] };
      throw new Error(`unexpected sql: ${text}`);
    }
  };
}

function queueRow(clientId, total = 1, stage = "apply_now") {
  return { card_id: `card-${clientId}`, client_id: clientId, stage_key: stage, total };
}

function stepFor(map) {
  const asked = [];
  const fn = async (db, orgId, clientId) => {
    asked.push({ orgId, clientId });
    const hit = map[clientId];
    if (hit instanceof Error) throw hit;
    return hit;
  };
  fn.asked = asked;
  return fn;
}

const SHOWS = { found: true, fulfillment: { degraded: false, next_action: { key: "apply_for_funding", label: "Apply for Funding" } } };
const BLANK = { found: true, fulfillment: { degraded: false, next_action: null } };
const DEGRADED = { found: true, fulfillment: { degraded: true, next_action: null } };

function byId(rows) {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

test("gap funding: no database skips every check", async () => {
  const rows = await gapChecks({});
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  for (const row of rows) {
    assert.equal(row.status, "skip");
    assert.equal(row.suggestedFix, null);
    assert.ok(row.detail.length > 0);
  }
  const noOrg = await gapChecks({ db: fakeDb() });
  assert.ok(noOrg.every((row) => row.status === "skip"));
});

test("gap funding: a clear desk is four PASS rows, only reads, and never reads Recon", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, bookRows: 306 });
  assert.deepEqual(rows.map((row) => row.status), ["PASS", "PASS", "PASS", "PASS"]);
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  for (const row of rows) {
    assert.ok(row.detail.length > 0);
    assert.equal(row.suggestedFix, null);
  }
  const cut = NOW.getTime() - STUCK_AFTER_MS;
  const stuck = db.calls.find((call) => /GREATEST\(/.test(call.sql));
  assert.equal(stuck.params[0], ORG);
  assert.deepEqual(stuck.params[1], [...TERMINAL_ROUND_STATUSES]);
  assert.equal(stuck.params[2].getTime(), cut);
  // A round moves when a bank row on it moves.
  assert.match(stuck.sql, /FROM applications a/);
  assert.match(stuck.sql, /a\.funding_round_id = fr\.id/);
  assert.match(stuck.sql, /COALESCE\(fr\.is_demo, false\) = false/);
  const apply = db.calls.find((call) => /a\.status = 'Apply'/.test(call.sql));
  assert.deepEqual(apply.params[2], [...TERMINAL_ROUND_STATUSES]);
  assert.equal(apply.params[1].getTime(), cut);
  assert.match(apply.sql, /a\.submitted_date IS NULL/);
  const queue = db.calls.find((call) => /FROM cards c\b/.test(call.sql));
  assert.deepEqual(queue.params[1], [...WAITING_STAGE_KEYS]);
  assert.equal(queue.params[2].getTime(), cut);
  assert.match(queue.sql, /p\.key = 'funding_card_stacking'/);
  assert.match(queue.sql, /entered_at/);
  assert.ok(db.calls.every((call) => /^\s*SELECT\b/i.test(call.sql)));
  assert.ok(db.calls.every((call) => !/FROM agents\b/.test(call.sql)));
});

test("gap funding: a round with no movement for 72 hours is a FAIL", async () => {
  const hit = byId(await gapChecks({ db: fakeDb({ stuck: 2 }), orgId: ORG, now: NOW, bookRows: 306 }));
  assert.equal(hit["funding:round-stuck"].status, "FAIL");
  assert.match(hit["funding:round-stuck"].detail, /2 funding rounds still open with no movement/);
  assert.match(hit["funding:round-stuck"].suggestedFix, /Recon \(AG-07\)/);
  assert.equal(hit["funding:lender-book"].status, "PASS");
  assert.equal(hit["funding:submit-path"].status, "PASS");
  assert.equal(hit["funding:advisor-queue"].status, "PASS");
});

test("gap funding: lender list empty with a book to load is a FAIL, with or without the file", async () => {
  const withBook = byId(await gapChecks({ db: fakeDb({ lenders: 0 }), orgId: ORG, now: NOW, bookRows: 306 }));
  assert.equal(withBook["funding:lender-book"].status, "FAIL");
  assert.match(withBook["funding:lender-book"].detail, /empty/);
  assert.match(withBook["funding:lender-book"].detail, /306 banks/);
  assert.match(withBook["funding:lender-book"].suggestedFix, /Do not invent bank names/);

  // The live bundle has no book file. An empty list there is still a break.
  const noFile = byId(await gapChecks({ db: fakeDb({ lenders: 0 }), orgId: ORG, now: NOW, root: NO_BOOK_ROOT }));
  assert.equal(noFile["funding:lender-book"].status, "FAIL");
  assert.match(noFile["funding:lender-book"].detail, /book file is not on this host/);

  const emptyBook = byId(await gapChecks({ db: fakeDb({ lenders: 0 }), orgId: ORG, now: NOW, bookRows: 0 }));
  assert.equal(emptyBook["funding:lender-book"].status, "skip");
  assert.match(emptyBook["funding:lender-book"].detail, /no rows to load/);

  const loaded = byId(await gapChecks({ db: fakeDb({ lenders: 1106 }), orgId: ORG, now: NOW, root: NO_BOOK_ROOT }));
  assert.equal(loaded["funding:lender-book"].status, "PASS");
  assert.match(loaded["funding:lender-book"].detail, /1106 banks/);
});

test("gap funding: the real book file in the repo is found when the list is empty", async () => {
  const rows = byId(await gapChecks({ db: fakeDb({ lenders: 0 }), orgId: ORG, now: NOW }));
  assert.equal(rows["funding:lender-book"].status, "FAIL");
  assert.match(rows["funding:lender-book"].detail, /the book has \d+ banks to load/);
});

test("gap funding: an Apply row sitting 72 hours with no submit date is a FAIL", async () => {
  const hit = byId(await gapChecks({ db: fakeDb({ applyWaiting: 1 }), orgId: ORG, now: NOW, bookRows: 306 }));
  assert.equal(hit["funding:submit-path"].status, "FAIL");
  assert.match(hit["funding:submit-path"].detail, /1 application still on Apply with no submit date/);
  assert.match(hit["funding:submit-path"].suggestedFix, /Do not submit a real lender app/);
  assert.equal(hit["funding:round-stuck"].status, "PASS");
});

test("gap funding: showsNextStep reads the same shape the screen does", () => {
  assert.equal(showsNextStep(SHOWS.fulfillment), true);
  assert.equal(showsNextStep({ degraded: false, next_action: { label: "  " } }), false);
  assert.equal(showsNextStep({ degraded: false, next_action: null }), false);
  assert.equal(showsNextStep({ degraded: true, next_action: { label: "Pull CRS" } }), false);
  assert.equal(showsNextStep(null), false);
  assert.equal(showsNextStep(undefined), false);
});

test("gap funding: a waiting file whose screen shows no step is a FAIL; one that shows a step is a PASS", async () => {
  const rows = [queueRow("c-ok", 3), queueRow("c-blank", 3, "approved"), queueRow("c-degraded", 3, "action_required")];
  const readShownStep = stepFor({ "c-ok": SHOWS, "c-blank": BLANK, "c-degraded": DEGRADED });
  const hit = byId(await gapChecks({
    db: fakeDb({ queue: rows }), orgId: ORG, now: NOW, bookRows: 306, readShownStep
  }));
  const queue = hit["funding:advisor-queue"];
  assert.equal(queue.status, "FAIL");
  assert.match(queue.detail, /2 funding files waited 72 hours and the screen shows no next step/);
  assert.match(queue.detail, /c-blank/);
  assert.match(queue.detail, /c-degraded/);
  assert.doesNotMatch(queue.detail, /c-ok/);
  assert.match(queue.suggestedFix, /set the next step/);
  assert.deepEqual(readShownStep.asked.map((a) => a.clientId), ["c-ok", "c-blank", "c-degraded"]);
  assert.ok(readShownStep.asked.every((a) => a.orgId === ORG));

  const clear = byId(await gapChecks({
    db: fakeDb({ queue: [queueRow("c-ok", 1)] }),
    orgId: ORG, now: NOW, bookRows: 306, readShownStep: stepFor({ "c-ok": SHOWS })
  }));
  assert.equal(clear["funding:advisor-queue"].status, "PASS");
  assert.match(clear["funding:advisor-queue"].detail, /every one shows a next step/);
});

test("gap funding: a step that cannot be read is a skip with the reason, never a PASS", async () => {
  const hit = byId(await gapChecks({
    db: fakeDb({ queue: [queueRow("c-boom")] }),
    orgId: ORG, now: NOW, bookRows: 306,
    readShownStep: stepFor({ "c-boom": new Error("connection reset") })
  }));
  assert.equal(hit["funding:advisor-queue"].status, "skip");
  assert.match(hit["funding:advisor-queue"].detail, /connection reset/);

  const missing = byId(await gapChecks({
    db: fakeDb({ queue: [queueRow("c-gone")] }),
    orgId: ORG, now: NOW, bookRows: 306,
    readShownStep: stepFor({ "c-gone": { found: false, fulfillment: null } })
  }));
  assert.equal(missing["funding:advisor-queue"].status, "skip");
  assert.match(missing["funding:advisor-queue"].detail, /client not found/);

  // One blank file is still a FAIL even when another file could not be read.
  const mixed = byId(await gapChecks({
    db: fakeDb({ queue: [queueRow("c-blank", 2), queueRow("c-boom", 2)] }),
    orgId: ORG, now: NOW, bookRows: 306,
    readShownStep: stepFor({ "c-blank": BLANK, "c-boom": new Error("timeout") })
  }));
  assert.equal(mixed["funding:advisor-queue"].status, "FAIL");
});

test("gap funding: the default step reader runs the real control panel work-out", async () => {
  // Every read returns no rows, so the real readClientStepRows finds no client.
  const db = {
    calls: 0,
    async query(sql) {
      const text = String(sql);
      if (/FROM cards c\b/.test(text)) return { rows: [queueRow("c-real")] };
      if (/GREATEST\(/.test(text) || /a\.status = 'Apply'/.test(text) || /FROM lenders\b/.test(text)) {
        return { rows: [{ n: 1 }] };
      }
      db.calls += 1;
      return { rows: [] };
    }
  };
  const hit = byId(await gapChecks({ db, orgId: ORG, now: NOW, bookRows: 306 }));
  assert.ok(db.calls >= 6, "the six control panel reads ran");
  assert.equal(hit["funding:advisor-queue"].status, "skip");
  assert.match(hit["funding:advisor-queue"].detail, /client not found/);
});

test("gap funding: only the oldest files are read, and the total is said", async () => {
  const rows = Array.from({ length: MAX_FILES_READ }, (_, i) => queueRow(`c-${i}`, 40));
  const readShownStep = stepFor(Object.fromEntries(rows.map((r) => [r.client_id, SHOWS])));
  const hit = byId(await gapChecks({
    db: fakeDb({ queue: rows }), orgId: ORG, now: NOW, bookRows: 306, readShownStep
  }));
  assert.equal(hit["funding:advisor-queue"].status, "PASS");
  assert.match(hit["funding:advisor-queue"].detail, new RegExp(`oldest ${MAX_FILES_READ} of 40`));
  assert.equal(readShownStep.asked.length, MAX_FILES_READ);
});

test("gap funding: a read error is a FAIL with the reason, not a throw", async () => {
  const db = {
    async query() {
      throw new Error("relation funding_rounds does not exist");
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, bookRows: 306 });
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.status === "FAIL"));
  assert.match(rows[0].detail, /funding_rounds/);
  assert.match(rows[0].suggestedFix, /Do not invent a second watchdog/);
});

test("gap funding: ids do not repeat slice 14 or slice 28, and Recon is not read here", async () => {
  const rows = await gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, bookRows: 306 });
  const ids = new Set(rows.map((row) => row.id));
  for (const id of FUNDING_WORKFLOW_IDS) assert.equal(ids.has(id), false);
  for (const row of ADVISOR_CHECKS) assert.equal(ids.has(row.id), false);
  assert.equal([...ids].some((id) => /recon/i.test(id)), false);
});

test("gap funding: source stays read-only, sends nothing, and has no file-text route check", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("./gap-funding.mjs", import.meta.url)), "utf8");
  assert.match(src, /export async function gapChecks/);
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|submitApplication|lendflow)\b/);
  assert.doesNotMatch(src, /\bfetch\s*\(/);
  assert.doesNotMatch(src, /\.html/);
  assert.doesNotMatch(src, /createFunction|new watchdog/i);
  assert.doesNotMatch(src, /FROM agents/);
  assert.doesNotMatch(src, /netlify\/functions\/api\.mjs/);
  assert.match(src, /Do not invent a second watchdog/);
});
