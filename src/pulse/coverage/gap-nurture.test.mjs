import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  NEVER_QUEUED_SQL,
  QUEUE_GRACE_MS,
  RENEWAL_WAIT_MS,
  STEP_STUCK_SQL,
  NURTURE_WORKFLOW_FILES,
  SEND_PAIRS,
  findSequences,
  gapChecks,
  listLiveSequences,
  listLiveSequencesFromModules,
  liveTemplateKeys,
  nurtureCutoffs
} from "./gap-nurture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const ORG = "11111111-1111-1111-1111-111111111111";
const NOW = new Date("2026-10-08T22:00:00.000Z");

function fakeDb({ never = 0, stuck = 0, throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (throwOn && sql.includes(throwOn)) {
        throw new Error(`relation missing: ${throwOn}`);
      }
      if (sql.includes("gap:nurture-never-queued")) return { rows: [{ n: never }] };
      if (sql.includes("gap:nurture-step-stuck")) return { rows: [{ n: stuck }] };
      throw new Error(`unexpected query: ${String(sql).slice(0, 80)}`);
    }
  };
}

function sequenceSource({ id, on, send, enabled = true }) {
  const trigger = on ? '{ event: "round.closeout" }' : "[]";
  const flag = enabled ? "" : ", enabled: false";
  const call = send ? "sendTemplated(db, { orgId })" : "return { sent: false }";
  return `
    export const fn = inngest.createFunction(
      { id: "${id}"${flag} },
      ${trigger},
      () => { ${call} }
    );
  `;
}

function readMap(map) {
  return (rel) => {
    if (!Object.prototype.hasOwnProperty.call(map, rel)) {
      throw new Error(`missing ${rel}`);
    }
    return map[rel];
  };
}

function offMap() {
  return {
    "src/workflows/n-01-cold-nurture.mjs": sequenceSource({ id: "n-01-cold-nurture", on: false, send: true }),
    "src/workflows/n-02-warm-nurture.mjs": sequenceSource({ id: "n-02-warm-nurture", on: false, send: true }),
    "src/workflows/n-03-hot-nurture.mjs": sequenceSource({ id: "n-03-hot-nurture", on: true, send: false, enabled: false }),
    "src/workflows/n-04-post-funding-nurture.mjs": sequenceSource({ id: "n-04-post-funding-nurture", on: false, send: true }),
    "src/workflows/n-06-renewal-second-wave.mjs": sequenceSource({ id: "n-06-renewal-second-wave", on: false, send: true })
  };
}

function assertShape(rows) {
  assert.equal(rows.length, CHECK_IDS.length);
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  for (const r of rows) {
    assert.equal(typeof r.id, "string");
    assert.ok(r.id.length > 0);
    assert.ok(r.status === "PASS" || r.status === "FAIL" || r.status === "skip");
    assert.equal(typeof r.detail, "string");
    assert.ok(r.detail.length > 0);
    assert.ok(r.suggestedFix === null || typeof r.suggestedFix === "string");
    if (r.status === "FAIL") {
      assert.equal(typeof r.suggestedFix, "string");
      assert.match(r.suggestedFix, /Recon \(AG-07\)/);
      assert.match(r.suggestedFix, /Do not send a text or email/);
      assert.match(r.suggestedFix, /Do not flip outbound/);
      assert.doesNotMatch(r.suggestedFix, /second tripwire|new watchdog/i);
    } else {
      assert.equal(r.suggestedFix, null);
    }
  }
}

test("gap nurture: check ids and the two sql reads stay select-only", () => {
  assert.deepEqual([...CHECK_IDS], [
    "nurture:never-queued",
    "nurture:step-stuck",
    "nurture:on-without-send"
  ]);
  for (const sql of [NEVER_QUEUED_SQL, STEP_STUCK_SQL]) {
    assert.match(sql, /SELECT count\(\*\)::int AS n/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/i);
  }
  assert.match(NEVER_QUEUED_SQL, /payload->>'stage' = 'closed'/);
  assert.match(NEVER_QUEUED_SQL, /engagementComplete/);
  assert.match(NEVER_QUEUED_SQL, /funded_amount/);
  assert.match(NEVER_QUEUED_SQL, /EMAIL-N04-POST-FUNDING/);
  assert.match(NEVER_QUEUED_SQL, /EMAIL-N06-RENEWAL/);
  assert.doesNotMatch(NEVER_QUEUED_SQL, /N01|entry\.captured|next-action-catch-up|PULSE_REGISTRY/);
  assert.match(STEP_STUCK_SQL, /status = 'sending'/);
  assert.match(STEP_STUCK_SQL, /status = 'queued'/);
  assert.match(STEP_STUCK_SQL, /outbound_enabled/);
  assert.doesNotMatch(STEP_STUCK_SQL, /N01|next-action-catch-up/);
  const src = fs.readFileSync(path.join(HERE, "gap-nurture.mjs"), "utf8");
  assert.doesNotMatch(src, /PULSE_REGISTRY|slice-16-nurture|registry\.mjs/);
});

