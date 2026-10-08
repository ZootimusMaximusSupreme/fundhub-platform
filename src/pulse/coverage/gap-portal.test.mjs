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
  PAID_ENTITLEMENT_SQL,
  NEXT_STEP_SQL,
  SUMMARY_CLIENT_SQL,
  SUMMARY_READS,
  READ_ONLY_SQL,
  TEST_CLIENT_EMAIL_RE,
  GRACE
} from "./gap-portal.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const SHAPE = ["id", "status", "detail", "suggestedFix"];
const STATUSES = new Set(["PASS", "FAIL", "skip"]);
const IDS = ["portal:page", "portal:summary", "portal:paid-entitlement", "portal:next-step"];

function assertShape(rows) {
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.id), IDS);
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

const norm = (s) => String(s).replace(/\s+/g, " ").trim();

/* The fake answers by the SQL it is given, and it records the params, so a test
   can see which org, status and email pattern were sent. Anything it does not
   know throws, which turns a changed query into a FAIL row, not a quiet pass. */
function fakeDb({ entitlement = [], steps = [], client = CLIENT, failOn = null, failAll = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (failAll) throw new Error(failAll);
      if (failOn && failOn.test(text)) throw new Error(`boom ${failOn.source}`);
      if (/FROM orgs/i.test(text)) return { rows: [{ id: ORG }] };
      if (/gap:portal-paid-entitlement/.test(text)) return { rows: entitlement };
      if (/gap:portal-next-step/.test(text)) return { rows: steps };
      if (/gap:portal-summary-client/.test(text)) return { rows: client ? [{ id: client }] : [] };
      if (/FROM documents d/i.test(text)) return { rows: [] };
      for (const read of SUMMARY_READS) {
        if (norm(text) === norm(read.sql)) return { rows: [] };
      }
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

function healthyRoutes() {
  return {
    [PORTAL_SHELL_PATH]: { status: 200, text: portalHtml() }
  };
}

const paidRow = (client, isTest, has) => ({ client_id: client, is_test: isTest, has_entitlement: has });

test("gap checks use the blueprint product that opens the checklist", () => {
  assert.equal(productCreatesChecklist(BLUEPRINT_PRODUCT_CODE), true);
  assert.deepEqual(checklistProductCodes(), [String(BLUEPRINT_PRODUCT_CODE).trim().toLowerCase()]);
});

test("a healthy signed-out portal is all PASS", async () => {
  const calls = [];
  const db = fakeDb({ entitlement: [paidRow("c1", false, true)] });
  const rows = await gapChecks({
    db,
    orgId: ORG,
    baseUrl: "https://fundhub.ai",
    fetchImpl: fetchImpl(healthyRoutes(), calls)
  });
  assertShape(rows);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "PASS"]);
  // One page fetch. The summary is read from the database, never pinged here.
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.init.method, "GET");
  assert.equal(call.init.credentials, "omit");
  assert.equal(call.init.headers.authorization, undefined);
  assert.equal(call.init.headers.cookie, undefined);
  assert.ok(call.init.signal, "the page fetch must carry a timeout so one hang cannot hold up the pulse");
  assert.equal(new URL(call.url).pathname, PORTAL_SHELL_PATH);
  const step = db.calls.find((c) => /gap:portal-next-step/.test(c.sql));
  assert.equal(step.params[0], ORG);
  assert.equal(step.params[1], "succeeded");
  assert.deepEqual(step.params[2], checklistProductCodes());
  assert.equal(step.params[3], TEST_CLIENT_EMAIL_RE);
  const paid = db.calls.find((c) => /gap:portal-paid-entitlement/.test(c.sql));
  assert.deepEqual(paid.params, [ORG, "succeeded", TEST_CLIENT_EMAIL_RE]);
  for (const c of db.calls) {
    assert.match(c.sql.replace(/\/\*[\s\S]*?\*\//g, "").trim(), /^(SELECT|WITH)\b/i);
    assert.doesNotMatch(c.sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|BEGIN|COMMIT|ROLLBACK)\b/i);
  }
});

