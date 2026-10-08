import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLUEPRINT_PRODUCT_CODE,
  productCreatesChecklist
} from "../../waypoints/purchase.mjs";
import {
  gapChecks,
  checklistProductCodes,
  PORTAL_SHELL_PATH,
  PORTAL_SUMMARY_PATH,
  RECON_CODE
} from "./gap-portal.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-4111-8111-111111111111";
const SHAPE = ["id", "status", "detail", "suggestedFix"];
const STATUSES = new Set(["PASS", "FAIL", "skip"]);

function assertShape(rows) {
  assert.equal(rows.length, 5);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), SHAPE);
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.ok(STATUSES.has(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") assert.equal(typeof row.suggestedFix, "string");
    else assert.equal(row.suggestedFix, null);
  }
}

function portalHtml() {
  return '<article class="tile locked" data-tile="SOFT_PULL"></article>';
}

function fetchImpl(routes, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    const pathName = new URL(url).pathname;
    const hit = routes[pathName];
    if (!hit) return { status: 404, async text() { return "missing"; } };
    return {
      status: hit.status,
      async text() { return hit.text == null ? "" : hit.text; }
    };
  };
}

function liveRecon() {
  return {
    rows: [{ code: "AG-07", status: "live", runtime: "inngest", runtime_ref: "daily-pulse" }]
  };
}

function fakeDb({ entitlement = [], steps = [], recon = liveRecon(), fail } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (fail) throw new Error(fail);
      if (/product_entitlements/i.test(sql)) return { rows: entitlement };
      if (/client_waypoints/i.test(sql)) return { rows: steps };
      if (/FROM agents/i.test(sql)) return recon;
      if (/FROM orgs/i.test(sql)) return { rows: [{ id: ORG }] };
      throw new Error(`unexpected sql: ${sql.slice(0, 80)}`);
    }
  };
}

function healthyRoutes() {
  return {
    [PORTAL_SHELL_PATH]: { status: 200, text: portalHtml() },
    [PORTAL_SUMMARY_PATH]: { status: 401, text: '{"ok":false,"error":"unauthorized"}' }
  };
}

test("gap checks use the blueprint product that opens the checklist", () => {
  assert.equal(productCreatesChecklist(BLUEPRINT_PRODUCT_CODE), true);
  assert.deepEqual(checklistProductCodes(), [String(BLUEPRINT_PRODUCT_CODE).trim().toLowerCase()]);
});

test("a healthy signed-out portal is all PASS", async () => {
  const calls = [];
  const db = fakeDb();
  const rows = await gapChecks({
    db,
    orgId: ORG,
    baseUrl: "https://fundhub.ai",
    fetchImpl: fetchImpl(healthyRoutes(), calls)
  });
  assertShape(rows);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "PASS", "PASS"]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.headers.authorization, undefined);
    assert.equal(call.init.headers.cookie, undefined);
  }
  assert.equal(new URL(calls[0].url).pathname, PORTAL_SHELL_PATH);
  assert.equal(new URL(calls[1].url).pathname, PORTAL_SUMMARY_PATH);
  assert.equal(new URL(calls[1].url).search, "");
  const step = db.calls.find((c) => /client_waypoints/i.test(c.sql));
  assert.deepEqual(step.params[2], checklistProductCodes());
  assert.equal(step.params[1], "succeeded");
  for (const call of db.calls) {
    assert.match(call.sql, /^\s*SELECT/i);
    assert.doesNotMatch(call.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  }
});

test("portal page 404 fails and does not log in", async () => {
  const calls = [];
  const routes = healthyRoutes();
  routes[PORTAL_SHELL_PATH] = { status: 404, text: "not found" };
  const rows = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    fetchImpl: fetchImpl(routes, calls)
  });
  assertShape(rows);
  const page = rows.find((r) => r.id === "portal:page");
  assert.equal(page.status, "FAIL");
  assert.match(page.detail, /404/);
  assert.match(page.suggestedFix, /client-portal\.html/);
  assert.doesNotMatch(page.suggestedFix, /second watchdog|log in|sign in as/i);
  assert.ok(calls.every((c) => !/login|magic-link/i.test(c.url)));
});

test("portal summary 500 fails without a client session", async () => {
  const calls = [];
  const routes = healthyRoutes();
  routes[PORTAL_SUMMARY_PATH] = { status: 500, text: "boom" };
  const rows = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    fetchImpl: fetchImpl(routes, calls)
  });
  assertShape(rows);
  const summary = rows.find((r) => r.id === "portal:summary");
  assert.equal(summary.status, "FAIL");
  assert.match(summary.detail, /500/);
  assert.match(summary.suggestedFix, /Do not sign in as a real client/);
  assert.equal(calls[1].init.credentials, "omit");
});

test("a paid client with no entitlement fails", async () => {
  const rows = await gapChecks({
    db: fakeDb({
      entitlement: [{ client_id: "c1", product_code: "consulting-package", entitlement_code: "credit-optimization-roadmap" }]
    }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  assertShape(rows);
  const row = rows.find((r) => r.id === "portal:paid-entitlement");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 paid client has no entitlement/);
  assert.match(row.suggestedFix, /Do not create a new catalog product/);
  assert.doesNotMatch(row.detail, /c1/);
});

test("a checklist that never opened fails", async () => {
  const rows = await gapChecks({
    db: fakeDb({
      steps: [
        { client_id: "c1", reason: "paid_checklist" },
        { client_id: "c1", reason: "repair_enrolled" },
        { client_id: "c2", reason: "repair_enrolled" }
      ]
    }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  assertShape(rows);
  const row = rows.find((r) => r.id === "portal:next-step");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 clients should have a next step/);
  assert.match(row.suggestedFix, /Do not invent new steps/);
});

test("missing Recon fails and does not ask for a second watchdog", async () => {
  const rows = await gapChecks({
    db: fakeDb({ recon: { rows: [] } }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  assertShape(rows);
  const row = rows.find((r) => r.id === "portal:recon");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, new RegExp(RECON_CODE));
  assert.match(row.suggestedFix, /Do not invent a second watchdog/);
  assert.doesNotMatch(row.suggestedFix, /new watchdog|second tripwire/i);
});

test("no database skips the SQL reads and still checks the page", async () => {
  const rows = await gapChecks({
    db: null,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  assertShape(rows);
  assert.equal(rows.find((r) => r.id === "portal:page").status, "PASS");
  assert.equal(rows.find((r) => r.id === "portal:summary").status, "PASS");
  assert.equal(rows.find((r) => r.id === "portal:paid-entitlement").status, "skip");
  assert.equal(rows.find((r) => r.id === "portal:next-step").status, "skip");
  assert.equal(rows.find((r) => r.id === "portal:recon").status, "skip");
});

test("a database error is a FAIL, not a quiet pass", async () => {
  const rows = await gapChecks({
    db: fakeDb({ fail: "connection refused" }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  assertShape(rows);
  for (const id of ["portal:paid-entitlement", "portal:next-step", "portal:recon"]) {
    const row = rows.find((r) => r.id === id);
    assert.equal(row.status, "FAIL");
    assert.match(row.detail, /connection refused/);
  }
});

test("the module does not write, log in, or add a second watchdog", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-portal.mjs"), "utf8");
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/);
  assert.doesNotMatch(src, /slice-26-client-journey/);
  assert.doesNotMatch(src, /password|magic-link|client_id=/i);
  assert.match(src, /Do not invent a second watchdog/);
  assert.doesNotMatch(src, /second tripwire|new watchdog/i);
});
