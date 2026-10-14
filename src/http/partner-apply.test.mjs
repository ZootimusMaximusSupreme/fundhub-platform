// /api/public/partner-apply — website form validation (no live Postgres).
//
// The white-label half of this endpoint used to make a stranger a live partner
// on submit, and refused anybody who already had a login. Both are covered
// below — see "an application is pending, not live" and "an existing customer
// may apply".

import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  parsePartnerApplyBody,
  slugFromName,
  generateFirstPassword,
  runPartnerApply,
  approvePartnerApplication,
  placeWhiteLabelRailCard
} from "../../api/public/partner-apply.mjs";
import { assertBind, assertSqlHas } from "../testing/s3-scoped-rows.mjs";
import { queueAffiliateTemplate } from "../affiliates/drip.mjs";

function mockRes() {
  const out = { statusCode: 200, headers: {}, body: null };
  return {
    out,
    setHeader(k, v) { out.headers[k] = v; },
    status(code) { out.statusCode = code; return this; },
    json(body) { out.body = body; return this; }
  };
}

/* A recording fake client. `routes` is a list of [pattern, rows]; the first
   pattern that matches the statement wins, and anything unmatched returns no
   rows, which is what "nothing on file" looks like to this handler. */
function fakeClient(routes = []) {
  const calls = [];
  return {
    calls,
    sawSql(pattern) { return calls.some((c) => pattern.test(c.sql)); },
    find(pattern) { return calls.find((c) => pattern.test(c.sql)) || null; },
    query: async (sql, params) => {
      assertBind(sql, params);
      calls.push({ sql, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
      for (const [pattern, rows] of routes) {
        if (pattern.test(sql)) return { rows: typeof rows === "function" ? rows(params) : rows };
      }
      return { rows: [] };
    },
    release() {}
  };
}

const RAIL_ROUTES = [
  [/affiliates_white_label/i, [{ stage_id: "st-x", pipeline_id: "pipe-r08" }]],
  [/SELECT id FROM cards WHERE partner_id/i, []],
  [/INSERT INTO cards/i, [{ id: "card-1" }]]
];

const PARTNER_APPLICANT = {
  name: "Sam Rivera",
  email: "sam@example.com",
  phone: "5551234567",
  company: "Rivera LLC",
  audience: "book",
  kind: "partner",
  sms_consent: false
};

test("parsePartnerApplyBody requires name, email, track, audience; phone and SMS are optional", () => {
  assert.equal(parsePartnerApplyBody({}).ok, false);
  assert.equal(parsePartnerApplyBody({
    name: "Sam Rivera", email: "bad", phone: "555", track: "affiliate",
    audience: "list", sms_consent: true
  }).error, "name_email_required");
  assert.equal(parsePartnerApplyBody({
    name: "Sam Rivera", email: "sam@example.com", phone: "5551234567", track: "nope",
    audience: "list", sms_consent: true
  }).error, "track_required");
  const noSms = parsePartnerApplyBody({
    name: "Sam Rivera", email: "sam@example.com", phone: "5551234567", track: "affiliate",
    audience: "list", sms_consent: false
  });
  assert.equal(noSms.ok, true);
  assert.equal(noSms.sms_consent, false);
  const noPhone = parsePartnerApplyBody({
    name: "Sam Rivera", email: "sam@example.com", track: "affiliate",
    audience: "list", sms_consent: false
  });
  assert.equal(noPhone.ok, true);
  assert.equal(noPhone.phone, "");

  const ok = parsePartnerApplyBody({
    full_name: "Sam Rivera",
    email: "Sam@Example.COM",
    phone: "1 (555) 123-4567",
    company: "Rivera LLC",
    track: "white_label",
    audience: "book of clients",
    sms_consent: true
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.email, "sam@example.com");
  assert.equal(ok.phone, "5551234567");
  assert.equal(ok.kind, "partner");
});

test("slugFromName is a URL key", () => {
  assert.equal(slugFromName("Rivera Funding Co."), "rivera-funding-co");
  assert.equal(slugFromName("!!!"), "partner");
});

test("generateFirstPassword meets the 12-character floor", () => {
  const p = generateFirstPassword();
  assert.ok(p.length >= 12);
});

test("POST without a body is 400", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: {} }, res);
  assert.equal(res.out.statusCode, 400);
});

