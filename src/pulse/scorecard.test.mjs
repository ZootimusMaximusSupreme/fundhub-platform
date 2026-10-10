// The morning scorecard (src/pulse/scorecard.mjs), zero-unchecked build, piece A.
//
// Rules proved here:
//   * four stored statuses: green, red, na, not_checked;
//   * an "na" row stays "na" only with a usable { code, args }; otherwise it is "not checked";
//   * a green with no proof is still "not checked";
//   * the counts add up, and na_count is written;
//   * before migration 477 is applied the morning report is still saved, in the old shape;
//   * migration 477 widens the counts-match check to four statuses and is safe to re-run.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NA_NO_REASON, applyRepeats, buildScorecard, countChecks, saveScorecard, toContractCheck
} from "./scorecard.mjs";

const NA = { code: "no-running-ad", args: { running: 0 } };

/* ---------- toContractCheck ---------- */

test("PASS with proof is green; PASS with no proof is not_checked, never green", () => {
  const ok = toContractCheck({ id: "reg:health", kind: "registry", status: "PASS", detail: "answered 200" });
  assert.deepEqual(ok, { id: "reg:health", group: "front_doors", status: "green", proof: "answered 200" });
  const bare = toContractCheck({ id: "reg:x", status: "PASS", detail: "" });
  assert.equal(bare.status, "not_checked");
  assert.match(bare.reason, /no proof/);
  assert.equal(toContractCheck({ id: "up", status: "up", detail: "" }).status, "not_checked");
  assert.equal(toContractCheck({ id: "up2", status: "up", detail: "ok" }).status, "green");
});

test("FAIL and down are red with the customer line and the fix", () => {
  const red = toContractCheck({ id: "job:x", status: "FAIL", detail: "no run", customerSees: "x stopped", suggestedFix: "read the run" });
  assert.equal(red.status, "red");
  assert.equal(red.customer_sees, "x stopped");
  assert.equal(red.fix, "read the run");
  assert.equal(toContractCheck({ id: "d", status: "down", detail: "x" }).status, "red");
});

test("skip, the old \"not checked\" string, and an empty status all land as not_checked with the reason", () => {
  for (const status of ["skip", "not checked", "", undefined, "weird"]) {
    const row = toContractCheck({ id: "gap-x:y", status, detail: "no database in this run" });
    assert.equal(row.status, "not_checked", String(status));
    assert.equal(row.reason, "no database in this run");
  }
});

test("na with a real code and args is stored as na, with the sentence, the code, and the args", () => {
  const row = toContractCheck({
    id: "gap-ads:ads-spend-day-missing", group: "backend", kind: "coverage", status: "na",
    detail: "No ad is running. Judged the day one runs.", na: NA
  });
  assert.deepEqual(row, {
    id: "gap-ads:ads-spend-day-missing",
    group: "backend",
    status: "na",
    reason: "No ad is running. Judged the day one runs.",
    na_code: "no-running-ad",
    na_args: { running: 0 }
  });
});

test("an na row with no sentence gets the code's own sentence", () => {
  const row = toContractCheck({ id: "x", status: "na", detail: "", na: NA });
  assert.equal(row.status, "na");
  assert.equal(row.reason, "No ad is running. Judged the day one runs.");
});

test("na args are stored as plain JSON: a time becomes its ISO text, and the row does not share the producer's object", () => {
  const args = { names: ["round.started"], since: new Date("2026-10-06T07:00:00Z") };
  const row = toContractCheck({ id: "wf:x", status: "na", detail: "No round.started event came.", na: { code: "no-demand", args } });
  assert.equal(row.status, "na");
  assert.deepEqual(row.na_args, { names: ["round.started"], since: "2026-10-06T07:00:00.000Z" });
  args.names.push("changed-later");
  assert.deepEqual(row.na_args.names, ["round.started"]);
});

test("na with no usable reason becomes not_checked with the exact reason", () => {
  assert.equal(NA_NO_REASON, "Said nothing to judge but gave no reason the computer can check");
  const cases = [
    undefined,                                   // no na object at all
    { code: "no-running-ad" },                   // no args
    { code: "invented-code", args: {} },         // a code that is not on the list
    { code: "no-running-ad", args: "x" },        // args not a plain object
    { code: "no-demand", args: { names: [], since: "2026-10-06T00:00:00Z" } }, // args that cannot be checked
    { code: "toString", args: {} }               // an inherited name is not a code
  ];
  for (const na of cases) {
    const row = toContractCheck({ id: "wf:x", status: "na", detail: "Nothing to see.", na });
    assert.equal(row.status, "not_checked", JSON.stringify(na));
    assert.equal(row.reason, NA_NO_REASON);
    assert.equal("na_code" in row, false);
  }
});

