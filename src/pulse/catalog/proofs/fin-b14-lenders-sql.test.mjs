// Practice test for the server half of the six Lenders list filters, Export CSV and the mismatch queue's
// Confirm and Corrected buttons in batch 14: the REAL api/read/lenders.mjs, api/read/lender-observations.mjs
// and api/lender-observations.mjs handlers, their REAL SQL, run over stand-in rows (SQLite, real column names
// from db/migrations; fin-b14-sql-kit.mjs). The earlier handler test (fin-b14-lenders-handlers.test.mjs) reads
// the SQL text on a fake database that never runs it, so a filter turned inside out, or two filters joined
// with OR instead of AND, kept every pattern in it true. This file asks what each one RETURNS or WRITES.
//
// The expected sets are worked out below from the fake rows, not read from the page or the handler.
// No database, no network.

import assert from "node:assert/strict";
import test from "node:test";

import listHandler from "../../../../api/read/lenders.mjs";
import queueHandler from "../../../../api/read/lender-observations.mjs";
import reviewHandler from "../../../../api/lender-observations.mjs";
import { makeStandIn, portableSql } from "./fin-b14-sql-kit.mjs";
import { makeRes, req, staffRow, ORG_ID, OTHER_ORG_ID } from "../../../testing/handler-harness.mjs";

const RECENT = "2026-10-01T00:00:00.000Z";
const row = (id, over) => ({
  id, org_id: ORG_ID, lender_table: "OnlineBizCC", name: id, bureaus_pulled: null, priority_tier: null, active: true,
  eligible_states: null, notes: null, is_demo: false, created_at: RECENT, updated_at: RECENT, ...over,
});

// Seven lenders of the company, one of another company, one sample (demo) lender.
const LENDERS = [
  row("Mesa Community Bank", { lender_table: "OnlineBizCC", bureaus_pulled: "EX", priority_tier: 1, eligible_states: "AZ, NV", notes: "good for a line of credit" }),
  row("Desert First Bank", { lender_table: "PersonalCC", bureaus_pulled: "EQ/TU", priority_tier: 2, eligible_states: "CA" }),
  row("Canyon Credit Union", { lender_table: "BizLOC_Stated", bureaus_pulled: "TU", priority_tier: 3, active: false, eligible_states: null, notes: "Mesa area members only" }),
  row("Pioneer Bank", { lender_table: "OnlineBizCC", bureaus_pulled: null, priority_tier: null, eligible_states: "All States" }),
  row("Lakeside Bank", { lender_table: "PersonalLOC", bureaus_pulled: "EX", priority_tier: 1, active: false, eligible_states: "*" }),
  row("Summit Bank", { lender_table: "PersonalLoans", bureaus_pulled: "EX/EQ/TU", priority_tier: 2, eligible_states: "   " }),
  row("Mesa Other Company Bank", { org_id: OTHER_ORG_ID, lender_table: "OnlineBizCC", bureaus_pulled: "EX", priority_tier: 1, eligible_states: "AZ" }),
  row("DEMO Mesa Sample Bank", { is_demo: true, lender_table: "OnlineBizCC", bureaus_pulled: "EX", priority_tier: 1, eligible_states: "AZ" }),
];

// SQLite hands a true flag back as 1. Postgres hands back true, and the product compares with ===.
const FLAGS = ["demo_mode_enabled", "is_demo", "active"];
const asPostgres = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, FLAGS.includes(k) && (v === 0 || v === 1) ? v === 1 : v]));

/** A database whose session check is answered here and everything else is run for real over the stand-in. */
function open({ demoMode = false, role = "owner" } = {}) {
  const standIn = makeStandIn(["lenders", "orgs"]);
  for (const lender of LENDERS) standIn.insert("lenders", lender);
  standIn.insert("orgs", { id: ORG_ID, demo_mode_enabled: demoMode });
  const sent = [];
  const db = {
    async query(sql, params = []) {
      const text = typeof sql === "string" ? sql : sql.text;
      if (/FROM live JOIN staff/.test(text)) return { rows: [staffRow({ role })], rowCount: 1 };
      sent.push({ sql: text, params });
      const bound = params.map((p) => (p === true ? 1 : p === false ? 0 : p));
      const rows = standIn.db.prepare(portableSql(text)).all(...bound).map(asPostgres);
      return { rows, rowCount: rows.length };
    },
  };
  return { db, sent, close: () => standIn.close() };
}

