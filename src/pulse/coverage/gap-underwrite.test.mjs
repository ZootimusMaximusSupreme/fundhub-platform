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
  MAP_OWED_FROM,
  OFFER_DEAD_LETTER_SQL,
  OFFER_PACK_STATUS_SQL,
  PACK_ANCHOR_SUBTYPES,
  PACK_EMAIL_PATHS,
  PACK_EMAIL_SQL,
  PACK_EMAIL_TEMPLATE,
  PACK_FILES_SQL,
  PACK_HANDLERS,
  PACK_REQUIRED_SUBTYPES,
  PACK_SETTLE_MS,
  PACK_SUBTYPES,
  PACK_TEMPLATE_SQL,
  PAID_ROADMAP_SQL,
  READ_DOOR_CLIENT_SQL,
  SLO_PACK_FAILED,
  SUMMARY_NOT_OWED_TIERS,
  SUMMARY_OWED_TIERS,
  doorDatabase,
  gapChecks,
  judgePackEmail,
  judgePackFiles,
  judgePackTemplate,
  openReadDoor,
  summaryOwed
} from "./gap-underwrite.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-08T20:00:00.000Z");
const HERE = path.dirname(fileURLToPath(import.meta.url));

const IDS = [
  "uw-paid-roadmap-no-pack",
  "uw-letters-missing",
  "uw-offer-fulfillment-failed",
  "uw-read-door",
  "uw-pack-files-incomplete",
  "uw-pack-email-not-queued"
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
  assert.equal(rows.length, IDS.length);
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
// Pack files: none saved. Pack email: nobody owed, and the template is approved.
const READY_TEMPLATE = { body: "Your pack is ready", subject: "Your file is complete", compliance_passed: true };
const CLEAR = [
  { re: /uw-pack-files/, rows: [] },
  { re: /uw-pack-email/, rows: [] },
  { re: /FROM message_templates/, rows: [READY_TEMPLATE] },
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

test("a clear book is six PASS rows, and every statement is a read with the right params", async () => {
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
  const packFiles = db.calls.find((call) => /uw-pack-files/.test(call.sql));
  assert.deepEqual(packFiles.params, [ORG, PACK_ANCHOR_SUBTYPES]);
  const packEmail = db.calls.find((call) => /uw-pack-email/.test(call.sql));
  assert.deepEqual(packEmail.params, [ORG, PACK_SUBTYPES, PACK_EMAIL_PATHS, PACK_EMAIL_TEMPLATE]);
  const packTpl = db.calls.find((call) => /FROM message_templates/.test(call.sql));
  assert.deepEqual(packTpl.params, [ORG, PACK_EMAIL_TEMPLATE]);
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

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1, Claude 2026-10-09: uw-pack-files-incomplete and uw-pack-email-not-queued
// The SQL only gathers facts. These tests feed fact rows to the real judges, so a
// change to the logic breaks a test.
// ─────────────────────────────────────────────────────────────────────────────

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (msAgo) => new Date(NOW.getTime() - msAgo);

// A whole, settled, non-roadmap pack: five files, 3 hours old, nothing wrong.
function filesRow(over = {}) {
  return {
    client_id: CLIENT,
    subtypes: [...PACK_REQUIRED_SUBTYPES],
    first_at: at(3 * HOUR),
    last_at: at(3 * HOUR),
    empty_n: 0,
    short_n: 0,
    slo: false,
    // The credit tier the pack was built on. A funding tier is owed the Capital
    // Readiness Summary, so the old tests keep their meaning. Tests for repair,
    // hold and unknown tiers say so out loud.
    tier: "FUNDING_PLUS_REPAIR",
    ...over
  };
}

// A settled pack with all four core files and no email yet.
function emailRow(over = {}) {
  return {
    client_id: CLIENT,
    core_n: 4,
    first_at: at(3 * HOUR),
    last_at: at(3 * HOUR),
    email_path: false,
    slo: true,
    email_at: null,
    ...over
  };
}

function runWith(matchers, extra = {}) {
  return gapChecks({ db: fakeDb([...matchers, ...CLEAR]), orgId: ORG, now: NOW, openReadDoor: OPEN_OK, ...extra });
}

const filesAre = (rows) => ({ re: /uw-pack-files/, rows });
const emailsAre = (rows) => ({ re: /uw-pack-email/, rows });

test("every new SQL is one SELECT, reads only, and never carries a write word", () => {
  for (const sql of [PACK_FILES_SQL, PACK_EMAIL_SQL, PACK_TEMPLATE_SQL]) {
    assert.match(sql, /^\s*SELECT/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  }
  // Real clients only, deliverables only, in this company only.
  for (const sql of [PACK_FILES_SQL, PACK_EMAIL_SQL]) {
    assert.match(sql, /d\.kind = 'deliverable'/);
    assert.match(sql, /COALESCE\(d\.is_demo, false\) = false/);
    assert.match(sql, /COALESCE\(c\.is_demo, false\) = false/);
    assert.match(sql, /\$1::uuid IS NULL OR d\.org_id = \$1::uuid/);
  }
  assert.match(PACK_FILES_SQL, /d\.byte_size = 0/);
  assert.match(PACK_FILES_SQL, /metadata->>'engine' = 'pdf-lib'/);
  assert.match(PACK_EMAIL_SQL, /m\.template_key = \$4/);
  const text = fs.readFileSync(path.join(HERE, "gap-underwrite.mjs"), "utf8");
  assert.doesNotMatch(text, /\bfetch\s*\(/);
  assert.doesNotMatch(text, /\b(BEGIN|COMMIT|ROLLBACK)\b\s*["'`]/);
});

test("the new constants match the code they watch", async () => {
  const { SLO_PACK_EMAIL } = await import("../../slo/deliver.mjs");
  assert.equal(PACK_EMAIL_TEMPLATE, SLO_PACK_EMAIL);
  const { FUNDING_ANALYSIS_SUBTYPE } = await import("../../underwrite/funding-letter-pdf.mjs");
  const known = new Set(Object.values(FUNDING_ANALYSIS_SUBTYPE));
  for (const subtype of PACK_ANCHOR_SUBTYPES) assert.ok(known.has(subtype), `${subtype} is not a subtype the saver writes`);
  assert.deepEqual([...PACK_REQUIRED_SUBTYPES], [...PACK_SUBTYPES, "funding_summary"]);
  assert.ok(PACK_ANCHOR_SUBTYPES.includes("business_duplication_map"));
  assert.ok(PACK_ANCHOR_SUBTYPES.includes("business_prep_summary"));
  // The Guide is conditional (thin file or authorized-user client): never required.
  assert.ok(!PACK_REQUIRED_SUBTYPES.includes("business_prep_summary"));
  assert.ok(!PACK_REQUIRED_SUBTYPES.includes("business_duplication_map"));
  // The two places that save the pack and queue the email in one breath.
  const slo = fs.readFileSync(path.join(HERE, "../../slo/deliver.mjs"), "utf8");
  const deck = fs.readFileSync(path.join(HERE, "../../sales/closer-deck.mjs"), "utf8");
  assert.match(slo, /generatedBy:\s*"slo-pack"/);
  assert.match(deck, /generatedBy:\s*"closer-deck"/);
  assert.deepEqual([...PACK_EMAIL_PATHS], ["slo-pack", "closer-deck"]);
  assert.equal(PACK_SETTLE_MS, 30 * MIN);
  assert.ok(Number.isFinite(Date.parse(MAP_OWED_FROM)));
});

test("the two new ids are used by no other lane or slice", () => {
  const ids = ["uw-pack-files-incomplete", "uw-pack-email-not-queued"];
  for (const file of fs.readdirSync(HERE)) {
    if (!/\.mjs$/.test(file) || /^gap-underwrite(\.test)?\.mjs$/.test(file)) continue;
    const text = fs.readFileSync(path.join(HERE, file), "utf8");
    for (const id of ids) assert.equal(text.includes(id), false, `${id} also in ${file}`);
  }
  assert.ok(CHECK_IDS.includes(ids[0]) && CHECK_IDS.includes(ids[1]));
});

// ── uw-pack-files-incomplete ────────────────────────────────────────────────

test("files: a whole pack is PASS, and no pack at all is PASS with a plain word", async () => {
  const whole = byId(await runWith([filesAre([filesRow()])]), "uw-pack-files-incomplete");
  assert.equal(whole.status, "PASS");
  assert.match(whole.detail, /all 1 saved pack has every promised file/);
  const none = byId(await runWith([filesAre([])]), "uw-pack-files-incomplete");
  assert.equal(none.status, "PASS");
  assert.match(none.detail, /no pack has been saved/);
  // Two packs: plural wording.
  const two = byId(await runWith([filesAre([filesRow(), filesRow({ client_id: "c-2" })])]), "uw-pack-files-incomplete");
  assert.match(two.detail, /all 2 saved packs have every promised file/);
});

test("files: a missing Capital Readiness Summary fails and names it", async () => {
  const subtypes = PACK_REQUIRED_SUBTYPES.filter((s) => s !== "funding_summary");
  const rows = await runWith([filesAre([filesRow({ subtypes })])]);
  const row = byId(rows, "uw-pack-files-incomplete");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 of 1 saved pack is not whole/);
  assert.match(row.detail, /Client 22222222 is missing the Capital Readiness Summary/);
  assert.match(row.suggestedFix, /Do not rebuild it from this pulse/);
  assertShape(rows);
});

test("files: each of the four core files, missing alone, fails", async () => {
  for (const gone of PACK_SUBTYPES) {
    const subtypes = PACK_REQUIRED_SUBTYPES.filter((s) => s !== gone);
    const row = byId(await runWith([filesAre([filesRow({ subtypes })])]), "uw-pack-files-incomplete");
    assert.equal(row.status, "FAIL", gone);
  }
  const some = byId(await runWith([filesAre([filesRow({ subtypes: ["funding_snapshot"] })])]), "uw-pack-files-incomplete");
  assert.equal(some.status, "FAIL");
  assert.match(some.detail, /Credit Analysis Report, Credit Optimization Roadmap, Bank and Lender Match List, Capital Readiness Summary/);
});

test("files: a pack file with 0 bytes fails, and an unknown size does not", async () => {
  const empty = byId(await runWith([filesAre([filesRow({ empty_n: 2 })])]), "uw-pack-files-incomplete");
  assert.equal(empty.status, "FAIL");
  assert.match(empty.detail, /has 2 pack files with 0 bytes/);
  const one = byId(await runWith([filesAre([filesRow({ empty_n: 1 })])]), "uw-pack-files-incomplete");
  assert.match(one.detail, /has 1 pack file with 0 bytes/);
  // byte_size NULL is unknown. The SQL counts only = 0, so the count arrives 0.
  const unknown = byId(await runWith([filesAre([filesRow({ empty_n: 0 })])]), "uw-pack-files-incomplete");
  assert.equal(unknown.status, "PASS");
  // A bad count (null from a driver quirk) is read as 0, never as a break.
  const nul = byId(await runWith([filesAre([filesRow({ empty_n: null, short_n: undefined })])]), "uw-pack-files-incomplete");
  assert.equal(nul.status, "PASS");
});

test("files: a pack file made by the short fallback printer fails", async () => {
  const row = byId(await runWith([filesAre([filesRow({ short_n: 4 })])]), "uw-pack-files-incomplete");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /has 4 pack files made by the short fallback printer/);
});

test("files: the free map is owed to a roadmap buyer from the day it shipped, and to nobody else", async () => {
  const afterShip = at(HOUR); // 2026-10-08, after MAP_OWED_FROM
  assert.ok(afterShip.getTime() > Date.parse(MAP_OWED_FROM));
  const buyerNoMap = byId(await runWith([filesAre([filesRow({ slo: true, first_at: at(3 * HOUR), last_at: at(3 * HOUR) })])]), "uw-pack-files-incomplete");
  assert.equal(buyerNoMap.status, "FAIL");
  assert.match(buyerNoMap.detail, /is missing the Business Duplication Map, the free bonus/);

  const withMap = [...PACK_REQUIRED_SUBTYPES, "business_duplication_map"];
  const buyerMap = byId(await runWith([filesAre([filesRow({ slo: true, subtypes: withMap })])]), "uw-pack-files-incomplete");
  assert.equal(buyerMap.status, "PASS");

  // Not a roadmap buyer: no map owed.
  const other = byId(await runWith([filesAre([filesRow({ slo: false })])]), "uw-pack-files-incomplete");
  assert.equal(other.status, "PASS");

  // A roadmap pack first saved before the map existed could never hold one.
  const before = new Date(Date.parse(MAP_OWED_FROM) - 5 * HOUR);
  const old = byId(await runWith([filesAre([filesRow({ slo: true, first_at: before, last_at: before })])]), "uw-pack-files-incomplete");
  assert.equal(old.status, "PASS");
});

test("files: the Business Readiness Guide is optional, and counts as a pack file when it is the only one", async () => {
  const guideAbsent = byId(await runWith([filesAre([filesRow()])]), "uw-pack-files-incomplete");
  assert.equal(guideAbsent.status, "PASS");
  const guidePresent = byId(await runWith([filesAre([filesRow({ subtypes: [...PACK_REQUIRED_SUBTYPES, "business_prep_summary"] })])]), "uw-pack-files-incomplete");
  assert.equal(guidePresent.status, "PASS");
  const guideAlone = byId(await runWith([filesAre([filesRow({ subtypes: ["business_prep_summary"] })])]), "uw-pack-files-incomplete");
  assert.equal(guideAlone.status, "FAIL");
});

test("files: one pack that is whole does not hide one that is not, and the detail stays short", async () => {
  const rows = [
    filesRow({ client_id: "aaaaaaaa-0000-4000-8000-000000000001" }),
    filesRow({ client_id: "bbbbbbbb-0000-4000-8000-000000000002", subtypes: ["credit_analysis_report"] }),
    filesRow({ client_id: "cccccccc-0000-4000-8000-000000000003", empty_n: 1 }),
    filesRow({ client_id: "dddddddd-0000-4000-8000-000000000004", short_n: 1 }),
    filesRow({ client_id: "eeeeeeee-0000-4000-8000-000000000005", short_n: 1 })
  ];
  const row = byId(await runWith([filesAre(rows)]), "uw-pack-files-incomplete");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /4 of 5 saved packs are not whole/);
  assert.match(row.detail, /Client bbbbbbbb/);
  assert.doesNotMatch(row.detail, /Client aaaaaaaa/);
  assert.doesNotMatch(row.detail, /Client eeeeeeee/, "only the first three are named");
});

test("files: a pack still being saved is not judged until 30 minutes after its newest file", () => {
  const partial = filesRow({ subtypes: ["credit_analysis_report"], first_at: at(12 * MIN), last_at: at(10 * MIN) });
  const early = judgePackFiles([partial], NOW);
  assert.deepEqual(early, { checked: 0, bad: [], unsure: [], exempt: 0 });
  const justUnder = judgePackFiles([filesRow({ subtypes: ["credit_analysis_report"], last_at: at(PACK_SETTLE_MS - 1000) })], NOW);
  assert.equal(justUnder.checked, 0);
  const settled = judgePackFiles([filesRow({ subtypes: ["credit_analysis_report"], last_at: at(PACK_SETTLE_MS + 1000) })], NOW);
  assert.equal(settled.checked, 1);
  assert.equal(settled.bad.length, 1);
  // The same row, judged later, flips from quiet to red.
  const later = new Date(NOW.getTime() + 25 * MIN);
  assert.equal(judgePackFiles([partial], later).bad.length, 1);
});

test("files: the judge reads ISO strings as well as dates, and ignores garbage rows", () => {
  const strings = judgePackFiles([filesRow({ subtypes: ["funding_summary"], first_at: at(3 * HOUR).toISOString(), last_at: at(3 * HOUR).toISOString() })], NOW);
  assert.equal(strings.bad.length, 1);
  const junk = judgePackFiles([null, undefined, {}, { last_at: "not a date" }, filesRow()], NOW);
  assert.deepEqual(junk, { checked: 1, bad: [], unsure: [], exempt: 0 });
  assert.deepEqual(judgePackFiles(null, NOW), { checked: 0, bad: [], unsure: [], exempt: 0 });
});

test("files: a database error is a skip with the reason, never a PASS or a false FAIL", async () => {
  const rows = await runWith([{ re: /uw-pack-files/, error: "documents read down" }]);
  const row = byId(rows, "uw-pack-files-incomplete");
  assert.equal(row.status, "skip");
  assert.match(row.detail, /documents read down/);
  assertShape(rows);
});

// ── uw-pack-email-not-queued ────────────────────────────────────────────────

test("email: a roadmap buyer with a settled pack, told after the first file, is PASS", async () => {
  const row = byId(await runWith([emailsAre([emailRow({ email_at: at(2 * HOUR) })])]), "uw-pack-email-not-queued");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /all 1 buyer owed the pack email has one queued/);
});

test("email: a roadmap buyer with a settled pack and no pack email fails and names the client", async () => {
  const rows = await runWith([emailsAre([emailRow({ email_at: null })])]);
  const row = byId(rows, "uw-pack-email-not-queued");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 buyer has a saved pack older than 30 minutes and no pack-ready email was queued/);
  assert.match(row.detail, /Client 22222222/);
  assert.match(row.suggestedFix, /Do not send from this pulse/);
  assert.match(row.suggestedFix, new RegExp(PACK_EMAIL_TEMPLATE));
  assertShape(rows);
});

test("email: a pack email queued BEFORE the first file does not count as told", async () => {
  const row = byId(await runWith([emailsAre([emailRow({ email_at: at(5 * HOUR) })])]), "uw-pack-email-not-queued");
  assert.equal(row.status, "FAIL");
  // Queued the same instant as the first file counts.
  const same = byId(await runWith([emailsAre([emailRow({ email_at: at(3 * HOUR) })])]), "uw-pack-email-not-queued");
  assert.equal(same.status, "PASS");
});

test("email: the closer deck and slo-pack saves are owed the email too, even with no slo_ref", async () => {
  const deck = byId(await runWith([emailsAre([emailRow({ slo: false, email_path: true })])]), "uw-pack-email-not-queued");
  assert.equal(deck.status, "FAIL");
});

test("email: a pack saved only by the CRS router is not owed the pack email", async () => {
  // Same shape as the one real pack on live: four core files, no slo_ref, no email path.
  const row = byId(await runWith([emailsAre([emailRow({ slo: false, email_path: false })])]), "uw-pack-email-not-queued");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /no buyer is waiting on a pack-ready email/);
});

test("email: not owed while the pack is still saving, or with fewer than four core files", async () => {
  const fresh = byId(await runWith([emailsAre([emailRow({ first_at: at(20 * MIN), last_at: at(10 * MIN) })])]), "uw-pack-email-not-queued");
  assert.equal(fresh.status, "PASS");
  const three = byId(await runWith([emailsAre([emailRow({ core_n: 3 })])]), "uw-pack-email-not-queued");
  assert.equal(three.status, "PASS");
  // The same fresh row, judged 25 minutes later, is owed and red.
  const later = new Date(NOW.getTime() + 25 * MIN);
  const flip = judgePackEmail([emailRow({ first_at: at(20 * MIN), last_at: at(10 * MIN) })], later);
  assert.deepEqual(flip.notTold, [CLIENT]);
});

test("email: the judge counts owed and not told apart, and survives garbage rows", () => {
  const out = judgePackEmail([
    emailRow({ client_id: "told", email_at: at(HOUR) }),
    emailRow({ client_id: "silent" }),
    emailRow({ client_id: "router", slo: false }),
    null, undefined, {}, { core_n: 4, slo: true, first_at: "not a date", last_at: "nope" }
  ], NOW);
  assert.deepEqual(out, { owed: 2, notTold: ["silent"] });
  assert.deepEqual(judgePackEmail(null, NOW), { owed: 0, notTold: [] });
});

test("email: a template that is missing, draft or not approved fails even when nobody is owed yet", async () => {
  const missing = byId(await runWith([{ re: /FROM message_templates/, rows: [] }]), "uw-pack-email-not-queued");
  assert.equal(missing.status, "FAIL");
  assert.match(missing.detail, /has no row, so no pack-ready email can be queued/);
  const draft = byId(await runWith([{ re: /FROM message_templates/, rows: [{ ...READY_TEMPLATE, body: "[DRAFT] write me" }] }]), "uw-pack-email-not-queued");
  assert.equal(draft.status, "FAIL");
  assert.match(draft.detail, /still holds draft copy/);
  const draftSubject = byId(await runWith([{ re: /FROM message_templates/, rows: [{ ...READY_TEMPLATE, subject: "[DRAFT] subject" }] }]), "uw-pack-email-not-queued");
  assert.equal(draftSubject.status, "FAIL");
  const unapproved = byId(await runWith([{ re: /FROM message_templates/, rows: [{ ...READY_TEMPLATE, compliance_passed: false }] }]), "uw-pack-email-not-queued");
  assert.equal(unapproved.status, "FAIL");
  assert.match(unapproved.detail, /is not approved/);
  assert.equal(judgePackTemplate(READY_TEMPLATE), null);
  assert.equal(judgePackTemplate(null) === null, false);
});

test("email: an unready template and a silent buyer are both said in one row", async () => {
  const row = byId(await runWith([
    emailsAre([emailRow()]),
    { re: /FROM message_templates/, rows: [{ ...READY_TEMPLATE, compliance_passed: false }] }
  ]), "uw-pack-email-not-queued");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /no pack-ready email was queued/);
  assert.match(row.detail, /is not approved/);
});

test("email: it reads the template for this company only, with the same key sendTemplated uses", async () => {
  const db = fakeDb(CLEAR);
  await gapChecks({ db, orgId: ORG, now: NOW, openReadDoor: OPEN_OK });
  const call = db.calls.find((c) => /FROM message_templates/.test(c.sql));
  assert.deepEqual(call.params, [ORG, "EMAIL-U02-ANALYZER-FUNDING-DELIVERY"]);
  assert.match(call.sql, /org_id = \$1::uuid/);
  assert.match(call.sql, /template_key = \$2/);
});

test("email: read failures are a skip, and a known red still shows through a failed read", async () => {
  const factsDown = byId(await runWith([{ re: /uw-pack-email/, error: "messages read down" }]), "uw-pack-email-not-queued");
  assert.equal(factsDown.status, "skip");
  assert.match(factsDown.detail, /messages read down/);

  const tplDown = byId(await runWith([{ re: /FROM message_templates/, error: "templates read down" }]), "uw-pack-email-not-queued");
  assert.equal(tplDown.status, "skip");
  assert.match(tplDown.detail, /templates read down/);

  // The template read failed, but a buyer is plainly not told: that is still red.
  const red = byId(await runWith([
    emailsAre([emailRow()]),
    { re: /FROM message_templates/, error: "templates read down" }
  ]), "uw-pack-email-not-queued");
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /no pack-ready email was queued/);
});

