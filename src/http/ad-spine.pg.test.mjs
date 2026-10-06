// Endpoint tests for GET /api/read/ad-spine, against real Postgres.
//
// Lives under src/http/, not next to the handler under api/, because npm test's
// glob is "src/**" and "scripts/**" only (CLAUDE.md §12) — a test file placed
// under api/ silently never runs and reports nothing while looking green.
//
// Drives the handler directly rather than through netlify/functions/api.mjs and
// its ROUTES map, the same way src/http/analytics-youtube.pg.test.mjs does: this
// route is not in ROUTES yet and this lane does not own that file.
//
// Skips cleanly with DATABASE_URL unset — the whole describe block is skipped,
// exactly like its neighbours. A skipped .pg.test.mjs is NOT green (CLAUDE.md
// §12), and this file has never been executed against a real database: there is
// no Postgres on the machine it was written on.
//
// SO IT IS NOT THE ONLY TEST. src/http/ad-spine.test.mjs has no ".pg." in its
// name and runs everywhere: it drives the handler's exported pure functions —
// readDays, windowFor, buildFilters, buildQuery, shapeGroup — and asserts the
// endpoint's one headline claim, that an unknown never becomes 0, with no
// database at all. This file is the proof against real Postgres; that one is the
// proof that runs on every push.
//
// WHAT THE SECOND HALF OF THIS FILE PROVES. The money and people numbers added
// to grouped mode: that spend sums over the window and the per-day rows do not
// multiply the ad count; that a label with no ad_metrics_daily row comes back
// with spend NULL and never 0; that cost per booked person refuses to divide
// under MIN_N_RATE; that the date window really filters, on both the spend and
// the leads; that a leading zero in utm_content still matches an ad number typed
// without one; and that a person who books twice is still one person.
//
// WHO EACH QUERY RUNS AS. ads, creative_assets, ad_scripts and ad_labels all
// carry FORCEd row-level security. A bare db.query against one of them is
// anonymous to those policies and touches ZERO rows rather than erroring, so
// every fixture write and every verification read here goes through asStaff().
// The bare db.query calls are against partners, staff and sessions, which carry
// no policy.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import spineHandler from "../../api/read/ad-spine.mjs";
import { adAccountDay } from "../lib/ad-account-day.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG = "adspine-pg-test";
const EMAIL_TAG = "adspine_pg_test";

/* The fixture's days are computed in JavaScript as the AD ACCOUNT's days
   (America/Phoenix), exactly the way windowFor() in the handler computes the
   window, so the two cannot disagree by a timezone. Using the database's
   current_date instead would compare a server-local day against an Arizona one
   and make this test pass or fail depending on which machine, and which hour,
   ran it. */
const DAY_MS = 86400000;
const acctDay = (daysAgo) => adAccountDay(new Date(Date.now() - daysAgo * DAY_MS));

// MIN_N_RATE is 10 (src/ops/discoveries.mjs:9). The fixture is built either side
// of it on purpose: alpha clears it, beta does not.
const MIN_N = 10;

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
};

const req = (token, { method = "GET", query = {} } = {}) => ({
  method,
  headers: token ? { authorization: "Bearer " + token } : {},
  query
});

/* call — one request, one response, so each test reads as a sentence. */
async function call(token, query) {
  const r = res();
  await spineHandler(req(token, { query }), r, { db });
  return r;
}

