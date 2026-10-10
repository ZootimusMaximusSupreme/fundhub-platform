import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALREADY_WATCHED,
  BAD_COPY_SQL,
  BLOCKED_SQL,
  BREAKS,
  MSG_CHECK_IDS,
  NOT_DUPLICATED,
  NO_ADDRESS_SQL,
  REPLY_SQL,
  SENT_NO_RECEIPT_SQL,
  SMS_JOURNEY_STEPS,
  TEST_ADDRESS_RE,
  buildJourneyZeroSql,
  gapChecks
} from "./gap-sms.mjs";
import { TEST_CLIENT_EMAIL_RE as CONSENT_TEST_RE } from "./gap-consent.mjs";
import { DRAFT_RE } from "../../messaging/draft-guard.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-sms.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const KEYS = ["id", "status", "detail", "suggestedFix"];

function smsRows(rows) {
  return rows.filter((r) => r.id.startsWith("gap:sms-"));
}

function msgRows(rows) {
  return rows.filter((r) => r.id.startsWith("gap:msg-"));
}

// The five gap:msg-* rows: same four keys, ids in the planned order, a fix on every FAIL.
function shapeMsg(rows) {
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.id), [...MSG_CHECK_IDS]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...KEYS].sort());
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Do not send from this check\./);
      assert.doesNotMatch(row.suggestedFix, /outbound_enabled|flip/i);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

function shape(rows) {
  // Three gap:sms-* rows, then five gap:msg-* rows. The sms rows keep their original checks.
  assert.equal(rows.length, 8);
  const sms = smsRows(rows);
  assert.equal(sms.length, 3);
  for (const row of sms) {
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
  shapeMsg(msgRows(rows));
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
  assert.ok(smsRows(rows).every((r) => r.status === "PASS"));
  assert.equal(db.seen.length, 8); // 3 sms reads, then 5 message queue reads
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

test("gap sms: journey sql leaves out demo events and demo clients", () => {
  // Measured 2026-10-08 on past days: every flagged event on 2026-09-21 (135) and 2026-09-24 (62)
  // was a journey run or seed with is_demo true. They never get a text row. Without this the
  // check goes red on test traffic. Same filter as gap-nurture.mjs.
  const sql = buildJourneyZeroSql();
  assert.match(sql, /COALESCE\(e\.is_demo, false\) = false/);
  assert.match(
    sql,
    /NOT EXISTS \(\s*SELECT 1 FROM clients d WHERE d\.id = rc\.id AND COALESCE\(d\.is_demo, false\) = true\s*\)/
  );
  // The demo filter sits on the event rows being read, before the message lookup.
  assert.ok(sql.indexOf("e.is_demo") < sql.indexOf("FROM messages m"));
});

test("gap sms: provider failed leaves out the no-phone refusal, keeps a real phone company failure", async () => {
  // The dispatcher writes "the client has no phone to send to" (no_address, dispatch.mjs).
  // A lead who gave no number is a hole in the client record, not the phone company saying no.
  // Measured 2026-10-08: the only failed SMS row was exactly that, and it held the check red for 7 days.
  const clearDb = fakeDb(() => ({ rows: [{ customer_n: 0, staff_n: 0, n: 0, names: [] }] }));
  await gapChecks({ db: clearDb, orgId: ORG });
  const sql = clearDb.seen.find((q) => q.sql.includes("status = 'failed'")).sql;
  assert.match(sql, /COALESCE\(last_error, ''\) NOT ILIKE '%to send to%'/);
  assert.match(sql, /COALESCE\(last_error, ''\) NOT ILIKE '%test record from a journey run%'/);
  // Anything else (a rejection, gave up after N attempts) still counts. No catch-all exclusion.
  assert.doesNotMatch(sql, /NOT ILIKE '%'|NOT ILIKE '%%'/);
  assert.doesNotMatch(sql, /NOT ILIKE '%gave up|NOT ILIKE '%rejected/);
  assert.match(sql, /status = 'failed'/);
  assert.match(sql, /channel = 'sms'/);

  const failedDb = fakeDb((s) => {
    if (s.includes("status = 'failed'")) return { rows: [{ customer_n: 1, staff_n: 0 }] };
    return { rows: [{ customer_n: 0, staff_n: 0, n: 0, names: [] }] };
  });
  const rows = await gapChecks({ db: failedDb, orgId: ORG });
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /1 customer text/);
});

test("gap sms: texts channel stays sms only on the sending and failed reads", () => {
  assert.match(SRC, /AND channel = 'sms'\s+AND status = 'sending'/);
  assert.match(SRC, /AND channel = 'sms'\s+AND status = 'failed'/);
  assert.doesNotMatch(SRC, /channel = 'email'/);
});

// ---------------------------------------------------------------------------
// Tier 1 (2026-10-09) — the five gap:msg-* checks on the message queue.
// Each one has a PASS test and a FAIL test, and the SQL is held to the rules it was proved with
// against the live database (read only; see ops/workflows/heartbeat-gaps-2026-10-08/sms.md).
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-09T12:00:00.000Z");
const REPLY_CLEAR = { own_n: 0, real_n: 0, saved_n: 0, lost_n: 0, unlinked_n: 0, matchable_n: 0 };
const SMS_CLEAR = { customer_n: 0, staff_n: 0, n: 0, names: [] };

// Each gap:msg-* read carries a marker no other read has, so a fake database can answer it by name.
const IS_RECEIPT = "m.status = 'sent'";
const IS_COPY = "FROM message_templates";
const IS_BLOCKED = "m.status = 'blocked'";
const IS_REPLY = "'message.inbound'";
const IS_ADDRESS = "COALESCE(m.last_error, '') ILIKE '%to send to%'";

function msgDb(routes = {}) {
  return fakeDb((sql) => {
    if (sql.includes(IS_RECEIPT)) return routes.receipt ? routes.receipt() : { rows: [] };
    if (sql.includes(IS_COPY)) return routes.copy ? routes.copy() : { rows: [] };
    if (sql.includes(IS_BLOCKED)) return routes.blocked ? routes.blocked() : { rows: [] };
    if (sql.includes(IS_REPLY)) return routes.reply ? routes.reply() : { rows: [REPLY_CLEAR] };
    if (sql.includes(IS_ADDRESS)) return routes.address ? routes.address() : { rows: [] };
    return { rows: [SMS_CLEAR] };
  });
}

async function runMsg(routes) {
  const db = msgDb(routes);
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  shape(rows);
  return { rows: msgRows(rows), db, byId: Object.fromEntries(msgRows(rows).map((r) => [r.id, r])) };
}

const ID = {
  receipt: "gap:msg-sent-no-receipt",
  copy: "gap:msg-approved-template-bad-copy",
  blocked: "gap:msg-blocked-by-sender",
  reply: "gap:msg-inbound-unmatched",
  address: "gap:msg-failed-no-address"
};

function maxParam(sql) {
  return Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
}

test("gap msg: the five ids are the planned ones, in order, and no other file uses them", () => {
  assert.deepEqual([...MSG_CHECK_IDS], Object.values(ID));
  assert.equal(new Set(MSG_CHECK_IDS).size, 5);
  for (const file of fs.readdirSync(HERE).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))) {
    if (file === "gap-sms.mjs") continue;
    const text = fs.readFileSync(path.join(HERE, file), "utf8");
    for (const id of MSG_CHECK_IDS) assert.ok(!text.includes(id), `${file} also uses ${id}`);
  }
});