test("email: with no company id the template is not read, so the row skips instead of passing", async () => {
  const db = fakeDb(CLEAR);
  const rows = await gapChecks({ db, now: NOW, openReadDoor: OPEN_OK });
  const row = byId(rows, "uw-pack-email-not-queued");
  assert.equal(row.status, "skip");
  assert.match(row.detail, /no company id in this run/);
  assert.equal(db.calls.some((c) => /FROM message_templates/.test(c.sql)), false);
  // A silent buyer is still red without a company id.
  const red = byId(await gapChecks({
    db: fakeDb([emailsAre([emailRow()]), ...CLEAR]), now: NOW, openReadDoor: OPEN_OK
  }), "uw-pack-email-not-queued");
  assert.equal(red.status, "FAIL");
});


// ─────────────────────────────────────────────────────────────────────────────
// Checker fixes, Claude 2026-10-09
//   1. The Capital Readiness Summary is owed only when the credit file was a
//      funding tier. A repair or hold file never gets one made.
//   2. The SQL that decides who is owed what is now pinned two ways: by its
//      lines (always runs) and by running it on made-up rows (needs a database).
// ─────────────────────────────────────────────────────────────────────────────

const noSummary = () => PACK_REQUIRED_SUBTYPES.filter((s) => s !== "funding_summary");
const filesRowFor = (tier, over = {}) => filesRow({ subtypes: noSummary(), tier, ...over });

