import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ROUTES } from "../../../netlify/functions/api.mjs";
import { PULSE_REGISTRY, coverageKey } from "../registry.mjs";
import { CHECKS as SALES_JOBS } from "./slice-20-sales.mjs";
import { SALES_MANAGER_DASHBOARD_DOOR_IDS } from "./slice-30-csm-owner.mjs";
import { closerMyNumbers, closerRoster, monthWindow, salesFloor } from "../../sales/metrics.mjs";
import { orgDemoModeEnabled } from "../../demo/exclude-demo.mjs";
import {
  CHECK_IDS,
  MY_NUMBERS_PATH,
  NUMBERS_STAFF_SQL,
  SALES_FLOOR_PATH,
  SELLERS_SQL,
  closersMissingFromRollup,
  floorShapeProblem,
  gapChecks,
  isPlainRead,
  mineShapeProblem,
  readOnlyDb,
  totalsProblems
} from "./gap-sales-manager.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-sales-manager.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T18:00:00Z");
const PERIOD = monthWindow(NOW);

const RILEY = {
  staff_id: "22222222-2222-4222-8222-222222222222",
  name: "Riley Chen",
  email: "riley@fundhub.ai",
  role: "closer",
  status: "active",
  is_demo: false,
  deposits: 2,
  cash_cents: 50000
};

const SAM = {
  staff_id: "44444444-4444-4444-8444-444444444444",
  name: "Sam Lee",
  email: "sam@fundhub.ai",
  role: "closer",
  status: "active",
  is_demo: false,
  deposits: 1,
  cash_cents: 10000
};

const JORDAN = {
  staff_id: "33333333-3333-4333-8333-333333333333",
  name: "Jordan Blake",
  email: "jordan@fundhub.ai",
  role: "closer",
  status: "active",
  is_demo: false,
  deposits: 9,
  cash_cents: 90000
};

function rosterRow(person) {
  return {
    staff_id: person.staff_id,
    name: person.name,
    email: person.email,
    role: person.role,
    is_demo: person.is_demo,
    shift_started: null,
    cash_cents: person.cash_cents,
    held: 4,
    deposits: person.deposits
  };
}

/**
 * A database that answers by what the SQL says. The real salesFloor, closerMyNumbers
 * and closerRoster run against it. Anything it has no row for gets an empty answer,
 * the way a quiet month looks. `breakOn` makes any SQL that contains that text throw.
 * Every statement is recorded, and a statement that is not a SELECT fails the test.
 */
