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
  PAID_ENTITLEMENT_SQL,
  UNRESOLVED_PAID_SQL,
  NEXT_STEP_SQL,
  SUMMARY_CLIENT_SQL,
  SUMMARY_READS,
  READ_ONLY_SQL,
  TEST_CLIENT_EMAIL_RE,
  GRACE,
  INTERNAL_CLIENT_EMAIL_RE,
  SIGN_IN_GRACE,
  NEVER_SIGNED_IN_SQL,
  PROGRESS_CLIENT_SQL,
  PROGRESS_ROWS_SQL,
  READ_ONLY_SQL_TIER_1,
  CUSTOMER_PAGES,
  pageAssets,
  isPlainRead,
  checkPageScripts,
  checkProgressRead,
  checkPaidNeverSignedIn
} from "./gap-portal.mjs";
import { PULSE_REGISTRY } from "./../registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const SHAPE = ["id", "status", "detail", "suggestedFix"];
const STATUSES = new Set(["PASS", "FAIL", "skip"]);
const IDS = [
  "portal:page",
  "portal:summary",
  "portal:paid-entitlement",
  "portal:next-step",
  "portal:page-scripts-load",
  "portal:progress-read-real-client",
  "portal:paid-client-never-signed-in"
];

function assertShape(rows) {
  assert.equal(rows.length, 7);
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

/* The six customer pages as the live site serves them, each with the files it
   names. `extra` is the part of the page the check reads for. Built from the
   real pages' shape (2026-10-09): relative names under /app/, absolute names at
   the root, and the portal's service worker named in a script line. */
const SITE_PAGES = {
  "/portal-login.html": {
    title: "Fundhub — Client portal sign-in",
    assets: ['<link rel="stylesheet" href="/fh.css">'],
    extra: '<form id="f"><input id="email" type="email"></form>'
  },
  "/reset-password.html": {
    title: "Fundhub — Reset password",
    assets: ['<link rel="stylesheet" href="/fh.css">', '<script src="/pw-toggle.js" defer></script>'],
    extra: '<form id="f"><input id="pw1" type="password"></form>'
  },
  "/app/client-portal.html": {
    title: "Fundhub — Client Portal",
    assets: [
      '<link rel="stylesheet" href="fundhub-brand.css">',
      '<script defer src="shell.js"></script>',
      '<script defer src="data.js"></script>'
    ],
    extra: '<article class="tile locked" data-tile="SOFT_PULL"></article><script>var SW_URL = "/app/client-portal-sw.js";</script>'
  },
  "/progress.html": { title: "Fundhub — Your progress", assets: [], extra: "<h1>Your progress</h1>" },
  "/app/payment-success.html": {
    title: "Fundhub · After checkout",
    assets: ['<link rel="stylesheet" href="fundhub-brand.css">'],
    extra: "<h1>Thanks</h1>"
  },
  "/app/financeos.html": {
    title: "Fundhub — FinanceOS",
    assets: [
      '<link rel="stylesheet" href="fundhub-brand.css">',
      '<link rel="stylesheet" href="money-vault.css">',
      '<script defer src="money.js"></script>',
      '<script defer src="financeos.js"></script>'
    ],
    extra: "<main></main>"
  }
};
const SITE_FILES = [
  "/fh.css", "/pw-toggle.js", "/app/fundhub-brand.css", "/app/shell.js", "/app/data.js",
  "/app/client-portal-sw.js", "/app/money-vault.css", "/app/money.js", "/app/financeos.js"
];

function pageText(pagePath, { drop = [], title } = {}) {
  const page = SITE_PAGES[pagePath];
  const filler = "<p>" + "x".repeat(600) + "</p>";
  return `<!doctype html><html><head><title>${title === undefined ? page.title : title}</title>` +
    page.assets.filter((a) => !drop.some((d) => a.includes(d))).join("") +
    `</head><body>${page.extra}${filler}</body></html>`;
}

function portalHtml() {
  return pageText(PORTAL_SHELL_PATH);
}

function siteRoutes() {
  const routes = {};
  for (const pagePath of Object.keys(SITE_PAGES)) routes[pagePath] = { status: 200, text: pageText(pagePath) };
  for (const file of SITE_FILES) {
    routes[file] = { status: 200, text: file.endsWith(".css") ? "body{margin:0}" : "window.ok=1;", type: file.endsWith(".css") ? "text/css" : "application/javascript" };
  }
  return routes;
}

function fetchImpl(routes, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    const pathName = new URL(url).pathname;
    const hit = routes[pathName];
    if (!hit) return { status: 404, async text() { return "missing"; } };
    return {
      status: hit.status,
      headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? hit.type || "" : null) },
      async text() { return hit.text == null ? "" : hit.text; }
    };
  };
}

const norm = (s) => String(s).replace(/\s+/g, " ").trim();

/* The fake answers by the SQL it is given, and it records the params, so a test
   can see which org, status and email pattern were sent. Anything it does not
   know throws, which turns a changed query into a FAIL row, not a quiet pass. */
function fakeDb({
  entitlement = [], unresolved = [], steps = [], client = CLIENT, failOn = null, failAll = null,
  signIns = [], progressClient = CLIENT,
  progressRows = { waypoints: 0, deliverables: 0, repair_stages: [] },
  waypointRows = []
} = {}) {
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
      if (/gap:portal-unresolved-paid/.test(text)) return { rows: unresolved };
      if (/gap:portal-next-step/.test(text)) return { rows: steps };
      if (/gap:portal-summary-client/.test(text)) return { rows: client ? [{ id: client }] : [] };
      if (/gap:portal-never-signed-in/.test(text)) return { rows: signIns };
      if (/gap:portal-progress-client/.test(text)) return { rows: progressClient ? [{ id: progressClient }] : [] };
      if (/gap:portal-progress-rows/.test(text)) return { rows: [progressRows] };
      if (/FROM documents d/i.test(text)) return { rows: [] };
      for (const read of SUMMARY_READS) {
        if (norm(text) === norm(read.sql)) return { rows: [] };
      }
      // This lane's own reads carry a gap: tag. One that is not known is a changed query.
      if (/gap:/.test(text)) throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
      // Anything else is the real client-progress code reading for the progress check.
      if (/SELECT \* FROM client_waypoints/i.test(text)) return { rows: waypointRows };
      return { rows: [] };
    }
  };
}

