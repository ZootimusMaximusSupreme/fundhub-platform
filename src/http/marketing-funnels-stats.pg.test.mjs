// GET /api/marketing/funnels/stats against real Postgres (plan unit U32, spec
// §11.2 and §11.1), plus the EXPLAIN (ANALYZE) proof that U32's new reads walk
// indexes on the 30-day fixture.
//
// Lives under src/http/ because npm test's glob is src/** and scripts/** only
// (CLAUDE.md §12). Skips with DATABASE_URL unset, and a skipped .pg test is NOT
// green: it is proved in GitHub CI ("tests" workflow, a fresh pgvector Postgres
// 16 built from every migration). Never point it at production: it writes rows.
//
// ITS OWN COMPANY (org slug "mfstats-pg-test"). The clock is fixed at
// 2026-09-18T00:00Z = 2026-09-17 in Arizona: the window is 2026-08-19..09-17.
//
//   funnels  book_call   lands on /watch,   campaign mfs-c1 mapped to it
//            roadmap_147 lands on /roadmap, no campaign mapped
//            old_funnel  lands on /order,   inactive, nothing placed on it
//   ad 90    ads row in campaign mfs-c2 (NOT mapped); its live script says
//            roadmap_147 → the script wins. spend 09-02 $100 (40 link clicks),
//            09-03 $50 (no link-click line).
//            L1 booked, showed (deposit), active sale, $997.00 paid
//            L2 the $147.00 'slo' payment; L5 a demo client (not a lead)
//   ad 84    ads row in mfs-c1 → book_call. spend 09-01 $20 (6 link clicks).
//            L3 booking completed, then a no-show
//   AB       no number, in mfs-c1 → book_call. spend 09-04 $10 (4 link clicks)
//   AU       no number, in mfs-c2 → unmapped. spend 09-05 $70 (14 link clicks)
//   L4       tags that match no ad → no funnel
//   events   /roadmap 4 people + a bot + a demo row + one outside the window;
//            /watch 2 people + one at 2026-08-19 00:00 Arizona (in) + one at
//            2026-09-17 23:59 Arizona (in) + one at 2026-08-18 23:59 (out);
//            /roadmap-book 1 (not a landing page); a /roadmap click.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import statsHandler from "../../api/marketing/funnels/stats.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import {
  funnelStats, spendByFunnel, readScriptsWaiting, readStuckJobs, lastDays, ROLLUP_DAYS
} from "../marketing/metrics-rollups.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "mfstats-pg-test";
const NONCE = `mfstats-${process.pid}-${Date.now()}`;
const mail = (tag) => `${NONCE}.${tag}@example.com`;
const NOW = new Date("2026-09-18T00:00:00Z");
const META_SYNCED = new Date("2026-09-17T07:01:50Z");

/* The big tables U32's reads touch. With sequential scans priced out, the plan
   must reach each of them through an index. */
const INDEXED = new Set(["ad_metrics_daily", "events", "ad_scripts", "marketing_jobs", "client_ad_attribution"]);

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

async function call(token, { now = NOW } = {}) {
  const r = res();
  await statsHandler({
    method: "GET",
    headers: token ? { authorization: "Bearer " + token } : {},
    query: {}
  }, r, { db, now: () => now });
  return r;
}

/* Every node of a JSON plan, flattened. */
function nodes(plan, out = []) {
  out.push(plan);
  for (const p of plan.Plans || []) nodes(p, out);
  return out;
}

