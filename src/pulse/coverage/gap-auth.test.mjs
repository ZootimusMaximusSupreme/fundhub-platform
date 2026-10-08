import test from "node:test";
import assert from "node:assert/strict";

import {
  gapChecks,
  READ_ONLY_SQL,
  LOGIN_FAIL_MIN,
  LOGIN_FAIL_EMAILS,
  SESSION_PROBE_HASH,
  STAFF_LOGIN_SQL,
  MAGIC_TEMPLATE_SQL,
  MAGIC_DEAD_SQL,
  SESSION_READ_SQL,
  RESET_QUEUE_SQL
} from "./gap-auth.mjs";

const IDS = [
  "gap:auth-staff-login",
  "gap:auth-magic-link-dead",
  "gap:auth-session-read",
  "gap:auth-reset-queue"
];

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
    ["gap:auth-session-read", [{ staff_hits: 0, account_hits: 0, ...over.session }]],
    ["gap:auth-reset-queue", [{ asked: over.asked ?? 0, queued: over.queued ?? 0 }]]
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
  assert.equal(READ_ONLY_SQL.length, 5);
  for (const sql of READ_ONLY_SQL) {
    const body = sql.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    assert.match(body, /^SELECT\b/i);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate)\b/i);
  }
  assert.match(STAFF_LOGIN_SQL, /auth_attempts/);
  assert.match(MAGIC_TEMPLATE_SQL, /EMAIL-PORTAL-MAGIC-LINK/);
  assert.match(MAGIC_DEAD_SQL, /account_magic_links/);
  assert.match(MAGIC_DEAD_SQL, /20 minutes/);
  assert.match(SESSION_READ_SQL, /account_sessions/);
  assert.match(RESET_QUEUE_SQL, /password_resets/);
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
  const rows = await gapChecks({ db });
  assert.deepEqual(rows.map((row) => row.id), IDS);
  for (const row of rows) {
    shape(row);
    assert.equal(row.status, "PASS", row.id);
  }
  const sessionCall = db.calls.find((c) => c.sql.includes("gap:auth-session-read"));
  assert.deepEqual(sessionCall.params, [SESSION_PROBE_HASH]);
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
    ["gap:auth-reset-queue", [{ asked: 0, queued: 0 }]]
  ]);
  const row = byId(await gapChecks({ db }))["gap:auth-session-read"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /permission denied/);
  assert.match(row.suggestedFix, /logout/);
});

test("a password reset with no queued email fails", async () => {
  const db = healthyMap({ asked: 2, queued: 0 });
  const row = byId(await gapChecks({ db }))["gap:auth-reset-queue"];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /2 password resets/);
});

test("a password reset that queued an email passes", async () => {
  const db = healthyMap({ asked: 1, queued: 1 });
  const row = byId(await gapChecks({ db }))["gap:auth-reset-queue"];
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /1 password reset in 24 hours had an email queued/);
});

test("no reset asked for is a pass", async () => {
  const db = healthyMap({ asked: 0, queued: 0 });
  const row = byId(await gapChecks({ db }))["gap:auth-reset-queue"];
  assert.equal(row.status, "PASS");
});