function healthyRoutes() {
  return siteRoutes();
}

const paidRow = (client, isTest, has) => ({ client_id: client, is_test: isTest, has_entitlement: has });
const unresolvedRow = (client, { isTest = false, hasAny = false, door = true } = {}) => ({
  client_id: client, is_test: isTest, has_any_entitlement: hasAny, came_through_the_door: door
});

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
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"]);
  // The portal page is fetched once for the whole run. The summary is read from
  // the database, never pinged here.
  const shellCalls = calls.filter((c) => new URL(c.url).pathname === PORTAL_SHELL_PATH);
  assert.equal(shellCalls.length, 1);
  assert.ok(!calls.some((c) => new URL(c.url).pathname === PORTAL_SUMMARY_PATH));
  const call = shellCalls[0];
  for (const c of calls) {
    assert.equal(c.init.method, "GET");
    assert.equal(c.init.credentials, "omit");
    assert.equal(c.init.headers.authorization, undefined);
    assert.equal(c.init.headers.cookie, undefined);
    assert.ok(c.init.signal, "every fetch must carry a timeout so one hang cannot hold up the pulse");
  }
  assert.equal(new URL(call.url).pathname, PORTAL_SHELL_PATH);
  const step = db.calls.find((c) => /gap:portal-next-step/.test(c.sql));
  assert.equal(step.params[0], ORG);
  assert.equal(step.params[1], "succeeded");
  assert.deepEqual(step.params[2], checklistProductCodes());
  assert.equal(step.params[3], TEST_CLIENT_EMAIL_RE);
  const paid = db.calls.find((c) => /gap:portal-paid-entitlement/.test(c.sql));
  assert.deepEqual(paid.params, [ORG, "succeeded", TEST_CLIENT_EMAIL_RE]);
  const lost = db.calls.find((c) => /gap:portal-unresolved-paid/.test(c.sql));
  assert.deepEqual(lost.params, [ORG, "succeeded", TEST_CLIENT_EMAIL_RE]);
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
  assert.equal(calls.filter((c) => new URL(c.url).pathname === PORTAL_SHELL_PATH).length, 1);
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
  // The customer sign-in PAGE is a plain static file the scripts check reads.
  // Logging in would be a call to the auth API, and nothing here makes one.
  assert.ok(calls.every((c) => !/\/api\/|magic-link/i.test(c.url)));
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
  const docs = db.calls.find((c) => /FROM documents d/i.test(c.sql) && !/gap:/.test(c.sql));
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
  assert.match(row.detail, /1 paid rows read/);
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
    "x@thing.invalid",
    "roster@demo.fundhub.local"
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
  // Pin the number itself. A grace of '0 hour' would fail every payment still on its way.
  assert.equal(GRACE, "1 hour");
  for (const sql of [PAID_ENTITLEMENT_SQL, UNRESOLVED_PAID_SQL, NEXT_STEP_SQL]) {
    assert.match(sql, new RegExp(`created_at < now\\(\\) - interval '${GRACE}'`));
    assert.match(sql, /c\.is_demo IS TRUE/);
    assert.match(sql, /custom_fields ->> 'synthetic'/);
    assert.match(sql, /~\* \$\d/);
  }
  assert.match(PAID_ENTITLEMENT_SQL, /t\.is_demo IS NOT TRUE/);
  assert.match(UNRESOLVED_PAID_SQL, /t\.is_demo IS NOT TRUE/);
  assert.match(UNRESOLVED_PAID_SQL, /lower\(btrim\(COALESCE\(t\.status, ''\)\)\) = \$2/);
  assert.match(PAID_ENTITLEMENT_SQL, /lower\(btrim\(COALESCE\(t\.status, ''\)\)\) = \$2/);
  assert.match(NEXT_STEP_SQL, /rp\.status <> 'cancelled'/);
  // The entitlement is looked up by the same code the product map names, case and space ignored.
  assert.match(PAID_ENTITLEMENT_SQL, /lower\(btrim\(pe\.product_code\)\) = lower\(btrim\(p\.code\)\)/);
  assert.match(PAID_ENTITLEMENT_SQL, /e\.entitlement_code = lower\(btrim\(p\.entitlement_code\)\)/);
  assert.match(SUMMARY_CLIENT_SQL, /c\.is_demo IS NOT TRUE/);
  assert.equal(READ_ONLY_SQL.length, 4 + SUMMARY_READS.length);
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
  // The scripts check needs no database, so it still reads the pages.
  assert.equal(rows.find((r) => r.id === "portal:page-scripts-load").status, "PASS");
  assert.equal(rows.find((r) => r.id === "portal:progress-read-real-client").status, "skip");
  assert.equal(rows.find((r) => r.id === "portal:paid-client-never-signed-in").status, "skip");
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
  // The only two places this file may say "password" are the reset page's own
  // path and the box it must still have. Nothing here handles a credential.
  const withoutPageWords = src
    .replaceAll("/reset-password.html", "")
    .replaceAll('type="password"', "");
  assert.doesNotMatch(withoutPageWords, /password|magic-link|client_id=/i);
  assert.match(src, /Do not invent a second watchdog/);
  assert.doesNotMatch(src, /second tripwire|new watchdog/i);
});

/* Payments whose product name matches no product. The join in the first read
   drops them, so these are read apart. */