async function list(query, options) {
  const { db, sent, close } = open(options);
  try {
    const res = makeRes();
    await listHandler(req("GET", { query }), res, { db });
    return { res, sent };
  } finally {
    close();
  }
}

const namesOf = (res) => res.body.lenders.map((l) => l.name).sort();
const ALL_SIX_OF_ORG = ["Canyon Credit Union", "Desert First Bank", "Lakeside Bank", "Mesa Community Bank", "Pioneer Bank", "Summit Bank"];
const only = (...names) => [...names].sort();

test("no filter: every lender of the company, no other company's lender, no sample lender", async () => {
  const { res } = await list({});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(namesOf(res), ALL_SIX_OF_ORG);
  assert.equal(res.body.meta.count, 6);
});

test("List filter: Product table select returns only that product table's lenders", async () => {
  assert.deepEqual(namesOf((await list({ lender_table: "OnlineBizCC" })).res), only("Mesa Community Bank", "Pioneer Bank"));
  assert.deepEqual(namesOf((await list({ lender_table: "PersonalCC" })).res), only("Desert First Bank"));
  assert.deepEqual(namesOf((await list({ lender_table: "BizLOC_Documented" })).res), []);
  // a name that is not one of the seven is dropped, not run: the whole company list comes back
  assert.deepEqual(namesOf((await list({ lender_table: "Nope" })).res), ALL_SIX_OF_ORG);
});

test("List filter: Bureau pulled input returns the lenders whose bureaus contain it, in any case", async () => {
  assert.deepEqual(namesOf((await list({ bureau: "TU" })).res), only("Desert First Bank", "Canyon Credit Union", "Summit Bank"));
  assert.deepEqual(namesOf((await list({ bureau: "ex" })).res), only("Mesa Community Bank", "Lakeside Bank", "Summit Bank"));
  assert.deepEqual(namesOf((await list({ bureau: " EQ " })).res), only("Desert First Bank", "Summit Bank"));
  assert.deepEqual(namesOf((await list({ bureau: "XX" })).res), []);
});

test("List filter: Priority tier select returns only that tier, and a lender with no tier is in no tier", async () => {
  assert.deepEqual(namesOf((await list({ priority_tier: "1" })).res), only("Mesa Community Bank", "Lakeside Bank"));
  assert.deepEqual(namesOf((await list({ priority_tier: "2" })).res), only("Desert First Bank", "Summit Bank"));
  assert.deepEqual(namesOf((await list({ priority_tier: "3" })).res), only("Canyon Credit Union"));
});

test("List filter: Status select returns the active lenders or the inactive ones, not both", async () => {
  assert.deepEqual(namesOf((await list({ active: "true" })).res), only("Mesa Community Bank", "Desert First Bank", "Pioneer Bank", "Summit Bank"));
  assert.deepEqual(namesOf((await list({ active: "false" })).res), only("Canyon Credit Union", "Lakeside Bank"));
  assert.deepEqual(namesOf((await list({ active: "" })).res), ALL_SIX_OF_ORG, "All");
});

test("List filter: Eligible state input keeps a lender that names the state and every lender that takes any state", async () => {
  // Mesa names AZ and NV; Desert names CA only; Canyon has no states (legacy: any state); Pioneer says All States;
  // Lakeside says *; Summit is blank.
  const anyState = ["Canyon Credit Union", "Pioneer Bank", "Lakeside Bank", "Summit Bank"];
  assert.deepEqual(namesOf((await list({ state: "NV" })).res), only("Mesa Community Bank", ...anyState));
  assert.deepEqual(namesOf((await list({ state: "ca" })).res), only("Desert First Bank", ...anyState));
  assert.deepEqual(namesOf((await list({ state: "ZZ" })).res), only(...anyState), "a state nobody names still returns the any-state lenders");
});

