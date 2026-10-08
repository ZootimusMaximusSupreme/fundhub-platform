import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  DRIVE_SYNC_CRON,
  DRIVE_SYNC_STALE_MS,
  SEARCH_READ_PATHS,
  gapChecks,
  searchReadStatusUp
} from "./gap-brain.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SRC = fs.readFileSync(path.join(HERE, "gap-brain.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T15:00:00.000Z");

function isoMinutesAgo(min) {
  return new Date(NOW.getTime() - min * 60 * 1000).toISOString();
}

function fakeDb({ errors = 0, errorText = "token rejected", syncRows = 1, lastSyncAt = isoMinutesAgo(5) } = {}) {
  return {
    async query(sql) {
      if (/gap:drive-last-error/.test(sql)) {
        return { rows: [{ n: errors, errors: errors ? errorText : null }] };
      }
      if (/gap:drive-sync-stale/.test(sql)) {
        return { rows: [{ n: syncRows, last_sync_at: syncRows ? lastSyncAt : null }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

function fakeFetch(statusFor) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const pathName = String(url).replace(/^https?:\/\/[^/]+/, "");
    const status = typeof statusFor === "function" ? statusFor(pathName) : statusFor;
    return { status };
  };
  return { fetchImpl, calls };
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
    assert.match(row.suggestedFix, /Do not run a new Drive sync/);
    assert.match(row.suggestedFix, /Do not upload/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

test("gap brain: source stays read-only", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /syncDriveIncremental/);
  assert.doesNotMatch(SRC, /company-brain\/upload/);
  assert.doesNotMatch(SRC, /company-brain\/sync/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']/);
  assert.doesNotMatch(SRC, /second watchdog|new watchdog|second tripwire/i);
  assert.equal(DRIVE_SYNC_CRON, "*/10 * * * *");
  assert.equal(DRIVE_SYNC_STALE_MS, 30 * 60 * 1000);
  assert.deepEqual([...SEARCH_READ_PATHS], [
    "/api/read/company-brain",
    "/api/read/company-brain-affiliate"
  ]);
  assert.deepEqual([...CHECK_IDS], [
    "brain:drive-last-error",
    "brain:drive-sync-stale",
    "brain:search-read-route"
  ]);
  assert.equal(searchReadStatusUp(500), false);
  assert.equal(searchReadStatusUp(401), true);
  assert.equal(searchReadStatusUp(405), true);
});

test("gap brain: no database and no fetch skips all three", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
});

test("gap brain: a fresh scan with an empty error and a live door is three PASS rows", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/gap:drive-last-error/.test(sql)) return { rows: [{ n: 0, errors: null }] };
      if (/gap:drive-sync-stale/.test(sql)) {
        return { rows: [{ n: 1, last_sync_at: isoMinutesAgo(5) }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
  const { fetchImpl, calls } = fakeFetch(401);
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    fetchImpl,
    baseUrl: "https://fundhub.ai/"
  });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(seen.length, 2);
  for (const call of seen) {
    assert.match(call.sql, /^\s*\/\* gap:/);
    assert.doesNotMatch(call.sql, /\b(INSERT|UPDATE|DELETE)\b/i);
    assert.equal(call.params[0], ORG);
  }
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.opts.method, "GET");
    assert.match(call.url, /^https:\/\/fundhub\.ai\/api\/read\/company-brain/);
    assert.doesNotMatch(call.url, /company-brain\/sync|company-brain\/upload/);
  }
});

test("gap brain: each named break is a FAIL and the others stay PASS", async () => {
  const cases = [
    {
      db: fakeDb({ errors: 1, errorText: "token rejected" }),
      id: "brain:drive-last-error",
      detail: /1 Drive sync row has last_error set: token rejected/
    },
    {
      db: fakeDb({ lastSyncAt: isoMinutesAgo(31) }),
      id: "brain:drive-sync-stale",
      detail: /31 min ago, red after 30 min/
    },
    {
      db: fakeDb({}),
      fetchStatus: (pathName) => (pathName === "/api/read/company-brain" ? 500 : 401),
      id: "brain:search-read-route",
      detail: /\/api\/read\/company-brain answered 500/
    }
  ];
  for (const c of cases) {
    const { fetchImpl, calls } = fakeFetch(c.fetchStatus || 405);
    const rows = await gapChecks({
      db: c.db,
      orgId: ORG,
      now: NOW,
      fetchImpl,
      baseUrl: "https://fundhub.ai"
    });
    rows.forEach(shape);
    const hit = rows.find((r) => r.id === c.id);
    assert.equal(hit.status, "FAIL");
    assert.match(hit.detail, c.detail);
    const rest = rows.filter((r) => r.id !== c.id);
    assert.ok(rest.every((r) => r.status === "PASS"));
    assert.ok(calls.every((call) => call.opts.method === "GET"));
  }
});

test("gap brain: a Drive sync that never ran is FAIL and does not scan Drive", async () => {
  const { fetchImpl, calls } = fakeFetch(403);
  const rows = await gapChecks({
    db: fakeDb({ syncRows: 0, errors: 0 }),
    orgId: ORG,
    now: NOW,
    fetchImpl
  });
  rows.forEach(shape);
  const stale = rows.find((r) => r.id === "brain:drive-sync-stale");
  assert.equal(stale.status, "FAIL");
  assert.match(stale.detail, /never been scanned/);
  assert.equal(rows.find((r) => r.id === "brain:drive-last-error").status, "PASS");
  assert.equal(rows.find((r) => r.id === "brain:search-read-route").status, "PASS");
  assert.ok(calls.every((call) => call.opts.method === "GET"));
  assert.ok(calls.every((call) => !/sync|upload/.test(call.url)));
});

test("gap brain: a read error is FAIL, not a throw", async () => {
  const db = {
    async query() {
      throw new Error("relation brain_drive_sync does not exist");
    }
  };
  const { fetchImpl } = fakeFetch(401);
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, fetchImpl });
  rows.forEach(shape);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /brain_drive_sync/);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /brain_drive_sync/);
  assert.equal(rows[2].status, "PASS");
});

test("gap brain: the live search and read routes are wired to the 10 minute sweeper", () => {
  const api = fs.readFileSync(path.join(ROOT, "netlify/functions/api.mjs"), "utf8");
  const sweeper = fs.readFileSync(path.join(ROOT, "src/workflows/meet-transcript-sweeper.mjs"), "utf8");
  assert.match(api, /"read\/company-brain":\s*readCompanyBrain/);
  assert.match(api, /"read\/company-brain-affiliate":\s*readCompanyBrainAffiliate/);
  assert.match(sweeper, /export const SWEEP_CRON = "\*\/10 \* \* \* \*"/);
});