test("a payment under an unknown product name and a client with nothing fails", async () => {
  const rows = await gapChecks({
    db: fakeDb({ unresolved: [unresolvedRow("u1"), unresolvedRow("u2", { hasAny: true })] }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  assertShape(rows);
  const row = rows.find((r) => r.id === "portal:paid-entitlement");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 paid client paid under a product name that matches no product and holds no entitlement at all/);
  assert.doesNotMatch(row.detail, /mapped product/);
  assert.match(row.suggestedFix, /alias/);
  assert.match(row.suggestedFix, /Do not guess a product/);
  assert.match(row.suggestedFix, /Do not auto-fix from this pulse/);
  assert.doesNotMatch(row.detail, /u1/);
});

test("an unknown product name whose client still holds an entitlement passes and is counted", async () => {
  const rows = await gapChecks({
    db: fakeDb({ unresolved: [unresolvedRow("u1", { hasAny: true })] }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  const row = rows.find((r) => r.id === "portal:paid-entitlement");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /plus 1 under a product name that matches no product/);
});

test("an unknown product name with no payment event is left out and named", async () => {
  const rows = await gapChecks({
    db: fakeDb({ unresolved: [unresolvedRow("u1", { door: false }), unresolvedRow("u2", { door: false })] }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  const row = rows.find((r) => r.id === "portal:paid-entitlement");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /2 payments with no payment event are left out/);
});

test("an unknown product name on a test client is not counted at all", async () => {
  const rows = await gapChecks({
    db: fakeDb({ unresolved: [unresolvedRow("t1", { isTest: true })] }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  const row = rows.find((r) => r.id === "portal:paid-entitlement");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /plus 0 under a product name/);
});

test("a mapped miss and an unknown-name miss are both named in one row", async () => {
  const rows = await gapChecks({
    db: fakeDb({
      entitlement: [paidRow("c1", false, false)],
      unresolved: [unresolvedRow("u1"), unresolvedRow("u1")]
    }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  const row = rows.find((r) => r.id === "portal:paid-entitlement");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 paid client has no entitlement for a mapped product/);
  assert.match(row.detail, /1 paid client paid under a product name that matches no product/);
  assert.match(row.suggestedFix, /Write the entitlement/);
  assert.match(row.suggestedFix, /alias/);
});

test("the unknown-name read failing is a fail, not a pass", async () => {
  const rows = await gapChecks({
    db: fakeDb({ entitlement: [paidRow("c1", false, true)], failOn: /gap:portal-unresolved-paid/ }),
    orgId: ORG,
    fetchImpl: fetchImpl(healthyRoutes(), [])
  });
  const row = rows.find((r) => r.id === "portal:paid-entitlement");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /paid entitlement read failed/);
});

test("the unknown-name sql looks only at names that resolve to nothing, and at the payment door", () => {
  assert.match(UNRESOLVED_PAID_SQL, /resolve_product_id\(t\.org_id, t\.product_name\) IS NULL/);
  assert.match(UNRESOLVED_PAID_SQL, /FROM entitlements e\s+WHERE e\.org_id = t\.org_id\s+AND e\.client_id = t\.client_id/);
  assert.match(UNRESOLVED_PAID_SQL, /ev\.name = 'payment\.received'/);
  assert.match(UNRESOLVED_PAID_SQL, /interval '1 day'/);
  assert.match(UNRESOLVED_PAID_SQL, /t\.client_id IS NOT NULL/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   Tier 1 tripwires — Claude, 2026-10-09
   ═══════════════════════════════════════════════════════════════════════════ */

const BASE = "https://fundhub.ai";
const PUBLIC = path.join(REPO, "public");

function routesWith(change) {
  const routes = siteRoutes();
  change(routes);
  return routes;
}

async function scripts(routes, extra = {}) {
  const calls = [];
  const row = await checkPageScripts({ fetchImpl: fetchImpl(routes, calls), baseUrl: BASE, ...extra });
  return { row, calls };
}

/* ── portal:page-scripts-load ───────────────────────────────────────────── */

test("scripts: all six pages whole and every file they name answering is a PASS", async () => {
  const { row, calls } = await scripts(siteRoutes());
  assert.equal(row.id, "portal:page-scripts-load");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /^6 customer pages answered whole and all 9 script and style files/);
  assert.equal(row.suggestedFix, null);
  const asked = new Set(calls.map((c) => new URL(c.url).pathname));
  assert.deepEqual([...asked].sort(), [...Object.keys(SITE_PAGES), ...SITE_FILES].sort());
  for (const c of calls) {
    assert.equal(c.init.method, "GET");
    assert.equal(c.init.credentials, "omit");
    assert.ok(c.init.signal, "every fetch carries a timeout");
    assert.ok(c.url.startsWith(BASE + "/"));
  }
  // Each file is asked for once even when three pages name it.
  assert.equal(calls.length, asked.size);
});

test("scripts: a script that answers 404 is a FAIL that names it", async () => {
  const { row } = await scripts(routesWith((r) => { r["/app/shell.js"] = { status: 404, text: "nope" }; }));
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 problem on the customer pages: \/app\/shell\.js answered 404/);
  assert.match(row.suggestedFix, /Do not auto-fix from this pulse/);
});

test("scripts: a style file or script that is empty is a FAIL", async () => {
  const css = await scripts(routesWith((r) => { r["/fh.css"] = { status: 200, text: "  \n", type: "text/css" }; }));
  assert.equal(css.row.status, "FAIL");
  assert.match(css.row.detail, /\/fh\.css is empty/);
  const js = await scripts(routesWith((r) => { r["/app/data.js"] = { status: 200, text: "" }; }));
  assert.equal(js.row.status, "FAIL");
  assert.match(js.row.detail, /\/app\/data\.js is empty/);
});

test("scripts: a script that comes back as a web page is a FAIL", async () => {
  const { row } = await scripts(routesWith((r) => {
    r["/app/money.js"] = { status: 200, text: "<html>not found</html>", type: "text/html; charset=utf-8" };
  }));
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /\/app\/money\.js came back as a web page, not a script/);
});

test("scripts: a page that answers 404 or 500 is a FAIL, and so is one that never answers", async () => {
  for (const status of [404, 500]) {
    const { row } = await scripts(routesWith((r) => { r["/progress.html"] = { status, text: "x" }; }));
    assert.equal(row.status, "FAIL", String(status));
    assert.match(row.detail, new RegExp(`/progress\\.html answered ${status}`));
  }
  const down = await checkPageScripts({
    baseUrl: BASE,
    fetchImpl: async (url) => {
      if (new URL(url).pathname === "/app/payment-success.html") throw new Error("socket hang up");
      return fetchImpl(siteRoutes(), [])(url, {});
    }
  });
  assert.equal(down.status, "FAIL");
  assert.match(down.detail, /\/app\/payment-success\.html did not answer \(socket hang up\)/);
});

test("scripts: a page that is empty, cut short, or has lost what it cannot work without is a FAIL", async () => {
  const cases = [
    ["/progress.html", "<html></html>", /came back almost empty/],
    ["/progress.html", pageText("/progress.html").replace("</html>", ""), /cut short/],
    ["/progress.html", pageText("/progress.html", { title: "  " }), /has no title/],
    ["/portal-login.html", pageText("/portal-login.html").replace(/<form[^>]*>|<\/form>/g, ""), /has lost its sign-in form/],
    ["/portal-login.html", pageText("/portal-login.html").replace('type="email"', 'type="text"'), /has lost its email box/],
    ["/reset-password.html", pageText("/reset-password.html").replace('type="password"', 'type="text"'), /has lost its reset fields/],
    ["/app/client-portal.html", pageText("/app/client-portal.html").replace("data-tile", "data-x"), /has lost its tiles/]
  ];
  for (const [pagePath, text, expect] of cases) {
    const { row } = await scripts(routesWith((r) => { r[pagePath] = { status: 200, text }; }));
    assert.equal(row.status, "FAIL", `${pagePath} ${expect}`);
    assert.match(row.detail, expect);
  }
});

test("scripts: a page that is empty without its scripts must still name some", async () => {
  for (const pagePath of ["/app/client-portal.html", "/app/financeos.html"]) {
    const text = pageText(pagePath).replace(/<script[^>]*><\/script>/g, "");
    const { row } = await scripts(routesWith((r) => { r[pagePath] = { status: 200, text }; }));
    assert.equal(row.status, "FAIL", pagePath);
    assert.match(row.detail, new RegExp(`${pagePath.replace(/\./g, "\\.")} names no script at all`));
  }
  // The progress page draws itself and has no files to name: that is fine.
  const ok = await scripts(siteRoutes());
  assert.equal(ok.row.status, "PASS");
});

test("scripts: a long list of problems is cut to four and counts the rest", async () => {
  const { row } = await scripts(routesWith((r) => {
    for (const file of SITE_FILES) r[file] = { status: 404, text: "x" };
  }));
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /^9 problems on the customer pages: /);
  assert.match(row.detail, /; and 5 more$/);
  assert.ok(row.detail.length <= 500, "the detail must fit the 500 characters the pulse keeps");
});

test("scripts: no fetch in the run is a skip, never a pass", async () => {
  const row = await checkPageScripts({ baseUrl: BASE });
  assert.equal(row.status, "skip");
  assert.match(row.detail, /no fetch/);
});

test("scripts: running out of time with nothing red is a skip, with a red it is still a FAIL", async (t) => {
  let clock = 1_000_000;
  t.mock.method(Date, "now", () => clock);
  // The pages answer at once. The first file takes 20 s, which is past the 14 s
  // budget, so the rest of the files are never asked for.
  const slow = (routes) => async (url, init) => {
    if (!(new URL(url).pathname in SITE_PAGES)) clock += 20000;
    return fetchImpl(routes, [])(url, init);
  };
  const quiet = await checkPageScripts({ fetchImpl: slow(siteRoutes()), baseUrl: BASE });
  assert.equal(quiet.status, "skip");
  assert.match(quiet.detail, /ran out of time \(14 s\) with 8 of 15 files not read; nothing red in the rest/);
  clock = 1_000_000;
  const red = await checkPageScripts({
    fetchImpl: slow(routesWith((r) => { r["/progress.html"] = { status: 500, text: "x" }; })),
    baseUrl: BASE
  });
  assert.equal(red.status, "FAIL");
  assert.match(red.detail, /\/progress\.html answered 500/);
});

test("scripts: at most eight files are in flight at once", async () => {
  let live = 0;
  let peak = 0;
  const routes = siteRoutes();
  const inner = fetchImpl(routes, []);
  await checkPageScripts({
    baseUrl: BASE,
    fetchImpl: async (url, init) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const res = await inner(url, init);
      live -= 1;
      return res;
    }
  });
  assert.ok(peak <= 8 + CUSTOMER_PAGES.length, `peak ${peak}`);
  // Pages go first and together; files then go through the cap of eight.
  assert.ok(peak >= 6);
});

test("scripts: the page list is the live registry's, and every file is in public/", () => {
  const registered = new Set(PULSE_REGISTRY.map((r) => r.path));
  for (const page of CUSTOMER_PAGES) {
    assert.ok(registered.has(page.path), `${page.path} is not in the pulse registry`);
    assert.ok(fs.existsSync(path.join(PUBLIC, page.path)), `${page.path} is not in public/`);
  }
  assert.deepEqual(CUSTOMER_PAGES.map((p) => p.path), [
    "/portal-login.html", "/reset-password.html", "/app/client-portal.html",
    "/progress.html", "/app/payment-success.html", "/app/financeos.html"
  ]);
});

test("scripts: pageAssets reads a page's own list: relative, absolute, query, comments, other sites", () => {
  const html = `<!doctype html><html><head>
    <link rel="stylesheet" href="fundhub-brand.css">
    <link rel="stylesheet" href="/fh.css?v=3#top">
    <link rel="icon" href="/favicon.ico">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
    <link rel="modulepreload" href="chunk.js">
    <script defer src="shell.js"></script>
    <script src='data.js'></script>
    <script src=plain.js></script>
    <script>var inline = 1;</script>
    <script src="https://cdn.example.com/x.js"></script>
    <script src="data:text/javascript,1"></script>
    <!-- <script src="old.js"></script> <link rel="stylesheet" href="old.css"> -->
    <script>navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" });</script>
    </head><body></body></html>`;
  const got = pageAssets(html, `${BASE}/app/client-portal.html`, BASE);
  assert.deepEqual(got.map((a) => `${a.kind}:${new URL(a.url).pathname}${new URL(a.url).search}`), [
    "style:/app/fundhub-brand.css",
    "style:/fh.css?v=3",
    "script:/app/chunk.js",
    "script:/app/shell.js",
    "script:/app/data.js",
    "script:/app/plain.js",
    "script:/app/sw.js"
  ]);
  // A fragment is not part of a file's address, so it is never sent.
  assert.ok(got.every((a) => !a.url.includes("#")));
  // Only the service worker line is marked as a worker.
  assert.deepEqual(got.filter((a) => a.worker).map((a) => new URL(a.url).pathname), ["/app/sw.js"]);
});

test("scripts: read against the real pages in public/, the lists are what the map says", () => {
  const read = (file) => fs.readFileSync(path.join(PUBLIC, file), "utf8");
  const names = (file, pagePath) =>
    pageAssets(read(file), `${BASE}${pagePath}`, BASE).map((a) => new URL(a.url).pathname);

  const portal = names("app/client-portal.html", "/app/client-portal.html");
  for (const must of ["/app/shell.js", "/app/data.js", "/app/fundhub-brand.css", "/app/client-portal-sw.js"]) {
    assert.ok(portal.includes(must), `client-portal.html no longer names ${must}`);
  }
  const money = names("app/financeos.html", "/app/financeos.html");
  assert.ok(money.filter((n) => n.endsWith(".js")).length >= 18, "financeos.html names its 18 scripts");
  assert.ok(money.includes("/app/financeos.js") && money.includes("/app/money-credit.js"));
  assert.deepEqual(names("portal-login.html", "/portal-login.html"), ["/fh.css"]);
  assert.deepEqual(names("reset-password.html", "/reset-password.html"), ["/fh.css", "/pw-toggle.js"]);
  assert.deepEqual(names("progress.html", "/progress.html"), []);
  assert.deepEqual(names("app/payment-success.html", "/app/payment-success.html"), ["/app/fundhub-brand.css"]);
  // Every file the pages name is really in public/, so a rename shows up here
  // before it shows up on the live pages.
  for (const name of [...portal, ...money, "/fh.css", "/pw-toggle.js"]) {
    assert.ok(fs.existsSync(path.join(PUBLIC, name)), `${name} is named by a page but is not in public/`);
  }
  // And each real page passes the page rules the check applies.
  for (const page of CUSTOMER_PAGES) {
    const text = read(page.path.replace(/^\//, ""));
    assert.ok(text.length >= 500 && /<\/html>/i.test(text), page.path);
    for (const need of page.needs) assert.ok(need.re.test(text), `${page.path} lacks ${need.label}`);
  }
});

/* ── portal:progress-read-real-client ───────────────────────────────────── */

function payloadOf(overrides = {}) {
  return {
    stage: { key: "analysis" },
    scores: { personal: [{ score: 700 }, { score: null }, { score: 690 }], business: [] },
    movement: {},
    waypoints: [],
    timeline: [],
    deliverables: [],
    ...overrides
  };
}

function runOn(db) {
  return (fn) => fn(db);
}

const waypointRow = (n) => ({
  id: `w${n}`, position: n, key: `k${n}`, title: `Step ${n}`, owner_kind: "client", state: "not_started",
  due_at: null, completed_at: null, verify_kind: null, paid_alternative_price_cents: null
});

test("progress: the real read, run for the newest paying client, is a PASS when nothing under it fails", async () => {
  const db = fakeDb({
    waypointRows: [waypointRow(1), waypointRow(2)],
    progressRows: { waypoints: 2, deliverables: 0, repair_stages: [] }
  });
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) });
  const row = rows.find((r) => r.id === "portal:progress-read-real-client");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /no read failing/);
  assert.match(row.detail, /2 checklist steps/);
  assert.match(row.detail, /counts match the client's own rows/);
  const pick = db.calls.find((c) => /gap:portal-progress-client/.test(c.sql));
  assert.deepEqual(pick.params, [ORG, "succeeded", INTERNAL_CLIENT_EMAIL_RE]);
  const rowsCall = db.calls.find((c) => /gap:portal-progress-rows/.test(c.sql));
  assert.deepEqual(rowsCall.params.slice(0, 2), [ORG, CLIENT]);
  assert.equal(rowsCall.params[2], "optimization");
  // The real read ran: it asked for this client's waypoints, scores and documents.
  const sent = db.calls.map((c) => c.sql).join("\n");
  for (const table of ["client_waypoints", "crs_results", "documents", "dispute_items", "paid_service_requests"]) {
    assert.match(sent, new RegExp(table), `the real progress read never asked for ${table}`);
  }
  // Every statement it sent is one plain read.
  for (const c of db.calls) assert.ok(isPlainRead(c.sql), c.sql.slice(0, 60));
});

test("progress: a read that fails underneath is a FAIL, even though the page code hides it", async (t) => {
  t.mock.method(console, "warn", () => {});
  // readClientProgress catches this and hands back an empty list. A page built
  // from that looks like a new client with no steps. The check must see it.
  const db = fakeDb({ failOn: /SELECT \* FROM client_waypoints/ });
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) });
  const row = rows.find((r) => r.id === "portal:progress-read-real-client");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /read behind the page failed and the page would show an empty section: boom/);
  assert.match(row.suggestedFix, /client-progress/);
  assert.match(row.suggestedFix, /Do not auto-fix from this pulse/);
  // The cross-check is not reached once a read has failed.
  assert.ok(!db.calls.some((c) => /gap:portal-progress-rows/.test(c.sql)));
});

test("progress: every swallowed read is counted, and the first one is named", async (t) => {
  t.mock.method(console, "warn", () => {});
  const db = fakeDb({ failOn: /FROM crs_results|FROM documents\s+WHERE client_id/ });
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) });
  const row = rows.find((r) => r.id === "portal:progress-read-real-client");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 reads behind the page failed/);
});

