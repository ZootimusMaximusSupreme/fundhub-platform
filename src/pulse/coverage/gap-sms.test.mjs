import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALREADY_WATCHED,
  BREAKS,
  NOT_DUPLICATED,
  SMS_JOURNEY_STEPS,
  buildJourneyZeroSql,
  gapChecks
} from "./gap-sms.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-sms.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const KEYS = ["id", "status", "detail", "suggestedFix"];

function shape(rows) {
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...KEYS].sort());
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.startsWith("gap:sms-"));
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Recon stays the one tripwire/);
      assert.doesNotMatch(row.suggestedFix, /outbound_enabled|second watchdog|second tripwire|flip/i);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

function fakeDb(route) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      assert.match(sql.trim(), /^SELECT\b/i);
      assert.doesNotMatch(sql, /\b(insert|update|delete|alter|drop)\b/i);
      assert.doesNotMatch(sql, /messaging_settings|outbound_enabled/i);
      return route(sql, params);
    }
  };
}

test("gap sms: source does not send or write", () => {
  assert.doesNotMatch(SRC, /twilio|dispatchDue|dispatchMessage|messaging_settings|outbound_enabled/i);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE)\b/);
});

test("gap sms: breaks, already watched, and slice 12 are not re-checked", () => {
  assert.equal(BREAKS.length, 4);
  assert.equal(BREAKS.filter((b) => b.newCheck).length, 3);
  assert.equal(ALREADY_WATCHED.length, 4);
  assert.equal(NOT_DUPLICATED.length, 3);
  const watched = new Set(ALREADY_WATCHED.map((r) => r.id));
  for (const id of ["pipeline:outbound", "job:message-dispatch-sweeper", "job:staff-message-sweeper"]) {
    assert.ok(watched.has(id) || [...watched].some((x) => x.includes(id.replace("job:", ""))));
  }
  assert.ok(ALREADY_WATCHED.some((r) => r.id === "pipeline:outbound"));
  assert.ok(ALREADY_WATCHED.some((r) => r.where.includes("instant-watch")));
});

test("gap sms: journey sql names each immediate step and stays a select", () => {
  const sql = buildJourneyZeroSql();
  assert.match(sql, /^SELECT\b/);
  assert.doesNotMatch(sql, /;/);
  for (const s of SMS_JOURNEY_STEPS) {
    assert.match(sql, new RegExp(s.templateKey));
    assert.match(sql, new RegExp(s.eventName.replace(".", "\\.")));
  }
  assert.match(sql, /:confirm/);
  assert.match(sql, /opt_outs/);
  assert.match(sql, /NOT ILIKE '%\[DRAFT%'/);
  assert.throws(() => buildJourneyZeroSql([{
    ...SMS_JOURNEY_STEPS[0],
    templateKey: "SMS-X'; DROP"
  }]));
});

test("gap sms: no database or no company skips all three", async () => {
  const noDb = await gapChecks({});
  shape(noDb);
  assert.ok(noDb.every((r) => r.status === "skip"));
  assert.match(noDb[0].detail, /No database/);

  let called = false;
  const noOrg = await gapChecks({
    db: { query: async () => { called = true; return { rows: [] }; } },
    orgId: ""
  });
  shape(noOrg);
  assert.ok(noOrg.every((r) => r.status === "skip"));
  assert.match(noOrg[0].detail, /No company/);
  assert.equal(called, false);
});

test("gap sms: clear counts are PASS", async () => {
  const db = fakeDb(() => ({ rows: [{ customer_n: 0, staff_n: 0, n: 0, names: [] }] }));
  const rows = await gapChecks({ db, orgId: ORG, now: new Date("2026-10-08T12:00:00.000Z") });
  shape(rows);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(db.seen.length, 3);
  assert.equal(db.seen[0].params[0], ORG);
  assert.equal(db.seen[2].params.length, 3);
});

test("gap sms: stuck sending, provider failed, and a missing journey text are FAIL", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("status = 'sending'")) return { rows: [{ customer_n: 2, staff_n: 1 }] };
    if (sql.includes("status = 'failed'")) return { rows: [{ customer_n: 0, staff_n: 4 }] };
    if (sql.includes("FROM events")) return { rows: [{ n: 1, names: ["entry.captured"] }] };
    throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
  });
  const rows = await gapChecks({ db, orgId: ORG });
  shape(rows);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId["gap:sms-sending-stuck"].status, "FAIL");
  assert.match(byId["gap:sms-sending-stuck"].detail, /2 customer texts/);
  assert.match(byId["gap:sms-sending-stuck"].detail, /1 staff text/);
  assert.equal(byId["gap:sms-provider-failed"].status, "FAIL");
  assert.match(byId["gap:sms-provider-failed"].detail, /4 staff texts/);
  assert.equal(byId["gap:sms-journey-zero"].status, "FAIL");
  assert.match(byId["gap:sms-journey-zero"].detail, /entry\.captured/);
  assert.match(byId["gap:sms-journey-zero"].detail, /1 step/);
});

test("gap sms: a missing count row skips that check only", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("status = 'sending'")) return { rows: [] };
    if (sql.includes("status = 'failed'")) return { rows: [{ customer_n: 0, staff_n: 0 }] };
    return { rows: [{ n: 0, names: [] }] };
  });
  const rows = await gapChecks({ db, orgId: ORG });
  shape(rows);
  assert.equal(rows[0].status, "skip");
  assert.equal(rows[1].status, "PASS");
  assert.equal(rows[2].status, "PASS");
});