test("tier: the lane's two tier lists are the real engine's six tiers, and the real buildDocuments agrees with them", async () => {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  // The same file the pack builder loads (src/underwrite/letter-pack.mjs).
  const { buildDocuments } = req("../../underwrite/vendor/build-documents.cjs");
  const { OUTCOMES } = req("../../../vendor/underwriteiq-full/api/lite/crs/route-outcome.js");
  const tiers = Object.values(OUTCOMES);
  assert.equal(tiers.length, 6);
  assert.deepEqual([...tiers].sort(), [...SUMMARY_OWED_TIERS, ...SUMMARY_NOT_OWED_TIERS].sort());
  const normalized = { meta: { availableBureaus: ["experian", "equifax", "transunion"] }, inquiries: [{ source: "experian" }] };
  const signals = { bureauNegatives: {}, tradelines: { thinFile: false, auDominance: 0 } };
  for (const tier of tiers) {
    const docs = buildDocuments(tier, [], normalized, signals);
    const makesSummary = (docs.summaryDocuments || []).some((d) => d.type === "funding_summary");
    assert.equal(makesSummary, summaryOwed(tier) === "owed", `${tier}: engine makes a summary = ${makesSummary}`);
  }
  // The pack builder keeps funding_summary only on the funding pack, and the roadmap
  // buyer's pack is always built as the funding pack.
  const letterPack = fs.readFileSync(path.join(HERE, "../../underwrite/letter-pack.mjs"), "utf8");
  assert.match(letterPack, /FUNDING_SUMMARIES = new Set\(\["funding_summary"/);
  const deliver = fs.readFileSync(path.join(HERE, "../../slo/deliver.mjs"), "utf8");
  assert.match(deliver, /pack:\s*"funding"/);
});

test("tier: summaryOwed reads owed, exempt and unknown, and never guesses", () => {
  for (const t of SUMMARY_OWED_TIERS) assert.equal(summaryOwed(t), "owed", t);
  for (const t of SUMMARY_NOT_OWED_TIERS) assert.equal(summaryOwed(t), "exempt", t);
  assert.equal(summaryOwed(" repair_only "), "exempt");
  assert.equal(summaryOwed("premium_stack"), "owed");
  for (const t of [null, undefined, "", "   ", "BANANA", 7, {}]) assert.equal(summaryOwed(t), "unknown", String(t));
});

test("files: a repair or hold credit file is not owed the Capital Readiness Summary, and the PASS says so", async () => {
  for (const tier of SUMMARY_NOT_OWED_TIERS) {
    const row = byId(await runWith([filesAre([filesRowFor(tier)])]), "uw-pack-files-incomplete");
    assert.equal(row.status, "PASS", tier);
    assert.match(row.detail, /all 1 saved pack has every promised file/);
    assert.match(row.detail, /\(1 on the repair or hold path is not owed the Capital Readiness Summary\)/);
  }
  const two = byId(await runWith([filesAre([
    filesRowFor("REPAIR_ONLY"), filesRowFor("MANUAL_REVIEW", { client_id: "c-2" }), filesRow({ client_id: "c-3" })
  ])]), "uw-pack-files-incomplete");
  assert.equal(two.status, "PASS");
  assert.match(two.detail, /\(2 on the repair or hold path are not owed the Capital Readiness Summary\)/);
  // A whole funding pack carries no such note.
  const whole = byId(await runWith([filesAre([filesRow()])]), "uw-pack-files-incomplete");
  assert.doesNotMatch(whole.detail, /repair or hold/);
});

test("files: a funding credit file with no summary is red, for each funding tier", async () => {
  for (const tier of SUMMARY_OWED_TIERS) {
    const row = byId(await runWith([filesAre([filesRowFor(tier)])]), "uw-pack-files-incomplete");
    assert.equal(row.status, "FAIL", tier);
    assert.match(row.detail, /is missing the Capital Readiness Summary/);
  }
});

test("files: a pull with no stored tier and no summary is a skip that says why, never a PASS or a false FAIL", async () => {
  for (const tier of [null, undefined, "", "BANANA"]) {
    const rows = await runWith([filesAre([filesRowFor(tier)])]);
    const row = byId(rows, "uw-pack-files-incomplete");
    assert.equal(row.status, "skip", String(tier));
    assert.match(row.detail, /1 saved pack has no Capital Readiness Summary and the credit pull behind it has no stored tier/);
    assert.match(row.detail, /cannot say whether one is owed/);
    assert.match(row.detail, /Client 22222222/);
    assertShape(rows);
  }
  const two = byId(await runWith([filesAre([filesRowFor(null), filesRowFor(null, { client_id: "c-2" })])]), "uw-pack-files-incomplete");
  assert.match(two.detail, /2 saved packs have no Capital Readiness Summary and the credit pull behind them has no stored tier/);
  // The whole funding pack next to it does not turn the skip into a PASS.
  const mixed = byId(await runWith([filesAre([filesRow(), filesRowFor(null, { client_id: "c-2" })])]), "uw-pack-files-incomplete");
  assert.equal(mixed.status, "skip");
});

test("files: not owed the summary never hides another gap in the same pack", async () => {
  const repairCore = filesRowFor("REPAIR_ONLY", { subtypes: ["funding_snapshot", "bank_lender_match_list", "credit_optimization_roadmap"] });
  const row = byId(await runWith([filesAre([repairCore])]), "uw-pack-files-incomplete");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /is missing the Credit Analysis Report\./);
  assert.doesNotMatch(row.detail, /Capital Readiness Summary/);
  const empty = byId(await runWith([filesAre([filesRowFor("MANUAL_REVIEW", { empty_n: 1 })])]), "uw-pack-files-incomplete");
  assert.equal(empty.status, "FAIL");
  assert.match(empty.detail, /has 1 pack file with 0 bytes/);
  const short = byId(await runWith([filesAre([filesRowFor("FRAUD_HOLD", { short_n: 1 })])]), "uw-pack-files-incomplete");
  assert.equal(short.status, "FAIL");
  // The free map is still owed to a roadmap buyer on the repair path.
  const noMap = byId(await runWith([filesAre([filesRowFor("REPAIR_ONLY", { slo: true })])]), "uw-pack-files-incomplete");
  assert.equal(noMap.status, "FAIL");
  assert.match(noMap.detail, /Business Duplication Map/);
});

test("files: an unsure pack next to a broken one is said in the same red row", async () => {
  const rows = await runWith([filesAre([
    filesRow({ client_id: "bbbbbbbb-0000-4000-8000-000000000002", subtypes: ["credit_analysis_report"] }),
    filesRowFor(null, { client_id: "cccccccc-0000-4000-8000-000000000003" })
  ])]);
  const row = byId(rows, "uw-pack-files-incomplete");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 of 2 saved packs are not whole/);
  assert.match(row.detail, /Also 1 saved pack has no Capital Readiness Summary and the credit pull behind it has no stored tier/);
  assert.match(row.detail, /Client cccccccc\./);
  assertShape(rows);
});