test("progress: an empty page for a client who has steps on file is a FAIL", async () => {
  const db = fakeDb({ waypointRows: [], progressRows: { waypoints: 3, deliverables: 0, repair_stages: [] } });
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) });
  const row = rows.find((r) => r.id === "portal:progress-read-real-client");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /the client has 3 checklist steps on file and the page gets 0/);
});

test("progress: documents on file that the page does not get are a FAIL", async () => {
  const db = fakeDb({ progressRows: { waypoints: 0, deliverables: 2, repair_stages: [] } });
  const row = (await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) }))
    .find((r) => r.id === "portal:progress-read-real-client");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /the client has 2 documents on file and the page gets 0/);
});

test("progress: a repair card in one stage and a page showing no stage is a FAIL", async () => {
  const db = fakeDb({ progressRows: { waypoints: 0, deliverables: 0, repair_stages: ["awaiting_response"] } });
  const row = (await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) }))
    .find((r) => r.id === "portal:progress-read-real-client");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /repair card is at "awaiting_response" and the page shows "no stage"/);
});

test("progress: a card whose stage the page shows is a PASS", async () => {
  const base = fakeDb({ progressRows: { waypoints: 0, deliverables: 0, repair_stages: ["analysis"] } });
  const real = base.query;
  base.query = async (sql, params) => (/AS stage_key/.test(sql) ? { rows: [{ stage_key: "analysis" }] } : real(sql, params));
  const row = (await gapChecks({ db: base, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) }))
    .find((r) => r.id === "portal:progress-read-real-client");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /stage analysis/);
});

