import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  DISPATCH_FILE,
  EMAIL_STOP_WORDS,
  GATE_FILE,
  LOOKBACK_DAYS,
  NOT_CLIENT_SENDS,
  REPO_ROOT,
  SENT_AFTER_SQL,
  SMS_STOP_WORDS,
  STOP_SQL,
  TABLE_SQL,
  directSendIgnoresOptOut,
  dispatchIgnoresOptOut,
  gapChecks,
  gateIgnoresOptOut,
  ignoredSendPaths,
  loadSendSources
} from "./gap-opt-out.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-opt-out.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T22:00:00.000Z");
const KEYS = ["id", "status", "detail", "suggestedFix"];

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
  assert.equal(rows.length, 3);
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

function zeros(sql) {
  if (sql.includes("gap:opt-out-sent-after")) return { rows: [{ people: 0, n: 0 }] };
  return { rows: [{ n: 0 }] };
}

test("gap opt-out: source does not send or write", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /recordOptOut\s*\(/);
  assert.doesNotMatch(SRC, /await\s+dispatch(?:Due|Message|One)\s*\(/);
  assert.doesNotMatch(SRC, /^\s*import\s[^;]*messaging\/providers\/(?:twilio|resend|mailgun)/m);
  assert.equal(CHECK_IDS.length, 3);
});

test("gap opt-out: stop and sent-after sql stay selects and name both channels", () => {
  for (const sql of [TABLE_SQL, STOP_SQL, SENT_AFTER_SQL]) {
    assert.match(sql.trim(), /^SELECT\b/);
    assert.doesNotMatch(sql, /[;]/);
    assert.match(sql, /opt_outs/);
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

test("gap opt-out: no database or no company skips the reads", async () => {
  const noDb = await gapChecks({ sources: honoringSources() });
  shape(noDb);
  assert.equal(noDb[0].status, "skip");
  assert.equal(noDb[1].status, "skip");
  assert.equal(noDb[2].status, "skip");
  assert.match(noDb[0].detail, /No database/);

  let called = false;
  const noOrg = await gapChecks({
    db: { query: async () => { called = true; return { rows: [{ n: 0 }] }; } },
    orgId: "",
    sources: honoringSources()
  });
  shape(noOrg);
  assert.ok(noOrg.every((row) => row.status === "skip"));
  assert.match(noOrg[0].detail, /No company/);
  assert.equal(called, false);
});

test("gap opt-out: a code miss still fails when there is no database", async () => {
  const rows = await gapChecks({
    sources: honoringSources({
      "src/blast.mjs": "import { send } from \"../messaging/providers/twilio.mjs\";\nawait send({ to, body });"
    })
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
    sources: honoringSources()
  });
  shape(rows);
  assert.ok(rows.every((row) => row.status === "PASS"));
  assert.equal(db.seen.length, 3);
  assert.equal(db.seen[0].params[0], ORG);
  assert.equal(db.seen[1].params[0], ORG);
  assert.equal(db.seen[1].params[2], false);
  assert.equal(db.seen[1].params[1], new Date(NOW.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString());
});

test("gap opt-out: table unreadable skips the other counts", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-table")) throw new Error("relation opt_outs does not exist");
    throw new Error("should not run");
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, sources: honoringSources() });
  shape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /could not be read/i);
  assert.match(rows[0].detail, /opt_outs/);
  assert.equal(rows[1].status, "skip");
  assert.equal(rows[2].status, "skip");
  assert.equal(db.seen.length, 1);
});

test("gap opt-out: a STOP that did not stick is FAIL", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-stop")) return { rows: [{ n: 2 }] };
    if (sql.includes("gap:opt-out-sent-after")) return { rows: [{ people: 0, n: 0 }] };
    return { rows: [{ n: 4 }] };
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, sources: honoringSources() });
  shape(rows);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /2 people/);
  assert.match(rows[1].detail, /did not stick/);
  assert.equal(rows[2].status, "PASS");
});

test("gap opt-out: a message after opt-out is FAIL even when the code reads opt-out", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-sent-after")) return { rows: [{ people: 2, n: 5 }] };
    return { rows: [{ n: 0 }] };
  });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, sources: honoringSources() });
  shape(rows);
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /2 people who opted out still got a message/);
  assert.match(rows[2].detail, /5 messages/);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "PASS");
});

test("gap opt-out: one person and one message stays singular", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-stop")) return { rows: [{ n: 1 }] };
    if (sql.includes("gap:opt-out-sent-after")) return { rows: [{ people: 1, n: 1 }] };
    return { rows: [{ n: 0 }] };
  });
  const rows = await gapChecks({ db, orgId: ORG, sources: honoringSources() });
  shape(rows);
  assert.match(rows[1].detail, /1 person sent STOP/);
  assert.match(rows[2].detail, /1 person who opted out still got a message/);
  assert.doesNotMatch(rows[2].detail, /1 messages/);
});

test("gap opt-out: a send path that skips opt-out is FAIL", () => {
  const badGate = "await isOptedOut(db, clientId, \"sms\");";
  const badDispatch = "const result = await provider.send({ to, body });";
  const blast = "import { send as sendSms } from \"../messaging/providers/twilio.mjs\";\nawait sendSms({ to, body });";
  const commentOnly = "// see src/messaging/providers/twilio.mjs\nexport const note = 1;";
  const handsOff = "import { send } from \"../messaging/providers/resend.mjs\";\nawait drain(db);\nawait send(msg);";
  assert.equal(gateIgnoresOptOut(GATE_OK), false);
  assert.equal(gateIgnoresOptOut(badGate), true);
  assert.equal(dispatchIgnoresOptOut(DISPATCH_OK), false);
  assert.equal(dispatchIgnoresOptOut(badDispatch), true);
  assert.equal(directSendIgnoresOptOut(blast), true);
  assert.equal(directSendIgnoresOptOut(commentOnly), false);
  assert.equal(directSendIgnoresOptOut(handsOff), false);

  const misses = ignoredSendPaths(honoringSources({
    "src/blast.mjs": blast,
    "src/note.mjs": commentOnly,
    [NOT_CLIENT_SENDS[0].file]: blast
  }));
  assert.deepEqual(misses.map((row) => row.file), ["src/blast.mjs"]);
});

test("gap opt-out: code miss and a later message both fail the send check", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-sent-after")) return { rows: [{ people: 1, n: 1 }] };
    return { rows: [{ n: 0 }] };
  });
  const rows = await gapChecks({
    db,
    orgId: ORG,
    sources: {
      [GATE_FILE]: "await isOptedOut(db, clientId, \"sms\");",
      [DISPATCH_FILE]: DISPATCH_OK
    }
  });
  shape(rows);
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /gate\.mjs/);
  assert.match(rows[2].detail, /1 person who opted out/);
});

test("gap opt-out: a broken message count fails the send check", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("gap:opt-out-sent-after")) throw new Error("messages read failed");
    return { rows: [{ n: 0 }] };
  });
  const rows = await gapChecks({ db, orgId: ORG, sources: honoringSources() });
  shape(rows);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "PASS");
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /Could not count/);
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
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, root: REPO_ROOT });
  shape(rows);
  assert.ok(rows.every((row) => row.status === "PASS"));
});