test("files: the judge splits exempt, unsure and bad, and never counts one pack twice", () => {
  const out = judgePackFiles([
    filesRow({ client_id: "whole" }),
    filesRowFor("REPAIR_ONLY", { client_id: "repair" }),
    filesRowFor("FRAUD_HOLD", { client_id: "hold" }),
    filesRowFor(null, { client_id: "unsure" }),
    // No tier AND a core file gone: a plain break. Not also "unsure".
    filesRowFor(null, { client_id: "both", subtypes: ["funding_snapshot"] }),
    filesRowFor("FULL_FUNDING", { client_id: "owed" })
  ], NOW);
  assert.equal(out.checked, 6);
  assert.equal(out.exempt, 2);
  assert.deepEqual(out.unsure, ["unsure"]);
  assert.deepEqual(out.bad.map((b) => b.clientId), ["both", "owed"]);
});

// ── The SQL that decides who is owed what ──────────────────────────────────

const flat = (sql) => sql.replace(/\s+/g, " ").trim();

test("sql pins: the lines that decide who is owed a file or an email are exactly these", () => {
  const files = flat(PACK_FILES_SQL);
  const email = flat(PACK_EMAIL_SQL);
  const pinned = [
    // pack files: who is a roadmap buyer, what the pack holds, when it was saved
    [files, "bool_or(NULLIF(c.custom_fields->>'slo_ref', '') IS NOT NULL) AS slo"],
    [files, "array_agg(DISTINCT d.subtype) AS subtypes"],
    [files, "min(d.created_at) AS first_at"],
    [files, "max(d.created_at) AS last_at"],
    [files, "count(*) FILTER (WHERE d.byte_size = 0)::int AS empty_n"],
    [files, "count(*) FILTER (WHERE d.metadata->>'engine' = 'pdf-lib')::int AS short_n"],
    [files, "d.subtype = ANY($2::text[])"],
    [files, "ON c.id = d.client_id AND c.org_id = d.org_id"],
    [files, "GROUP BY d.client_id, d.org_id"],
    // pack files: the credit tier the pack was built on
    [files, "COALESCE(NULLIF(r.outcome_tier, ''), NULLIF(r.result->>'outcome', '')) AS tier"],
    [files, "FROM crs_results r"],
    [files, "WHERE r.client_id = pk.client_id"],
    [files, "AND r.org_id = pk.org_id"],
    [files, "AND r.created_at <= pk.last_at"],
    [files, "ORDER BY r.created_at DESC LIMIT 1"],
    [files, "LEFT JOIN LATERAL"],
    // pack email: how many core files, which path saved them, who is a roadmap buyer
    [email, "count(DISTINCT d.subtype)::int AS core_n"],
    [email, "min(d.created_at) AS first_at"],
    [email, "max(d.created_at) AS last_at"],
    [email, "bool_or(d.generated_by = ANY($3::text[])) AS email_path"],
    [email, "COALESCE(pk.email_path, false) AS email_path"],
    [email, "(NULLIF(c.custom_fields->>'slo_ref', '') IS NOT NULL) AS slo"],
    [email, "d.subtype = ANY($2::text[])"],
    [email, "GROUP BY d.client_id, d.org_id"],
    [email, "ON c.id = pk.client_id AND c.org_id = pk.org_id"],
    // pack email: the newest pack-ready message queued for THIS client in THIS company
    [email, "(SELECT max(m.created_at) FROM messages m"],
    [email, "WHERE m.client_id = pk.client_id"],
    [email, "AND m.org_id = pk.org_id"],
    [email, "AND m.template_key = $4) AS email_at"]
  ];
  for (const [sql, line] of pinned) assert.ok(sql.includes(line), `SQL no longer has: ${line}`);
  // No stray parameter: the files SQL takes two, the email SQL four.
  assert.doesNotMatch(files, /\$3/);
  assert.doesNotMatch(email, /\$5/);
});

