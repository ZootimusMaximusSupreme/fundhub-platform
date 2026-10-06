// Ad numbers from Meta tags (407), Meta's money numbers (408) and payments in
// the ad roll-up — against real Postgres.
//
// ⚠️ NEVER EXECUTED WHERE IT WAS WRITTEN. There is no Postgres on the Mac this
// was written on (2026-10-05), so with DATABASE_URL unset the whole describe
// block SKIPS. A skipped .pg.test.mjs is NOT green (CLAUDE.md §12). Nothing
// below has been observed passing. It runs in CI ("tests" workflow) and on any
// machine with a scratch database. Never point it at production.
//
// WHAT IT PROVES, IN ORDER
//   1. The shape: ad_id is no longer GENERATED, the trigger is there, ad_lane
//      has `slo`, ad_metrics_daily has the four 408 columns, nullable, no default.
//   2. One sync against a fake Meta copies the ads in and stores purchases,
//      cost per purchase, link clicks and landing page views — NULL where Meta
//      sent no line, never 0. A visitor who clicked BEFORE the ad had a number
//      gets it on the next sync.
//   3. The shared case table (src/ads/ad-number-cases.mjs) through the real
//      trigger: match, no match stays NULL, ambiguous stays NULL, leading digits
//      still win — and the JS mirror gives the same answer for every case.
//   4. The app cannot write ad_id; a found number survives an ad rename; the
//      roadmap campaign reads lane `slo`.
//   5. A paid order counts for the ad on the paying client's row; demo and
//      unpaid orders do not; bookings and payments do not multiply.
//
// WHO EACH QUERY RUNS AS. ads, ad_sets, campaigns, ad_metrics_daily and
// ad_platform_connections carry FORCEd row-level security, so they go through
// asStaff(). clients carries none, and client_ad_attribution, bookings and
// payment_links carry USING (true), so those use the plain pool.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { asStaff } from "../partners/rls.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";
import { syncPartnerConnections } from "../../api/campaigns/sync.mjs";
import { adAttributionRollup, upsertClientAdAttribution, reresolveAdNumbers } from "../ads/store.mjs";
import { adNumberOf } from "../ads/ad-number.mjs";
import {
  ADS, CASES, ORG_A, SLO_SET, AUGUST_SET, DUP_SET
} from "../ads/ad-number-cases.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG = "adnumber-pg-test";
const NONCE = `adnum-${process.pid}-${Date.now()}`;
const mail = (tag) => `${NONCE}.${tag}@example.com`.toLowerCase();

/* The ads the fake Meta hands back: every case-table ad in the three ad sets
   the database fixture can hold (one connection; no second company). */
const FIXTURE_SETS = [SLO_SET, AUGUST_SET, DUP_SET];
const FIXTURE_ADS = ADS.filter((a) => a.org_id === ORG_A && FIXTURE_SETS.includes(a.adset_external_id));

const SLO2_META_ID = "120253626574340264";
const SLO1_META_ID = "120253626444660264";
const SLO3_META_ID = "120253626579160264";

/* Meta's documented shape: lists of { action_type, value } with STRING values. */
const INSIGHTS = [
  {
    ad_id: SLO2_META_ID, date_start: "2026-09-30",
    spend: "272.35", impressions: "1247", clicks: "60", ctr: "4.8",
    actions: [
      { action_type: "link_click", value: "43" },
      { action_type: "landing_page_view", value: "33" },
      { action_type: "omni_purchase", value: "2" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
      { action_type: "lead", value: "1" }
    ],
    cost_per_action_type: [
      { action_type: "omni_purchase", value: "136.18" },
      { action_type: "link_click", value: "6.33" }
    ]
  },
  // Meta sent no actions at all: four NULLs, not four zeros.
  { ad_id: SLO1_META_ID, date_start: "2026-09-30", spend: "52.42", impressions: "585", clicks: "9" },
  // Pixel purchase only, no cost line: spend ÷ purchases.
  {
    ad_id: SLO3_META_ID, date_start: "2026-09-30", spend: "95.48", impressions: "2113", clicks: "120",
    actions: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "1" }]
  }
];