function fakeDb({
  sellers = [],
  roster = [],
  cash = "12500",
  funnel = { n: 4, held: 3, deposits: 1, downsells: 0, downsell_cents: 0 },
  breakOn = null,
  numbersStaff = RILEY.staff_id
} = {}) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      const text = String(sql);
      seen.push({ sql: text, params });
      assert.match(text.trim(), /^(\/\*[\s\S]*?\*\/\s*)?(SELECT|WITH)\b/i, `not a read: ${text.slice(0, 80)}`);
      if (breakOn && text.includes(breakOn)) throw new Error(`injected break at ${breakOn}`);
      if (text.includes("gap:sales-manager-sellers")) {
        assert.equal(params[0], ORG);
        assert.equal(params[1], PERIOD.start.toISOString());
        assert.equal(params[2], PERIOD.end.toISOString());
        return { rows: sellers };
      }
      if (text.includes("gap:sales-manager-numbers-staff")) {
        assert.equal(params[0], ORG);
        return { rows: numbersStaff ? [{ staff_id: numbersStaff }] : [] };
      }
      if (/demo_mode_enabled/.test(text)) return { rows: [{ demo_mode_enabled: false }] };
      if (/FROM staff s/.test(text) && /LEFT JOIN LATERAL/.test(text)) return { rows: roster };
      if (/AS no_shows/.test(text)) return { rows: [{ cents: "0", deposits: 0, downsells: 0, no_shows: 0, held: 0, logged: 0 }] };
      if (/AS cents\s+FROM call_outcomes/.test(text)) return { rows: [{ cents: cash }] };
      if (/count\(DISTINCT client_id\)::int AS n\s+FROM events/.test(text)) return { rows: [{ n: funnel.n }] };
      if (/AS held,\s+count\(\*\) FILTER \(WHERE outcome = 'deposit'\)/.test(text)) return { rows: [funnel] };
      if (/AS funded/.test(text)) return { rows: [{ deposits: 1, funded: 1 }] };
      return { rows: [], rowCount: 0 };
    }
  };
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not add another watcher/);
    assert.match(row.suggestedFix, /Do not open the closer desk/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
    assert.doesNotMatch(row.suggestedFix, /recording/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

const byId = (rows, id) => rows.find((r) => r.id === id);

test("gap sales manager: source stays read-only and does not repeat slice 20", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /from ["'][^"']*slice-/);
  assert.doesNotMatch(SRC, /PULSE_REGISTRY|listUnrecordedCalls|listRecentRecordings|log_disposition/);
  assert.doesNotMatch(SRC, /\.html/);
  assert.match(SRC, /No second watchdog/);
  assert.match(SRC, /slice-20-sales/);
  assert.deepEqual([...CHECK_IDS], [
    "sales-manager:read-api",
    "sales-manager:totals",
    "sales-manager:dropped-closer"
  ]);
  for (const id of CHECK_IDS) {
    assert.equal(SALES_JOBS.some((job) => job.id === id), false);
    assert.equal(SALES_MANAGER_DASHBOARD_DOOR_IDS.includes(id), false);
  }
  assert.equal(SALES_JOBS.some((job) => job.id === "s-00-welcome"), true);
  for (const sql of [SELLERS_SQL, NUMBERS_STAFF_SQL]) {
    assert.match(sql, /SELECT/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP)\b/i);
  }
  assert.equal(SALES_FLOOR_PATH, "/api/read/sales-floor");
  assert.equal(MY_NUMBERS_PATH, "/api/read/my-numbers");
});

test("gap sales manager: the signed-out ping of both read doors stays the registry's job", () => {
  // This lane no longer sends that ping. These four rows are why that is safe.
  const keys = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
  for (const key of ["read/sales-floor", "read/my-numbers", "sales-floor.html", "my-numbers.html"]) {
    assert.equal(keys.has(key), true, key);
  }
});

test("gap sales manager: the live sales floor and my numbers routes are wired", () => {
  assert.equal(typeof ROUTES["read/sales-floor"], "function");
  assert.equal(typeof ROUTES["read/my-numbers"], "function");
});

test("gap sales manager: no database skips the three reads", async () => {
  const rows = await gapChecks({ now: NOW });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
  assert.match(rows[0].detail, /not run/);
  assert.match(rows[1].detail, /manager totals not read/);
  assert.match(rows[2].detail, /manager rollup not read/);

  const noOrg = await gapChecks({ db: fakeDb(), now: NOW });
  assert.deepEqual(noOrg.map((r) => r.status), ["skip", "skip", "skip"]);
});

test("gap sales manager: read-only db runs plain reads and drops everything else", async () => {
  const ran = [];
  const ro = readOnlyDb({ async query(sql, params) { ran.push({ sql, params }); return { rows: [{ ok: 1 }], rowCount: 1 }; } });
  const got = await ro.query("SELECT 1 AS ok", [7]);
  assert.deepEqual(got.rows, [{ ok: 1 }]);
  assert.deepEqual(ran, [{ sql: "SELECT 1 AS ok", params: [7] }]);
  for (const stmt of [
    "UPDATE brain_files SET client_id = $1 WHERE id = $2",
    "  insert into tasks (id) values (1)",
    "DELETE FROM call_outcomes",
    "BEGIN",
    "SET LOCAL statement_timeout = 1",
    "/* x */ SELECT 1"
  ]) {
    const r = await ro.query(stmt, []);
    if (/^\/\*/.test(stmt)) assert.deepEqual(r.rows, [{ ok: 1 }]);
    else assert.deepEqual(r, { rows: [], rowCount: 0 });
  }
  assert.equal(ran.length, 2);
  assert.equal(ro.held.length, 5);
  assert.match(ro.held[0], /^UPDATE brain_files/);
});

test("gap sales manager: a write behind a note, a WITH, a second statement, or a state-changing function is held back", async () => {
  // These all reached the real database under the old first-word guard.
  const writes = [
    "/* tag */ UPDATE brain_files SET x = 1",
    "-- tag\nDELETE FROM t",
    "WITH a AS (SELECT 1) UPDATE brain_files SET x = 1",
    "WITH a AS (DELETE FROM t RETURNING *) SELECT * FROM a",
    "WITH a AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM a",
    "SELECT 1; DELETE FROM t",
    "SELECT 1 /* a */ ; /* b */ INSERT INTO t VALUES (1)",
    // A second statement that none of the write words name.
    "SELECT 1; DROP TABLE t",
    "SELECT 1 -- note\n; ALTER TABLE t ADD COLUMN c int",
    "SELECT 1; GRANT ALL ON t TO someone",
    "SELECT 1; VACUUM t",
    "SELECT 1; CALL do_it()",
    "SELECT pg_advisory_xact_lock(1)",
    "SELECT set_config('app.x', '1', false)",
    "SELECT nextval('some_seq')",
    "SELECT * INTO scratch FROM t",
    "SELECT * FROM t FOR UPDATE",
    "SELECT * FROM t FOR SHARE",
    "SELECT $$ x $$",
    "/* never closed SELECT 1",
    "",
    null,
    undefined,
    { text: "/* t */ UPDATE brain_files SET x = 1" }
  ];
  const ran = [];
  const ro = readOnlyDb({ async query(sql) { ran.push(sql); return { rows: [{ ok: 1 }], rowCount: 1 }; } });
  for (const stmt of writes) {
    assert.equal(isPlainRead(typeof stmt === "object" && stmt ? stmt.text : stmt), false, JSON.stringify(stmt));
    assert.deepEqual(await ro.query(stmt, []), { rows: [], rowCount: 0 }, JSON.stringify(stmt));
  }
  assert.deepEqual(ran, []);
  assert.equal(ro.held.length, writes.length);
});

test("gap sales manager: plain reads, with notes and quoted words, are not held back", async () => {
  const reads = [
    "SELECT 1",
    "/* gap:x */ SELECT 1",
    "-- tag\nSELECT 1",
    "  WITH a AS (SELECT 1) SELECT * FROM a",
    "(SELECT 1) UNION (SELECT 2)",
    "VALUES (1)",
    "SELECT 'update me' AS note",
    "SELECT 'it''s; DELETE' AS s",
    "SELECT updated_at, deleted_at, last_update FROM t",
    "SELECT x FROM t WHERE y = $1 -- trailing note",
    "/* UPDATE */ SELECT 1",
    "SELECT 1;",
    SELLERS_SQL,
    NUMBERS_STAFF_SQL
  ];
  const ran = [];
  const ro = readOnlyDb({ async query(sql) { ran.push(sql); return { rows: [], rowCount: 0 }; } });
  for (const stmt of reads) {
    assert.equal(isPlainRead(stmt), true, stmt);
    await ro.query(stmt, []);
  }
  assert.equal(ran.length, reads.length);
  assert.deepEqual(ro.held, []);
});

test("gap sales manager: the real floor, my numbers, roster and demo reads are all plain reads, so the guard never empties a real answer", async () => {
  const ro = readOnlyDb(fakeDb({ sellers: [RILEY], roster: [rosterRow(RILEY)] }));
  await salesFloor(ro, { orgId: ORG, now: NOW, env: {} });
  await closerMyNumbers(ro, { orgId: ORG, staffId: RILEY.staff_id, now: NOW });
  await closerRoster(ro, { orgId: ORG, start: PERIOD.start, end: PERIOD.end, now: NOW });
  await orgDemoModeEnabled(ro, ORG);
  assert.deepEqual(ro.held, []);
});

test("gap sales manager: a quiet floor is three PASS rows, and nothing but reads reaches the database", async () => {
  const db = fakeDb({ sellers: [RILEY], roster: [rosterRow(RILEY)] });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
  assert.match(rows[1].detail, /4 booked, 3 held, 1 deposits this month/);
  // The real floor and the real my numbers ran (not a copy of their SQL).
  const sql = db.seen.map((s) => s.sql).join("\n");
  assert.match(sql, /FROM brain_drive_sync/);
  assert.match(sql, /FROM staff_targets/);
  assert.match(sql, /gap:sales-manager-numbers-staff/);
  // The my numbers read was done for the person the staff read chose.
  const mine = db.seen.find((s) => /AS no_shows/.test(s.sql));
  assert.equal(mine.params[1], RILEY.staff_id);
});

test("gap sales manager: the floor and my numbers get a read-only database, so a write they try is held back", async () => {
  const good = { hero: { cash_cents: 1 }, funnel: { booked: 0, held: 0, deposits: 0 }, closers: [] };
  const tried = [];
  const db = fakeDb();
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    reads: {
      salesFloor: async (handed) => {
        tried.push(await handed.query("UPDATE brain_files SET client_id = $1 WHERE id = $2", ["a", "b"]));
        tried.push(await handed.query("/* TRIED-WRITE */ UPDATE brain_files SET client_id = 1", []));
        return good;
      },
      closerMyNumbers: async (handed) => {
        tried.push(await handed.query("INSERT INTO tasks (id) VALUES (1)", []));
        tried.push(await handed.query("WITH x AS (SELECT 1) UPDATE brain_files SET client_id = 1 /* TRIED-WRITE */", []));
        return { pace: {}, month: {}, team: [] };
      }
    }
  });
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
  assert.equal(tried.length, 4);
  assert.ok(tried.every((t) => t.rows.length === 0 && t.rowCount === 0));
  // fakeDb fails the test on any statement that is not a read; none got through,
  // and neither did the two that hid a write behind a note or a WITH.
  assert.ok(db.seen.every((s) => /^(\/\*[\s\S]*?\*\/\s*)?(SELECT|WITH)\b/i.test(s.sql.trim())));
  assert.ok(db.seen.every((s) => !/TRIED-WRITE|brain_files SET/.test(s.sql)));
});

