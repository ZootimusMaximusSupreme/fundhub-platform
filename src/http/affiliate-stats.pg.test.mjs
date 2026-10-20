/* GET /api/read/affiliates — do the four numbers on the affiliate screen exist,
 * are they right, and can one affiliate see another's? (T10-04)
 *
 * A pg test rather than a unit test because the thing under test is the SQL.
 * The counting rule this endpoint exists to get right — count referrals from
 * BOTH the structured table and the live capture on clients.custom_fields, then
 * de-duplicate — cannot be exercised without a database, and a handler that
 * answers 200 with a plausible zero is exactly the failure being guarded
 * against.
 *
 * THE ASSERTION THAT MATTERS MOST is the last one: a converted referral with NO
 * commission amount on the row must stay COUNTABLE as converted while its money
 * stays NULL. That fixture writes commission_due NULL on purpose. A
 * COALESCE(commission_due, 0) anywhere in this path would turn "we have not
 * worked out what you are owed" into "you are owed nothing".
 * (Owner-set rates live in migration 260; this test still proves NULL money survives.)
 *
 * NO TEST HERE DEPENDS ON ANOTHER ONE RUNNING FIRST. Affiliates alpha and bravo
 * are built once in before() and are READ ONLY — nothing below writes to them.
 * Any test that needs to change data (settle a payout, record a click) builds
 * its own affiliate first and asserts on that. The clicks test used to open
 * with "alpha has 0 clicks", which was true only because no earlier test had
 * inserted one; the payout test used to settle a run against alpha, which any
 * later test reading alpha then had to know about. Keep the rule: if a test
 * writes, it writes to an affiliate it made.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createAccount, createAccountSession } from "../auth/account-session.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const MARK = "t10affstats";

describe("affiliate stats read", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, handler, ownerStaff;
  let affA, affB;
  let tokA, tokB, tokStaff;
  let codeA, codeB;

  const call = async (path, token) =>
    handler(new Request("https://x" + path, {
      headers: token ? { authorization: "Bearer " + token, host: "x" } : { host: "x" }
    }), {});
  const json = async (r) => { try { return JSON.parse(await r.text()); } catch { return null; } };

  const mkClient = async (name, tier1Code) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email, custom_fields)
     VALUES ($1,'T10',$2,$3,$4::jsonb) RETURNING id`,
    [org, name, `${MARK}.${name}@example.com`.toLowerCase(),
     tier1Code ? JSON.stringify({ affiliate_tier1_owner: tier1Code }) : "{}"]
  )).rows[0].id;

  const mkAffiliate = async (name) => (await db.query(
    `INSERT INTO affiliates (org_id, name, status) VALUES ($1,$2,'active')
     RETURNING id, tracking_id`, [org, `${MARK}-${name}`])).rows[0];

  const mkReferral = async (affiliateId, clientId, opts = {}) => (await db.query(
    `INSERT INTO affiliate_referrals
       (org_id, affiliate_id, client_id, tier, tracking_id_used, status,
        converted_at, commission_due)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [org, affiliateId, clientId, opts.tier || "direct", opts.code || null,
     opts.status || "attributed",
     opts.status === "converted" || opts.status === "paid" ? new Date() : null,
     opts.commissionDue === undefined ? null : opts.commissionDue]
  )).rows[0].id;

  before(async () => {
    ({ default: handler } = await import("../../netlify/functions/api.mjs"));
    org = await resolveDefaultOrg(db);
    await purge();

    const a = await mkAffiliate("alpha");
    const b = await mkAffiliate("bravo");
    affA = a.id; codeA = a.tracking_id;
    affB = b.id; codeB = b.tracking_id;

    // ── Affiliate A's referrals, deliberately mixed across both sources ─────
    // 1. In the structured table only, still attributed.
    await mkReferral(affA, await mkClient("structured", null), { code: codeA });
    // 2. In BOTH — the row and the live capture agree. Must count ONCE.
    const both = await mkClient("both", codeA);
    await mkReferral(affA, both, { code: codeA });
    // 3. In the live capture ONLY. This is what af-02 writes today, and what a
    //    referrals-table-only count would silently lose. Lower-cased on purpose:
    //    the match is case-insensitive, the way 033's backfill matched it.
    await mkClient("captureonly", String(codeA).toLowerCase());
    // 4. CONVERTED, and UNRATED — commission_due left NULL on purpose (money unknown).
    const conv = await mkClient("converted", null);
    await mkReferral(affA, conv, { code: codeA, status: "converted" });

    // ── Affiliate B: one referral of its own. A must never see it. ──────────
    await mkReferral(affB, await mkClient("bravolead", null), { code: codeB });

    // ── Sessions ───────────────────────────────────────────────────────────
    ownerStaff = (await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND role = 'owner' LIMIT 1`,
      [org])).rows[0];
    tokStaff = (await createSession(db, {
      staffId: ownerStaff.id, orgId: ownerStaff.org_id })).token;

    const acct = async (email, affiliateId) => {
      const rec = await createAccount(db, {
        orgId: org, kind: "affiliate", email,
        password: "a-long-enough-password-1", invitedBy: ownerStaff.id, affiliateId
      });
      return (await createAccountSession(db, { accountId: rec.id, orgId: org })).token;
    };
    tokA = await acct(`${MARK}.alpha@example.com`, affA);
    tokB = await acct(`${MARK}.bravo@example.com`, affB);
  });

  after(async () => { await purge(); await close(); });

  async function purge() {
    if (!HAVE_DB) return;
    await db.query(`DELETE FROM account_sessions WHERE account_id IN
      (SELECT id FROM accounts WHERE email LIKE $1)`, [`${MARK}%`]);
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [`${MARK}%`]);
    const affIds = (await db.query(
      `SELECT id FROM affiliates WHERE name LIKE $1`, [`${MARK}%`])).rows.map(r => r.id);
    // A click on a dead code has affiliate_id NULL, so it is found by its code.
    await db.query(`DELETE FROM affiliate_link_clicks WHERE tracking_id_used LIKE $1`, [`${MARK}%`]);
    if (affIds.length) {
      await db.query(`DELETE FROM affiliate_link_clicks WHERE affiliate_id = ANY($1::uuid[])`, [affIds]);
      /* 033 makes payout runs and attribution rows undeletable on purpose —
         they are somebody's money trail. The triggers are switched off only for
         the length of this teardown, on fixtures this file created, and switched
         straight back on. Nothing about the guard is weakened for production.

         The lines are NOT deleted directly: affiliate_payout_lines.payout_id is
         ON DELETE CASCADE, and its guard only fires at pg_trigger_depth() = 0,
         so removing the run takes its lines with it. */
      await db.query(`ALTER TABLE affiliate_payouts DISABLE TRIGGER trg_affiliate_payouts_no_delete`);
      await db.query(`DELETE FROM affiliate_payouts WHERE affiliate_id = ANY($1::uuid[])`, [affIds]);
      await db.query(`ALTER TABLE affiliate_payouts ENABLE TRIGGER trg_affiliate_payouts_no_delete`);
      await db.query(`ALTER TABLE affiliate_referrals DISABLE TRIGGER trg_affiliate_referrals_no_delete`);
      await db.query(`DELETE FROM affiliate_referrals WHERE affiliate_id = ANY($1::uuid[])`, [affIds]);
      await db.query(`ALTER TABLE affiliate_referrals ENABLE TRIGGER trg_affiliate_referrals_no_delete`);
    }
    await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`${MARK}%`]);
    await db.query(`DELETE FROM affiliates WHERE name LIKE $1`, [`${MARK}%`]);
  }

  const mineFor = async (token, id) => {
    const r = await call("/api/read/affiliates?limit=200", token);
    assert.equal(r.status, 200);
    const body = await json(r);
    assert.equal(body.ok, true);
    return (body.items || []).filter((x) => x.id === id)[0];
  };

  test("an affiliate sees ONLY their own row", async () => {
    const r = await call("/api/read/affiliates?limit=200", tokA);
    const body = await json(r);
    assert.equal(r.status, 200);
    assert.equal(body.items.length, 1, "an affiliate session must return exactly one row");
    assert.equal(body.items[0].id, affA);
    assert.ok(!body.items.some((x) => x.id === affB), "affiliate A must not see affiliate B");
  });

  test("REFERRED counts BOTH sources and de-duplicates the overlap", async () => {
    const mine = await mineFor(tokA, affA);
    // structured-only + both + capture-only + converted = 4 distinct clients.
    // The client in BOTH sources must be counted once, not twice.
    assert.equal(Number(mine.referred_count), 4);
    // Exactly one of them exists only on the client record, with no referral row.
    assert.equal(Number(mine.referred_untracked), 1);
  });

  test("a referral only the live capture recorded is still counted", async () => {
    // The regression this guards: counting affiliate_referrals alone.
    // src/workflows/af-02-referral-ownership-capture.mjs writes
    // clients.custom_fields.affiliate_tier1_owner and never a referral row, so a
    // table-only count reports a number that stopped growing when 033's one-time
    // backfill finished.
    const referralRows = Number((await db.query(
      `SELECT COUNT(*)::int AS n FROM affiliate_referrals
        WHERE affiliate_id = $1 AND tier = 'direct'`, [affA])).rows[0].n);
    const mine = await mineFor(tokA, affA);
    assert.equal(referralRows, 3, "three referral rows exist");
    assert.ok(Number(mine.referred_count) > referralRows,
      "REFERRED must exceed the referral-table count, because one referral lives only on the client record");
  });

  test("an UNRATED conversion counts as converted and its money stays NULL", async () => {
    const mine = await mineFor(tokA, affA);

    // Counted as converted…
    assert.equal(Number(mine.converted_count), 1);
    // …and flagged as having no rate, which is what carries the NULL to screen.
    assert.equal(Number(mine.unrated_converted_count), 1);

    // THE MONEY RULE. The stored value is still NULL — not 0, not "0.00".
    const stored = (await db.query(
      `SELECT commission_due FROM affiliate_referrals
        WHERE affiliate_id = $1 AND status = 'converted'`, [affA])).rows[0];
    assert.strictEqual(stored.commission_due, null,
      "commission_due must survive as NULL — unknown money is never zero");

    // And nothing accrued from it: 033's rollup skips NULL commission_due.
    assert.equal(Number(mine.balance_due), 0);
  });

  test("a client is never counted for two affiliates at once", async () => {
    /* THE DOUBLE-COUNT. A client's attribution was corrected: the referral row
       credits CHARLIE, but the code left on the client record is DELTA's old
       one. 033 makes the referral row unique per client and immutable, so
       CHARLIE is the owner and there is nothing to argue about. Before this
       fix, DELTA's screen also claimed that client — the same person counted
       twice, on two different partners' REFERRED tiles. */
    const c = await mkAffiliate("charlie");
    const d = await mkAffiliate("delta");
    const shared = await mkClient("disputed", d.tracking_id);   // delta's stale code
    await mkReferral(c.id, shared, { code: c.tracking_id });    // charlie owns the row

    const roster = await json(await call("/api/read/affiliates?limit=200", tokStaff));
    const charlie = roster.items.filter((x) => x.id === c.id)[0];
    const delta = roster.items.filter((x) => x.id === d.id)[0];

    assert.equal(Number(charlie.referred_count), 1, "the referral row decides who owns the client");
    assert.equal(Number(charlie.referred_untracked), 0, "and that client is tracked");
    assert.equal(Number(delta.referred_count), 0,
      "a stale code must not claim a client somebody else's referral row already owns");
  });

  test("PAID is zero with no settled run, and real once a run settles", async () => {
    // Its own affiliate: this test settles money, and nothing else should have
    // to know that happened.
    const p = await mkAffiliate("payee");
    const refId = await mkReferral(p.id, await mkClient("payeelead", null),
      { code: p.tracking_id, status: "converted" });

    let mine = await mineFor(tokStaff, p.id);
    assert.equal(Number(mine.paid_runs), 0, "no run has settled yet");
    assert.equal(Number(mine.paid_total), 0);

    // 033 refuses to settle a run for an affiliate whose partner license is
    // unsigned — "payouts accrue but do not release". Sign it, so this test is
    // exercising the counting and not that guard.
    // 490 adds the tax half of that gate in the database too.
    await db.query(
      `UPDATE affiliates SET partner_license_signed_at = now(), tax_form_received_at = now()
        WHERE id = $1`, [p.id]);

    // Built as an open run, lined, then settled — 033 refuses a line on a run
    // that is already paid, which is the order a real payout run follows.
    const payout = (await db.query(
      `INSERT INTO affiliate_payouts
         (org_id, affiliate_id, period_start, period_end, status)
       VALUES ($1,$2, now() - interval '7 days', now(), 'pending')
       RETURNING id`, [org, p.id])).rows[0].id;
    await db.query(
      `INSERT INTO affiliate_payout_lines (org_id, payout_id, referral_id, kind, amount)
       VALUES ($1,$2,$3,'commission',125.50)`, [org, payout, refId]);
    // 033 allows pending -> processing -> paid and nothing shorter: money in
    // flight is a state a run has to pass through.
    await db.query(
      `UPDATE affiliate_payouts SET status = 'processing', initiated_at = now() WHERE id = $1`,
      [payout]);
    await db.query(
      // 490: paid needs a method and a reference.
      `UPDATE affiliate_payouts SET status = 'paid', paid_at = now(), method = 'ach',
              external_ref = 'TEST-ACH-TRACE-1' WHERE id = $1`, [payout]);

    mine = await mineFor(tokStaff, p.id);
    assert.equal(Number(mine.paid_runs), 1);
    assert.equal(Number(mine.paid_total), 125.5);
  });

  test("CLICKS counts recorded clicks, and a dead-code click belongs to nobody", async () => {
    // Its own affiliate, made in this test, so "no clicks yet" is a fact about
    // this row rather than a fact about test ordering.
    const k = await mkAffiliate("clicker");
    let mine = await mineFor(tokStaff, k.id);
    assert.equal(Number(mine.clicks_count), 0, "a brand new affiliate has no clicks");

    await db.query(
      `INSERT INTO affiliate_link_clicks (org_id, affiliate_id, tracking_id_used, source)
       VALUES ($1,$2,$3,'start-page')`, [org, k.id, k.tracking_id]);
    // A click on a code that resolved to nobody: recorded, attributed to no one.
    await db.query(
      `INSERT INTO affiliate_link_clicks (org_id, affiliate_id, tracking_id_used, source)
       VALUES ($1,NULL,$2,'start-page')`, [org, `${MARK}-DEAD-CODE`]);
    // An old click, outside the 30-day window.
    await db.query(
      `INSERT INTO affiliate_link_clicks
         (org_id, affiliate_id, tracking_id_used, source, occurred_at)
       VALUES ($1,$2,$3,'start-page', now() - interval '90 days')`, [org, k.id, k.tracking_id]);

    mine = await mineFor(tokStaff, k.id);
    assert.equal(Number(mine.clicks_count), 2, "lifetime clicks attributed to this affiliate");
    assert.equal(Number(mine.clicks_30d), 1, "only one of them is inside 30 days");

    // The dead-code click belongs to nobody and is on nobody's tile.
    const orphan = (await db.query(
      `SELECT affiliate_id FROM affiliate_link_clicks WHERE tracking_id_used = $1`,
      [`${MARK}-DEAD-CODE`])).rows;
    assert.equal(orphan.length, 1);
    assert.strictEqual(orphan[0].affiliate_id, null);
  });

  test("staff see the roster and every affiliate carries its own numbers", async () => {
    const r = await call("/api/read/affiliates?limit=200", tokStaff);
    assert.equal(r.status, 200);
    const body = await json(r);
    const a = body.items.filter((x) => x.id === affA)[0];
    const b = body.items.filter((x) => x.id === affB)[0];
    assert.ok(a && b, "an owner sees both affiliates");
    assert.equal(Number(a.referred_count), 4);
    assert.equal(Number(b.referred_count), 1, "B's count is B's own, not A's");
    assert.equal(Number(b.converted_count), 0);
  });

  test("affiliate B's own read shows B's numbers only", async () => {
    const mine = await mineFor(tokB, affB);
    assert.equal(Number(mine.referred_count), 1);
    assert.equal(Number(mine.clicks_count), 0);
    assert.equal(Number(mine.paid_runs), 0);
  });
});
