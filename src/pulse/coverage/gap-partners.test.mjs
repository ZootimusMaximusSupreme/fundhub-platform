import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PAYOUT_DEFAULTS } from "../../affiliates/payouts.mjs";
import {
  COMMISSION_PAYABLE_SQL,
  DEAD_LINK_WINDOW_MS,
  PARTNER_LOGIN_SQL,
  PAYOUT_STUCK_AFTER_MS,
  PAYOUT_STUCK_SQL,
  REFERRAL_LINK_SQL,
  gapChecks
} from "./gap-partners.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-partners.mjs"), "utf8");
const ORG = "00000000-0000-4000-8000-000000000014";
const NOW = new Date("2026-10-08T15:00:00.000Z");

const ROUTES_OK = {
  "public/affiliate-click": true,
  "auth/login": true
};

const CLEAN = {
  unresolved: 0,
  blank_codes: 0,
  n: 0,
  active_partners: 0,
  can_sign_in: 0,
  affiliate_stuck: 0,
  partner_stuck: 0
};

function fakeDb(rowFor) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (typeof rowFor === "function") {
        const out = rowFor(String(sql), params);
        if (out && out.throw) throw new Error(out.throw);
        return { rows: [out || CLEAN] };
      }
      return { rows: [{ ...CLEAN, ...(rowFor || {}) }] };
    }
  };
}

function ctx(extra = {}) {
  return {
    orgId: ORG,
    now: NOW,
    routes: ROUTES_OK,
    startHtml: '<script>fetch("/api/public/affiliate-click")</script>',
    loginHandlesPartners: true,
    ...extra
  };
}

function byId(rows, id) {
  return rows.find((r) => r.id === id);
}

test("gap-partners: four checks, shape PASS FAIL or skip", async () => {
  const rows = await gapChecks(ctx({ db: fakeDb() }));
  assert.deepEqual(rows.map((r) => r.id), [
    "partners:referral-link",
    "partners:commission-payable",
    "partners:login-door",
    "partners:payout-stuck"
  ]);
  for (const row of rows) {
    assert.equal(typeof row.id, "string");
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    assert.ok("suggestedFix" in row);
    assert.equal(row.status, "PASS");
    assert.equal(row.suggestedFix, null);
  }
});

test("gap-partners: no database skips the four reads", async () => {
  const rows = await gapChecks(ctx());
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.status, "skip");
    assert.match(row.detail, /no database/);
    assert.equal(row.suggestedFix, null);
  }
});

test("gap-partners: referral click door missing is FAIL without a database", async () => {
  const rows = await gapChecks(ctx({
    routes: { "auth/login": true }
  }));
  const row = byId(rows, "partners:referral-link");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /not routed/);
  assert.match(row.suggestedFix, /Recon \(AG-07\)/);
  assert.match(row.suggestedFix, /second watchdog/);
  assert.match(row.suggestedFix, /Do not pay anyone/);
});

test("gap-partners: start page that does not record the click is a dead referral link", async () => {
  const rows = await gapChecks(ctx({ startHtml: "<p>Go to apply</p>" }));
  const row = byId(rows, "partners:referral-link");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /no longer records the click/);
});

test("gap-partners: unresolved clicks and blank codes fail the referral link", async () => {
  const db = fakeDb({ unresolved: 3, blank_codes: 1 });
  const rows = await gapChecks(ctx({ db }));
  const row = byId(rows, "partners:referral-link");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /3 referral clicks/);
  assert.match(row.detail, /1 active affiliate/);
  assert.match(row.suggestedFix, /Do not create a partner/);
  const q = db.queries.find((x) => x.sql.includes("affiliate_link_clicks"));
  assert.ok(q);
  assert.equal(q.params[0], ORG);
  assert.equal(q.params[1].getTime(), NOW.getTime() - DEAD_LINK_WINDOW_MS);
});

test("gap-partners: commission that meets the payout rules and is not payable fails", async () => {
  const db = fakeDb({ n: 2 });
  const rows = await gapChecks(ctx({ db }));
  const row = byId(rows, "partners:commission-payable");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 affiliates/);
  assert.match(row.detail, /\$50/);
  assert.match(row.detail, /2026-10-01/);
  assert.match(row.suggestedFix, /Do not mark anyone paid/);
  assert.match(row.suggestedFix, /Do not pay anyone/);
  const q = db.queries.find((x) => x.sql.includes("commission_due"));
  assert.equal(q.params[2], PAYOUT_DEFAULTS.minimumUsd);
  assert.equal(q.params[1].toISOString().slice(0, 10), "2026-10-01");
});

