// The sign-in mail doors, run through the REAL api/ handlers with a stand-in
// database and no network. Each test judges the exact result the catalog row
// names: what the caller is told, and what was queued for the compliance gate.
//
//   route:auth/magic-link        client types an email, a 15 minute single-use link is queued
//   route:auth/send-portal-link  owner or admin queues a link and reads the URL back
//   route:auth/reset             action=request mails a reset link, always answers ok
//   route:auth/authorized-rep    owner or admin adds or replaces a representative
//
// Nothing here can send: a queued row is only a row, and fetch is refused.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import magicLink from "../../api/auth/magic-link.mjs";
import sendPortalLink from "../../api/auth/send-portal-link.mjs";
import reset from "../../api/auth/reset.mjs";
import authorizedRep from "../../api/auth/authorized-rep.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID,
} from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c9000000-0000-4000-8000-000000000009";
const LINK_ROW = "1c000000-0000-4000-8000-000000000001";
const MSG_ROW = "ee000000-0000-4000-8000-000000000001";
const EMAIL = "dana.whitfield@example.test";

const realFetch = globalThis.fetch;
const netCalls = [];
before(() => {
  globalThis.fetch = async (url) => { netCalls.push(String(url)); throw new Error("network refused in this test"); };
});
after(() => { globalThis.fetch = realFetch; });

async function call(handler, request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

const org = [/FROM orgs WHERE slug/, [{ id: ORG_ID }]];
const noLimit = [/FROM account_magic_links m/, [{ email_count: 0, ip_count: 0 }]];
const hammered = [/FROM account_magic_links m/, [{ email_count: 3, ip_count: 0 }]];
const noAccount = [/FROM accounts\s+WHERE org_id = \$1 AND lower\(email\)/, []];
const clientByEmail = [/FROM clients\s+WHERE org_id = \$1 AND lower\(email\)/, [{ id: CLIENT }]];
const linkInsert = [/INSERT INTO account_magic_links/, [{ id: LINK_ROW }]];
const template = [/FROM message_templates/, [{
  body: "Hi {{contact.first_name}}, sign in here: {{magic_link.url}} (good for {{magic_link.expires_minutes}} minutes)",
  subject: "Your Fundhub sign-in link",
  compliance_passed: true,
}]];
const clientRow = [/FROM clients WHERE id = \$1 LIMIT 1/, [{
  first_name: "Dana", last_name: "Whitfield", email: EMAIL, phone: "+16025550100", custom_fields: {},
}]];
const queued = [/INSERT INTO messages/, [{ id: MSG_ROW, created_at: "2026-10-13T17:00:00Z" }]];

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

  test("a throttled address gets 429 with Retry-After and nothing is written", async () => {
    const { res, fake } = await call(
      magicLink, req("POST", { body: { email: EMAIL } }), [org, hammered, noAccount, clientByEmail, linkInsert]
    );
    assert.equal(res.statusCode, 429);
    assert.equal(res.body.error, "too_many_requests");
    assert.equal(res.headers["retry-after"], "900");
    assert.equal(fake.find(/INSERT INTO account_magic_links/).length, 0);
    assert.equal(fake.find(/INSERT INTO messages/).length, 0);
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
  const clientInOrg = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, (_s, p) => (p[0] === CLIENT ? [{ "?column?": 1 }] : [])];
  const clientEmail = [/SELECT email FROM clients WHERE id = \$1 AND org_id = \$2/, [{ email: EMAIL }]];
  const issuePath = [org, noLimit, noAccount, clientByEmail, linkInsert, template, clientRow, queued];

  test("an owner gets the URL back and one email is queued to the client's own address", async () => {
    const { res, fake } = await call(
      sendPortalLink, req("POST", { body: { client_id: CLIENT } }),
      [staffSession({ role: "owner" }), clientInOrg, clientEmail, ...issuePath]
    );
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

  test("a closer is refused and nothing is issued", async () => {
    const { res, fake } = await call(
      sendPortalLink, req("POST", { body: { client_id: CLIENT } }),
      [staffSession({ role: "closer" }), clientInOrg, clientEmail, ...issuePath]
    );
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/INSERT INTO account_magic_links/).length, 0);
  });

  test("another company's client is 404, no address is 409, a fresh request is 429", async () => {
    const other = await call(
      sendPortalLink, req("POST", { body: { client_id: OTHER_CLIENT } }),
      [staffSession({ role: "owner" }), clientInOrg, ...issuePath]
    );
    assert.equal(other.res.statusCode, 404);

    const noEmail = await call(
      sendPortalLink, req("POST", { body: { client_id: CLIENT } }),
      [staffSession({ role: "admin" }), clientInOrg, [/SELECT email FROM clients/, [{ email: null }]], ...issuePath]
    );
    assert.equal(noEmail.res.statusCode, 409);
    assert.equal(noEmail.res.body.code, "no_email_on_file");

    const limited = await call(
      sendPortalLink, req("POST", { body: { client_id: CLIENT } }),
      [staffSession({ role: "owner" }), clientInOrg, clientEmail, org, hammered, noAccount, clientByEmail, linkInsert]
    );
    assert.equal(limited.res.statusCode, 429);
    assert.equal(limited.res.body.code, "rate_limited");
    assert.equal(limited.fake.find(/INSERT INTO messages/).length, 0);

    const bad = await call(
      sendPortalLink, req("POST", { body: { client_id: "not-a-uuid" } }), [staffSession({ role: "owner" })]
    );
    assert.equal(bad.res.statusCode, 400);
  });
});

