import test from "node:test";
import assert from "node:assert/strict";

import {
  gapChecks,
  READ_ONLY_SQL,
  LOGIN_FAIL_MIN,
  LOGIN_FAIL_EMAILS,
  SESSION_PROBE_HASH,
  SIGNIN_GRANTS,
  STAFF_LOGIN_SQL,
  MAGIC_TEMPLATE_SQL,
  MAGIC_DEAD_SQL,
  SESSION_READ_SQL,
  SIGNIN_NO_SESSION_SQL,
  RESET_READ_SQL,
  RESEND_ENV_KEYS
} from "./gap-auth.mjs";

const IDS = [
  "gap:auth-staff-login",
  "gap:auth-magic-link-dead",
  "gap:auth-session-read",
  "gap:auth-signin-no-session",
  "gap:auth-reset-mail"
];

const ORG = "00000000-0000-0000-0000-0000000000aa";
// Fake values with the real shape. Never a real key.
const GOOD_ENV = { RESEND_API_KEY: "re_fake_key_for_tests", RESEND_FROM: "Fundhub <noreply@fundhub.ai>" };
const MASKED_ENV = { RESEND_API_KEY: "****************abcd", RESEND_FROM: "Fundhub <noreply@fundhub.ai>" };

function fakeDb(map) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (/\b(insert|update|delete|drop|alter|truncate|grant)\b/i.test(text)) {
        throw new Error("write sql");
      }
      for (const [needle, value] of map) {
        if (text.includes(needle)) {
          if (value instanceof Error) throw value;
          return { rows: value };
        }
      }
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

function healthyMap(over = {}) {
  return fakeDb([
    ["gap:auth-staff-login", [{
      active_with_password: 2,
      ok_n: 1,
      bad_n: 0,
      bad_emails: 0,
      ...over.staff
    }]],
    ["gap:auth-magic-link-template", over.templates || [{
      template_key: "EMAIL-PORTAL-MAGIC-LINK",
      compliance_passed: true,
      body: "Here is your link",
      subject: "Your Fundhub sign-in link"
    }]],
    ["gap:auth-magic-link-dead", [{ n: over.dead ?? 0 }]],
    ["gap:auth-session-read", [{ staff_hits: 0, account_hits: 0, missing_privs: null, ...over.session }]],
    ["gap:auth-signin-no-session", [{
      staff_ok: 3, staff_no_session: 0, links_used: 1, links_no_session: 0, ...over.signin
    }]],
    ["gap:auth-reset-mail", [{ asked: over.asked ?? 0, resend_ok_7d: over.resendOk ?? 5, ...over.reset }]]
  ]);
}

function byId(rows) {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(row.id.length > 0);
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  if (row.status === "FAIL") assert.equal(typeof row.suggestedFix, "string");
  else assert.equal(row.suggestedFix, null);
}

test("gap auth sql is select only", () => {
  assert.equal(READ_ONLY_SQL.length, 6);
  for (const sql of READ_ONLY_SQL) {
    const body = sql.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    // WITH ... SELECT is still a read. The next line bans every write word anywhere in the text.
    assert.match(body, /^(SELECT|WITH)\b/i);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate)\b/i);
  }
  assert.match(STAFF_LOGIN_SQL, /auth_attempts/);
  assert.match(MAGIC_TEMPLATE_SQL, /EMAIL-PORTAL-MAGIC-LINK/);
  assert.match(MAGIC_DEAD_SQL, /account_magic_links/);
  assert.match(MAGIC_DEAD_SQL, /20 minutes/);
  assert.match(SESSION_READ_SQL, /account_sessions/);
  assert.match(RESET_READ_SQL, /password_resets/);
  assert.match(SIGNIN_NO_SESSION_SQL, /account_sessions/);
  assert.equal(SESSION_PROBE_HASH.length, 64);
});

test("no database skips every missing check", async () => {
  const rows = await gapChecks({});
  assert.deepEqual(rows.map((row) => row.id), IDS);
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "skip");
  }
  const again = await gapChecks({ db: {} });
  assert.ok(again.every((row) => row.status === "skip"));
});

test("a quiet healthy login lane passes", async () => {
  const db = healthyMap();
  const rows = await gapChecks({ db, env: GOOD_ENV, orgId: ORG });
  assert.deepEqual(rows.map((row) => row.id), IDS);
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "PASS", row.id);
  }
  const sessionCall = db.calls.find((c) => c.sql.includes("gap:auth-session-read"));
  assert.deepEqual(sessionCall.params, [SESSION_PROBE_HASH, JSON.stringify(SIGNIN_GRANTS)]);
});

