// Slice S3 proofs: the sign-in and authorized-representative doors, run as the
// real api/ handlers with a stand-in database (no Postgres, no mail).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import repHandler from "../../api/auth/authorized-rep.mjs";
import repFileHandler from "../../api/auth/authorized-rep-file.mjs";
import verifyHandler, { PORTAL_PATH } from "../../api/auth/magic-link-verify.mjs";
import resetHandler from "../../api/auth/reset.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { tableRules, clientsRule } from "../testing/s3-scoped-rows.mjs";
import { req, staffSession, accountSession, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const REP_ACCOUNT = "ac000000-0000-4000-8000-000000000001";

describe("POST /api/auth/authorized-rep remove:true", () => {
  const rules = (over = {}) => [
    staffSession(),
    [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, over.client ?? [{ "?column?": 1 }]],
    [/UPDATE client_authorized_reps SET removed_at = now\(\)/, over.removed ?? [{ account_id: REP_ACCOUNT }]],
    [/SELECT client_id FROM client_authorized_reps/, over.next ?? [{ client_id: OTHER_CLIENT }]]
  ];

  test("stamps the link removed for this company and file, then moves the rep's sessions off it", async () => {
    const { res, fake } = await callShared(repHandler, req("POST", { body: { client_id: CLIENT, remove: true } }), rules());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, removed: true });
    const [stamp] = fake.find(/UPDATE client_authorized_reps SET removed_at/);
    assert.deepEqual(stamp.params, [ORG_ID, CLIENT]);
    assert.match(stamp.sql, /WHERE org_id = \$1 AND client_id = \$2 AND removed_at IS NULL/);
    const [sessions] = fake.find(/UPDATE account_sessions/);
    assert.deepEqual(sessions.params, [REP_ACCOUNT, OTHER_CLIENT, CLIENT]);
    assert.match(sessions.sql, /active_client_id = \$3/);
    assert.equal(fake.count("BEGIN"), 1);
    assert.equal(fake.count("COMMIT"), 1);
  });

  // One rep linked to two files, a second rep on the first file's twin in another company,
  // and one session each. The stand-in answers by the company, client and account the SQL
  // names, so a removal that lost a condition would take the wrong link or session.
  test("removal retires only this file's link and moves only this rep's sessions that sat on it", async () => {
    const OTHER_REP = "ac000000-0000-4000-8000-000000000002";
    const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
    const link = (over) => ({ org_id: ORG_ID, account_id: REP_ACCOUNT, client_id: CLIENT, removed_at: null, created_at: "2026-10-01", ...over });
    const links = [
      link({}),
      link({ client_id: OTHER_CLIENT, created_at: "2026-10-02" }),
      link({ org_id: OTHER_ORG, account_id: OTHER_REP, client_id: "c3000000-0000-4000-8000-000000000003" }),
      link({ account_id: OTHER_REP, client_id: OTHER_CLIENT })
    ];
    const sessions = [
      { id: "s1", account_id: REP_ACCOUNT, active_client_id: CLIENT, revoked_at: null },
      { id: "s2", account_id: REP_ACCOUNT, active_client_id: OTHER_CLIENT, revoked_at: null },
      { id: "s3", account_id: OTHER_REP, active_client_id: CLIENT, revoked_at: null }
    ];
    const { res } = await callShared(repHandler, req("POST", { body: { client_id: CLIENT, remove: true } }), [
      staffSession(),
      clientsRule([{ id: CLIENT, org_id: ORG_ID }]),
      ...tableRules("client_authorized_reps", links, { set: (row) => { row.removed_at = "2026-10-13"; } }),
      ...tableRules("account_sessions", sessions, { set: (row, params) => { row.active_client_id = params[1]; } })
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(links.map((l) => l.removed_at !== null), [true, false, false, false]);
    assert.deepEqual(sessions.map((x) => x.active_client_id), [OTHER_CLIENT, OTHER_CLIENT, CLIENT]);
  });

  test("a rep with no other file has the session's active file cleared", async () => {
    const { res, fake } = await callShared(repHandler, req("POST", { body: { client_id: CLIENT, remove: true } }), rules({ next: [] }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(fake.find(/UPDATE account_sessions/)[0].params, [REP_ACCOUNT, null, CLIENT]);
  });

  test("a file nobody is linked to answers 404 no_rep and moves no session", async () => {
    const { res, fake } = await callShared(repHandler, req("POST", { body: { client_id: CLIENT, remove: true } }), rules({ removed: [] }));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "no_rep");
    assert.equal(fake.find(/UPDATE account_sessions/).length, 0);
  });

  test("a file from another company is a 404 and nothing is written", async () => {
    const { res, fake } = await callShared(repHandler, req("POST", { body: { client_id: CLIENT, remove: true } }), rules({ client: [] }));
    assert.equal(res.statusCode, 404);
    assert.equal(fake.find(/UPDATE client_authorized_reps/).length, 0);
  });

  test("only owner or admin may remove", async () => {
    const { res, fake } = await callShared(repHandler, req("POST", { body: { client_id: CLIENT, remove: true } }), [staffSession({ role: "closer" })]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/client_authorized_reps/).length, 0);
  });
});

describe("/api/auth/authorized-rep-file", () => {
  const principalRules = (extra = []) => [
    ...extra,
    ...accountSession({ kind: "authorized_rep" }),
    [/SELECT client_id FROM client_authorized_reps/, [{ client_id: CLIENT }]],
    [/SELECT 1 FROM client_authorized_reps/, []]
  ];
  const switchSql = /UPDATE account_sessions\s+SET active_client_id = \$2\s+WHERE account_id = \$1/;

  test("GET lists only the files this login is linked to, with the active one named", async () => {
    const { res, fake } = await callShared(repFileHandler, req("GET"), principalRules([
      [/FROM client_authorized_reps r\s+JOIN clients c/, [
        { client_id: CLIENT, first_name: "Dana", last_name: "Whitfield" },
        { client_id: OTHER_CLIENT, first_name: "Evan", last_name: null }
      ]]
    ]));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      ok: true,
      active_client_id: CLIENT,
      files: [
        { client_id: CLIENT, name: "Dana Whitfield" },
        { client_id: OTHER_CLIENT, name: "Evan" }
      ]
    });
    const list = fake.find(/FROM client_authorized_reps r\s+JOIN clients c/)[0];
    assert.deepEqual(list.params, ["ac000000-0000-4000-8000-000000000001"]);
    assert.match(list.sql, /removed_at IS NULL/);
  });

  test("POST switches the active file only when staff linked it", async () => {
    const { res, fake } = await callShared(repFileHandler, req("POST", { body: { client_id: OTHER_CLIENT } }), principalRules([
      [(sql, params) => /SELECT 1 FROM client_authorized_reps/.test(sql) && params[1] === OTHER_CLIENT, [{ "?column?": 1 }]]
    ]));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, client_id: OTHER_CLIENT });
    const [switched] = fake.find(switchSql);
    assert.deepEqual(switched.params, ["ac000000-0000-4000-8000-000000000001", OTHER_CLIENT]);
  });

  test("POST of a file nobody linked is refused and the session is not touched", async () => {
    const { res, fake } = await callShared(repFileHandler, req("POST", { body: { client_id: OTHER_CLIENT } }), principalRules());
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "That file is not one of yours.");
    assert.equal(fake.find(switchSql).length, 0);
  });

  test("a plain client login is refused", async () => {
    const { res } = await callShared(repFileHandler, req("GET"), accountSession({ kind: "client", clientId: CLIENT }));
    assert.equal(res.statusCode, 403);
  });
});