test("progress: a read that throws outright is a FAIL", async () => {
  const db = fakeDb();
  const row = await checkProgressRead({
    run: runOn(db), orgId: ORG,
    deps: { readClientProgress: async () => { throw new Error("column nope does not exist"); }, REPAIR_PIPELINE: "optimization" }
  });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /the read threw: column nope does not exist/);
});

test("progress: an answer with the wrong shape is a FAIL", async () => {
  const deps = (payload) => ({ readClientProgress: async () => payload, REPAIR_PIPELINE: "optimization" });
  const cases = [
    [null, /the read gave back nothing/],
    [payloadOf({ stage: undefined }), /no stage block/],
    [payloadOf({ scores: { personal: [], business: [] } }), /no three score panels/],
    [payloadOf({ movement: undefined }), /no movement block/],
    [payloadOf({ waypoints: undefined }), /no waypoints list/],
    [payloadOf({ timeline: null }), /no timeline list/],
    [payloadOf({ deliverables: {} }), /no deliverables list/]
  ];
  for (const [payload, expect] of cases) {
    const row = await checkProgressRead({ run: runOn(fakeDb()), orgId: ORG, deps: deps(payload) });
    assert.equal(row.status, "FAIL", String(expect));
    assert.match(row.detail, expect);
  }
});