test("nobody can sign in when no active staff password exists", async () => {
  const db = healthyMap({ staff: { active_with_password: 0, ok_n: 0, bad_n: 1, bad_emails: 1 } });
  const row = byId(await gapChecks({ db }))["gap:auth-staff-login"];
  shape(row);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /password/);
});

test("many failed sign-ins and zero successes is a break", async () => {
  const db = healthyMap({
    staff: { active_with_password: 3, ok_n: 0, bad_n: LOGIN_FAIL_MIN, bad_emails: LOGIN_FAIL_EMAILS }
  });
  const row = byId(await gapChecks({ db }))["gap:auth-staff-login"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /None succeeded/);
});

test("one person mistyping a password is not a company outage", async () => {
  const db = healthyMap({
    staff: { active_with_password: 3, ok_n: 0, bad_n: LOGIN_FAIL_MIN, bad_emails: 1 }
  });
  const row = byId(await gapChecks({ db }))["gap:auth-staff-login"];
  assert.equal(row.status, "PASS");
});

test("failures under the line with a success still pass", async () => {
  const db = healthyMap({
    staff: { active_with_password: 3, ok_n: 1, bad_n: LOGIN_FAIL_MIN, bad_emails: 4 }
  });
  const row = byId(await gapChecks({ db }))["gap:auth-staff-login"];
  assert.equal(row.status, "PASS");
});

test("a staff login read error fails that check only", async () => {
  const db = healthyMap();
  db.query = async (sql, params) => {
    if (String(sql).includes("gap:auth-staff-login")) throw new Error("relation staff does not exist");
    return healthyMap().query(sql, params);
  };
  const rows = byId(await gapChecks({ db }));
  assert.equal(rows["gap:auth-staff-login"].status, "FAIL");
  assert.match(rows["gap:auth-staff-login"].detail, /does not exist/);
  assert.equal(rows["gap:auth-session-read"].status, "PASS");
});

test("a missing sign-in template means the link never queues", async () => {
  const db = healthyMap({ templates: [] });
  const row = byId(await gapChecks({ db }))["gap:auth-magic-link-dead"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /EMAIL-PORTAL-MAGIC-LINK is missing/);
  assert.ok(!db.calls.some((c) => c.sql.includes("gap:auth-magic-link-dead")));
});

test("a draft sign-in template cannot send", async () => {
  const db = healthyMap({
    templates: [{
      template_key: "EMAIL-PORTAL-MAGIC-LINK",
      compliance_passed: true,
      body: "[DRAFT] link",
      subject: "Your Fundhub sign-in link"
    }]
  });
  const row = byId(await gapChecks({ db }))["gap:auth-magic-link-dead"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /cannot send/);
});

test("an issued short link with no email is dead", async () => {
  const db = healthyMap({ dead: 2 });
  const row = byId(await gapChecks({ db }))["gap:auth-magic-link-dead"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 sign-in links/);
});

test("session read failure is a 500-class break", async () => {
  const db = fakeDb([
    ["gap:auth-staff-login", [{ active_with_password: 1, ok_n: 0, bad_n: 0, bad_emails: 0 }]],
    ["gap:auth-magic-link-template", [{
      compliance_passed: true, body: "ok", subject: "ok"
    }]],
    ["gap:auth-magic-link-dead", [{ n: 0 }]],
    ["gap:auth-session-read", new Error("permission denied for table sessions")],
    ["gap:auth-signin-no-session", [{ staff_ok: 0, staff_no_session: 0, links_used: 0, links_no_session: 0 }]],
    ["gap:auth-reset-mail", [{ asked: 0, resend_ok_7d: 1 }]]
  ]);
  const row = byId(await gapChecks({ db }))["gap:auth-session-read"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /permission denied/);
  assert.match(row.suggestedFix, /logout/);
});


test("a session column that drifts away is a 500-class break", async () => {
  const db = healthyMap();
  const real = db.query;
  db.query = async (sql, params) => {
    if (String(sql).includes("gap:auth-session-read")) throw new Error("column s.avatar_key does not exist");
    return real(sql, params);
  };
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-session-read"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /avatar_key/);
});

test("session read must come back with both counts", async () => {
  const db = healthyMap({ session: { account_hits: null } });
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-session-read"];
  assert.equal(row.status, "FAIL");
});