test("gap nurture: real workflow files turn on only n-04 and n-06, and both send", () => {
  const live = listLiveSequences();
  assert.deepEqual(live.map((seq) => seq.id), [
    "n-04-post-funding-nurture",
    "n-06-renewal-second-wave"
  ]);
  assert.ok(live.every((seq) => seq.on && seq.sends));
  assert.deepEqual(liveTemplateKeys(live), [
    "EMAIL-N04-POST-FUNDING",
    "SMS-N04-POST-FUNDING",
    "EMAIL-N06-RENEWAL",
    "SMS-N06-RENEWAL"
  ]);
});

test("gap nurture: a disabled sequence and an empty trigger are not on", () => {
  const disabled = findSequences(sequenceSource({
    id: "n-03-hot-nurture",
    on: true,
    send: false,
    enabled: false
  }));
  assert.equal(disabled[0].on, false);
  const retired = findSequences(sequenceSource({
    id: "n-01-cold-nurture",
    on: false,
    send: true
  }));
  assert.equal(retired[0].on, false);
  const armed = findSequences(sequenceSource({
    id: "n-04-post-funding-nurture",
    on: true,
    send: false
  }));
  assert.equal(armed[0].on, true);
});

test("gap nurture: no database skips the two data checks and still reads the code", async () => {
  const rows = await gapChecks({ now: NOW });
  assertShape(rows);
  assert.equal(rows[0].status, "skip");
  assert.equal(rows[1].status, "skip");
  assert.equal(rows[2].status, "PASS");
});

test("gap nurture: clean live sequences pass and the clock matches the grace and the 180 day wait", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  assertShape(rows);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(db.calls.length, 2);
  const cut = nurtureCutoffs(NOW);
  assert.equal(cut.queueBefore, new Date(NOW.getTime() - QUEUE_GRACE_MS).toISOString());
  assert.equal(
    cut.renewalBefore,
    new Date(NOW.getTime() - RENEWAL_WAIT_MS - QUEUE_GRACE_MS).toISOString()
  );
  assert.deepEqual(db.calls[0].params, [ORG, cut.queueBefore, cut.renewalBefore, true, true]);
  assert.deepEqual(db.calls[1].params[0], ORG);
  assert.equal(db.calls[1].params[1], cut.queueBefore);
  assert.deepEqual(db.calls[1].params[2], [
    "EMAIL-N04-POST-FUNDING",
    "SMS-N04-POST-FUNDING",
    "EMAIL-N06-RENEWAL",
    "SMS-N06-RENEWAL"
  ]);
  assert.equal(db.calls[1].params[3], true);
  assert.equal(db.calls[1].params[4], true);
});

test("gap nurture: a person with no queued send, and a stuck step, both fail", async () => {
  const db = fakeDb({ never: 2, stuck: 1 });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  assertShape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /2 lead or clients/);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /1 nurture step stuck/);
  assert.equal(rows[2].status, "PASS");
});

test("gap nurture: a database error is a fail and does not send", async () => {
  const db = fakeDb({ throwOn: "gap:nurture-never-queued" });
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  assertShape(rows);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /could not read the nurture queue/);
  assert.equal(rows[1].status, "PASS");
});

test("gap nurture: sequences that are off do not query, and a turned-on sequence with no send fails", async () => {
  const quiet = fakeDb({ never: 9, stuck: 9 });
  const quietRows = await gapChecks({
    db: quiet,
    orgId: ORG,
    now: NOW,
    readText: readMap(offMap())
  });
  assertShape(quietRows);
  assert.ok(quietRows.every((r) => r.status === "PASS"));
  assert.equal(quiet.calls.length, 0);

  const map = offMap();
  map["src/workflows/n-04-post-funding-nurture.mjs"] = sequenceSource({
    id: "n-04-post-funding-nurture",
    on: true,
    send: false
  });
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, readText: readMap(map) });
  assertShape(rows);
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /n-04-post-funding-nurture/);
  assert.match(rows[2].detail, /no send row/);
  assert.deepEqual(db.calls[0].params.slice(3), [true, false]);
  assert.deepEqual(db.calls[1].params[2], ["EMAIL-N04-POST-FUNDING", "SMS-N04-POST-FUNDING"]);
  assert.equal(db.calls[1].params[4], false);
});

