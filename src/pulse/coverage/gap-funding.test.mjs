import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { gapChecks, STUCK_AFTER_MS } from "./gap-funding.mjs";
import { FUNDING_WORKFLOW_IDS } from "./slice-14-funding.mjs";
import { CHECKS as ADVISOR_CHECKS } from "./slice-28-funding-advisor.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T19:00:00.000Z");

const LIVE_RECON = {
  code: "AG-07",
  status: "live",
  runtime: "inngest",
  runtime_ref: "daily-pulse"
};

function fakeDb(answers = {}) {
  const calls = [];
  const db = {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (/\b(INSERT|UPDATE|DELETE)\b/i.test(text)) {
        throw new Error(`write sql is not allowed: ${text}`);
      }
      if (/FROM applications\b/.test(text)) return { rows: [{ n: answers.applyWaiting ?? 0 }] };
      if (/FROM cards\b/.test(text)) return { rows: [{ n: answers.queue ?? 0 }] };
      if (/FROM lenders\b/.test(text)) return { rows: [{ n: answers.lenders ?? 4 }] };
      if (/FROM funding_rounds\b/.test(text)) return { rows: [{ n: answers.stuck ?? 0 }] };
      if (/FROM agents\b/.test(text)) {
        if (answers.agent === null) return { rows: [] };
        return { rows: [answers.agent || LIVE_RECON] };
      }
      throw new Error(`unexpected sql: ${text}`);
    }
  };
  return db;
}

function byId(rows) {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

test("gap funding: no database skips every check", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.equal(row.status, "skip");
    assert.equal(row.suggestedFix, null);
    assert.equal(typeof row.id, "string");
    assert.equal(typeof row.detail, "string");
  }
  assert.equal(rows.find((row) => row.id === "funding:recon").detail.includes("Recon"), true);
});

test("gap funding: clear desk is five PASS rows and only reads", async () => {
  const db = fakeDb();
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    bookRows: 306,
    submitRouted: true
  });
  assert.deepEqual(rows.map((row) => row.status), ["PASS", "PASS", "PASS", "PASS", "PASS"]);
  assert.deepEqual(rows.map((row) => row.id), [
    "funding:round-stuck",
    "funding:lender-book",
    "funding:submit-path",
    "funding:advisor-queue",
    "funding:recon"
  ]);
  for (const row of rows) {
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    assert.equal(row.suggestedFix, null);
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  }
  const stuck = db.calls.find((call) => /FROM funding_rounds\b/.test(call.sql));
  assert.equal(stuck.params[0], ORG);
  assert.deepEqual(stuck.params[1], ["funded", "closed"]);
  assert.equal(stuck.params[2].getTime(), NOW.getTime() - STUCK_AFTER_MS);
  assert.ok(db.calls.every((call) => /^\s*SELECT\b/i.test(call.sql)));
});

test("gap funding: each named break fails on its own", async () => {
  const stuck = byId(await gapChecks({
    db: fakeDb({ stuck: 2, lenders: 4 }),
    orgId: ORG,
    now: NOW,
    submitRouted: true
  }));
  assert.equal(stuck["funding:round-stuck"].status, "FAIL");
  assert.match(stuck["funding:round-stuck"].detail, /2 funding rounds/);
  assert.equal(stuck["funding:lender-book"].status, "PASS");
  assert.equal(stuck["funding:advisor-queue"].status, "PASS");

  const emptyBook = byId(await gapChecks({
    db: fakeDb({ lenders: 0 }),
    orgId: ORG,
    now: NOW,
    bookRows: 306,
    submitRouted: true
  }));
  assert.equal(emptyBook["funding:lender-book"].status, "FAIL");
  assert.match(emptyBook["funding:lender-book"].detail, /empty/);
  assert.match(emptyBook["funding:lender-book"].detail, /306 banks/);
  assert.match(emptyBook["funding:lender-book"].suggestedFix, /Do not invent bank names/);

  const deadRoute = byId(await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    now: NOW,
    submitRouted: false
  }));
  assert.equal(deadRoute["funding:submit-path"].status, "FAIL");
  assert.match(deadRoute["funding:submit-path"].detail, /not wired/);
  assert.match(deadRoute["funding:submit-path"].suggestedFix, /Do not submit a real lender app/);

  const sitting = byId(await gapChecks({
    db: fakeDb({ applyWaiting: 1 }),
    orgId: ORG,
    now: NOW,
    submitRouted: true
  }));
  assert.equal(sitting["funding:submit-path"].status, "FAIL");
  assert.match(sitting["funding:submit-path"].detail, /1 application still on Apply/);

  const queue = byId(await gapChecks({
    db: fakeDb({ queue: 3 }),
    orgId: ORG,
    now: NOW,
    submitRouted: true
  }));
  assert.equal(queue["funding:advisor-queue"].status, "FAIL");
  assert.match(queue["funding:advisor-queue"].detail, /3 funding files/);
  assert.match(queue["funding:advisor-queue"].suggestedFix, /next step/);
});