test("the sql reads what sign-in reads, and counts only real staff emails", () => {
  // The one login form tries staff first, so every client sign-in writes a failed
  // staff attempt. Only staff emails may count toward "nobody can sign in".
  assert.match(STAFF_LOGIN_SQL, /EXISTS\s*\(\s*SELECT 1\s+FROM staff s\s+WHERE lower\(s\.email\) = lower\(a\.email\)/);
  assert.match(STAFF_LOGIN_SQL, /is_demo/);
  // Same columns the real session checks read, so drift makes this fail too.
  assert.match(SESSION_READ_SQL, /s\.avatar_key/);
  assert.match(SESSION_READ_SQL, /x\.active_client_id/);
  assert.match(SESSION_READ_SQL, /JOIN staff s ON s\.id = x\.staff_id/);
  assert.match(SESSION_READ_SQL, /JOIN accounts a ON a\.id = x\.account_id/);
  // A suspended account is a real no, not a break.
  assert.match(SIGNIN_NO_SESSION_SQL, /a\.status = 'suspended'/);
  assert.match(SIGNIN_NO_SESSION_SQL, /interval '3 minutes'/);
  assert.match(RESET_READ_SQL, /provider = 'resend'/);
});

test("the sign-in link template is read for the org that sends it", async () => {
  const db = healthyMap();
  await gapChecks({ db, env: GOOD_ENV, orgId: ORG });
  const call = db.calls.find((c) => c.sql.includes("gap:auth-magic-link-template"));
  assert.deepEqual(call.params, [ORG]);
  const noOrg = healthyMap();
  await gapChecks({ db: noOrg, env: GOOD_ENV });
  assert.deepEqual(noOrg.calls.find((c) => c.sql.includes("gap:auth-magic-link-template")).params, [null]);
});

test("a template that only another org has is not good enough", async () => {
  // The org filter is in the sql; with no row back for this org the check fails.
  const db = healthyMap({ templates: [] });
  const row = byId(await gapChecks({ db, env: GOOD_ENV, orgId: ORG }))["gap:auth-magic-link-dead"];
  assert.equal(row.status, "FAIL");
});

test("a sign-in that said yes and made no session fails", async () => {
  const db = healthyMap({ signin: { staff_ok: 4, staff_no_session: 2 } });
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-signin-no-session"];
  shape(row);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 of 4 staff sign-ins said yes and made no session/);
});

test("a magic link that was spent and made no session fails", async () => {
  const db = healthyMap({ signin: { links_used: 3, links_no_session: 1 } });
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-signin-no-session"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 of 3 used magic links made no session/);
});

test("both sign-in breaks are named in one row", async () => {
  const db = healthyMap({ signin: { staff_ok: 1, staff_no_session: 1, links_used: 1, links_no_session: 1 } });
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-signin-no-session"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /staff sign-ins/);
  assert.match(row.detail, /magic links/);
});

test("a quiet day passes and says nothing was there to check", async () => {
  const db = healthyMap({ signin: { staff_ok: 0, links_used: 0 } });
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-signin-no-session"];
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /No staff sign-in or used magic link/);
});

test("a sign-in read error is a fail, not a pass", async () => {
  const db = healthyMap();
  const real = db.query;
  db.query = async (sql, params) => {
    if (String(sql).includes("gap:auth-signin-no-session")) throw new Error("relation sessions does not exist");
    return real(sql, params);
  };
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-signin-no-session"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /does not exist/);
});

test("sign-in counts that do not come back are a fail", async () => {
  const db = healthyMap({ signin: { staff_ok: null } });
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-signin-no-session"];
  assert.equal(row.status, "FAIL");
});

test("reset mail passes when Resend has what it needs", async () => {
  const db = healthyMap({ asked: 2 });
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-reset-mail"];
  shape(row);
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /2 resets asked in 24 hours/);
  for (const key of RESEND_ENV_KEYS) assert.match(row.detail, new RegExp(key));
});

test("reset mail fails when the key is missing and Resend sent nothing this week", async () => {
  const db = healthyMap({ resendOk: 0 });
  const row = byId(await gapChecks({ db, env: { RESEND_FROM: GOOD_ENV.RESEND_FROM } }))["gap:auth-reset-mail"];
  shape(row);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /RESEND_API_KEY is not set/);
  assert.match(row.suggestedFix, /Resend/);
  assert.match(row.suggestedFix, /not the message queue/);
});

test("reset mail fails when both settings are empty", async () => {
  const db = healthyMap({ resendOk: 0 });
  const row = byId(await gapChecks({ db, env: {} }))["gap:auth-reset-mail"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /RESEND_API_KEY and RESEND_FROM are not set/);
});

test("a masked key is not a key", async () => {
  const db = healthyMap({ resendOk: 0 });
  const row = byId(await gapChecks({ db, env: MASKED_ENV }))["gap:auth-reset-mail"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /RESEND_API_KEY/);
});

