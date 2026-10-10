import test, { after, before, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isOptedOut } from "../../lib/opt-out.mjs";
import {
  CHECK_IDS,
  COMPLAINT_SQL,
  DISPATCH_FILE,
  EMAIL_STOP_WORDS,
  GATE_FILE,
  LOOKBACK_DAYS,
  NOT_CLIENT_SENDS,
  REPO_ROOT,
  SENT_AFTER_SQL,
  SMS_STOP_WORDS,
  STOP_SQL,
  TABLE_PRIVILEGES,
  TABLE_SQL,
  directSendIgnoresOptOut,
  dispatchIgnoresOptOut,
  findSourceRoot,
  gapChecks,
  gateIgnoresOptOut,
  ignoredSendPaths,
  loadSendSources,
  probeDispatch,
  probeGate,
  probeUnsubscribeLink,
  sourceRoots
} from "./gap-opt-out.mjs";
import * as realUnsubscribe from "../../messaging/unsubscribe.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-opt-out.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T22:00:00.000Z");
const KEYS = ["id", "status", "detail", "suggestedFix"];
// A signing secret that is long enough (32 or more). Made up for the tests.
const TEST_ENV = Object.freeze({ UNSUBSCRIBE_TOKEN_SECRET: "opt-out-test-secret-0123456789-abcdefghij" });

const GATE_OK = "await isOptedOut(db, clientId, channel);";
const DISPATCH_OK = "await gateAndRecord(db, message);\nconst result = await provider.send({ to, body });";

function honoringSources(extra = {}) {
  return {
    [GATE_FILE]: GATE_OK,
    [DISPATCH_FILE]: DISPATCH_OK,
    ...extra
  };
}

function shape(rows) {
  assert.equal(rows.length, CHECK_IDS.length);
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [...KEYS].sort());
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Recon stays the one tripwire/);
      assert.match(row.suggestedFix, /Do not send a message/);
      assert.match(row.suggestedFix, /Do not change an opt-out row/);
      assert.doesNotMatch(row.suggestedFix, /outbound_enabled|second tripwire|flip the/i);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

function fakeDb(route) {
  const seen = [];
  return {
    seen,
    async query(sql, params) {
      const text = String(sql);
      seen.push({ sql: text, params });
      assert.match(text.trim(), /^SELECT\b/i);
      assert.doesNotMatch(text, /[;]/);
      assert.doesNotMatch(text, /\b(insert|update|delete|drop|alter|truncate)\b/i);
      return route(text, params);
    }
  };
}

const TABLE_OK = { n: 0, can_add: true, can_change: true, has_key: true };

function zeros(sql) {
  if (sql.includes("gap:opt-out-table")) return { rows: [{ ...TABLE_OK }] };
  if (sql.includes("gap:opt-out-sent-after")) return { rows: [{ people: 0, n: 0 }] };
  if (sql.includes("gap:opt-out-stop")) return { rows: [{ n: 0, unlinked: 0 }] };
  if (sql.includes("gap:opt-out-complaint")) return { rows: [{ n: 0 }] };
  throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
}

// A gate and a dispatcher stand-in that work, built on the real opt-out read.
const GOOD_GATE = {
  async gate(db, message) {
    const out = await isOptedOut(db, message.clientId, message.channel);
    return out
      ? { state: "blocked", reasons: [{ code: "opted_out" }], task: null }
      : { state: "allowed", reasons: [], task: null };
  }
};
const GOOD_DISPATCH = {
  OUTCOME: { BLOCKED: "blocked" },
  async dispatchOne(db, message) {
    const out = await isOptedOut(db, message.client_id, message.channel);
    if (out) return { id: message.id, outcome: "blocked", detail: ["opted_out"] };
    await db.query("SELECT provider, enabled FROM message_channel_routing WHERE org_id = $1", [message.org_id]);
    return { id: message.id, outcome: "no_route", detail: "no provider" };
  }
};
// Stand-ins that break the rule on purpose.
const ALLOW_ALL_GATE = { async gate() { return { state: "allowed", reasons: [], task: null }; } };
const SMS_ONLY_GATE = {
  async gate(db, message) {
    const out = await isOptedOut(db, message.clientId, "sms");
    return out
      ? { state: "blocked", reasons: [{ code: "opted_out" }], task: null }
      : { state: "allowed", reasons: [], task: null };
  }
};
const BLOCK_ALL_GATE = { async gate() { return { state: "blocked", reasons: [{ code: "quiet_hours" }], task: null }; } };
const SKIP_GATE_DISPATCH = {
  OUTCOME: { BLOCKED: "blocked" },
  async dispatchOne(db, message) {
    await db.query("SELECT provider, enabled FROM message_channel_routing WHERE org_id = $1", [message.org_id]);
    return { id: message.id, outcome: "sent", detail: "ref" };
  }
};
const GOOD_MODULES = { gateModule: GOOD_GATE, dispatchModule: GOOD_DISPATCH, env: TEST_ENV };

test("gap opt-out: source does not send or write", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /recordOptOut\s*\(/);
  assert.doesNotMatch(SRC, /await\s+dispatch(?:Due|Message|One)\s*\(/);
  assert.doesNotMatch(SRC, /^\s*import\s[^;]*messaging\/providers\/(?:twilio|resend|mailgun)/m);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.deepEqual([...CHECK_IDS], [
    "opt-out:table-unreadable",
    "opt-out:stop-did-not-stick",
    "opt-out:send-ignores",
    "opt-out:unsubscribe-link"
  ]);
});

test("gap opt-out: stop and sent-after sql stay selects and name both channels", () => {
  for (const sql of [TABLE_SQL, STOP_SQL, SENT_AFTER_SQL, COMPLAINT_SQL]) {
    assert.match(sql.trim(), /^SELECT\b/);
    assert.doesNotMatch(sql, /[;]/);
    assert.match(sql, /opt_outs/);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate)\b/i);
  }
  for (const word of SMS_STOP_WORDS) assert.match(STOP_SQL, new RegExp(`'${word}'`));
  for (const word of EMAIL_STOP_WORDS) assert.match(STOP_SQL, new RegExp(`'${word.replace(/ /g, " ")}'`));
  assert.match(STOP_SQL, /opted_in_at IS NULL/);
  assert.match(SENT_AFTER_SQL, /opted_in_at IS NULL/);
  assert.match(SENT_AFTER_SQL, /m\.channel IN \('sms', 'email'\)/);
  assert.match(SENT_AFTER_SQL, /last_attempt_at/);
  assert.doesNotMatch(SENT_AFTER_SQL, /updated_at/);
  assert.equal(LOOKBACK_DAYS, 30);
});

test("gap opt-out: the STOP read asks whether the person is opted out now, not when the row was written", () => {
  // The old read said a STOP stuck only if the opt-out time was at or before the
  // STOP. A second STOP moves that time later, so the first looked like a miss.
  assert.doesNotMatch(STOP_SQL, /opted_out_at\s*<=/);
  assert.doesNotMatch(STOP_SQL, /opted_out_at\s*>=/);
  assert.match(STOP_SQL, /o\.opted_in_at IS NULL\s+OR o\.opted_in_at >= m\.created_at - interval '5 minutes'/);
  // A STOP that matched no client is counted, not dropped.
  assert.match(STOP_SQL, /s\.client_id IS NULL/);
  assert.doesNotMatch(STOP_SQL, /m\.client_id IS NOT NULL\s*\n\s*AND m\.created_at/);
  // Opted out, then back in, with a message in between, still counts.
  assert.match(SENT_AFTER_SQL, /o\.opted_in_at IS NULL OR COALESCE\(m\.last_attempt_at, m\.created_at\) < o\.opted_in_at/);
});