describe("POST /api/auth/magic-link-verify", () => {
  const link = { id: "l1", org_id: ORG_ID, email: "dana@example.test", account_id: REP_ACCOUNT, client_id: CLIENT };
  const rules = (claim) => [
    [/UPDATE account_magic_links/, claim],
    [/SELECT id FROM accounts\s+WHERE id = \$1 AND status = 'active'/, [{ id: REP_ACCOUNT }]],
    [/INSERT INTO account_sessions/, [{ id: "s1", expires_at: new Date(Date.now() + 3600e3).toISOString() }]],
    ...accountSession({ kind: "client", clientId: CLIENT })
  ];

  test("a good link is spent, a session is minted, the cookie is set and the portal is the next page", async () => {
    const { res, fake } = await callShared(
      verifyHandler,
      { method: "POST", body: { token: "emailed-token" }, headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1", "user-agent": "TestBrowser" } },
      rules([link])
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.principal, "client");
    assert.equal(res.body.next, PORTAL_PATH);
    assert.equal(typeof res.body.token, "string");
    assert.match(res.headers["set-cookie"], /^fundhub_session=.+; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
    const [claim] = fake.find(/UPDATE account_magic_links/);
    assert.match(claim.sql, /consumed_at IS NULL\s+AND expires_at > now\(\)/);
    assert.equal(claim.params[1], "203.0.113.9");
    assert.equal(claim.params[2], "TestBrowser");
    assert.equal(fake.find(/INSERT INTO account_sessions/).length, 1);
    assert.equal(fake.find(/UPDATE accounts SET last_login_at/).length, 1);
  });

  test("a spent or expired link is one flat 401 and mints no session", async () => {
    const { res, fake } = await callShared(verifyHandler, { method: "POST", body: { token: "used" }, headers: {} }, rules([]));
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "invalid_link");
    assert.match(res.body.message, /expired or already been used/);
    assert.equal(res.headers["set-cookie"], undefined);
    assert.equal(fake.find(/INSERT INTO account_sessions/).length, 0);
  });

  test("a GET never spends the link", async () => {
    const { res, fake } = await callShared(verifyHandler, { method: "GET", query: { token: "t" }, headers: {} }, rules([link]));
    assert.equal(res.statusCode, 405);
    assert.equal(fake.find(/account_magic_links/).length, 0);
  });
});

describe("POST /api/auth/reset action=confirm", () => {
  const resetRules = (consumed) => [
    [/UPDATE password_resets/, consumed],
    [/UPDATE staff\s+SET password_hash/, [{ id: STAFF_ID, org_id: ORG_ID, email: "owner@example.test", name: "Olive", role: "owner", status: "active" }]],
    [/UPDATE sessions SET revoked_at/, [{ id: "s1" }, { id: "s2" }]]
  ];
  const body = { action: "confirm", token: "reset-token-from-mail", password: "A-long-new-pass-9!" };

  test("spends the token, saves a hash (never the typed password) and signs every session out", async () => {
    const { res, fake } = await callShared(resetHandler, { method: "POST", body, headers: {} }, resetRules([
      { staff_id: STAFF_ID, account_id: null, org_id: ORG_ID, kind: "reset" }
    ]));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    const [save] = fake.find(/UPDATE staff\s+SET password_hash/);
    assert.equal(save.params[0], STAFF_ID);
    assert.notEqual(save.params[1], body.password);
    assert.ok(String(save.params[1]).length > 30, "a hash was stored");
    const [revoke] = fake.find(/UPDATE sessions SET revoked_at/);
    assert.equal(revoke.params[0], STAFF_ID);
  });

  test("a spent or expired token changes no password", async () => {
    const { res, fake } = await callShared(resetHandler, { method: "POST", body, headers: {} }, resetRules([]));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "invalid_or_expired_token");
    assert.equal(fake.find(/UPDATE staff/).length, 0);
    assert.equal(fake.find(/UPDATE sessions/).length, 0);
  });

  test("a weak password is refused before the token is touched", async () => {
    const { res, fake } = await callShared(resetHandler, { method: "POST", body: { ...body, password: "short" }, headers: {} }, resetRules([
      { staff_id: STAFF_ID, account_id: null, org_id: ORG_ID, kind: "reset" }
    ]));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "weak_password");
    assert.equal(fake.find(/UPDATE password_resets/).length, 0);
  });
});