test("a masked copy on a laptop is a skip when Resend really sent this week", async () => {
  const db = healthyMap({ resendOk: 14 });
  const row = byId(await gapChecks({ db, env: MASKED_ENV }))["gap:auth-reset-mail"];
  assert.equal(row.status, "skip");
  assert.match(row.detail, /14 emails in 7 days/);
});

test("reset mail never writes a key or a from address into the detail", async () => {
  for (const env of [GOOD_ENV, MASKED_ENV, {}]) {
    for (const resendOk of [0, 9]) {
      const db = healthyMap({ resendOk });
      const row = byId(await gapChecks({ db, env }))["gap:auth-reset-mail"];
      const text = `${row.detail} ${row.suggestedFix || ""}`;
      assert.doesNotMatch(text, /re_fake_key/);
      assert.doesNotMatch(text, /abcd/);
      assert.doesNotMatch(text, /noreply@/);
    }
  }
});

test("no env in the run skips the reset mail check, it does not pass it", async () => {
  const db = healthyMap();
  const row = byId(await gapChecks({ db }))["gap:auth-reset-mail"];
  assert.equal(row.status, "skip");
  assert.match(row.detail, /no env/);
});

test("the reset table failing to read is a fail", async () => {
  const db = healthyMap();
  const real = db.query;
  db.query = async (sql, params) => {
    if (String(sql).includes("gap:auth-reset-mail")) throw new Error("permission denied for table password_resets");
    return real(sql, params);
  };
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-reset-mail"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /permission denied/);
});

test("reset counts that do not come back are a fail", async () => {
  const db = healthyMap({ reset: { asked: null } });
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-reset-mail"];
  assert.equal(row.status, "FAIL");
});

test("one broken read never turns another row into a pass", async () => {
  // Every query throws. Nothing may come back PASS or skip: each row is a FAIL.
  const db = {
    calls: [],
    async query(sql) {
      this.calls.push(String(sql));
      throw new Error("connection terminated");
    }
  };
  const rows = await gapChecks({ db, env: GOOD_ENV, orgId: ORG });
  assert.deepEqual(rows.map((r) => r.id), IDS);
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "FAIL", row.id);
  }
});

test("the login lane only reads: no write sql, no transaction control", async () => {
  const db = healthyMap({ asked: 1 });
  await gapChecks({ db, env: GOOD_ENV, orgId: ORG });
  assert.ok(db.calls.length >= 6);
  for (const c of db.calls) {
    assert.doesNotMatch(c.sql, /^\s*(begin|commit|rollback|set|insert|update|delete)\b/i);
    assert.match(c.sql.replace(/\/\*[\s\S]*?\*\//g, "").trim(), /^(SELECT|WITH)\b/i);
  }
});

test("a missing write grant on a sign-in table fails the session row and names it", async () => {
  const db = healthyMap({ session: { missing_privs: "sessions INSERT, staff UPDATE" } });
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-session-read"];
  shape(row);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /sessions INSERT, staff UPDATE/);
  assert.match(row.suggestedFix, /105_login_path_grants/);
});

test("a session row that leaves the grants out is a fail, not a pass", async () => {
  const db = healthyMap();
  const real = db.query;
  db.query = async (sql, params) => {
    if (String(sql).includes("gap:auth-session-read")) return { rows: [{ staff_hits: 0, account_hits: 0 }] };
    return real(sql, params);
  };
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-session-read"];
  assert.equal(row.status, "FAIL");
});

test("blank grant text counts as nothing missing", async () => {
  const db = healthyMap({ session: { missing_privs: "  " } });
  const row = byId(await gapChecks({ db, env: GOOD_ENV }))["gap:auth-session-read"];
  assert.equal(row.status, "PASS");
});

test("the grant probe covers every table sign-in, sessions, logout and reset write", () => {
  const byTable = {};
  for (const g of SIGNIN_GRANTS) (byTable[g.tbl] ||= []).push(g.priv);
  assert.deepEqual(Object.keys(byTable).sort(), [
    "account_magic_links", "account_sessions", "accounts", "auth_attempts", "password_resets", "sessions", "staff"
  ]);
  for (const tbl of ["sessions", "account_sessions"]) {
    assert.deepEqual(byTable[tbl].sort(), ["INSERT", "SELECT", "UPDATE"], `${tbl}: sign-in inserts, the check slides, logout revokes`);
  }
  assert.deepEqual(byTable.auth_attempts.sort(), ["INSERT", "SELECT"]);
  // The words live in the parameter. The SQL text itself carries none.
  assert.match(SESSION_READ_SQL, /jsonb_to_recordset\(\$2::jsonb\)/);
  assert.match(SESSION_READ_SQL, /has_table_privilege\(current_user, 'public\.' \|\| v\.tbl, v\.priv\)/);
  assert.doesNotMatch(SESSION_READ_SQL, /\b(insert|update|delete|grant)\b/i);
});

test("on the live server a masked key is a fail, even when Resend sent mail this week", async () => {
  const db = healthyMap({ resendOk: 14 });
  const env = { ...MASKED_ENV, AWS_LAMBDA_FUNCTION_NAME: "api" };
  const row = byId(await gapChecks({ db, env }))["gap:auth-reset-mail"];
  shape(row);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /RESEND_API_KEY is not set to a real value on the live server/);
  assert.match(row.detail, /14 emails in 7 days/);
  assert.doesNotMatch(row.detail, /works/);
  assert.match(row.suggestedFix, /Netlify/);
});

