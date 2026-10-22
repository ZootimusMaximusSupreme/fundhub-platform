import test from "node:test";
import assert from "node:assert/strict";
import { CHECK_IDS, VERIFIED_SQL, NEXT_ACTION_SQL, EMAIL_SAFETY_SQL, REPLY_WAITING_SQL, gapChecks } from "./gap-bank-outreach.mjs";
import { VERIFIED_SQL as HOURLY_VERIFIED_SQL } from "../beats/beat-bank-outreach.mjs";

const SAFE = { total: 4, unknown_recipient: 0, after_opt_out: 0, after_reply: 0 };
const QUIET = { waiting: 1, stuck: 0 };
const db = (verified, actions, email = SAFE, replies = QUIET) => ({
  seen: [],
  async query(sql) {
    this.seen.push(sql);
    const map = new Map([[VERIFIED_SQL, verified], [NEXT_ACTION_SQL, actions], [EMAIL_SAFETY_SQL, email], [REPLY_WAITING_SQL, replies]]);
    return { rows: [map.get(sql)] };
  }
});

test("PASS: sound verified products and all active accounts with next actions", async () => {
  const source = db({ total: 3, broken: 0 }, { active: 8, missing: 0 });
  const rows = await gapChecks({ db: source });
  assert.deepEqual(rows.map((r) => r.id), CHECK_IDS);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "PASS"]);
  assert.equal(source.seen.length, 4);
});

test("FAIL: a broken promoted result and missing next action stay red", async () => {
  const rows = await gapChecks({ db: db({ total: 3, broken: 1 }, { active: 8, missing: 2 }) });
  assert.deepEqual(rows.map((r) => r.status), ["FAIL", "FAIL", "PASS", "PASS"]);
  assert.match(rows[0].detail, /1 of 3 verified/);
  assert.match(rows[1].detail, /2 of 8 active/);
  assert.ok(rows.slice(0, 2).every((r) => r.suggestedFix));
});

test("FAIL: a bank email after a stop, after a reply, or to an unsaved address; a stuck reply", async () => {
  for (const bad of [{ after_opt_out: 1 }, { after_reply: 2 }, { unknown_recipient: 1 }]) {
    const rows = await gapChecks({ db: db({ total: 0, broken: 0 }, { active: 0, missing: 0 }, { ...SAFE, ...bad }, QUIET) });
    assert.equal(rows[2].status, "FAIL");
    assert.ok(rows[2].suggestedFix);
  }
  const rows = await gapChecks({ db: db({ total: 0, broken: 0 }, { active: 0, missing: 0 }, SAFE, { waiting: 3, stuck: 1 }) });
  assert.equal(rows[3].status, "FAIL");
  assert.match(rows[3].detail, /1 banker replies/);
  // Replies waiting for a person, not the machine, are work due: still green.
  assert.equal((await gapChecks({ db: db({ total: 0, broken: 0 }, { active: 0, missing: 0 }, SAFE, { waiting: 9, stuck: 0 }) }))[3].status, "PASS");
  assert.match(EMAIL_SAFETY_SQL, /email_opt_out_at < m\.created_at/);
  assert.match(REPLY_WAITING_SQL, /status = 'new'/);
});

test("empty setup is green; missing read is not a pass; SQL checks org links", async () => {
  assert.deepEqual((await gapChecks({ db: db({ total: 0, broken: 0 }, { active: 0, missing: 0 }, { total: 0, unknown_recipient: 0, after_opt_out: 0, after_reply: 0 }, { waiting: 0, stuck: 0 }) })).map((r) => r.status), ["PASS", "PASS", "PASS", "PASS"]);
  assert.deepEqual((await gapChecks({ db: db({}, {}, {}, {}) })).map((r) => r.status), ["skip", "skip", "skip", "skip"]);
  assert.match(VERIFIED_SQL, /l\.org_id IS DISTINCT FROM p\.org_id/);
  assert.match(VERIFIED_SQL, /c\.org_id = p\.org_id/);
  assert.match(VERIFIED_SQL, /p\.facts/);
  assert.match(NEXT_ACTION_SQL, /a\.next_due_at IS NULL/);
});

test("n/a is accepted exactly where unknown is for the two business-only keys, in the morning check and the hourly beat alike", () => {
  const clause = `ELSE f.value = '"unknown"'::jsonb OR f.value = '"n/a"'::jsonb END`;
  for (const sql of [VERIFIED_SQL, HOURLY_VERIFIED_SQL]) {
    // The branch for the two business-only keys is the only place "n/a" is allowed.
    assert.equal(sql.split(clause).length - 1, 1);
    assert.equal((sql.match(/"n\/a"/g) || []).length, 1);
    const branch = sql.slice(sql.indexOf("WHEN f.key IN ('minimum_time_in_business_years','minimum_revenue_threshold')"));
    assert.ok(branch.indexOf(clause) > 0 && branch.indexOf(clause) < branch.indexOf("WHEN f.key = 'stated_income'"));
  }
  const withoutTag = (sql) => sql.replace(/^\/\*[^*]*\*\//, "").trim();
  assert.equal(withoutTag(VERIFIED_SQL), withoutTag(HOURLY_VERIFIED_SQL));
});