// Made-up rows, real SQL. Each table the SQL reads is shadowed by a WITH list built
// from JSON, inside a READ ONLY transaction that is always rolled back. No real table
// is read and nothing can be written. Needs a database to parse and run the SQL.
const HAVE_DB = Boolean(process.env.DATABASE_URL);
const lit = (rows) => `'${JSON.stringify(rows).replace(/'/g, "''")}'::jsonb`;

function shadow({ documents, clients, messages, pulls }) {
  return `WITH
documents AS (SELECT * FROM jsonb_to_recordset(${lit(documents)}) AS x(client_id uuid, org_id uuid, kind text, subtype text, created_at timestamptz, byte_size bigint, metadata jsonb, is_demo boolean, generated_by text)),
clients AS (SELECT * FROM jsonb_to_recordset(${lit(clients)}) AS x(id uuid, org_id uuid, is_demo boolean, custom_fields jsonb)),
messages AS (SELECT * FROM jsonb_to_recordset(${lit(messages)}) AS x(client_id uuid, org_id uuid, template_key text, created_at timestamptz)),
crs_results AS (SELECT * FROM jsonb_to_recordset(${lit(pulls)}) AS x(client_id uuid, org_id uuid, created_at timestamptz, outcome_tier text, result jsonb))
`;
}

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A1 = "a1000000-0000-4000-8000-000000000001"; // roadmap buyer, whole pack, real flags
const B1 = "b1000000-0000-4000-8000-000000000001"; // router pack, a doubled core file
const C1 = "c1000000-0000-4000-8000-000000000001"; // closer deck, empty slo_ref, mail queued BEFORE the files
const D1 = "d1000000-0000-4000-8000-000000000001"; // demo client
const E1 = "e1000000-0000-4000-8000-000000000001"; // other company
const F1 = "f1000000-0000-4000-8000-000000000001"; // no pack subtype at all
const G1 = "91000000-0000-4000-8000-000000000001"; // three core files, one demo file
const T0 = Date.parse("2026-10-08T10:00:00.000Z");
const iso = (offsetMs) => new Date(T0 + offsetMs).toISOString();
const SEC = 1000;
const DAY = 24 * HOUR;

