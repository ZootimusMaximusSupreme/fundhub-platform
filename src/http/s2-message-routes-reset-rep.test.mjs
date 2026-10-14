// Password reset and the authorized representative, run through the REAL api/
// handlers with a stand-in database. The mail provider's address is answered by
// a stub that only records the request; no mail is sent.
//
//   route:auth/reset             action=request mails a one hour reset link, always answers ok
//   route:auth/authorized-rep    owner or admin adds or replaces the person on a client's file
//
// The magic link and the portal link are in s2-message-routes-auth.test.mjs.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import reset from "../../api/auth/reset.mjs";
import authorizedRep from "../../api/auth/authorized-rep.mjs";
import {
  req, staffSession, accountSession, ORG_ID, OTHER_ORG_ID,
} from "../testing/handler-harness.mjs";
import { call, refuseNetwork, splitRoles, CLIENT } from "../pulse/catalog/proofs/s2-route-kit.mjs";
import {
  OTHER_CLIENT, OWNER_ADMIN, clientRow, inOrg, linkInsert, noLimit, org, queued, template,
} from "../pulse/catalog/proofs/s2-auth-fixtures.mjs";
import { hashToken } from "../auth/session.mjs";

refuseNetwork({ before, after });

describe("POST /api/auth/reset action=request", () => {
  const STAFF_LOGIN = "5a000000-0000-4000-8000-0000000000c1";
  const ACCOUNT_LOGIN = "ac000000-0000-4000-8000-0000000000c2";
  const asked = [];
  const keep = {};
  const FAKE_KEY = ["fake", "mail", "system", "value"].join("-");
  before(() => {
    for (const k of ["RESEND_API_KEY", "RESEND_FROM", "MESSAGING_DRY_RUN"]) keep[k] = process.env[k];
    process.env.RESEND_API_KEY = FAKE_KEY;
    process.env.RESEND_FROM = "Fundhub <noreply@fundhub.test>";
    process.env.MESSAGING_DRY_RUN = "off";
    // The mail provider's address is answered by a stub that only records the request.
    globalThis.fetch = async (url, init = {}) => {
      asked.push({ url: String(url), body: JSON.parse(init.body || "{}") });
      return new Response(JSON.stringify({ id: "mail-proof-0001" }), { status: 200, headers: { "content-type": "application/json" } });
    };
  });
  after(() => {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  beforeEach(() => { asked.length = 0; });

  const staffLogin = (status = "active") => [/FROM staff WHERE org_id = \$1 AND lower\(email\) = \$2/,
    (_s, p) => (p[0] === ORG_ID && p[1] === "casey@example.test" ? [{ id: STAFF_LOGIN, status }] : [])];
  const partnerLogin = (status = "active", kind = "partner") => [
    /FROM accounts\s+WHERE org_id = \$1 AND lower\(email\) = \$2\s+AND kind IN \('affiliate', 'partner'\)/,
    (_s, p) => (p[0] === ORG_ID && p[1] === "pat@example.test" && ["affiliate", "partner"].includes(kind) ? [{ id: ACCOUNT_LOGIN, status, kind }] : [])];
  const resetInsert = [/INSERT INTO password_resets/, [{ id: "9e000000-0000-4000-8000-000000000001" }]];
  const ask = (email, rules) => call(reset, req("POST", { body: { action: "request", email } }), [org, ...rules, resetInsert]);

  test("a live staff, partner or affiliate login is mailed a one hour link, the link is the stored token, and the reply never carries it", async () => {
    const cases = [
      ["casey@example.test", [staffLogin()], /INSERT INTO password_resets \(org_id, staff_id, token_hash/, STAFF_LOGIN],
      ["pat@example.test", [staffLogin(), partnerLogin("active", "partner")], /INSERT INTO password_resets \(org_id, staff_id, account_id/, ACCOUNT_LOGIN],
      ["pat@example.test", [staffLogin(), partnerLogin("active", "affiliate")], /INSERT INTO password_resets \(org_id, staff_id, account_id/, ACCOUNT_LOGIN],
    ];
    for (const [email, rules, insertShape, login] of cases) {
      asked.length = 0;
      const { res, fake } = await ask(email, rules);
      assert.equal(res.statusCode, 200, email);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.mailed, true, email);
      assert.match(res.body.message, /Check that inbox\. The reset link lasts 1 hour\./);

      assert.equal(asked.length, 1, email);
      assert.match(asked[0].url, /\/emails$/);
      assert.deepEqual(asked[0].body.to, [email]);
      assert.equal(asked[0].body.subject, "Reset your Fundhub password");
      const token = /reset-password\.html\?token=([A-Za-z0-9_-]+)/.exec(asked[0].body.text)?.[1];
      assert.ok(token, "the mail carries the reset link");
      assert.match(asked[0].body.text, /https:\/\/fundhub\.ai\/reset-password\.html\?token=/);
      assert.match(asked[0].body.text, /lasts 1 hour and works once/);
      // The mailed token is the one whose hash was stored, and never the reply.
      const [stored] = fake.find(insertShape);
      assert.deepEqual([stored.params[0], stored.params[1], stored.params[2]], [ORG_ID, login, hashToken(token)], email);
      assert.equal(JSON.stringify(res.body).includes(token), false);
    }
  });

  test("an unknown address, a suspended login and a client's own address get the same ok, and nothing is mailed", async () => {
    const unknown = await ask("nobody@example.test", [staffLogin(), partnerLogin()]);
    const suspendedStaff = await ask("casey@example.test", [staffLogin("suspended")]);
    const suspendedPartner = await ask("pat@example.test", [staffLogin(), partnerLogin("suspended")]);
    const clientKind = await ask("pat@example.test", [staffLogin(), partnerLogin("active", "client")]);
    for (const r of [unknown, suspendedStaff, suspendedPartner, clientKind]) {
      assert.equal(r.res.statusCode, 200);
      assert.deepEqual(r.res.body, unknown.res.body);
      assert.equal(r.fake.find(/INSERT INTO password_resets/).length, 0);
    }
    assert.equal(unknown.res.body.ok, true);
    assert.equal(unknown.res.body.mailed, false);
    assert.match(unknown.res.body.message, /Nothing was sent/);
    assert.equal(asked.length, 0);
  });

  test("an unknown action is 400 and a GET is 405", async () => {
    const unknown = await call(reset, req("POST", { body: { action: "explode" } }), []);
    assert.equal(unknown.res.statusCode, 400);
    assert.equal(unknown.res.body.error, "unknown_action");
    const get = await call(reset, req("GET"), []);
    assert.equal(get.res.statusCode, 405);
    assert.equal(asked.length, 0);
  });
});

describe("POST /api/auth/authorized-rep", () => {
  const REP_EMAIL = "pat.rep@example.test";
  const REP_ACCOUNT = "a0000000-0000-4000-8000-0000000000a1";
  const OLD_REP_ACCOUNT = "a0000000-0000-4000-8000-0000000000a2";
  const clientInOrg = inOrg(/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, { "?column?": 1 });
  const clientOnFile = inOrg(/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, { id: CLIENT });
  const emailNotAClient = [/SELECT id FROM clients WHERE org_id = \$1 AND lower\(email\)/, []];
  const noExistingLogin = [/SELECT id, kind FROM accounts WHERE org_id = \$1 AND lower\(email\)/, []];
  const newAccount = [/INSERT INTO accounts/, [{ id: REP_ACCOUNT }]];
  const noLiveRep = [/SELECT account_id FROM client_authorized_reps/, []];
  const liveRepIs = (accountId) => [/SELECT account_id FROM client_authorized_reps/, [{ account_id: accountId }]];
  const repAsAuthorizedRep = [/FROM accounts\s+WHERE org_id = \$1 AND lower\(email\) = \$2 LIMIT 1/, [{
    id: REP_ACCOUNT, kind: "authorized_rep", client_id: null, status: "active",
  }]];
  const repFile = [/SELECT client_id FROM client_authorized_reps/, [{ client_id: CLIENT }]];
  const liveRep = [/JOIN accounts a ON a\.id = r\.account_id/, [{
    account_id: REP_ACCOUNT, email: REP_EMAIL, phone: "+16025550142", name: "Pat Rep",
  }]];
  const body = { client_id: CLIENT, email: REP_EMAIL, name: "Pat Rep", phone: "(602) 555-0142" };
  const mailPath = [org, noLimit, repAsAuthorizedRep, repFile, linkInsert, template, clientRow, liveRep, queued];
  const add = (staff, extra, withBody = body) => call(authorizedRep, req("POST", { body: withBody }), [
    ...(staff ? [staff] : []), clientInOrg, clientOnFile, emailNotAClient, noExistingLogin, newAccount, ...extra, ...mailPath,
  ]);
  const wroteNothing = (fake) => fake.find(/INSERT INTO accounts|INSERT INTO client_authorized_reps|INSERT INTO messages/).length === 0;

  test("only an owner or an admin may add or replace; every other staff role is refused and nothing is written", async () => {
    const { admitted, refused } = splitRoles(OWNER_ADMIN);
    for (const role of admitted) {
      const { res } = await add(staffSession({ role }), [noLiveRep]);
      assert.equal(res.statusCode, 200, role);
    }
    for (const role of refused) {
      const { res, fake } = await add(staffSession({ role }), [noLiveRep]);
      assert.equal(res.statusCode, 403, role);
      assert.ok(wroteNothing(fake), role);
    }
    const nobody = await add(null, [noLiveRep]);
    assert.equal(nobody.res.statusCode, 401);
    assert.ok(wroteNothing(nobody.fake));
  });

  test("an owner adds a representative: a login is made, linked to the file, and the sign-in link is queued to the rep", async () => {
    const { res, fake } = await add(staffSession({ role: "owner" }), [noLiveRep]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.account_id, REP_ACCOUNT);
    assert.equal(res.body.replaced, false);
    assert.equal(res.body.sent, true);
    assert.match(res.body.url, /portal-login\.html\?t=/);

    const [account] = fake.find(/INSERT INTO accounts/);
    assert.match(account.sql, /\(org_id, kind, email, name, phone, password_hash, status,[\s\S]*VALUES \(\$1, 'authorized_rep', \$2, \$3, \$4, \$5, 'active', \$6/);
    assert.equal(account.params[1], REP_EMAIL);
    assert.equal(account.params[3], "+16025550142");
    const [link] = fake.find(/INSERT INTO client_authorized_reps/);
    assert.deepEqual(link.params.slice(0, 3), [ORG_ID, REP_ACCOUNT, CLIENT]);
    assert.equal(fake.find(/UPDATE client_authorized_reps SET removed_at/).length, 0);

    // The one email goes to the representative, not to the client's own address.
    const mail = fake.find(/INSERT INTO messages/);
    assert.equal(mail.length, 1);
    assert.equal(mail[0].params[2], "email");
    assert.equal(mail[0].params[3], "EMAIL-PORTAL-MAGIC-LINK");
    assert.equal(mail[0].params[6], REP_EMAIL);
    assert.equal(fake.count("COMMIT"), 1);
  });

  test("a new person replaces the one on the file: the old link is ended, their open file is cleared, and only the new person is mailed", async () => {
    const { res, fake } = await add(staffSession({ role: "admin" }), [liveRepIs(OLD_REP_ACCOUNT)]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.replaced, true);
    assert.equal(res.body.account_id, REP_ACCOUNT);
    const [ended] = fake.find(/UPDATE client_authorized_reps SET removed_at/);
    assert.deepEqual(ended.params, [CLIENT]);
    const [cleared] = fake.find(/UPDATE account_sessions SET active_client_id = NULL/);
    assert.deepEqual(cleared.params, [OLD_REP_ACCOUNT, CLIENT]);
    const [link] = fake.find(/INSERT INTO client_authorized_reps/);
    assert.deepEqual(link.params.slice(0, 3), [ORG_ID, REP_ACCOUNT, CLIENT]);
    const mail = fake.find(/INSERT INTO messages/);
    assert.deepEqual(mail.map((m) => m.params[6]), [REP_EMAIL]);
  });

  test("the same person added again is not a replacement: nothing is ended and no second link is made", async () => {
    const { res, fake } = await add(staffSession({ role: "owner" }), [liveRepIs(REP_ACCOUNT)]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.replaced, false);
    assert.equal(fake.find(/UPDATE client_authorized_reps SET removed_at/).length, 0);
    assert.equal(fake.find(/INSERT INTO client_authorized_reps/).length, 0);
  });

  test("a file in another company is 404 and nothing is written", async () => {
    const { res, fake } = await add(staffSession({ role: "owner", org_id: OTHER_ORG_ID }), [noLiveRep]);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(fake.find(/SELECT 1 FROM clients/)[0].params, [CLIENT, OTHER_ORG_ID]);
    assert.ok(wroteNothing(fake));
  });

  test("an address that is already a client, or a missing phone, is refused and nothing is linked", async () => {
    const isClient = await call(authorizedRep, req("POST", { body }), [
      staffSession({ role: "admin" }), clientInOrg, clientOnFile,
      [/SELECT id FROM clients WHERE org_id = \$1 AND lower\(email\)/, [{ id: OTHER_CLIENT }]],
    ]);
    assert.equal(isClient.res.statusCode, 409);
    assert.equal(isClient.res.body.code, "email_is_a_client");
    assert.equal(isClient.fake.find(/INSERT INTO/).length, 0);

    const noPhone = await call(authorizedRep, req("POST", { body: { ...body, phone: "" } }), [
      staffSession({ role: "owner" }), clientInOrg,
    ]);
    assert.equal(noPhone.res.statusCode, 400);
    assert.equal(noPhone.res.body.code, "phone_required");
    assert.equal(noPhone.fake.find(/INSERT INTO/).length, 0);
  });
});
