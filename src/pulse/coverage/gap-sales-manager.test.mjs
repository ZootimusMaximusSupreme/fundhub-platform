import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS as SALES_JOBS } from "./slice-20-sales.mjs";
import { SALES_MANAGER_DASHBOARD_DOOR_IDS } from "./slice-30-csm-owner.mjs";
import { monthWindow } from "../../sales/metrics.mjs";
import {
  CHECK_IDS,
  MY_NUMBERS_PATH,
  SALES_FLOOR_PATH,
  SELLERS_SQL,
  TOTALS_SQL,
  closersMissingFromRollup,
  gapChecks,
  salesManagerRoutesWired
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

const ALIVE = {
  "netlify/functions/api.mjs": [
    'import readSalesFloor from "../../api/read/sales-floor.mjs";',
    'import readMyNumbers from "../../api/read/my-numbers.mjs";',
    '"read/sales-floor": readSalesFloor,',
    '"read/my-numbers": readMyNumbers,'
  ].join("\n"),
  "api/read/sales-floor.mjs":
    'if (req.method && req.method !== "GET") {}\nexport default async function handler() { salesFloor(database, { orgId }); }',
  "api/read/my-numbers.mjs":
    'if (req.method && req.method !== "GET") {}\nexport default async function handler() { closerMyNumbers(database, { orgId, staffId }); }'
};

function aliveRead(rel) {
  if (!Object.prototype.hasOwnProperty.call(ALIVE, rel)) throw new Error(`unexpected read: ${rel}`);
  return ALIVE[rel];
}

function deadFloorRead(rel) {
  if (rel.endsWith("api.mjs")) return 'import readMyNumbers from "../../api/read/my-numbers.mjs";\n"read/my-numbers": readMyNumbers,';
  return aliveRead(rel);
}

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

function fakeDb({
  totals = { booked: 4, held: 2, deposits: 1, cash_cents: 25000 },
  sellers = [],
  roster = [],
  totalsThrows = false,
  sellersThrows = false,
  rosterThrows = false
} = {}) {
  return {
    async query(sql, params) {
      if (sql === TOTALS_SQL || /gap:sales-manager-totals/.test(sql)) {
        if (totalsThrows) throw new Error("events read failed");
        assert.equal(params[0], ORG);
        assert.equal(params[1], PERIOD.start.toISOString());
        assert.equal(params[2], PERIOD.end.toISOString());
        return { rows: [totals] };
      }
      if (sql === SELLERS_SQL || /gap:sales-manager-sellers/.test(sql)) {
        if (sellersThrows) throw new Error("seller read failed");
        assert.equal(params[0], ORG);
        assert.equal(params[1], PERIOD.start.toISOString());
        assert.equal(params[2], PERIOD.end.toISOString());
        return { rows: sellers };
      }
      if (/demo_mode_enabled/.test(sql)) {
        assert.equal(params[0], ORG);
        return { rows: [{ demo_mode_enabled: false }] };
      }
      if (/FROM staff s/.test(sql)) {
        if (rosterThrows) throw new Error("roster read failed");
        return { rows: roster };
      }
      if (/funding_closeout/.test(sql)) return { rows: [{ deposits: 0, funded: 0 }] };
      throw new Error(`unexpected sql: ${sql.slice(0, 140)}`);
    }
  };
}

function fetchStatus(status, calls) {
  return async function fetchImpl(url, opts) {
    calls.push({ url, method: opts && opts.method });
    if (status === "throw") throw new Error("socket hang up");
    return { status };
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
  for (const sql of [TOTALS_SQL, SELLERS_SQL]) {
    assert.match(sql, /SELECT/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP)\b/i);
  }
  assert.equal(SALES_FLOOR_PATH, "/api/read/sales-floor");
  assert.equal(MY_NUMBERS_PATH, "/api/read/my-numbers");
});

test("gap sales manager: no database and no fetch skips the three reads", async () => {
  const rows = await gapChecks({ now: NOW, readText: aliveRead });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
  assert.match(rows[0].detail, /not called this run/);
  assert.match(rows[1].detail, /manager totals not read/);
  assert.match(rows[2].detail, /manager rollup not read/);
});

test("gap sales manager: a quiet floor is three PASS rows", async () => {
  const calls = [];
  const rows = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    now: NOW,
    fetchImpl: fetchStatus(401, calls),
    baseUrl: "https://fundhub.ai/",
    readText: aliveRead
  });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.deepEqual(calls.map((c) => c.method), ["GET", "GET"]);
  assert.deepEqual(calls.map((c) => c.url), [
    `https://fundhub.ai${SALES_FLOOR_PATH}`,
    `https://fundhub.ai${MY_NUMBERS_PATH}`
  ]);
});

