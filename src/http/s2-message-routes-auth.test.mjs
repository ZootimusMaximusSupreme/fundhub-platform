// The portal sign-in link doors, run through the REAL api/ handlers with a
// stand-in database and no network. Each test judges the exact result the
// catalog row names: what the caller is told, and what was queued for the
// compliance gate.
//
//   route:auth/magic-link        client types an email, a 15 minute single-use link is queued
//   route:auth/send-portal-link  owner or admin queues a link and reads the URL back
//   (and magic-link-verify)      the link is spent once, then refused
//
// Password reset and the authorized representative are in
// s2-message-routes-reset-rep.test.mjs. Nothing here can send: a queued row is
// only a row, and fetch is refused.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import magicLink from "../../api/auth/magic-link.mjs";
import sendPortalLink from "../../api/auth/send-portal-link.mjs";
import magicLinkVerify from "../../api/auth/magic-link-verify.mjs";
import {
  accountSession, req, staffSession, ORG_ID, OTHER_ORG_ID,
} from "../testing/handler-harness.mjs";
import { call, refuseNetwork, splitRoles, CLIENT } from "../pulse/catalog/proofs/s2-route-kit.mjs";
import {
  EMAIL, OTHER_CLIENT, OWNER_ADMIN, QUEUE_REFUSES, clientByEmail, clientRow, hammered, inOrg, linkInsert,
  noAccount, noLimit, org, queued, template,
} from "../pulse/catalog/proofs/s2-auth-fixtures.mjs";

const netCalls = refuseNetwork({ before, after });
const LINK_ROW = "1c000000-0000-4000-8000-000000000001";

