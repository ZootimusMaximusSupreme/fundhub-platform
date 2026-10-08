import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifySession } from "../../auth/session.mjs";
import { CHECKS as SLO_CHECKS } from "./slice-19-slo.mjs";
import { CHECKS as UW_CHECKS } from "./slice-21-underwrite.mjs";
import {
  CHECK_IDS,
  GRACE_MS,
  LETTERS_SQL,
  OFFER_DEAD_LETTER_SQL,
  OFFER_PACK_STATUS_SQL,
  PACK_HANDLERS,
  PACK_SUBTYPES,
  PAID_ROADMAP_SQL,
  READ_DOOR_CLIENT_SQL,
  SLO_PACK_FAILED,
  doorDatabase,
  gapChecks,
  openReadDoor
} from "./gap-underwrite.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-08T20:00:00.000Z");
const HERE = path.dirname(fileURLToPath(import.meta.url));

const IDS = [
  "uw-paid-roadmap-no-pack",
  "uw-letters-missing",
  "uw-offer-fulfillment-failed",
  "uw-read-door"
];

function fakeDb(matchers) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      const hit = matchers.find((row) => row.re.test(sql));
      if (!hit) return { rows: [] };
      if (hit.error) throw new Error(hit.error);
      return { rows: hit.rows };
    }
  };
}

function byId(rows, id) {
  const row = rows.find((item) => item.id === id);
  assert.ok(row, id);
  return row;
}

function assertShape(rows) {
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.id), IDS);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["detail", "id", "status", "suggestedFix"]);
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Recon \(AG-07\)/);
      assert.match(row.suggestedFix, /one tripwire/);
      assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

const OPEN_OK = async () => ({ status: 200, body: { ok: true }, thrown: null });

// Paid-roadmap, letters, pack-job, pack-stamp and door-client reads all clear.
const CLEAR = [
  { re: /FROM payment_links|JOIN payment_links/, rows: [{ n: 0, sample_id: null }] },
  { re: /funding_inquiry_removal/, rows: [{ n: 0, sample_id: null }] },
  { re: /FROM failed_events/, rows: [{ n: 0, handler_name: null, error_message: null }] },
  { re: /slo_pack_status/, rows: [{ n: 0, sample_id: null }] },
  { re: /JOIN crs_results/, rows: [{ id: CLIENT }] }
];

function overrideClear(over) {
  return [...over, ...CLEAR];
}

test("gap checks skip when there is no database", async () => {
  const rows = await gapChecks({});
  assertShape(rows);
  assert.ok(rows.every((row) => row.status === "skip"));
});

test("ids are not the slice 19 or slice 21 registry lists", () => {
  const taken = new Set([...SLO_CHECKS, ...UW_CHECKS].map((row) => row.id));
  for (const id of IDS) assert.equal(taken.has(id), false);
  assert.deepEqual([...CHECK_IDS], IDS);
  assert.ok(!IDS.includes("read/underwrite"));
  assert.ok(!IDS.includes("slo-pack-delivery"));
});

test("a clear book is four PASS rows, and every statement is a read with the right params", async () => {
  const db = fakeDb(CLEAR);
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, openReadDoor: OPEN_OK });
  assertShape(rows);
  assert.ok(rows.every((row) => row.status === "PASS"));
  for (const call of db.calls) assert.match(call.sql, /^\s*SELECT/i);
  const cutoff = new Date(NOW.getTime() - GRACE_MS).toISOString();

  const pack = db.calls.find((call) => /JOIN payment_links/.test(call.sql));
  assert.equal(pack.params[0], cutoff);
  assert.equal(pack.params[1], ORG);
  assert.deepEqual(pack.params[2], PACK_SUBTYPES);
  assert.match(pack.sql, /link_ref LIKE 'slo_%'/);
  assert.match(pack.sql, /pl\.purpose = 'diagnostic'/);
  assert.match(pack.sql, /pl\.status = 'paid' OR pl\.paid_at IS NOT NULL/);
  assert.match(pack.sql, /COALESCE\(pl\.is_demo, false\) = false/);
  // The pull must have finished, after the payment, before the pack is expected.
  assert.match(pack.sql, /e\.name = 'analysis\.completed'/);
  assert.match(pack.sql, /e\.payload->>'source' = 'crs'/);
  assert.match(pack.sql, /e\.created_at >= COALESCE\(pl\.paid_at, pl\.updated_at\)/);
  assert.match(pack.sql, /e\.created_at <= \$1::timestamptz/);
  assert.match(pack.sql, /d\.subtype = ANY\(\$3::text\[\]\)/);

  const letters = db.calls.find((call) => /funding_inquiry_removal/.test(call.sql));
  assert.equal(letters.params[0], cutoff);
  assert.equal(letters.params[1], ORG);
  assert.match(letters.sql, /crs_negative_items_count/);
  assert.match(letters.sql, /dispute_letters/);
  assert.match(letters.sql, /analysis.completed/);
  const dead = db.calls.find((call) => /FROM failed_events/.test(call.sql));
  assert.deepEqual(dead.params[0], PACK_HANDLERS);
  assert.equal(dead.params[1], ORG);
  assert.match(dead.sql, /status IN \('pending', 'exhausted'\)/);
  const stamp = db.calls.find((call) => /slo_pack_status/.test(call.sql));
  assert.equal(stamp.params[0], SLO_PACK_FAILED);
  const doorClient = db.calls.find((call) => /JOIN crs_results/.test(call.sql));
  assert.deepEqual(doorClient.params, [ORG]);
});