describe("GET /api/marketing/funnels/stats", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partner, conn, staffId, productId;
  let tokenOwner, tokenAdmin, tokenCloser;

  async function cleanup() {
    const o = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [ORG_SLUG])).rows[0];
    if (!o) return;
    const id = o.id;
    for (const t of ["events", "call_outcomes", "sales", "transactions", "payment_links", "bookings"]) {
      await db.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
    }
    await db.query(`DELETE FROM client_ad_attribution WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM clients WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM products WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM marketing_funnels WHERE org_id = $1`, [id]);
    await asStaff(async (tx) => {
      for (const t of ["ad_metrics_daily", "ads"]) await tx.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
      await tx.query(`DELETE FROM ad_scripts WHERE org_id = $1`, [id]);
      for (const t of ["ad_sets", "campaigns", "ad_platform_connections", "ad_platform_category_map"]) {
        await tx.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
      }
    });
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE org_id = $1)`, [id]);
    await db.query(`DELETE FROM staff WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM partners WHERE org_id = $1`, [id]);
    try { await db.query(`DELETE FROM orgs WHERE id = $1`, [id]); } catch { /* reused next run */ }
  }

  async function staffIn(role) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, mail(role), `Funnel stats ${role}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  async function tagged(tag, capturedAt, utmContent, { demo = false } = {}) {
    const id = (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, is_demo)
       VALUES ($1,$2,'Funnel',$3,$4) RETURNING id`, [org, mail(tag), tag.toUpperCase(), demo]
    )).rows[0].id;
    await db.query(
      `INSERT INTO client_ad_attribution (client_id, org_id, utm_source, utm_campaign, utm_content, captured_at)
       VALUES ($1,$2,'fb','slo',$3,$4)`, [id, org, utmContent, capturedAt]);
    return id;
  }

  const event = (name, page, session, at, { actor = "person", demo = false } = {}) => db.query(
    `INSERT INTO events (org_id, name, payload, created_at, is_demo) VALUES ($1,$2,$3::jsonb,$4,$5)`,
    [org, name, JSON.stringify({ page, session_id: session, actor, actor_reason: "fixture" }), at, demo]
  );

  before(async () => {
    await cleanup();
    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Marketing funnel stats fixture')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [ORG_SLUG]
    )).rows[0].id;
    partner = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'Funnel stats fixture','mfstats-direct') RETURNING id`, [org]
    )).rows[0].id;
    tokenOwner = (await staffIn("owner")).token;
    tokenAdmin = (await staffIn("admin")).token;
    const closer = await staffIn("closer");
    tokenCloser = closer.token;
    staffId = closer.id;
    productId = (await db.query(
      `INSERT INTO products (org_id, code, name, category) VALUES ($1,'mfstats-product','Funnel stats product','funding') RETURNING id`,
      [org]
    )).rows[0].id;

    const funnel = (key, name, path, campaigns, active = true) => db.query(
      `INSERT INTO marketing_funnels (org_id, key, name, landing_url, lane, meta_campaign_ids, active)
       VALUES ($1,$2,$3,$4,'sorting'::ad_lane,$5::text[],$6)`,
      [org, key, name, `https://apply.fundhub.ai${path}`, campaigns, active]);
    await funnel("book_call", "Book a call", "/watch", ["mfs-c1"]);
    await funnel("roadmap_147", "Roadmap", "/roadmap", []);
    await funnel("old_funnel", "Old funnel", "/order", [], false);

    await asStaff(async (tx) => {
      await tx.query(
        `INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category)
         VALUES ($1,'meta','funding','CREDIT')`, [org]);
      conn = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token, last_synced_at)
         VALUES ($1,$2,'meta','acct-mfstats','active','approved','v1:x:y:z',$3) RETURNING id`,
        [org, partner, META_SYNCED]
      )).rows[0].id;
      const campaign = async (ext) => (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, budget_cents, approval_state, external_id)
         VALUES ($1,$2,$3,$4,'funding',10000,'draft',$4) RETURNING id`, [org, partner, conn, ext]
      )).rows[0].id;
      const c1 = await campaign("mfs-c1");
      const c2 = await campaign("mfs-c2");
      const adSet = async (c, name) => (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,$5,10000,'draft') RETURNING id`, [org, partner, conn, c, name]
      )).rows[0].id;
      const s1 = await adSet(c1, "set 1");
      const s2 = await adSet(c2, "set 2");
      const ad = async (c, s, name, number) => (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state,
                          fundhub_ad_number, external_id)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8) RETURNING id`,
        [org, partner, conn, c, s, name, number, `${NONCE}-${name}`]
      )).rows[0].id;
      const a90 = await ad(c2, s2, "A90", "90");
      const a84 = await ad(c1, s1, "A84", "84");
      const aB = await ad(c1, s1, "AB", null);
      const aU = await ad(c2, s2, "AU", null);

      await tx.query(
        `INSERT INTO ad_scripts (org_id, partner_id, body, ad_id, status, funnel_key, source)
         VALUES ($1,$2,'HOOK: two files.',  '90', 'locked', 'roadmap_147', 'machine')`, [org, partner]);

      const day = (adId, date, cents, lc) => tx.query(
        `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, impressions, link_clicks, synced_at)
         VALUES ($1,$2,$3,$4::date,$5,100,$6,$7)`, [org, partner, adId, date, cents, lc, META_SYNCED]);
      await day(a90, "2026-09-02", 10000, 40);
      await day(a90, "2026-09-03", 5000, null);
      await day(a84, "2026-09-01", 2000, 6);
      await day(aB, "2026-09-04", 1000, 4);
      await day(aU, "2026-09-05", 7000, 14);
    });

    const l1 = await tagged("l1", "2026-09-02T16:00:00Z", "90");
    await db.query(`INSERT INTO bookings (org_id, client_id, source, status, created_at) VALUES ($1,$2,'sim','booked','2026-09-03T15:00:00Z')`, [org, l1]);
    await db.query(
      `INSERT INTO call_outcomes (org_id, client_id, staff_id, outcome, cash_collected_cents, logged_at)
       VALUES ($1,$2,$3,'deposit',50000,'2026-09-05T18:00:00Z')`, [org, l1, staffId]);
    await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, status, sold_at, external_ref)
       VALUES ($1,$2,$3,'997.00','active','2026-09-05T18:00:00Z',$4)`, [org, l1, productId, `${NONCE}-l1`]);
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, raw_payload, created_at)
       VALUES ($1,$2,'fixture','997.00','succeeded','{}'::jsonb,'2026-09-05T18:05:00Z')`, [org, l1]);
    const l2 = await tagged("l2", "2026-09-04T18:00:00Z", "90");
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, raw_payload, created_at)
       VALUES ($1,$2,'fixture','147.00','succeeded','{"source":"slo"}'::jsonb,'2026-09-04T18:10:00Z')`, [org, l2]);
    const l3 = await tagged("l3", "2026-09-01T18:00:00Z", "84");
    await db.query(`INSERT INTO bookings (org_id, client_id, source, status, created_at) VALUES ($1,$2,'sim','completed','2026-09-02T15:00:00Z')`, [org, l3]);
    await db.query(
      `INSERT INTO call_outcomes (org_id, client_id, staff_id, outcome, cash_collected_cents, logged_at)
       VALUES ($1,$2,$3,'no_show',0,'2026-09-03T18:00:00Z')`, [org, l3, staffId]);
    await tagged("l4", "2026-09-03T15:00:00Z", "oVid: Nobody");
    await tagged("l5", "2026-09-03T15:00:00Z", "90", { demo: true });

    for (const [i, at] of ["2026-09-02T17:00:00Z", "2026-09-03T17:00:00Z", "2026-09-04T17:00:00Z", "2026-09-05T17:00:00Z"].entries()) {
      await event("funnel.page", "/roadmap", `r${i}`, at);
    }
    await event("funnel.page", "/roadmap", "bot", "2026-09-02T18:00:00Z", { actor: "agent" });
    await event("funnel.page", "/roadmap", "demo", "2026-09-02T18:00:00Z", { demo: true });
    await event("funnel.page", "/roadmap", "old", "2026-08-01T18:00:00Z");
    await event("funnel.page", "/Roadmap-Book/", "r0", "2026-09-02T17:02:00Z");
    await event("funnel.click", "/roadmap", "r0", "2026-09-02T17:01:00Z");
    await event("funnel.page", "/watch", "w1", "2026-09-01T17:00:00Z");
    await event("funnel.page", "/watch", "w2", "2026-09-06T17:00:00Z");
    await event("funnel.page", "/watch", "w-start", "2026-08-19T07:00:00Z");  // 08-19 00:00 Arizona: in
    await event("funnel.page", "/watch", "w-end", "2026-09-18T06:59:00Z");    // 09-17 23:59 Arizona: in
    await event("funnel.page", "/watch", "w-before", "2026-08-19T06:59:00Z"); // 08-18 23:59 Arizona: out
  });

  after(async () => { await cleanup(); await close(); });

  test("no session → 401; a closer → 403", async () => {
    assert.equal((await call(null)).code, 401);
    const r = await call(tokenCloser);
    assert.equal(r.code, 403);
    assert.equal(r.body.rows, undefined);
  });

  test("owner: exact rows per funnel, the script before the campaign, matches the contract", async () => {
    const r = await call(tokenOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.doesNotThrow(() => assertMatchesContract("GET marketing/funnels/stats", r.body));
    assert.deepEqual(r.body.rows, [
      // Ad 90 sits in an unmapped campaign; its script says roadmap_147.
      { funnel_key: "roadmap_147", name: "Roadmap", spend_cents: 15000, page_views: 4,
        click_to_page: 0.1, page_to_lead: 0.5, leads: 2, booked: 1, showed: 1, sales: 1,
        cash_cents: 114400, roas: 7.6267 },
      // Ad 84 and the numberless AB through campaign mfs-c1.
      { funnel_key: "book_call", name: "Book a call", spend_cents: 3000, page_views: 4,
        click_to_page: 0.4, page_to_lead: 0.25, leads: 1, booked: 1, showed: 0, sales: 0,
        cash_cents: 0, roas: 0 }
    ]);
    assert.equal(r.body.unmapped_spend_cents, 7000, "AU's campaign is on no funnel");
    assert.equal(r.body.as_of, META_SYNCED.toISOString());
  });

  test("admin gets the same answer", async () => {
    const r = await call(tokenAdmin);
    assert.equal(r.code, 200);
    assert.equal(r.body.rows.length, 2);
  });

  test("null stays null: a window with no saved ad-day → spend and unmapped unknown, rates unknown, visits a real 0", async () => {
    const r = await call(tokenOwner, { now: new Date("2026-12-31T20:00:00Z") });
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.rows, [
      { funnel_key: "book_call", name: "Book a call", spend_cents: null, page_views: 0,
        click_to_page: null, page_to_lead: null, leads: 0, booked: 0, showed: 0, sales: 0,
        cash_cents: 0, roas: null },
      { funnel_key: "roadmap_147", name: "Roadmap", spend_cents: null, page_views: 0,
        click_to_page: null, page_to_lead: null, leads: 0, booked: 0, showed: 0, sales: 0,
        cash_cents: 0, roas: null }
    ]);
    assert.equal(r.body.unmapped_spend_cents, null);
  });

  test("Today's 7-day spend by funnel: same placement, with the Unmapped bucket", async () => {
    const out = await asStaff((tx) => spendByFunnel(tx, { orgId: org, from: "2026-09-01", to: "2026-09-07" }));
    assert.deepEqual(out.rows.map((x) => [x.funnel_key, x.spend_cents]), [["roadmap_147", 15000], ["book_call", 3000]]);
    assert.equal(out.unmapped.spend_cents, 7000);
  });

  test("EXPLAIN (ANALYZE): every new read reaches the big tables through an index on the 30-day fixture", async (t) => {
    const { from, to } = lastDays(ROLLUP_DAYS, NOW);
    const plans = [];
    await asStaff(async (tx) => {
      // Sequential scans priced out for this transaction only (SET LOCAL ends at
      // COMMIT), so the plan shows the index path the read can use. Scratch CI
      // database; never the live pool.
      await tx.query("SET LOCAL enable_seqscan = off");
      const spy = {
        query: async (sql, params) => {
          const tag = /^-- m5:(\w+)/.exec(String(sql));
          if (tag) {
            const r = await tx.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
            plans.push({ name: tag[1], plan: r.rows[0]["QUERY PLAN"][0] });
          }
          return tx.query(sql, params);
        }
      };
      await funnelStats(spy, { orgId: org, from, to, now: NOW });
      await readScriptsWaiting(spy, { orgId: org, now: NOW });
      await readStuckJobs(spy, { orgId: org });
    });

    assert.deepEqual(plans.map((p) => p.name).sort(),
      ["ad_labels", "ad_spend", "funnel_steps", "script_labels", "scripts_waiting", "stuck_jobs"]);
    for (const { name, plan } of plans) {
      const all = nodes(plan.Plan);
      const scans = all.filter((n) => n["Relation Name"])
        .map((n) => `${n["Node Type"]}${n["Index Name"] ? ` ${n["Index Name"]}` : ""} on ${n["Relation Name"]}`);
      t.diagnostic(`${name} (${plan["Execution Time"]} ms): ${scans.join("; ")}`);
      for (const n of all) {
        if (INDEXED.has(n["Relation Name"])) {
          assert.notEqual(n["Node Type"], "Seq Scan", `${name}: ${n["Relation Name"]} is read without an index`);
        }
      }
    }
    const spend = nodes(plans.find((p) => p.name === "ad_spend").plan.Plan);
    assert.ok(spend.some((n) => n["Relation Name"] === "ad_metrics_daily" && /Index|Bitmap Heap/.test(n["Node Type"])),
      "ad_spend reads ad_metrics_daily through an index");
    const steps = nodes(plans.find((p) => p.name === "funnel_steps").plan.Plan);
    assert.ok(steps.some((n) => (n["Index Name"] || "") === "idx_events_name"),
      "funnel_steps reads events through idx_events_name (org, name, created_at)");
  });
});