test("gap funding: empty list with no book rows is a skip", async () => {
  const rows = byId(await gapChecks({
    db: fakeDb({ lenders: 0 }),
    orgId: ORG,
    now: NOW,
    bookRows: 0,
    submitRouted: true
  }));
  assert.equal(rows["funding:lender-book"].status, "skip");
  assert.match(rows["funding:lender-book"].detail, /no rows to load/);
});

test("gap funding: one Recon tripwire, no second watchdog", async () => {
  const missing = byId(await gapChecks({
    db: fakeDb({ agent: null }),
    orgId: ORG,
    now: NOW,
    submitRouted: true
  }));
  assert.equal(missing["funding:recon"].status, "FAIL");
  assert.match(missing["funding:recon"].detail, /AG-07 is missing/);
  assert.match(missing["funding:recon"].suggestedFix, /Do not invent a second watchdog/);
  assert.doesNotMatch(missing["funding:recon"].suggestedFix, /new watchdog|second tripwire/i);

  const retired = byId(await gapChecks({
    db: fakeDb({
      agent: { code: "AG-07", status: "retired", runtime: "ghl", runtime_ref: "GHL-RECON" }
    }),
    orgId: ORG,
    now: NOW,
    submitRouted: true
  }));
  assert.equal(retired["funding:recon"].status, "FAIL");
  assert.match(retired["funding:recon"].suggestedFix, /daily-pulse/);
  assert.match(retired["funding:recon"].suggestedFix, /Do not invent a second watchdog/);

  const live = byId(await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    now: NOW,
    submitRouted: true
  }));
  assert.equal(live["funding:recon"].status, "PASS");
  assert.equal(Object.keys(live).filter((id) => id.includes("recon")).length, 1);
});

test("gap funding: ids do not repeat slice 14 or slice 28", async () => {
  const rows = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    now: NOW,
    submitRouted: true
  });
  const ids = new Set(rows.map((row) => row.id));
  for (const id of FUNDING_WORKFLOW_IDS) assert.equal(ids.has(id), false);
  for (const row of ADVISOR_CHECKS) assert.equal(ids.has(row.id), false);
});

test("gap funding: source stays read-only and does not submit a lender app", () => {
  const src = fs.readFileSync(fileURLToPath(new URL("./gap-funding.mjs", import.meta.url)), "utf8");
  assert.match(src, /export async function gapChecks/);
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|submitApplication|lendflow)\b/);
  assert.doesNotMatch(src, /\.html/);
  assert.doesNotMatch(src, /createFunction|new watchdog/i);
  assert.match(src, /Do not invent a second watchdog/);
});

test("gap funding: a read error is a FAIL, not a throw", async () => {
  const db = {
    async query() {
      throw new Error("relation funding_rounds does not exist");
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, submitRouted: true });
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.status === "FAIL"));
  assert.match(rows[0].detail, /funding_rounds/);
  assert.match(rows[0].suggestedFix, /Do not invent a second watchdog/);
});
