// 416 against real Postgres: one ad number on many Meta ads, where each number
// came from, and the owner-set UTMs read back by the database.
//
// ⚠️ WRITTEN ON A MAC WITH NO POSTGRES (2026-10-05). With DATABASE_URL unset
// the whole describe block SKIPS, and a skipped .pg.test.mjs is NOT green
// (CLAUDE.md §12). It runs in CI ("tests" workflow, fresh pgvector Postgres 16,
// every migration applied) and on any scratch database. Never point it at
// production: it writes ads, clients and visitor rows, and step 3 re-runs the
// 416 file inside a transaction it rolls back.
//
// WHAT IT PROVES, IN ORDER
//   1. The shape: ads_fundhub_number_uq is gone; ads_fundhub_number_idx is a
//      plain (not unique) index on (org_id, fundhub_ad_number) WHERE NOT NULL;
//      fundhub_ad_number_source is a nullable text column with its CHECK.
//   2. Two ads rows may share one number — in two ad sets, and in one.
//   3. The source CHECK takes manual | loader | utm | name | NULL and refuses
//      anything else. A row numbered before 416 reads 'manual' once 416 runs;
//      a source already set is kept; a row with no number stays NULL.
//   4. The UTMs from buildUrlTags (src/marketing/url-tags.mjs) through the real
//      SQL: fundhub_ad_id(utm_content) is the number, fundhub_ad_lane() the
//      lane, fundhub_ad_variant() the variant — and a visitor row carrying them
//      gets that number and lane from the 407 trigger.
//   5. 407 still resolves a Meta ad by ad set + name when its number is shared
//      with another Meta ad in another ad set.
//
// WHO EACH QUERY RUNS AS. ads, ad_sets, campaigns and ad_platform_connections
// carry FORCEd row-level security, so they go through asStaff(). clients and
// client_ad_attribution (USING (true)) use the plain pool, as in
// src/http/ad-number.pg.test.mjs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { asStaff } from "../partners/rls.mjs";
import { buildUrlTags, URL_TAG_LANES } from "../marketing/url-tags.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG = "adnumsrc-pg-test";
const NONCE = `adnumsrc-${process.pid}-${Date.now()}`;
const mail = (tag) => `${NONCE}.${tag}@example.com`.toLowerCase();

const SQL_416 = readFileSync(
  new URL("../../db/migrations/416_ads_number_index_and_source.sql", import.meta.url), "utf8");

/* Made-up Meta ids, all starting with 9 like the case table's. */
const SET_A = "916000000000000001";
const SET_B = "916000000000000002";

const tagsOf = (s) => Object.fromEntries(new URLSearchParams(s));

