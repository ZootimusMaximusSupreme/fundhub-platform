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

test("gap sms: journey sql finds the person by email when the event has no client id", () => {
  const sql = buildJourneyZeroSql();
  // Measured 2026-10-08: booking, deposit and round events all have client_id NULL.
  // A filter on e.client_id IS NOT NULL made five of six steps impossible to FAIL.
  assert.doesNotMatch(sql, /e\.client_id\s+IS NOT NULL/i);
  assert.match(sql, /COALESCE\(\s*e\.client_id,/);
  assert.match(sql, /lower\(c\.email\)\s*=\s*lower\(btrim\(COALESCE\(e\.payload->>'email'/);
  assert.match(sql, /o\.client_id = rc\.id/);
  assert.match(sql, /p\.client_id = rc\.id/);
  assert.doesNotMatch(sql, /\be\.client_id\s*=/);
});

// Each watched step must still be what the workflow really does. If a workflow renames its
// template, moves its trigger, or changes the ref it writes, the check would go quiet or
// shout for no reason. This reads the workflow files and fails when they drift.
const STEP_SOURCES = {
  "entry.captured": ["s-00-welcome.mjs", ["event: \"entry.captured\"", "SMS-S00-WELCOME", "eventId }"]],
  "booking.created": ["s-04b-booking-reminders.mjs", ["{ event: \"booking.created\" }", "SMS-S04-01-CONFIRM", "eventId: `${eventId}:confirm`"]],
  "booking.rescheduled": ["s-04b-booking-reminders.mjs", ["{ event: \"booking.rescheduled\" }", "SMS-S04-01-CONFIRM", "eventId: `${eventId}:confirm`"]],
  "round.started": ["round-started-client-notify.mjs", ["event: \"round.started\"", "SMS-ROUND-STARTED-NOTIFY", "eventId: event.id"]],
  "round.approved": ["f-04-round-approvals.mjs", ["event: \"round.approved\"", "SMS-F04-ROUND-APPROVALS", "approvedAmount"]],
  "round.submitted": ["f-03-round-submitted.mjs", ["event: \"round.submitted\"", "SMS-F03-ROUND-SUBMITTED", "roundNumber"]],
  "deposit.paid": ["s-doc-collection.mjs", ["event: \"deposit.paid\"", "SMS-DOC-01-REQUEST", "claimCustomFieldLock"]]
};

test("gap sms: every watched step still matches the workflow that sends it", () => {
  assert.deepEqual(
    SMS_JOURNEY_STEPS.map((s) => s.eventName).sort(),
    Object.keys(STEP_SOURCES).sort()
  );
  for (const s of SMS_JOURNEY_STEPS) {
    const [file, needles] = STEP_SOURCES[s.eventName];
    const src = fs.readFileSync(path.join(HERE, "..", "..", "workflows", file), "utf8");
    for (const needle of needles) {
      assert.ok(src.includes(needle), `${file} no longer has ${needle} (step ${s.eventName})`);
    }
    assert.ok(src.includes(s.templateKey), `${file} no longer sends ${s.templateKey}`);
    if (s.refSuffix) assert.equal(s.refSuffix, ":confirm");
    if (s.oncePerClient) assert.match(src, /claimCustomFieldLock|LOCK_FIELD/);
  }
});

test("gap sms: one failed read skips that check only and is never a PASS", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("status = 'sending'")) throw new Error("permission denied for table messages");
    if (sql.includes("status = 'failed'")) return { rows: [{ customer_n: 0, staff_n: 0 }] };
    return { rows: [{ n: 3, names: ["booking.created", "deposit.paid"] }] };
  });
  const rows = await gapChecks({ db, orgId: ORG });
  shape(rows);
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /permission denied/);
  assert.equal(rows[1].status, "PASS");
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /3 steps/);
  assert.match(rows[2].detail, /booking\.created, deposit\.paid/);
});

test("gap sms: a row with no readable count is a skip, not a PASS", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("status = 'sending'")) return { rows: [{}] };
    if (sql.includes("status = 'failed'")) return { rows: [{ customer_n: null, staff_n: 0 }] };
    return { rows: [{ n: "not a number", names: [] }] };
  });
  const rows = await gapChecks({ db, orgId: ORG });
  shape(rows);
  assert.ok(rows.every((r) => r.status === "skip"));
});

test("gap sms: the cutoffs come from now, so a text sent a minute ago is not late", async () => {
  const db = fakeDb(() => ({ rows: [{ customer_n: 0, staff_n: 0, n: 0, names: [] }] }));
  const now = new Date("2026-10-08T12:00:00.000Z");
  await gapChecks({ db, orgId: ORG, now });
  assert.equal(db.seen[0].params[1], "2026-10-08T11:45:00.000Z");
  assert.equal(db.seen[1].params[1], "2026-10-01T12:00:00.000Z");
  assert.equal(db.seen[2].params[1], "2026-10-08T11:45:00.000Z");
  assert.equal(db.seen[2].params[2], "2026-10-01T12:00:00.000Z");
});