test("gap sales manager: the sales floor read failing is FAIL on the read row and the totals row", async () => {
  const db = fakeDb({ breakOn: "FROM brain_drive_sync", roster: [rosterRow(RILEY)], sellers: [RILEY] });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  rows.forEach(shape);
  const api = byId(rows, "sales-manager:read-api");
  assert.equal(api.status, "FAIL");
  assert.match(api.detail, /would answer 500/);
  assert.match(api.detail, /the sales floor read failed \(injected break at FROM brain_drive_sync\)/);
  assert.doesNotMatch(api.detail, /my numbers read failed/);
  const totals = byId(rows, "sales-manager:totals");
  assert.equal(totals.status, "FAIL");
  assert.match(totals.detail, /manager totals cannot be read: injected break/);
  assert.equal(byId(rows, "sales-manager:dropped-closer").status, "PASS");
});

test("gap sales manager: the my numbers read failing is FAIL on the read row only", async () => {
  const db = fakeDb({ breakOn: "staff_id IS NULL AND role = 'closer'", roster: [rosterRow(RILEY)], sellers: [RILEY] });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  rows.forEach(shape);
  const api = byId(rows, "sales-manager:read-api");
  assert.equal(api.status, "FAIL");
  assert.match(api.detail, /the my numbers read failed \(injected break/);
  assert.doesNotMatch(api.detail, /sales floor read/);
  assert.equal(byId(rows, "sales-manager:totals").status, "PASS");
});

test("gap sales manager: both reads failing names both, and no staff row to read is not a failure", async () => {
  const both = await gapChecks({ db: fakeDb({ breakOn: "FROM staff s", sellers: [] }), orgId: ORG, now: NOW });
  both.forEach(shape);
  const api = byId(both, "sales-manager:read-api");
  assert.equal(api.status, "FAIL");
  assert.match(api.detail, /sales floor read failed/);
  assert.match(api.detail, /could not pick a closer to read/);

  const none = await gapChecks({ db: fakeDb({ numbersStaff: null }), orgId: ORG, now: NOW });
  none.forEach(shape);
  assert.equal(byId(none, "sales-manager:read-api").status, "PASS");
  assert.match(byId(none, "sales-manager:read-api").detail, /no staff row to read my numbers for/);
});

test("gap sales manager: an answer the page cannot paint is FAIL", async () => {
  const good = {
    hero: { cash_cents: 100, deposit_to_funded: 0.5 },
    funnel: { booked: 2, held: 2, deposits: 1, show_rate: 1, close_rate: 0.5 },
    closers: []
  };
  const goodMine = { pace: {}, month: {}, team: [] };
  const stub = (floor, mine = goodMine) => ({
    salesFloor: async () => floor,
    closerMyNumbers: async () => mine
  });
  const run = (reads) => gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, reads });

  const ok = await run(stub(good));
  assert.deepEqual(ok.map((r) => r.status), ["PASS", "PASS", "PASS"]);

  for (const [floor, say] of [
    [null, /the sales floor read came back empty/],
    [{ ...good, hero: null }, /no team numbers/],
    [{ ...good, funnel: null }, /no funnel numbers/],
    [{ ...good, closers: null }, /no closer list/]
  ]) {
    const rows = await run(stub(floor));
    rows.forEach(shape);
    assert.equal(byId(rows, "sales-manager:read-api").status, "FAIL");
    assert.match(byId(rows, "sales-manager:read-api").detail, say);
  }
  for (const [mine, say] of [
    [null, /the my numbers read came back empty/],
    [{ ...goodMine, pace: null }, /no pace numbers/],
    [{ ...goodMine, month: null }, /no month numbers/],
    [{ ...goodMine, team: null }, /no team list/]
  ]) {
    const rows = await run(stub(good, mine));
    assert.equal(byId(rows, "sales-manager:read-api").status, "FAIL");
    assert.match(byId(rows, "sales-manager:read-api").detail, say);
    assert.equal(byId(rows, "sales-manager:totals").status, "PASS");
  }
});