test("GET is 405", async () => {
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.out.statusCode, 405);
});

/* WAS: "runPartnerApply refuses a duplicate email without creating a row",
   which asserted the 409 already_registered this endpoint used to return. That
   409 refused the warm buyer the funnel exists to promote and told any stranger
   which addresses have a login (W5 finding F2), so it is gone. What must still
   hold is the thing the old test was really protecting: no second account. */
test("an address that already has a login is not given a second one", async () => {
  const client = fakeClient([
    [/FROM accounts/i, [{ id: "acct-1", kind: "client", affiliate_id: null, partner_id: null }]],
    [/INSERT INTO affiliates/i, [{ id: "aff-1", tracking_id: "AFF-000099" }]]
  ]);
  const result = await runPartnerApply(
    {
      name: "Sam Rivera",
      email: "sam@example.com",
      phone: "5551234567",
      company: "",
      audience: "list",
      kind: "affiliate",
      sms_consent: true
    },
    {
      db: { query: async () => ({ rows: [] }) },
      resolveDefaultOrg: async () => "org-1",
      connect: async () => client,
      createAccount: async () => { throw new Error("must not create a second account"); }
    }
  );
  assert.equal(result.ok, true, "an existing customer must not be refused");
  assert.notEqual(result.error, "already_registered");
  assert.equal(result.password, null, "no first password when the login already exists");
  assert.equal(result.tracking_id, "AFF-000099");
  assert.ok(!client.sawSql(/^\s*ROLLBACK/i), "the application must commit");
});

test("an affiliate who already has an affiliate login keeps their one tracking id", async () => {
  const client = fakeClient([
    [/FROM accounts/i, [{ id: "acct-1", kind: "affiliate", affiliate_id: "aff-7", partner_id: null }]],
    [/SELECT id, tracking_id FROM affiliates/i, [{ id: "aff-7", tracking_id: "AFF-000007" }]],
    [/INSERT INTO affiliates/i, [{ id: "aff-NEW", tracking_id: "AFF-999999" }]]
  ]);
  const result = await runPartnerApply(
    {
      name: "Sam Rivera",
      email: "sam@example.com",
      phone: "5551234567",
      company: "",
      audience: "list",
      kind: "affiliate",
      sms_consent: false
    },
    {
      db: { query: async () => ({ rows: [] }) },
      resolveDefaultOrg: async () => "org-1",
      connect: async () => client,
      createAccount: async () => { throw new Error("must not create a second account"); }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.affiliate_id, "aff-7");
  assert.equal(result.tracking_id, "AFF-000007");
  assert.ok(
    !client.sawSql(/INSERT INTO affiliates/i),
    "a second affiliates row would split their attribution and their balance"
  );
});

test("affiliate apply queues catalog AF1 for that one login", async () => {
  const queued = [];
  const client = fakeClient([
    [/FROM accounts/i, []],
    [/INSERT INTO affiliates/i, [{ id: "aff-1", tracking_id: "AFF-000099" }]]
  ]);
  const result = await runPartnerApply(
    {
      name: "Sam Rivera",
      email: "e2e+aff-click26@fundhub.ai",
      phone: "5551234567",
      company: "",
      audience: "list",
      kind: "affiliate",
      sms_consent: true
    },
    {
      db: { query: async () => ({ rows: [] }) },
      resolveDefaultOrg: async () => "org-1",
      connect: async () => client,
      createAccount: async () => ({ id: "acct-1" }),
      queueAffiliateTemplate: async (_db, args) => {
        queued.push(args);
        return { queued: true, messageId: "msg-1" };
      }
    }
  );
  assert.equal(result.ok, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].email, "e2e+aff-click26@fundhub.ai");
  assert.equal(queued[0].trackingId, "AFF-000099");
  assert.equal(queued[0].eventId, "aff-1");
});