test("every SQL this file sends is a SELECT with no write word", () => {
  for (const sql of [PAID_ROADMAP_SQL, LETTERS_SQL, OFFER_DEAD_LETTER_SQL, OFFER_PACK_STATUS_SQL, READ_DOOR_CLIENT_SQL]) {
    assert.match(sql, /^\s*SELECT/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
  }
  const text = fs.readFileSync(path.join(HERE, "gap-underwrite.mjs"), "utf8");
  assert.doesNotMatch(text, /\bfetch\s*\(/);
  assert.doesNotMatch(text, /method:\s*["']POST["']/);
});

test("a paid roadmap client with a finished pull and no pack fails", async () => {
  const db = fakeDb(overrideClear([
    { re: /JOIN payment_links/, rows: [{ n: 2, sample_id: "cl-paid" }] }
  ]));
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, openReadDoor: OPEN_OK });
  const row = byId(rows, "uw-paid-roadmap-no-pack");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 paid roadmap clients have a finished pull and no UnderwriteIQ pack/);
  assert.match(row.detail, /cl-paid/);
  assert.equal(byId(rows, "uw-letters-missing").status, "PASS");
  assertShape(rows);
});

test("letters that should exist and do not fail", async () => {
  const db = fakeDb(overrideClear([
    { re: /funding_inquiry_removal/, rows: [{ n: 1, sample_id: "cl-letters" }] }
  ]));
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, openReadDoor: OPEN_OK });
  const row = byId(rows, "uw-letters-missing");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 client is missing letters/);
  assert.match(row.suggestedFix, /Do not change UnderwriteIQ dollar math/);
});

test("an open pack job failure fails offer fulfillment", async () => {
  const db = fakeDb(overrideClear([
    {
      re: /FROM failed_events/,
      rows: [{ n: 1, handler_name: "onAnalysisCompletedSloPack", error_message: "empty pack" }]
    }
  ]));
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, openReadDoor: OPEN_OK });
  const row = byId(rows, "uw-offer-fulfillment-failed");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /onAnalysisCompletedSloPack/);
  assert.match(row.detail, /empty pack/);
  assert.match(row.suggestedFix, /Do not re-run it from this pulse/);
});

test("Delivery Failed pack status fails offer fulfillment", async () => {
  const db = fakeDb(overrideClear([
    { re: /slo_pack_status/, rows: [{ n: 1, sample_id: "cl-retry" }] }
  ]));
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, openReadDoor: OPEN_OK });
  const row = byId(rows, "uw-offer-fulfillment-failed");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /Delivery Failed — Retry/);
  assert.match(row.detail, /cl-retry/);
});

test("a database error is a fail for that check and the others still run", async () => {
  const db = fakeDb(overrideClear([
    { re: /JOIN payment_links/, error: "pack read down" }
  ]));
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, openReadDoor: OPEN_OK });
  assert.equal(byId(rows, "uw-paid-roadmap-no-pack").status, "FAIL");
  assert.match(byId(rows, "uw-paid-roadmap-no-pack").detail, /pack read down/);
  assert.equal(byId(rows, "uw-letters-missing").status, "PASS");
  assert.equal(byId(rows, "uw-read-door").status, "PASS");
});

test("the read door passes only on a 200 with ok true, and runs for the newest stored credit file", async () => {
  const seen = [];
  const rows = await gapChecks({
    db: fakeDb(CLEAR), orgId: ORG, now: NOW,
    openReadDoor: async (args) => {
      seen.push(args);
      return { status: 200, body: { ok: true }, thrown: null };
    }
  });
  const door = byId(rows, "uw-read-door");
  assert.equal(door.status, "PASS");
  assert.match(door.detail, new RegExp(CLIENT));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].clientId, CLIENT);
  assert.equal(seen[0].orgId, ORG);
});

test("a read door that throws or answers 500 fails, naming the file", async () => {
  const thrown = await gapChecks({
    db: fakeDb(CLEAR), orgId: ORG, now: NOW,
    openReadDoor: async () => ({ status: 0, body: null, thrown: new ReferenceError("linesForEngine is not defined") })
  });
  const a = byId(thrown, "uw-read-door");
  assert.equal(a.status, "FAIL");
  assert.match(a.detail, /would answer 500/);
  assert.match(a.detail, /linesForEngine is not defined/);
  assert.match(a.suggestedFix, /Do not change UnderwriteIQ dollar math/);

  const five = await gapChecks({
    db: fakeDb(CLEAR), orgId: ORG, now: NOW,
    openReadDoor: async () => ({ status: 500, body: { ok: false, error: "internal_error" }, thrown: null })
  });
  assert.equal(byId(five, "uw-read-door").status, "FAIL");
  assert.match(byId(five, "uw-read-door").detail, /answered 500/);

  const gone = await gapChecks({
    db: fakeDb(CLEAR), orgId: ORG, now: NOW,
    openReadDoor: async () => { throw new Error("Cannot find module"); }
  });
  assert.equal(byId(gone, "uw-read-door").status, "FAIL");
  assert.match(byId(gone, "uw-read-door").detail, /would not load/);
});

