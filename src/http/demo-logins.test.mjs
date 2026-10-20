// The demo-login switch, and the four places the roster is written down.
//
// No database. Everything here is either pure logic (src/auth/demo-logins.mjs)
// or a read of files on disk, so it runs on every `npm test` rather than
// skipping when DATABASE_URL is unset. The behaviour that needs a real Postgres
// — "this account can actually sign in with the flag set" — is in the sibling
// src/http/demo-logins.pg.test.mjs.
//
// WHAT THIS IS GUARDING AGAINST, in order of how expensive it is:
//
//   1. The switch failing OPEN. If DEMO_LOGINS_ENABLED unset ever came to mean
//      "allowed", nine accounts whose password is printed on the login page
//      become live logins on a regulated consumer-finance system, one of them
//      an owner. That is the failure this whole feature is shaped around, so it
//      is asserted first and from several directions.
//
//   2. The roster drifting apart. It is written in FOUR places —
//      src/auth/demo-roster.mjs, db/migrations/094_demo_logins.sql,
//      public/login.html and public/app/shell.js's ROLE_TABS. A role that is in
//      one and not another produces an account that signs in and then bounces
//      straight back to the login page, which reads exactly like "the login is
//      broken" and is not.

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

import {
  demoLoginsEnabled, isDemoEmail, isDemoIdentity, demoLoginRefusal,
  DEMO_ENV_VAR, DEMO_EMAIL_DOMAIN
} from "../auth/demo-logins.mjs";
import { DEMO_LOGINS, DEMO_STAFF, DEMO_ACCOUNTS, DEMO_PASSWORD } from "../auth/demo-roster.mjs";
import { MIN_PASSWORD_LENGTH } from "../auth/hash.mjs";
// The real handler, not its source text. src/db.mjs builds its pool lazily
// (src/db.mjs:pool), so this import is safe with DATABASE_URL unset and the GET
// branch never reaches a database.
import loginHandler from "../../api/auth/login.mjs";

const ROOT = process.cwd();
const MIGRATION = path.join(ROOT, "db/migrations/094_demo_logins.sql");
/* The seventh staff login. 094 was already applied when sales_manager was
   built, and an edit to an applied migration never runs — see the roster test. */
const SALES_MANAGER_MIGRATION = path.join(ROOT, "db/migrations/112_sales_manager_role.sql");
const CSM_MIGRATION = path.join(ROOT, "db/migrations/290_csm_role.sql");
const OUTBOUND_REP_MIGRATION = path.join(ROOT, "db/migrations/484_outbound_rep_demo_login.sql");
const LOGIN_PAGE = path.join(ROOT, "public/login.html");
const SHELL = path.join(ROOT, "public/app/shell.js");

const read = (p) => fs.readFileSync(p, "utf8");

