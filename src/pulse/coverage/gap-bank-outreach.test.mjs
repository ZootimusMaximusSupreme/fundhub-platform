import test from "node:test";
import assert from "node:assert/strict";
import { CHECK_IDS, VERIFIED_SQL, NEXT_ACTION_SQL, gapChecks } from "./gap-bank-outreach.mjs";

const db = (verified, actions) => ({
  seen: [],
  async query(sql) {
    this.seen.push(sql);
    return { rows: [sql === VERIFIED_SQL ? verified : actions] };
  }
});

test("PASS: sound verified products and all active accounts with next actions", async () => {
  const source = db({ total: 3, broken: 0 }, { active: 8, missing: 0 });
  const rows = await gapChecks({ db: source });
  assert.deepEqual(rows.map((r) => r.id), CHECK_IDS);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS"]);
  assert.equal(source.seen.length, 2);
});

test("FAIL: a broken promoted result and missing next action stay red", async () => {
  const rows = await gapChecks({ db: db({ total: 3, broken: 1 }, { active: 8, missing: 2 }) });
  assert.deepEqual(rows.map((r) => r.status), ["FAIL", "FAIL"]);
  assert.match(rows[0].detail, /1 of 3 verified/);
  assert.match(rows[1].detail, /2 of 8 active/);
  assert.ok(rows.every((r) => r.suggestedFix));
});

test("empty setup is green; missing read is not a pass; SQL checks org links", async () => {
  assert.deepEqual((await gapChecks({ db: db({ total: 0, broken: 0 }, { active: 0, missing: 0 }) })).map((r) => r.status), ["PASS", "PASS"]);
  assert.deepEqual((await gapChecks({ db: db({}, {}) })).map((r) => r.status), ["skip", "skip"]);
  assert.match(VERIFIED_SQL, /l\.org_id IS DISTINCT FROM p\.org_id/);
  assert.match(VERIFIED_SQL, /c\.org_id = p\.org_id/);
  assert.match(VERIFIED_SQL, /p\.facts/);
  assert.match(NEXT_ACTION_SQL, /a\.next_due_at IS NULL/);
});