test("gap msg: every read is one SELECT, no write words, and its params fit", () => {
  const reads = [
    [SENT_NO_RECEIPT_SQL, 4],
    [BAD_COPY_SQL, 1],
    [BLOCKED_SQL, 3],
    [REPLY_SQL, 3],
    [NO_ADDRESS_SQL, 3]
  ];
  for (const [sql, params] of reads) {
    assert.match(sql, /^SELECT\b/);
    assert.doesNotMatch(sql, /;/);
    assert.doesNotMatch(sql, /\b(insert|update|delete|alter|drop|truncate|create|grant)\b/i);
    assert.equal(maxParam(sql), params);
    assert.match(sql, /org_id = \$1::uuid/);
  }
});

test("gap msg: test traffic is out of every message read — demo flag, synthetic client, test address", () => {
  // Each of the three message reads takes TEST_ADDRESS_RE as its last parameter and leaves out:
  // a demo message, a client that is demo or synthetic or has a test address, and a message sent to a
  // test address (a message can go to a different address than the client's saved one).
  for (const [sql, param] of [[SENT_NO_RECEIPT_SQL, 4], [BLOCKED_SQL, 3], [NO_ADDRESS_SQL, 3]]) {
    assert.equal(maxParam(sql), param);
    assert.match(sql, /COALESCE\(m\.is_demo, false\) = false/);
    const notExists = sql.match(/AND NOT EXISTS \(\s*SELECT 1 FROM clients d\s+WHERE d\.id = m\.client_id\s+AND \(([\s\S]*?)\)\s*\)/);
    assert.ok(notExists, "the client filter is gone");
    const parts = notExists[1].replace(/\s+/g, " ").trim();
    assert.equal(
      parts,
      `COALESCE(d.is_demo, false) = true OR COALESCE(d.custom_fields ->> 'synthetic', '') = 'true' OR COALESCE(d.email, '') ~* $${param}::text`
    );
    assert.match(sql, new RegExp(`AND COALESCE\\(m\\.to_address, ''\\) !~\\* \\$${param}::text`));
  }
  assert.match(REPLY_SQL, /COALESCE\(e\.is_demo, false\) = false/);
});

test("gap msg: the test-address pattern matches the test runners' addresses and no customer's", () => {
  // Written for Postgres (~*) but built only from pieces JavaScript reads the same way, so one set of
  // samples holds it. The first three parts are the shared test-client pattern; a drift test holds them.
  assert.ok(TEST_ADDRESS_RE.startsWith(CONSENT_TEST_RE), "this lane adds to the shared pattern, it does not replace it");
  const re = new RegExp(TEST_ADDRESS_RE, "i");
  const test = [
    "e2e+slo-walk-ab12cd@fundhub.ai",
    "e2e+authrep-ab12cd-ada@fundhub.ai",
    "e2e+apply-dual-ab12cd@fundhub.ai",
    "stanbridgejchris+sim-11@gmail.com",
    "someone+walk-3@gmail.com",
    "cfextract+ab12cd@example.com",
    "test.walker+x@example.com",
    "a@example.net",
    "a@example.org",
    "aud-1@example.test",
    "x@host.invalid",
    "x@box.localhost",
    "x@box.local",
    "demo+lead@fundhub.ai",
    "test+crs@fundhub.ai",
    "E2E+Upper@Fundhub.ai"
  ];
  const real = [
    "elliotinsurancesales@gmail.com",
    "dennis@thedrinklabs.com",
    "steven@neuralytica.ai",
    "pat@fundhub.ai",
    "stanbridgejchris@gmail.com",
    "tester@gmail.com",
    "a@example.com.au",
    "attest+promo@gmail.com",
    "+15551234567",
    "",
    "demo@gmail.com"
  ];
  for (const a of test) assert.ok(re.test(a), `${a} should read as a test address`);
  for (const a of real) assert.ok(!re.test(a), `${JSON.stringify(a)} must not read as a test address`);
});

test("gap msg: each message read hands TEST_ADDRESS_RE to the database as its last parameter", async () => {
  const { db } = await runMsg();
  const read = (marker) => db.seen.find((q) => q.sql.includes(marker));
  for (const marker of [IS_RECEIPT, IS_BLOCKED, IS_ADDRESS]) {
    const q = read(marker);
    assert.equal(q.params[q.params.length - 1], TEST_ADDRESS_RE, marker);
    assert.equal(q.params.length, maxParam(q.sql), marker);
  }
});

test("gap msg: no database or no company is eight skips and the five message reads never run", async () => {
  const noDb = await gapChecks({});
  shape(noDb);
  assert.ok(msgRows(noDb).every((r) => r.status === "skip" && /No database/.test(r.detail)));
  let called = 0;
  const noOrg = await gapChecks({ db: { query: async () => { called += 1; return { rows: [] }; } }, orgId: "" });
  shape(noOrg);
  assert.ok(msgRows(noOrg).every((r) => r.status === "skip" && /No company/.test(r.detail)));
  assert.equal(called, 0);
});

test("gap msg: all clear is eight PASS, and the five reads take the cutoffs from now", async () => {
  const { rows, db } = await runMsg();
  assert.ok(rows.every((r) => r.status === "PASS"), JSON.stringify(rows));
  const read = (marker) => db.seen.find((q) => q.sql.includes(marker));
  assert.deepEqual(read(IS_RECEIPT).params, [ORG, "2026-10-08T12:00:00.000Z", "2026-09-09T12:00:00.000Z", TEST_ADDRESS_RE]);
  assert.deepEqual(read(IS_COPY).params, [ORG]);
  assert.deepEqual(read(IS_BLOCKED).params, [ORG, "2026-09-25T12:00:00.000Z", TEST_ADDRESS_RE]);
  assert.deepEqual(read(IS_REPLY).params, [ORG, "2026-10-02T12:00:00.000Z", "2026-10-09T11:45:00.000Z"]);
  assert.deepEqual(read(IS_ADDRESS).params, [ORG, "2026-10-02T12:00:00.000Z", TEST_ADDRESS_RE]);
});

test("gap msg: all five bad is five FAIL, each with a plain fix", async () => {
  const { rows, byId } = await runMsg({
    receipt: () => ({ rows: [{ channel: "email", n: 1, oldest: "2026-09-21T23:10:04.837Z" }] }),
    copy: () => ({ rows: [{ channel: "email", template_key: "T1", lorem: true, draft: false }] }),
    blocked: () => ({ rows: [{ reason: "recipient_unknown", template_key: "AF1", n: 1 }] }),
    reply: () => ({ rows: [{ ...REPLY_CLEAR, real_n: 1, lost_n: 1 }] }),
    address: () => ({ rows: [{ channel: "sms", template_key: "SMS-S00-WELCOME", n: 1 }] })
  });
  assert.ok(rows.every((r) => r.status === "FAIL"), JSON.stringify(rows));
  assert.equal(Object.keys(byId).length, 5);
});