test("gap sales manager: an answer that cannot be printed as JSON is FAIL", async () => {
  const rows = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    now: NOW,
    reads: {
      salesFloor: async () => ({ hero: { cash_cents: 10n }, funnel: {}, closers: [] }),
      closerMyNumbers: async () => ({ pace: {}, month: {}, team: [] })
    }
  });
  rows.forEach(shape);
  assert.equal(byId(rows, "sales-manager:read-api").status, "FAIL");
  assert.match(byId(rows, "sales-manager:read-api").detail, /BigInt/);

  // The my numbers answer is printed as JSON too: a value that cannot be printed is its 500.
  const mine = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    now: NOW,
    reads: {
      salesFloor: async () => ({ hero: { cash_cents: 1 }, funnel: {}, closers: [] }),
      closerMyNumbers: async () => ({ pace: {}, month: { cash_cents: 10n }, team: [] })
    }
  });
  mine.forEach(shape);
  assert.equal(byId(mine, "sales-manager:read-api").status, "FAIL");
  assert.match(byId(mine, "sales-manager:read-api").detail, /the my numbers read failed \(.*BigInt/);
  assert.doesNotMatch(byId(mine, "sales-manager:read-api").detail, /sales floor read/);
});

test("gap sales manager: a read that never answers is FAIL, not a hang", async () => {
  const never = new Promise(() => {});
  const started = Date.now();
  const rows = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    now: NOW,
    timeoutMs: 25,
    reads: { salesFloor: () => never, closerMyNumbers: () => never }
  });
  rows.forEach(shape);
  assert.ok(Date.now() - started < 2000);
  assert.equal(byId(rows, "sales-manager:read-api").status, "FAIL");
  assert.match(byId(rows, "sales-manager:read-api").detail, /took longer than/);
  assert.equal(byId(rows, "sales-manager:totals").status, "FAIL");
});

