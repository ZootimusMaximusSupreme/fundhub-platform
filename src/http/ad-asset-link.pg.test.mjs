// Postgres-backed tests for POST /api/campaigns/link-asset — the one write that
// decides whether 377's label spine shows real labels or reads empty forever.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS FILE IS HERE AND NOT NEXT TO THE HANDLER
//
// npm test's glob is "src/**" and "scripts/**" only (CLAUDE.md §12). A test
// placed under api/ is never collected and passes forever by never running. The
// handler is imported from here instead — the same arrangement, and the same
// reason, as src/http/creative-generate.pg.test.mjs:4-8.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE FAILURE MODE THIS FILE EXISTS TO CATCH
//
// 377's Part 4b says it plainly: until something writes ads.asset_id,
// v_ad_label_spine returns NULL labels for every row and the spine reads as
// EMPTY rather than as broken. An empty screen with no error is the hardest
// kind of wrong to notice. So the first assertion below is that the spine IS
// empty before the link, and the second is that the same row carries the angle
// and the hook afterwards. One without the other proves nothing: a test that
// only checked "labels present" would still pass if they had been there all
// along.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE READS RUN INSIDE asStaff()
//
// ads, creative_assets and ad_scripts all carry FORCEd row-level security. A
// bare db.query against one of them is anonymous to those policies — it matches
// ZERO rows rather than erroring, which makes a test look green while proving
// nothing. Same rule src/db/label-spine.pg.test.mjs:13-19 writes down.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE HANDLER RUNS AGAINST REAL SESSIONS
//
// There is no injection seam. Every call carries a token minted for a real row
// in sessions or account_sessions, so requirePrincipal is exercised rather than
// stubbed.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE DOES *NOT* PROVE — ROW-LEVEL SECURITY
//
// Of the handler's three locks, this file exercises two whatever role it runs
// as: the handler's own partner_id / org_id comparison (link-asset.mjs:161-170)
// and 377's trg_ads_asset_partner trigger. It does NOT prove the first one.
// Row-level security only bites when the connection is the unprivileged
// fundhub_app role; run as the database owner — which is how CI runs most of
// this suite — a superuser bypasses every policy, so a green run here says
// nothing about RLS. src/db/label-spine.pg.test.mjs:40-46 routes its isolation
// assertions through src/testing/rls-pool.mjs for exactly that reason. This
// file deliberately does not, and the cross-partner test below asserts the
// invariant both roles share instead. Do not read it as proof of RLS.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs. A skipped
// .pg.test.mjs is NOT green (CLAUDE.md §12).

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { asStaff } from "../partners/rls.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { createAccountSession } from "../auth/account-session.mjs";
import handler from "../../api/campaigns/link-asset.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

const SLUG = "adlink-pg-test";
const STAFF_EMAIL = "adlink_pg_test_owner@example.com";
const ACCT_EMAIL_LIKE = "adlink_pg_acct_%@example.com";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};

