import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS as SLO_CHECKS } from "./slice-19-slo.mjs";
import { CHECKS as UW_CHECKS } from "./slice-21-underwrite.mjs";
import {
  GRACE_MS,
  PACK_HANDLERS,
  PACK_SUBTYPES,
  SLO_PACK_FAILED,
  gapChecks
} from "./gap-underwrite.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
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

const CLEAR = [
  { re: /payment_links pl/, rows: [{ n: 0, sample_id: null }] },
  { re: /funding_inquiry_removal/, rows: [{ n: 0, sample_id: null }] },
  { re: /FROM failed_events/, rows: [{ n: 0, handler_name: null, error_message: null }] },
  { re: /slo_pack_status/, rows: [{ n: 0, sample_id: null }] }
];

test("gap checks skip when there is no database and no fetch", async () => {
  const rows = await gapChecks({});
  assertShape(rows);
  assert.ok(rows.every((row) => row.status === "skip"));
});

test("ids are not the slice 19 or slice 21 registry lists", () => {
  const taken = new Set([...SLO_CHECKS, ...UW_CHECKS].map((row) => row.id));
  for (const id of IDS) assert.equal(taken.has(id), false);
  assert.ok(!IDS.includes("read/underwrite"));
  assert.ok(!IDS.includes("slo-pack-delivery"));
});

test("queries are reads and name the paid roadmap, letters, and pack job", async () => {
  const db = fakeDb(CLEAR);
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    fetchImpl: async () => ({ status: 401, text: async () => "" })
  });
  assertShape(rows);
  assert.ok(rows.every((row) => row.status === "PASS"));
  const text = fs.readFileSync(path.join(HERE, "gap-underwrite.mjs"), "utf8");
  assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  for (const call of db.calls) {
    assert.match(call.sql, /SELECT/i);
    assert.equal(call.params[1], ORG);
  }
  const pack = db.calls.find((call) => /payment_links pl/.test(call.sql));
  assert.equal(pack.params[0], new Date(NOW.getTime() - GRACE_MS).toISOString());
  assert.deepEqual(pack.params[2], PACK_SUBTYPES);
  assert.match(pack.sql, /link_ref LIKE 'slo_%'/);
  assert.match(pack.sql, /purpose = 'diagnostic'/);
  assert.match(pack.sql, /pl.status = 'paid'/);
  assert.match(pack.sql, /is_demo = false/);
  const letters = db.calls.find((call) => /funding_inquiry_removal/.test(call.sql));
  assert.match(letters.sql, /crs_negative_items_count/);
  assert.match(letters.sql, /dispute_letters/);
  assert.match(letters.sql, /analysis.completed/);
  const dead = db.calls.find((call) => /FROM failed_events/.test(call.sql));
  assert.deepEqual(dead.params[0], PACK_HANDLERS);
  const stamp = db.calls.find((call) => /slo_pack_status/.test(call.sql));
  assert.equal(stamp.params[0], SLO_PACK_FAILED);
});