test("progress: a read that tries to write is refused before the database sees it, and is a FAIL", async () => {
  const db = fakeDb();
  const row = await checkProgressRead({
    run: runOn(db), orgId: ORG,
    deps: {
      REPAIR_PIPELINE: "optimization",
      // Swallowed on purpose, the way the page code swallows its read failures.
      readClientProgress: async (guard) => {
        for (const sql of [
          "UPDATE clients SET first_name = 'x'",
          "INSERT INTO events (name) VALUES ('x')",
          "WITH gone AS (DELETE FROM events RETURNING 1) SELECT * FROM gone",
          "SELECT id FROM clients FOR UPDATE"
        ]) {
          try { await guard.query(sql, []); } catch { /* the page code does this */ }
        }
        return payloadOf();
      }
    }
  });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /tried to run a query that is not a plain read, and the pulse refused it/);
  assert.ok(!db.calls.some((c) => /UPDATE|INSERT|DELETE/.test(c.sql)), "a write reached the database");
});

test("progress: the guard lets a plain read through and refuses every kind of write", () => {
  for (const ok of [
    "SELECT 1",
    "  /* gap:x */ SELECT * FROM client_waypoints WHERE a = $1",
    "WITH a AS (SELECT 1) SELECT * FROM a",
    "SELECT updated_at, created_at, granted_by, deleted_at FROM t WHERE status = 'deleted'",
    "SELECT alternative_kind FROM t"
  ]) assert.equal(isPlainRead(ok), true, ok);
  for (const bad of [
    "UPDATE t SET a = 1", "insert into t values (1)", "DELETE FROM t", "TRUNCATE t",
    "DROP TABLE t", "ALTER TABLE t ADD c int", "CREATE TABLE t (a int)", "GRANT ALL ON t TO x",
    "SELECT * FROM t FOR UPDATE", "WITH d AS (DELETE FROM t RETURNING 1) SELECT * FROM d",
    "", null, "BEGIN", "SET LOCAL x = 1", "COMMIT"
  ]) assert.equal(isPlainRead(bad), false, String(bad));
});

test("progress: no paying client on file is a skip, not a pass", async () => {
  const row = (await gapChecks({ db: fakeDb({ progressClient: null }), orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) }))
    .find((r) => r.id === "portal:progress-read-real-client");
  assert.equal(row.status, "skip");
  assert.match(row.detail, /no real paying client/);
});

test("progress: no database or no org is a skip", async () => {
  assert.equal((await checkProgressRead({ orgId: ORG })).status, "skip");
  assert.equal((await checkProgressRead({ run: runOn(fakeDb()) })).status, "skip");
});

test("progress: a client that cannot be picked is a skip; a count that cannot be made is a skip unless the read failed", async (t) => {
  t.mock.method(console, "warn", () => {});
  const pickDb = fakeDb({ failOn: /gap:portal-progress-client/ });
  const picked = await checkProgressRead({ run: runOn(pickDb), orgId: ORG });
  assert.equal(picked.status, "skip");
  assert.match(picked.detail, /could not pick a paying client/);

  const countDb = fakeDb({ failOn: /gap:portal-progress-rows/ });
  const counted = await checkProgressRead({ run: runOn(countDb), orgId: ORG });
  assert.equal(counted.status, "skip");
  assert.match(counted.detail, /could not be counted/);

  // A read that failed is a FAIL whether or not the count could be made.
  const both = fakeDb({ failOn: /SELECT \* FROM client_waypoints|gap:portal-progress-rows/ });
  assert.equal((await checkProgressRead({ run: runOn(both), orgId: ORG })).status, "FAIL");
});

test("progress: a read that never finishes is a FAIL, not a hang", async () => {
  const row = await checkProgressRead({
    run: runOn(fakeDb()), orgId: ORG, timeoutMs: 40,
    deps: { REPAIR_PIPELINE: "optimization", readClientProgress: () => new Promise(() => {}) }
  });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /did not finish inside 0 seconds|did not finish inside/);
  assert.match(row.detail, /the page would hang/);
});