test("gap sales manager: a 500 on sales floor or my numbers is FAIL", async () => {
  const cases = [
    { statusFor: SALES_FLOOR_PATH, detail: /sales floor read API answered 500/ },
    { statusFor: MY_NUMBERS_PATH, detail: /my numbers read API answered 500/ }
  ];
  for (const c of cases) {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, method: opts && opts.method });
      return { status: url.endsWith(c.statusFor) ? 500 : 401 };
    };
    const rows = await gapChecks({
      db: fakeDb({ roster: [rosterRow(RILEY)], sellers: [RILEY] }),
      orgId: ORG,
      now: NOW,
      fetchImpl,
      readText: aliveRead
    });
    rows.forEach(shape);
    const hit = rows.find((r) => r.id === "sales-manager:read-api");
    assert.equal(hit.status, "FAIL");
    assert.match(hit.detail, c.detail);
    assert.ok(rows.filter((r) => r.id !== "sales-manager:read-api").every((r) => r.status === "PASS"));
    assert.ok(calls.every((call) => call.method === "GET"));
  }
});

test("gap sales manager: manager totals that cannot be read are FAIL", async () => {
  const thrown = await gapChecks({
    db: fakeDb({ totalsThrows: true }),
    orgId: ORG,
    now: NOW,
    fetchImpl: fetchStatus(200, []),
    readText: aliveRead
  });
  thrown.forEach(shape);
  const bad = thrown.find((r) => r.id === "sales-manager:totals");
  assert.equal(bad.status, "FAIL");
  assert.match(bad.detail, /manager totals cannot be read/);
  assert.match(bad.detail, /events read failed/);
  assert.ok(thrown.filter((r) => r.id !== "sales-manager:totals").every((r) => r.status === "PASS"));

  const blank = await gapChecks({
    db: fakeDb({ totals: { booked: null, held: 2, deposits: 1, cash_cents: 10 } }),
    orgId: ORG,
    now: NOW,
    fetchImpl: fetchStatus(403, []),
    readText: aliveRead
  });
  blank.forEach(shape);
  const missing = blank.find((r) => r.id === "sales-manager:totals");
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /was not a number/);
});

test("gap sales manager: a closer with sales the rollup drops is FAIL", async () => {
  const rows = await gapChecks({
    db: fakeDb({ sellers: [JORDAN, RILEY], roster: [rosterRow(JORDAN)] }),
    orgId: ORG,
    now: NOW,
    fetchImpl: fetchStatus(401, []),
    readText: aliveRead
  });
  rows.forEach(shape);
  const hit = rows.find((r) => r.id === "sales-manager:dropped-closer");
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
    now: NOW,
    fetchImpl: fetchStatus(401, []),
    readText: aliveRead
  });
  rows.forEach(shape);
  const hit = rows.find((r) => r.id === "sales-manager:dropped-closer");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /2 closers have sales and the manager rollup drops them/);
  assert.match(hit.detail, /Riley Chen/);
  assert.match(hit.detail, /Sam Lee/);
});

test("gap sales manager: a closer the rollup keeps is PASS", async () => {
  const rows = await gapChecks({
    db: fakeDb({ sellers: [RILEY], roster: [rosterRow(RILEY)] }),
    orgId: ORG,
    now: NOW,
    fetchImpl: fetchStatus(200, []),
    readText: aliveRead
  });
  rows.forEach(shape);
  assert.equal(rows.find((r) => r.id === "sales-manager:dropped-closer").status, "PASS");
});

test("gap sales manager: a missing sales floor route is FAIL without a database", async () => {
  const rows = await gapChecks({ readText: deadFloorRead, now: NOW });
  rows.forEach(shape);
  const api = rows.find((r) => r.id === "sales-manager:read-api");
  assert.equal(api.status, "FAIL");
  assert.match(api.detail, /sales floor read is not wired/);
  assert.equal(salesManagerRoutesWired(deadFloorRead).floor, false);
  assert.equal(salesManagerRoutesWired(deadFloorRead).mine, true);
  assert.equal(salesManagerRoutesWired(aliveRead).floor, true);
  assert.equal(salesManagerRoutesWired(aliveRead).mine, true);
  assert.deepEqual(
    rows.filter((r) => r.id !== "sales-manager:read-api").map((r) => r.status),
    ["skip", "skip"]
  );
});

test("gap sales manager: a read error is FAIL, not a throw", async () => {
  const rows = await gapChecks({
    db: fakeDb({ totalsThrows: true, sellersThrows: true, rosterThrows: true }),
    orgId: ORG,
    now: NOW,
    fetchImpl: fetchStatus("throw", []),
    readText: aliveRead
  });
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "FAIL"));
  assert.match(rows[0].detail, /unreachable/);
  assert.match(rows[1].detail, /events read failed/);
  assert.match(rows[2].detail, /manager rollup cannot be read/);
});

test("gap sales manager: the live sales floor and my numbers routes are wired", () => {
  const wired = salesManagerRoutesWired();
  assert.equal(wired.floor, true);
  assert.equal(wired.mine, true);
});