test("gap-partners: commission SQL keeps the payable rules", () => {
  assert.match(COMMISSION_PAYABLE_SQL, /status = 'converted'/);
  assert.match(COMMISSION_PAYABLE_SQL, /partner_license_signed_at IS NOT NULL/);
  assert.match(COMMISSION_PAYABLE_SQL, /tax_form_received_at IS NOT NULL/);
  assert.match(COMMISSION_PAYABLE_SQL, /sum\(r\.commission_due\) >= \$3/);
  assert.match(COMMISSION_PAYABLE_SQL, /'pending', 'processing', 'paid'/);
  assert.doesNotMatch(COMMISSION_PAYABLE_SQL, /\b(insert|update|delete)\b/i);
});

test("gap-partners: partner login route missing is FAIL", async () => {
  const rows = await gapChecks(ctx({
    routes: { "public/affiliate-click": true }
  }));
  const row = byId(rows, "partners:login-door");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /auth\/login is not routed/);
  assert.match(row.suggestedFix, /Do not mint a partner/);
});

test("gap-partners: login that drops partner accounts is FAIL", async () => {
  const rows = await gapChecks(ctx({ loginHandlesPartners: false }));
  const row = byId(rows, "partners:login-door");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /no longer accepts a partner account/);
});

test("gap-partners: active partners who cannot sign in fail the login door", async () => {
  const db = fakeDb({ active_partners: 2, can_sign_in: 0 });
  const rows = await gapChecks(ctx({ db }));
  const row = byId(rows, "partners:login-door");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 active partners and none can sign in/);
  const q = db.queries.find((x) => x.sql.includes("FROM partners"));
  assert.equal(q.params[0], ORG);
});

test("gap-partners: a partner who can sign in passes", async () => {
  const rows = await gapChecks(ctx({
    db: fakeDb({ active_partners: 1, can_sign_in: 1 })
  }));
  assert.equal(byId(rows, "partners:login-door").status, "PASS");
});

test("gap-partners: processing payout older than 7 days is stuck", async () => {
  const db = fakeDb({ affiliate_stuck: 1, partner_stuck: 2 });
  const rows = await gapChecks(ctx({ db }));
  const row = byId(rows, "partners:payout-stuck");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 affiliate payout run/);
  assert.match(row.detail, /2 partner payout runs/);
  assert.match(row.suggestedFix, /Do not mark it paid/);
  assert.match(row.suggestedFix, /Do not pay anyone/);
  const q = db.queries.find((x) => x.sql.includes("affiliate_stuck"));
  assert.equal(q.params[1].getTime(), NOW.getTime() - PAYOUT_STUCK_AFTER_MS);
});

test("gap-partners: a read error fails that check and leaves the others", async () => {
  const db = fakeDb((sql) => {
    if (sql.includes("affiliate_link_clicks")) return { throw: "clicks down" };
    return CLEAN;
  });
  const rows = await gapChecks(ctx({ db }));
  assert.equal(byId(rows, "partners:referral-link").status, "FAIL");
  assert.match(byId(rows, "partners:referral-link").detail, /clicks down/);
  assert.equal(byId(rows, "partners:commission-payable").status, "PASS");
  assert.equal(byId(rows, "partners:login-door").status, "PASS");
  assert.equal(byId(rows, "partners:payout-stuck").status, "PASS");
});

test("gap-partners: queries are select-only and do not repeat slice 17 or 31", () => {
  for (const sql of [REFERRAL_LINK_SQL, COMMISSION_PAYABLE_SQL, PARTNER_LOGIN_SQL, PAYOUT_STUCK_SQL]) {
    assert.match(sql.trim(), /^SELECT/i);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter)\b/i);
  }
  assert.doesNotMatch(SRC, /PULSE_REGISTRY|MACHINE_CHECKS|INNGEST_JOBS|alreadyInRegistry/);
  assert.doesNotMatch(SRC, /buildPayoutRun|approveCommissions|markCommissionsPaid/);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.match(SRC, /Tell Recon \(AG-07\)/);
  assert.match(SRC, /No second watchdog/);
});