test("gap nurture: an unreadable workflow file fails closed", async () => {
  const db = fakeDb();
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    readText: () => {
      throw new Error("disk gone");
    }
  });
  assertShape(rows);
  assert.ok(rows.every((r) => r.status === "FAIL"));
  assert.match(rows[2].detail, /could not read nurture sequences/);
  assert.equal(db.calls.length, 0);
});

test("gap nurture: this file does not import a sender", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/pulse/coverage/gap-nurture.mjs"), "utf8");
  assert.doesNotMatch(src, /from ["'].*messaging/);
  assert.doesNotMatch(src, /sendTemplated\s*\(/);
  assert.doesNotMatch(src, /outbound_enabled\s*=/);
  assert.equal(fs.existsSync(path.join(ROOT, "src/workflows/n-05-repair-complete-nurture.mjs")), false);
});

test("gap nurture: the never-queued read finds the person by email, because closeout and funded events have no client id", () => {
  // Measured 2026-10-08: 0 of 5 round.closeout and 0 of 4 round.funded events carry a client_id.
  // A join on e.client_id could never match one, so this check could never fail.
  assert.doesNotMatch(NEVER_QUEUED_SQL, /JOIN clients c ON c\.id = e\.client_id/);
  assert.equal((NEVER_QUEUED_SQL.match(/COALESCE\(\s*e\.client_id,/g) || []).length, 2);
  assert.equal((NEVER_QUEUED_SQL.match(/lower\(c0\.email\) = lower\(btrim\(COALESCE\(e\.payload->>'email'/g) || []).length, 2);
  assert.match(NEVER_QUEUED_SQL, /fr\.client_id = rc\.id/);
  assert.doesNotMatch(NEVER_QUEUED_SQL, /fr\.client_id = e\.client_id/);
  // The message is matched by the event id it was written for, not by who the client is.
  assert.doesNotMatch(NEVER_QUEUED_SQL, /m\.client_id = e\.client_id/);
  assert.match(NEVER_QUEUED_SQL, /'workflow:EMAIL-N04-POST-FUNDING:' \|\| e\.id::text/);
  assert.match(NEVER_QUEUED_SQL, /'workflow:SMS-N06-RENEWAL:' \|\| e\.id::text/);
  // One old event cannot shout forever.
  assert.equal((NEVER_QUEUED_SQL.match(/interval '7 days'/g) || []).length, 2);
  assert.match(NEVER_QUEUED_SQL, /e\.created_at >= \$2::timestamptz - interval '7 days'/);
  assert.match(NEVER_QUEUED_SQL, /e\.created_at >= \$3::timestamptz - interval '7 days'/);
});

test("gap nurture: a half pair is not a miss when the person opted out of texts", () => {
  assert.equal((STEP_STUCK_SQL.match(/o\.channel = 'sms' AND o\.opted_in_at IS NULL/g) || []).length, 2);
  assert.match(STEP_STUCK_SQL, /m\.template_key = 'EMAIL-N04-POST-FUNDING'\s+AND EXISTS/);
  assert.match(STEP_STUCK_SQL, /m\.template_key = 'EMAIL-N06-RENEWAL'\s+AND EXISTS/);
  assert.equal((STEP_STUCK_SQL.match(/interval '7 days'/g) || []).length, 2);
});

test("gap nurture: the live list comes from the loaded workflow modules, and matches the source files", async () => {
  const fromModules = await listLiveSequencesFromModules();
  const fromFiles = listLiveSequences();
  assert.deepEqual(fromModules, fromFiles);
  assert.deepEqual(fromModules.map((seq) => seq.id), [
    "n-04-post-funding-nurture",
    "n-06-renewal-second-wave"
  ]);
});

test("gap nurture: module reading honors enabled false, an empty trigger, and a handler that never sends", async () => {
  const fn = (opts) => ({ opts });
  const loaders = Object.fromEntries(NURTURE_WORKFLOW_FILES.map((file) => [file, async () => ({})]));
  loaders["src/workflows/n-03-hot-nurture.mjs"] = async () => ({
    handle: async () => 1,
    n03: fn({ id: "n-03-hot-nurture", enabled: false, triggers: [{ event: "x" }] })
  });
  loaders["src/workflows/n-01-cold-nurture.mjs"] = async () => ({
    handle: async () => 1,
    n01: fn({ id: "n-01-cold-nurture", triggers: [] })
  });
  loaders["src/workflows/n-04-post-funding-nurture.mjs"] = async () => ({
    handle: async () => 1,
    n04: fn({ id: "n-04-post-funding-nurture", triggers: [{ event: "round.closeout" }] })
  });
  loaders["src/workflows/n-06-renewal-second-wave.mjs"] = async () => ({
    handle: async ({ db }) => { await sendTemplated2(db, {}); },
    n06: fn({ id: "n-06-renewal-second-wave", triggers: [{ event: "round.funded" }] })
  });
  const live = await listLiveSequencesFromModules(loaders);
  assert.deepEqual(live.map((seq) => [seq.id, seq.sends]), [
    ["n-04-post-funding-nurture", false],
    ["n-06-renewal-second-wave", true]
  ]);
});

test("gap nurture: with no readText the sequences come from the modules, not from a file read", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  assertShape(rows);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls[0].params.slice(3), [true, true]);
});

test("gap nurture: the template keys and triggers still match the n-04 and n-06 workflows", async () => {
  const n04 = await import("../../workflows/n-04-post-funding-nurture.mjs");
  const n06 = await import("../../workflows/n-06-renewal-second-wave.mjs");
  const pair04 = SEND_PAIRS.find((p) => p.id === "n-04-post-funding-nurture");
  const pair06 = SEND_PAIRS.find((p) => p.id === "n-06-renewal-second-wave");
  assert.equal(n04.EMAIL_TEMPLATE_KEY, pair04.email);
  assert.equal(n04.SMS_TEMPLATE_KEY, pair04.sms);
  assert.equal(n06.EMAIL_TEMPLATE_KEY, pair06.email);
  assert.equal(n06.SMS_TEMPLATE_KEY, pair06.sms);
  assert.deepEqual(n04.n04PostFundingNurture.opts.triggers, [{ event: pair04.event }]);
  assert.deepEqual(n06.n06RenewalSecondWave.opts.triggers, [{ event: pair06.event }]);
  const src04 = fs.readFileSync(path.join(ROOT, "src/workflows/n-04-post-funding-nurture.mjs"), "utf8");
  const src06 = fs.readFileSync(path.join(ROOT, "src/workflows/n-06-renewal-second-wave.mjs"), "utf8");
  // The ref the SQL looks for is workflow:<template>:<event id>. sendTemplated builds it from eventId.
  assert.match(src04, /payload\.stage === "closed" \|\| payload\.engagementComplete === true/);
  assert.match(src04, /const eventId = event\.id;/);
  assert.match(src06, /const eventId = event\.id;/);
  assert.match(src06, /step\.sleep\("wait-6-months", "180d"\)/);
  assert.match(src06, /funded_amount > 0/);
  const messaging = fs.readFileSync(path.join(ROOT, "src/workflows/messaging.mjs"), "utf8");
  assert.match(messaging, /const providerRef = `workflow:\$\{templateKey\}:\$\{eventId\}`;/);
});

test("gap nurture: a blank count is a skip, and a failed step read is a fail", async () => {
  const blank = {
    async query(sql) {
      if (sql.includes("gap:nurture-never-queued")) return { rows: [{}] };
      return { rows: [] };
    }
  };
  const rows = await gapChecks({ db: blank, orgId: ORG, now: NOW });
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /unreadable/);
  assert.equal(rows[1].status, "skip");
  assert.equal(rows[2].status, "PASS");

  const rows2 = await gapChecks({ db: fakeDb({ throwOn: "gap:nurture-step-stuck" }), orgId: ORG, now: NOW });
  assert.equal(rows2[0].status, "PASS");
  assert.equal(rows2[1].status, "FAIL");
  assert.match(rows2[1].detail, /could not read nurture steps/);
});

test("gap nurture: a database with no company skips and says so", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, now: NOW });
  assertShape(rows);
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /no company/);
  assert.equal(db.calls.length, 0);
});