function doc(client_id, subtype, at, over = {}) {
  return {
    client_id, org_id: ORG_A, kind: "deliverable", subtype, created_at: iso(at),
    byte_size: 1000, metadata: null, is_demo: false, generated_by: "c-06-crs-results-router", ...over
  };
}

const MADE_UP = {
  clients: [
    { id: A1, org_id: ORG_A, is_demo: false, custom_fields: { slo_ref: "slo_x1" } },
    { id: B1, org_id: ORG_A, is_demo: false, custom_fields: {} },
    { id: C1, org_id: ORG_A, is_demo: false, custom_fields: { slo_ref: "" } },
    { id: D1, org_id: ORG_A, is_demo: true, custom_fields: { slo_ref: "slo_d" } },
    { id: E1, org_id: ORG_B, is_demo: false, custom_fields: {} },
    { id: F1, org_id: ORG_A, is_demo: false, custom_fields: {} },
    { id: G1, org_id: ORG_A, is_demo: false, custom_fields: null }
  ],
  documents: [
    // A1: roadmap buyer. One empty file, one from the short printer, summary and map saved.
    doc(A1, "credit_analysis_report", 0, { generated_by: "slo-pack", metadata: { engine: "html" } }),
    doc(A1, "funding_snapshot", 1 * SEC, { generated_by: "slo-pack", metadata: { engine: "html" } }),
    doc(A1, "bank_lender_match_list", 2 * SEC, { generated_by: "slo-pack", byte_size: 0, metadata: { engine: "html" } }),
    doc(A1, "credit_optimization_roadmap", 3 * SEC, { generated_by: "slo-pack", metadata: { engine: "pdf-lib" } }),
    doc(A1, "funding_summary", 4 * SEC, { generated_by: "slo-pack", byte_size: 1603 }),
    doc(A1, "business_duplication_map", 5 * SEC, { generated_by: "slo-pack", metadata: { engine: "html" } }),
    // B1: the CRS router. The Credit Analysis Report is saved twice.
    doc(B1, "credit_analysis_report", 0),
    doc(B1, "credit_analysis_report", 60 * SEC),
    doc(B1, "funding_snapshot", 1 * SEC),
    doc(B1, "bank_lender_match_list", 2 * SEC),
    doc(B1, "credit_optimization_roadmap", 3 * SEC),
    // C1: the closer deck saved three of the four, the router saved the other.
    doc(C1, "credit_analysis_report", 0),
    doc(C1, "funding_snapshot", 1 * SEC, { generated_by: "closer-deck" }),
    doc(C1, "bank_lender_match_list", 2 * SEC, { generated_by: "closer-deck" }),
    doc(C1, "credit_optimization_roadmap", 3 * SEC, { generated_by: "closer-deck" }),
    // D1 demo client, E1 other company: both must stay out of an ORG_A read.
    doc(D1, "credit_analysis_report", 0), doc(D1, "funding_snapshot", 1 * SEC),
    doc(D1, "bank_lender_match_list", 2 * SEC), doc(D1, "credit_optimization_roadmap", 3 * SEC),
    doc(E1, "credit_analysis_report", 0, { org_id: ORG_B, generated_by: "slo-pack" }),
    doc(E1, "funding_snapshot", 1 * SEC, { org_id: ORG_B, generated_by: "slo-pack" }),
    doc(E1, "bank_lender_match_list", 2 * SEC, { org_id: ORG_B, generated_by: "slo-pack" }),
    doc(E1, "credit_optimization_roadmap", 3 * SEC, { org_id: ORG_B, generated_by: "slo-pack" }),
    // F1: a letter is not a pack file.
    doc(F1, "funding_inquiry_removal", 0),
    // G1: three core files. A demo copy of the fourth, and an upload of it, do not count.
    doc(G1, "credit_analysis_report", 0), doc(G1, "funding_snapshot", 1 * SEC), doc(G1, "bank_lender_match_list", 2 * SEC),
    doc(G1, "credit_optimization_roadmap", 3 * SEC, { is_demo: true }),
    doc(G1, "credit_optimization_roadmap", 4 * SEC, { kind: "upload" })
  ],
  messages: [
    // A1 was told twice (an hour before the files, and 10 s after). The newest is the answer.
    { client_id: A1, org_id: ORG_A, template_key: PACK_EMAIL_TEMPLATE, created_at: iso(-HOUR) },
    { client_id: A1, org_id: ORG_A, template_key: PACK_EMAIL_TEMPLATE, created_at: iso(10 * SEC) },
    // A different email to A1 later on is not the pack email.
    { client_id: A1, org_id: ORG_A, template_key: "EMAIL-OTHER", created_at: iso(HOUR) },
    // The same client id in another company is not B1's mail.
    { client_id: B1, org_id: ORG_B, template_key: PACK_EMAIL_TEMPLATE, created_at: iso(HOUR) },
    // C1 was mailed an hour BEFORE its files.
    { client_id: C1, org_id: ORG_A, template_key: PACK_EMAIL_TEMPLATE, created_at: iso(-HOUR) }
  ],
  pulls: [
    // A1: an older repair pull, the pull the pack was built on, and a later repair pull.
    { client_id: A1, org_id: ORG_A, created_at: iso(-HOUR), outcome_tier: "REPAIR_ONLY", result: {} },
    { client_id: A1, org_id: ORG_A, created_at: iso(-60 * SEC), outcome_tier: "FUNDING_PLUS_REPAIR", result: {} },
    { client_id: A1, org_id: ORG_A, created_at: iso(DAY), outcome_tier: "REPAIR_ONLY", result: {} },
    // B1: tier only in the stored result, a later funding pull, and another company's newer pull.
    { client_id: B1, org_id: ORG_A, created_at: iso(-10 * SEC), outcome_tier: null, result: { outcome: "REPAIR_ONLY" } },
    { client_id: B1, org_id: ORG_A, created_at: iso(DAY), outcome_tier: "FULL_FUNDING", result: {} },
    { client_id: B1, org_id: ORG_B, created_at: iso(-5 * SEC), outcome_tier: "FULL_FUNDING", result: {} },
    // G1: an empty-string tier falls back to the stored result.
    { client_id: G1, org_id: ORG_A, created_at: iso(-10 * SEC), outcome_tier: "", result: { outcome: "PREMIUM_STACK" } }
    // C1: no pull at all, so no tier.
  ]
};

