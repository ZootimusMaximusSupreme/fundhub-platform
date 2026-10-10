// Customer records gaps (erasure, identity company, bureau config, recording and ad consent).
// Fake database only. No consent is recorded. Nothing is erased.
// What the SQL itself answers, on a real Postgres, is in gap-customer-records.pg.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUREAU_SQL,
  CHECK_IDS,
  CONSENT_SQL,
  DIALED_BUREAUS,
  ERASURE_SQL,
  ERASURE_WINDOW_MS,
  PII_COMPANY_SQL,
  PII_LOOKBACK_MS,
  SQL,
  assertRead,
  gapChecks,
  judgeBureauConfig,
  judgeErasure,
  judgePiiCompany,
  judgeRecordingConsent
} from "./gap-records.mjs";
import { CONSENT_VALID_SQL } from "../../consent/index.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-records.mjs"), "utf8");
const NOW = new Date("2026-10-10T13:00:00.000Z");
const ORG = "11111111-1111-4111-8111-111111111111";

function dbFrom(answers) {
  return {
    seen: [],
    async query(sql, params) {
      this.seen.push({ sql, params });
      const hit = answers.find((a) => a.test.test(sql));
      if (!hit) throw new Error(`unmatched ${String(sql).replace(/\s+/g, " ").slice(0, 100)}`);
      if (hit.throw) throw new Error(hit.throw);
      return { rows: hit.rows };
    }
  };
}

const erasure = (over = {}) => ({ test: /gap:privacy-erasure/, rows: [{ waiting: 0, failed: 0, oldest_waiting: null, oldest_failed: null, ...over }] });
const pii = (over = {}) => ({ test: /gap:privacy-pii-company/, rows: [{ reveals: 0, by_staff: 0, across: 0, clients: 0, staff_n: 0, latest: null, ...over }] });
const bureauRows = (rows) => ({ test: /gap:bureau-config/, rows });
const complete = () => DIALED_BUREAUS.map((c) => ({ bureau_code: c, active: true, has_number: true, has_menu: true }));
const consent = (over = {}) => ({ test: /gap:consent-recording-and-ads/, rows: [{ recordings: 0, recorded_no_consent: 0, cleared: 0, cleared_no_consent: 0, ...over }] });

const allGood = () => dbFrom([erasure(), pii(), bureauRows(complete()), consent()]);