test("the fetch alias still works when only ctx.fetch is given", async () => {
  const calls = [];
  const rows = await gapChecks({
    db: fakeDb({ entitlement: [paidRow("c1", false, true)] }),
    orgId: ORG,
    fetch: fetchImpl(healthyRoutes(), calls)
  });
  assert.equal(rows.find((r) => r.id === "portal:page").status, "PASS");
  assert.equal(calls.length, 1);
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

test("a 200 that is not the portal fails", async () => {
  const routes = healthyRoutes();
  routes[PORTAL_SHELL_PATH] = { status: 200, text: "<html>Please sign in</html>" };
  const rows = await gapChecks({ db: fakeDb(), orgId: ORG, fetchImpl: fetchImpl(routes, []) });
  const page = rows.find((r) => r.id === "portal:page");
  assert.equal(page.status, "FAIL");
  assert.match(page.detail, /tiles missing=true/);
});

test("a 500 and an unreachable page both fail", async () => {
  const routes = healthyRoutes();
  routes[PORTAL_SHELL_PATH] = { status: 500, text: "<html data-tile=x></html>" };
  const five = await gapChecks({ db: fakeDb(), orgId: ORG, fetchImpl: fetchImpl(routes, []) });
  assert.equal(five.find((r) => r.id === "portal:page").status, "FAIL");
  const down = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    fetchImpl: async () => { throw new Error("socket hang up"); }
  });
  const page = down.find((r) => r.id === "portal:page");
  assert.equal(page.status, "FAIL");
  assert.match(page.detail, /socket hang up/);
});

test("the portal summary reads run for one real client and pass", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(healthyRoutes(), []) });
  const row = rows.find((r) => r.id === "portal:summary");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /5 reads/);
  const pick = db.calls.find((c) => /gap:portal-summary-client/.test(c.sql));
  assert.deepEqual(pick.params, [ORG]);
  for (const read of SUMMARY_READS) {
    const hit = db.calls.find((c) => norm(c.sql) === norm(read.sql));
    assert.ok(hit, `the ${read.label} read was not run`);
    assert.deepEqual(hit.params, [CLIENT, ORG]);
  }
  const docs = db.calls.find((c) => /FROM documents d/i.test(c.sql));
  assert.ok(docs, "the documents read was not run");
  assert.deepEqual(docs.params.slice(0, 2), [ORG, CLIENT]);
});

test("a summary read that throws is a fail that names the read", async () => {
  for (const read of SUMMARY_READS) {
    const db = fakeDb();
    const real = db.query;
    db.query = async (sql, params) => {
      if (norm(sql).startsWith(norm(read.sql).slice(0, 40))) throw new Error(`column nope does not exist (${read.label})`);
      return real(sql, params);
    };
    const rows = await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(healthyRoutes(), []) });
    const row = rows.find((r) => r.id === "portal:summary");
    assert.equal(row.status, "FAIL", read.label);
    assert.match(row.detail, new RegExp(`read "${read.label}" failed`));
    assert.match(row.detail, /does not exist/);
    assert.match(row.suggestedFix, /Do not sign in as a real client/);
  }
});

test("the documents read that can 500 the summary is run too", async () => {
  const db = fakeDb({ failOn: /FROM documents d/i });
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(healthyRoutes(), []) });
  const row = rows.find((r) => r.id === "portal:summary");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /"documents" failed/);
});

test("no real client on file skips the summary reads, it does not pass them", async () => {
  const db = fakeDb({ client: null });
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(healthyRoutes(), []) });
  const row = rows.find((r) => r.id === "portal:summary");
  assert.equal(row.status, "skip");
  assert.match(row.detail, /no real client/);
});

test("the copied summary reads still match the handler word for word", () => {
  // If api/read/portal-summary.mjs changes one of these selects, this fails until
  // gap-portal.mjs follows. That is what keeps the mirror honest.
  const handler = norm(fs.readFileSync(path.join(REPO, "api/read/portal-summary.mjs"), "utf8"));
  for (const read of SUMMARY_READS) {
    assert.ok(
      handler.includes(norm(read.sql)),
      `portal-summary.mjs no longer contains the ${read.label} select`
    );
  }
});

