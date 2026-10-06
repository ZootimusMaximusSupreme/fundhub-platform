// The daily Meta sync stores each ad's Fundhub number — against real Postgres.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §10.5 "Sync mapping"
// (marketing machine unit U27). api/campaigns/sync.mjs asks Meta for every ad's
// creative{url_tags} and gives the saved `ads` row the number its url_tags or
// its name carries (mapAdNumber, src/ads/ad-number.mjs), with
// ads.fundhub_ad_number_source 'utm' or 'name' (416).
//
// ⚠️ NEVER EXECUTED WHERE IT WAS WRITTEN. There is no Postgres on the Mac this
// was written on (2026-10-06), so with DATABASE_URL unset the whole describe
// block SKIPS. A skipped .pg.test.mjs is NOT green (CLAUDE.md §12). It runs in
// CI ("tests" workflow, a fresh database built by db/migrate.mjs) and on any
// machine with a scratch database. Never point it at production: it adds and
// drops a CHECK constraint on `ads`.
//
// WHAT IT PROVES
//   1. utm_content "91" in url_tags → 91, source utm.
//   2. The name "SLO Ad 92 — x" with no url_tags → 92, source name.
//   3. The live ads' shape — utm_content={{ad.name}}, names like "oVid: SLO1",
//      or no creative at all — gives no number. Nothing is guessed.
//   4. A number write the database refuses is counted in the sync's stats,
//      never thrown: that ad is saved without a number, the ads after it still
//      get theirs, its day of numbers is saved, and the campaign commits.
//   5. A 'manual' number is never overwritten. The same number keeps the source
//      it had ('loader'). A number nobody typed follows Meta.
//   6. The visitor re-match (reresolveAdNumbers, 407) still runs after the
//      sync, and finds a visitor's number from the number the sync just wrote.
//
// HOW (4) IS MADE TO FAIL. mapAdNumber never returns a number the table's own
// shape check refuses, so the test adds a CHECK constraint of its own, NOT
// VALID, that refuses one sentinel number (987654321), and drops it again. The
// pg files run one at a time (scripts/run-suite.mjs, --test-concurrency=1), so
// no other file can meet it. This needs the table owner, which is how CI runs
// the suite (tests.yml: "~14 suites … require table ownership").
//
// WHO EACH QUERY RUNS AS. ads, ad_sets, campaigns, ad_metrics_daily and
// ad_platform_connections carry FORCEd row-level security, so they go through
// asStaff(). clients carries none, and client_ad_attribution carries USING
// (true), so those use the plain pool — the same split as ad-number.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { asStaff } from "../partners/rls.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";
import { syncPartnerConnections } from "../../api/campaigns/sync.mjs";
import { phoenixDay } from "../slo/visitor.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG = "adnumber-sync-pg-test";
const NONCE = `adnumsync-${process.pid}-${Date.now()}`;
const mail = (tag) => `${NONCE}.${tag}@example.com`.toLowerCase();

/* The test-only refusal for proof 4. */
const REFUSED = "987654321";
const REFUSE_CK = "ads_u27_test_refuses_ck";

const CAMPAIGN = "u27-camp-1";
const SET = "120270000000027101";        // digits: a visitor's utm_term can name it
const DAY = phoenixDay(new Date(Date.now() - 864e5));

const tags = (content, campaign = "funding600") =>
  `utm_source=fb&utm_medium=paid&utm_campaign=${campaign}&utm_content=${content}`;
const LIVE_TAGS = "utm_source=fb&utm_medium=paid&utm_campaign=sorting" +
  "&utm_content={{ad.name}}&utm_term={{adset.id}}";

/* What Meta says about each ad. Changed between the two syncs below.
   ORDER MATTERS: the refused ad is first, so every ad after it proves the
   campaign's transaction was not left aborted by the refusal. */
let META_ADS = [];
const round1Ads = () => [
  { id: "u27-fail", name: "U27 refused number", creative: { id: "cr-f", url_tags: tags(REFUSED) } },
  { id: "u27-a91", name: "U27 fresh angle", creative: { id: "cr-91", url_tags: tags(91) } },
  { id: "u27-a92", name: "SLO Ad 92 — x", creative: { id: "cr-92" } },
  { id: "u27-live1", name: "oVid: SLO1", creative: { id: "cr-l1", url_tags: LIVE_TAGS } },
  { id: "u27-live2", name: "oVid: SLO2" },
  { id: "u27-man", name: "U27 typed by a person", creative: { id: "cr-m", url_tags: tags(94) } }
];