test("a brand-new affiliate still gets their first password once", async () => {
  const client = fakeClient([
    [/FROM accounts/i, []],
    [/INSERT INTO affiliates/i, [{ id: "aff-1", tracking_id: "AFF-000099" }]]
  ]);
  const result = await runPartnerApply(
    {
      name: "Sam Rivera",
      email: "new@example.com",
      phone: "",
      company: "",
      audience: "list",
      kind: "affiliate",
      sms_consent: false
    },
    {
      db: { query: async () => ({ rows: [] }) },
      resolveDefaultOrg: async () => "org-1",
      connect: async () => client,
      createAccount: async () => ({ id: "acct-1" }),
      password: "first-password-xyz"
    }
  );
  assert.equal(result.password, "first-password-xyz");
  assert.equal(result.referral_url, "https://fundhub.ai/start?ref=AFF-000099");
});

test("placeWhiteLabelRailCard inserts on affiliates_white_label when the rail exists", async () => {
  const calls = [];
  const qx = {
    query: async (sql, params) => {
      assertBind(sql, params);
      calls.push({ sql, params });
      if (/affiliates_white_label/i.test(sql)) {
        return { rows: [{ stage_id: "st-active", pipeline_id: "pipe-r08" }] };
      }
      if (/SELECT id FROM cards WHERE partner_id/i.test(sql)) return { rows: [] };
      if (/INSERT INTO cards/i.test(sql)) return { rows: [{ id: "card-1" }] };
      throw new Error("unexpected sql: " + sql);
    }
  };
  const out = await placeWhiteLabelRailCard(qx, {
    orgId: "org-1",
    partnerId: "part-1",
    stageKey: "active"
  });
  assert.equal(out.placed, true);
  assert.equal(out.created, true);
  assert.ok(calls.some((c) => /INSERT INTO cards/i.test(c.sql)));
  assert.deepEqual(calls.find((c) => /INSERT INTO cards/i.test(c.sql)).params, [
    "org-1", "part-1", "pipe-r08", "st-active"
  ]);
});