test("a paid client with no entitlement fails", async () => {
  const rows = await gapChecks({
    db: fakeDb({ entitlement: [paidRow("c1", false, false), paidRow("c2", false, true)] }),
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

test("two clients missing an entitlement are counted once each", async () => {
  const rows = await gapChecks({
    db: fakeDb({
      entitlement: [
        paidRow("c1", false, false),
        paidRow("c1", false, false),
        paidRow("c2", false, false)
      ]
    }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  assert.match(rows.find((r) => r.id === "portal:paid-entitlement").detail, /2 paid clients have no entitlement/);
});

test("test clients with no entitlement are left out and named in the pass", async () => {
  const rows = await gapChecks({
    db: fakeDb({
      entitlement: [paidRow("t1", true, false), paidRow("t2", true, false), paidRow("c1", false, true)]
    }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  const row = rows.find((r) => r.id === "portal:paid-entitlement");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /1 real purchases read/);
  assert.match(row.detail, /2 test clients have none and are left out/);
});

test("a real client missing an entitlement still fails beside test clients", async () => {
  const rows = await gapChecks({
    db: fakeDb({ entitlement: [paidRow("t1", true, false), paidRow("c1", false, false)] }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  const row = rows.find((r) => r.id === "portal:paid-entitlement");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 paid client has no entitlement/);
});

test("the test-client pattern catches the sim tags and test domains, not real people", () => {
  const re = new RegExp(TEST_CLIENT_EMAIL_RE, "i");
  for (const mail of [
    "stanbridgejchris+walk-01@gmail.com",
    "stanbridgejchris+sim-12@gmail.com",
    "someone@example.com",
    "adv-blk5a-1.1@example.test",
    "x@thing.invalid"
  ]) {
    assert.ok(re.test(mail), mail);
  }
  for (const mail of [
    "jane.walker@gmail.com",
    "bob+simple@gmail.com",
    "carol@examples.com",
    "dave@test-company.com",
    "erin@mytest.io"
  ]) {
    assert.ok(!re.test(mail), mail);
  }
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

test("the sql ignores fresh payments, failed payments, demo rows and test clients", () => {
  assert.match(GRACE, /hour/);
  for (const sql of [PAID_ENTITLEMENT_SQL, NEXT_STEP_SQL]) {
    assert.match(sql, new RegExp(`created_at < now\\(\\) - interval '${GRACE}'`));
    assert.match(sql, /c\.is_demo IS TRUE/);
    assert.match(sql, /custom_fields ->> 'synthetic'/);
    assert.match(sql, /~\* \$\d/);
  }
  assert.match(PAID_ENTITLEMENT_SQL, /t\.is_demo IS NOT TRUE/);
  assert.match(PAID_ENTITLEMENT_SQL, /lower\(btrim\(COALESCE\(t\.status, ''\)\)\) = \$2/);
  assert.match(NEXT_STEP_SQL, /rp\.status <> 'cancelled'/);
  assert.match(SUMMARY_CLIENT_SQL, /c\.is_demo IS NOT TRUE/);
  assert.equal(READ_ONLY_SQL.length, 3 + SUMMARY_READS.length);
  for (const sql of READ_ONLY_SQL) {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i);
  }
});

test("Recon is not read here, the daily pulse already does", async () => {
  const rows = await gapChecks({ db: fakeDb(), orgId: ORG, fetchImpl: fetchImpl(healthyRoutes(), []) });
  assertShape(rows);
  assert.ok(!rows.some((r) => /recon/i.test(r.id)));
  const db = fakeDb();
  await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(healthyRoutes(), []) });
  assert.ok(!db.calls.some((c) => /FROM agents/i.test(c.sql)));
});

test("no database skips the SQL reads and still checks the page", async () => {
  const rows = await gapChecks({
    db: null,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  assertShape(rows);
  assert.equal(rows.find((r) => r.id === "portal:page").status, "PASS");
  assert.equal(rows.find((r) => r.id === "portal:summary").status, "skip");
  assert.equal(rows.find((r) => r.id === "portal:paid-entitlement").status, "skip");
  assert.equal(rows.find((r) => r.id === "portal:next-step").status, "skip");
});

test("a database error is a FAIL, not a quiet pass", async () => {
  const rows = await gapChecks({
    db: fakeDb({ failAll: "connection refused" }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  assertShape(rows);
  for (const id of ["portal:summary", "portal:paid-entitlement", "portal:next-step"]) {
    const row = rows.find((r) => r.id === id);
    assert.equal(row.status, "FAIL", id);
    assert.match(row.detail, /connection refused/);
  }
});

test("an org that cannot be read fails the three database rows", async () => {
  const db = fakeDb({ failAll: "no orgs table" });
  const rows = await gapChecks({ db, fetchImpl: fetchImpl(healthyRoutes(), []) });
  assertShape(rows);
  for (const id of ["portal:summary", "portal:paid-entitlement", "portal:next-step"]) {
    const row = rows.find((r) => r.id === id);
    assert.equal(row.status, "FAIL", id);
    assert.match(row.detail, /default org/);
  }
});

test("the org is read once when the run does not pass one", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, fetchImpl: fetchImpl(healthyRoutes(), []) });
  assertShape(rows);
  assert.equal(db.calls.filter((c) => /FROM orgs/i.test(c.sql)).length, 1);
  assert.equal(db.calls.find((c) => /gap:portal-next-step/.test(c.sql)).params[0], ORG);
});

test("the module does not write, log in, or add a second watchdog", () => {
  const src = fs.readFileSync(path.join(HERE, "gap-portal.mjs"), "utf8");
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/);
  assert.doesNotMatch(src, /slice-26-client-journey/);
  assert.doesNotMatch(src, /password|magic-link|client_id=/i);
  assert.match(src, /Do not invent a second watchdog/);
  assert.doesNotMatch(src, /second tripwire|new watchdog/i);
});