test("every statement is one read, writes nothing, and the lane reads no repo file or web address", () => {
  assert.equal(SQL.length, 4);
  for (const sql of SQL) {
    assert.doesNotThrow(() => assertRead(sql));
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  }
  assert.doesNotMatch(SRC, /fetch\(|node:fs|readFileSync|method:\s*["']POST|captureConsent\(/);
  assert.deepEqual([...CHECK_IDS], ["privacy:erasure", "privacy:pii-company", "bureau-config:complete", "consent:recording-and-ads"]);
});

test("the read guard accepts a comment then SELECT or WITH and refuses every write word", () => {
  assert.doesNotThrow(() => assertRead("/* x */ SELECT 1"));
  assert.doesNotThrow(() => assertRead("WITH a AS (SELECT 1) SELECT * FROM a"));
  for (const sql of [
    "INSERT INTO erasure_requests DEFAULT VALUES",
    "UPDATE erasure_requests SET status = 'completed'",
    "DELETE FROM pii_access_log",
    "SELECT 1; DROP TABLE x",
    "TRUNCATE ai_bureau_config",
    "BEGIN"
  ]) assert.throws(() => assertRead(sql), /refused a write/, sql);
});

test("the three dialed bureaus are the ones the AI caller builds a call for", () => {
  const src = fs.readFileSync(path.join(HERE, "../../inquiry-ops/bureau-call.mjs"), "utf8");
  const block = /const BUREAU_CONFIGS = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(src);
  assert.ok(block, "BUREAU_CONFIGS is still in bureau-call.mjs");
  const dialed = [...block[1].matchAll(/\b([A-Z]{2}):\s*build/g)].map((m) => m[1]).sort();
  assert.deepEqual(dialed, [...DIALED_BUREAUS].sort());
});

test("the erasure SQL judges 'requested' past a day and 'failed' at once, and a later completed row clears both", () => {
  assert.match(ERASURE_SQL, /r\.status = 'failed' OR \(r\.status = 'requested' AND r\.created_at < \$2::timestamptz\)/);
  assert.match(ERASURE_SQL, /d\.status = 'completed'/);
  assert.match(ERASURE_SQL, /d\.created_at > r\.created_at/);
  assert.match(ERASURE_SQL, /d\.subject_item_id IS NOT DISTINCT FROM r\.subject_item_id/);
  assert.match(ERASURE_SQL, /d\.kind = r\.kind/);
  assert.equal(ERASURE_WINDOW_MS, 24 * 60 * 60 * 1000);
});

test("the identity SQL joins the staff id to the access log and compares companies, over the last 7 days", () => {
  assert.match(PII_COMPANY_SQL, /LEFT JOIN staff s ON s\.id::text = l\.accessed_by/);
  assert.match(PII_COMPANY_SQL, /l\.org_id IS DISTINCT FROM s\.org_id/);
  assert.match(PII_COMPANY_SQL, /l\.created_at > \$2::timestamptz/);
  assert.equal(PII_LOOKBACK_MS, 7 * 24 * 60 * 60 * 1000);
});

test("the consent SQL uses the one live-consent rule, and judges a recording by the consent it had when it was saved", () => {
  assert.ok(CONSENT_SQL.includes(CONSENT_VALID_SQL.trim()), "the live rule is the one in src/consent/index.mjs");
  assert.match(CONSENT_SQL, /cc\.kind = 'call_recording'/);
  assert.match(CONSENT_SQL, /cc\.granted_at <= i\.created_at/);
  assert.match(CONSENT_SQL, /cc\.revoked_at IS NULL OR cc\.revoked_at > i\.created_at/);
  assert.match(CONSENT_SQL, /cc\.kind = 'marketing_use'/);
  assert.match(CONSENT_SQL, /i\.marketing_cleared/);
  assert.match(CONSENT_SQL, /\$2::boolean OR NOT/);
  assert.match(CONSENT_SQL, /custom_fields ->> 'synthetic'/);
  assert.match(BUREAU_SQL, /org_id = \$1::uuid/);
});

test("no database: four skips", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  assert.ok(rows.every((r) => r.status === "skip"));
});

test("PASS: all four rows are green on a clean company and say what they read", async () => {
  const db = allGood();
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  for (const r of rows) {
    assert.equal(r.status, "PASS", r.id);
    assert.equal(r.suggestedFix, null);
  }
  assert.match(rows[2].detail, /EX, EQ, TU\) have a number and a menu path/);
  const e = db.seen.find((q) => /gap:privacy-erasure/.test(q.sql));
  assert.equal(e.params[0], ORG);
  assert.equal(e.params[1], new Date(NOW.getTime() - ERASURE_WINDOW_MS).toISOString());
  const p = db.seen.find((q) => /gap:privacy-pii-company/.test(q.sql));
  assert.equal(p.params[1], new Date(NOW.getTime() - PII_LOOKBACK_MS).toISOString());
  const c = db.seen.find((q) => /gap:consent-recording-and-ads/.test(q.sql));
  assert.deepEqual(c.params, [ORG, false, TEST_CLIENT_EMAIL_RE]);
});

// ── privacy:erasure ──────────────────────────────────────────────────────────

test("erasure FAIL: a request still 'requested' past a day is red, with its age", () => {
  const r = judgeErasure({ waiting: 2, failed: 0, oldest_waiting: new Date(NOW.getTime() - 3 * 86400000).toISOString() }, NOW);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 requests are still 'requested' after a day \(the oldest is 3 days old\)/);
  assert.match(r.detail, /asked for their data to be removed/);
  assert.match(r.suggestedFix, /Do not auto-fix/);
});

test("erasure FAIL: a failed request is red at once and says no later request finished", () => {
  const r = judgeErasure({ waiting: 0, failed: 1, oldest_failed: new Date(NOW.getTime() - 2 * 3600000).toISOString() }, NOW);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 request failed and no later request for the same person finished \(the oldest is 2 hours old\)/);
});

test("erasure PASS: nothing waiting or failed", () => {
  assert.equal(judgeErasure({ waiting: 0, failed: 0 }, NOW).status, "PASS");
});

// ── privacy:pii-company ──────────────────────────────────────────────────────

test("identity FAIL: a reveal by staff of another company is red and names counts, not people", () => {
  const r = judgePiiCompany({ reveals: 5, by_staff: 4, across: 2, clients: 1, staff_n: 1 });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 identity reveals were made by staff from a different company than the client/);
  assert.match(r.detail, /1 client, 1 staff member, last 7 days/);
  assert.match(r.suggestedFix, /api\/pii\.mjs checks the client id and not the company/);
  assert.doesNotMatch(JSON.stringify(r), /ssn|\d{3}-\d{2}-\d{4}/i);
});