test("a read door this run could not open is a skip, never a PASS", async () => {
  for (const [status, body] of [
    [401, { ok: false, error: "unauthorized" }],
    [403, { ok: false, error: "forbidden" }],
    [404, { ok: false, error: "client_not_found" }],
    [400, { ok: false, error: "bad request parameter" }],
    [503, { ok: false, error: "auth_unavailable", db: "down" }]
  ]) {
    const rows = await gapChecks({
      db: fakeDb(CLEAR), orgId: ORG, now: NOW,
      openReadDoor: async () => ({ status, body, thrown: null })
    });
    const door = byId(rows, "uw-read-door");
    assert.equal(door.status, "skip", String(status));
    assert.match(door.detail, new RegExp(String(status)));
  }
  // A 200 that is not ok:true is not proof either.
  const odd = await gapChecks({
    db: fakeDb(CLEAR), orgId: ORG, now: NOW,
    openReadDoor: async () => ({ status: 200, body: { ok: false }, thrown: null })
  });
  assert.notEqual(byId(odd, "uw-read-door").status, "PASS");
});

test("no stored credit file or no org means the door is not opened", async () => {
  const none = await gapChecks({
    db: fakeDb(overrideClear([{ re: /JOIN crs_results/, rows: [] }])), orgId: ORG, now: NOW,
    openReadDoor: async () => { throw new Error("must not run"); }
  });
  assert.equal(byId(none, "uw-read-door").status, "skip");
  assert.match(byId(none, "uw-read-door").detail, /no real client has a stored credit file/);
  const noOrg = await gapChecks({
    db: fakeDb(CLEAR), now: NOW,
    openReadDoor: async () => { throw new Error("must not run"); }
  });
  assert.equal(byId(noOrg, "uw-read-door").status, "skip");
  const pick = await gapChecks({
    db: fakeDb(overrideClear([{ re: /JOIN crs_results/, error: "crs_results read down" }])), orgId: ORG, now: NOW,
    openReadDoor: OPEN_OK
  });
  assert.equal(byId(pick, "uw-read-door").status, "FAIL");
  assert.match(byId(pick, "uw-read-door").detail, /crs_results read down/);
});

test("the staff session stand-in answers the real verifySession SQL and writes nothing", async () => {
  const db = fakeDb([]);
  const out = await verifySession(doorDatabase(db, ORG, NOW), "morning-pulse-in-process");
  assert.ok(out, "verifySession must accept the stand-in row");
  assert.equal(out.staff.role, "owner");
  assert.equal(out.staff.org_id, ORG);
  assert.equal(db.calls.length, 0, "the session statement must never reach the real database");
  // Anything that is not the session statement goes to the real database.
  const wrapped = doorDatabase(db, ORG, NOW);
  await wrapped.query("SELECT 1 AS one", []);
  assert.equal(db.calls.length, 1);
});

test("the real read door handler runs in this process on a thin file and answers 200", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      const text = String(sql);
      seen.push(text);
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(text)) throw new Error(`write: ${text}`);
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(text)) {
        assert.deepEqual(params, [CLIENT, ORG]);
        return { rows: [{ id: CLIENT, custom_fields: {} }] };
      }
      return { rows: [] };
    }
  };
  const out = await openReadDoor({ db, orgId: ORG, clientId: CLIENT, now: NOW });
  assert.equal(out.thrown, null);
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.equal(out.body.clientId, CLIENT);
  assert.ok(seen.some((text) => /FROM tradelines/.test(text)));
  assert.ok(seen.some((text) => /FROM crs_results/.test(text)));
  assert.ok(seen.every((text) => !/UPDATE\s+sessions/i.test(text)));
});

test("the real read door shows a break when its engine throws", async () => {
  const db = {
    async query(sql) {
      const text = String(sql);
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(text)) {
        return { rows: [{ id: CLIENT, custom_fields: {} }] };
      }
      if (/FROM tradelines/.test(text)) throw new Error("tradelines read blew up");
      return { rows: [] };
    }
  };
  const out = await openReadDoor({ db, orgId: ORG, clientId: CLIENT, now: NOW });
  assert.ok(out.thrown, "a throwing read must surface as thrown");
  const rows = await gapChecks({
    db: fakeDb(CLEAR), orgId: ORG, now: NOW,
    openReadDoor: async (args) => openReadDoor({ ...args, db })
  });
  const door = byId(rows, "uw-read-door");
  assert.equal(door.status, "FAIL");
  assert.match(door.detail, /tradelines read blew up/);
});