async function withReadOnlyDb(fn) {
  const { pool, close } = await import("../../db.mjs");
  const client = await pool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    return await fn(client);
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    client.release();
    await close();
  }
}

test("sql run: on made-up rows the pack SQL gathers the right facts, and the judges read them right", { skip: HAVE_DB ? false : "no DATABASE_URL: this one runs the SQL" }, async () => {
  await withReadOnlyDb(async (client) => {
    const byClient = (rows) => Object.fromEntries(rows.map((r) => [r.client_id, r]));

    // ── pack files ──
    const filesA = (await client.query(shadow(MADE_UP) + PACK_FILES_SQL, [ORG_A, PACK_ANCHOR_SUBTYPES])).rows;
    const files = byClient(filesA);
    assert.deepEqual(Object.keys(files).sort(), [A1, B1, C1, G1].sort(), "demo client, other company and a letter-only client stay out");
    assert.deepEqual(files[A1].subtypes, [
      "bank_lender_match_list", "business_duplication_map", "credit_analysis_report",
      "credit_optimization_roadmap", "funding_snapshot", "funding_summary"
    ]);
    assert.equal(files[A1].first_at.toISOString(), iso(0));
    assert.equal(files[A1].last_at.toISOString(), iso(5 * SEC));
    assert.equal(files[A1].empty_n, 1);
    assert.equal(files[A1].short_n, 1);
    assert.equal(files[A1].slo, true);
    assert.equal(files[A1].tier, "FUNDING_PLUS_REPAIR", "newest pull at or before the newest file, not an older or a later one");
    assert.equal(files[B1].slo, false);
    assert.equal(files[B1].empty_n, 0);
    assert.equal(files[B1].short_n, 0);
    assert.equal(files[B1].tier, "REPAIR_ONLY", "stored result outcome when the column is empty; a later pull and another company's pull do not count");
    assert.equal(files[C1].slo, false, "an empty slo_ref is not a roadmap buyer");
    assert.equal(files[C1].tier, null, "no pull, no tier");
    assert.equal(files[G1].slo, false, "no custom fields at all is not a roadmap buyer");
    assert.equal(files[G1].tier, "PREMIUM_STACK", "empty-string tier falls back to the stored result");
    assert.deepEqual(files[G1].subtypes, ["bank_lender_match_list", "credit_analysis_report", "funding_snapshot"], "a demo file and an upload do not count");
    // No company id: every real company is read.
    const filesAll = byClient((await client.query(shadow(MADE_UP) + PACK_FILES_SQL, [null, PACK_ANCHOR_SUBTYPES])).rows);
    assert.deepEqual(Object.keys(filesAll).sort(), [A1, B1, C1, E1, G1].sort());

    // ── pack email ──
    const emailRows = (await client.query(shadow(MADE_UP) + PACK_EMAIL_SQL, [ORG_A, PACK_SUBTYPES, PACK_EMAIL_PATHS, PACK_EMAIL_TEMPLATE])).rows;
    const mail = byClient(emailRows);
    assert.deepEqual(Object.keys(mail).sort(), [A1, B1, C1, G1].sort());
    assert.equal(mail[A1].core_n, 4);
    assert.equal(mail[A1].email_path, true);
    assert.equal(mail[A1].slo, true);
    assert.equal(mail[A1].first_at.toISOString(), iso(0));
    assert.equal(mail[A1].last_at.toISOString(), iso(3 * SEC), "the email reads the four core files only, so the summary and map do not move it");
    assert.equal(mail[A1].email_at.toISOString(), iso(10 * SEC), "the newest pack email, and not a different template");
    assert.equal(mail[B1].core_n, 4, "a core file saved twice is still four");
    assert.equal(mail[B1].email_path, false);
    assert.equal(mail[B1].slo, false);
    assert.equal(mail[B1].email_at, null, "another company's mail, and other clients' mail, are not B1's");
    assert.equal(mail[C1].email_path, true, "one closer-deck file is enough");
    assert.equal(mail[C1].slo, false);
    assert.equal(mail[C1].email_at.toISOString(), iso(-HOUR));
    assert.equal(mail[G1].core_n, 3);
    assert.equal(mail[G1].email_at, null);
    const mailAll = byClient((await client.query(shadow(MADE_UP) + PACK_EMAIL_SQL, [null, PACK_SUBTYPES, PACK_EMAIL_PATHS, PACK_EMAIL_TEMPLATE])).rows);
    assert.deepEqual(Object.keys(mailAll).sort(), [A1, B1, C1, E1, G1].sort());

    // ── the judges read what the SQL gave them ──
    const later = new Date(T0 + 3 * HOUR);
    const verdict = judgePackFiles(filesA, later);
    assert.equal(verdict.checked, 4);
    assert.deepEqual(verdict.bad.map((b) => b.clientId).sort(), [A1, G1].sort());
    assert.match(verdict.bad.find((b) => b.clientId === A1).problems.join(" "), /1 pack file with 0 bytes.*1 pack file made by the short fallback printer/);
    assert.match(verdict.bad.find((b) => b.clientId === G1).problems.join(" "), /missing the Credit Optimization Roadmap, Capital Readiness Summary/);
    assert.equal(verdict.exempt, 1, "B1 is on the repair path");
    assert.deepEqual(verdict.unsure, [C1], "C1 has no pull, so no tier");
    const owed = judgePackEmail(emailRows, later);
    assert.deepEqual(owed, { owed: 2, notTold: [C1] });
  });
});

test("sql run: the transaction is read only, so a write is refused", { skip: HAVE_DB ? false : "no DATABASE_URL: this one runs the SQL" }, async () => {
  await withReadOnlyDb(async (client) => {
    await assert.rejects(client.query("CREATE TEMP TABLE uw_probe (x int)"), /read-only transaction/);
  });
});