test("gap sales manager: manager totals that cannot be read are FAIL", async () => {
  const floor = (hero, funnel) => ({ hero, funnel, closers: [] });
  const mine = { pace: {}, month: {}, team: [] };
  const run = (f) => gapChecks({ db: fakeDb(), orgId: ORG, now: NOW, reads: { salesFloor: async () => f, closerMyNumbers: async () => mine } });
  const okFunnel = { booked: 2, held: 2, deposits: 1, show_rate: null, close_rate: 0.5 };

  const quiet = await run(floor({ cash_cents: "0", deposit_to_funded: null }, { booked: 0, held: 0, deposits: 0, show_rate: null, close_rate: null }));
  assert.equal(byId(quiet, "sales-manager:totals").status, "PASS");

  const cases = [
    [{ cash_cents: null }, okFunnel, /team cash is not a number/],
    [{ cash_cents: "abc" }, okFunnel, /team cash is not a number/],
    [{ cash_cents: -5 }, okFunnel, /team cash is not a number/],
    [{ cash_cents: 10 }, { ...okFunnel, booked: undefined }, /booked calls is not a number/],
    [{ cash_cents: 10 }, { ...okFunnel, held: "x" }, /held calls is not a number/],
    [{ cash_cents: 10 }, { ...okFunnel, deposits: NaN }, /deposits is not a number/],
    [{ cash_cents: 10 }, { ...okFunnel, show_rate: 1.5 }, /show rate is not between 0 and 1/],
    [{ cash_cents: 10 }, { ...okFunnel, close_rate: -0.1 }, /close rate is not between 0 and 1/],
    [{ cash_cents: 10, deposit_to_funded: 2 }, okFunnel, /deposit to funded rate is not between 0 and 1/]
  ];
  for (const [hero, funnel, say] of cases) {
    const rows = await run(floor(hero, funnel));
    rows.forEach(shape);
    const totals = byId(rows, "sales-manager:totals");
    assert.equal(totals.status, "FAIL", JSON.stringify(hero));
    assert.match(totals.detail, say);
    assert.equal(byId(rows, "sales-manager:read-api").status, "PASS");
  }
  assert.deepEqual(totalsProblems({ hero: { cash_cents: 1 }, funnel: { booked: 1, held: 1, deposits: 0 } }), []);
  assert.deepEqual(totalsProblems(null), ["the team numbers block is missing"]);
  assert.equal(floorShapeProblem({ hero: {}, funnel: {}, closers: [] }), null);
  assert.equal(mineShapeProblem({ pace: {}, month: {}, team: [] }), null);
});