test("gap msg: sent with no receipt — PASS when none, FAIL with the count, channel mix and age", async () => {
  const pass = await runMsg();
  assert.equal(pass.byId[ID.receipt].status, "PASS");
  assert.match(pass.byId[ID.receipt].detail, /24 hours/);

  const fail = await runMsg({
    receipt: () => ({
      rows: [
        { channel: "email", n: 6, oldest: "2026-09-21T23:10:04.837Z" },
        { channel: "sms", n: 1, oldest: "2026-09-30T04:40:03.049Z" }
      ]
    })
  });
  const r = fail.byId[ID.receipt];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^7 messages \(6 emails, 1 text\)/);
  assert.match(r.detail, /oldest left us 17 days ago/);
  assert.match(r.suggestedFix, /delivery receipt/);
});

test("gap msg: sent with no receipt — one message is singular, and a recent age is in hours", async () => {
  const { byId } = await runMsg({
    receipt: () => ({ rows: [{ channel: "sms", n: 1, oldest: "2026-10-08T05:00:00.000Z" }] })
  });
  assert.match(byId[ID.receipt].detail, /^1 message \(1 text\)/);
  assert.match(byId[ID.receipt].detail, /31 hours ago/); // 2026-10-08 05:00 to 2026-10-09 12:00
});

test("gap msg: sent with no receipt — text and email only, over 24 hours, not test traffic", () => {
  assert.match(SENT_NO_RECEIPT_SQL, /m\.status = 'sent'/);
  assert.match(SENT_NO_RECEIPT_SQL, /m\.channel IN \('sms', 'email'\)/);
  assert.match(SENT_NO_RECEIPT_SQL, /COALESCE\(m\.last_attempt_at, m\.created_at\) < \$2::timestamptz/);
  assert.match(SENT_NO_RECEIPT_SQL, /COALESCE\(m\.last_attempt_at, m\.created_at\) >= \$3::timestamptz/);
  assert.match(SENT_NO_RECEIPT_SQL, /m\.direction = 'outbound'/);
  assert.doesNotMatch(SENT_NO_RECEIPT_SQL, /voice|whatsapp/i);
});

test("gap msg: ready template with placeholder words — PASS when none, FAIL names them", async () => {
  const pass = await runMsg();
  assert.equal(pass.byId[ID.copy].status, "PASS");

  const rows = [];
  for (let i = 1; i <= 14; i += 1) rows.push({ channel: "email", template_key: `BS-REPAIR-${i}`, lorem: true, draft: false });
  rows.push({ channel: "email", template_key: "S-02", lorem: false, draft: true });
  const fail = await runMsg({ copy: () => ({ rows }) });
  const r = fail.byId[ID.copy];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^15 templates are marked ready but still hold placeholder words/);
  assert.match(r.detail, /\(14 lorem ipsum, 1 draft mark\)/);
  assert.match(r.detail, /First: BS-REPAIR-1, BS-REPAIR-2, BS-REPAIR-3, BS-REPAIR-4, BS-REPAIR-5 and 10 more\./);
  assert.match(r.suggestedFix, /not approved/);
});

test("gap msg: ready template — one bad template is singular, and an unflagged row is a skip", async () => {
  const one = await runMsg({ copy: () => ({ rows: [{ channel: "sms", template_key: "SMS-X", lorem: false, draft: true }] }) });
  assert.match(one.byId[ID.copy].detail, /^1 template is marked ready but still holds placeholder words \(1 draft mark\)/);
  const odd = await runMsg({ copy: () => ({ rows: [{ template_key: "SMS-X" }] }) });
  assert.equal(odd.byId[ID.copy].status, "skip");
});

test("gap msg: ready template — only approved templates, body or subject, text and email", () => {
  assert.match(BAD_COPY_SQL, /FROM message_templates t/);
  assert.match(BAD_COPY_SQL, /t\.compliance_passed = true/);
  assert.match(BAD_COPY_SQL, /COALESCE\(t\.body, ''\) ~\* 'lorem\\s\+ipsum'/);
  assert.match(BAD_COPY_SQL, /COALESCE\(t\.subject, ''\) ~\* 'lorem\\s\+ipsum'/);
  assert.match(BAD_COPY_SQL, /COALESCE\(t\.body, ''\) ~\* '\\\[DRAFT\\y'/);
  assert.match(BAD_COPY_SQL, /COALESCE\(t\.subject, ''\) ~\* '\\\[DRAFT\\y'/);
  assert.doesNotMatch(BAD_COPY_SQL, /t\.channel\s*=/);
});

test("gap msg: the copy patterns are the sender's own guard, word for word", () => {
  const dispatch = fs.readFileSync(path.join(HERE, "..", "..", "messaging", "dispatch.mjs"), "utf8");
  assert.ok(dispatch.includes("/lorem\\s+ipsum/i"), "dispatch.mjs no longer uses /lorem\\s+ipsum/i");
  assert.equal(DRAFT_RE.source, "\\[DRAFT\\b");
  assert.equal(DRAFT_RE.flags, "i");
  // Postgres spells a word edge \y. Turn the SQL pattern back into JavaScript and hold it to the
  // same answers as the sender's guard, so the two cannot quietly drift apart.
  const fromSql = (p) => new RegExp(p.replace(/\\y/g, "\\b"), "i");
  const lorem = fromSql("lorem\\s+ipsum");
  const draft = fromSql("\\[DRAFT\\y");
  const samples = [
    ["Lorem   Ipsum dolor sit amet", true, false],
    ["dolor sit amet, consectetur", false, false],
    ["[DRAFT — KILLED] S-02 retired", false, true],
    ["[draft] hello", false, true],
    ["a DRAFT note, no bracket", false, false],
    ["[DRAFTED] is not the marker", false, false],
    ["Hi there", false, false]
  ];
  for (const [text, isLorem, isDraft] of samples) {
    assert.equal(lorem.test(text), isLorem, `lorem on ${JSON.stringify(text)}`);
    assert.equal(draft.test(text), isDraft, `draft on ${JSON.stringify(text)}`);
    assert.equal(DRAFT_RE.test(text), isDraft, `sender draft guard on ${JSON.stringify(text)}`);
  }
});