describe("POST /api/auth/magic-link", () => {
  test("a client's address queues one email with a 15 minute single-use link, and the caller is told only the uniform sentence", async () => {
    const { res, fake } = await call(
      magicLink,
      req("POST", { body: { email: `  ${EMAIL.toUpperCase()}  ` }, headers: { "x-forwarded-for": "203.0.113.9" } }),
      [org, noLimit, noAccount, clientByEmail, linkInsert, template, clientRow, queued]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.match(res.body.message, /If that email address has a Fundhub portal, a sign-in link is on its way/);
    assert.match(res.body.message, /expires in 15 minutes/);
    // Nothing that reveals the outcome or the credential reaches the caller.
    assert.deepEqual(Object.keys(res.body).sort(), ["message", "ok"]);

    const [link] = fake.find(/INSERT INTO account_magic_links/);
    // The values sit in the statement's columns in the order the test reads them.
    assert.match(link.sql, /\(org_id, email, account_id, client_id, token_hash, expires_at, outcome,[\s\S]*VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,'issued'/);
    const [, email, accountId, clientId, tokenHash, expiresAt] = link.params;
    assert.equal(email, EMAIL);
    assert.equal(accountId, null);
    assert.equal(clientId, CLIENT);
    assert.match(tokenHash, /^[0-9a-f]{64}$/);
    const minutes = (new Date(expiresAt).getTime() - Date.now()) / 60000;
    assert.ok(minutes > 14 && minutes <= 15, `link lifetime was ${minutes} minutes`);

    const [mail] = fake.find(/INSERT INTO messages/);
    const [, mailClient, channel, templateKey, body, , toAddress, subject] = mail.params;
    assert.equal(mailClient, CLIENT);
    assert.equal(channel, "email");
    assert.equal(templateKey, "EMAIL-PORTAL-MAGIC-LINK");
    assert.equal(toAddress, EMAIL);
    assert.equal(subject, "Your Fundhub sign-in link");
    assert.match(mail.sql, /'queued'/);
    // The mailed token is the one whose hash was stored, and it says 15 minutes.
    const token = /portal-login\.html\?t=([A-Za-z0-9_-]+)/.exec(body)?.[1];
    assert.ok(token, "the mailed body carries the sign-in link");
    assert.equal(crypto.createHash("sha256").update(token, "utf8").digest("hex"), tokenHash);
    assert.match(body, /good for 15 minutes/);
    assert.equal(netCalls.length, 0);
  });

  test("an address nobody has gets the SAME answer, a no_account row, and no email", async () => {
    const known = await call(
      magicLink, req("POST", { body: { email: EMAIL } }),
      [org, noLimit, noAccount, clientByEmail, linkInsert, template, clientRow, queued]
    );
    const unknown = await call(
      magicLink, req("POST", { body: { email: "nobody@example.test" } }),
      [org, noLimit, noAccount, [/FROM clients\s+WHERE org_id/, []], linkInsert]
    );
    assert.equal(unknown.res.statusCode, 200);
    assert.deepEqual(unknown.res.body, known.res.body);
    const [row] = unknown.fake.find(/INSERT INTO account_magic_links/);
    assert.match(row.sql, /outcome/);
    assert.equal(row.params[4], "no_account");
    assert.equal(unknown.fake.find(/INSERT INTO messages/).length, 0);
  });

  test("three requests for one address, or fifteen from one source, in 15 minutes are throttled; one fewer is not", async () => {
    const counted = (email_count, ip_count) => [/FROM account_magic_links m/, [{ email_count, ip_count }]];
    const cases = [
      [counted(2, 14), 200, "one under both limits"],
      [counted(3, 0), 429, "the address limit"],
      [counted(0, 15), 429, "the source limit"],
    ];
    for (const [counts, status, why] of cases) {
      const { res, fake } = await call(
        magicLink, req("POST", { body: { email: EMAIL }, headers: { "x-forwarded-for": "203.0.113.9" } }),
        [org, counts, noAccount, clientByEmail, linkInsert, template, clientRow, queued]
      );
      assert.equal(res.statusCode, status, why);
      // The count is asked for this company, this address, this source, over 15 minutes.
      assert.deepEqual(fake.find(/FROM account_magic_links m/)[0].params, [ORG_ID, EMAIL, "203.0.113.9", 15], why);
      if (status === 429) {
        assert.equal(res.body.error, "too_many_requests", why);
        assert.equal(res.headers["retry-after"], "900", why);
        assert.equal(fake.find(/INSERT INTO account_magic_links/).length, 0, why);
        assert.equal(fake.find(/INSERT INTO messages/).length, 0, why);
      } else {
        assert.equal(fake.find(/INSERT INTO messages/).length, 1, why);
      }
    }
  });

  test("a malformed address is 400 and a GET is 405, with no database work", async () => {
    const bad = await call(magicLink, req("POST", { body: { email: "hello" } }), [org]);
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "email_required");
    assert.equal(bad.fake.calls.length, 0);
    const get = await call(magicLink, req("GET"), [org]);
    assert.equal(get.res.statusCode, 405);
  });
});

describe("POST /api/auth/send-portal-link", () => {
  const clientInOrg = inOrg(/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, { "?column?": 1 });
  const clientEmail = [/SELECT email FROM clients WHERE id = \$1 AND org_id = \$2/, [{ email: EMAIL }]];
  const issuePath = [org, noLimit, noAccount, clientByEmail, linkInsert, template, clientRow, queued];
  const send = (rules, body = { client_id: CLIENT }) => call(sendPortalLink, req("POST", { body }), rules);

  test("an owner gets the URL back and one email is queued to the client's own address", async () => {
    const { res, fake } = await send([staffSession({ role: "owner" }), clientInOrg, clientEmail, ...issuePath]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.sent, true);
    assert.match(res.body.url, /\/portal-login\.html\?t=[A-Za-z0-9_-]+$/);
    assert.ok(new Date(res.body.expiresAt).getTime() > Date.now());
    const [mail] = fake.find(/INSERT INTO messages/);
    assert.equal(mail.params[2], "email");
    assert.equal(mail.params[3], "EMAIL-PORTAL-MAGIC-LINK");
    assert.equal(mail.params[6], EMAIL);
    // The URL read back is the link in the queued email.
    const token = new URL(res.body.url).searchParams.get("t");
    assert.ok(mail.params[4].includes(token));
  });

  test("when the queue refuses the email the answer is sent:false, the link is still shown, and nothing is queued", async () => {
    for (const [why, refuses] of Object.entries(QUEUE_REFUSES)) {
      const { res, fake } = await send([staffSession({ role: "owner" }), clientInOrg, clientEmail, refuses, ...issuePath]);
      assert.equal(res.statusCode, 200, why);
      assert.equal(res.body.ok, true, why);
      assert.equal(res.body.sent, false, why);
      assert.match(res.body.url, /\/portal-login\.html\?t=[A-Za-z0-9_-]+$/, why);
      assert.equal(fake.find(/INSERT INTO messages/).length, 0, why);
    }
  });

  test("only an owner or an admin may send; every other staff role is refused and nothing is issued", async () => {
    const { admitted, refused } = splitRoles(OWNER_ADMIN);
    assert.deepEqual([...admitted].sort(), [...OWNER_ADMIN].sort());
    for (const role of admitted) {
      const { res } = await send([staffSession({ role }), clientInOrg, clientEmail, ...issuePath]);
      assert.equal(res.statusCode, 200, role);
    }
    assert.equal(refused.length, 6);
    for (const role of refused) {
      const { res, fake } = await send([staffSession({ role }), clientInOrg, clientEmail, ...issuePath]);
      assert.equal(res.statusCode, 403, role);
      assert.equal(fake.find(/INSERT INTO account_magic_links/).length, 0, role);
      assert.equal(fake.find(/INSERT INTO messages/).length, 0, role);
    }
    const nobody = await send([clientInOrg, clientEmail, ...issuePath]);
    assert.equal(nobody.res.statusCode, 401);
    assert.equal(nobody.fake.find(/INSERT INTO account_magic_links/).length, 0);
  });

  test("a client that is not in the signed-in person's company is 404 and nothing is issued", async () => {
    // Same client id, signed in to a different company: the company parameter decides.
    const otherCompany = await send([staffSession({ role: "owner", org_id: OTHER_ORG_ID }), clientInOrg, clientEmail, ...issuePath]);
    assert.equal(otherCompany.res.statusCode, 404);
    assert.deepEqual(otherCompany.fake.find(/SELECT 1 FROM clients/)[0].params, [CLIENT, OTHER_ORG_ID]);
    // A client id nobody has, in the right company.
    const unknown = await send([staffSession({ role: "owner" }), clientInOrg, ...issuePath], { client_id: OTHER_CLIENT });
    assert.equal(unknown.res.statusCode, 404);
    for (const r of [otherCompany, unknown]) {
      assert.equal(r.fake.find(/INSERT INTO account_magic_links/).length, 0);
      assert.equal(r.fake.find(/INSERT INTO messages/).length, 0);
    }
  });

  test("no email on file is 409, a request made a moment ago is 429, a bad id is 400", async () => {
    const noEmail = await send([staffSession({ role: "admin" }), clientInOrg, [/SELECT email FROM clients/, [{ email: null }]], ...issuePath]);
    assert.equal(noEmail.res.statusCode, 409);
    assert.equal(noEmail.res.body.code, "no_email_on_file");
    assert.equal(noEmail.fake.find(/INSERT INTO messages/).length, 0);

    const limited = await send([staffSession({ role: "owner" }), clientInOrg, clientEmail, org, hammered, noAccount, clientByEmail, linkInsert]);
    assert.equal(limited.res.statusCode, 429);
    assert.equal(limited.res.body.code, "rate_limited");
    assert.equal(limited.fake.find(/INSERT INTO messages/).length, 0);

    const bad = await send([staffSession({ role: "owner" })], { client_id: "not-a-uuid" });
    assert.equal(bad.res.statusCode, 400);
  });
});

describe("POST /api/auth/magic-link-verify", () => {
  const ACCOUNT = "ac000000-0000-4000-8000-000000000001";
  const token = "fake-single-use-link-token-value-0001";
  const tokenHash = crypto.createHash("sha256").update(token, "utf8").digest("hex");

  // One link row. The claim statement spends it exactly once, like the database does.
  function linkTable({ expiresInMs = 10 * 60 * 1000 } = {}) {
    const row = { token_hash: tokenHash, consumed_at: null, expires_at: Date.now() + expiresInMs };
    return [/UPDATE account_magic_links\s+SET consumed_at = now\(\)/, (_s, p) => {
      if (p[0] !== row.token_hash || row.consumed_at || row.expires_at <= Date.now()) return [];
      row.consumed_at = Date.now();
      return [{ id: LINK_ROW, org_id: ORG_ID, email: EMAIL, account_id: ACCOUNT, client_id: CLIENT }];
    }];
  }
  const rules = (table) => [
    table,
    [/SELECT id FROM accounts\s+WHERE id = \$1 AND status = 'active'/, [{ id: ACCOUNT }]],
    [/INSERT INTO account_sessions/, [{ id: "5e000000-0000-4000-8000-000000000002", expires_at: new Date(Date.now() + 3600e3).toISOString() }]],
    ...accountSession({ kind: "client", clientId: CLIENT }),
  ];
  const verify = (rulesList, body = { token }) => call(magicLinkVerify, req("POST", { body }), rulesList);

  test("a fresh link signs the client in once: a session, the portal as next, and a cookie", async () => {
    const table = linkTable();
    const { res, fake } = await verify(rules(table));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.principal, "client");
    assert.equal(res.body.next, "/app/client-portal.html");
    assert.ok(res.body.token && res.body.token.length > 20);
    assert.match(res.headers["set-cookie"], /^fundhub_session=.+HttpOnly; Secure; SameSite=Lax/);
    // The claim was keyed on the hash, never the token itself.
    assert.equal(fake.find(/UPDATE account_magic_links/)[0].params[0], tokenHash);
  });

  test("the same link a second time, an expired link and a made-up link are all the same refusal", async () => {
    const table = linkTable();
    const first = await verify(rules(table));
    assert.equal(first.res.statusCode, 200);
    const again = await verify(rules(table));
    assert.equal(again.res.statusCode, 401);
    assert.equal(again.res.body.error, "invalid_link");
    assert.match(again.res.body.message, /expired or already been used/);
    assert.equal(again.res.body.token, undefined);

    const expired = await verify(rules(linkTable({ expiresInMs: -1000 })));
    assert.equal(expired.res.statusCode, 401);
    const unknown = await verify(rules(linkTable()), { token: "not-a-real-token" });
    assert.equal(unknown.res.statusCode, 401);
    assert.deepEqual(unknown.res.body, expired.res.body);
  });

  test("no token is 400 and a GET is 405, with no database work", async () => {
    const missing = await verify([org], {});
    assert.equal(missing.res.statusCode, 400);
    assert.equal(missing.fake.calls.length, 0);
    const get = await call(magicLinkVerify, req("GET"), [org]);
    assert.equal(get.res.statusCode, 405);
  });
});