test("gap opt-out: the table read asks for the save rights and the unique key with plain parameters", () => {
  assert.deepEqual([...TABLE_PRIVILEGES], ["insert", "update"]);
  assert.match(TABLE_SQL, /has_table_privilege\(current_user, 'opt_outs', \$2::text\)/);
  assert.match(TABLE_SQL, /has_table_privilege\(current_user, 'opt_outs', \$3::text\)/);
  assert.match(TABLE_SQL, /pg_indexes/);
  assert.match(TABLE_SQL, /client_id, channel/);
});

test("gap opt-out: no database or no company skips the reads", async () => {
  const noDb = await gapChecks({ sources: honoringSources(), ...GOOD_MODULES });
  shape(noDb);
  assert.equal(noDb[0].status, "skip");
  assert.equal(noDb[1].status, "skip");
  assert.equal(noDb[2].status, "skip");
  assert.match(noDb[0].detail, /No database/);
  assert.match(noDb[2].detail, /No database in this run, so messages after an opt-out were not counted\./);
  // The link row needs no database: it runs without one.
  assert.equal(noDb[3].status, "PASS");

  let called = false;
  const noOrg = await gapChecks({
    db: { query: async () => { called = true; return { rows: [{ n: 0 }] }; } },
    orgId: "",
    sources: honoringSources(),
    ...GOOD_MODULES
  });
  shape(noOrg);
  assert.deepEqual(noOrg.map((row) => row.status), ["skip", "skip", "skip", "PASS"]);
  assert.match(noOrg[0].detail, /No company/);
  assert.match(noOrg[2].detail, /No company in this run, so messages after an opt-out were not counted\./);
  assert.equal(called, false);
});

test("gap opt-out: a code miss still fails when there is no database", async () => {
  const rows = await gapChecks({
    sources: honoringSources({
      "src/blast.mjs": "import { send } from \"../messaging/providers/twilio.mjs\";\nawait send({ to, body });"
    }),
    ...GOOD_MODULES
  });
  shape(rows);
  assert.equal(rows[0].status, "skip");
  assert.equal(rows[1].status, "skip");
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /src\/blast\.mjs/);
});

test("gap opt-out: clear reads are PASS", async () => {
  const db = fakeDb(zeros);
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    sources: honoringSources(),
    ...GOOD_MODULES
  });
  shape(rows);
  assert.ok(rows.every((row) => row.status === "PASS"));
  assert.equal(db.seen.length, 4);
  assert.deepEqual(db.seen.map((q) => /gap:(opt-out-[a-z-]+)/.exec(q.sql)[1]).sort(), [
    "opt-out-complaint",
    "opt-out-stop",
    "opt-out-table",
    "opt-out-sent-after"
  ].sort());
  assert.equal(db.seen[0].params[0], ORG);
  assert.deepEqual(db.seen[0].params.slice(1), [...TABLE_PRIVILEGES]);
  assert.equal(db.seen[1].params[0], ORG);
  assert.equal(db.seen[1].params[2], false);
  assert.equal(db.seen[1].params[1], new Date(NOW.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString());
});

test("gap opt-out: table unreadable skips the other counts", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-table")) throw new Error("relation opt_outs does not exist");
    throw new Error("should not run");
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /could not be read/i);
  assert.match(rows[0].detail, /opt_outs/);
  assert.equal(rows[1].status, "skip");
  assert.equal(rows[2].status, "skip");
  assert.equal(db.seen.length, 1);
});

test("gap opt-out: a table that cannot take a STOP is FAIL, whichever part is gone", async () => {
  const cases = [
    { facts: { can_add: false }, say: /cannot add opt-out rows/ },
    { facts: { can_change: false }, say: /cannot change opt-out rows/ },
    { facts: { has_key: false }, say: /unique key on client and channel is gone/ },
    { facts: { has_key: null }, say: /unique key on client and channel is gone/ }
  ];
  for (const c of cases) {
    const db = fakeDb((sql) => (sql.includes("gap:opt-out-table")
      ? { rows: [{ ...TABLE_OK, ...c.facts }] }
      : zeros(sql)));
    const rows = await gapChecks({ db, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
    shape(rows);
    assert.equal(rows[0].status, "FAIL", JSON.stringify(c.facts));
    assert.match(rows[0].detail, c.say);
    assert.match(rows[0].detail, /can be read, but/);
    assert.equal(rows[1].status, "PASS");
    assert.equal(rows[2].status, "PASS");
  }
});

test("gap opt-out: a STOP that did not stick is FAIL", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-stop")) return { rows: [{ n: 2, unlinked: 0 }] };
    return zeros(sql);
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /2 people/);
  assert.match(rows[1].detail, /did not stick/);
  assert.equal(rows[2].status, "PASS");
});