test("gap sales manager: a closer with sales the rollup drops is FAIL", async () => {
  const rows = await gapChecks({
    db: fakeDb({ sellers: [JORDAN, RILEY], roster: [rosterRow(JORDAN)] }),
    orgId: ORG,
    now: NOW
  });
  rows.forEach(shape);
  const hit = byId(rows, "sales-manager:dropped-closer");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /1 closer has sales and the manager rollup drops them \(Riley Chen\)/);
  assert.doesNotMatch(hit.detail, /Jordan Blake/);
  assert.ok(rows.filter((r) => r.id !== "sales-manager:dropped-closer").every((r) => r.status === "PASS"));
  assert.equal(closersMissingFromRollup([JORDAN], [], false).length, 0);
});

test("gap sales manager: two dropped closers use the plural", async () => {
  const rows = await gapChecks({
    db: fakeDb({ sellers: [RILEY, SAM], roster: [] }),
    orgId: ORG,
    now: NOW
  });
  rows.forEach(shape);
  const hit = byId(rows, "sales-manager:dropped-closer");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /2 closers have sales and the manager rollup drops them/);
  assert.match(hit.detail, /Riley Chen/);
  assert.match(hit.detail, /Sam Lee/);
});

test("gap sales manager: a closer the rollup keeps is PASS", async () => {
  const rows = await gapChecks({
    db: fakeDb({ sellers: [RILEY], roster: [rosterRow(RILEY)] }),
    orgId: ORG,
    now: NOW
  });
  rows.forEach(shape);
  assert.equal(byId(rows, "sales-manager:dropped-closer").status, "PASS");
});

test("gap sales manager: a suspended closer is off the floor on purpose, so it is not a miss", async () => {
  const gone = { ...SAM, status: "suspended" };
  assert.deepEqual(closersMissingFromRollup([gone], [], false), []);
  assert.deepEqual(closersMissingFromRollup([{ ...gone, status: "Suspended " }], [], false), []);
  // Active and missing is still a miss, and a missing status reads as active.
  assert.equal(closersMissingFromRollup([SAM], [], false).length, 1);
  assert.equal(closersMissingFromRollup([{ ...SAM, status: undefined }], [], false).length, 1);
  // A closer with no sales is not a miss either. Cash alone, or a deposit alone, is a sale.
  assert.deepEqual(closersMissingFromRollup([{ ...SAM, deposits: 0, cash_cents: 0 }], [], false), []);
  assert.equal(closersMissingFromRollup([{ ...SAM, deposits: 0, cash_cents: 5000 }], [], false).length, 1);
  assert.equal(closersMissingFromRollup([{ ...SAM, deposits: 1, cash_cents: 0 }], [], false).length, 1);
  // Practice and demo names stay off the board.
  assert.deepEqual(closersMissingFromRollup([{ ...SAM, name: "CRS Sandbox Smoke" }], [], false), []);
  assert.deepEqual(closersMissingFromRollup([{ ...SAM, is_demo: true }], [], false), []);
  assert.equal(closersMissingFromRollup([{ ...SAM, is_demo: true }], [], true).length, 1);

  const rows = await gapChecks({ db: fakeDb({ sellers: [gone], roster: [] }), orgId: ORG, now: NOW });
  assert.equal(byId(rows, "sales-manager:dropped-closer").status, "PASS");
});

test("gap sales manager: a read error is FAIL, not a throw", async () => {
  const rows = await gapChecks({
    db: fakeDb({ breakOn: "FROM" }),
    orgId: ORG,
    now: NOW
  });
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "FAIL"));
  assert.match(rows[0].detail, /sales floor read failed/);
  assert.match(rows[1].detail, /manager totals cannot be read/);
  assert.match(rows[2].detail, /manager rollup cannot be read/);
});