describe("416: one ad number on many Meta ads, and where each number came from",
  { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId, connId, campId, setA, setB;
  let seq = 0;

  async function newAd(tx, { setId = setA, name, number = null, source = null, externalId } = {}) {
    seq += 1;
    return (await tx.query(
      `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id,
                        name, approval_state, fundhub_ad_number, fundhub_ad_number_source, external_id)
       VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9)
       RETURNING id, fundhub_ad_number, fundhub_ad_number_source`,
      [org, partnerId, connId, campId, setId, name ?? `U14 ad ${seq}`, number, source,
       externalId ?? `9160000000000${String(1000 + seq)}`]
    )).rows[0];
  }

  const readAd = async (id) => (await asStaff((tx) => tx.query(
    `SELECT fundhub_ad_number, fundhub_ad_number_source FROM ads WHERE id = $1`, [id]
  ))).rows[0];

  async function newClient(tag) {
    return (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,'Ad','Source') RETURNING id`,
      [org, mail(tag)]
    )).rows[0].id;
  }

  async function visitor(tag, tags) {
    const clientId = await newClient(tag);
    await db.query(
      `INSERT INTO client_ad_attribution
         (client_id, org_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [clientId, org, tags.utm_source ?? null, tags.utm_medium ?? null,
       tags.utm_campaign ?? null, tags.utm_content ?? null, tags.utm_term ?? null]
    );
    return (await db.query(
      `SELECT ad_id, lane::text AS lane, variant FROM client_ad_attribution WHERE client_id = $1`,
      [clientId]
    )).rows[0];
  }

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
    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, contact_email, agreement_signed_at)
       VALUES ($1,'Ad number source fixture',$2,'active',$3,now())
       ON CONFLICT (org_id, slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [org, SLUG, `partner.${SLUG}@example.com`]
    )).rows[0].id;
    await cleanup();

    // offer_type 'funding' is seeded into ad_platform_category_map (052), so the
    // campaign guard trigger (046) lets it through — same chain as
    // src/http/ad-asset-link.pg.test.mjs.
    await asStaff(async (tx) => {
      connId = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'meta',$3,'active','approved','v1:x:y:z') RETURNING id`,
        [org, partnerId, `act_${SLUG}`]
      )).rows[0].id;
      campId = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type,
                                budget_cents, approval_state)
         VALUES ($1,$2,$3,'U14 campaign','funding',10000,'draft') RETURNING id`,
        [org, partnerId, connId]
      )).rows[0].id;
      const set = (externalId, name) => tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, external_id, name,
                              budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,$5,$6,10000,'draft') RETURNING id`,
        [org, partnerId, connId, campId, externalId, name]
      ).then((r) => r.rows[0].id);
      setA = await set(SET_A, "U14 ad set A");
      setB = await set(SET_B, "U14 ad set B");
    });
  });

  after(async () => { await cleanup(); await close(); });

  // ── 1. the shape ──────────────────────────────────────────────────────────

  test("the unique index is gone and a plain index on the same columns took its place", async () => {
    const idx = (await db.query(
      `SELECT c.relname AS name, i.indisunique AS unique_, pg_get_indexdef(i.indexrelid) AS def,
              pg_get_expr(i.indpred, i.indrelid) AS pred
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE i.indrelid = 'public.ads'::regclass
          AND c.relname IN ('ads_fundhub_number_uq', 'ads_fundhub_number_idx')`
    )).rows;
    assert.deepEqual(idx.map((r) => r.name), ["ads_fundhub_number_idx"],
      "ads_fundhub_number_uq is still there, or the plain index is missing — 416 has not been applied");
    const [plain] = idx;
    assert.equal(plain.unique_, false);
    assert.match(plain.def, /\(org_id, fundhub_ad_number\)/);
    assert.match(plain.pred, /fundhub_ad_number IS NOT NULL/);
  });

  test("fundhub_ad_number_source is nullable text with no default", async () => {
    const col = (await db.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ads'
          AND column_name = 'fundhub_ad_number_source'`
    )).rows[0];
    assert.ok(col, "416 has not been applied here");
    assert.equal(col.data_type, "text");
    assert.equal(col.is_nullable, "YES");
    assert.equal(col.column_default, null, "a default would claim a source nobody set");
  });

  // ── 2. one number, many ads ───────────────────────────────────────────────

  test("two ads rows may share one number — in two ad sets and in one", async () => {
    const rows = await asStaff(async (tx) => [
      await newAd(tx, { setId: setA, number: "916", source: "loader" }),
      await newAd(tx, { setId: setB, number: "916", source: "loader" }),
      await newAd(tx, { setId: setA, number: "916", source: "manual" })
    ]);
    assert.deepEqual(rows.map((r) => r.fundhub_ad_number), ["916", "916", "916"]);

    const n = (await asStaff((tx) => tx.query(
      `SELECT count(*)::int AS n FROM ads WHERE org_id = $1 AND partner_id = $2 AND fundhub_ad_number = '916'`,
      [org, partnerId]
    ))).rows[0].n;
    assert.equal(n, 3);
  });

  test("the number's own CHECK still refuses a Meta-length id (377 is unchanged)", async () => {
    await assert.rejects(
      () => asStaff((tx) => newAd(tx, { number: "120253626574340264" })),
      /ads_fundhub_ad_number_ck/
    );
  });

  // ── 3. the source ─────────────────────────────────────────────────────────

  test("the source CHECK takes the four sources and NULL", async () => {
    for (const source of ["manual", "loader", "utm", "name", null]) {
      const ad = await asStaff((tx) => newAd(tx, { number: source ? "917" : null, source }));
      assert.equal(ad.fundhub_ad_number_source, source);
    }
  });

  test("the source CHECK refuses any other value", async () => {
    for (const source of ["guess", "MANUAL", "", "sync", "import"]) {
      await assert.rejects(
        () => asStaff((tx) => newAd(tx, { number: "917", source })),
        /ads_fundhub_ad_number_source_ck/,
        `source ${JSON.stringify(source)} was accepted`
      );
    }
    const ad = await asStaff((tx) => newAd(tx, { number: "917", source: "manual" }));
    await assert.rejects(
      () => asStaff((tx) => tx.query(
        `UPDATE ads SET fundhub_ad_number_source = 'closest' WHERE id = $1`, [ad.id])),
      /ads_fundhub_ad_number_source_ck/
    );
    assert.equal((await readAd(ad.id)).fundhub_ad_number_source, "manual");
  });

  test("a number set before 416 reads manual once 416 runs; a set source is kept", async () => {
    // A row the way it looked before 416: a number, no source. Then 416 runs
    // again (every statement in it is safe to repeat) inside this transaction,
    // which is rolled back so nothing else in the database is touched.
    const ROLL_BACK = new Error("roll back the 416 re-run");
    let seen = null;
    await assert.rejects(
      () => asStaff(async (tx) => {
        const old = await newAd(tx, { number: "918", source: null });
        const loaded = await newAd(tx, { number: "918", source: "loader" });
        const bare = await newAd(tx, { number: null, source: null });
        assert.equal(old.fundhub_ad_number_source, null, "fixture: a pre-416 row has no source");

        await tx.query(SQL_416);

        const read = async (id) => (await tx.query(
          `SELECT fundhub_ad_number_source AS s FROM ads WHERE id = $1`, [id])).rows[0].s;
        seen = { old: await read(old.id), loaded: await read(loaded.id), bare: await read(bare.id) };
        const still = (await tx.query(
          `SELECT indisunique FROM pg_index WHERE indexrelid = 'public.ads_fundhub_number_idx'::regclass`
        )).rows[0];
        seen.unique = still.indisunique;
        throw ROLL_BACK;
      }),
      (err) => err === ROLL_BACK
    );
    assert.deepEqual(seen, { old: "manual", loaded: "loader", bare: null, unique: false });
  });

  // ── 4. the owner-set UTMs, read by the real SQL ───────────────────────────

  test("fundhub_ad_id(utm_content) from buildUrlTags is the ad number, for every lane", async () => {
    for (const lane of URL_TAG_LANES) {
      for (const adNumber of ["1", "91", "123456789"]) {
        const t = tagsOf(buildUrlTags({ lane, adNumber }));
        const r = (await db.query(
          `SELECT fundhub_ad_id($1) AS ad_id, fundhub_ad_lane($2)::text AS lane`,
          [t.utm_content, t.utm_campaign]
        )).rows[0];
        assert.equal(r.ad_id, adNumber, `${lane} ${adNumber}`);
        assert.equal(r.lane, lane, `${lane}: fundhub_ad_lane() does not know this lane`);
      }
    }
  });

  test("the variant is stored exactly as buildUrlTags wrote it", async () => {
    const t = tagsOf(buildUrlTags({ lane: "slo", adNumber: "91", variant: "Sun Burst / V2" }));
    const r = (await db.query(`SELECT fundhub_ad_variant($1) AS v`, [t.utm_term])).rows[0];
    assert.equal(r.v, t.utm_term);
  });

  test("a visitor from a loaded ad gets its number and lane from the 407 trigger", async () => {
    // The number is on two ads rows; the visitor row reads the leading digits
    // of utm_content and never needs the ads table to be unique.
    await asStaff(async (tx) => {
      await newAd(tx, { setId: setA, number: "919", source: "loader" });
      await newAd(tx, { setId: setB, number: "919", source: "loader" });
    });
    const row = await visitor("click", tagsOf(buildUrlTags({ lane: "slo", adNumber: "919", variant: "sun" })));
    assert.deepEqual(row, { ad_id: "919", lane: "slo", variant: "sun" });

    const noVariant = await visitor("click2", tagsOf(buildUrlTags({ lane: "uwiq", adNumber: "919" })));
    assert.deepEqual(noVariant, { ad_id: "919", lane: "uwiq", variant: null });
  });

  // ── 5. 407 still works with a shared number ───────────────────────────────

  test("407's ad set + name match still answers when the number is on two Meta ads", async () => {
    const name = "U14 shared — roadmap";
    await asStaff(async (tx) => {
      await newAd(tx, { setId: setA, name, number: "920", source: "loader" });
      await newAd(tx, { setId: setB, name, number: "920", source: "loader" });
    });
    const r = (await db.query(
      `SELECT fundhub_meta_ad_number($1, $2, $3) AS a, fundhub_meta_ad_number($1, $4, $3) AS b`,
      [org, SET_A, name, SET_B]
    )).rows[0];
    assert.deepEqual(r, { a: "920", b: "920" });

    const row = await visitor("meta-name", { utm_source: "fb", utm_content: name, utm_term: SET_B });
    assert.equal(row.ad_id, "920");
  });
});