test("identity PASS: none across, and the system labels are counted as unmatched, not as clean", () => {
  assert.match(judgePiiCompany({ reveals: 0 }).detail, /No identity was revealed in the last 7 days/);
  const allStaff = judgePiiCompany({ reveals: 3, by_staff: 3, across: 0 });
  assert.equal(allStaff.status, "PASS");
  assert.match(allStaff.detail, /all were by a named staff member from the client's own company/);
  const mixed = judgePiiCompany({ reveals: 3, by_staff: 2, across: 0 });
  assert.match(mixed.detail, /2 by a named staff member were from the client's own company, and 1 was a system label/);
  const none = judgePiiCompany({ reveals: 1, by_staff: 0, across: 0 });
  assert.equal(none.status, "PASS");
  assert.match(none.detail, /none could be matched to a named staff member \(all were system labels\)/);
});

// ── bureau-config:complete ───────────────────────────────────────────────────

test("bureau config PASS: a number and a menu path for each of EX, EQ, TU", () => {
  assert.equal(judgeBureauConfig(complete()).status, "PASS");
  // Inactive rows and extra bureaus do not change the answer for the three that are dialed.
  assert.equal(judgeBureauConfig([...complete(), { bureau_code: "XX", active: false, has_number: false, has_menu: false }]).status, "PASS");
});

test("bureau config FAIL: each gap is named, by bureau", () => {
  const blank = DIALED_BUREAUS.map((c) => ({ bureau_code: c, active: true, has_number: false, has_menu: false }));
  const r = judgeBureauConfig(blank);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /no service number for EX, EQ, TU; no menu path for EX, EQ, TU/);
  assert.match(r.suggestedFix, /Do not invent numbers/);

  const oneMenu = complete();
  oneMenu[1] = { ...oneMenu[1], has_menu: false };
  const m = judgeBureauConfig(oneMenu);
  assert.equal(m.status, "FAIL");
  assert.match(m.detail, /no menu path for EQ\./);
  assert.doesNotMatch(m.detail, /no service number/);

  const missing = judgeBureauConfig(complete().filter((r) => r.bureau_code !== "TU"));
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /no row for TU/);

  assert.equal(judgeBureauConfig([]).status, "FAIL");
});

test("bureau config: no company means the read is skipped, not passed", async () => {
  const rows = await gapChecks({ db: allGood(), now: NOW });
  const bureau = rows.find((r) => r.id === "bureau-config:complete");
  assert.equal(bureau.status, "skip");
  const c = rows.find((r) => r.id === "consent:recording-and-ads");
  assert.equal(c.status, "skip");
});

// ── consent:recording-and-ads ────────────────────────────────────────────────

test("consent FAIL: a recording with no consent is red, and an ad clip that lost its consent is red", () => {
  const rec = judgeRecordingConsent({ recordings: 4, recorded_no_consent: 2, cleared: 0, cleared_no_consent: 0 });
  assert.equal(rec.status, "FAIL");
  assert.match(rec.detail, /2 saved recordings have no call-recording consent that was live when it was saved/);
  assert.doesNotMatch(rec.detail, /cleared for ads/);

  const ads = judgeRecordingConsent({ recordings: 0, recorded_no_consent: 0, cleared: 3, cleared_no_consent: 1 });
  assert.equal(ads.status, "FAIL");
  assert.match(ads.detail, /1 clip cleared for ads has lost its marketing consent/);
  assert.doesNotMatch(ads.detail, /call-recording/);

  const both = judgeRecordingConsent({ recordings: 1, recorded_no_consent: 1, cleared: 1, cleared_no_consent: 1 });
  assert.match(both.detail, /call-recording consent/);
  assert.match(both.detail, /marketing consent/);
  assert.match(both.suggestedFix, /Do not record consent for a real person from this check/);
});

test("consent PASS: says how many it read", () => {
  const r = judgeRecordingConsent({ recordings: 7, recorded_no_consent: 0, cleared: 2, cleared_no_consent: 0 });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /\(7 recordings and 2 cleared clips read\)/);
});

// ── the whole lane ───────────────────────────────────────────────────────────

test("one read failing is one skip, and the other three rows still answer", async () => {
  const db = dbFrom([
    erasure({ failed: 1 }),
    { test: /gap:privacy-pii-company/, throw: "permission denied for table staff" },
    bureauRows(complete()),
    consent({ cleared: 1, cleared_no_consent: 1 })
  ]);
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by["privacy:erasure"].status, "FAIL");
  assert.equal(by["privacy:pii-company"].status, "skip");
  assert.match(by["privacy:pii-company"].detail, /permission denied for table staff/);
  assert.equal(by["bureau-config:complete"].status, "PASS");
  assert.equal(by["consent:recording-and-ads"].status, "FAIL");
});

test("a read that comes back with no rows is judged as zero counts, a failed read is never a PASS", async () => {
  const empty = dbFrom([
    { test: /gap:privacy-erasure/, rows: [] },
    { test: /gap:privacy-pii-company/, rows: [] },
    bureauRows([]),
    { test: /gap:consent-recording-and-ads/, rows: [] }
  ]);
  const rows = await gapChecks({ db: empty, now: NOW, orgId: ORG });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  // An empty bureau table is a real FAIL: nothing is filled in.
  assert.equal(by["bureau-config:complete"].status, "FAIL");
  const down = { async query() { throw new Error("connection terminated"); } };
  const dead = await gapChecks({ db: down, now: NOW, orgId: ORG });
  assert.ok(dead.every((r) => r.status === "skip"), "a dead database is skips, never PASS");
});

test("reads go through the staff scope when one is passed, and demoOn reaches the consent read", async () => {
  const viaScope = allGood();
  const viaDb = allGood();
  await gapChecks({ db: viaDb, scope: (fn) => fn(viaScope), now: NOW, orgId: ORG, demoOn: true });
  assert.equal(viaDb.seen.length, 0);
  assert.equal(viaScope.seen.length, 4);
  const c = viaScope.seen.find((q) => /gap:consent-recording-and-ads/.test(q.sql));
  assert.equal(c.params[1], true);
});