test("on the live server an empty from address is a fail, whichever server name is set", async () => {
  for (const mark of [{ NETLIFY: "true" }, { LAMBDA_TASK_ROOT: "/var/task" }, { AWS_LAMBDA_FUNCTION_NAME: "api" }]) {
    const db = healthyMap({ resendOk: 9 });
    const env = { RESEND_API_KEY: GOOD_ENV.RESEND_API_KEY, RESEND_FROM: "", ...mark };
    const row = byId(await gapChecks({ db, env }))["gap:auth-reset-mail"];
    assert.equal(row.status, "FAIL", JSON.stringify(mark));
    assert.match(row.detail, /RESEND_FROM is not set to a real value on the live server/);
  }
});

test("on the live server a real key and from address pass", async () => {
  const db = healthyMap({ resendOk: 0 });
  const env = { ...GOOD_ENV, AWS_LAMBDA_FUNCTION_NAME: "api" };
  const row = byId(await gapChecks({ db, env }))["gap:auth-reset-mail"];
  assert.equal(row.status, "PASS");
});

test("the laptop skip never claims the live key works", async () => {
  const db = healthyMap({ resendOk: 14 });
  const row = byId(await gapChecks({ db, env: MASKED_ENV }))["gap:auth-reset-mail"];
  assert.equal(row.status, "skip");
  assert.match(row.detail, /not the live server/);
  assert.doesNotMatch(row.detail, /works/);
});

test("the sign-in storm line is five failures from two emails, not softer", () => {
  // Read through the constants the tests above use, so pin the numbers here.
  // A line moved to 500 or 200 would never fire and leave every other test green.
  assert.equal(LOGIN_FAIL_MIN, 5);
  assert.equal(LOGIN_FAIL_EMAILS, 2);
});

test("the time windows in the sql stay where the board says they are", () => {
  // The fake db never runs the sql, so the windows are pinned as text.
  // Staff login tries: the last 24 hours.
  assert.match(STAFF_LOGIN_SQL, /a\.created_at > now\(\) - interval '24 hours'/);
  // Sign-ins and spent links: the last 24 hours, minus a 3 minute grace.
  assert.equal((SIGNIN_NO_SESSION_SQL.match(/> now\(\) - interval '24 hours'/g) || []).length, 2);
  assert.match(SIGNIN_NO_SESSION_SQL, /a\.created_at < now\(\) - interval '3 minutes'/);
  assert.match(SIGNIN_NO_SESSION_SQL, /m\.consumed_at < now\(\) - interval '3 minutes'/);
  // The session has to land within a minute before to two minutes after the sign-in.
  assert.match(SIGNIN_NO_SESSION_SQL, /x\.created_at >= o\.created_at - interval '1 minute'/);
  assert.match(SIGNIN_NO_SESSION_SQL, /x\.created_at <= o\.created_at \+ interval '2 minutes'/);
  assert.match(SIGNIN_NO_SESSION_SQL, /x\.created_at >= l\.consumed_at - interval '1 minute'/);
  assert.match(SIGNIN_NO_SESSION_SQL, /x\.created_at <= l\.consumed_at \+ interval '2 minutes'/);
  // Short magic links: issued in 24 hours, 2 minute grace for the email to queue.
  assert.match(MAGIC_DEAD_SQL, /m\.created_at > now\(\) - interval '24 hours'/);
  assert.match(MAGIC_DEAD_SQL, /m\.created_at < now\(\) - interval '2 minutes'/);
  // Resets asked in 24 hours. Resend mail looked at over 7 days.
  assert.match(RESET_READ_SQL, /pr\.created_at > now\(\) - interval '24 hours'/);
  assert.match(RESET_READ_SQL, /g\.created_at > now\(\) - interval '7 days'/);
});