test("gap msg: our own gate stopped a customer message — PASS when none, FAIL counts why and which", async () => {
  const pass = await runMsg();
  assert.equal(pass.byId[ID.blocked].status, "PASS");
  assert.match(pass.byId[ID.blocked].detail, /14 days/);

  const fail = await runMsg({
    blocked: () => ({
      rows: [
        { reason: "recipient_unknown", template_key: "CONTRACT-SEND-EMAIL", n: 4 },
        { reason: "recipient_unknown", template_key: "AF1", n: 1 },
        { reason: "placeholder_copy", template_key: "AF1", n: 2 }
      ]
    })
  });
  const r = fail.byId[ID.blocked];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^7 customer messages were stopped by our own gate in the last 14 days\./);
  assert.match(r.detail, /Why: recipient_unknown x5, placeholder_copy x2\./);
  assert.match(r.detail, /Which: CONTRACT-SEND-EMAIL x4, AF1 x3\./);
  assert.match(r.suggestedFix, /recipient_unknown/);
  assert.match(r.suggestedFix, /placeholder_copy/);

  const one = await runMsg({ blocked: () => ({ rows: [{ reason: "x", template_key: "T", n: 1 }] }) });
  assert.match(one.byId[ID.blocked].detail, /^1 customer message was stopped/);
});

test("gap msg: our own gate — a STOP and a test address are the system working, so they stay out", () => {
  assert.match(BLOCKED_SQL, /m\.status = 'blocked'/);
  assert.match(BLOCKED_SQL, /COALESCE\(m\.blocked_reason, ''\) <> 'opted_out'/);
  assert.match(BLOCKED_SQL, /COALESCE\(m\.last_error, ''\) NOT ILIKE 'test address:%'/);
  // The copy guards write their reason to last_error (dispatch.mjs); the gate writes blocked_reason.
  assert.match(BLOCKED_SQL, /NULLIF\(btrim\(m\.blocked_reason\), ''\), NULLIF\(btrim\(m\.last_error\), ''\)/);
  // Nothing else is dropped: no other reason is excluded.
  assert.equal([...BLOCKED_SQL.matchAll(/<> '|NOT ILIKE '/g)].length, 2);
  const dispatch = fs.readFileSync(path.join(HERE, "..", "..", "messaging", "dispatch.mjs"), "utf8");
  assert.ok(dispatch.includes('"draft_template"') && dispatch.includes('"placeholder_copy"'));
  assert.ok(dispatch.includes("OUTCOME.TEST_ADDRESS, refused"));
  const resend = fs.readFileSync(path.join(HERE, "..", "..", "messaging", "providers", "resend.mjs"), "utf8");
  assert.ok(resend.includes("`test address: "), "the test address refusal no longer starts with 'test address: '");
  const gate = fs.readFileSync(path.join(HERE, "..", "..", "messaging", "gate.mjs"), "utf8");
  assert.ok(gate.includes('r("opted_out"') && gate.includes('r("recipient_unknown"'));
});

test("gap msg: customer replies — PASS with no real replies, and our own lines are told apart", async () => {
  const none = await runMsg({ reply: () => ({ rows: [{ ...REPLY_CLEAR, own_n: 280 }] }) });
  const r = none.byId[ID.reply];
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /^0 customer reply texts in the last 7 days\./);
  assert.match(r.detail, /Too few to judge/);
  assert.match(r.detail, /280 texts from our own lines left out\./);

  const good = await runMsg({ reply: () => ({ rows: [{ own_n: 0, real_n: 5, saved_n: 5, lost_n: 0, unlinked_n: 1, matchable_n: 0 }] }) });
  assert.equal(good.byId[ID.reply].status, "PASS");
  assert.doesNotMatch(good.byId[ID.reply].detail, /Too few/);
});

test("gap msg: customer replies — a lost reply is FAIL", async () => {
  const { byId } = await runMsg({ reply: () => ({ rows: [{ ...REPLY_CLEAR, real_n: 1, lost_n: 2 }] }) });
  const r = byId[ID.reply];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 customer texts reached our door and no message was saved \(older than 15 minutes\)/);
  assert.match(r.suggestedFix, /handler did not run/);
});

test("gap msg: customer replies — a text from a saved client's own number with no client is FAIL", async () => {
  const { byId } = await runMsg({
    reply: () => ({ rows: [{ own_n: 0, real_n: 1, saved_n: 1, lost_n: 0, unlinked_n: 1, matchable_n: 1 }] })
  });
  const r = byId[ID.reply];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /1 text came from a saved client's phone number but was saved with no client attached/);
  assert.match(r.suggestedFix, /STOP may not have stuck/);
});

test("gap msg: customer replies — over half unlinked is FAIL, half or less is PASS, too few is PASS", async () => {
  const run = (saved, unlinked) => runMsg({
    reply: () => ({ rows: [{ own_n: 0, real_n: saved, saved_n: saved, lost_n: 0, unlinked_n: unlinked, matchable_n: 0 }] })
  });
  const over = await run(4, 3);
  assert.equal(over.byId[ID.reply].status, "FAIL");
  assert.match(over.byId[ID.reply].detail, /3 of 4 saved customer replies have no person attached/);
  assert.equal((await run(4, 2)).byId[ID.reply].status, "PASS");
  assert.equal((await run(3, 2)).byId[ID.reply].status, "FAIL");
  assert.equal((await run(2, 2)).byId[ID.reply].status, "PASS");
});

test("gap msg: customer replies — an unreadable count is a skip, never a PASS", async () => {
  const blank = await runMsg({ reply: () => ({ rows: [{}] }) });
  assert.equal(blank.byId[ID.reply].status, "skip");
  const none = await runMsg({ reply: () => ({ rows: [] }) });
  assert.equal(none.byId[ID.reply].status, "skip");
  const half = await runMsg({ reply: () => ({ rows: [{ ...REPLY_CLEAR, lost_n: null }] }) });
  assert.equal(half.byId[ID.reply].status, "skip");
});

test("gap msg: customer replies — the read starts from the door, leaves out our own lines, and keeps the rules", () => {
  assert.match(REPLY_SQL, /e\.name = 'message\.inbound'/);
  assert.match(REPLY_SQL, /COALESCE\(e\.payload->>'channel', 'sms'\) = 'sms'/);
  // The saved message is found by the sid, the same value the handler stores as provider_ref.
  assert.match(REPLY_SQL, /mm\.provider_ref = d\.sid/);
  assert.match(REPLY_SQL, /mm\.direction = 'inbound'/);
  // Our own lines: any number that has ever been the "to" of an inbound event.
  assert.match(REPLY_SQL, /SELECT right\(regexp_replace\(ev\.payload->>'to', '\[\^0-9\]', '', 'g'\), 10\)/);
  assert.match(REPLY_SQL, /count\(\*\) FILTER \(WHERE NOT r\.own\)::int AS real_n/);
  // Lost needs a sid, no saved row, and a reply older than the grace time ($3).
  assert.match(REPLY_SQL, /r\.sid IS NOT NULL AND r\.msg_id IS NULL\s+AND r\.created_at < \$3::timestamptz/);
  // Matchable: ten digit match on the saved client phone, and the client had to exist before the text.
  assert.match(REPLY_SQL, /= r\.from10/);
  assert.match(REPLY_SQL, /c\.created_at <= r\.created_at/);
  assert.match(REPLY_SQL, /length\(r\.from10\) = 10/);
  // The same last-ten-digits idea as the handler's own phone match (src/handlers/comms.mjs).
  const comms = fs.readFileSync(path.join(HERE, "..", "..", "handlers", "comms.mjs"), "utf8");
  assert.ok(comms.includes("provider_ref") && comms.includes("regexp_replace(phone, '[^0-9]', '', 'g')"));
  assert.ok(comms.includes("p.sid || null"), "the handler no longer stores the sid as provider_ref");
});