describe("POST /api/auth/reset action=request", () => {
  test("a live staff address is asked for a reset and the reply is ok either way", async () => {
    const live = await call(
      reset, req("POST", { body: { action: "request", email: "casey@example.test" } }),
      [
        [/FROM staff/, [{ id: "5a000000-0000-4000-8000-000000000001", email: "casey@example.test", status: "active" }]],
        [/INSERT INTO password_resets/, [{ id: "9e000000-0000-4000-8000-000000000001" }]],
      ]
    );
    const nobody = await call(
      reset, req("POST", { body: { action: "request", email: "nobody@example.test" } }), []
    );
    assert.equal(live.res.statusCode, 200);
    assert.equal(nobody.res.statusCode, 200);
    assert.equal(live.res.body.ok, true);
    assert.equal(nobody.res.body.ok, true);
    // No reset mail provider is configured here, so neither is "mailed", and
    // neither reply names whether the address matched a login.
    assert.equal(nobody.res.body.mailed, false);
    assert.match(nobody.res.body.message, /Nothing was sent/);
    assert.equal(Object.hasOwn(live.res.body, "token"), false);
  });

  test("an unknown action is 400 and a GET is 405", async () => {
    const unknown = await call(reset, req("POST", { body: { action: "explode" } }), []);
    assert.equal(unknown.res.statusCode, 400);
    assert.equal(unknown.res.body.error, "unknown_action");
    const get = await call(reset, req("GET"), []);
    assert.equal(get.res.statusCode, 405);
  });
});

describe("POST /api/auth/authorized-rep", () => {
  const REP_EMAIL = "pat.rep@example.test";
  const REP_ACCOUNT = "a0000000-0000-4000-8000-0000000000a1";
  const clientInOrg = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, (_s, p) => (p[0] === CLIENT ? [{ "?column?": 1 }] : [])];
  const clientOnFile = [/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, [{ id: CLIENT }]];
  const emailNotAClient = [/SELECT id FROM clients WHERE org_id = \$1 AND lower\(email\)/, []];
  const noExistingLogin = [/SELECT id, kind FROM accounts WHERE org_id = \$1 AND lower\(email\)/, []];
  const newAccount = [/INSERT INTO accounts/, [{ id: REP_ACCOUNT }]];
  const noLiveRep = [/SELECT account_id FROM client_authorized_reps/, []];
  const repAsAuthorizedRep = [/FROM accounts\s+WHERE org_id = \$1 AND lower\(email\) = \$2 LIMIT 1/, [{
    id: REP_ACCOUNT, kind: "authorized_rep", client_id: null, status: "active",
  }]];
  const repFile = [/SELECT client_id FROM client_authorized_reps/, [{ client_id: CLIENT }]];
  const liveRep = [/JOIN accounts a ON a\.id = r\.account_id/, [{
    account_id: REP_ACCOUNT, email: REP_EMAIL, phone: "+16025550142", name: "Pat Rep",
  }]];
  const body = { client_id: CLIENT, email: REP_EMAIL, name: "Pat Rep", phone: "(602) 555-0142" };

  test("a closer is refused; the route is owner and admin only", async () => {
    const { res, fake } = await call(authorizedRep, req("POST", { body }), [staffSession({ role: "closer" })]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/INSERT INTO accounts|INSERT INTO client_authorized_reps/).length, 0);
  });

  test("an owner adds a representative: a login is made, linked to the file, and the sign-in link is queued to the rep", async () => {
    const { res, fake } = await call(authorizedRep, req("POST", { body }), [
      staffSession({ role: "owner" }), clientInOrg, clientOnFile, emailNotAClient, noExistingLogin,
      newAccount, noLiveRep, org, noLimit, repAsAuthorizedRep, repFile, linkInsert, template, clientRow,
      liveRep, queued,
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.account_id, REP_ACCOUNT);
    assert.equal(res.body.replaced, false);
    assert.equal(res.body.sent, true);
    assert.match(res.body.url, /portal-login\.html\?t=/);

    const [account] = fake.find(/INSERT INTO accounts/);
    assert.match(account.sql, /'authorized_rep'/);
    assert.equal(account.params[1], REP_EMAIL);
    assert.equal(account.params[3], "+16025550142");
    const [link] = fake.find(/INSERT INTO client_authorized_reps/);
    assert.deepEqual(link.params.slice(0, 3), [ORG_ID, REP_ACCOUNT, CLIENT]);

    // The one email goes to the representative, not to the client's own address.
    const mail = fake.find(/INSERT INTO messages/);
    assert.equal(mail.length, 1);
    assert.equal(mail[0].params[2], "email");
    assert.equal(mail[0].params[3], "EMAIL-PORTAL-MAGIC-LINK");
    assert.equal(mail[0].params[6], REP_EMAIL);
    assert.equal(fake.count("COMMIT"), 1);
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