describe("POST /api/campaigns/link-asset", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org;
  let partnerA, partnerB;
  let staffId, staffToken;
  let acctAToken;
  let connB, campB, setB;
  let scriptA, assetA, assetA2;
  let assetB;                       // partner B's creative — the cross-partner probe
  let adA, adA2;                    // two ads so the duplicate-number test has a rival

  const call = async (body, token) => {
    const r = res();
    await handler({
      method: "POST", query: {}, body,
      headers: token ? { authorization: "Bearer " + token } : {}
    }, r);
    return r;
  };

  const adRow = async (id) => (await asStaff((tx) => tx.query(
    `SELECT id, asset_id, fundhub_ad_number, fundhub_ad_number_source FROM ads WHERE id = $1`, [id]
  ))).rows[0];

  const spineRow = async (id) => (await asStaff((tx) => tx.query(
    `SELECT * FROM v_ad_label_spine WHERE ad_row_id = $1`, [id]
  ))).rows[0];

  // ── fixtures ────────────────────────────────────────────────────────────

  async function makePartner(tag) {
    return (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now()) RETURNING id`,
      [org, `Ad link ${tag}`, `${SLUG}-${tag}`]
    )).rows[0].id;
  }

  /* One connection / campaign / ad set per partner. offer_type 'funding' is one
     of the three seeded into ad_platform_category_map by
     052_config_defaults.sql, so the guard trigger at 046:348-354 lets the
     campaign insert through. Copied from src/db/label-spine.pg.test.mjs:72-88. */
  async function makeChain(tx, partnerId, tag) {
    const conn = (await tx.query(
      `INSERT INTO ad_platform_connections
         (org_id, partner_id, platform, external_ad_account_id, connection_state,
          platform_verification_state, encrypted_access_token)
       VALUES ($1,$2,'meta',$3,'active','approved','v1:x:y:z') RETURNING id`,
      [org, partnerId, `acct-${SLUG}-${tag}`]
    )).rows[0].id;

    const camp = (await tx.query(
      `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type,
                              budget_cents, approval_state)
       VALUES ($1,$2,$3,$4,'funding',10000,'draft') RETURNING id`,
      [org, partnerId, conn, `Ad link campaign ${tag}`]
    )).rows[0].id;

    const set = (await tx.query(
      `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name,
                            budget_cents, approval_state)
       VALUES ($1,$2,$3,$4,$5,10000,'draft') RETURNING id`,
      [org, partnerId, conn, camp, `Ad link ad set ${tag}`]
    )).rows[0].id;

    return { conn, camp, set };
  }

  const makeAd = (tx, partnerId, chain, name) => tx.query(
    `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id,
                      name, approval_state)
     VALUES ($1,$2,$3,$4,$5,$6,'draft') RETURNING id`,
    [org, partnerId, chain.conn, chain.camp, chain.set, name]
  ).then((r) => r.rows[0].id);

  const makeCreative = (tx, partnerId, scriptId) => tx.query(
    `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated, script_id)
     VALUES ($1,$2,'video','9x16',true,$3) RETURNING id`,
    [org, partnerId, scriptId]
  ).then((r) => r.rows[0].id);

  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${SLUG}%`]
    )).rows.map((r) => r.id);

    if (ids.length) {
      // creative_assets refuses a direct DELETE (fundhub_no_delete, 045:236-240).
      // Same escape hatch src/db/label-spine.pg.test.mjs:143-159 uses.
      await db.query(`ALTER TABLE creative_assets DISABLE TRIGGER trg_creative_assets_no_delete`);
      try {
        await asStaff(async (tx) => {
          for (const t of ["ad_metrics_daily", "ads", "ad_sets", "campaigns"]) {
            await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
          }
          await tx.query(`DELETE FROM creative_assets WHERE partner_id = ANY($1)`, [ids]);
          // Children before parents: parent_script_id is ON DELETE RESTRICT.
          await tx.query(
            `DELETE FROM ad_scripts WHERE partner_id = ANY($1) AND parent_script_id IS NOT NULL`,
            [ids]
          );
          await tx.query(`DELETE FROM ad_scripts WHERE partner_id = ANY($1)`, [ids]);
          await tx.query(`DELETE FROM ad_platform_connections WHERE partner_id = ANY($1)`, [ids]);
        });
      } finally {
        await db.query(`ALTER TABLE creative_assets ENABLE TRIGGER trg_creative_assets_no_delete`);
      }
      // accounts.partner_id is ON DELETE CASCADE, so this takes the fixture
      // accounts and their sessions with it.
      await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [ACCT_EMAIL_LIKE]);
    await db.query(`DELETE FROM staff WHERE email = $1`, [STAFF_EMAIL]);
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    await cleanup();

    partnerA = await makePartner("a");
    partnerB = await makePartner("b");

    await asStaff(async (tx) => {
      const chainA = await makeChain(tx, partnerA, "a");
      const chainB = await makeChain(tx, partnerB, "b");
      ({ conn: connB, camp: campB, set: setB } = chainB);

      // The script carries the labels. This is the whole point of the chain:
      // nothing writes angle_key onto the creative or onto the ad — the view
      // inherits it by join (377 Part 4d).
      scriptA = (await tx.query(
        `INSERT INTO ad_scripts (org_id, partner_id, title, body, hook_text,
                                 script_type, lane, angle_key, hook_key, offer_key)
         VALUES ($1,$2,'Ad link denial','HOOK: they said no.\nBODY: here is why.\nCTA: book.',
                 'they said no', 'cold', 'funding600', 'denial_angle', 'they_said_no', 'funding')
         RETURNING id`,
        [org, partnerA]
      )).rows[0].id;

      assetA  = await makeCreative(tx, partnerA, scriptA);
      assetA2 = await makeCreative(tx, partnerA, scriptA);
      // Partner B's creative hangs off no script. It exists only to be refused.
      assetB  = await makeCreative(tx, partnerB, null);

      adA  = await makeAd(tx, partnerA, chainA, "Ad link ad one");
      adA2 = await makeAd(tx, partnerA, chainA, "Ad link ad two");
    });

    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Ad Link Owner','owner',$2,'active') RETURNING id`,
      [org, STAFF_EMAIL]
    )).rows[0].id;
    staffToken = (await createSession(db, { staffId, orgId: org })).token;

    // 044's accounts_active_needs_hash needs a hash on an active account, and its
    // trigger refuses a self-signed-up partner, so invited_by names the employee
    // who invited them. The hash is a placeholder nothing authenticates against;
    // this account signs in through createAccountSession directly.
    const acctA = (await db.query(
      `INSERT INTO accounts
         (org_id, kind, email, name, status, partner_id, password_hash, invited_by, invited_at)
       VALUES ($1,'partner',$2,'Ad Link A','active',$3,'scrypt$placeholder',$4,now())
       RETURNING id`,
      [org, "adlink_pg_acct_a@example.com", partnerA, staffId]
    )).rows[0].id;
    acctAToken = (await createAccountSession(db, { accountId: acctA, orgId: org })).token;
  });

  after(async () => { await cleanup(); await close(); });

  // ── 1. the empty spine, and then the full one ───────────────────────────

  test("before the link the ad is on the spine with every label NULL", async () => {
    const row = await spineRow(adA);
    assert.ok(row, "an ad with no creative must still appear — the view LEFT JOINs (377 Part 4d)");
    assert.strictEqual(row.asset_id, null, "nothing has written ads.asset_id yet");
    for (const c of ["script_id", "angle_key", "hook_key", "offer_key", "script_type", "lane"]) {
      assert.strictEqual(row[c], null, `${c} should be NULL before anything is linked`);
    }
  });

  test("linking a creative makes the labels appear on the spine", async () => {
    const r = await call({ partner_id: partnerA, ad_id: adA, asset_id: assetA }, staffToken);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.ad.asset_id, assetA);

    // The row, not the response. A response is the endpoint's account of what it
    // did; the row is what it did.
    const row = await spineRow(adA);
    assert.strictEqual(row.asset_id, assetA);
    assert.strictEqual(row.script_id, scriptA);
    assert.strictEqual(row.angle_key, "denial_angle", "the angle rode down script -> creative -> ad");
    assert.strictEqual(row.hook_key, "they_said_no");
    assert.strictEqual(row.offer_key, "funding");
    assert.strictEqual(row.script_type, "cold");
    assert.strictEqual(row.lane, "funding600");
  });

  // ── 2. NULL stays NULL when unknown ─────────────────────────────────────

  test("setting only the ad number leaves asset_id exactly as it was", async () => {
    const before = await adRow(adA);
    assert.strictEqual(before.asset_id, assetA, "fixture check");

    const r = await call({ partner_id: partnerA, ad_id: adA, fundhub_ad_number: "42" }, staffToken);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));

    const after = await adRow(adA);
    assert.strictEqual(after.fundhub_ad_number, "42");
    assert.strictEqual(after.asset_id, assetA, "an absent asset_id must not blank the link");
  });

  test("setting only the creative leaves an unset ad number NULL", async () => {
    const r = await call({ partner_id: partnerA, ad_id: adA2, asset_id: assetA2 }, staffToken);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));

    const row = await adRow(adA2);
    assert.strictEqual(row.asset_id, assetA2);
    assert.strictEqual(row.fundhub_ad_number, null,
      "unknown must survive as unknown — never defaulted to 0 or to a blank string");
  });

  test("both can be set in one call, which is what a human actually does", async () => {
    const r = await call(
      { partner_id: partnerA, ad_id: adA2, asset_id: assetA2, fundhub_ad_number: "43" },
      staffToken
    );
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    const row = await adRow(adA2);
    assert.strictEqual(row.asset_id, assetA2);
    assert.strictEqual(row.fundhub_ad_number, "43");
  });

  test("an explicit null unlinks, and the labels go back to NULL", async () => {
    await call({ partner_id: partnerA, ad_id: adA2, asset_id: assetA2 }, staffToken);
    const r = await call({ partner_id: partnerA, ad_id: adA2, asset_id: null }, staffToken);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));

    const row = await spineRow(adA2);
    assert.strictEqual(row.asset_id, null, "null is a real instruction, not an absent field");
    assert.strictEqual(row.angle_key, null, "the labels are inherited by join, so they go too");
    assert.strictEqual(row.fundhub_ad_number, "43", "unlinking must not touch the number");

    // Put it back for the tests below.
    await call({ partner_id: partnerA, ad_id: adA2, asset_id: assetA2 }, staffToken);
  });

  test("an empty string clears the value, the same as an explicit null", async () => {
    // Blank is NOT the same as absent. Absent is decided on the key being there
    // at all; a blank string is a key that is there, so it clears.
    const r = await call(
      { partner_id: partnerA, ad_id: adA2, asset_id: assetA2, fundhub_ad_number: "" },
      staffToken
    );
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    const row = await adRow(adA2);
    assert.strictEqual(row.fundhub_ad_number, null, "a cleared text box clears the number");
  });

  test("a blank asset_id unlinks, exactly as an explicit null does", async () => {
    // The dangerous half of the same rule, written down so nobody builds a screen
    // that posts "" from an empty select box and quietly wipes a live link.
    const before = await adRow(adA2);
    assert.strictEqual(before.asset_id, assetA2, "fixture check");

    const r = await call({ partner_id: partnerA, ad_id: adA2, asset_id: "" }, staffToken);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));

    const row = await spineRow(adA2);
    assert.strictEqual(row.asset_id, null, "blank clears — it does not leave the link alone");
    assert.strictEqual(row.angle_key, null, "so the labels go with it");

    // Put it back for the tests below.
    await call({ partner_id: partnerA, ad_id: adA2, asset_id: assetA2 }, staffToken);
  });

  // ── 3. the cross-partner refusal ────────────────────────────────────────

  test("a cross-partner link is refused and asset_id stays NULL", async () => {
    // Partner B's creative onto partner A's ad. WHICH REFUSAL ARRIVES DEPENDS ON
    // THE DATABASE ROLE, and both are correct:
    //
    //   as fundhub_app  — RLS hides partner B's asset inside partner A's scope,
    //                     so the handler cannot see it and answers 404.
    //   as the owner    — a superuser bypasses every policy, so the handler DOES
    //                     see it, compares partner_id itself, and answers 400.
    //
    // The assertion is therefore on the invariant both share: refused, and the
    // ad unchanged. Asserting one exact code would make this file pass or fail
    // on which URL it was pointed at rather than on the behaviour.
    const before = await adRow(adA);
    const r = await call({ partner_id: partnerA, ad_id: adA, asset_id: assetB }, staffToken);

    assert.ok(r.code === 404 || r.code === 400,
      `expected a refusal, got ${r.code} ${JSON.stringify(r.body)}`);
    assert.strictEqual(r.body.ok, false);
    assert.notStrictEqual(r.code, 500, "a cross-partner link must be a stated refusal, never a crash");

    const after = await adRow(adA);
    assert.strictEqual(after.asset_id, before.asset_id,
      "a refused link must leave the ad exactly as it was");
  });

  test("a partner cannot link a creative onto another partner's ad", async () => {
    // Partner A's own session, aimed at partner B's ad. resolvePartnerId ignores
    // any partner_id in the body for a partner principal, so the scope is A's
    // and B's ad is simply not there.
    const adB = await asStaff((tx) => makeAd(tx, partnerB, { conn: connB, camp: campB, set: setB }, "B ad"));
    const r = await call({ partner_id: partnerB, ad_id: adB, asset_id: assetB }, acctAToken);

    assert.strictEqual(r.code, 404, JSON.stringify(r.body));
    const row = await adRow(adB);
    assert.strictEqual(row.asset_id, null, "partner B's ad must be untouched");
  });

  test("a partner can link its own creative onto its own ad", async () => {
    const r = await call({ partner_id: partnerA, ad_id: adA, asset_id: assetA }, acctAToken);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ad.asset_id, assetA);
  });

  // ── 4. the ad number's own rules ────────────────────────────────────────

  test("two ads may share one number since 416, and a typed number reads manual", async () => {
    // Until 416 this was a 409 ad_number_taken from the unique index
    // ads_fundhub_number_uq (377:575). The owner-approved spec (§10.4) replaced
    // it with a plain index: one ad number may run in several ad sets, and a v2
    // keeps its number. So the second ad now takes the same number.
    const first = await call({ partner_id: partnerA, ad_id: adA, fundhub_ad_number: "77" }, staffToken);
    assert.strictEqual(first.code, 200, JSON.stringify(first.body));
    const r = await call({ partner_id: partnerA, ad_id: adA2, fundhub_ad_number: "77" }, staffToken);

    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ad.fundhub_ad_number, "77");
    assert.strictEqual(r.body.ad.fundhub_ad_number_source, "manual",
      "a number typed by a person must say so, or the sync could overwrite it");

    for (const id of [adA, adA2]) {
      const row = await adRow(id);
      assert.strictEqual(row.fundhub_ad_number, "77");
      assert.strictEqual(row.fundhub_ad_number_source, "manual");
    }
  });

  test("clearing the number clears where it came from", async () => {
    const r = await call({ partner_id: partnerA, ad_id: adA2, fundhub_ad_number: null }, staffToken);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    const row = await adRow(adA2);
    assert.strictEqual(row.fundhub_ad_number, null);
    assert.strictEqual(row.fundhub_ad_number_source, null);
  });

  test("setting only the creative leaves the number's source alone", async () => {
    const before = await adRow(adA);
    assert.strictEqual(before.fundhub_ad_number_source, "manual", "fixture check");
    const r = await call({ partner_id: partnerA, ad_id: adA, asset_id: assetA }, staffToken);
    assert.strictEqual(r.code, 200, JSON.stringify(r.body));
    const after = await adRow(adA);
    assert.strictEqual(after.fundhub_ad_number, before.fundhub_ad_number);
    assert.strictEqual(after.fundhub_ad_number_source, "manual");
  });

  test("a Meta ad id is refused in our number column", async () => {
    // The whole point of two columns. A Meta ad id is far longer than nine
    // digits, and fundhub_ad_id() caps at nine (286:81-84).
    const r = await call(
      { partner_id: partnerA, ad_id: adA, fundhub_ad_number: "23851234567890123" },
      staffToken
    );
    assert.strictEqual(r.code, 400, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, "invalid_ad_number");
  });

  test("a number with a slug in it is refused", async () => {
    const r = await call(
      { partner_id: partnerA, ad_id: adA, fundhub_ad_number: "43-ringlights" }, staffToken);
    assert.strictEqual(r.code, 400, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, "invalid_ad_number");
  });

  // ── 5. the plain refusals ───────────────────────────────────────────────

  test("a call that names neither field is refused rather than being a silent no-op", async () => {
    const r = await call({ partner_id: partnerA, ad_id: adA }, staffToken);
    assert.strictEqual(r.code, 400, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, "nothing_to_set");
  });

  test("an unknown ad is 404, not 500", async () => {
    const r = await call(
      { partner_id: partnerA, ad_id: "00000000-0000-4000-8000-000000000000", asset_id: assetA },
      staffToken
    );
    assert.strictEqual(r.code, 404, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, "ad_not_found");
  });

  test("an unknown creative is 404, not 500", async () => {
    const r = await call(
      { partner_id: partnerA, ad_id: adA, asset_id: "00000000-0000-4000-8000-000000000001" },
      staffToken
    );
    assert.strictEqual(r.code, 404, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, "asset_not_found");
  });

  test("a mistyped id is a stated refusal, not a database error", async () => {
    const r = await call({ partner_id: partnerA, ad_id: "not-a-uuid", asset_id: assetA }, staffToken);
    assert.strictEqual(r.code, 400, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, "ad_id_not_a_uuid");
  });

  test("staff must say which partner", async () => {
    const r = await call({ ad_id: adA, asset_id: assetA }, staffToken);
    assert.strictEqual(r.code, 400, JSON.stringify(r.body));
    assert.strictEqual(r.body.error, "partner_id_required");
  });

  test("no session gets nothing", async () => {
    const r = await call({ partner_id: partnerA, ad_id: adA, asset_id: assetA }, null);
    assert.strictEqual(r.code, 401, JSON.stringify(r.body));
  });

  test("GET is refused", async () => {
    const r = res();
    await handler({ method: "GET", query: {}, body: {}, headers: {} }, r);
    assert.strictEqual(r.code, 405);
    assert.strictEqual(r.headers.allow, "POST");
  });
});