test("the folded claim list (also) rides along on every status, as plain strings", () => {
  const ids = ["06-briefs:morning-brief", "02-daily-pulse:x"];
  assert.deepEqual(toContractCheck({ id: "reg:a", status: "PASS", detail: "ok", also: ids }).also, ids);
  assert.deepEqual(toContractCheck({ id: "reg:a", status: "FAIL", detail: "no", also: ids }).also, ids);
  assert.deepEqual(toContractCheck({ id: "reg:a", status: "skip", detail: "no", also: ids }).also, ids);
  assert.deepEqual(toContractCheck({ id: "reg:a", status: "na", detail: "x", na: NA, also: ids }).also, ids);
  assert.equal("also" in toContractCheck({ id: "reg:a", status: "PASS", detail: "ok" }), false);
  assert.equal("also" in toContractCheck({ id: "reg:a", status: "PASS", detail: "ok", also: [] }), false);
  assert.equal("also" in toContractCheck({ id: "reg:a", status: "PASS", detail: "ok", also: "nope" }), false);
  assert.deepEqual(toContractCheck({ id: "reg:a", status: "PASS", detail: "ok", also: ["a", 3, "", "b"] }).also, ["a", "b"]);
});

/* ---------- counts and the whole card ---------- */

test("countChecks counts four statuses and they add up", () => {
  const rows = [
    { status: "green" }, { status: "green" }, { status: "red" },
    { status: "na" }, { status: "na" }, { status: "na" }, { status: "not_checked" }
  ];
  assert.deepEqual(countChecks(rows), { green: 2, red: 1, na: 3, not_checked: 1 });
  assert.deepEqual(countChecks([]), { green: 0, red: 0, na: 0, not_checked: 0 });
});

test("buildScorecard turns a mixed run into one card whose counts equal its rows", () => {
  const card = buildScorecard({
    now: new Date("2026-10-09T13:00:00Z"),
    checks: [
      { id: "reg:a", kind: "registry", status: "PASS", detail: "200" },
      { id: "job:b", status: "FAIL", detail: "late" },
      { id: "gap-ads:c", status: "na", detail: "No ad is running.", na: NA },
      { id: "gap-ads:d", status: "na", detail: "Quiet.", na: { code: "made-up", args: {} } },
      { id: "gap-x:e", status: "skip", detail: "no database" }
    ]
  });
  assert.equal(card.date, "2026-10-09");
  assert.deepEqual(card.checks.map((c) => c.status), ["green", "red", "na", "not_checked", "not_checked"]);
  const n = countChecks(card.checks);
  assert.equal(n.green + n.red + n.na + n.not_checked, card.checks.length);
  assert.deepEqual(n, { green: 1, red: 1, na: 1, not_checked: 2 });
});

test("a red carries since and day_count from the last stored morning; an na row is left alone", () => {
  const previous = { date: "2026-10-08", checks: [{ id: "job:b", status: "red", since: "2026-10-07" }] };
  const card = buildScorecard({
    now: new Date("2026-10-09T13:00:00Z"),
    previous,
    checks: [
      { id: "job:b", status: "FAIL", detail: "late" },
      { id: "gap-ads:c", status: "na", detail: "No ad is running.", na: NA }
    ]
  });
  const [red, na] = card.checks;
  assert.equal(red.since, "2026-10-07");
  assert.equal(red.day_count, 3);
  assert.equal("day_count" in na, false);
  assert.deepEqual(applyRepeats([{ id: "k", status: "na" }], { date: "2026-10-09", previous }), [{ id: "k", status: "na" }]);
});

/* ---------- saveScorecard ---------- */

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";

function card() {
  return buildScorecard({
    now: new Date("2026-10-09T13:00:00Z"),
    checks: [
      { id: "reg:a", kind: "registry", status: "PASS", detail: "200" },
      { id: "job:b", status: "FAIL", detail: "late" },
      { id: "gap-ads:c", status: "na", detail: "No ad is running. Judged the day one runs.", na: NA, also: ["03-x:claim"] },
      { id: "gap-x:e", status: "skip", detail: "no database" }
    ]
  });
}

function pgError(code, message) {
  return Object.assign(new Error(message), { code });
}

test("saveScorecard writes na_count with the other three counts, in the stored JSON the na rows and their also lists", async () => {
  const calls = [];
  const db = { query: async (text, params) => { calls.push({ text, params }); return { rows: [{ id: "row-1" }] }; } };
  const out = await saveScorecard(db, ORG, card());
  assert.deepEqual(out, { saved: true, id: "row-1", counts: { green: 1, red: 1, na: 1, not_checked: 1 } });
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /na_count/);
  assert.match(calls[0].text, /na_count = EXCLUDED\.na_count/);
  const p = calls[0].params;
  assert.deepEqual([p[3], p[4], p[5], p[7]], [1, 1, 1, 1], "green, red, not_checked, na_count");
  assert.equal(p[6], ORG);
  const stored = JSON.parse(p[2]);
  assert.equal(stored[2].status, "na");
  assert.equal(stored[2].na_code, "no-running-ad");
  assert.deepEqual(stored[2].also, ["03-x:claim"]);
});