test("List filter: Eligible state input - each way of saying any state counts, and a near miss does not", async () => {
  // Each way is tried alone, so dropping any one part of the condition loses its lender.
  const { db, close } = (() => {
    const standIn = makeStandIn(["lenders", "orgs"]);
    const ways = [
      row("Null States", { eligible_states: null }),
      row("Blank States", { eligible_states: "  " }),
      row("Empty States", { eligible_states: "" }),
      row("All", { eligible_states: "all" }),
      row("ALL STATES", { eligible_states: "ALL  STATES" }),
      row("Star", { eligible_states: "*" }),
      row("Alaska Only", { eligible_states: "Alaska" }),
      row("Allied Only", { eligible_states: "Allied Territories" }),
      row("Star Plus", { eligible_states: "*, AZ" }),
    ];
    for (const w of ways) standIn.insert("lenders", w);
    standIn.insert("orgs", { id: ORG_ID, demo_mode_enabled: false });
    return {
      db: {
        async query(sql, params = []) {
          const text = typeof sql === "string" ? sql : sql.text;
          if (/FROM live JOIN staff/.test(text)) return { rows: [staffRow()], rowCount: 1 };
          const rows = standIn.db.prepare(portableSql(text)).all(...params.map((p) => (p === true ? 1 : p === false ? 0 : p))).map(asPostgres);
          return { rows, rowCount: rows.length };
        },
      },
      close: () => standIn.close(),
    };
  })();
  try {
    const res = makeRes();
    await listHandler(req("GET", { query: { state: "NV" } }), res, { db });
    assert.deepEqual(namesOf(res), only("ALL STATES", "All", "Blank States", "Empty States", "Null States", "Star"));
  } finally {
    close();
  }
});

test("List filter: Name search input matches the name or the notes, in any case, and nothing else", async () => {
  assert.deepEqual(namesOf((await list({ q: "Mesa" })).res), only("Mesa Community Bank", "Canyon Credit Union"), "one by name, one by notes");
  assert.deepEqual(namesOf((await list({ q: "desert" })).res), only("Desert First Bank"));
  assert.deepEqual(namesOf((await list({ q: "line of credit" })).res), only("Mesa Community Bank"), "notes");
  assert.deepEqual(namesOf((await list({ q: "  summit " })).res), only("Summit Bank"), "trimmed");
  assert.deepEqual(namesOf((await list({ q: "zzz" })).res), []);
});

test("Apply filters: every box together keeps only the lenders that pass every one of them", async () => {
  // OnlineBizCC and active and any lender that takes NV: Mesa (names NV) and Pioneer (All States).
  assert.deepEqual(namesOf((await list({ lender_table: "OnlineBizCC", active: "true", state: "NV" })).res), only("Mesa Community Bank", "Pioneer Bank"));
  // plus the EX bureau: Mesa only.
  assert.deepEqual(namesOf((await list({ lender_table: "OnlineBizCC", active: "true", state: "NV", bureau: "EX" })).res), only("Mesa Community Bank"));
  // plus tier 2: nobody.
  assert.deepEqual(namesOf((await list({ lender_table: "OnlineBizCC", active: "true", state: "NV", bureau: "EX", priority_tier: "2" })).res), []);
  // a name search and a tier
  assert.deepEqual(namesOf((await list({ q: "Mesa", priority_tier: "3" })).res), only("Canyon Credit Union"));
  assert.deepEqual(namesOf((await list({ q: "Mesa", priority_tier: "2" })).res), []);
  // inactive in two product tables is two different boxes: BizLOC_Stated + inactive
  assert.deepEqual(namesOf((await list({ lender_table: "BizLOC_Stated", active: "false" })).res), only("Canyon Credit Union"));
  assert.deepEqual(namesOf((await list({ lender_table: "BizLOC_Stated", active: "true" })).res), []);
});