test("progress: a database that never answers the pick is a skip", async () => {
  const db = fakeDb();
  const row = await checkProgressRead({
    run: (fn) => fn({ query: () => new Promise(() => {}) }), orgId: ORG, timeoutMs: 40,
    deps: { REPAIR_PIPELINE: "optimization", readClientProgress: async () => payloadOf() }
  });
  assert.equal(row.status, "skip");
  assert.match(row.detail, /could not pick a paying client to read: no answer in/);
  assert.equal(db.calls.length, 0);
});

test("progress: the reads go through the staff scope when the run has one", async () => {
  const db = fakeDb();
  let scoped = 0;
  const scope = (fn) => { scoped += 1; return fn(db); };
  const rows = await gapChecks({ db: null, scope, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) });
  const row = rows.find((r) => r.id === "portal:progress-read-real-client");
  assert.equal(row.status, "PASS");
  assert.ok(scoped >= 3, "pick, read and count each go through the scope");
});

/* ── portal:paid-client-never-signed-in ─────────────────────────────────── */

const holder = (over = {}) => ({
  client_id: "c1", days_held: "3.67", is_test: false, paid_through_door: true,
  signed_in: false, asked_since_access: false, ...over
});

async function neverRow(signIns) {
  const db = fakeDb({ signIns });
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) });
  return { row: rows.find((r) => r.id === "portal:paid-client-never-signed-in"), db };
}

test("never signed in: nobody holding access past 72 hours is a PASS that says so", async () => {
  const { row, db } = await neverRow([]);
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /no paying client has held portal access for over 72 hours yet/);
  assert.equal(row.suggestedFix, null);
  const call = db.calls.find((c) => /gap:portal-never-signed-in/.test(c.sql));
  assert.deepEqual(call.params, [ORG, INTERNAL_CLIENT_EMAIL_RE]);
});

test("never signed in: paying clients who have all signed in are a PASS", async () => {
  const { row } = await neverRow([holder({ signed_in: true }), holder({ client_id: "c2", signed_in: true })]);
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /^2 paying clients have held portal access for over 72 hours and every one has signed in/);
});

test("never signed in: a paying client who holds access and has not signed in is a FAIL", async () => {
  const { row } = await neverRow([holder()]);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /^1 paying client has held portal access for over 72 hours and has never signed in/);
  assert.match(row.detail, /longest wait 3 days; 0 of 1 asked for a sign-in link since access was given\)/);
  assert.doesNotMatch(row.detail, /never asked/, "a refused request before access is not 'never asked'");
  assert.match(row.suggestedFix, /Send each of them their sign-in link/);
  assert.match(row.suggestedFix, /Do not auto-fix from this pulse/);
  assert.doesNotMatch(row.detail, /c1/);
});

test("never signed in: two waiting, one who asked for a link, counted and the longest wait named", async () => {
  const { row } = await neverRow([
    holder({ days_held: "4.2", asked_since_access: true }),
    holder({ client_id: "c2", days_held: "9.9" }),
    holder({ client_id: "c3", signed_in: true, days_held: "30" })
  ]);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /^2 paying clients have held portal access for over 72 hours and have never signed in/);
  assert.match(row.detail, /longest wait 9 days; 1 of 2 asked for a sign-in link since access was given\)/);
});

test("never signed in: a row with no asked answer reads as not asked, and the words say 'since access was given'", async () => {
  const row0 = holder();
  delete row0.asked_since_access;
  const { row } = await neverRow([row0]);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /0 of 1 asked for a sign-in link since access was given/);
  // The old column is gone: a stale name must not be read as "asked".
  const { row: stale } = await neverRow([holder({ asked_for_link: true })]);
  assert.match(stale.detail, /0 of 1 asked/);
});

test("never signed in: a null sign-in answer counts as not signed in", async () => {
  const { row } = await neverRow([holder({ signed_in: null })]);
  assert.equal(row.status, "FAIL");
});

test("never signed in: test clients and payments with no payment event are left out and counted", async () => {
  const { row } = await neverRow([
    holder({ client_id: "t1", is_test: true }),
    holder({ client_id: "t2", is_test: true, paid_through_door: false }),
    holder({ client_id: "u1", paid_through_door: false }),
    holder({ client_id: "ok", signed_in: true })
  ]);
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /^1 paying client has held portal access for over 72 hours and every one has signed in/);
  assert.match(row.detail, /Left out: 2 test clients, 1 with no payment event\./);
});

test("never signed in: a real waiting client is a FAIL beside left-out ones", async () => {
  const { row } = await neverRow([holder({ client_id: "t1", is_test: true }), holder({ client_id: "u1", paid_through_door: false }), holder()]);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /^1 paying client has held/);
  assert.match(row.detail, /Left out: 1 test client, 1 with no payment event\./);
});

test("never signed in: a database error is a skip with the reason, never a pass", async () => {
  const db = fakeDb({ failOn: /gap:portal-never-signed-in/ });
  const rows = await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), []) });
  const row = rows.find((r) => r.id === "portal:paid-client-never-signed-in");
  assert.equal(row.status, "skip");
  assert.match(row.detail, /could not read who has signed in: boom/);
});

test("never signed in: no database or no org is a skip", async () => {
  assert.equal((await checkPaidNeverSignedIn({ orgId: ORG })).status, "skip");
  assert.equal((await checkPaidNeverSignedIn({ run: runOn(fakeDb()) })).status, "skip");
});