const metaUrls = [];
const fakeFetch = async (url) => {
  const u = String(url);
  metaUrls.push(u);
  let payload = { data: [] };
  if (u.includes("/insights?")) {
    payload = {
      data: [
        { ad_id: "u27-fail", date_start: DAY, spend: "3.21", impressions: "40", clicks: "2" },
        { ad_id: "u27-a91", date_start: DAY, spend: "5.00", impressions: "60", clicks: "3" }
      ]
    };
  } else if (u.includes("/campaigns?")) {
    payload = { data: [{ id: CAMPAIGN, name: "U27 sync mapping fixture", status: "PAUSED" }] };
  } else if (u.includes("/adsets?")) {
    payload = { data: [{ id: SET, name: "U27 set", status: "PAUSED", campaign_id: CAMPAIGN }] };
  } else if (u.includes(`/${SET}/ads?`)) {
    payload = { data: META_ADS.map((a) => ({ ...a, status: "PAUSED", adset_id: SET })) };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
};

describe("the Meta sync stores each ad's number (spec §10.5)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId;

  const dropRefusal = () => db.query(`ALTER TABLE ads DROP CONSTRAINT IF EXISTS ${REFUSE_CK}`);

  async function visitor(tag, t) {
    const clientId = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,'Ad','Sync') RETURNING id`,
      [org, mail(tag)]
    )).rows[0].id;
    await db.query(
      `INSERT INTO client_ad_attribution (client_id, org_id, utm_source, utm_campaign, utm_content, utm_term)
       VALUES ($1,$2,'fb',$3,$4,$5)`,
      [clientId, org, t.utm_campaign ?? null, t.utm_content ?? null, t.utm_term ?? null]
    );
    return clientId;
  }

  const visitorNumber = async (clientId) => (await db.query(
    `SELECT ad_id FROM client_ad_attribution WHERE client_id = $1`, [clientId])).rows[0]?.ad_id ?? null;

  /* Our ads rows for this fixture, keyed by Meta's ad id. */
  const adRows = () => asStaff((tx) => tx.query(
    `SELECT external_id, name, fundhub_ad_number, fundhub_ad_number_source
       FROM ads WHERE partner_id = $1`, [partnerId]
  )).then((r) => Object.fromEntries(r.rows.map((x) => [x.external_id, x])));

  const numberOf = (rows, metaId) => ({
    number: rows[metaId]?.fundhub_ad_number ?? null,
    source: rows[metaId]?.fundhub_ad_number_source ?? null
  });

  async function cleanup() {
    await db.query(`DELETE FROM clients WHERE org_id = $1 AND email LIKE $2`, [org, `${NONCE}%`]);
    if (partnerId) {
      await asStaff(async (tx) => {
        for (const t of ["ad_metrics_daily", "ads", "ad_sets", "campaigns"]) {
          await tx.query(`DELETE FROM ${t} WHERE partner_id = $1`, [partnerId]);
        }
        await tx.query(`DELETE FROM ad_platform_connections WHERE partner_id = $1`, [partnerId]);
      });
    }
  }

  before(async () => {
    org = await resolveDefaultOrg(db);
    if (!process.env.AD_TOKEN_ENC_KEY) {
      // A run-local key: this suite encrypts a fake token and reads it back.
      process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
    }
    await dropRefusal();   // a run that died before after() left it behind
    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, contact_email, agreement_signed_at)
       VALUES ($1,'Ad number sync fixture',$2,'active',$3,now())
       ON CONFLICT (org_id, slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [org, SLUG, `partner.${SLUG}@example.com`]
    )).rows[0].id;
    await cleanup();
    await asStaff((tx) => tx.query(
      `INSERT INTO ad_platform_connections
         (org_id, partner_id, platform, external_ad_account_id, connection_state,
          platform_verification_state, encrypted_access_token)
       VALUES ($1,$2,'meta',$3,'active','approved',$4)`,
      [org, partnerId, `act_${SLUG}`, encryptToken("fake-meta-user-token", { partnerId })]
    ));
  });

  after(async () => {
    try { await dropRefusal(); } finally { await cleanup(); await close(); }
  });

  test("the shape this relies on: 416's source column and its four values", async () => {
    const r = await db.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.ads'::regclass AND conname = 'ads_fundhub_ad_number_source_ck'`
    );
    assert.equal(r.rows.length, 1, "416 has not been applied here");
    for (const v of ["manual", "loader", "utm", "name"]) assert.match(r.rows[0].def, new RegExp(`'${v}'`));
  });

  // These run in order: the second sync starts from what the first one saved.

  let early91, earlyLive;

  test("first sync: 91 from utm, 92 from the name, nothing for the live ads, one refusal counted", async () => {
    // Visitors who clicked before the ads were copied in. Live-style tags: the
    // ad's name in utm_content, the ad set id in utm_term (407 matches them).
    early91 = await visitor("a91", { utm_campaign: "funding600", utm_content: "U27 fresh angle", utm_term: SET });
    earlyLive = await visitor("live1", { utm_campaign: "sorting", utm_content: "oVid: SLO1", utm_term: SET });
    assert.equal(await visitorNumber(early91), null, "no ads yet, so no number");

    await db.query(
      `ALTER TABLE ads ADD CONSTRAINT ${REFUSE_CK}
         CHECK (fundhub_ad_number IS DISTINCT FROM '${REFUSED}') NOT VALID`
    );
    META_ADS = round1Ads();
    metaUrls.length = 0;
    let stats;
    try {
      stats = await syncPartnerConnections({ partnerId, deps: { fetch: fakeFetch } });
    } finally {
      await dropRefusal();
    }

    // The ads request asked Meta for creative{url_tags}.
    const adsCall = metaUrls.find((u) => u.includes(`/${SET}/ads?`));
    assert.ok(adsCall, "the ads were never asked for");
    assert.equal(new URL(adsCall).searchParams.get("fields"), "id,name,status,adset_id,creative{url_tags}");

    // (4) The refusal was counted, not thrown, and cost nothing else.
    assert.deepEqual(stats.errors, [], `a number refusal became a sync failure: ${JSON.stringify(stats.errors)}`);
    assert.equal(stats.campaigns, 1, "the campaign did not commit");
    assert.equal(stats.ads, 6);
    assert.equal(stats.ad_number_map.failed, 1, JSON.stringify(stats.ad_number_map));
    assert.equal(stats.ad_number_map.failures[0].ad, "u27-fail");
    assert.match(stats.ad_number_map.failures[0].error, new RegExp(REFUSE_CK));
    assert.equal(stats.ad_number_map.set, 3, JSON.stringify(stats.ad_number_map));
    assert.equal(stats.ad_number_map.none, 2, JSON.stringify(stats.ad_number_map));

    const rows = await adRows();
    assert.equal(Object.keys(rows).length, 6, "an ad row was lost");
    assert.deepEqual(numberOf(rows, "u27-fail"), { number: null, source: null });
    assert.equal(rows["u27-fail"].name, "U27 refused number", "the refused ad was not saved");

    // (1) and (2)
    assert.deepEqual(numberOf(rows, "u27-a91"), { number: "91", source: "utm" });
    assert.deepEqual(numberOf(rows, "u27-a92"), { number: "92", source: "name" });
    assert.deepEqual(numberOf(rows, "u27-man"), { number: "94", source: "utm" });
    // (3)
    assert.deepEqual(numberOf(rows, "u27-live1"), { number: null, source: null });
    assert.deepEqual(numberOf(rows, "u27-live2"), { number: null, source: null });

    // The refused ad's day of numbers landed: the transaction committed.
    const days = await asStaff((tx) => tx.query(
      `SELECT a.external_id, m.spend_cents FROM ad_metrics_daily m JOIN ads a ON a.id = m.ad_id
        WHERE a.partner_id = $1 AND m.date = $2::date ORDER BY a.external_id`,
      [partnerId, DAY]
    )).then((r) => r.rows);
    assert.deepEqual(days.map((d) => [d.external_id, Number(d.spend_cents)]),
      [["u27-a91", 500], ["u27-fail", 321]]);

    // (6) The visitor re-match ran after the numbers were written.
    assert.equal(stats.ad_numbers.error, undefined, String(stats.ad_numbers.error));
    assert.ok(stats.ad_numbers.filled >= 1, JSON.stringify(stats.ad_numbers));
    assert.equal(await visitorNumber(early91), "91", "the visitor did not get the number the sync just wrote");
    assert.equal(await visitorNumber(earlyLive), null, "a live-style ad with no number gave its visitor one");
  });

  test("second sync: manual is never overwritten, the same number keeps 'loader', others follow Meta", async () => {
    // A person types 93 on one ad (what link-asset does); the loader owns 91.
    await asStaff(async (tx) => {
      await tx.query(
        `UPDATE ads SET fundhub_ad_number = '93', fundhub_ad_number_source = 'manual'
          WHERE partner_id = $1 AND external_id = 'u27-man'`, [partnerId]);
      await tx.query(
        `UPDATE ads SET fundhub_ad_number_source = 'loader'
          WHERE partner_id = $1 AND external_id = 'u27-a91'`, [partnerId]);
    });

    // Meta now says 97 in the url_tags of the ad that was numbered by its name.
    META_ADS = round1Ads().map((a) => (a.id === "u27-a92"
      ? { ...a, creative: { id: "cr-92", url_tags: tags(97) } }
      : a));
    const stats = await syncPartnerConnections({ partnerId, deps: { fetch: fakeFetch } });
    assert.deepEqual(stats.errors, [], JSON.stringify(stats.errors));

    const rows = await adRows();
    // (5) The person's number stands, even though Meta still says 94.
    assert.deepEqual(numberOf(rows, "u27-man"), { number: "93", source: "manual" });
    // The same number is not re-stamped.
    assert.deepEqual(numberOf(rows, "u27-a91"), { number: "91", source: "loader" });
    // A number nobody typed follows Meta: utm wins over the name.
    assert.deepEqual(numberOf(rows, "u27-a92"), { number: "97", source: "utm" });
    // The refusal is gone, so the next sync stores the number it could not before.
    assert.deepEqual(numberOf(rows, "u27-fail"), { number: REFUSED, source: "utm" });
    assert.deepEqual(numberOf(rows, "u27-live1"), { number: null, source: null });

    assert.deepEqual(stats.ad_number_map,
      { set: 2, kept_manual: 1, same: 1, none: 2, failed: 0, failures: [] });
  });
});