test("gap opt-out: a STOP that matched no client is FAIL, alone or with a linked miss", async () => {
  const onlyUnlinked = fakeDb((sql) => (sql.includes("gap:opt-out-stop") ? { rows: [{ n: 0, unlinked: 3 }] } : zeros(sql)));
  const rows = await gapChecks({ db: onlyUnlinked, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /3 STOP replies in the last 30 days matched no client/);
  assert.doesNotMatch(rows[1].detail, /did not stick/);

  const one = fakeDb((sql) => (sql.includes("gap:opt-out-stop") ? { rows: [{ n: 0, unlinked: 1 }] } : zeros(sql)));
  const single = await gapChecks({ db: one, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  assert.match(single[1].detail, /1 STOP reply in the last 30 days matched no client/);

  const both = fakeDb((sql) => (sql.includes("gap:opt-out-stop") ? { rows: [{ n: 1, unlinked: 2 }] } : zeros(sql)));
  const mixed = await gapChecks({ db: both, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  shape(mixed);
  assert.equal(mixed[1].status, "FAIL");
  assert.match(mixed[1].detail, /1 person sent STOP/);
  assert.match(mixed[1].detail, /2 STOP replies/);
});

test("gap opt-out: a broken STOP read is FAIL, not a pass", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-stop")) throw new Error("messages read failed");
    return zeros(sql);
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /Could not read STOP replies: messages read failed/);

  const noCount = fakeDb((sql) => (sql.includes("gap:opt-out-stop") ? { rows: [] } : zeros(sql)));
  const empty = await gapChecks({ db: noCount, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  assert.equal(empty[1].status, "FAIL");
});

test("gap opt-out: a message after opt-out is FAIL even when the code reads opt-out", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-sent-after")) return { rows: [{ people: 2, n: 5 }] };
    return zeros(sql);
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /2 people who opted out still got a message/);
  assert.match(rows[2].detail, /5 messages/);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "PASS");
});

test("gap opt-out: one person and one message stays singular", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-stop")) return { rows: [{ n: 1, unlinked: 0 }] };
    if (sql.includes("gap:opt-out-sent-after")) return { rows: [{ people: 1, n: 1 }] };
    return zeros(sql);
  });
  const rows = await gapChecks({ db, orgId: ORG, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.match(rows[1].detail, /1 person sent STOP/);
  assert.match(rows[2].detail, /1 person who opted out still got a message/);
  assert.doesNotMatch(rows[2].detail, /1 messages/);
});

test("gap opt-out: a send path that skips opt-out is FAIL", () => {
  const badGate = "await isOptedOut(db, clientId, \"sms\");";
  const badDispatch = "const result = await provider.send({ to, body });";
  const blast = "import { send as sendSms } from \"../messaging/providers/twilio.mjs\";\nawait sendSms({ to, body });";
  const renamed = "import { send as pushOut } from \"../messaging/providers/resend.mjs\";\nawait pushOut(msg);";
  const lazy = "const { send } = await import(\"../messaging/providers/mailgun.mjs\");\nawait send(msg);";
  const sameFolder = "import { send } from \"./providers/twilio.mjs\";\nawait send(msg);";
  const commentOnly = "// see src/messaging/providers/twilio.mjs\nexport const note = 1;";
  const commentFakesRead = "import { send } from \"../messaging/providers/twilio.mjs\";\n// we call isOptedOut( first\n/* opt_outs is read in the gate */\nawait send(msg);";
  const handsOff = "import { send } from \"../messaging/providers/resend.mjs\";\nawait drain(db);\nawait send(msg);";
  const readsItself = "import { send } from \"../messaging/providers/resend.mjs\";\nif (await isOptedOut(db, id, \"email\")) return;\nawait send(msg);";
  assert.equal(gateIgnoresOptOut(GATE_OK), false);
  assert.equal(gateIgnoresOptOut(badGate), true);
  assert.equal(dispatchIgnoresOptOut(DISPATCH_OK), false);
  assert.equal(dispatchIgnoresOptOut(badDispatch), true);
  assert.equal(directSendIgnoresOptOut(blast), true);
  assert.equal(directSendIgnoresOptOut(renamed), true);
  assert.equal(directSendIgnoresOptOut(lazy), true);
  assert.equal(directSendIgnoresOptOut(sameFolder), true);
  assert.equal(directSendIgnoresOptOut(commentOnly), false);
  assert.equal(directSendIgnoresOptOut(commentFakesRead), true);
  assert.equal(directSendIgnoresOptOut(handsOff), false);
  assert.equal(directSendIgnoresOptOut(readsItself), false);

  const misses = ignoredSendPaths(honoringSources({
    "src/blast.mjs": blast,
    "src/note.mjs": commentOnly,
    [NOT_CLIENT_SENDS[0].file]: blast
  }));
  assert.deepEqual(misses.map((row) => row.file), ["src/blast.mjs"]);

  // A gate or dispatcher that was run for real is not judged by its text.
  const text = honoringSources({ [GATE_FILE]: badGate, [DISPATCH_FILE]: badDispatch });
  assert.deepEqual(ignoredSendPaths(text).map((row) => row.file), [GATE_FILE, DISPATCH_FILE]);
  assert.deepEqual(ignoredSendPaths(text, { skipGate: true }).map((row) => row.file), [DISPATCH_FILE]);
  assert.deepEqual(ignoredSendPaths(text, { skipGate: true, skipDispatch: true }), []);
});

test("gap opt-out: the real gate holds an opted-out person, per channel", async () => {
  const run = await probeGate(await import("../../messaging/gate.mjs"));
  assert.equal(run.ran, true, run.why);
  assert.deepEqual(run.misses, []);
});

test("gap opt-out: the real dispatcher stops before the send step for an opted-out person", async () => {
  const run = await probeDispatch(await import("../../messaging/dispatch.mjs"));
  assert.equal(run.ran, true, run.why);
  assert.deepEqual(run.misses, []);
});

test("gap opt-out: a gate that lets an opted-out person through is FAIL", async () => {
  const allow = await probeGate(ALLOW_ALL_GATE);
  assert.equal(allow.ran, true);
  assert.deepEqual(allow.misses.map((m) => m.why), [
    "lets a text through to a person who opted out of text",
    "lets an email through to a person who opted out of email"
  ]);
  assert.ok(allow.misses.every((m) => m.file === GATE_FILE));

  // Reads opt-out, but always for texts: an emailed person gets through.
  const wrong = await probeGate(SMS_ONLY_GATE);
  assert.deepEqual(wrong.misses.map((m) => m.why), ["lets an email through to a person who opted out of email"]);

  const good = await probeGate(GOOD_GATE);
  assert.deepEqual(good, { ran: true, why: "", misses: [] });
});

test("gap opt-out: a gate that holds everything, or is missing, is not a verdict", async () => {
  const all = await probeGate(BLOCK_ALL_GATE);
  assert.equal(all.ran, false);
  assert.match(all.why, /held an email for someone who opted out of text only \(quiet_hours\)|held a text for someone who opted out of email only \(quiet_hours\)/);
  assert.deepEqual(all.misses, []);
  assert.equal((await probeGate(null)).ran, false);
  assert.equal((await probeGate({})).ran, false);
  const boom = await probeGate({ async gate() { throw new Error("gate exploded"); } });
  assert.equal(boom.ran, false);
  assert.match(boom.why, /gate exploded/);
});

test("gap opt-out: a dispatcher that skips the gate is FAIL", async () => {
  const skip = await probeDispatch(SKIP_GATE_DISPATCH);
  assert.equal(skip.ran, true);
  assert.equal(skip.misses.length, 2);
  assert.ok(skip.misses.every((m) => m.file === DISPATCH_FILE));
  assert.match(skip.misses[0].why, /past the opt-out gate to the send step with a text/);
  assert.match(skip.misses[1].why, /with an email/);

  const good = await probeDispatch(GOOD_DISPATCH);
  assert.deepEqual(good, { ran: true, why: "", misses: [] });

  // Blocks everything, even when the person did not opt out of this channel.
  const over = await probeDispatch({
    OUTCOME: { BLOCKED: "blocked" },
    async dispatchOne(db, message) { return { id: message.id, outcome: "blocked", detail: ["quiet_hours"] }; }
  });
  assert.equal(over.ran, false);
  assert.match(over.why, /stopped/);
  assert.equal((await probeDispatch(null)).ran, false);
  const boom = await probeDispatch({ async dispatchOne() { throw new Error("dispatch exploded"); } });
  assert.equal(boom.ran, false);
  assert.match(boom.why, /dispatch exploded/);
});

test("gap opt-out: a probe that cannot run falls back to the text, and says so", async () => {
  const rows = await gapChecks({
    sources: honoringSources({ [GATE_FILE]: "await isOptedOut(db, clientId, \"sms\");" }),
    gateModule: null,
    dispatchModule: GOOD_DISPATCH
  });
  shape(rows);
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /gate\.mjs does not read opt-out for the message channel/);

  const ok = await gapChecks({ sources: honoringSources(), gateModule: null, dispatchModule: GOOD_DISPATCH });
  shape(ok);
  assert.equal(ok[2].status, "skip");
  assert.match(ok[2].detail, /A send path was not run: gate\(\) could not be loaded\./);
});

test("gap opt-out: code miss and a later message both fail the send check", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-sent-after")) return { rows: [{ people: 1, n: 1 }] };
    return zeros(sql);
  });
  const rows = await gapChecks({
    db,
    orgId: ORG,
    sources: honoringSources(),
    gateModule: ALLOW_ALL_GATE,
    dispatchModule: GOOD_DISPATCH
  });
  shape(rows);
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /gate\.mjs lets a text through/);
  assert.match(rows[2].detail, /1 person who opted out/);
});

test("gap opt-out: a broken message count fails the send check", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-sent-after")) throw new Error("messages read failed");
    return zeros(sql);
  });
  const rows = await gapChecks({ db, orgId: ORG, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "PASS");
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /Could not count/);
});