const fakeFetch = async (url) => {
  const u = String(url);
  let payload = { data: [] };
  if (u.includes("/insights?")) {
    payload = { data: INSIGHTS };
  } else if (u.includes("/campaigns?")) {
    payload = { data: [{ id: "adnum-camp-1", name: "oPur: TOF-SLO: $297", status: "PAUSED" }] };
  } else if (u.includes("/adsets?")) {
    payload = { data: FIXTURE_SETS.map((id) => ({ id, name: `set ${id}`, status: "PAUSED", campaign_id: "adnum-camp-1" })) };
  } else if (u.includes("/ads?")) {
    const set = FIXTURE_SETS.find((id) => u.includes(`/${id}/ads?`));
    payload = {
      data: FIXTURE_ADS.filter((a) => a.adset_external_id === set)
        .map((a) => ({ id: a.external_id, name: a.name, status: "PAUSED", adset_id: set }))
    };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
};

describe("ad numbers from Meta tags, Meta money numbers, payments per ad", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId;

  async function newClient(tag) {
    return (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name)
       VALUES ($1,$2,'Ad','Number') RETURNING id`,
      [org, mail(tag)]
    )).rows[0].id;
  }

  async function visitor(tag, tags) {
    const clientId = await newClient(tag);
    await db.query(
      `INSERT INTO client_ad_attribution (client_id, org_id, utm_source, utm_campaign, utm_content, utm_term)
       VALUES ($1,$2,'fb_ad',$3,$4,$5)`,
      [clientId, org, tags.utm_campaign ?? null, tags.utm_content ?? null, tags.utm_term ?? null]
    );
    return clientId;
  }

  const rowFor = async (clientId) => (await db.query(
    `SELECT ad_id, lane::text AS lane, utm_content, utm_term
       FROM client_ad_attribution WHERE client_id = $1`, [clientId])).rows[0];

  async function cleanup() {
    const like = `${NONCE}%`;
    await db.query(
      `DELETE FROM payment_links WHERE client_id IN (SELECT id FROM clients WHERE org_id = $1 AND email LIKE $2)`,
      [org, like]);
    await db.query(
      `DELETE FROM bookings WHERE client_id IN (SELECT id FROM clients WHERE org_id = $1 AND email LIKE $2)`,
      [org, like]);
    await db.query(`DELETE FROM clients WHERE org_id = $1 AND email LIKE $2`, [org, like]);
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
      process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
    }
    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, contact_email, agreement_signed_at)
       VALUES ($1,'Ad number fixture',$2,'active',$3,now())
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

  after(async () => { await cleanup(); await close(); });

  // ── 1. the shape ──────────────────────────────────────────────────────────

  test("ad_id is a plain column now, filled by the trigger", async () => {
    const col = (await db.query(
      `SELECT attgenerated FROM pg_attribute
        WHERE attrelid = 'public.client_ad_attribution'::regclass AND attname = 'ad_id'`
    )).rows[0];
    assert.equal(col.attgenerated, "", "ad_id is still GENERATED — 407 has not been applied here");
    const trg = (await db.query(
      `SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.client_ad_attribution'::regclass
          AND tgname = 'client_ad_attribution_ad_id_trg' AND NOT tgisinternal`
    )).rows.length;
    assert.equal(trg, 1);
  });

  test("ad_lane has slo", async () => {
    const labels = (await db.query(
      `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'ad_lane'::regtype ORDER BY enumsortorder`
    )).rows.map((r) => r.enumlabel);
    assert.ok(labels.includes("slo"), labels.join(","));
    assert.equal(labels.at(-1), "unknown", "unknown stays last");
  });

  test("the four 408 columns are bigint, nullable, with no default", async () => {
    const r = await db.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'ad_metrics_daily'
          AND column_name = ANY($1)`,
      [["purchases", "cost_per_purchase_cents", "link_clicks", "landing_page_views"]]
    );
    assert.equal(r.rows.length, 4, "408 has not been applied here");
    for (const c of r.rows) {
      assert.equal(c.data_type, "bigint", c.column_name);
      assert.equal(c.is_nullable, "YES", c.column_name);
      assert.equal(c.column_default, null, `${c.column_name} has a default — unknown would read as a number`);
    }
  });

  // ── 2. the sync: money numbers, then a late ad number ─────────────────────

  test("a visitor who clicked before the ad had a number gets it on the next sync", async () => {
    const early = await visitor("early", { utm_campaign: "oPur: TOF-SLO: $297", utm_content: "oVid: SLO2", utm_term: SLO_SET });
    assert.equal((await rowFor(early)).ad_id, null, "no ads copied in yet, so no number — honestly NULL");

    // First sync: copies the ads in. Nobody has typed their numbers yet.
    const first = await syncPartnerConnections({ partnerId, deps: { fetch: fakeFetch } });
    assert.deepEqual(first.errors, [], JSON.stringify(first.errors));
    assert.equal(first.meta_results_saved, true);
    assert.equal(first.ad_numbers.error, undefined, String(first.ad_numbers.error));
    assert.equal((await rowFor(early)).ad_id, null, "the ads have no Fundhub number yet");

    // A person numbers the ads (what 407 did for the four live SLO ads).
    await asStaff(async (tx) => {
      for (const a of FIXTURE_ADS) {
        if (a.fundhub_ad_number == null) continue;
        await tx.query(
          `UPDATE ads SET fundhub_ad_number = $3
            WHERE partner_id = $1 AND external_id = $2`,
          [partnerId, a.external_id, a.fundhub_ad_number]
        );
      }
    });

    const second = await syncPartnerConnections({ partnerId, deps: { fetch: fakeFetch } });
    assert.ok(second.ad_numbers.filled >= 1, JSON.stringify(second.ad_numbers));
    assert.equal((await rowFor(early)).ad_id, "90");
    assert.equal((await rowFor(early)).lane, "slo");
  });

  test("purchases, cost per purchase, link clicks and landing page views land as Meta sent them", async () => {
    const read = (metaId) => asStaff((tx) => tx.query(
      `SELECT m.* FROM ad_metrics_daily m JOIN ads a ON a.id = m.ad_id
        WHERE a.partner_id = $1 AND a.external_id = $2 AND m.date = '2026-09-30'::date`,
      [partnerId, metaId]
    ).then((r) => r.rows[0]));

    const slo2 = await read(SLO2_META_ID);
    assert.ok(slo2, "the SLO2 day did not land");
    assert.equal(Number(slo2.purchases), 2, "omni_purchase and the pixel purchase were added together, or lost");
    assert.equal(Number(slo2.cost_per_purchase_cents), 13618, "Meta's own cost line, in cents");
    assert.equal(Number(slo2.link_clicks), 43);
    assert.equal(Number(slo2.landing_page_views), 33);
    assert.equal(Number(slo2.spend_cents), 27235, "the old columns broke");
    assert.equal(Number(slo2.clicks), 60, "clicks (all clicks) must stay apart from link clicks");

    const slo1 = await read(SLO1_META_ID);
    for (const c of ["purchases", "cost_per_purchase_cents", "link_clicks", "landing_page_views"]) {
      assert.strictEqual(slo1[c], null, `${c} came back ${JSON.stringify(slo1[c])} — Meta sent nothing, so it must be NULL`);
    }

    const slo3 = await read(SLO3_META_ID);
    assert.equal(Number(slo3.purchases), 1, "the pixel purchase is the fallback when there is no omni_purchase");
    assert.equal(Number(slo3.cost_per_purchase_cents), 9548, "no cost line: spend ÷ purchases");
  });

  // ── 3. the shared case table through the real trigger ────────────────────

  describe("the case table, through the trigger, against the JS mirror", () => {
    const dbAds = ADS.filter((a) => a.org_id === ORG_A && FIXTURE_SETS.includes(a.adset_external_id));
    CASES.forEach(([name, tags, want, opts = {}], i) => {
      test(name, { skip: opts.jsOnly ? "needs a fixture this database test does not build" : false }, async () => {
        const id = await visitor(`case${i}`, tags);
        const got = (await rowFor(id)).ad_id;
        assert.equal(got, want, `SQL said ${got}`);
        assert.equal(adNumberOf(tags, dbAds), got, "the JS mirror and the SQL disagree");
      });
    });
  });

  // ── 4. what the trigger refuses, and what it keeps ────────────────────────

  test("the app cannot write ad_id — whatever it sends is replaced", async () => {
    const clientId = await newClient("forged");
    await db.query(
      `INSERT INTO client_ad_attribution (client_id, org_id, utm_content, utm_term, ad_id)
       VALUES ($1,$2,'oVid: SLO9',$3,'555')`,
      [clientId, org, SLO_SET]
    );
    assert.equal((await rowFor(clientId)).ad_id, null);
    await db.query(`UPDATE client_ad_attribution SET ad_id = '556' WHERE client_id = $1`, [clientId]);
    assert.equal((await rowFor(clientId)).ad_id, null);
  });

  test("a found number survives the ad being renamed and the person coming back", async () => {
    const id = await visitor("rename", { utm_content: "oVid: SLO4", utm_term: SLO_SET });
    assert.equal((await rowFor(id)).ad_id, "86");
    await asStaff((tx) => tx.query(
      `UPDATE ads SET name = 'oVid: SLO4 (renamed)' WHERE partner_id = $1 AND external_id = '120253626580720264'`,
      [partnerId]
    ));
    // Second capture, same tags: the upsert writes the row again.
    await upsertClientAdAttribution(db, {
      orgId: org, clientId: id,
      attribution: { utm_content: "oVid: SLO4", utm_term: SLO_SET, landing_path: "/roadmap" }
    });
    assert.equal((await rowFor(id)).ad_id, "86", "a rename in Meta wiped a number we had already found");
    await asStaff((tx) => tx.query(
      `UPDATE ads SET name = 'oVid: SLO4' WHERE partner_id = $1 AND external_id = '120253626580720264'`,
      [partnerId]
    ));
  });

  test("re-resolving fills only NULLs and never changes a number", async () => {
    const waiting = await visitor("waiting", { utm_content: "oVid: 1", utm_term: AUGUST_SET });
    const kept = await visitor("kept", { utm_content: "oVid: SLO1", utm_term: SLO_SET });
    assert.equal((await rowFor(waiting)).ad_id, null);
    assert.equal((await rowFor(kept)).ad_id, "84");

    await asStaff((tx) => tx.query(
      `UPDATE ads SET fundhub_ad_number = '95' WHERE partner_id = $1 AND external_id = '120252674467320264'`,
      [partnerId]
    ));
    const filled = await reresolveAdNumbers(db, { orgId: org });
    assert.ok(filled >= 1);
    assert.equal((await rowFor(waiting)).ad_id, "95");
    assert.equal((await rowFor(kept)).ad_id, "84");
  });

  test("the roadmap campaign reads lane slo; a junk campaign still reads unknown", async () => {
    const a = await visitor("lane-slo", { utm_campaign: "oPur: TOF-SLO: $297" });
    const b = await visitor("lane-junk", { utm_campaign: "oVid: SLO2" });
    assert.equal((await rowFor(a)).lane, "slo");
    assert.equal((await rowFor(b)).lane, "unknown");
  });

  // ── 5. payments per ad ────────────────────────────────────────────────────

  test("a paid order counts for its ad; demo and unpaid orders do not; nothing multiplies", async () => {
    // The roadmap campaign puts this buyer in lane slo, a group of its own: the
    // case-table visitors above who also resolve to 89 carry no campaign.
    const buyer = await visitor("buyer", {
      utm_campaign: "oPur: TOF-SLO: $297", utm_content: "oVid: SLO3", utm_term: SLO_SET
    });
    assert.equal((await rowFor(buyer)).ad_id, "89");

    for (const status of ["booked", "booked", "cancelled"]) {
      await db.query(`INSERT INTO bookings (org_id, client_id, source, status) VALUES ($1,$2,'sim',$3)`,
        [org, buyer, status]);
    }
    const link = (ref, status, isDemo, paid) => db.query(
      `INSERT INTO payment_links (org_id, client_id, purpose, amount_cents, link_ref, checkout_url,
                                  status, is_demo, paid_amount_cents, paid_at)
       VALUES ($1,$2,'diagnostic',14700,$3,'https://example.invalid/pay',$4,$5,$6,
               CASE WHEN $4 = 'paid' THEN now() END)`,
      [org, buyer, `${NONCE}-${ref}`, status, isDemo, paid]
    );
    await link("paid", "paid", false, 14700);
    await link("demo", "paid", true, 14700);
    await link("open", "sent", false, null);

    const rows = await adAttributionRollup(db, { orgId: org });
    const row = rows.find((r) => r.ad_id === "89" && r.lane === "slo");
    assert.ok(row, "ad 89 (lane slo) is missing from the roll-up");
    assert.equal(row.leads, 1);
    assert.equal(row.books, 2, "a cancelled booking counted, or bookings multiplied by payments");
    assert.equal(row.payments, 1, "a demo or unpaid order counted as a payment");
    assert.equal(row.paid_cents, 14700);
    assert.equal(typeof row.paid_cents, "number", "cents must come back as a number");
    assert.equal(row.payments_amount_unknown, 0);
    assert.ok(row.first_paid_at);
  });

  test("a group with no payment says 0 payments and paid_cents NULL, not $0", async () => {
    const rows = await adAttributionRollup(db, { orgId: org });
    const row = rows.find((r) => r.ad_id === "95");
    assert.ok(row);
    assert.equal(row.payments, 0);
    assert.strictEqual(row.paid_cents, null);
  });
});
