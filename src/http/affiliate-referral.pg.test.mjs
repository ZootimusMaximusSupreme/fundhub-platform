// "Refer a friend", and the affiliate portal read behind it.
//
// TWO THINGS ARE UNDER TEST AND THEY ARE HALVES OF ONE FEATURE:
//   POST /api/affiliates/refer      — turns a client into a light affiliate
//   GET  /api/read/affiliate-portal — what that person then sees
//
// WHY THESE LIVE UNDER src/http/ AND NOT UNDER api/. CLAUDE.md §12: npm test's
// glob is `src/**` and `scripts/**` only, so a test file placed beside its
// handler under api/ silently never runs. This imports the Netlify function so
// the ROUTES map is exercised too — a handler that works but is not routed 404s
// in production, which has shipped twice in this repo.
//
// The adversarial cases are the point. The interesting assertions here are the
// ones where somebody presses the button twice, or asks for rows that are not
// theirs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

describe("refer a friend", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, handler, staffId;
  let clientA, clientB, tokA, tokB, tokStaff;
  let otherAffiliate, tokOtherAffiliate;

  const MARK = "referfriend";

  const call = async (path, token, init = {}) =>
    handler(new Request("https://x" + path, {
      ...init,
      headers: Object.assign(
        { host: "x" },
        token ? { authorization: "Bearer " + token } : {},
        init.body ? { "content-type": "application/json" } : {},
        init.headers || {}
      )
    }), {});
  const post = (path, token, body) =>
    call(path, token, { method: "POST", body: JSON.stringify(body || {}) });
  const json = async (r) => { try { return JSON.parse(await r.text()); } catch { return null; } };

  before(async () => {
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));
    org = await resolveDefaultOrg(db);
    await purge();

    const mkClient = async (n) => (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Refer',$2,$3) RETURNING id`,
      [org, n, `${MARK}.${n}@example.com`.toLowerCase()])).rows[0].id;
    clientA = await mkClient("Alpha");
    clientB = await mkClient("Bravo");

    const s = (await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [org])).rows[0];
    staffId = s.id;
    tokStaff = (await createSession(db, { staffId: s.id, orgId: s.org_id })).token;

    const acct = async (kind, email, subject) => {
      const a = await createAccount(db, {
        orgId: org, kind, email, password: "a-long-enough-password-1",
        invitedBy: s.id, ...subject
      });
      return (await createAccountSession(db, { accountId: a.id, orgId: org })).token;
    };
    tokA = await acct("client", `${MARK}.alpha@example.com`, { clientId: clientA });
    tokB = await acct("client", `${MARK}.bravo@example.com`, { clientId: clientB });

    // A pre-existing, unrelated affiliate. Nothing a client does may ever
    // return this one's rows.
    for (const [key, status] of [[`${MARK}_live`, "live"], [`${MARK}_draft`, "draft"]]) {
      await db.query(
        `INSERT INTO marketing_funnels (org_id, key, name, landing_url, lane, status, active)
         VALUES ($1,$2,$3,$4,'uwiq',$5,$6) ON CONFLICT (org_id, key) DO NOTHING`,
        [org, key, key, `https://apply.fundhub.ai/${key}`, status, status === "live"]);
    }
    otherAffiliate = (await db.query(
      `INSERT INTO affiliates (org_id, name, status) VALUES ($1,$2,'active') RETURNING id`,
      [org, `${MARK} other`])).rows[0].id;
    tokOtherAffiliate = await acct("affiliate", `${MARK}.other@example.com`,
      { affiliateId: otherAffiliate });
  });

  async function purge() {
    await db.query(`DELETE FROM marketing_funnels WHERE org_id = $1 AND key LIKE $2`, [org, `${MARK}%`]);
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
      (SELECT id FROM accounts WHERE email LIKE $1)`, [`${MARK}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${MARK}%`]);
    const cids = (await db.query(
      `SELECT id FROM clients WHERE email LIKE $1`, [`${MARK}%`])).rows.map(r => r.id);
    if (cids.length) {
      // trg_affiliate_referrals_no_delete refuses a DELETE outright — an
      // attribution row is voided, never removed (033_affiliates.sql). That is
      // right for production and wrong for a scratch fixture, so the guard is
      // lifted around this one statement and put straight back. Same shape as
      // the entitlements purge in src/http/principal-reads.pg.test.mjs.
      await db.query(`ALTER TABLE affiliate_referrals DISABLE TRIGGER trg_affiliate_referrals_no_delete`);
      try { await db.query(`DELETE FROM affiliate_referrals WHERE client_id = ANY($1)`, [cids]); }
      finally { await db.query(`ALTER TABLE affiliate_referrals ENABLE TRIGGER trg_affiliate_referrals_no_delete`); }
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [cids]);
    }
    await db.query(`DELETE FROM affiliate_payout_lines WHERE payout_id IN
      (SELECT id FROM affiliate_payouts WHERE affiliate_id IN
        (SELECT id FROM affiliates WHERE name LIKE $1))`, [`${MARK}%`]);
    await db.query(`DELETE FROM affiliate_payouts WHERE affiliate_id IN
      (SELECT id FROM affiliates WHERE name LIKE $1)`, [`${MARK}%`]);
    await db.query(`ALTER TABLE affiliate_referrals DISABLE TRIGGER trg_affiliate_referrals_no_delete`);
    try {
      await db.query(`DELETE FROM affiliate_referrals WHERE affiliate_id IN
        (SELECT id FROM affiliates WHERE name LIKE $1)`, [`${MARK}%`]);
    } finally {
      await db.query(`ALTER TABLE affiliate_referrals ENABLE TRIGGER trg_affiliate_referrals_no_delete`);
    }
    await db.query(`DELETE FROM affiliates WHERE name LIKE $1`, [`${MARK}%`]);
  }

  after(async () => { await purge(); await close(); });

  // ── the button ───────────────────────────────────────────────────────────

  test("a client presses the button and gets a code and a share link", async () => {
    const r = await post("/api/affiliates/refer", tokA);
    assert.equal(r.status, 201, "the enrolment was refused");
    const b = await json(r);
    assert.equal(b.ok, true);
    assert.equal(b.enrolled, true);
    assert.equal(b.created, true);
    assert.ok(b.code, "no affiliate code came back");
    assert.match(b.shareUrl, /[?&]ref=/, "the share link carries no ref code");
    assert.ok(b.shareUrl.includes(encodeURIComponent(b.code)),
      "the share link does not carry this client's own code");
  });

  test("the account still resolves as a CLIENT, not as an affiliate", async () => {
    // The whole point of 340_client_light_affiliate.sql: kind does not change,
    // so no endpoint gated on ["staff","client"] starts admitting a new kind.
    const row = (await db.query(
      `SELECT kind, client_id, affiliate_id FROM accounts WHERE org_id = $1 AND email = $2`,
      [org, `${MARK}.alpha@example.com`])).rows[0];
    assert.equal(row.kind, "client", "pressing the button changed the principal kind");
    assert.equal(String(row.client_id), String(clientA));
    assert.ok(row.affiliate_id, "no affiliate row was linked to the account");
  });

  test("a second press returns the SAME code and creates no second affiliate", async () => {
    const before = (await db.query(
      `SELECT count(*)::int AS n FROM affiliates WHERE org_id = $1`, [org])).rows[0].n;
    const first = await json(await post("/api/affiliates/refer", tokA));
    const second = await json(await post("/api/affiliates/refer", tokA));
    const after_ = (await db.query(
      `SELECT count(*)::int AS n FROM affiliates WHERE org_id = $1`, [org])).rows[0].n;

    assert.equal(second.code, first.code, "a second press issued a different code");
    assert.equal(second.created, false, "a second press reported creating a new row");
    assert.equal(after_, before, "a second press created another affiliate row");
  });

  test("two presses that arrive together still produce exactly one affiliate", async () => {
    // The FOR UPDATE lock is what makes this true. Without it both requests read
    // "not enrolled" and both insert.
    const before = (await db.query(
      `SELECT count(*)::int AS n FROM affiliates WHERE org_id = $1`, [org])).rows[0].n;
    const results = await Promise.all([
      post("/api/affiliates/refer", tokB),
      post("/api/affiliates/refer", tokB),
      post("/api/affiliates/refer", tokB)
    ]);
    const bodies = await Promise.all(results.map(json));
    const after_ = (await db.query(
      `SELECT count(*)::int AS n FROM affiliates WHERE org_id = $1`, [org])).rows[0].n;

    assert.equal(after_ - before, 1, "three simultaneous presses did not produce exactly one row");
    const codes = new Set(bodies.map((b) => b && b.code).filter(Boolean));
    assert.equal(codes.size, 1, `three presses returned ${codes.size} different codes`);
  });

  test("staff may not enrol somebody else, and an anonymous caller may not either", async () => {
    assert.equal((await post("/api/affiliates/refer", tokStaff)).status, 403,
      "a staff session enrolled a client into a commission programme");
    assert.equal((await post("/api/affiliates/refer", null)).status, 401);
    assert.equal((await post("/api/affiliates/refer", tokOtherAffiliate)).status, 403,
      "an existing affiliate was admitted to the client-only enrolment path");
  });

  test("GET is refused — this endpoint writes", async () => {
    assert.equal((await call("/api/affiliates/refer", tokA)).status, 405);
  });

  // ── the read behind the screen ───────────────────────────────────────────

  test("an enrolled client reads their own portal, with the real rates", async () => {
    await post("/api/affiliates/refer", tokA);
    const b = await json(await call("/api/read/affiliate-portal", tokA));
    assert.equal(b.ok, true);
    assert.equal(b.enrolled, true);
    assert.ok(b.affiliate && b.affiliate.code, "no affiliate came back for an enrolled client");
    // One row per LIVE funnel (owner call 2026-10-06): same code on every page.
    // The live one made in before() shows; the draft one does not.
    const keys = b.affiliate.offerLinks.map((l) => l.key);
    assert.ok(keys.includes(`${MARK}_live`), "a live funnel did not appear on the affiliate page");
    assert.ok(!keys.includes(`${MARK}_draft`), "a draft funnel appeared on the affiliate page");
    for (const l of b.affiliate.offerLinks) {
      const u = new URL(l.url);
      assert.equal(u.searchParams.get("a1"), b.affiliate.code, `${l.name} link lost the a1 code`);
      assert.equal(u.searchParams.get("ref"), b.affiliate.code, `${l.name} link lost the ref code`);
    }

    // Owner-set 2026-08-24, migration 261: 20% direct, 5% downline. Read from
    // affiliate_commission_rules, never hardcoded on the screen. Every rule
    // carries a product, so a tier is several live rows; `percent` is filled in
    // only when they agree, which on this schedule they do.
    assert.ok(b.rates.direct, "no direct rate was found");
    assert.ok(b.rates.direct.rules.length >= 1, "the direct tier came back with no rules");
    assert.equal(Number(b.rates.direct.percent), 20, "the direct rate is not the owner-set 20%");
    assert.ok(b.rates.downline, "no downline rate was found");
    assert.equal(Number(b.rates.downline.percent), 5, "the downline rate is not the owner-set 5%");

    // The rate is never invented by the screen: every rule that produced it is
    // named, so a disagreement between products is visible rather than averaged.
    assert.ok(b.rates.direct.rules.every((r) => r.calcMethod === "percent"));
  });

  test("a client who has NOT pressed the button gets an honest empty answer, not a 403", async () => {
    const c = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Refer','Charlie',$2) RETURNING id`,
      [org, `${MARK}.charlie@example.com`])).rows[0].id;
    const a = await createAccount(db, {
      orgId: org, kind: "client", email: `${MARK}.charlie2@example.com`,
      password: "a-long-enough-password-1", invitedBy: staffId, clientId: c
    });
    const tok = (await createAccountSession(db, { accountId: a.id, orgId: org })).token;

    const r = await call("/api/read/affiliate-portal", tok);
    assert.equal(r.status, 200, "a not-yet-enrolled client was refused instead of shown the door");
    const b = await json(r);
    assert.equal(b.enrolled, false);
    assert.deepEqual(b.referrals, []);
    assert.deepEqual(b.payouts, []);
  });

  test("a client cannot read another affiliate's rows by asking for them", async () => {
    // The query parameter is read for STAFF ONLY. For anybody else it is
    // ignored outright, so this must come back as the caller's OWN file.
    const b = await json(await call(
      "/api/read/affiliate-portal?affiliate_id=" + otherAffiliate, tokA));
    assert.equal(b.enrolled, true);
    assert.notEqual(String(b.affiliate.id), String(otherAffiliate),
      "a client read somebody else's affiliate file by naming it in the query string");
  });

  test("a converted referral with no rule keeps its commission NULL, never 0", async () => {
    // CLAUDE.md: NULL means unknown and must survive. COALESCE(commission_due,0)
    // would turn "we have not worked out what you are owed" into "you are owed
    // nothing", which is the worse of the two lies.
    const mine = (await db.query(
      `SELECT affiliate_id FROM accounts WHERE org_id = $1 AND email = $2`,
      [org, `${MARK}.alpha@example.com`])).rows[0].affiliate_id;

    await db.query(
      `INSERT INTO affiliate_referrals
         (org_id, affiliate_id, client_id, tier, status, converted_at, commission_due)
       VALUES ($1,$2,$3,'direct','converted', now(), NULL)`,
      [org, mine, clientB]);

    const b = await json(await call("/api/read/affiliate-portal", tokA));
    const row = b.referrals.find((r) => String(r.status) === "converted");
    assert.ok(row, "the referral row did not reach the screen at all");
    assert.equal(row.commissionDue, null,
      "an uncalculated commission was reported as a number");
  });

  test("both gates are reported with their evidence, and the tax gate is an honest absence", async () => {
    const b = await json(await call("/api/read/affiliate-portal", tokA));
    assert.ok(b.gates, "no gates came back");
    // Nothing has signed a licence for this new affiliate.
    assert.equal(b.gates.license.signed, false);
    assert.equal(b.gates.license.signedAt, null);
    // affiliates.tax_form_received_at is new and nothing writes it yet, so this
    // is "no record held" for everybody. It must not read as a submitted form.
    assert.equal(b.gates.tax.onFile, false);
    assert.equal(b.gates.tax.receivedAt, null);
  });

  test("staff may look at one affiliate's file by naming it", async () => {
    const b = await json(await call(
      "/api/read/affiliate-portal?affiliate_id=" + otherAffiliate, tokStaff));
    assert.equal(b.enrolled, true);
    assert.equal(String(b.affiliate.id), String(otherAffiliate));
  });

  test("an anonymous caller is refused", async () => {
    assert.equal((await call("/api/read/affiliate-portal", null)).status, 401);
  });

  // ── the seam between the two lanes ───────────────────────────────────────

  test("pressing the button makes the PROGRESS endpoint report the referral", async () => {
    /* THE ONE THING NEITHER LANE COULD TEST ALONE, and it is where they were
       wired together wrongly. The referral half writes accounts.affiliate_id;
       the progress page reads `referral` off /api/read/client-progress. Those
       were built in separate lanes against a written contract, and the read half
       was originally written to answer `enrolled: false` always — correctly,
       because when it was written accounts_subject_ck forbade a client account
       from holding an affiliate_id at all. Migration 340 changed that. Without
       this test, both halves pass their own suites while the button does
       nothing a client can see. */
    const enrol = await json(await post("/api/affiliates/refer", tokA));
    assert.ok(enrol.code, "enrolment returned no code");

    const progress = await json(await call("/api/read/client-progress", tokA));
    assert.equal(progress.ok, true, "the progress endpoint refused an enrolled client");
    assert.ok(progress.referral, "no referral block on the progress response");
    assert.equal(progress.referral.enrolled, true,
      "the client enrolled, and the page would still show them the join button");
    assert.equal(progress.referral.code, enrol.code,
      "the page and the enrolment reply name two different codes");
    assert.equal(progress.referral.shareUrl, enrol.shareUrl,
      "the page and the enrolment reply hand out two different links for one code");
    assert.match(String(progress.referral.shareUrl), /[?&]ref=/,
      "the share link carries no referral code");
  });

  test("a client who has not pressed it is reported as not enrolled, not as an error", async () => {
    const c = (await db.query(
      `INSERT INTO clients (org_id, first_name, last_name, email)
       VALUES ($1,'Refer','Delta',$2) RETURNING id`,
      [org, `${MARK}.delta@example.com`])).rows[0].id;
    const a = await createAccount(db, {
      orgId: org, kind: "client", email: `${MARK}.delta2@example.com`,
      password: "a-long-enough-password-1", invitedBy: staffId, clientId: c
    });
    const tok = (await createAccountSession(db, { accountId: a.id, orgId: org })).token;

    const progress = await json(await call("/api/read/client-progress", tok));
    assert.equal(progress.ok, true);
    assert.equal(progress.referral.enrolled, false);
    assert.equal(progress.referral.code, null, "a code was invented for somebody with none");
    assert.equal(progress.referral.shareUrl, null, "a share link was built with no code behind it");
  });

  test("the round the progress page offers is the one the buy endpoint accepts", async () => {
    /* THE SECOND SEAM, and it was broken the same way. The read endpoint returned
       the STORED kind 'dispute_round'; api/paid-services.mjs refuses every service
       but 'paid_round' with `unknown_service`, and the screen selects the round
       card by matching that same name. So the card did not render, and if it had,
       the button would have 400'd. Asserted here across BOTH endpoints, because
       neither one's own suite can see the mismatch. */
    const progress = await json(await call("/api/read/client-progress", tokA));
    const offered = (progress.paidServices || []).map((s) => s.serviceKey);

    const priceList = await json(await call("/api/paid-services", tokA));
    assert.equal(priceList.ok, true, "the price list refused a client");
    const sellable = (priceList.services || []).map((s) => s.serviceKey || s.service_key);

    for (const key of offered) {
      assert.ok(sellable.includes(key),
        `the progress page offers "${key}" and the buy endpoint does not sell it`);
    }

    /* AND THE COMPONENTS INSIDE IT, for the same reason and the same fault.
       The progress endpoint used to build its own component list keyed on the
       INTERNAL line codes (round_base, creditor_letter, escalation_filings)
       while the buy endpoint and the contract both used base, creditor,
       cfpb_and_ag. Two reads of one product, two sets of keys — and the screen
       derives which extras to buy from those keys, so it would have posted
       both add-ons as false and charged the base rate for a round the client
       had ticked two boxes on. Neither endpoint's own suite could see it. */
    const pRound = (progress.paidServices || []).find((x) => x.serviceKey === "paid_round");
    const sRound = (priceList.services || []).find((x) => (x.serviceKey || x.service_key) === "paid_round");
    assert.ok(pRound && sRound, "the round is missing from one of the two reads");
    assert.deepEqual(
      pRound.components.map((c) => c.key),
      sRound.components.map((c) => c.key),
      "the two endpoints describe one product with different component keys"
    );
    assert.deepEqual(
      pRound.components.map((c) => c.priceCents),
      sRound.components.map((c) => c.priceCents),
      "the two endpoints quote different prices for one product"
    );
    /* And the keys are the contract's, not either endpoint's private spelling. */
    assert.deepEqual(pRound.components.map((c) => c.key), ["base", "creditor", "cfpb_and_ag"],
      "portal-progress-contract.md:108-110 names these three");
  });
});