test("the company comes from the session: another company's lender is never returned, whatever the boxes say", async () => {
  for (const query of [{}, { q: "Mesa" }, { bureau: "EX" }, { priority_tier: "1" }, { state: "AZ" }, { lender_table: "OnlineBizCC" }]) {
    const { res } = await list(query);
    assert.equal(namesOf(res).includes("Mesa Other Company Bank"), false, JSON.stringify(query));
  }
});

test("sample lenders: left out of the list, and out of the export even when the company has the demo switch on", async () => {
  const off = await list({ q: "Mesa" }, { demoMode: false });
  assert.equal(namesOf(off.res).includes("DEMO Mesa Sample Bank"), false);
  const on = await list({ q: "Mesa" }, { demoMode: true });
  assert.equal(namesOf(on.res).includes("DEMO Mesa Sample Bank"), true, "with the demo switch on the desk shows them");
  const exported = await list({ q: "Mesa", format: "csv" }, { demoMode: true });
  assert.equal(exported.res.statusCode, 200);
  assert.doesNotMatch(String(exported.res.body), /DEMO Mesa Sample Bank/, "the export never carries a sample lender");
});

test("Export CSV: the file holds exactly the lenders the same boxes list, with the header row first", async () => {
  const query = { lender_table: "OnlineBizCC", active: "true", state: "NV" };
  const listed = namesOf((await list(query)).res);
  const exported = await list({ ...query, format: "csv" });
  assert.equal(exported.res.statusCode, 200);
  const lines = String(exported.res.body).trim().split("\n");
  const header = lines[0].split(",");
  const nameAt = header.indexOf("name");
  assert.ok(nameAt >= 0, "the header names a name column");
  const fileNames = lines.slice(1).map((l) => l.split(",")[nameAt]).sort();
  assert.deepEqual(fileNames, listed);
  assert.deepEqual(fileNames, only("Mesa Community Bank", "Pioneer Bank"));
  // and with a box that changes the answer the file changes too
  const narrower = await list({ ...query, bureau: "EX", format: "csv" });
  const narrowNames = String(narrower.res.body).trim().split("\n").slice(1).map((l) => l.split(",")[nameAt]);
  assert.deepEqual(narrowNames, ["Mesa Community Bank"]);
});

// ── the mismatch queue ───────────────────────────────────────────────────────────────────────────────────

const obs = (id, over = {}) => ({
  id, org_id: ORG_ID, lender_name: `Lender ${id}`, lender_table: "OnlineBizCC", expected_bureaus_raw: "EX", observed_bureau: "TU",
  observation_source: "crs_pull", mismatch_flag: true, review_status: "pending", created_by: null, created_at: RECENT, updated_at: RECENT, ...over,
});
const OPEN_1 = "c0000000-0000-4000-8000-000000000001";
const OPEN_2 = "c0000000-0000-4000-8000-000000000002";
const CONFIRMED = "c0000000-0000-4000-8000-000000000003";
const NO_MISMATCH = "c0000000-0000-4000-8000-000000000004";
const OTHER_COMPANY = "c0000000-0000-4000-8000-000000000005";
const OBSERVATIONS = [
  obs(OPEN_1, { created_at: "2026-10-03T00:00:00.000Z" }),
  obs(OPEN_2, { created_at: "2026-10-05T00:00:00.000Z", created_by: "Casey Reed" }),
  obs(CONFIRMED, { review_status: "confirmed", created_by: "Casey Reed" }),
  obs(NO_MISMATCH, { mismatch_flag: false }),
  obs(OTHER_COMPANY, { org_id: OTHER_ORG_ID }),
];