test("saveScorecard needs an org", async () => {
  await assert.rejects(saveScorecard({ query: async () => ({ rows: [] }) }, null, card()), /org is required/);
});

for (const code of ["42703", "23514"]) {
  test(`before migration 477 (Postgres ${code}) the report is still saved, once more, in the old shape`, async () => {
    const calls = [];
    const db = {
      query: async (text, params) => {
        calls.push({ text, params });
        if (calls.length === 1) throw pgError(code, code === "42703" ? 'column "na_count" does not exist' : "violates check");
        return { rows: [{ id: "row-2" }] };
      }
    };
    const warned = [];
    const orig = console.warn;
    console.warn = (...a) => warned.push(a.join(" "));
    let out;
    try { out = await saveScorecard(db, ORG, card()); } finally { console.warn = orig; }

    assert.equal(calls.length, 2, "exactly one retry");
    assert.doesNotMatch(calls[1].text, /na_count/, "no na_count in the old shape");
    const stored = JSON.parse(calls[1].params[2]);
    assert.equal(stored.some((c) => c.status === "na"), false, "no na row is written to the old table");
    assert.equal(stored[2].status, "not_checked");
    assert.equal("na_code" in stored[2], false);
    assert.equal(stored[2].reason, "No ad is running. Judged the day one runs.", "the sentence is kept");
    assert.deepEqual(calls[1].params.slice(3, 6), [1, 1, 2], "old counts: green, red, not_checked (the na row counts here)");
    assert.equal(stored.length, 4, "no row is lost");
    assert.deepEqual(out, { saved: true, id: "row-2", counts: { green: 1, red: 1, na: 0, not_checked: 2 }, legacy: true, na_downgraded: 1 });
    assert.equal(warned.length, 1, "one line, not a flood");
    assert.match(warned[0], /migration 477/);
  });
}

test("any other database error is thrown as it was, with no second try", async () => {
  let n = 0;
  const err = pgError("57014", "canceling statement due to statement timeout");
  const db = { query: async () => { n += 1; throw err; } };
  await assert.rejects(saveScorecard(db, ORG, card()), (e) => e === err);
  assert.equal(n, 1);
  n = 0;
  const plain = new Error("connection reset");
  await assert.rejects(saveScorecard({ query: async () => { n += 1; throw plain; } }, ORG, card()), (e) => e === plain);
  assert.equal(n, 1);
});

test("if the old-shape save fails too, that error is thrown and it remembers the first one", async () => {
  const first = pgError("42703", "no column");
  const second = pgError("23505", "duplicate");
  let n = 0;
  const db = { query: async () => { n += 1; throw n === 1 ? first : second; } };
  const orig = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(saveScorecard(db, ORG, card()), (e) => e === second && e.cause === first);
  } finally {
    console.warn = orig;
  }
  assert.equal(n, 2);
});

/* ---------- migration 477 ---------- */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, "../../db/migrations");
const FILE = "477_zero_unchecked_na.sql";
const raw = fs.readFileSync(path.join(MIGRATIONS, FILE), "utf8");
/* The comments talk about the very things asserted below, so match against code only. */
const code = raw.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

test("migration 477: the number is used once, and it sorts after 475", () => {
  assert.deepEqual(fs.readdirSync(MIGRATIONS).filter((f) => f.startsWith("477_")), [FILE]);
  assert.ok(fs.readdirSync(MIGRATIONS).includes("475_pulse_beats_incidents.sql"));
});

test("migration 477 adds na_count as NOT NULL DEFAULT 0 with a named check, and only if it is missing", () => {
  assert.match(code, /ADD COLUMN IF NOT EXISTS na_count integer NOT NULL DEFAULT 0/);
  assert.match(code, /CONSTRAINT pulse_scorecards_na_count_ck CHECK \(na_count >= 0\)/);
});

test("migration 477 counts four statuses and checks that they add up to the array", () => {
  const body = code.slice(code.indexOf("ADD CONSTRAINT pulse_scorecards_counts_match"));
  for (const status of ["green", "red", "not_checked", "na"]) {
    assert.match(body, new RegExp(`@\\.status == "${status}"`), status);
  }
  assert.match(body, /na_count = jsonb_array_length/);
  assert.match(body, /green_count \+ red_count \+ not_checked_count \+ na_count = jsonb_array_length\(checks\)/);
});

test("migration 477 can run twice: the check is dropped, then added back", () => {
  const drop = code.indexOf("DROP CONSTRAINT IF EXISTS pulse_scorecards_counts_match");
  const add = code.indexOf("ADD CONSTRAINT pulse_scorecards_counts_match");
  assert.ok(drop > 0 && add > drop, "drop comes first");
});

test("migration 477 deletes nothing, drops no table, no column and no data", () => {
  assert.doesNotMatch(code, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(code, /\bTRUNCATE\b/i);
  assert.doesNotMatch(code, /\bDROP\s+(TABLE|COLUMN|INDEX|POLICY)\b/i);
  assert.doesNotMatch(code, /CONCURRENTLY/i, "each file runs in one transaction");
});