test("gap msg: failed with nowhere to send — PASS when none, FAIL names the template and channel", async () => {
  const pass = await runMsg();
  assert.equal(pass.byId[ID.address].status, "PASS");

  const fail = await runMsg({
    address: () => ({
      rows: [
        { channel: "sms", template_key: "SMS-S00-WELCOME", n: 2 },
        { channel: "email", template_key: "EMAIL-S00-WELCOME", n: 1 }
      ]
    })
  });
  const r = fail.byId[ID.address];
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^3 messages failed in the last 7 days because the client had no phone or email to send to:/);
  assert.match(r.detail, /SMS-S00-WELCOME \(text\) x2, EMAIL-S00-WELCOME \(email\) x1/);
  assert.match(r.suggestedFix, /phone or email/);
});

test("gap msg: failed with nowhere to send is the other half of the two failure checks", () => {
  // The sms and email failure checks drop '%to send to%' on purpose. This one picks up exactly that.
  assert.match(NO_ADDRESS_SQL, /COALESCE\(m\.last_error, ''\) ILIKE '%to send to%'/);
  assert.doesNotMatch(NO_ADDRESS_SQL, /NOT ILIKE/);
  assert.match(NO_ADDRESS_SQL, /m\.status = 'failed'/);
  assert.match(SRC, /AND COALESCE\(last_error, ''\) NOT ILIKE '%to send to%'/); // the sms failure read
  const email = fs.readFileSync(path.join(HERE, "gap-email.mjs"), "utf8");
  assert.ok(email.includes("NOT ILIKE '%to send to%'"), "gap-email.mjs no longer drops the no-address line");
  const dispatch = fs.readFileSync(path.join(HERE, "..", "..", "messaging", "dispatch.mjs"), "utf8");
  assert.ok(dispatch.includes("to send to`"), "dispatch.mjs no longer writes the no-address line");
  assert.ok(dispatch.includes("OUTCOME.NO_ADDRESS"));
});

test("gap msg: one failed read skips that check only, with the reason, and never reads as PASS", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes(IS_COPY)) throw new Error("permission denied for table message_templates");
    if (sql.includes(IS_RECEIPT)) return { rows: [{ channel: "email", n: 2, oldest: "2026-09-21T23:10:04.837Z" }] };
    if (sql.includes(IS_REPLY)) return { rows: [REPLY_CLEAR] };
    if (sql.includes(IS_BLOCKED) || sql.includes(IS_ADDRESS)) return { rows: [] };
    return { rows: [SMS_CLEAR] };
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  shape(rows);
  const byId = Object.fromEntries(msgRows(rows).map((r) => [r.id, r]));
  assert.equal(byId[ID.copy].status, "skip");
  assert.match(byId[ID.copy].detail, /permission denied/);
  assert.equal(byId[ID.receipt].status, "FAIL");
  assert.equal(byId[ID.blocked].status, "PASS");
  assert.equal(byId[ID.address].status, "PASS");
});

test("gap msg: a list that does not come back, or counts that are not numbers, are skips", async () => {
  const noList = await runMsg({
    receipt: () => ({ rows: null }),
    blocked: () => ({ rows: null }),
    address: () => ({ rows: null }),
    copy: () => ({ rows: null })
  });
  for (const id of [ID.receipt, ID.blocked, ID.address, ID.copy]) assert.equal(noList.byId[id].status, "skip", id);
  const junk = await runMsg({
    receipt: () => ({ rows: [{ channel: "email", n: "lots" }] }),
    blocked: () => ({ rows: [{ reason: "x", template_key: "T", n: null }] }),
    address: () => ({ rows: [{ channel: "sms", template_key: "T", n: undefined }] })
  });
  for (const id of [ID.receipt, ID.blocked, ID.address]) assert.equal(junk.byId[id].status, "skip", id);
});