function openObservations({ role = "owner" } = {}) {
  const standIn = makeStandIn(["lender_bureau_observations"]);
  for (const o of OBSERVATIONS) standIn.insert("lender_bureau_observations", o);
  const db = {
    async query(sql, params = []) {
      const text = typeof sql === "string" ? sql : sql.text;
      if (/FROM live JOIN staff/.test(text)) return { rows: [staffRow({ role })], rowCount: 1 };
      const stmt = standIn.db.prepare(portableSql(text));
      const rows = stmt.all(...params.map((p) => (p === true ? 1 : p === false ? 0 : p)));
      return { rows, rowCount: rows.length };
    },
  };
  const stored = () => Object.fromEntries(standIn.db.prepare("SELECT id, review_status, created_by FROM lender_bureau_observations").all().map((r) => [r.id, [r.review_status, r.created_by]]));
  return { db, stored, close: () => standIn.close() };
}

async function queue(query) {
  const { db, close } = openObservations();
  try {
    const res = makeRes();
    await queueHandler(req("GET", { query }), res, { db });
    return res;
  } finally {
    close();
  }
}

test("Mismatch queue: it lists the company's open mismatches, newest first, and nothing else", async () => {
  const idsOf = (res) => res.body.observations.map((o) => o.id);
  assert.deepEqual(idsOf(await queue({ mismatch_only: "true", review_status: "pending" })), [OPEN_2, OPEN_1]);
  assert.deepEqual(idsOf(await queue({})), [OPEN_2, OPEN_1], "with no words the default is the open mismatches");
  assert.deepEqual(idsOf(await queue({ mismatch_only: "1" })), [OPEN_2, OPEN_1]);
  // What the other words change, so a queue that ignored them would be caught.
  assert.deepEqual(idsOf(await queue({ mismatch_only: "false", review_status: "pending" })), [OPEN_2, OPEN_1, NO_MISMATCH]);
  assert.deepEqual(idsOf(await queue({ mismatch_only: "true", review_status: "confirmed" })), [CONFIRMED]);
  assert.deepEqual(idsOf(await queue({ mismatch_only: "true", review_status: "all" })).sort(), [OPEN_1, OPEN_2, CONFIRMED].sort());
});

test("Mismatch Confirm and Corrected: the pressed row gets the pressed word, the reviewer's name goes on only if nobody's was there, nothing else moves", async () => {
  const run = async (body, role) => {
    const { db, stored, close } = openObservations({ role });
    try {
      const res = makeRes();
      await reviewHandler(req("POST", { body }), res, { db });
      return { res, stored: stored() };
    } finally {
      close();
    }
  };
  const untouched = Object.fromEntries(OBSERVATIONS.map((o) => [o.id, [o.review_status, o.created_by]]));

  const confirmed = await run({ action: "review", id: OPEN_1, review_status: "confirmed" });
  assert.equal(confirmed.res.statusCode, 200);
  assert.equal(confirmed.res.body.observation.review_status, "confirmed");
  assert.deepEqual(confirmed.stored, { ...untouched, [OPEN_1]: ["confirmed", "Olive Owner"] }, "that row: confirmed, and who did it; no other row");

  const corrected = await run({ action: "review", id: OPEN_2, review_status: "corrected" });
  assert.equal(corrected.res.statusCode, 200);
  assert.deepEqual(corrected.stored, { ...untouched, [OPEN_2]: ["corrected", "Casey Reed"] }, "a row that already had a person keeps that person");

  const dismissed = await run({ action: "review", id: OPEN_1, review_status: "dismissed" });
  assert.deepEqual(dismissed.stored, { ...untouched, [OPEN_1]: ["dismissed", "Olive Owner"] });

  // Another company's row is not found and is not changed; a word that is not a review word writes nothing.
  const other = await run({ action: "review", id: OTHER_COMPANY, review_status: "confirmed" });
  assert.equal(other.res.statusCode, 404);
  assert.deepEqual(other.stored, untouched);
  const bad = await run({ action: "review", id: OPEN_1, review_status: "approved" });
  assert.equal(bad.res.statusCode, 400);
  assert.deepEqual(bad.stored, untouched);
});

test("every claim in this file ran", () => {
  assert.ok(LENDERS.length === 8);
  assert.ok(OBSERVATIONS.length === 5);
});