test("never signed in: the sql counts only live access, only paid clients, only real sign-ins", () => {
  assert.equal(SIGN_IN_GRACE, "72 hours");
  const sql = NEVER_SIGNED_IN_SQL;
  assert.match(sql, /h\.since < now\(\) - interval '72 hours'/);
  // access: a live entitlement, or a stored pack
  assert.match(sql, /e\.revoked_at IS NULL\s+AND \(e\.expires_at IS NULL OR e\.expires_at > now\(\)\)/);
  assert.match(sql, /d\.kind = 'deliverable'/);
  assert.match(sql, /e\.is_demo IS NOT TRUE/);
  assert.match(sql, /d\.is_demo IS NOT TRUE/);
  // the clock starts when access was first given
  assert.match(sql, /min\(e\.granted_at\)/);
  assert.match(sql, /min\(COALESCE\(d\.generated_at, d\.created_at\)\)/);
  // paid: succeeded, not demo, came through the payment door
  assert.match(sql, /lower\(btrim\(COALESCE\(t\.status, ''\)\)\) = 'succeeded'/);
  assert.match(sql, /t\.is_demo IS NOT TRUE/);
  assert.match(sql, /ev\.name = 'payment\.received'/);
  assert.match(sql, /interval '1 day'/);
  // signed in: a client account that logged in, or a link that was used
  assert.match(sql, /a\.kind = 'client'\s+AND a\.last_login_at IS NOT NULL/);
  assert.match(sql, /m\.consumed_at IS NOT NULL/);
  assert.match(sql, /m\.client_id = h\.client_id/);
  assert.match(sql, /a2\.client_id = h\.client_id/);
  // asked for a link since access: bound to the client OR the client's own address
  assert.match(sql, /m2\.created_at >= h\.since/);
  assert.match(sql, /m2\.client_id = h\.client_id\s+OR m2\.email = lower\(btrim\(COALESCE\(c\.email, ''\)\)\)/);
  // test clients
  assert.match(sql, /c\.is_demo IS TRUE/);
  assert.match(sql, /custom_fields ->> 'synthetic'/);
  assert.match(sql, /~\* \$2/);
});

test("never signed in: the wider test pattern catches the internal addresses and no buyer", () => {
  const re = new RegExp(INTERNAL_CLIENT_EMAIL_RE, "i");
  for (const mail of [
    "test+crs@fundhub.ai",
    "e2e+financeos-14a16-1791356843463@fundhub.ai",
    "bakerskater987+test.commas.1786606351723@gmail.com",
    "someone@fundhub.ai",
    "stanbridgejchris+sim-12@gmail.com",
    "adv-blk5a-1.1@example.test",
    "roster@demo.fundhub.local"
  ]) assert.ok(re.test(mail), mail);
  for (const mail of [
    "bramselleslach@gmail.com",
    "test.person@gmail.com",
    "contest+1@gmail.com",
    "pat+testing@gmail.com",
    "jane@fundhub.com",
    "jane@notfundhub.ai.example.org"
  ]) assert.ok(!re.test(mail), mail);
  // The older checks keep the older pattern, so their results do not move.
  assert.ok(!new RegExp(TEST_CLIENT_EMAIL_RE, "i").test("test+crs@fundhub.ai"));
});

/* ── all three ──────────────────────────────────────────────────────────── */

test("tier 1: every new statement is one plain read, tagged, and listed", () => {
  assert.deepEqual(READ_ONLY_SQL_TIER_1, [NEVER_SIGNED_IN_SQL, PROGRESS_CLIENT_SQL, PROGRESS_ROWS_SQL]);
  for (const sql of READ_ONLY_SQL_TIER_1) {
    assert.ok(isPlainRead(sql));
    assert.match(sql, /^\/\* gap:portal-[a-z-]+ \*\//);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/);
  }
  // The newest paying client is picked by what they paid, never by a demo flag alone.
  assert.match(PROGRESS_CLIENT_SQL, /ORDER BY t\.created_at DESC\s+LIMIT 1/);
  assert.match(PROGRESS_CLIENT_SQL, /ev\.name = 'payment\.received'/);
  assert.match(PROGRESS_CLIENT_SQL, /t\.is_demo IS NOT TRUE/);
  assert.match(PROGRESS_ROWS_SQL, /d\.kind = 'deliverable'/);
});

test("tier 1: the three new ids are this lane's and nobody else's", () => {
  const ids = IDS.slice(4);
  for (const file of fs.readdirSync(HERE)) {
    if (!/^gap-.*\.mjs$/.test(file) || file.endsWith(".test.mjs") || file === "gap-portal.mjs") continue;
    const src = fs.readFileSync(path.join(HERE, file), "utf8");
    for (const id of ids) assert.ok(!src.includes(`"${id}"`), `${file} also names ${id}`);
  }
});

test("tier 1: the lane stays inside one step's clock when the site and database are slow", async () => {
  // Pages and files all answer in 30 ms, the database in 30 ms: the whole lane
  // is a few hundred milliseconds, and nothing waits for another check.
  const delay = () => new Promise((resolve) => setTimeout(resolve, 30));
  const db = fakeDb();
  const real = db.query;
  db.query = async (sql, params) => { await delay(); return real(sql, params); };
  const inner = fetchImpl(siteRoutes(), []);
  const started = Date.now();
  const rows = await gapChecks({
    db, orgId: ORG,
    fetchImpl: async (url, init) => { await delay(); return inner(url, init); }
  });
  assertShape(rows);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  assert.deepEqual(rows.map((r) => r.status), Array(7).fill("PASS"));
});

test("tier 1: an org that cannot be read still reads the pages and skips the two new database rows", async () => {
  const db = fakeDb({ failAll: "no orgs table" });
  const rows = await gapChecks({ db, fetchImpl: fetchImpl(siteRoutes(), []) });
  assertShape(rows);
  assert.equal(rows.find((r) => r.id === "portal:page-scripts-load").status, "PASS");
  for (const id of ["portal:progress-read-real-client", "portal:paid-client-never-signed-in"]) {
    const row = rows.find((r) => r.id === id);
    assert.equal(row.status, "skip", id);
    assert.match(row.detail, /default org/);
  }
});

test("tier 1: the new checks only ever send GET and only plain reads", async () => {
  const calls = [];
  const db = fakeDb();
  await gapChecks({ db, orgId: ORG, fetchImpl: fetchImpl(siteRoutes(), calls) });
  assert.ok(calls.length >= 15);
  assert.ok(calls.every((c) => c.init.method === "GET"));
  for (const c of db.calls) {
    assert.ok(isPlainRead(c.sql) || /FROM orgs/i.test(c.sql), c.sql.slice(0, 60));
  }
});