test("gap opt-out: the shipped function keeps src beside netlify, so that is where the scan looks", () => {
  const task = fs.mkdtempSync(path.join(os.tmpdir(), "optout-task-"));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "optout-empty-"));
  try {
    fs.mkdirSync(path.join(task, "src", "messaging"), { recursive: true });
    fs.writeFileSync(path.join(task, "src", "messaging", "gate.mjs"), GATE_OK);
    fs.writeFileSync(path.join(task, "src", "messaging", "dispatch.mjs"), DISPATCH_OK);

    const roots = sourceRoots({ env: { LAMBDA_TASK_ROOT: task }, cwd: empty });
    assert.ok(roots.includes(task));
    assert.ok(roots.includes(REPO_ROOT));
    assert.deepEqual(sourceRoots({ root: "/x", env: { LAMBDA_TASK_ROOT: task } }), ["/x"]);
    assert.equal(findSourceRoot([empty, task]), task);
    assert.equal(findSourceRoot([empty]), null);
    assert.equal(findSourceRoot([]), null);

    const sources = loadSendSources([empty, task]);
    assert.equal(sources[GATE_FILE], GATE_OK);
    assert.equal(sources[DISPATCH_FILE], DISPATCH_OK);
    assert.deepEqual(ignoredSendPaths(sources), []);
  } finally {
    fs.rmSync(task, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("gap opt-out: source files that are not there skip the scan, they do not fail the row", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "optout-nosrc-"));
  try {
    const db = fakeDb(zeros);
    const rows = await gapChecks({ db, orgId: ORG, now: NOW, root: empty, ...GOOD_MODULES });
    shape(rows);
    assert.ok(rows.every((row) => row.status === "PASS"));
    assert.match(rows[2].detail, /The scan for other senders was skipped: no source files in this run\./);

    // Same empty folder, but the gate really lets people through: still a FAIL.
    const bad = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, root: empty, gateModule: ALLOW_ALL_GATE, dispatchModule: GOOD_DISPATCH });
    assert.equal(bad[2].status, "FAIL");
    assert.match(bad[2].detail, /gate\.mjs lets a text through/);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("gap opt-out: send code that was neither run nor read is a skip, never a PASS", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "optout-unproven-"));
  try {
    const clear = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, root: empty, gateModule: null, dispatchModule: null });
    shape(clear);
    assert.equal(clear[0].status, "PASS");
    assert.equal(clear[1].status, "PASS");
    assert.equal(clear[2].status, "skip");
    assert.match(clear[2].detail, /The send code was not checked this run \(src\/messaging\/gate\.mjs, src\/messaging\/dispatch\.mjs\)/);
    assert.match(clear[2].detail, /nobody who was opted out got a message/);

    // One of the two is shown by being run: only the other is named.
    const half = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, root: empty, gateModule: GOOD_GATE, dispatchModule: null });
    assert.equal(half[2].status, "skip");
    assert.match(half[2].detail, /\(src\/messaging\/dispatch\.mjs\)/);
    assert.doesNotMatch(half[2].detail, /gate\.mjs\)/);

    // Still a FAIL when a message went out after an opt-out, run or not.
    const late = fakeDb((sql) => (sql.includes("gap:opt-out-sent-after") ? { rows: [{ people: 1, n: 1 }] } : zeros(sql)));
    const bad = await gapChecks({ db: late, orgId: ORG, now: NOW, root: empty, gateModule: null, dispatchModule: null });
    assert.equal(bad[2].status, "FAIL");

    // Source text that was read counts as shown.
    const read = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, sources: honoringSources(), gateModule: null, dispatchModule: null });
    assert.equal(read[2].status, "PASS");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("gap opt-out: live send paths read opt-out, and staff alerts are not client sends", () => {
  const sources = loadSendSources(REPO_ROOT);
  assert.equal(typeof sources[GATE_FILE], "string");
  assert.equal(typeof sources[DISPATCH_FILE], "string");
  assert.equal(gateIgnoresOptOut(sources[GATE_FILE]), false);
  assert.equal(dispatchIgnoresOptOut(sources[DISPATCH_FILE]), false);
  for (const row of NOT_CLIENT_SENDS) {
    assert.equal(typeof sources[row.file], "string", row.file);
    assert.equal(directSendIgnoresOptOut(sources[row.file]), true, row.file);
  }
  const misses = ignoredSendPaths(sources);
  assert.deepEqual(misses, [], misses.map((row) => `${row.file} ${row.why}`).join("; "));
});

test("gap opt-out: live code with a clear count is PASS", async () => {
  const db = fakeDb(zeros);
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, root: REPO_ROOT, env: TEST_ENV });
  shape(rows);
  assert.ok(rows.every((row) => row.status === "PASS"));
  assert.doesNotMatch(rows[2].detail, /was not run|was skipped/);
});

// ---- Spam complaints ----

test("gap opt-out: a spam complaint with no email opt-out is FAIL on the STOP row", async () => {
  const one = fakeDb((sql) => (sql.includes("gap:opt-out-complaint") ? { rows: [{ n: 1 }] } : zeros(sql)));
  const rows = await gapChecks({ db: one, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /1 person marked an email as spam in the last 30 days and is not opted out of email\./);
  assert.doesNotMatch(rows[1].detail, /sent STOP/);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[2].status, "PASS");
  assert.equal(one.seen.find((q) => q.sql.includes("gap:opt-out-complaint")).params[2], false);

  const many = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-complaint")) return { rows: [{ n: 3 }] };
    if (sql.includes("gap:opt-out-stop")) return { rows: [{ n: 1, unlinked: 0 }] };
    return zeros(sql);
  });
  const both = await gapChecks({ db: many, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  assert.equal(both[1].status, "FAIL");
  assert.match(both[1].detail, /1 person sent STOP/);
  assert.match(both[1].detail, /3 people marked an email as spam in the last 30 days and are not opted out of email\./);
});