test("white-label apply places a named card on R-08", async () => {
  const client = fakeClient([
    [/FROM accounts/i, []],
    [/FROM staff/i, [{ id: "staff-1" }]],
    [/lower\(contact_email\)/i, []],
    [/SELECT 1 FROM partners/i, []],
    [/INSERT INTO partners/i, [{ id: "part-1", slug: "rivera-llc" }]],
    ...RAIL_ROUTES
  ]);
  const result = await runPartnerApply(
    { ...PARTNER_APPLICANT, email: "e2e+wl-r08@fundhub.ai" },
    {
      db: { query: async () => ({ rows: [] }) },
      resolveDefaultOrg: async () => "org-1",
      connect: async () => client,
      createAccount: async () => ({ id: "acct-1" })
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.partner_id, "part-1");
  const cardInsert = client.find(/INSERT INTO cards/i);
  assert.ok(cardInsert, "white-label apply must insert a pipeline card");
  assert.equal(cardInsert.params[1], "part-1");
});

/* ------------------------------------------------------------------------- */
/* F1 — an application is pending, not live                                   */
/* ------------------------------------------------------------------------- */

test("a white-label application writes an invited partner, not an active one", async () => {
  const client = fakeClient([
    [/FROM accounts/i, []],
    [/lower\(contact_email\)/i, []],
    [/SELECT 1 FROM partners/i, []],
    [/INSERT INTO partners/i, [{ id: "part-1", slug: "rivera-llc" }]],
    ...RAIL_ROUTES
  ]);
  const result = await runPartnerApply(PARTNER_APPLICANT, {
    db: { query: async () => ({ rows: [] }) },
    resolveDefaultOrg: async () => "org-1",
    connect: async () => client,
    createAccount: async () => { throw new Error("must not create a login"); }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "pending_review");

  const insert = client.find(/INSERT INTO partners/i);
  assert.ok(insert, "the application must still be recorded");
  assert.match(insert.sql, /'invited'/, "an applicant is 'invited' — see 042_partners.sql");
  assert.doesNotMatch(insert.sql, /'active'/, "submitting a form must not activate a partner");
});

test("a white-label application provisions no login, no brand and no published page", async () => {
  const client = fakeClient([
    [/FROM accounts/i, []],
    [/lower\(contact_email\)/i, []],
    [/SELECT 1 FROM partners/i, []],
    [/INSERT INTO partners/i, [{ id: "part-1", slug: "rivera-llc" }]],
    ...RAIL_ROUTES
  ]);
  let welcomed = 0;
  const result = await runPartnerApply(PARTNER_APPLICANT, {
    db: { query: async () => ({ rows: [] }) },
    resolveDefaultOrg: async () => "org-1",
    connect: async () => client,
    createAccount: async () => { throw new Error("must not create a login"); },
    queuePartnerWelcome: async () => { welcomed += 1; return { ok: true }; }
  });

  assert.equal(result.ok, true);
  assert.equal(result.password, null, "no password before a human has approved anybody");
  assert.equal(result.site_url, null, "no public page before a human has approved anybody");
  assert.equal(result.site_path, null);
  assert.ok(!client.sawSql(/INSERT INTO partner_brand/i), "brand row belongs to approval");
  assert.ok(!client.sawSql(/INSERT INTO partner_pages/i), "the page belongs to approval");
  assert.equal(welcomed, 0, "the welcome mail says 'you are approved' — it belongs to approval");
});

test("a white-label applicant lands on the invited stage of R-08, not active", async () => {
  const client = fakeClient([
    [/FROM accounts/i, []],
    [/lower\(contact_email\)/i, []],
    [/SELECT 1 FROM partners/i, []],
    [/INSERT INTO partners/i, [{ id: "part-1", slug: "rivera-llc" }]],
    ...RAIL_ROUTES
  ]);
  await runPartnerApply(PARTNER_APPLICANT, {
    db: { query: async () => ({ rows: [] }) },
    resolveDefaultOrg: async () => "org-1",
    connect: async () => client,
    createAccount: async () => ({ id: "acct-1" })
  });
  const stageLookup = client.find(/affiliates_white_label/i);
  assert.ok(stageLookup, "the applicant must still reach the board");
  assert.equal(stageLookup.params[0], "invited");
});

test("a second application from the same address does not create a second partner", async () => {
  const client = fakeClient([
    [/FROM accounts/i, []],
    [/lower\(contact_email\)/i, [{ id: "part-1", status: "invited" }]],
    ...RAIL_ROUTES
  ]);
  const result = await runPartnerApply(PARTNER_APPLICANT, {
    db: { query: async () => ({ rows: [] }) },
    resolveDefaultOrg: async () => "org-1",
    connect: async () => client,
    createAccount: async () => ({ id: "acct-1" })
  });
  assert.equal(result.ok, true);
  assert.equal(result.partner_id, "part-1");
  assert.ok(!client.sawSql(/INSERT INTO partners/i), "the application is already on file");
});

test("an approved partner who fills the form in again is not sent back to invited", async () => {
  const client = fakeClient([
    [/FROM accounts/i, [{ id: "acct-1", kind: "partner", affiliate_id: null, partner_id: "part-1" }]],
    [/lower\(contact_email\)/i, [{ id: "part-1", status: "active" }]],
    ...RAIL_ROUTES
  ]);
  const result = await runPartnerApply(PARTNER_APPLICANT, {
    db: { query: async () => ({ rows: [] }) },
    resolveDefaultOrg: async () => "org-1",
    connect: async () => client,
    createAccount: async () => { throw new Error("must not create a second account"); }
  });
  assert.equal(result.ok, true);
  assert.ok(!client.sawSql(/affiliates_white_label/i), "a live partner's card must not move");
});

/* ------------------------------------------------------------------------- */
/* F2 — an existing customer may apply, and the answer gives nothing away     */
/* ------------------------------------------------------------------------- */

test("a customer who already bought something can apply as a white-label partner", async () => {
  const client = fakeClient([
    [/FROM accounts/i, [{ id: "acct-1", kind: "client", affiliate_id: null, partner_id: null }]],
    [/lower\(contact_email\)/i, []],
    [/SELECT 1 FROM partners/i, []],
    [/INSERT INTO partners/i, [{ id: "part-1", slug: "rivera-llc" }]],
    ...RAIL_ROUTES
  ]);
  const result = await runPartnerApply(PARTNER_APPLICANT, {
    db: { query: async () => ({ rows: [] }) },
    resolveDefaultOrg: async () => "org-1",
    connect: async () => client,
    createAccount: async () => { throw new Error("must not create a second account"); }
  });
  assert.equal(result.ok, true, "the warm buyer is exactly who this funnel promotes");
  assert.notEqual(result.error, "already_registered");
  assert.equal(result.partner_id, "part-1");
});

test("the white-label answer is identical whether or not the address has a login", async () => {
  const routes = (accountRows) => [
    [/FROM accounts/i, accountRows],
    [/lower\(contact_email\)/i, []],
    [/SELECT 1 FROM partners/i, []],
    [/INSERT INTO partners/i, [{ id: "part-1", slug: "rivera-llc" }]],
    ...RAIL_ROUTES
  ];
  const run = (accountRows) => runPartnerApply(PARTNER_APPLICANT, {
    db: { query: async () => ({ rows: [] }) },
    resolveDefaultOrg: async () => "org-1",
    connect: async () => fakeClient(routes(accountRows)),
    createAccount: async () => ({ id: "acct-1" }),
    password: "fixed-password-xyz"
  });

  const stranger = await run([]);
  const customer = await run([
    { id: "acct-1", kind: "client", affiliate_id: null, partner_id: null }
  ]);
  assert.deepEqual(
    customer,
    stranger,
    "any difference here turns the public form into an account-enumeration oracle"
  );
});

test("a malformed body is the only 4xx this endpoint still returns", async () => {
  const res = mockRes();
  await handler({
    method: "POST",
    body: { name: "Sam Rivera", email: "bad-shape", track: "white_label", audience: "book" }
  }, res);
  assert.equal(res.out.statusCode, 400);
  assert.equal(res.out.body.error, "name_email_required");
});

/* ------------------------------------------------------------------------- */
/* Approval — the human step the application now waits for                    */
/* ------------------------------------------------------------------------- */

function approvalClient(extra = []) {
  return fakeClient([
    [/FROM partners WHERE id/i, [{
      id: "part-1",
      name: "Rivera LLC",
      brand_name: "Rivera LLC",
      slug: "rivera-llc",
      status: "invited",
      contact_email: "sam@example.com"
    }]],
    ...extra,
    [/FROM accounts/i, []],
    [/FROM staff/i, [{ id: "staff-1" }]],
    ...RAIL_ROUTES
  ]);
}

test("approval is what creates the login, the brand row and the published page", async () => {
  const client = approvalClient();
  const created = [];
  const welcomed = [];
  const result = await approvePartnerApplication(
    { partnerId: "part-1", orgId: "org-1" },
    {
      db: { query: async () => ({ rows: [] }) },
      connect: async () => client,
      createAccount: async (_c, args) => { created.push(args); return { id: "acct-1" }; },
      queuePartnerWelcome: async (_db, args) => { welcomed.push(args); return { ok: true }; },
      password: "approved-password-xyz"
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.password, "approved-password-xyz");
  assert.equal(result.site_path, "/sites/part-1/apply");
  assert.equal(created.length, 1);
  assert.equal(created[0].kind, "partner");
  assert.equal(created[0].invitedBy, "staff-1", "invite-only needs a recorded inviter");
  assert.ok(client.sawSql(/INSERT INTO partner_brand/i));
  assert.ok(client.sawSql(/INSERT INTO partner_pages/i));
  assert.match(client.find(/INSERT INTO partner_pages/i).sql, /'published'/);
  assert.match(client.find(/UPDATE partners SET status/i).sql, /'active'/);
  assert.equal(client.find(/affiliates_white_label/i).params[0], "active");
  assert.equal(welcomed.length, 1);
});

test("approval does not stamp the agreement, so the payout gate still holds", async () => {
  const client = approvalClient();
  const result = await approvePartnerApplication(
    { partnerId: "part-1", orgId: "org-1" },
    {
      db: { query: async () => ({ rows: [] }) },
      connect: async () => client,
      createAccount: async () => ({ id: "acct-1" }),
      queuePartnerWelcome: async () => ({ ok: true })
    }
  );
  assert.equal(result.agreement_signed, false);
  assert.ok(
    !client.sawSql(/agreement_signed_at/i),
    "042_partners.sql blocks payouts until a human stamps this — approval must not"
  );
});

test("approving somebody whose email already has a login does not make a second one", async () => {
  const client = approvalClient([
    [/FROM accounts/i, [{ id: "acct-9", kind: "client", affiliate_id: null, partner_id: null }]]
  ]);
  const result = await approvePartnerApplication(
    { partnerId: "part-1", orgId: "org-1" },
    {
      db: { query: async () => ({ rows: [] }) },
      connect: async () => client,
      createAccount: async () => { throw new Error("must not create a second account"); },
      queuePartnerWelcome: async () => ({ ok: true })
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.password, null);
  assert.equal(result.login_blocked, "email_already_has_an_account");
});

test("approval refuses a partner it cannot find", async () => {
  const client = fakeClient([[/FROM partners WHERE id/i, []]]);
  const result = await approvePartnerApplication(
    { partnerId: "nope", orgId: "org-1" },
    {
      db: { query: async () => ({ rows: [] }) },
      connect: async () => client,
      createAccount: async () => { throw new Error("must not create"); },
      queuePartnerWelcome: async () => ({ ok: true })
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.ok(client.sawSql(/^\s*ROLLBACK/i));
});

test("approval needs a partner id", async () => {
  const result = await approvePartnerApplication({}, {
    db: { query: async () => ({ rows: [] }) },
    connect: async () => { throw new Error("must not open a transaction"); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "partner_id_required");
});

test("the statements behind approval and the welcome say what they do", async () => {
  const client = approvalClient();
  await approvePartnerApplication(
    { partnerId: "part-1", orgId: "org-1" },
    {
      db: { query: async () => ({ rows: [] }) },
      connect: async () => client,
      createAccount: async () => ({ id: "acct-1" }),
      queuePartnerWelcome: async () => ({ ok: true }),
      password: "approved-password-xyz"
    }
  );
  assertSqlHas(client.find(/affiliates_white_label/i).sql, {
    "this company's R-08 rail, the stage asked for": "WHERE p.key = 'affiliates_white_label' AND ps.key = $1 AND p.org_id = $2 AND ps.org_id = $2 LIMIT 1"
  });
  assertSqlHas(client.find(/INSERT INTO partner_brand/i).sql, { "a brand row already there is left alone": "ON CONFLICT (partner_id) DO NOTHING" });
  assertSqlHas(client.find(/INSERT INTO partner_pages/i).sql, {
    "the apply page is published once": "VALUES ($1, $2, 'apply', $3, 'apply', 'published', $4::jsonb, now()) ON CONFLICT (partner_id, slug) DO UPDATE SET status = 'published', published_at = COALESCE(partner_pages.published_at, now()), updated_at = now()"
  });
});

test("a second application is matched on this company's partner with the same address, oldest first", async () => {
  const client = fakeClient([
    [/FROM accounts/i, []],
    [/lower\(contact_email\)/i, [{ id: "part-1", status: "invited" }]],
    ...RAIL_ROUTES
  ]);
  await runPartnerApply(PARTNER_APPLICANT, {
    db: { query: async () => ({ rows: [] }) }, resolveDefaultOrg: async () => "org-1", connect: async () => client, createAccount: async () => ({ id: "acct-1" })
  });
  assertSqlHas(client.find(/lower\(contact_email\)/i).sql, { "same company, same address, the first one": "WHERE org_id = $1 AND lower(contact_email) = $2 ORDER BY created_at ASC LIMIT 1" });
});

test("the affiliate welcome reads this company's template by key and is queued once per login", async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      assertBind(sql, params);
      calls.push({ sql, params });
      if (/FROM message_templates/.test(sql)) return { rows: [{ body: "Hi {{contact.first_name}}", subject: "Welcome", compliance_passed: true }] };
      if (/INSERT INTO messages/.test(sql)) return { rows: [{ id: "m1" }] };
      return { rows: [] };
    }
  };
  const out = await queueAffiliateTemplate(db, { orgId: "org-1", email: "Sam@Example.com", name: "Sam Rivera", trackingId: "fh1042", eventId: "ev-1" });
  assert.equal(out.queued, true);
  assertSqlHas(calls.find((c) => /FROM message_templates/.test(c.sql)).sql, { "this company's template for that key": "WHERE org_id = $1 AND template_key = $2 LIMIT 1" });
  const insert = calls.find((c) => /INSERT INTO messages/.test(c.sql));
  assert.equal(insert.params[3], "affiliate-drip:AF1:ev-1");
  assertSqlHas(insert.sql, {
    "an outbound email, queued, compliance already passed": "VALUES ($1, NULL, 'outbound', 'email', $2, $3, 'internal', $4, 'queued', true, $5, $6)",
    "the same event is absorbed, not sent twice": "ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING RETURNING id"
  });
});
