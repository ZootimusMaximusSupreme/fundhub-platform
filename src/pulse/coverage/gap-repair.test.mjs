import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { gapChecks } from "./gap-repair.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const SHAPE = ["id", "status", "detail", "suggestedFix"];
const STATUSES = new Set(["PASS", "FAIL", "skip"]);

function fakeDb({ stuck = [], missing = [], throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ text, params });
      if (throwOn && throwOn.test(text)) throw new Error("connection refused");
      if (text.includes("dispute_items")) return { rows: missing };
      if (text.includes("stalled")) return { rows: stuck };
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

function assertShape(rows) {
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id), ["repair-case-stuck", "repair-letter-round"]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), SHAPE);
    assert.equal(typeof row.id, "string");
    assert.ok(STATUSES.has(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Recon \(AG-07\) is the only tripwire/);
      assert.match(row.suggestedFix, /Do not add a second watchdog/);
      assert.match(row.suggestedFix, /Do not send bureau mail/);
      assert.match(row.suggestedFix, /Do not pull credit/);
      assert.match(row.suggestedFix, /Do not rewrite a dispute letter that contradicts itself/);
      assert.match(row.suggestedFix, /Do not auto-fix/);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

test("gapChecks skips both reads when there is no database", async () => {
  for (const ctx of [undefined, null, {}, { db: {} }, { db: { query() {} } }, { orgId: ORG }]) {
    const rows = await gapChecks(ctx);
    assertShape(rows);
    assert.equal(rows[0].status, "skip");
    assert.equal(rows[1].status, "skip");
    assert.match(rows[0].detail, /no database/);
    assert.match(rows[1].detail, /no database/);
  }
});

test("gapChecks passes when no repair case is stuck and no letter round is missing", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG });
  assertShape(rows);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "PASS");
  assert.match(rows[0].detail, /no stuck repair cases/);
  assert.match(rows[1].detail, /no letter round is waiting/);
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls[0].params, [ORG]);
  assert.deepEqual(db.calls[1].params, [ORG]);
  for (const call of db.calls) {
    assert.match(call.text, /^\s*SELECT\b/i);
  }
});

test("a stalled repair case fails only the stuck check", async () => {
  const rows = await gapChecks({
    db: fakeDb({ stuck: [{ id: "case-9" }, { id: "card-2" }] }),
    orgId: ORG
  });
  assertShape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /2 repair cases are stuck/);
  assert.match(rows[0].detail, /case-9/);
  assert.match(rows[0].detail, /card-2/);
  assert.equal(rows[1].status, "PASS");
});

test("an open case with items and no letter fails only the letter check", async () => {
  const rows = await gapChecks({
    db: fakeDb({ missing: [{ id: "case-3", round: "R2" }] }),
    orgId: ORG
  });
  assertShape(rows);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /1 letter round should have been written and was not/);
  assert.match(rows[1].detail, /case-3 R2/);
  assert.match(rows[1].suggestedFix, /Do not mail it/);
});

test("both breaks can fail in one read", async () => {
  const rows = await gapChecks({
    db: fakeDb({
      stuck: [{ id: "case-1" }],
      missing: [{ id: "card-4", round: null }, { id: "case-8", round: "R1" }]
    }),
    orgId: ORG
  });
  assertShape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /1 repair case is stuck/);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /2 letter rounds should have been written and were not/);
  assert.match(rows[1].detail, /card-4/);
  assert.match(rows[1].detail, /case-8 R1/);
});

test("a read error fails that check and leaves the other one alone", async () => {
  const rows = await gapChecks({
    db: fakeDb({ throwOn: /stalled/ }),
    orgId: ORG
  });
  assertShape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /connection refused/);
  assert.equal(rows[1].status, "PASS");
});

test("the module only reads, and it does not repeat the repair workflow list", () => {
  const src = fs.readFileSync(new URL("./gap-repair.mjs", import.meta.url), "utf8");
  assert.match(src, /export async function gapChecks/);
  assert.match(src, /slice-15-repair\.mjs/);
  assert.doesNotMatch(src, /c-00-crs-soft-pull|ds-02-diy-letters|repair-bureau-response-reader/);
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|fetch\(|postgrid|sendRepair|analyzeAndGenerate|body_text|crs_)\b/i);
  assert.match(src, /status = 'stalled'/);
  assert.match(src, /ps\.key = 'stalled'/);
  assert.match(src, /dispute_items/);
  assert.match(src, /letters_generated/);
  assert.match(src, /ready_to_send/);
  assert.doesNotMatch(src, /variance_failed/);
});
