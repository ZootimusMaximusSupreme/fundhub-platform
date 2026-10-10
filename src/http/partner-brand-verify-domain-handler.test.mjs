// POST /api/partner-brand/verify-domain — the real handler, no Postgres, no DNS.
//
// Brand Studio's Verify button marks a partner's own web address as verified,
// which is what lets their public pages answer on it. No test ever ran the
// door. This runs it with the database and the DNS lookup both stood in for:
// a TXT record that carries the token verifies; anything else does not, and
// says exactly what record to add.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

import handler from "../../api/partner-brand/verify-domain.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { siteVerifyToken } from "../brand/domain-verify.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID
} from "../testing/handler-harness.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";

/* Stand in for node:dns/promises resolveTxt (the handler imports it lazily),
   so no test ever puts a DNS question on the wire. */
let txtAnswer = async () => [];
const lookups = [];
const realResolveTxt = dns.promises.resolveTxt;
before(() => {
  dns.promises.resolveTxt = async (host) => { lookups.push(host); return txtAnswer(host); };
  syncBuiltinESMExports();
});
after(() => {
  dns.promises.resolveTxt = realResolveTxt;
  syncBuiltinESMExports();
});

const brandRow = (over = {}) => [/FROM partner_brand b/, (_s, p) => (p[1] === ORG_ID ? [{
  partner_id: PARTNER, domain: "funding.example.com", domain_verified: false, org_id: ORG_ID, ...over
}] : [])];

async function call(request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

describe("POST /api/partner-brand/verify-domain", () => {
  test("is routed", () => {
    assert.equal(ROUTES["partner-brand/verify-domain"], handler);
  });

  test("GET is refused", async () => {
    const { res } = await call(req("GET"), [staffSession()]);
    assert.equal(res.statusCode, 405);
  });

  test("no session: 401, no lookup, nothing written", async () => {
    lookups.length = 0;
    const { res, fake } = await call(req("POST", { body: { partner_id: PARTNER } }), []);
    assert.equal(res.statusCode, 401);
    assert.equal(lookups.length, 0);
    assert.equal(fake.find(/UPDATE partner_brand/).length, 0);
  });

  test("a funding advisor cannot verify (owner and admin only)", async () => {
    const { res, fake } = await call(req("POST", { body: { partner_id: PARTNER } }), [staffSession({ role: "funding_advisor" })]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/partner_brand/).length, 0);
  });

  test("a partner from another company reads as brand_not_found, no lookup", async () => {
    lookups.length = 0;
    const { res } = await call(
      req("POST", { body: { partner_id: PARTNER } }),
      [staffSession({ org_id: "0c000000-0000-4000-8000-000000000003" }), brandRow()]
    );
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "brand_not_found");
    assert.equal(lookups.length, 0);
  });

  test("no domain saved yet: 400 domain_required", async () => {
    const { res } = await call(req("POST", { body: { partner_id: PARTNER } }), [staffSession(), brandRow({ domain: null })]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "domain_required");
  });

  test("the TXT record carries the token: verified, and only then is the flag set", async () => {
    lookups.length = 0;
    txtAnswer = async () => [["some-other=1"], [siteVerifyToken(PARTNER)]];
    const { res, fake } = await call(req("POST", { body: { partner_id: PARTNER } }), [staffSession(), brandRow()]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.verified, true);
    assert.equal(res.body.live_base, "https://funding.example.com");
    assert.deepEqual(lookups, ["_fundhub.funding.example.com"]);
    const upd = fake.find(/UPDATE partner_brand SET domain_verified = true/);
    assert.equal(upd.length, 1);
    assert.deepEqual(upd[0].params, [PARTNER]);
  });

  test("the TXT record is missing the token: not verified, the flag is NOT set, and the answer says what to add", async () => {
    txtAnswer = async () => [["fundhub-site-verify=someone-else"]];
    const { res, fake } = await call(req("POST", { body: { partner_id: PARTNER } }), [staffSession(), brandRow()]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.verified, false);
    assert.equal(res.body.expected, siteVerifyToken(PARTNER));
    assert.match(res.body.message, /_fundhub\.funding\.example\.com/);
    assert.equal(fake.find(/UPDATE partner_brand/).length, 0);
  });

  test("the DNS lookup fails: not verified, the flag is NOT set", async () => {
    txtAnswer = async () => { const e = new Error("queryTxt ENOTFOUND"); e.code = "ENOTFOUND"; throw e; };
    const { res, fake } = await call(req("POST", { body: { partner_id: PARTNER } }), [staffSession(), brandRow()]);
    assert.equal(res.body.verified, false);
    assert.equal(res.body.error, "ENOTFOUND");
    assert.equal(fake.find(/UPDATE partner_brand/).length, 0);
  });
});