test("gap opt-out: a spam complaint read that breaks is FAIL, not a pass", async () => {
  const broke = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-complaint")) throw new Error("messages read failed");
    return zeros(sql);
  });
  const rows = await gapChecks({ db: broke, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /Could not read spam complaints: messages read failed/);

  const noCount = fakeDb((sql) => (sql.includes("gap:opt-out-complaint") ? { rows: [] } : zeros(sql)));
  const empty = await gapChecks({ db: noCount, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  assert.equal(empty[1].status, "FAIL");
  assert.equal(empty[2].status, "PASS");
});

test("gap opt-out: a clean STOP row says what it covered", async () => {
  const rows = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  assert.equal(rows[1].status, "PASS");
  assert.match(rows[1].detail, /No STOP, unsubscribe, or spam complaint in the last 30 days is missing its opt-out\./);
});

// ---- The email unsubscribe link ----

test("gap opt-out: a link that signs, rides in the footer, checks out, and refuses a forged copy is PASS", async () => {
  const rows = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.equal(rows[3].id, "opt-out:unsubscribe-link");
  assert.equal(rows[3].status, "PASS");
  assert.match(rows[3].detail, /signed, put in the email footer, and checked/);
  const run = probeUnsubscribeLink(realUnsubscribe, { env: TEST_ENV, now: NOW });
  assert.deepEqual(run, { ran: true, why: "", problem: null });
});

test("gap opt-out: no signing secret, or a short one, is FAIL because the mail would go out with no link", async () => {
  for (const env of [{}, { UNSUBSCRIBE_TOKEN_SECRET: "short" }, { DOCUMENT_URL_SECRET: "also-too-short" }]) {
    const rows = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES, env });
    shape(rows);
    assert.equal(rows[3].status, "FAIL", JSON.stringify(env));
    assert.match(rows[3].detail, /a link cannot be signed, so email goes out with no unsubscribe link/);
    assert.match(rows[3].detail, /UNSUBSCRIBE_TOKEN_SECRET is missing or too short/);
    assert.match(rows[3].suggestedFix, /UNSUBSCRIBE_TOKEN_SECRET/);
    // The other three rows are not pulled down by it.
    assert.deepEqual(rows.slice(0, 3).map((r) => r.status), ["PASS", "PASS", "PASS"]);
  }
  // A masked copy (asterisks, as Netlify lists a hidden variable) cannot sign. Say so, and never print it.
  const masked = "****************f377";
  for (const env of [{ UNSUBSCRIBE_TOKEN_SECRET: masked }, { UNSUBSCRIBE_TOKEN_SECRET: masked, DOCUMENT_URL_SECRET: "d".repeat(64) }]) {
    const rows = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES, env });
    assert.equal(rows[3].status, "FAIL");
    assert.match(rows[3].detail, /the setting in use is a masked placeholder \(it starts with asterisks\), not a real secret/);
    assert.ok(rows.every((r) => !r.detail.includes(masked) && !String(r.suggestedFix).includes(masked)));
  }
  // A plain too-short secret is not called a mask.
  const short = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES, env: { UNSUBSCRIBE_TOKEN_SECRET: "short" } });
  assert.doesNotMatch(short[3].detail, /masked/);
  // The fallback secret the signer allows still counts as a working setup.
  const fallback = probeUnsubscribeLink(realUnsubscribe, {
    env: { DOCUMENT_URL_SECRET: "document-secret-0123456789-abcdefghijklmnop" },
    now: NOW
  });
  assert.equal(fallback.problem, null);
});

test("gap opt-out: the link row fails with no database too, and never prints the secret", async () => {
  const rows = await gapChecks({ sources: honoringSources(), ...GOOD_MODULES, env: {} });
  shape(rows);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip", "FAIL"]);
  const secret = TEST_ENV.UNSUBSCRIBE_TOKEN_SECRET;
  const all = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  assert.ok(all.every((r) => !r.detail.includes(secret) && !String(r.suggestedFix).includes(secret)));
});

test("gap opt-out: a link signer, footer, or checker that is broken is FAIL, each on its own", () => {
  const env = TEST_ENV;
  const good = realUnsubscribe;
  const run = (mod) => probeUnsubscribeLink(mod, { env, now: NOW });
  // The footer leaves the link out.
  assert.match(run({ ...good, withUnsubscribeFooter: (body) => body }).problem, /footer does not carry the signed link/);
  // The checker refuses a link that was just signed.
  assert.match(run({ ...good, verifyUnsubscribeRequest: () => null }).problem, /just signed does not check out/);
  // The checker hands back someone else.
  assert.match(
    run({ ...good, verifyUnsubscribeRequest: (url, o) => ({ ...good.verifyUnsubscribeRequest(url, o), clientId: "someone-else" }) }).problem,
    /just signed does not check out/
  );
  // The checker accepts anything.
  assert.match(
    run({ ...good, verifyUnsubscribeRequest: (url, o) => good.verifyUnsubscribeRequest(url.replace(/sig=[0-9a-f]+/, (m) => m), o) && { orgId: "11111111-1111-4111-8111-111111111111" } }).problem,
    /just signed does not check out/
  );
  const acceptsForged = {
    ...good,
    verifyUnsubscribeRequest: (url, o) => (good.verifyUnsubscribeRequest(url, o) || { orgId: "00000000-0000-4000-8000-0000000000a1", clientId: "00000000-0000-4000-8000-0000000000a2", channel: "email" })
  };
  assert.match(run(acceptsForged).problem, /changed signature is accepted/);
  // The signer answers with no link.
  assert.match(run({ ...good, signUnsubscribeUrl: () => ({}) }).problem, /signer answered with no link/);
  // The signer throws.
  assert.match(run({ ...good, signUnsubscribeUrl: () => { throw new Error("boom"); } }).problem, /cannot be signed.*boom/);
  // The code is missing, or the probe itself trips.
  for (const mod of [null, {}, { signUnsubscribeUrl() {} }]) {
    const missing = run(mod);
    assert.equal(missing.ran, false);
    assert.match(missing.why, /could not be loaded/);
  }
  const tripped = run({ ...good, withUnsubscribeFooter: () => { throw new Error("footer exploded"); } });
  assert.equal(tripped.ran, false);
  assert.match(tripped.why, /footer exploded/);
});

test("gap opt-out: a link module that cannot be loaded is a skip with the reason, not a pass", async () => {
  const rows = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES, unsubscribeModule: null });
  shape(rows);
  assert.equal(rows[3].status, "skip");
  assert.match(rows[3].detail, /not tried this run: the unsubscribe link code could not be loaded/);
});

test("gap opt-out: with no env handed in, the link row reads the function's own settings", async () => {
  const { env: _skip, ...noEnv } = GOOD_MODULES;
  const keep = { a: process.env.UNSUBSCRIBE_TOKEN_SECRET, b: process.env.DOCUMENT_URL_SECRET };
  try {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = TEST_ENV.UNSUBSCRIBE_TOKEN_SECRET;
    const good = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, sources: honoringSources(), ...noEnv });
    assert.equal(good[3].status, "PASS");
    delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
    delete process.env.DOCUMENT_URL_SECRET;
    const bad = await gapChecks({ db: fakeDb(zeros), orgId: ORG, now: NOW, sources: honoringSources(), ...noEnv });
    assert.equal(bad[3].status, "FAIL");
  } finally {
    for (const [k, v] of [["UNSUBSCRIBE_TOKEN_SECRET", keep.a], ["DOCUMENT_URL_SECRET", keep.b]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// ---- Wording and the outer catch ----

test("gap opt-out: when the opt-out table cannot be read, the send row says that, not 'no database'", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-table")) throw new Error("relation opt_outs does not exist");
    throw new Error("should not run");
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES });
  shape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.equal(rows[2].status, "skip");
  assert.match(rows[2].detail, /The opt-out table could not be read, so messages after an opt-out were not counted\./);
  assert.doesNotMatch(rows[2].detail, /No database/);
  assert.equal(rows[3].status, "PASS");
  // The link row stands on its own here too: a missing secret is a FAIL even with the table down.
  const noSecret = await gapChecks({ db, orgId: ORG, now: NOW, sources: honoringSources(), ...GOOD_MODULES, env: {} });
  assert.equal(noSecret[0].status, "FAIL");
  assert.equal(noSecret[3].status, "FAIL");
  assert.match(noSecret[3].detail, /cannot be signed/);
});

test("gap opt-out: a check that trips on something unexpected is FAIL on every row, never PASS", async () => {
  const ctx = {
    db: fakeDb(zeros),
    orgId: ORG,
    ...GOOD_MODULES,
    get sources() { throw new Error("the sources exploded"); }
  };
  const rows = await gapChecks(ctx);
  shape(rows);
  assert.deepEqual(rows.map((r) => r.status), ["FAIL", "FAIL", "FAIL", "FAIL"]);
  assert.ok(rows.every((r) => /Opt-out check stopped: the sources exploded/.test(r.detail)));
});

// ---- The SQL, pinned line by line ----
//
// The SQL is run for real further down when a database is there. These pins hold when
// it is not, so a flipped test in the SQL turns this file red either way.