// Same parser as src/auth/role-catalog-drift.pg.test.mjs, deliberately: if the
// shape of ROLE_TABS changes, both tests should fail together and loudly.
function roleTabsKeys(source) {
  const block = source.match(/var ROLE_TABS = \{([\s\S]*?)\n {2}\};/);
  assert.ok(block, "could not find ROLE_TABS in shell.js — did the shape change?");
  return [...block[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
}

/* ------------------------------------------------------------------------ */
describe("DEMO_LOGINS_ENABLED fails closed", () => {

  test("unset means disabled", () => {
    assert.equal(demoLoginsEnabled({}), false);
    assert.equal(demoLoginsEnabled({ SOMETHING_ELSE: "1" }), false);
  });

  test("a missing env object means disabled, not a throw", () => {
    assert.equal(demoLoginsEnabled(undefined), false);
    assert.equal(demoLoginsEnabled(null), false);
  });

  test("an unrecognised value means disabled — a typo must not switch nine accounts on", () => {
    for (const v of ["", " ", "0", "false", "no", "off", "maybe", "TRUEISH", "2", "null", "undefined"]) {
      assert.equal(demoLoginsEnabled({ [DEMO_ENV_VAR]: v }), false,
        `${JSON.stringify(v)} must not enable demo logins`);
    }
  });

  test("a non-string value means disabled", () => {
    assert.equal(demoLoginsEnabled({ [DEMO_ENV_VAR]: true }), false);
    assert.equal(demoLoginsEnabled({ [DEMO_ENV_VAR]: 1 }), false);
  });

  test("the values that do enable it", () => {
    for (const v of ["1", "true", "TRUE", " yes ", "on", "enabled"]) {
      assert.equal(demoLoginsEnabled({ [DEMO_ENV_VAR]: v }), true,
        `${JSON.stringify(v)} should enable demo logins`);
    }
  });
});

/* ------------------------------------------------------------------------ */
describe("who counts as a demo identity", () => {

  test("the is_demo column is authoritative, however Postgres hands it over", () => {
    // The login queries read it through `to_jsonb(row) ->> 'is_demo'`, which
    // yields the STRING "true" — not a boolean. A check that only accepted
    // `=== true` would silently let every demo row through the gate.
    assert.equal(isDemoIdentity({ email: "real@fundhub.ai", is_demo: true }), true);
    assert.equal(isDemoIdentity({ email: "real@fundhub.ai", is_demo: "true" }), true);
    assert.equal(isDemoIdentity({ email: "real@fundhub.ai", is_demo: "t" }), true);
  });

  test("a database without migration 094 yields undefined, which is not flagged", () => {
    assert.equal(isDemoIdentity({ email: "real@fundhub.ai", is_demo: undefined }), false);
    assert.equal(isDemoIdentity({ email: "real@fundhub.ai", is_demo: null }), false);
    assert.equal(isDemoIdentity({ email: "real@fundhub.ai", is_demo: "false" }), false);
  });

  test("the demo domain alone is enough, flag or no flag", () => {
    assert.equal(isDemoEmail(`owner@${DEMO_EMAIL_DOMAIN}`), true);
    assert.equal(isDemoEmail(`OWNER@${DEMO_EMAIL_DOMAIN.toUpperCase()}`), true);
    assert.equal(isDemoIdentity({ email: `owner@${DEMO_EMAIL_DOMAIN}` }), true);
  });

  test("a lookalike domain is NOT the demo domain", () => {
    // The suffix check is anchored on the "@", so it matches the whole domain
    // and not merely a string ending in one. Both directions matter: a real
    // domain that happens to contain "demo.fundhub.local" must not be swept in,
    // and a demo-looking subdomain is not the demo domain either.
    assert.equal(isDemoEmail("owner@demo.fundhub.local.example.com"), false);
    assert.equal(isDemoEmail("owner@notdemo.fundhub.local"), false);
    assert.equal(isDemoEmail("owner@mail.demo.fundhub.local"), false);
    assert.equal(isDemoEmail("owner@fundhub.local"), false);
    assert.equal(isDemoEmail("demo.fundhub.local"), false);         // no @ at all
    assert.equal(isDemoEmail(null), false);
    assert.equal(isDemoEmail(12345), false);
  });
});

/* ------------------------------------------------------------------------ */
describe("demoLoginRefusal — refuses demo rows, never touches real ones", () => {

  const demo = { email: `closer@${DEMO_EMAIL_DOMAIN}`, is_demo: "true" };
  const real = { email: "chris@fundhub.ai", is_demo: "false" };

  test("demo row + flag unset = refused, 403, named", () => {
    const r = demoLoginRefusal(demo, {});
    assert.ok(r, "a demo row must be refused when the switch is off");
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.equal(r.error, "demo_logins_disabled");
    assert.match(r.message, new RegExp(DEMO_ENV_VAR));
  });

  test("demo row + flag set = allowed", () => {
    assert.equal(demoLoginRefusal(demo, { [DEMO_ENV_VAR]: "1" }), null);
  });

  test("a real account is unaffected with the flag unset", () => {
    assert.equal(demoLoginRefusal(real, {}), null);
  });

  test("a real account is unaffected with the flag set", () => {
    assert.equal(demoLoginRefusal(real, { [DEMO_ENV_VAR]: "1" }), null);
  });

  test("a real account is unaffected with the flag set to nonsense", () => {
    assert.equal(demoLoginRefusal(real, { [DEMO_ENV_VAR]: "banana" }), null);
  });

  test("no identity at all is not a demo identity", () => {
    assert.equal(demoLoginRefusal(null, {}), null);
    assert.equal(demoLoginRefusal({}, {}), null);
  });
});

/* ------------------------------------------------------------------------ */
describe("the gate is actually wired into both login paths", () => {

  // A pure-logic module that nothing calls protects nothing. These read the two
  // login files and assert the call exists AND that it sits after the password
  // check — a refusal placed before verifyPassword would be a timing oracle and,
  // worse, would invite someone to "simplify" it into a check that replaces the
  // password comparison rather than following it.

  test("src/auth/login.mjs consults the gate, after verifyPassword", () => {
    const src = read(path.join(ROOT, "src/auth/login.mjs"));
    assert.match(src, /demoLoginRefusal/, "staff login does not consult the demo gate");
    assert.ok(src.indexOf("verifyPassword(password, staff.password_hash)")
              < src.indexOf("demoLoginRefusal("),
      "the demo gate must come AFTER the password check, never instead of it");
  });

  test("src/auth/account-session.mjs consults the gate, after verifyPassword", () => {
    const src = read(path.join(ROOT, "src/auth/account-session.mjs"));
    assert.match(src, /demoLoginRefusal/, "account login does not consult the demo gate");
    const verifyAt = src.indexOf("verifyPassword(password, acct.password_hash)");
    assert.ok(verifyAt !== -1 && verifyAt < src.lastIndexOf("demoLoginRefusal("),
      "the demo gate must come AFTER the password check, never instead of it");
  });

  test("neither login path was given a password bypass", () => {
    for (const f of ["src/auth/login.mjs", "src/auth/account-session.mjs"]) {
      const src = read(path.join(ROOT, f));
      assert.doesNotMatch(src, /is_demo[^\n]*\?\s*true/,
        `${f} looks like it short-circuits a check on is_demo`);
      assert.match(src, /verifyPassword\(/, `${f} no longer verifies a password at all`);
    }
  });
});

/* ------------------------------------------------------------------------ */
describe("the roster is the same in all four places", () => {

  test("twelve logins, one per role", () => {
    // Nine staff since outbound_rep was built on 2026-10-19 (483/484).
    // Eight staff since csm was built on 2026-09-05
    // (db/migrations/290_csm_role.sql), which followed sales_manager on
    // 2026-08-01 (112_sales_manager_role.sql). Plus the three principals.
    assert.equal(DEMO_LOGINS.length, 12);
    assert.equal(DEMO_STAFF.length, 9);
    assert.equal(DEMO_ACCOUNTS.length, 3);
    const roles = DEMO_LOGINS.map((d) => d.role);
    assert.equal(new Set(roles).size, 12, `duplicate role in the roster: ${roles}`);
  });

  test("every role is one public/app/shell.js grants tabs to", () => {
    // This is the bounce bug in test form. shell.js:allowedFor() returns the
    // shared staff tabs for a role it does not know, and signOut()s a role with
    // no screens at all — either way the owner ends up somewhere other than the
    // portal he clicked.
    const keys = new Set(roleTabsKeys(read(SHELL)));
    for (const d of DEMO_LOGINS) {
      assert.ok(keys.has(d.role),
        `demo role "${d.role}" is not in shell.js ROLE_TABS — it would sign in and bounce`);
    }
    // And the reverse: a role in the shell with nobody to sign in as is the
    // whole problem this seed exists to fix.
    const seeded = new Set(DEMO_LOGINS.map((d) => d.role));
    const unreachable = [...keys].filter((k) => !seeded.has(k));
    assert.deepEqual(unreachable, [],
      `shell.js grants tabs to ${JSON.stringify(unreachable)} with no demo account to reach them`);
  });

  test("every address is on the demo domain and nothing else is", () => {
    for (const d of DEMO_LOGINS) {
      assert.ok(isDemoEmail(d.email), `${d.email} is not on ${DEMO_EMAIL_DOMAIN}`);
    }
    assert.equal(new Set(DEMO_LOGINS.map((d) => d.email)).size, 12, "duplicate demo address");
  });

  test("every name reads as a demo account", () => {
    for (const d of DEMO_LOGINS) {
      assert.match(d.name, /^DEMO /,
        `"${d.name}" would sit in a staff or client list looking like a real person`);
    }
  });

  test("the shared password is long enough for hashPassword to accept it", () => {
    // hashPassword() throws below MIN_PASSWORD_LENGTH, so a shorter value would
    // make scripts/db/demo-password-hash.mjs fail — and, historically, produced
    // the login page advertising "demo1234", a password no row could ever hold.
    assert.ok(DEMO_PASSWORD.length >= MIN_PASSWORD_LENGTH,
      `demo password is ${DEMO_PASSWORD.length} chars, minimum is ${MIN_PASSWORD_LENGTH}`);
  });

  test("the migration seeds exactly this roster", () => {
    /* Two files now, not one. 094_demo_logins.sql was already applied when the
       sales_manager role was built on 2026-08-01, and migrate.mjs keys
       schema_migrations on <dir>/<file> — editing an applied migration is a
       silent no-op. So 112_sales_manager_role.sql carries that one login, and
       290_csm_role.sql carries the CSM added on 2026-09-05 for the same
       reason. The roster is checked against all three rather than 094 alone,
       and every future role migration that seeds a login joins this list. */
    const sql = read(MIGRATION) + "\n" + read(SALES_MANAGER_MIGRATION)
              + "\n" + read(CSM_MIGRATION) + "\n" + read(OUTBOUND_REP_MIGRATION);
    for (const d of DEMO_LOGINS) {
      assert.ok(sql.includes(`'${d.email}'`),
        `no demo-login migration mentions ${d.email}`);
    }
    for (const s of DEMO_STAFF) {
      assert.ok(sql.includes(`'${s.role}'`),
        `no demo-login migration seeds the role ${s.role}`);
    }
    for (const a of DEMO_ACCOUNTS) {
      assert.ok(sql.includes(`'${a.kind}', '${a.email}'`),
        `094_demo_logins.sql does not insert ${a.email} as kind ${a.kind}`);
    }
  });

  test("the migration marks every row it writes as a demo row", () => {
    const sql = read(MIGRATION);
    assert.match(sql, /ALTER TABLE staff\s+ADD COLUMN IF NOT EXISTS is_demo/);
    assert.match(sql, /ALTER TABLE accounts\s+ADD COLUMN IF NOT EXISTS is_demo/);
    // Six staff + three accounts + three subject rows + two clients all carry it.
    assert.ok((sql.match(/\btrue\b/g) || []).length >= 9,
      "not every seeded row appears to set is_demo = true");
  });

  test("the new outreach demo seed is additive, org-scoped and preserves existing credentials", () => {
    const sql = read(OUTBOUND_REP_MIGRATION);
    assert.match(sql, /FROM orgs WHERE is_default/);
    assert.match(sql, /org_id = v_org AND is_demo = true/);
    assert.match(sql, /IF v_hash IS NULL THEN RETURN/);
    assert.match(sql, /'outbound_rep','active',v_hash,true/);
    assert.match(sql, /WHERE NOT EXISTS \(/);
    assert.match(sql, /org_id = v_org AND lower\(email\) = 'outbound@demo\.fundhub\.local'/);
    assert.doesNotMatch(sql, /^\s*(?:UPDATE|DELETE|TRUNCATE|ALTER ROLE)\b/im);
  });

  test("the migration binds the default org and never deletes or overwrites", () => {
    const sql = read(MIGRATION);
    assert.match(sql, /FROM orgs WHERE is_default/,
      "the seed must bind a real org — audit C1: a row with no org fails closed everywhere");
    assert.doesNotMatch(sql, /^\s*DELETE\s+FROM/im, "094 must never delete a row");
    assert.doesNotMatch(sql, /^\s*TRUNCATE/im, "094 must never truncate");
    assert.doesNotMatch(sql, /^\s*UPDATE\s+\w+\s+SET/im,
      "094 must never overwrite an existing row — guarded inserts only");
    // Idempotence: every INSERT is guarded, by NOT EXISTS or by ON CONFLICT.
    // Re-running this file must be a no-op, because the owner will run
    // `node db/migrate.mjs` more than once and a second set of demo rows would
    // collide with the unique indexes on staff email and accounts email.
    const inserts = (sql.match(/INSERT INTO/g) || []).length;
    const guards = (sql.match(/NOT EXISTS \(/g) || []).length
                 + (sql.match(/ON CONFLICT/g) || []).length;
    assert.ok(guards >= inserts,
      `${inserts} INSERTs but only ${guards} guards — re-running would duplicate rows`);
  });

  test("public/login.html carries NO demo credential in its source", () => {
    // THIS ASSERTION IS THE REVERSE OF WHAT IT USED TO BE, AND THAT IS THE POINT.
    //
    // The page used to hold the nine addresses and the shared password as a
    // JavaScript literal. login.html is a static asset: `curl .../login.html`
    // returned that password whether or not DEMO_LOGINS_ENABLED was set, and it
    // would keep returning it on the day somebody switched demo logins off in
    // production — switching an env var does not rewrite an HTML file. The gate
    // worked and the page gave the password away anyway.
    //
    // The roster now arrives from GET /api/auth/login, which reads the switch
    // server-side. So with the switch off there is nothing to serve, nothing to
    // render, and nothing in View Source.
    const html = read(LOGIN_PAGE);

    assert.ok(!html.includes(DEMO_PASSWORD),
      "the demo password is hardcoded in login.html — it would be readable with the switch off");

    for (const d of DEMO_LOGINS) {
      assert.ok(!html.includes(d.email),
        `${d.email} is hardcoded in login.html — the roster must come from the server`);
    }
    // The domain itself, in case somebody rebuilds the addresses from parts.
    assert.ok(!html.includes(DEMO_EMAIL_DOMAIN),
      `login.html mentions ${DEMO_EMAIL_DOMAIN} — no part of a demo address belongs in the served file`);

    // Naming the SWITCH is still required and is not a credential. It tells
    // whoever finds the panel missing which variable to set.
    assert.match(html, /DEMO_LOGINS_ENABLED/,
      "login.html must name the switch these accounts depend on");
  });

  test("public/login.html asks the server whether the panel exists", () => {
    // "Ask the server" is the requirement. A page that decided this from a
    // client-side constant would be back to shipping the roster.
    const html = read(LOGIN_PAGE);
    assert.match(html, /fetch\("\/api\/auth\/login",\s*\{\s*headers:[^}]*accept/,
      "login.html never GETs /api/auth/login to find out whether demo logins are on");
    assert.match(html, /demo\.enabled !== true/,
      "login.html must render the panel only on an explicit enabled === true from the server");
  });

  test("public/login.html no longer prefills a password that cannot work", () => {
    const html = read(LOGIN_PAGE);
    assert.doesNotMatch(html, /id="pw"[^>]*value=/,
      'the password field must not ship a prefilled value — "demo1234" was 8 chars and no row could hold it');
  });

  test("login.html clears the sticky offline-demo flag before signing in", () => {
    // public/fh.js:109 sets fh_demo="1" the first time its client-side mock
    // answers a login, and fh.js:177 then routes EVERYTHING — including the
    // next login — to that mock and never contacts the backend again. Only
    // signing out clears it. A browser that once fell back while the API was
    // down can never sign in for real from that point on, which is what "I
    // still can't log in" looks like from the outside. The login page has to
    // clear it or no seeded account is reachable from that browser.
    const html = read(LOGIN_PAGE);
    assert.match(html, /removeItem\("fh_demo"\)/,
      "login.html does not clear the sticky fh_demo flag — a browser stuck in offline demo mode can never sign in for real");
    assert.match(html, /removeItem\("fh_demo_staff"\)/);
  });

  test("login.html asks the backend directly, so a 403 is not swallowed", () => {
    // fh.js:188 keeps the backend's reply only when data.ok is true or the
    // status is 401; a 403 (suspended account, or demo logins switched off) is
    // discarded and the local mock answers "invalid_credentials" instead. That
    // tells someone their password is wrong when it is right.
    const html = read(LOGIN_PAGE);
    assert.match(html, /fetch\("\/api\/auth\/login"/,
      "login.html goes through FH.api, which replaces real refusals with a guess");
    assert.match(html, /r\.status < 500/,
      "login.html must still fall back to the offline mock on a 5xx or a dead backend");
  });

  test("login.html caches a role for principals, not only for staff", () => {
    // Without this the client, affiliate and partner portals sign in and then
    // sit on a held-back blank screen until the slow path resolves.
    const html = read(LOGIN_PAGE);
    assert.match(html, /data\.account && data\.account\.kind/,
      "login.html does not read the principal kind off a non-staff login");
  });
});

/* ------------------------------------------------------------------------ */
/* THE ONE-CLICK SWITCHER.
 *
 * The owner opens a portal, judges it, and switches to the next — nine times in
 * one sitting. What can go wrong, in order of cost:
 *
 *   1. The panel, and therefore the password, being served when the switch is
 *      OFF. That is the whole feature failing open, so it is asserted first.
 *   2. A button landing on the wrong screen. public/app/shell.js sends a role
 *      that asks for a screen it may not open back to its home, and a role with
 *      no allowed screens straight to signOut() → /login.html. Either way the
 *      click "does not work" and reads as a broken login rather than as a wrong
 *      href, so the roster's `lands` is checked against the shell's HOME map
 *      entry by entry.
 *
 * These run the REAL handler (api/auth/login.mjs) rather than reading its
 * source. src/db.mjs builds its pool lazily, so importing the handler without
 * DATABASE_URL is safe and the GET branch never reaches a database at all.     */

/** HOME out of public/app/shell.js. Same shape of parse as roleTabsKeys above,
 *  and it asserts it found the block — a shell refactor must fail loudly here
 *  rather than silently comparing against an empty map. */
function homeMap(source) {
  const block = source.match(/var HOME = \{([\s\S]*?)\n {2}\};/);
  assert.ok(block, "could not find HOME in shell.js — did the shape change?");
  const out = {};
  for (const m of block[1].matchAll(/^\s*([a-z_]+):\s*"([^"]+)"/gm)) out[m[1]] = m[2];
  return out;
}

const resStub = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
};

/** Call GET /api/auth/login with the switch in a known state, and put the
 *  environment back exactly as it was — other suites in this process read it. */
async function getOptions(flag) {
  const had = Object.prototype.hasOwnProperty.call(process.env, DEMO_ENV_VAR);
  const prev = process.env[DEMO_ENV_VAR];
  if (flag === undefined) delete process.env[DEMO_ENV_VAR];
  else process.env[DEMO_ENV_VAR] = flag;
  try {
    const res = resStub();
    await loginHandler({ method: "GET", headers: {}, query: {} }, res);
    return res;
  } finally {
    if (had) process.env[DEMO_ENV_VAR] = prev;
    else delete process.env[DEMO_ENV_VAR];
  }
}

describe("GET /api/auth/login — the switcher's roster, gated server-side", () => {

  test("switch unset: no roster, no addresses, no password anywhere in the reply", async () => {
    const res = await getOptions(undefined);
    assert.equal(res.code, 200);
    assert.equal(res.body.demo.enabled, false);
    assert.equal(res.body.demo.logins, undefined, "a roster was sent with the switch off");
    assert.equal(res.body.demo.password, undefined, "the password was sent with the switch off");

    // Belt and braces: nothing anywhere in the serialised body, however it is
    // nested. This is the assertion that survives someone adding a field.
    const wire = JSON.stringify(res.body);
    assert.ok(!wire.includes(DEMO_PASSWORD), "the demo password is in the switched-off reply");
    assert.ok(!wire.includes(DEMO_EMAIL_DOMAIN), "a demo address is in the switched-off reply");
    for (const d of DEMO_LOGINS) assert.ok(!wire.includes(d.email), `${d.email} leaked`);
  });

  test("a typo in the switch is still off", async () => {
    // Same strictness as demoLoginsEnabled, asserted at the endpoint, because
    // this is the layer that hands out the password.
    for (const v of ["", "0", "false", "no", "off", "maybe", "2"]) {
      const res = await getOptions(v);
      assert.equal(res.body.demo.enabled, false, `${JSON.stringify(v)} served the roster`);
      assert.ok(!JSON.stringify(res.body).includes(DEMO_PASSWORD),
        `${JSON.stringify(v)} served the password`);
    }
  });

  test("switch on: all twelve, each with the label, the portal and a home", async () => {
    const res = await getOptions("1");
    assert.equal(res.code, 200);
    assert.equal(res.body.demo.enabled, true);
    assert.equal(res.body.demo.password, DEMO_PASSWORD);
    const logins = res.body.demo.logins;
    assert.equal(logins.length, 12);
    for (const d of logins) {
      for (const k of ["role", "email", "name", "label", "portal", "home"]) {
        assert.ok(d[k] && String(d[k]).trim(), `demo login ${d.role} has no ${k}`);
      }
      assert.ok(isDemoEmail(d.email), `${d.email} is not on the demo domain`);
    }
    assert.equal(new Set(logins.map((d) => d.role)).size, 12, "duplicate role in the switcher");
  });

  test("outbound rep uses the normal gated switcher and opens only its bank workspace", async () => {
    const roster = (await getOptions("1")).body.demo.logins;
    const outreach = roster.filter(d => d.role === "outbound_rep");
    assert.equal(outreach.length, 1);
    assert.deepEqual(outreach[0], { role: "outbound_rep", email: "outbound@demo.fundhub.local", name: "DEMO Outbound Rep", label: "Outbound rep", portal: "Bank outreach", home: "/app/bank-outreach.html" });
    assert.equal(demoLoginRefusal(outreach[0], {}).error, "demo_logins_disabled");
    assert.equal(demoLoginRefusal(outreach[0], { [DEMO_ENV_VAR]: "typo" }).error, "demo_logins_disabled");
    assert.equal(demoLoginRefusal(outreach[0], { [DEMO_ENV_VAR]: "1" }), null);
    assert.equal((await getOptions(undefined)).body.demo.logins, undefined);
  });

  test("the reply carries nothing the page does not render", async () => {
    // A projection, not the roster spread wholesale — so a field added to
    // demo-roster.mjs later does not silently start crossing the wire.
    const { logins } = (await getOptions("1")).body.demo;
    const allowed = new Set(["role", "email", "name", "label", "portal", "home"]);
    for (const d of logins) {
      for (const k of Object.keys(d)) assert.ok(allowed.has(k), `unexpected field "${k}" sent to the browser`);
    }
  });

  test("every button lands on THAT role's home screen, per shell.js HOME", async () => {
    // The failure this prevents: a button that signs in correctly and then
    // lands on a screen the role may not open, which shell.js redirects away
    // from — indistinguishable from "the login is broken" at the far end.
    const HOME = homeMap(read(SHELL));
    const { logins } = (await getOptions("1")).body.demo;
    for (const d of logins) {
      assert.ok(HOME[d.role], `shell.js HOME has no entry for ${d.role}`);
      const expected = HOME[d.role].startsWith("/") ? HOME[d.role] : "/app/" + HOME[d.role];
      assert.equal(d.home, expected,
        `the ${d.role} button opens ${d.home} but shell.js sends ${d.role} to ${expected}`);
    }
    // And the reverse: a role the shell has a home for, with no button to reach
    // it, is a portal the owner still cannot open.
    const seeded = new Set(logins.map((d) => d.role));
    const unreachable = Object.keys(HOME).filter((r) => !seeded.has(r));
    assert.deepEqual(unreachable, [],
      `shell.js has a home screen for ${JSON.stringify(unreachable)} with no switcher button`);
  });

  test("every home is a real screen file that exists on disk", async () => {
    // shell.js:isScreen() only checks the SHAPE of the href. A typo'd filename
    // passes that and 404s in the browser, so the file is checked here.
    // Every role lands on a screen inside /app/. The closer used to land on
    // /dashboard.html outside it; that page was deleted (owner-set 2026-08-17).
    const { logins } = (await getOptions("1")).body.demo;
    for (const d of logins) {
      assert.match(d.home, /^\/app\/[a-z0-9-]+\.html$/,
        `${d.home} is not an allowed home path`);
      assert.ok(fs.existsSync(path.join(ROOT, "public", d.home.replace(/^\//, ""))),
        `${d.role} opens ${d.home}, which does not exist`);
    }
  });

  test("the button text says what opens, not what the role is called in the database", async () => {
    // "setter" asks the owner to know what a setter sees before he clicks.
    // "Setter — Pipeline" tells him. The role key must not BE the label.
    const { logins } = (await getOptions("1")).body.demo;
    for (const d of logins) {
      assert.notEqual(d.label, d.role, `the ${d.role} button is labelled with its database key`);
      assert.ok(!/_/.test(d.label), `"${d.label}" still reads like a column value`);
    }
    // The three portals he named are the ones he is here to look at.
    const byRole = Object.fromEntries(logins.map((d) => [d.role, d]));
    assert.equal(byRole.affiliate.portal, "Affiliate Portal");
    assert.equal(byRole.partner.portal, "Partner Galaxy");
    assert.equal(byRole.client.portal, "Client Portal");
    assert.equal(byRole.partner.label, "White-label partner");
  });

  test("POST is untouched — the GET branch did not swallow the real login", async () => {
    // The whole point of mounting this on an existing route is that
    // netlify/functions/api.mjs dispatches on PATH only. That makes it easy to
    // break POST while adding GET.
    const res = resStub();
    await loginHandler({ method: "PUT", headers: {}, query: {}, body: {} }, res);
    assert.equal(res.code, 405, "a non-GET, non-POST method must still be refused");
    const src = read(path.join(ROOT, "api/auth/login.mjs"));
    assert.match(src, /req\.method === "GET"/);
    assert.match(src, /req\.method !== "POST"/,
      "the POST guard was removed when the GET branch went in");
  });
});

/* ------------------------------------------------------------------------ */
describe("the switcher signs in properly, and marks itself", () => {

  test("the page posts the login form, it does not fake a session", () => {
    // The one thing that must never be true of a one-click demo button: that it
    // writes a token itself, or sets fh_demo_staff, instead of going through
    // POST /api/auth/login and the same scrypt verifyPassword as everyone else.
    const html = read(LOGIN_PAGE);
    assert.match(html, /await signIn\(\{ email: d\.email, password: password \}\)/,
      "the switcher button does not go through signIn() — check it is not minting its own session");
    assert.ok(!/setItem\("fh_demo_staff"/.test(html),
      "login.html writes fh_demo_staff — that is the offline mock's session, not a real one");
    assert.ok(!/setItem\("fh_demo"/.test(html),
      "login.html sets the sticky offline-demo flag it exists to clear");
  });

  test("the home path is checked before it becomes a navigation", () => {
    const html = read(LOGIN_PAGE);
    assert.match(html, /\^\\\/app\\\/\[a-z0-9-\]\+\\\.html\$/,
      "login.html assigns a server-supplied path to location.href without checking its shape");
  });

  test("everything from the wire goes through esc() before innerHTML", () => {
    const html = read(LOGIN_PAGE);
    assert.match(html, /function esc\(/, "login.html has no esc() helper");
    // Every interpolation into the two innerHTML blocks that builds from `d` or
    // `demo` must be wrapped. Catch the raw form directly.
    for (const raw of ["+ d.label +", "+ d.portal +", "+ d.email +", "+ d.home +", "+ demo.password +"]) {
      assert.ok(!html.includes(raw), `login.html interpolates ${raw.trim()} into HTML unescaped`);
    }
  });

  test("the demo marker is only believed while a token is held", () => {
    // public/app/shell.js:signOut() clears fh_token and knows nothing about
    // fh_demo_role, so on its own the marker would outlive the session and tell
    // him he is signed in as an affiliate an hour after he signed out.
    const html = read(LOGIN_PAGE);
    assert.match(html, /if \(!localStorage\.getItem\("fh_token"\)\) \{ localStorage\.removeItem\(DEMO_ROLE_KEY\); return null; \}/,
      "the demo marker is not tied to holding a session token");
  });

  test("the in-app marker exists without shell.js being touched", () => {
    // The permanent marker inside the portals is public/app/shell.js:mountChip,
    // which draws a fixed chip reading staff.name. It says DEMO on every screen
    // only because every seeded name starts with "DEMO " — that is load-bearing,
    // not cosmetic, and renaming a demo row would silently remove the only
    // marker the app itself shows.
    const shell = read(SHELL);
    assert.match(shell, /esc\(staff\.name \|\| staff\.email\)/,
      "shell.js no longer renders staff.name in the chip — the in-app DEMO marker is gone");
    for (const d of DEMO_LOGINS) {
      assert.match(d.name, /^DEMO /, `"${d.name}" would show in the app chip without saying DEMO`);
    }
  });
});