test("a paid roadmap client with no pack fails", async () => {
  const db = fakeDb([
    { re: /payment_links pl/, rows: [{ n: 2, sample_id: "cl-paid" }] },
    { re: /funding_inquiry_removal/, rows: [{ n: 0, sample_id: null }] },
    { re: /FROM failed_events/, rows: [{ n: 0, handler_name: null, error_message: null }] },
    { re: /slo_pack_status/, rows: [{ n: 0, sample_id: null }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  const row = byId(rows, "uw-paid-roadmap-no-pack");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 paid roadmap clients have no UnderwriteIQ pack/);
  assert.match(row.detail, /cl-paid/);
  assert.equal(byId(rows, "uw-letters-missing").status, "PASS");
});

test("letters that should exist and do not fail", async () => {
  const db = fakeDb([
    { re: /payment_links pl/, rows: [{ n: 0, sample_id: null }] },
    { re: /funding_inquiry_removal/, rows: [{ n: 1, sample_id: "cl-letters" }] },
    { re: /FROM failed_events/, rows: [{ n: 0, handler_name: null, error_message: null }] },
    { re: /slo_pack_status/, rows: [{ n: 0, sample_id: null }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  const row = byId(rows, "uw-letters-missing");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 client is missing letters/);
  assert.match(row.suggestedFix, /Do not change UnderwriteIQ dollar math/);
});

test("an open pack job failure fails offer fulfillment", async () => {
  const db = fakeDb([
    { re: /payment_links pl/, rows: [{ n: 0, sample_id: null }] },
    { re: /funding_inquiry_removal/, rows: [{ n: 0, sample_id: null }] },
    {
      re: /FROM failed_events/,
      rows: [{ n: 1, handler_name: "onAnalysisCompletedSloPack", error_message: "empty pack" }]
    },
    { re: /slo_pack_status/, rows: [{ n: 0, sample_id: null }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  const row = byId(rows, "uw-offer-fulfillment-failed");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /onAnalysisCompletedSloPack/);
  assert.match(row.detail, /empty pack/);
  assert.match(row.suggestedFix, /Do not re-run it from this pulse/);
});

test("Delivery Failed pack status fails offer fulfillment", async () => {
  const db = fakeDb([
    { re: /payment_links pl/, rows: [{ n: 0, sample_id: null }] },
    { re: /funding_inquiry_removal/, rows: [{ n: 0, sample_id: null }] },
    { re: /FROM failed_events/, rows: [{ n: 0, handler_name: null, error_message: null }] },
    { re: /slo_pack_status/, rows: [{ n: 1, sample_id: "cl-retry" }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  const row = byId(rows, "uw-offer-fulfillment-failed");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /Delivery Failed — Retry/);
  assert.match(row.detail, /cl-retry/);
});

test("a database error is a fail and the other checks still run", async () => {
  const db = {
    async query(sql) {
      if (/payment_links pl/.test(sql)) throw new Error("pack read down");
      if (/funding_inquiry_removal/.test(sql)) return { rows: [{ n: 0, sample_id: null }] };
      if (/FROM failed_events/.test(sql)) return { rows: [{ n: 0 }] };
      if (/slo_pack_status/.test(sql)) return { rows: [{ n: 0 }] };
      return { rows: [] };
    }
  };
  const rows = await gapChecks({ db, now: NOW, fetchImpl: async () => ({ status: 200 }) });
  assert.equal(byId(rows, "uw-paid-roadmap-no-pack").status, "FAIL");
  assert.match(byId(rows, "uw-paid-roadmap-no-pack").detail, /pack read down/);
  assert.equal(byId(rows, "uw-letters-missing").status, "PASS");
  assert.equal(byId(rows, "uw-read-door").status, "PASS");
});

test("underwrite read door 500 fails and 401 passes", async () => {
  const boom = await gapChecks({
    fetchImpl: async (url, opts) => {
      assert.equal(url, "https://fundhub.ai/api/read/underwrite");
      assert.equal(opts.method, "GET");
      assert.equal(opts.headers.accept, "application/json");
      assert.equal(opts.headers.authorization, undefined);
      return { status: 500, text: async () => "engine blew up" };
    }
  });
  const fail = byId(boom, "uw-read-door");
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /answered 500/);
  assert.match(fail.detail, /engine blew up/);
  assert.match(fail.suggestedFix, /Do not change UnderwriteIQ dollar math/);
  assert.equal(byId(boom, "uw-paid-roadmap-no-pack").status, "skip");

  const ok = await gapChecks({
    db: fakeDb(CLEAR),
    now: NOW,
    baseUrl: "https://fundhub.ai/",
    fetchImpl: async () => ({ status: 401 })
  });
  assert.equal(byId(ok, "uw-read-door").status, "PASS");
  assert.match(byId(ok, "uw-read-door").detail, /answered 401/);
});

test("a door that cannot be reached fails", async () => {
  const rows = await gapChecks({
    fetchImpl: async () => {
      throw new Error("socket hang up");
    }
  });
  const row = byId(rows, "uw-read-door");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /unreachable/);
  assert.match(row.detail, /socket hang up/);
});