test("gap msg: the lane reads only, and says nothing that sends", () => {
  const tier1 = SRC.slice(SRC.indexOf("Tier 1 — the message queue"));
  assert.doesNotMatch(tier1, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(tier1, /\bfetch\(|\.post\(|sendTemplated|queueEmail|queueSms/);
  assert.doesNotMatch(tier1, /outbound switch|outbound_enabled|messaging_settings/i);
});

test("gap msg: each of the five reads, when it throws, is a skip with the reason and never a PASS", async () => {
  const marks = [
    [IS_RECEIPT, ID.receipt],
    [IS_COPY, ID.copy],
    [IS_BLOCKED, ID.blocked],
    [IS_REPLY, ID.reply],
    [IS_ADDRESS, ID.address]
  ];
  for (const [marker, id] of marks) {
    const db = fakeDb((sql) => {
      if (sql.includes(marker)) throw new Error(`connection reset on ${id}`);
      return { rows: [SMS_CLEAR] };
    });
    const rows = await gapChecks({ db, orgId: ORG, now: NOW });
    shape(rows);
    const hit = msgRows(rows).find((r) => r.id === id);
    assert.equal(hit.status, "skip", id);
    assert.match(hit.detail, new RegExp(`Message read failed: connection reset on ${id.replace(/[-:]/g, "\\$&")}`));
    // Every other message read still answered (a clear row or a skip), and none of them borrowed the error.
    for (const other of msgRows(rows).filter((r) => r.id !== id)) {
      assert.doesNotMatch(other.detail, /connection reset/, `${other.id} borrowed the error`);
    }
  }
});

// ---------------------------------------------------------------------------
// The SQL, clause by clause. There is no database in this suite, so these read the text of each read
// and hold every condition that matters. Added after an independent check broke the SQL 33 ways and 9
// got through: the own-line filter on four counts, the company filter on clients, the outbound filter
// on two reads, the subject test inside the bad-copy WHERE, and the row caps. Each test below fails
// when one of those lines is removed.
// ---------------------------------------------------------------------------

const squash = (text) => text.replace(/\s+/g, " ").trim();

// Every count in the reply read, by its name: { own_n: "r.own", real_n: "NOT r.own", ... }.
function replyCounts() {
  const out = {};
  for (const m of REPLY_SQL.matchAll(/count\(\*\) FILTER \(WHERE ([\s\S]*?)\)::int AS (\w+)/g)) out[m[2]] = squash(m[1]);
  return out;
}

test("gap msg: customer replies — every count except the 'own' count leaves out our own lines", () => {
  const counts = replyCounts();
  assert.deepEqual(Object.keys(counts), ["own_n", "real_n", "saved_n", "lost_n", "unlinked_n", "matchable_n"]);
  assert.equal(counts.own_n, "r.own");
  assert.equal(counts.real_n, "NOT r.own");
  for (const name of ["saved_n", "lost_n", "unlinked_n", "matchable_n"]) {
    assert.ok(counts[name].startsWith("NOT r.own AND "), `${name} no longer leaves out our own lines`);
  }
});

test("gap msg: customer replies — saved, lost, unlinked and matchable each keep their full rule", () => {
  const counts = replyCounts();
  assert.equal(counts.saved_n, "NOT r.own AND r.msg_id IS NOT NULL");
  assert.equal(
    counts.lost_n,
    "NOT r.own AND r.sid IS NOT NULL AND r.msg_id IS NULL AND r.created_at < $3::timestamptz"
  );
  assert.equal(counts.unlinked_n, "NOT r.own AND r.msg_id IS NOT NULL AND r.client_id IS NULL");
  const matchable = counts.matchable_n;
  assert.ok(
    matchable.startsWith("NOT r.own AND r.msg_id IS NOT NULL AND r.client_id IS NULL AND length(r.from10) = 10 AND EXISTS ("),
    matchable
  );
  assert.ok(matchable.includes("FROM clients c WHERE c.org_id = $1::uuid AND "), "matchable lost its company filter on clients");
  assert.ok(matchable.includes("= r.from10 AND c.created_at <= r.created_at"), matchable);
});

test("gap msg: customer replies — every table in the read is held to the one company", () => {
  // The own-line list is built from events too: without the company filter another company's numbers
  // would be read as ours.
  for (const alias of ["e", "ev", "mm", "c"]) {
    assert.match(REPLY_SQL, new RegExp(`\\b${alias}\\.org_id = \\$1::uuid`), `${alias} is not held to the company`);
  }
  assert.match(REPLY_SQL, /ev\.name = 'message\.inbound'/);
  assert.match(REPLY_SQL, /COALESCE\(ev\.payload->>'to', ''\) <> ''/);
  assert.match(REPLY_SQL, /e\.created_at >= \$2::timestamptz/);
});

test("gap msg: the blocked, no-address and receipt reads are outbound only, and their rows are the right status", () => {
  for (const [sql, status] of [[SENT_NO_RECEIPT_SQL, "sent"], [BLOCKED_SQL, "blocked"], [NO_ADDRESS_SQL, "failed"]]) {
    assert.match(sql, /m\.direction = 'outbound'/, `${status} read lost the outbound filter`);
    assert.match(sql, new RegExp(`m\\.status = '${status}'`));
  }
});

test("gap msg: ready template — the WHERE holds all four tests, not just the select list", () => {
  const [select, where] = BAD_COPY_SQL.split(/\n\s*WHERE /);
  assert.ok(where, "no WHERE");
  const cond = squash(where);
  assert.ok(cond.startsWith("t.org_id = $1::uuid AND t.compliance_passed = true AND ("), cond);
  for (const col of ["body", "subject"]) {
    assert.ok(cond.includes(`COALESCE(t.${col}, '') ~* 'lorem\\s+ipsum'`), `WHERE lost the ${col} lorem test`);
    assert.ok(cond.includes(`COALESCE(t.${col}, '') ~* '\\[DRAFT\\y'`), `WHERE lost the ${col} draft test`);
  }
  // the same four tests are joined by OR, so any one of them flags the template
  assert.equal([...cond.matchAll(/ OR /g)].length >= 3, true);
  assert.ok(select.includes("AS lorem") && select.includes("AS draft"));
});

test("gap msg: the lists that print are capped, so one bad night cannot grow the row without limit", () => {
  assert.match(BAD_COPY_SQL, /ORDER BY t\.template_key\s+LIMIT 100$/);
  assert.match(BLOCKED_SQL, /ORDER BY n DESC, 1, 2\s+LIMIT 50$/);
  assert.match(NO_ADDRESS_SQL, /ORDER BY n DESC, 1, 2\s+LIMIT 50$/);
});

test("gap msg: blocked and no-address keep their time window and company on the message", () => {
  assert.match(BLOCKED_SQL, /m\.org_id = \$1::uuid/);
  assert.match(BLOCKED_SQL, /m\.created_at >= \$2::timestamptz/);
  assert.match(NO_ADDRESS_SQL, /m\.org_id = \$1::uuid/);
  assert.match(NO_ADDRESS_SQL, /COALESCE\(m\.last_attempt_at, m\.updated_at, m\.created_at\) >= \$2::timestamptz/);
  assert.match(SENT_NO_RECEIPT_SQL, /m\.org_id = \$1::uuid/);
});

// ---------------------------------------------------------------------------
// The five reads, word for word. There is no database in this suite, so a changed word in the SQL
// (an AND turned OR, a < turned >, a dropped filter, a number moved) cannot be seen by running it.
// These are the exact texts that were run read-only against production on 2026-10-09 in the red-path
// proof (see ops/workflows/heartbeat-gaps-2026-10-08/sms.md). White space is ignored; every word counts.
// To change a read on purpose: change the SQL, re-run the red-path proof, then update the text here.
// ---------------------------------------------------------------------------

const GOLDEN = {
  SENT_NO_RECEIPT_SQL: String.raw`
SELECT m.channel,
       count(*)::int AS n,
       min(COALESCE(m.last_attempt_at, m.created_at)) AS oldest
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.status = 'sent'
   AND m.channel IN ('sms', 'email')
   AND COALESCE(m.last_attempt_at, m.created_at) < $2::timestamptz
   AND COALESCE(m.last_attempt_at, m.created_at) >= $3::timestamptz
   AND COALESCE(m.is_demo, false) = false
   AND NOT EXISTS (
     SELECT 1 FROM clients d
      WHERE d.id = m.client_id
        AND (COALESCE(d.is_demo, false) = true
          OR COALESCE(d.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(d.email, '') ~* $4::text)
   )
   AND COALESCE(m.to_address, '') !~* $4::text
 GROUP BY m.channel
 ORDER BY m.channel`,
  BAD_COPY_SQL: String.raw`
SELECT t.channel,
       t.template_key,
       (COALESCE(t.body, '') ~* 'lorem\s+ipsum' OR COALESCE(t.subject, '') ~* 'lorem\s+ipsum') AS lorem,
       (COALESCE(t.body, '') ~* '\[DRAFT\y' OR COALESCE(t.subject, '') ~* '\[DRAFT\y') AS draft
  FROM message_templates t
 WHERE t.org_id = $1::uuid
   AND t.compliance_passed = true
   AND (
        COALESCE(t.body, '') ~* 'lorem\s+ipsum' OR COALESCE(t.subject, '') ~* 'lorem\s+ipsum'
     OR COALESCE(t.body, '') ~* '\[DRAFT\y' OR COALESCE(t.subject, '') ~* '\[DRAFT\y'
   )
 ORDER BY t.template_key
 LIMIT 100`,
  BLOCKED_SQL: String.raw`
SELECT COALESCE(NULLIF(btrim(m.blocked_reason), ''), NULLIF(btrim(m.last_error), ''), 'no reason saved') AS reason,
       COALESCE(m.template_key, '(no template)') AS template_key,
       count(*)::int AS n
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.status = 'blocked'
   AND m.created_at >= $2::timestamptz
   AND COALESCE(m.blocked_reason, '') <> 'opted_out'
   AND COALESCE(m.last_error, '') NOT ILIKE 'test address:%'
   AND COALESCE(m.is_demo, false) = false
   AND NOT EXISTS (
     SELECT 1 FROM clients d
      WHERE d.id = m.client_id
        AND (COALESCE(d.is_demo, false) = true
          OR COALESCE(d.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(d.email, '') ~* $3::text)
   )
   AND COALESCE(m.to_address, '') !~* $3::text
 GROUP BY 1, 2
 ORDER BY n DESC, 1, 2
 LIMIT 50`,
  REPLY_SQL: String.raw`
SELECT count(*) FILTER (WHERE r.own)::int AS own_n,
       count(*) FILTER (WHERE NOT r.own)::int AS real_n,
       count(*) FILTER (WHERE NOT r.own AND r.msg_id IS NOT NULL)::int AS saved_n,
       count(*) FILTER (WHERE NOT r.own AND r.sid IS NOT NULL AND r.msg_id IS NULL
                          AND r.created_at < $3::timestamptz)::int AS lost_n,
       count(*) FILTER (WHERE NOT r.own AND r.msg_id IS NOT NULL AND r.client_id IS NULL)::int AS unlinked_n,
       count(*) FILTER (WHERE NOT r.own AND r.msg_id IS NOT NULL AND r.client_id IS NULL
                          AND length(r.from10) = 10
                          AND EXISTS (
                            SELECT 1 FROM clients c
                             WHERE c.org_id = $1::uuid
                               AND right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = r.from10
                               AND c.created_at <= r.created_at
                          ))::int AS matchable_n
  FROM (
    SELECT d.sid, d.from10, d.created_at, m.id AS msg_id, m.client_id,
           (d.from10 <> '' AND d.from10 IN (
              SELECT right(regexp_replace(ev.payload->>'to', '[^0-9]', '', 'g'), 10)
                FROM events ev
               WHERE ev.org_id = $1::uuid
                 AND ev.name = 'message.inbound'
                 AND COALESCE(ev.payload->>'to', '') <> ''
           )) AS own
      FROM (
        SELECT e.created_at,
               e.payload->>'sid' AS sid,
               right(regexp_replace(COALESCE(e.payload->>'from', ''), '[^0-9]', '', 'g'), 10) AS from10
          FROM events e
         WHERE e.org_id = $1::uuid
           AND e.name = 'message.inbound'
           AND e.created_at >= $2::timestamptz
           AND COALESCE(e.is_demo, false) = false
           AND COALESCE(e.payload->>'channel', 'sms') = 'sms'
      ) d
      LEFT JOIN LATERAL (
        SELECT mm.id, mm.client_id
          FROM messages mm
         WHERE mm.org_id = $1::uuid
           AND mm.direction = 'inbound'
           AND d.sid IS NOT NULL
           AND mm.provider_ref = d.sid
         LIMIT 1
      ) m ON true
  ) r`,
  NO_ADDRESS_SQL: String.raw`
SELECT m.channel,
       COALESCE(m.template_key, '(no template)') AS template_key,
       count(*)::int AS n
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.status = 'failed'
   AND COALESCE(m.last_attempt_at, m.updated_at, m.created_at) >= $2::timestamptz
   AND COALESCE(m.last_error, '') ILIKE '%to send to%'
   AND COALESCE(m.is_demo, false) = false
   AND NOT EXISTS (
     SELECT 1 FROM clients d
      WHERE d.id = m.client_id
        AND (COALESCE(d.is_demo, false) = true
          OR COALESCE(d.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(d.email, '') ~* $3::text)
   )
   AND COALESCE(m.to_address, '') !~* $3::text
 GROUP BY 1, 2
 ORDER BY n DESC, 1, 2
 LIMIT 50`
};

test("gap msg: each of the five reads is word for word the text that was proved against production", () => {
  const actual = {
    SENT_NO_RECEIPT_SQL,
    BAD_COPY_SQL,
    BLOCKED_SQL,
    REPLY_SQL,
    NO_ADDRESS_SQL
  };
  assert.deepEqual(Object.keys(actual), Object.keys(GOLDEN));
  for (const name of Object.keys(GOLDEN)) {
    assert.equal(squash(actual[name]), squash(GOLDEN[name]), `${name} changed. Re-run the red-path proof, then update GOLDEN.`);
  }
});

// ---------------------------------------------------------------------------
// The words around the numbers: ages, cut-offs, caps and ties. Each of these fails when its line is
// changed (found by breaking the lane one line at a time and listing what the tests let through).
// ---------------------------------------------------------------------------

const AGO = (ms) => new Date(NOW.getTime() - ms).toISOString();

test("gap msg: how old is the oldest — the day and hour edges are exact", async () => {
  const age = async (ms) => {
    const { byId } = await runMsg({ receipt: () => ({ rows: [{ channel: "email", n: 1, oldest: AGO(ms) }] }) });
    return byId[ID.receipt].detail.match(/oldest left us (.+?) ago/)[1];
  };
  assert.equal(await age(172800000), "2 days");
  assert.equal(await age(172799999), "47 hours");
  assert.equal(await age(3600000), "1 hour");
  assert.equal(await age(3599999), "0 hours");
  assert.equal(await age(7200000), "2 hours");
  assert.equal(await age(-18000000), "0 hours"); // a time in the future is never a negative age
});

test("gap msg: a zero-count row never adds a piece to the text", async () => {
  const receipt = await runMsg({
    receipt: () => ({ rows: [
      { channel: "email", n: 0, oldest: AGO(172800000) },
      { channel: "sms", n: 1, oldest: AGO(172800000) }
    ] })
  });
  assert.match(receipt.byId[ID.receipt].detail, /^1 message \(1 text\) went out/);
  const address = await runMsg({
    address: () => ({ rows: [
      { channel: "sms", template_key: "ZERO-ROW", n: 0 },
      { channel: "sms", template_key: "REAL-ROW", n: 2 }
    ] })
  });
  assert.match(address.byId[ID.address].detail, /^2 messages failed/);
  assert.match(address.byId[ID.address].detail, /REAL-ROW \(text\) x2\./);
  assert.doesNotMatch(address.byId[ID.address].detail, /ZERO-ROW/);
});

test("gap msg: long names are cut at 60 characters with a dot-dot-dot, in all three lists", async () => {
  const long = "k".repeat(70);
  const cut = `${"k".repeat(59)}…`;
  const blocked = await runMsg({ blocked: () => ({ rows: [{ reason: "r".repeat(70), template_key: long, n: 1 }] }) });
  assert.ok(blocked.byId[ID.blocked].detail.includes(`Why: ${"r".repeat(59)}… x1.`), blocked.byId[ID.blocked].detail);
  assert.ok(blocked.byId[ID.blocked].detail.includes(`Which: ${cut} x1.`));
  const copy = await runMsg({ copy: () => ({ rows: [{ channel: "email", template_key: long, lorem: true, draft: false }] }) });
  assert.ok(copy.byId[ID.copy].detail.includes(`First: ${cut}.`), copy.byId[ID.copy].detail);
  const address = await runMsg({ address: () => ({ rows: [{ channel: "email", template_key: long, n: 1 }] }) });
  assert.ok(address.byId[ID.address].detail.endsWith(`to send to: ${cut} (email) x1.`), address.byId[ID.address].detail);
});

test("gap msg: the blocked lists show the top four, biggest first, ties in alphabetical order, then how many more", async () => {
  const { byId } = await runMsg({
    blocked: () => ({ rows: [
      { reason: "zeta", template_key: "T-ZZ", n: 1 },
      { reason: "alpha", template_key: "T-AA", n: 1 },
      { reason: "mid", template_key: "T-MM", n: 3 },
      { reason: "beta", template_key: "T-BB", n: 1 },
      { reason: "gamma", template_key: "T-GG", n: 1 },
      { reason: "delta", template_key: "T-DD", n: 1 }
    ] })
  });
  const r = byId[ID.blocked];
  assert.match(r.detail, /^8 customer messages were stopped/);
  assert.match(r.detail, /Why: mid x3, alpha x1, beta x1, delta x1, 2 more\./);
  assert.match(r.detail, /Which: T-MM x3, T-AA x1, T-BB x1, T-DD x1, 2 more\./);
  // exactly four shown: no "more" at four or fewer
  const four = await runMsg({
    blocked: () => ({ rows: ["a", "b", "c", "d"].map((x) => ({ reason: x, template_key: `T-${x}`, n: 1 })) })
  });
  assert.match(four.byId[ID.blocked].detail, /Why: a x1, b x1, c x1, d x1\./);
  assert.doesNotMatch(four.byId[ID.blocked].detail, /more/);
  // a row with a zero count is not a piece of the list
  const zero = await runMsg({
    blocked: () => ({ rows: [
      { reason: "ghost", template_key: "T-GHOST", n: 0 },
      { reason: "real", template_key: "T-REAL", n: 2 }
    ] })
  });
  assert.match(zero.byId[ID.blocked].detail, /^2 customer messages were stopped/);
  assert.match(zero.byId[ID.blocked].detail, /Why: real x2\. Which: T-REAL x2\.$/);
  // the same reason on two templates is one reason with the two counts added
  const same = await runMsg({
    blocked: () => ({ rows: [
      { reason: "recipient_unknown", template_key: "A", n: 2 },
      { reason: "recipient_unknown", template_key: "B", n: 3 }
    ] })
  });
  assert.match(same.byId[ID.blocked].detail, /Why: recipient_unknown x5\. Which: B x3, A x2\./);
});

test("gap msg: the no-address list shows the first four pieces and how many more", async () => {
  const rows = [1, 2, 3, 4, 5, 6].map((i) => ({ channel: "sms", template_key: `T${i}`, n: 1 }));
  const six = await runMsg({ address: () => ({ rows }) });
  assert.match(six.byId[ID.address].detail, /^6 messages failed/);
  assert.match(six.byId[ID.address].detail, /: T1 \(text\) x1, T2 \(text\) x1, T3 \(text\) x1, T4 \(text\) x1, 2 more\.$/);
  const five = await runMsg({ address: () => ({ rows: rows.slice(0, 5) }) });
  assert.match(five.byId[ID.address].detail, /T4 \(text\) x1, 1 more\.$/);
  const four = await runMsg({ address: () => ({ rows: rows.slice(0, 4) }) });
  assert.match(four.byId[ID.address].detail, /T4 \(text\) x1\.$/);
  const three = await runMsg({ address: () => ({ rows: rows.slice(0, 3) }) });
  assert.doesNotMatch(three.byId[ID.address].detail, /more/);
});

test("gap msg: ready template — five names shown, a row with both flags false is a skip, true flags count", async () => {
  const none = await runMsg({ copy: () => ({ rows: [{ channel: "email", template_key: "ODD", lorem: false, draft: false }] }) });
  assert.equal(none.byId[ID.copy].status, "skip");
  const mixed = await runMsg({
    copy: () => ({ rows: [
      { channel: "email", template_key: "NO-FLAGS", lorem: false, draft: false },
      { channel: "email", template_key: "REAL", lorem: false, draft: true }
    ] })
  });
  assert.equal(mixed.byId[ID.copy].status, "FAIL");
  assert.match(mixed.byId[ID.copy].detail, /^1 template is marked ready/);
  assert.match(mixed.byId[ID.copy].detail, /First: REAL\.$/);
  const six = await runMsg({
    copy: () => ({ rows: [1, 2, 3, 4, 5, 6].map((i) => ({ channel: "sms", template_key: `K${i}`, lorem: true, draft: false })) })
  });
  assert.match(six.byId[ID.copy].detail, /First: K1, K2, K3, K4, K5 and 1 more\.$/);
});

test("gap msg: customer replies — one text from our own lines is named, none is not", async () => {
  const one = await runMsg({ reply: () => ({ rows: [{ ...REPLY_CLEAR, own_n: 1 }] }) });
  assert.match(one.byId[ID.reply].detail, / 1 text from our own lines left out\.$/);
  const zero = await runMsg({ reply: () => ({ rows: [REPLY_CLEAR] }) });
  assert.doesNotMatch(zero.byId[ID.reply].detail, /our own lines/);
});

test("gap msg: a query that returns nothing at all is a skip that says so, never a PASS", async () => {
  for (const answer of [undefined, null, {}]) {
    const db = fakeDb(() => answer);
    const rows = await gapChecks({ db, orgId: ORG, now: NOW });
    assert.equal(rows.length, 8);
    for (const r of msgRows(rows)) {
      assert.equal(r.status, "skip", `${r.id} on ${JSON.stringify(answer)}`);
      assert.match(r.detail, /did not come back/, `${r.id}: ${r.detail}`);
    }
  }
});

test("gap msg: a long database error is cut to 160 characters", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes(IS_COPY)) throw new Error("e".repeat(300));
    return { rows: [SMS_CLEAR] };
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  const hit = msgRows(rows).find((r) => r.id === ID.copy);
  assert.equal(hit.detail, `Message read failed: ${"e".repeat(160)}`);
  // an error with no message still says something
  const bare = fakeDb((sql) => {
    if (sql.includes(IS_COPY)) throw "boom";
    return { rows: [SMS_CLEAR] };
  });
  const rows2 = await gapChecks({ db: bare, orgId: ORG, now: NOW });
  assert.equal(msgRows(rows2).find((r) => r.id === ID.copy).detail, "Message read failed: boom");
});