test("gap opt-out: the STOP sql is pinned", () => {
  assert.match(STOP_SQL, /count\(DISTINCT s\.client_id\) FILTER \(WHERE s\.client_id IS NOT NULL AND NOT s\.covered\)::int AS n/);
  assert.match(STOP_SQL, /count\(\*\) FILTER \(WHERE s\.client_id IS NULL\)::int AS unlinked/);
  assert.match(STOP_SQL, /m\.direction = 'inbound'/);
  assert.match(STOP_SQL, /m\.channel IN \('sms', 'email'\)/);
  assert.match(STOP_SQL, /m\.created_at >= \$2::timestamptz/);
  assert.match(STOP_SQL, /\(m\.channel = 'sms' AND upper\(/);
  assert.match(STOP_SQL, /\(m\.channel = 'email' AND upper\(/);
  // The opt-out that covers a STOP is for the same person, company, and channel.
  assert.match(STOP_SQL, /o\.client_id = m\.client_id\s+AND o\.org_id = m\.org_id\s+AND o\.channel = m\.channel/);
  assert.match(STOP_SQL, /AND \(o\.opted_in_at IS NULL\s+OR o\.opted_in_at >= m\.created_at - interval '5 minutes'\)/);
  assert.match(STOP_SQL, /\(\$3::boolean OR COALESCE\(m\.is_demo, false\) = false\)/);
  assert.match(STOP_SQL, /\(\$3::boolean OR COALESCE\(c\.is_demo, false\) = false\)/);
});

test("gap opt-out: the sent-after sql is pinned", () => {
  assert.match(SENT_AFTER_SQL, /m\.direction = 'outbound'/);
  assert.match(SENT_AFTER_SQL, /m\.channel IN \('sms', 'email'\)/);
  assert.match(SENT_AFTER_SQL, /m\.status IN \('sent', 'delivered', 'complained'\)/);
  assert.match(SENT_AFTER_SQL, /o\.client_id = m\.client_id\s+AND o\.org_id = m\.org_id\s+AND o\.channel = m\.channel/);
  assert.match(SENT_AFTER_SQL, /COALESCE\(m\.last_attempt_at, m\.created_at\) > o\.opted_out_at/);
  assert.match(SENT_AFTER_SQL, /COALESCE\(m\.last_attempt_at, m\.created_at\) >= \$2::timestamptz/);
  assert.match(SENT_AFTER_SQL, /count\(DISTINCT m\.client_id\)::int AS people/);
  assert.match(SENT_AFTER_SQL, /\(\$3::boolean OR COALESCE\(m\.is_demo, false\) = false\)/);
});

test("gap opt-out: the complaint sql is pinned", () => {
  assert.match(COMPLAINT_SQL, /m\.direction = 'outbound'/);
  assert.match(COMPLAINT_SQL, /m\.channel = 'email'/);
  assert.match(COMPLAINT_SQL, /m\.status = 'complained'/);
  assert.match(COMPLAINT_SQL, /m\.updated_at >= \$2::timestamptz/);
  assert.match(COMPLAINT_SQL, /AND NOT EXISTS \(/);
  assert.match(COMPLAINT_SQL, /o\.client_id = m\.client_id\s+AND o\.org_id = m\.org_id\s+AND o\.channel = 'email'/);
  assert.match(COMPLAINT_SQL, /o\.opted_in_at IS NULL\s+OR o\.opted_in_at >= m\.updated_at - interval '5 minutes'/);
  assert.match(COMPLAINT_SQL, /count\(DISTINCT m\.client_id\)::int AS n/);
});

test("gap opt-out: the unique-key test in the table sql accepts the real key and refuses the wrong ones", () => {
  // Postgres and JS read these small patterns the same way, so the patterns are lifted out
  // of the SQL text and tried on index definitions as Postgres prints them.
  const must = [...TABLE_SQL.matchAll(/indexdef ~\* '([^']*)'/g)].map((m) => new RegExp(m[1], "i"));
  const mustNot = [...TABLE_SQL.matchAll(/indexdef !~\* '([^']*)'/g)].map((m) => new RegExp(m[1], "i"));
  assert.equal(must.length, 2);
  assert.equal(mustNot.length, 1);
  const hasKey = (def) => must.every((re) => re.test(def)) && !mustNot.some((re) => re.test(def));
  const on = "ON public.opt_outs USING btree";
  assert.equal(hasKey(`CREATE UNIQUE INDEX opt_outs_client_channel ${on} (client_id, channel)`), true);
  assert.equal(hasKey(`CREATE UNIQUE INDEX opt_outs_channel_client ${on} (channel, client_id)`), true);
  assert.equal(hasKey(`CREATE INDEX opt_outs_x ${on} (client_id, channel)`), false);
  assert.equal(hasKey(`CREATE UNIQUE INDEX opt_outs_x ${on} (client_id, channel) WHERE (opted_in_at IS NULL)`), false);
  assert.equal(hasKey(`CREATE UNIQUE INDEX opt_outs_x ${on} (client_id)`), false);
  assert.equal(hasKey(`CREATE UNIQUE INDEX opt_outs_x ${on} (org_id, client_id)`), false);
  assert.equal(hasKey(`CREATE UNIQUE INDEX opt_outs_x ${on} (client_id, channel, org_id)`), false);
  assert.equal(hasKey(`CREATE UNIQUE INDEX opt_outs_x ${on} (client_id, org_id)`), false);
});

// ---- The SQL, run for real ----
//
// With DATABASE_URL set, each SQL runs on the real database engine. Rows are made up and
// handed in as a few lines of VALUES-style JSON that SHADOW the real tables for that one
// statement (a WITH name wins over a table name). It is one SELECT. Nothing is written,
// no table is made, and no real row is read. Without DATABASE_URL these skip.

const HAS_DB = !!process.env.DATABASE_URL;

describe("gap opt-out: the SQL on a real database", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  const C1 = "00000000-0000-4000-8000-0000000000c1";
  const C2 = "00000000-0000-4000-8000-0000000000c2";
  const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
  const SINCE = "2026-09-08T22:00:00.000Z";
  const hours = (h) => new Date(Date.parse("2026-10-01T12:00:00.000Z") + h * 3600 * 1000).toISOString();
  let handle;
  let schema;
  let n = 0;

  before(async () => {
    const mod = await import("../../db.mjs");
    handle = mod;
    schema = (await mod.db.query("SELECT current_schema() AS s")).rows[0].s;
  });
  after(async () => {
    if (handle) await handle.close();
  });

  const cte = (name, cols, rows) => {
    const spec = cols.map(([col, type]) => `"${col}" ${type}`).join(", ");
    const json = JSON.stringify(rows).replace(/'/g, "''");
    return `${name} AS (SELECT * FROM jsonb_to_recordset('${json}'::jsonb) AS x(${spec}))`;
  };
  const MESSAGE_COLS = [
    ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["direction", "text"], ["channel", "text"],
    ["status", "text"], ["rendered_body", "text"], ["created_at", "timestamptz"], ["last_attempt_at", "timestamptz"],
    ["updated_at", "timestamptz"], ["is_demo", "boolean"]
  ];
  const OPT_OUT_COLS = [
    ["client_id", "uuid"], ["org_id", "uuid"], ["channel", "text"], ["opted_out_at", "timestamptz"], ["opted_in_at", "timestamptz"]
  ];
  const CLIENT_COLS = [["id", "uuid"], ["org_id", "uuid"], ["is_demo", "boolean"]];

  const message = (o) => {
    n += 1;
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      org_id: ORG, client_id: C1, direction: "inbound", channel: "sms", status: "received", rendered_body: "STOP",
      created_at: hours(0), last_attempt_at: null, updated_at: hours(0), is_demo: false, ...o
    };
  };
  const optOut = (o) => ({ client_id: C1, org_id: ORG, channel: "sms", opted_out_at: hours(0), opted_in_at: null, ...o });
  const person = (id, o) => ({ id, org_id: ORG, is_demo: false, ...o });

  async function read(sql, { messages = [], optOuts = [], clients = [person(C1), person(C2)], demo = false } = {}) {
    assert.match(sql.trim(), /^SELECT\b/);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate)\b/i);
    const text = `WITH ${[
      cte("messages", MESSAGE_COLS, messages),
      cte("opt_outs", OPT_OUT_COLS, optOuts),
      cte("clients", CLIENT_COLS, clients)
    ].join(", ")} ${sql}`;
    const res = await handle.db.query(text, [ORG, SINCE, demo]);
    return res.rows[0];
  }

  test("STOP: a person who sent STOP and has no opt-out is a miss", async () => {
    assert.deepEqual(await read(STOP_SQL, { messages: [message({})] }), { n: 1, unlinked: 0 });
  });

  test("STOP: an open opt-out covers it, however many times they sent STOP", async () => {
    const once = await read(STOP_SQL, { messages: [message({})], optOuts: [optOut({})] });
    assert.deepEqual(once, { n: 0, unlinked: 0 });
    // A second STOP, ten days later, moves the opt-out time. The first STOP is still covered.
    const twice = await read(STOP_SQL, {
      messages: [message({ created_at: hours(0) }), message({ created_at: hours(240) })],
      optOuts: [optOut({ opted_out_at: hours(240) })]
    });
    assert.deepEqual(twice, { n: 0, unlinked: 0 });
  });

  test("STOP: opting back in after the STOP is fine, opting in before it is a miss", async () => {
    const startedAgain = await read(STOP_SQL, {
      messages: [message({})],
      optOuts: [optOut({ opted_in_at: hours(1) })]
    });
    assert.deepEqual(startedAgain, { n: 0, unlinked: 0 });
    const optedInFirst = await read(STOP_SQL, {
      messages: [message({ created_at: hours(10) })],
      optOuts: [optOut({ opted_out_at: hours(-20), opted_in_at: hours(0) })]
    });
    assert.deepEqual(optedInFirst, { n: 1, unlinked: 0 });
  });

  test("STOP: another person, another channel, or another company does not cover it", async () => {
    const otherPerson = await read(STOP_SQL, { messages: [message({})], optOuts: [optOut({ client_id: C2 })] });
    assert.equal(otherPerson.n, 1);
    const otherChannel = await read(STOP_SQL, { messages: [message({})], optOuts: [optOut({ channel: "email" })] });
    assert.equal(otherChannel.n, 1);
    const otherOrg = await read(STOP_SQL, { messages: [message({})], optOuts: [optOut({ org_id: OTHER_ORG })] });
    assert.equal(otherOrg.n, 1);
    const emailStop = await read(STOP_SQL, {
      messages: [message({ channel: "email", rendered_body: "Unsubscribe" })],
      optOuts: [optOut({ channel: "sms" })]
    });
    assert.equal(emailStop.n, 1);
    const emailCovered = await read(STOP_SQL, {
      messages: [message({ channel: "email", rendered_body: "Unsubscribe" })],
      optOuts: [optOut({ channel: "email" })]
    });
    assert.equal(emailCovered.n, 0);
  });

  test("STOP: a STOP that matched no client is counted on its own", async () => {
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ client_id: null })] }), { n: 0, unlinked: 1 });
    const mixed = await read(STOP_SQL, { messages: [message({ client_id: null }), message({})] });
    assert.deepEqual(mixed, { n: 1, unlinked: 1 });
  });

  test("STOP: only the exact keyword for the channel counts, only inbound, only in the window, demo off", async () => {
    const none = { n: 0, unlinked: 0 };
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ rendered_body: "please stop texting me" })] }), none);
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ direction: "outbound" })] }), none);
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ created_at: "2026-09-01T00:00:00.000Z" })] }), none);
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ rendered_body: "OPT OUT" })] }), none);
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ channel: "email", rendered_body: "CANCEL" })] }), none);
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ channel: "voice" })] }), none);
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ org_id: OTHER_ORG })] }), none);
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ is_demo: true })] }), none);
    assert.deepEqual(await read(STOP_SQL, { messages: [message({})], clients: [person(C1, { is_demo: true })] }), none);
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ is_demo: true })], demo: true }), { n: 1, unlinked: 0 });
    // Spaces and lower case around the keyword still count.
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ rendered_body: "  stop \n" })] }), { n: 1, unlinked: 0 });
    assert.deepEqual(await read(STOP_SQL, { messages: [message({ channel: "email", rendered_body: "opt out" })] }), { n: 1, unlinked: 0 });
  });

  const sent = (o) => message({ direction: "outbound", status: "sent", rendered_body: "Hello", created_at: hours(5), ...o });

  test("sent after: a message after the opt-out, or between opt-out and opt-in, is a miss", async () => {
    const after_ = await read(SENT_AFTER_SQL, { messages: [sent({})], optOuts: [optOut({ opted_out_at: hours(0) })] });
    assert.deepEqual(after_, { people: 1, n: 1 });
    const between = await read(SENT_AFTER_SQL, {
      messages: [sent({})],
      optOuts: [optOut({ opted_out_at: hours(0), opted_in_at: hours(9) })]
    });
    assert.deepEqual(between, { people: 1, n: 1 });
    const twoToOne = await read(SENT_AFTER_SQL, {
      messages: [sent({}), sent({ created_at: hours(6) })],
      optOuts: [optOut({})]
    });
    assert.deepEqual(twoToOne, { people: 1, n: 2 });
  });

  test("sent after: before the opt-out, after the opt-in, or on another channel is fine", async () => {
    const none = { people: 0, n: 0 };
    assert.deepEqual(await read(SENT_AFTER_SQL, { messages: [sent({})], optOuts: [optOut({ opted_out_at: hours(8) })] }), none);
    assert.deepEqual(await read(SENT_AFTER_SQL, {
      messages: [sent({ created_at: hours(12) })],
      optOuts: [optOut({ opted_out_at: hours(0), opted_in_at: hours(9) })]
    }), none);
    assert.deepEqual(await read(SENT_AFTER_SQL, { messages: [sent({ channel: "email" })], optOuts: [optOut({ channel: "sms" })] }), none);
    assert.deepEqual(await read(SENT_AFTER_SQL, { messages: [sent({ client_id: C2 })], optOuts: [optOut({})] }), none);
    assert.deepEqual(await read(SENT_AFTER_SQL, { messages: [sent({ org_id: OTHER_ORG })], optOuts: [optOut({})] }), none);
  });

  test("sent after: only messages that left count, only outbound, in the window, demo off", async () => {
    const optOuts = [optOut({})];
    for (const status of ["sent", "delivered", "complained"]) {
      assert.equal((await read(SENT_AFTER_SQL, { messages: [sent({ status })], optOuts })).people, 1, status);
    }
    for (const status of ["queued", "blocked", "bounced", "failed", "received"]) {
      assert.equal((await read(SENT_AFTER_SQL, { messages: [sent({ status })], optOuts })).people, 0, status);
    }
    assert.equal((await read(SENT_AFTER_SQL, { messages: [sent({ direction: "inbound" })], optOuts })).people, 0);
    assert.equal((await read(SENT_AFTER_SQL, { messages: [sent({ channel: "voice" })], optOuts })).people, 0);
    assert.equal((await read(SENT_AFTER_SQL, { messages: [sent({ created_at: "2026-09-01T00:00:00.000Z" })], optOuts: [optOut({ opted_out_at: "2026-08-01T00:00:00.000Z" })] })).people, 0);
    assert.equal((await read(SENT_AFTER_SQL, { messages: [sent({ is_demo: true })], optOuts })).people, 0);
    assert.equal((await read(SENT_AFTER_SQL, { messages: [sent({})], optOuts, clients: [person(C1, { is_demo: true })] })).people, 0);
    assert.equal((await read(SENT_AFTER_SQL, { messages: [sent({ is_demo: true })], optOuts, demo: true })).people, 1);
  });

  test("sent after: the last try wins over the queue time", async () => {
    const optOuts = [optOut({ opted_out_at: hours(0) })];
    const triedLater = await read(SENT_AFTER_SQL, { messages: [sent({ created_at: hours(-3), last_attempt_at: hours(4) })], optOuts });
    assert.equal(triedLater.people, 1);
    const queuedLaterButTriedBefore = await read(SENT_AFTER_SQL, { messages: [sent({ created_at: hours(4), last_attempt_at: hours(-3) })], optOuts });
    assert.equal(queuedLaterButTriedBefore.people, 0);
  });

  const complained = (o) => message({ direction: "outbound", channel: "email", status: "complained", rendered_body: "Hello", updated_at: hours(5), ...o });

  test("complaint: a complained email with no email opt-out is a miss", async () => {
    assert.deepEqual(await read(COMPLAINT_SQL, { messages: [complained({})] }), { n: 1 });
    assert.deepEqual(await read(COMPLAINT_SQL, { messages: [complained({}), complained({})] }), { n: 1 });
    assert.deepEqual(await read(COMPLAINT_SQL, { messages: [complained({}), complained({ client_id: C2 })] }), { n: 2 });
    const smsOnly = await read(COMPLAINT_SQL, { messages: [complained({})], optOuts: [optOut({ channel: "sms" })] });
    assert.equal(smsOnly.n, 1);
    const optedInFirst = await read(COMPLAINT_SQL, {
      messages: [complained({ updated_at: hours(10) })],
      optOuts: [optOut({ channel: "email", opted_out_at: hours(-20), opted_in_at: hours(0) })]
    });
    assert.equal(optedInFirst.n, 1);
  });

  test("complaint: an email opt-out, or an opt-in after the complaint, covers it", async () => {
    const open = await read(COMPLAINT_SQL, { messages: [complained({})], optOuts: [optOut({ channel: "email" })] });
    assert.equal(open.n, 0);
    const startedAgain = await read(COMPLAINT_SQL, {
      messages: [complained({})],
      optOuts: [optOut({ channel: "email", opted_in_at: hours(9) })]
    });
    assert.equal(startedAgain.n, 0);
  });

  test("complaint: only outbound email marked complained, with a client, in the window, demo off", async () => {
    for (const o of [
      { status: "delivered" }, { direction: "inbound" }, { channel: "sms" }, { client_id: null },
      { updated_at: "2026-09-01T00:00:00.000Z" }, { org_id: OTHER_ORG }, { is_demo: true }
    ]) {
      assert.equal((await read(COMPLAINT_SQL, { messages: [complained(o)] })).n, 0, JSON.stringify(o));
    }
    assert.equal((await read(COMPLAINT_SQL, { messages: [complained({})], clients: [person(C1, { is_demo: true })] })).n, 0);
    assert.equal((await read(COMPLAINT_SQL, { messages: [complained({ is_demo: true })], demo: true })).n, 1);
  });

  test("table: the unique key is found on the real table, and each wrong shape is not", async () => {
    const real = (await handle.db.query(TABLE_SQL, [ORG, ...TABLE_PRIVILEGES])).rows[0];
    assert.equal(real.can_add, true);
    assert.equal(real.can_change, true);
    assert.equal(real.has_key, true);

    const key = async (indexdef) => {
      const text = `WITH ${[
        cte("opt_outs", OPT_OUT_COLS, []),
        cte("pg_indexes", [["schemaname", "text"], ["tablename", "text"], ["indexdef", "text"]],
          indexdef == null ? [] : [{ schemaname: schema, tablename: "opt_outs", indexdef }])
      ].join(", ")} ${TABLE_SQL}`;
      return (await handle.db.query(text, [ORG, ...TABLE_PRIVILEGES])).rows[0].has_key;
    };
    const on = "ON public.opt_outs USING btree";
    assert.equal(await key(`CREATE UNIQUE INDEX opt_outs_client_channel ${on} (client_id, channel)`), true);
    assert.equal(await key(`CREATE UNIQUE INDEX opt_outs_channel_client ${on} (channel, client_id)`), true);
    assert.equal(await key(null), false);
    assert.equal(await key(`CREATE INDEX opt_outs_x ${on} (client_id, channel)`), false);
    assert.equal(await key(`CREATE UNIQUE INDEX opt_outs_x ${on} (client_id, channel) WHERE (opted_in_at IS NULL)`), false);
    assert.equal(await key(`CREATE UNIQUE INDEX opt_outs_x ${on} (client_id)`), false);
    assert.equal(await key(`CREATE UNIQUE INDEX opt_outs_x ${on} (client_id, channel, org_id)`), false);
    // A key in another schema, or on a table of another name, does not count.
    const elsewhere = `WITH ${[
      cte("opt_outs", OPT_OUT_COLS, []),
      cte("pg_indexes", [["schemaname", "text"], ["tablename", "text"], ["indexdef", "text"]],
        [{ schemaname: `${schema}_not_this_one`, tablename: "opt_outs", indexdef: `CREATE UNIQUE INDEX x ${on} (client_id, channel)` }])
    ].join(", ")} ${TABLE_SQL}`;
    assert.equal((await handle.db.query(elsewhere, [ORG, ...TABLE_PRIVILEGES])).rows[0].has_key, false);
    const other = `WITH ${[
      cte("opt_outs", OPT_OUT_COLS, []),
      cte("pg_indexes", [["schemaname", "text"], ["tablename", "text"], ["indexdef", "text"]],
        [{ schemaname: schema, tablename: "other_table", indexdef: `CREATE UNIQUE INDEX x ON public.other_table USING btree (client_id, channel)` }])
    ].join(", ")} ${TABLE_SQL}`;
    assert.equal((await handle.db.query(other, [ORG, ...TABLE_PRIVILEGES])).rows[0].has_key, false);
  });

  test("table: the count is for the company asked about, and the rights are asked by name", async () => {
    const text = `WITH ${cte("opt_outs", OPT_OUT_COLS, [optOut({}), optOut({ client_id: C2 }), optOut({ org_id: OTHER_ORG })])} ${TABLE_SQL}`;
    const res = (await handle.db.query(text, [ORG, ...TABLE_PRIVILEGES])).rows[0];
    assert.equal(res.n, 2);
    // The two right names are really handed to the check: a name Postgres does not know is refused.
    await assert.rejects(handle.db.query(TABLE_SQL, [ORG, "not_a_right", "update"]), /unrecognized privilege type/);
    await assert.rejects(handle.db.query(TABLE_SQL, [ORG, "insert", "not_a_right"]), /unrecognized privilege type/);
  });
});
