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
  findSequences,
  gapChecks,
  listLiveSequences,
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