describe("GET /api/read/ad-spine", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId, connId, campaignId, adSetId;
  let ad901, ad902;
  let tokenStaff, tokenNonStaff;

  before(async () => {
    org = await resolveDefaultOrg(db);
    await cleanup();

    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,'Ad spine fixture',$2,'active',now()) RETURNING id`,
      [org, SLUG]
    )).rows[0].id;

    const staffRow = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Ad Spine Fixture','owner','active') RETURNING id`,
      [org, `${EMAIL_TAG}.owner@example.com`]
    )).rows[0];
    tokenStaff = (await createSession(db, { staffId: staffRow.id, orgId: org })).token;

    // 'partner' is a real role (036_partner_role.sql) deliberately NOT in
    // ROLE_SETS.STAFF, so it is the shortest path to a real 403 rather than a
    // 401 — the same fixture scripts-write.pg.test.mjs uses. This used 'csm'
    // until 2026-10-05, but csm joined STAFF on purpose on 2026-09-05
    // (2b10dae65, "The CSM can now do the job"; see the STAFF comment in
    // src/http/read-api.mjs), so a csm is now ALLOWED here and the 403 this
    // test proves needs a role that is still outside STAFF.
    const nonStaffRow = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'Ad Spine Non-Staff','partner','active') RETURNING id`,
      [org, `${EMAIL_TAG}.partner@example.com`]
    )).rows[0];
    tokenNonStaff = (await createSession(db, { staffId: nonStaffRow.id, orgId: org })).token;

    await asStaff(async (tx) => {
      connId = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'meta',$3,'active','approved','v1:x:y:z') RETURNING id`,
        [org, partnerId, `acct-${SLUG}`]
      )).rows[0].id;

      // offer_type 'funding' is one of the three seeded into
      // ad_platform_category_map by 052_config_defaults.sql, so the guard trigger
      // at 046:348-354 lets this insert through.
      campaignId = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type,
                                budget_cents, approval_state)
         VALUES ($1,$2,$3,'Ad spine campaign','funding',10000,'draft') RETURNING id`,
        [org, partnerId, connId]
      )).rows[0].id;

      adSetId = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name,
                              budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,'Ad spine ad set',10000,'draft') RETURNING id`,
        [org, partnerId, connId, campaignId]
      )).rows[0].id;

      /* THE FIXTURE, IN ONE PICTURE.

           script alpha  →  creative C1  →  ad "Adspine alpha 1"   (number 901)
                                         →  ad "Adspine alpha 2"   (number 902)
           script beta   →  creative C2  →  ad "Adspine beta 1"    (number 903)
           script gamma  →  creative C3  →  ad "Adspine numberless" (NO number)
           (no script)   →  (no creative)→  ad "Adspine naked ad"  (no number)

         So group_by=angle must report adspine_alpha = 2 and adspine_beta = 1,
         and the naked ad must still appear with every label null.

         GAMMA EXISTS FOR ONE RULE AND NOTHING ELSE. "A group in which no ad
         carries our number reports people as null, not 0" used to be checked
         against the unlabelled group — which also collects every other ad in
         the org that has no creative, so one stray ad with a number anywhere in
         the company turned that assertion off and nobody would have noticed.
         adspine_nonumber is a group this fixture owns outright: one ad, no
         number, filterable by name, so the rule is asserted every run.

         The dictionary gets a name for alpha and DELIBERATELY NOT for beta —
         ad_scripts has no foreign key to ad_labels (377's header says why), so a
         label with no dictionary row must still group, just with a null name. */
      const alpha = (await tx.query(
        `INSERT INTO ad_scripts (org_id, partner_id, title, body, hook_text,
                                 script_type, lane, angle_key, hook_key, offer_key)
         VALUES ($1,$2,'Alpha script','HOOK: they said no.\nBODY: here is why.\nCTA: book a call.',
                 'They said no and nobody told you why.',
                 'cold','premium','adspine_alpha','adspine_h1','adspine_offer')
         RETURNING id`,
        [org, partnerId]
      )).rows[0].id;

      const beta = (await tx.query(
        `INSERT INTO ad_scripts (org_id, partner_id, title, body, angle_key)
         VALUES ($1,$2,'Beta script','HOOK: a broker burned you.','adspine_beta')
         RETURNING id`,
        [org, partnerId]
      )).rows[0].id;

      const gamma = (await tx.query(
        `INSERT INTO ad_scripts (org_id, partner_id, title, body, angle_key)
         VALUES ($1,$2,'Gamma script','HOOK: nobody typed a number on this one.','adspine_nonumber')
         RETURNING id`,
        [org, partnerId]
      )).rows[0].id;

      const c1 = (await tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated, script_id)
         VALUES ($1,$2,'video','9x16',true,$3) RETURNING id`,
        [org, partnerId, alpha]
      )).rows[0].id;

      const c2 = (await tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated, script_id)
         VALUES ($1,$2,'video','9x16',true,$3) RETURNING id`,
        [org, partnerId, beta]
      )).rows[0].id;

      const c3 = (await tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated, script_id)
         VALUES ($1,$2,'video','9x16',true,$3) RETURNING id`,
        [org, partnerId, gamma]
      )).rows[0].id;

      const insertAd = (name, assetId, number) => tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id,
                          name, approval_state, asset_id, fundhub_ad_number)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8) RETURNING id`,
        [org, partnerId, connId, campaignId, adSetId, name, assetId, number]
      ).then((r) => r.rows[0].id);

      ad901 = await insertAd("Adspine alpha 1", c1, "901");
      ad902 = await insertAd("Adspine alpha 2", c1, "902");
      await insertAd("Adspine beta 1", c2, "903");
      const adNoNumber = await insertAd("Adspine numberless", c3, null);
      await insertAd("Adspine naked ad", null, null);

      /* THE MONEY AND THE VIDEO, IN ONE PICTURE.

           ad 901 (alpha)   today       spend 1000, 100 impressions, 10 clicks
                                        video: 40 got past 3s, 10 reached p75
                            yesterday   spend 2000, 200 impressions, 20 clicks
                                        video: 60 got past 3s, 20 reached p75
           ad 902 (alpha)   100 days ago spend 999999           ← outside a 30-day window
                                        video: NOTHING           ← a photo ad
           ad 903 (beta)    NOTHING AT ALL                      ← spend must read null
           the numberless ad (gamma)     30000 impressions, video NOTHING
                                                                ← A PHOTO AD THAT RAN.
                                          Impressions reported, no video numbers at
                                          all. This is the case that must produce NO
                                          hook rate rather than a hook rate of 0.

         So a 30-day window sees alpha spend 3000 over 2 ad-days, and a 365-day
         window sees 1002999 over 3. Beta has no ad_metrics_daily row in either,
         which is the case that must come back NULL and never 0.

         And alpha over 30 days sees 300 impressions, 100 three-second views and
         30 p75 views: hook rate 100/300, hold rate 30/100. Both denominators are
         well over MIN_N_RATE, so both are real numbers rather than a refusal.

         video is passed as null on purpose for the photo rows. The eight columns
         (378_ad_video_metrics.sql) are nullable with no default precisely so a
         photo ad reads as "there is no such number" and not as "nobody watched".

         `pastOpening` is video_continuous_2s_watched — people who kept watching
         past the opening. It is NOT a 3-second count; Meta publishes no such
         field. See 378's header. */
      const metric = (adId, day, spend, impressions, clicks, pastOpening = null, p75 = null) => tx.query(
        `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, impressions, clicks,
                                       video_continuous_2s_watched, video_p75_watched)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9)`,
        [org, partnerId, adId, day, spend, impressions, clicks, pastOpening, p75]
      );

      await metric(ad901, acctDay(0), 1000, 100, 10, 40, 10);
      await metric(ad901, acctDay(1), 2000, 200, 20, 60, 20);
      await metric(ad902, acctDay(100), 999999, 5000, 500);
      await metric(adNoNumber, acctDay(0), 500, 30000, 5);

      await tx.query(
        `INSERT INTO ad_labels (org_id, kind, key, name, description, source_ref, sort_order)
         VALUES ($1,'angle','adspine_alpha','Alpha Angle','Fixture angle.','src/http/ad-spine.pg.test.mjs',1)
         ON CONFLICT (org_id, kind, key) DO NOTHING`,
        [org]
      );
    });

    /* THE PEOPLE, IN ONE PICTURE.

       clients carries no row-level security and both client_ad_attribution
       (286) and bookings (203) carry a USING (true) policy, so these three go
       through the plain pool like the partners/staff/sessions writes above.

       Attributed to ad 901 (the alpha angle), all inside a 30-day window:

         a00   utm_content '0901-ringlights'   booked      ← LEADING ZERO
         a01   utm_content '901'               booked TWICE ← one person, not two
         a02..a10 (nine more)                  booked
         a11   utm_content '901'               cancelled only ← arrived, did not book
         aold  utm_content '901', 100 days ago booked        ← outside a 30-day window

       So 30 days: 12 people arrived, 11 of them booked. 11 clears MIN_N_RATE,
       so cost per booked person is a real number: 3000 / 11.
       365 days: 13 arrived, 12 booked, spend 1002999.

       Attributed to ad 903 (the beta angle): 2 people arrived, 1 booked. 1 is
       under MIN_N_RATE, so the cost must refuse to compute. */
    const lead = async ({ tag, content, daysAgo = 0, bookings = [] }) => {
      const clientId = (await db.query(
        `INSERT INTO clients (org_id, email, first_name, last_name)
         VALUES ($1,$2,'Ad Spine','Lead') RETURNING id`,
        [org, `${EMAIL_TAG}.client.${tag}@example.com`]
      )).rows[0].id;

      // lane/ad_id/variant are GENERATED (286:108-110) — only the raw utm goes in.
      // Midday Arizona so the row sits well inside the ad account's day whatever
      // hour the test runs.
      await db.query(
        `INSERT INTO client_ad_attribution (client_id, org_id, utm_campaign, utm_content, captured_at)
         VALUES ($1,$2,'premium',$3,
                 ($4::date)::timestamp AT TIME ZONE 'America/Phoenix' + interval '12 hours')`,
        [clientId, org, content, acctDay(daysAgo)]
      );

      for (const status of bookings) {
        await db.query(
          `INSERT INTO bookings (org_id, client_id, source, status) VALUES ($1,$2,'sim',$3)`,
          [org, clientId, status]
        );
      }
      return clientId;
    };

    await lead({ tag: "a00", content: "0901-ringlights", bookings: ["booked"] });
    await lead({ tag: "a01", content: "901", bookings: ["booked", "rescheduled"] });
    for (let i = 2; i <= 10; i++) {
      await lead({ tag: `a${String(i).padStart(2, "0")}`, content: "901", bookings: ["booked"] });
    }
    await lead({ tag: "a11", content: "901", bookings: ["cancelled"] });
    await lead({ tag: "aold", content: "901", daysAgo: 100, bookings: ["booked"] });

    await lead({ tag: "b01", content: "903", bookings: ["booked"] });
    await lead({ tag: "b02", content: "903" });
  });

  after(async () => { await cleanup(); await close(); });

  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${SLUG}%`]
    )).rows.map((r) => r.id);

    if (ids.length) {
      // creative_assets refuses a direct DELETE (fundhub_no_delete, 045:236-240).
      // Same escape hatch src/db/label-spine.pg.test.mjs:143 uses.
      await db.query(`ALTER TABLE creative_assets DISABLE TRIGGER trg_creative_assets_no_delete`);
      try {
        await asStaff(async (tx) => {
          for (const t of ["ad_metrics_daily", "ads", "ad_sets", "campaigns"]) {
            await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
          }
          await tx.query(`DELETE FROM creative_assets WHERE partner_id = ANY($1)`, [ids]);
          // Children before parents: parent_script_id is ON DELETE RESTRICT.
          await tx.query(
            `DELETE FROM ad_scripts WHERE partner_id = ANY($1) AND parent_script_id IS NOT NULL`, [ids]);
          await tx.query(`DELETE FROM ad_scripts WHERE partner_id = ANY($1)`, [ids]);
          await tx.query(`DELETE FROM ad_platform_connections WHERE partner_id = ANY($1)`, [ids]);
        });
      } finally {
        await db.query(`ALTER TABLE creative_assets ENABLE TRIGGER trg_creative_assets_no_delete`);
      }
      await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
    }

    await asStaff((tx) => tx.query(
      `DELETE FROM ad_labels WHERE org_id = $1 AND key LIKE 'adspine_%'`, [org]));
    await db.query(
      `DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`,
      [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);

    // client_ad_attribution (286:96) and bookings (225) are both
    // ON DELETE CASCADE from clients, so removing the fixture clients removes
    // their attribution rows and their bookings with them.
    await db.query(`DELETE FROM clients WHERE email LIKE $1`, [`${EMAIL_TAG}.client.%`]);
  }

  const mine = (items, name) => items.find((i) => i.ad_name === name);

  // ── the gate ────────────────────────────────────────────────────────────

  test("a call with no session is refused", async () => {
    const r = await call(null, {});
    assert.equal(r.code, 401, `an unauthenticated caller got ${r.code}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, false);
  });

  test("a signed-in role outside ROLE_SETS.STAFF is refused", async () => {
    const r = await call(tokenNonStaff, {});
    assert.equal(r.code, 403);
    assert.equal(r.body.ok, false);
  });

  test("a method other than GET is refused", async () => {
    const r = res();
    await spineHandler(req(tokenStaff, { method: "POST" }), r, { db });
    assert.equal(r.code, 405);
  });

  // ── the list ────────────────────────────────────────────────────────────

  test("a staff call returns rows, newest ad first", async () => {
    const r = await call(tokenStaff, { limit: "200" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.group_by, null, "a plain call must not be in group mode");
    assert.ok(Array.isArray(r.body.items), "items is not an array");
    assert.ok(r.body.items.length >= 5, `the five fixture ads did not come back (${r.body.items.length} rows)`);

    const row = mine(r.body.items, "Adspine alpha 1");
    assert.ok(row, "the fixture ad did not come back from the read endpoint");
    assert.equal(row.angle_key, "adspine_alpha", "the angle did not carry down from the script");
    assert.equal(row.hook_key, "adspine_h1");
    assert.equal(row.lane, "premium");
    assert.equal(row.script_title, "Alpha script");
    assert.equal(row.fundhub_ad_number, "901", "our own ad number did not survive");

    // Newest first. Every fixture ad is written in one transaction and so shares
    // created_at exactly, which is why this asserts non-increasing rather than
    // strictly decreasing.
    const times = r.body.items.map((i) => new Date(i.created_at).getTime());
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] <= times[i - 1], "the list is not newest first");
    }
  });

  test("filtering by a label value narrows the list to that value", async () => {
    const r = await call(tokenStaff, { angle: "adspine_alpha", limit: "200" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.filters, { angle: "adspine_alpha" });
    assert.equal(r.body.items.length, 2, "the alpha filter did not return exactly the two alpha ads");
    for (const row of r.body.items) assert.equal(row.angle_key, "adspine_alpha");
  });

  // ── grouping ────────────────────────────────────────────────────────────

  test("grouping by angle gives one row per angle with the right count and the friendly name", async () => {
    const r = await call(tokenStaff, { group_by: "angle", limit: "200" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.group_by, "angle");

    const byKey = new Map(r.body.items.map((g) => [g.key, g]));
    assert.equal(byKey.size, r.body.items.length, "grouping returned the same angle more than once");

    const alpha = byKey.get("adspine_alpha");
    assert.ok(alpha, "the alpha angle did not come back as a group");
    assert.equal(alpha.ads, 2, "the two ads built from one angle did not group together");
    assert.equal(alpha.name, "Alpha Angle", "the friendly name did not come from ad_labels");

    // Beta has no dictionary row on purpose: a label groups whether or not
    // anybody has written it down, and its name is then null rather than "".
    const beta = byKey.get("adspine_beta");
    assert.ok(beta, "an angle with no dictionary row fell out of the grouping");
    assert.equal(beta.ads, 1);
    assert.strictEqual(beta.name, null, "an unnamed label got an invented name");
  });

  test("grouping by lane, hook, offer and script_type all work", async () => {
    for (const [groupBy, key] of [
      ["lane", "premium"],
      ["hook", "adspine_h1"],
      ["offer", "adspine_offer"],
      ["script_type", "cold"]
    ]) {
      const r = await call(tokenStaff, { group_by: groupBy, limit: "200" });
      assert.equal(r.code, 200, `${groupBy}: ${JSON.stringify(r.body)}`);
      const hit = r.body.items.find((g) => g.key === key);
      assert.ok(hit, `group_by=${groupBy} did not return a group for ${key}`);
      assert.ok(hit.ads >= 2, `group_by=${groupBy} counted ${hit.ads} ads for ${key}, expected at least 2`);
    }
  });

  test("a group and a filter combine — one group, and it is the one asked for", async () => {
    const r = await call(tokenStaff, { group_by: "angle", angle: "adspine_alpha" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.items.length, 1);
    assert.equal(r.body.items[0].key, "adspine_alpha");
    assert.equal(r.body.items[0].ads, 2);
  });

  test("an unknown group_by is the caller's mistake, not a server fault", async () => {
    const r = await call(tokenStaff, { group_by: "mechanism" });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, "invalid_group_by");
  });

  // ── unknown stays unknown ───────────────────────────────────────────────

  test("an ad with no creative still appears, with NULL labels — not dropped", async () => {
    const r = await call(tokenStaff, { limit: "200" });
    const naked = mine(r.body.items, "Adspine naked ad");
    assert.ok(naked, "an ad with no creative fell out of the endpoint entirely");

    for (const c of ["asset_id", "asset_kind", "asset_aspect_ratio", "duration_sec",
                     "script_id", "script_version", "parent_script_id", "script_title",
                     "script_type", "lane", "angle_key", "hook_key", "offer_key",
                     "hook_text", "fundhub_ad_number", "script_archived_at",
                     "asset_archived_at"]) {
      assert.strictEqual(naked[c], null,
        `${c} came back as ${JSON.stringify(naked[c])} instead of null for an ad with no creative`);
    }
    assert.notStrictEqual(naked.duration_sec, 0, "an unknown length became 0");
    assert.notStrictEqual(naked.script_type, "", "an unknown label became an empty string");
  });

  test("NULL survives the JSON body as null — the unlabelled ads are counted, not hidden", async () => {
    const r = await call(tokenStaff, { group_by: "angle", limit: "200" });
    const unlabelled = r.body.items.find((g) => g.key === null);
    assert.ok(unlabelled, "the ads nobody has labelled were dropped instead of grouped under null");
    assert.strictEqual(unlabelled.key, null, "the unknown group was keyed with something other than null");
    assert.strictEqual(unlabelled.name, null);
    // At least the naked fixture ad. Other unlabelled ads in the org land here
    // too, which is why this is "at least one" and not an exact number.
    assert.ok(unlabelled.ads >= 1, "the ad with no creative was not counted in the unknown group");

    // And the same value survives as null in the raw JSON, not as the string
    // "null" and not as an empty string.
    const asJson = JSON.parse(JSON.stringify(r.body));
    const again = asJson.items.find((g) => g.key === null);
    assert.ok(again, "null did not survive JSON serialisation of the response body");
  });

  // ── money and people ────────────────────────────────────────────────────

  /* group — one grouped call, returned as a map keyed by label so each test
     below reads as a sentence about one label. */
  async function group(query) {
    const r = await call(tokenStaff, { group_by: "angle", limit: "200", ...query });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    return { body: r.body, byKey: new Map(r.body.items.map((g) => [g.key, g])) };
  }

  test("spend adds up over the window, and the day rows do not multiply the ad count", async () => {
    const { body, byKey } = await group({ days: "30" });
    const alpha = byKey.get("adspine_alpha");
    assert.ok(alpha, "the alpha angle did not come back as a group");

    assert.strictEqual(alpha.spend_cents, 3000,
      `spend came back as ${alpha.spend_cents}, expected 1000 + 2000 = 3000 cents`);
    assert.strictEqual(alpha.impressions, 300);
    assert.strictEqual(alpha.clicks, 30);
    assert.strictEqual(alpha.ad_days_reported, 2, "the number of reported ad-days is wrong");

    // The bug this guards: joining a per-day table without count(DISTINCT) makes
    // an ad that ran two days look like two ads.
    assert.strictEqual(alpha.ads, 2, "the daily spend rows multiplied the ad count");
    assert.strictEqual(alpha.ads_with_number, 2);

    assert.equal(body.window.days, 30);
    assert.ok(body.window.from < body.window.to, "the window does not run forwards");
  });

  test("a label with no spend reported comes back NULL, and never 0", async () => {
    const { byKey } = await group({ days: "30" });
    const beta = byKey.get("adspine_beta");
    assert.ok(beta, "the beta angle did not come back as a group");

    // The whole point. Beta has no ad_metrics_daily row at all, so the honest
    // answer is "nobody told us", which is null. 0 would read as "we spent
    // nothing", which is a different fact.
    assert.strictEqual(beta.spend_cents, null,
      `an unknown spend came back as ${JSON.stringify(beta.spend_cents)} instead of null`);
    assert.notStrictEqual(beta.spend_cents, 0, "an unknown spend became 0");
    assert.strictEqual(beta.impressions, null);
    assert.strictEqual(beta.clicks, null);
    assert.strictEqual(beta.ad_days_reported, 0, "nothing was reported, so the day count is 0");

    // And it is still null once the body has been through JSON.
    const again = JSON.parse(JSON.stringify(beta));
    assert.strictEqual(again.spend_cents, null, "null spend did not survive JSON");
  });

  test("people are counted once each, and a leading zero still matches our ad number", async () => {
    const { byKey } = await group({ days: "30" });
    const alpha = byKey.get("adspine_alpha");

    // 12 = eleven typed as '901' plus the one typed as '0901-ringlights'. If the
    // join compared the two as text instead of as numbers this would be 11.
    assert.strictEqual(alpha.people, 12,
      `${alpha.people} people came back, expected 12 — a leading-zero ad number probably did not match`);

    // 11, not 12: one of the eleven booked twice, and a person who books twice is
    // still one person. The twelfth arrived and only ever cancelled.
    assert.strictEqual(alpha.people_booked, 11,
      `${alpha.people_booked} booked, expected 11 — a second booking by the same person was counted twice, or a cancelled booking was counted`);
  });

  test("cost per booked person refuses to divide on a tiny sample", async () => {
    const { byKey } = await group({ days: "30" });

    // Beta: one booked person, under MIN_N_RATE. A cost here would be noise
    // presented as fact, so there is no cost and there is a reason instead.
    const beta = byKey.get("adspine_beta");
    assert.strictEqual(beta.people, 2);
    assert.strictEqual(beta.people_booked, 1);
    assert.ok(beta.people_booked < MIN_N, "the fixture no longer sits under the threshold");
    assert.equal(beta.cost_per_booked_person.status, "INSUFFICIENT");
    assert.strictEqual(beta.cost_per_booked_person.cost_cents, null,
      "a cost was invented from one booked person");
    assert.ok(String(beta.cost_per_booked_person.note).length > 0,
      "the refusal came back with no reason a person could read");

    // Alpha: eleven booked people clears the threshold, so the division happens.
    const alpha = byKey.get("adspine_alpha");
    assert.ok(alpha.people_booked >= MIN_N);
    assert.equal(alpha.cost_per_booked_person.status, "MEASURED");
    assert.strictEqual(alpha.cost_per_booked_person.cost_cents, Math.round(3000 / 11),
      "spend divided by booked people gave the wrong answer");
  });

  test("the date window really filters — a wider window sees more money and more people", async () => {
    const { body, byKey } = await group({ days: "365" });
    const alpha = byKey.get("adspine_alpha");

    assert.equal(body.window.days, 365);

    // The 100-day-old spend row on ad 902 is inside a 365-day window and outside
    // a 30-day one. If this equals 3000 the window is being ignored.
    assert.strictEqual(alpha.spend_cents, 1002999,
      `spend over 365 days came back as ${alpha.spend_cents}, expected 3000 + 999999`);
    assert.strictEqual(alpha.ad_days_reported, 3);

    // Same for the lead who arrived 100 days ago.
    assert.strictEqual(alpha.people, 13, "the older lead was not picked up by the wider window");
    assert.strictEqual(alpha.people_booked, 12);
    assert.strictEqual(alpha.cost_per_booked_person.cost_cents, Math.round(1002999 / 12));
  });

  test("a group whose ads carry no number of ours says so, instead of reporting nobody", async () => {
    /* FILTERED TO THIS FIXTURE'S OWN GROUP, ON PURPOSE. This used to read the
       unlabelled (key null) group, which also collects every other ad in the org
       that has no creative — so a single stray ad with a number, anywhere in the
       company, made ads_with_number non-zero and quietly skipped the rule this
       test exists for. adspine_nonumber contains exactly one ad, this fixture's,
       and it has no number. The assertion runs every time now. */
    const { byKey } = await group({ days: "30", angle: "adspine_nonumber" });
    const g = byKey.get("adspine_nonumber");
    assert.ok(g, "the numberless fixture group did not come back");

    assert.strictEqual(g.ads, 1);
    assert.strictEqual(g.ads_with_number, 0, "the numberless fixture ad grew a number");

    // Nobody can be matched to this group even in principle, so people must be
    // null — "we cannot tell" — and not a 0 somebody would read as "nobody came".
    assert.strictEqual(g.people, null,
      "a group in which no ad carries our number reported 0 people instead of null");
    assert.strictEqual(g.people_booked, null);

    // And the cost says nobody could be matched, rather than claiming zero booked.
    assert.equal(g.cost_per_booked_person.status, "INSUFFICIENT");
    assert.strictEqual(g.cost_per_booked_person.cost_cents, null);
    assert.strictEqual(g.cost_per_booked_person.n, null,
      "an unmeasurable group claimed a booked count of 0");
    assert.match(g.cost_per_booked_person.note, /number/i);
  });

  test("the two numbers that cover different periods are told apart", async () => {
    const { byKey } = await group({ days: "30" });

    // Alpha has two ads for all time; only one of them reported a day inside a
    // 30-day window. Without this companion the row reads "2 ads, spend 3000".
    const alpha = byKey.get("adspine_alpha");
    assert.strictEqual(alpha.ads, 2);
    assert.strictEqual(alpha.ads_reported_in_window, 1,
      "the number of ads that actually reported inside the window is wrong");

    // Beta reported nothing at all, so nothing reported in the window either.
    const beta = byKey.get("adspine_beta");
    assert.strictEqual(beta.ads, 1);
    assert.strictEqual(beta.ads_reported_in_window, 0);

    // A wider window picks the second alpha ad up.
    const wide = await group({ days: "365" });
    assert.strictEqual(wide.byKey.get("adspine_alpha").ads_reported_in_window, 2);
  });

  test("the response says how many people were captured at all, so a zero can be judged", async () => {
    const { body } = await group({ days: "30" });

    /* people_rows_in_window counts every client_ad_attribution row in the window
       for the whole company, ad or no ad. The fixture writes 15 of them and 14
       are inside 30 days, so this is at least 14 — "at least", because the org
       may hold other real rows. If it were 0 while groups reported people, the
       capture would be broken and every people number would be meaningless. */
    assert.equal(typeof body.people_rows_in_window, "number",
      "the response did not say how many people were captured");
    assert.ok(body.people_rows_in_window >= 14,
      `only ${body.people_rows_in_window} attribution rows were seen in 30 days, expected at least 14`);

    const wide = await group({ days: "365" });
    assert.ok(wide.body.people_rows_in_window > body.people_rows_in_window,
      "a wider window did not see the lead who arrived 100 days ago");
  });

  test("hook rate and hold rate are worked out from the days asked for", async () => {
    const { byKey } = await group({ days: "30" });
    const alpha = byKey.get("adspine_alpha");

    // The raw counts first, so a failure below says which half went wrong.
    assert.strictEqual(alpha.impressions, 300);
    assert.strictEqual(alpha.video_continuous_2s_watched, 100,
      "the past-the-opening views did not add up over the window");
    assert.strictEqual(alpha.video_p75_watched, 30);

    // hook rate = past-the-opening views over impressions. Did the opening stop
    // them. Not Ads Manager's hook rate — Meta has no 3-second field.
    assert.equal(alpha.hook_rate.status, "MEASURED");
    assert.strictEqual(alpha.hook_rate.rate, 0.3333,
      `hook rate came back as ${alpha.hook_rate.rate}, expected 100/300 rounded`);

    // hold rate = p75 over past-the-opening views. Did the middle keep them.
    assert.equal(alpha.hold_rate.status, "MEASURED");
    assert.strictEqual(alpha.hold_rate.rate, 0.3,
      `hold rate came back as ${alpha.hold_rate.rate}, expected 30/100`);
  });

  test("A PHOTO AD THAT RAN HAS NO HOOK RATE — it must not read as zero", async () => {
    /* THE CASE WORTH BREAKING THE BUILD OVER. The numberless fixture ad reported
       30000 impressions and no video numbers at all, because it is a photo. A
       hook rate of 0 beside it would make a working ad look like the worst one
       in the account, and there would be no error anywhere saying so. */
    const { byKey } = await group({ days: "30", angle: "adspine_nonumber" });
    const g = byKey.get("adspine_nonumber");
    assert.ok(g, "the photo-ad fixture group did not come back");

    assert.strictEqual(g.impressions, 30000, "the photo ad did not report its impressions");
    assert.strictEqual(g.video_continuous_2s_watched, null, "a photo ad reported video views");
    assert.strictEqual(g.hook_rate.rate, null,
      `a photo ad reported a hook rate of ${JSON.stringify(g.hook_rate.rate)}`);
    assert.notStrictEqual(g.hook_rate.rate, 0, "an unknown hook rate became zero");
    assert.strictEqual(g.hold_rate.rate, null);

    // And null survives the JSON body rather than turning into 0 or "".
    const again = JSON.parse(JSON.stringify(g));
    assert.strictEqual(again.hook_rate.rate, null, "a null hook rate did not survive JSON");
    assert.strictEqual(again.video_continuous_2s_watched, null);
  });

  test("a label with no reported day has no rates and no video counts", async () => {
    const { byKey } = await group({ days: "30" });
    const beta = byKey.get("adspine_beta");
    assert.strictEqual(beta.video_continuous_2s_watched, null);
    assert.strictEqual(beta.video_p75_watched, null);
    assert.strictEqual(beta.hook_rate.rate, null);
    assert.strictEqual(beta.hold_rate.rate, null);
  });

  test("a wider window mixes a video ad and a photo ad without inventing zeros", async () => {
    /* Over 365 days alpha holds both ads: the video one (100 people kept
       watching past the opening, across 300 impressions) and the photo one
       (5000 impressions, no video). Postgres's sum() skips the NULLs, so the
       past-the-opening total stays 100 while impressions climb to 5300. That is
       the honest reading — "of everything we were told" — and it is only correct
       because nothing coalesces. */
    const { byKey } = await group({ days: "365" });
    const alpha = byKey.get("adspine_alpha");

    assert.strictEqual(alpha.impressions, 5300);
    assert.strictEqual(alpha.video_continuous_2s_watched, 100,
      "the photo ad's missing video count was read as 0 and folded into the total");
    assert.strictEqual(alpha.hook_rate.rate, Math.round((100 / 5300) * 10000) / 10000);
  });

  test("a bad days value is the caller's mistake, not a silent substitution", async () => {
    for (const bad of ["banana", "0", "-5", "366", "1.5"]) {
      const r = await call(tokenStaff, { group_by: "angle", days: bad });
      assert.equal(r.code, 400, `days=${bad} was accepted instead of refused`);
      assert.equal(r.body.error, "invalid_days");
    }
  });

  test("the plain list is unchanged — no window, no money bolted onto it", async () => {
    const r = await call(tokenStaff, { limit: "200" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.window, null, "the list grew a date window it does not filter by");
    assert.strictEqual(r.body.people_rows_in_window, null,
      "the list reported a people count for a window it never applied");

    const row = mine(r.body.items, "Adspine alpha 1");
    assert.ok(row, "the fixture ad fell out of the list");
    assert.equal(row.spend_cents, undefined, "the list grew a spend column");
    assert.equal(row.people, undefined, "the list grew a people column");
  });
});
