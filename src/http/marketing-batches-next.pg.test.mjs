// GET/POST /api/marketing/batches/next and the planner's database half (plan unit U23,
// spec §7.5, §7.8) against real Postgres. Lives under src/http/ because npm test globs
// src/** and scripts/** only (CLAUDE.md §12).
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a scratch
// database from db/migrations. Without DATABASE_URL every test skips, and a skipped
// .pg.test.mjs is not green.
//
// ONE COMPANY OF ITS OWN (slug below), removed after. ads, ad_sets, campaigns,
// ad_metrics_daily, ad_platform_connections and ad_scripts FORCE row security, so their
// fixture rows go in and out through asStaff().
//
// THE ROOM (Arizona days; NOW is Wed 2026-10-14, 12:00 pm Arizona; the 7-day window
// is Oct 8..14):
//   campaign 111 → funnel roadmap_147, campaign 222 → book_call, campaign 333 → none
//   ad 91  in 333, live script says roadmap_147 / two_files        $412.00 → roadmap (script)
//   ad 92  in 222, no script                                         $111.50 → book_call (campaign)
//   ad 93  in 111, live script says book_call / speed                 $50.00 → book_call (script beats campaign)
//   ad 95  in 111, only an ARCHIVED script (says book_call)           $10.00 → roadmap (campaign; archived ignored)
//   (no #) in 333                                                     $91.50 → Unmapped
//   ad 94  in 111, spent Sep 24 only (outside the window)              ---   → not counted
//   roadmap_147 = $422.00, book_call = $161.50, Unmapped = $91.50

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import nextHandler from "../../api/marketing/batches/next.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import { gatherPlanInputs, savePlan } from "../marketing/planner-data.mjs";
import { planBatch } from "../marketing/planner.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SLUG = `zz-mm-next-pg-${RUN}`;
const EMAIL_TAG = "zz_mm_next_pg";
const NOW = "2026-10-14T19:00:00.000Z";
const NEXT_RELEASE = "2026-10-19T14:00:00.000Z";
const NEXT_WEEK = "2026-W43";

let seq = 0;
const rid = (tag) => `mm-next-${tag}-${RUN}-${++seq}`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

describe("/api/marketing/batches/next and the planner's database half", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partner, tokenOwner, tokenCloser;

  async function call(token, { method = "GET", body } = {}) {
    const r = res();
    await nextHandler(
      { method, headers: token ? { authorization: "Bearer " + token } : {}, query: {}, body },
      r,
      { db, now: NOW }
    );
    if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
    return r;
  }
  const get = (token) => call(token);
  const post = (token, body) => call(token, { method: "POST", body });

  const settingsRow = async () =>
    (await db.query(`SELECT * FROM marketing_settings WHERE org_id = $1`, [org])).rows[0];

  async function cleanup() {
    const orgs = (await db.query(`SELECT id FROM orgs WHERE slug LIKE 'zz-mm-next-pg-%'`)).rows.map((r) => r.id);
    if (orgs.length) {
      await db.query(`DELETE FROM marketing_requests WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_jobs WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM ad_ideas WHERE org_id = ANY($1)`, [orgs]);
      await asStaff(async (tx) => {
        await tx.query(`DELETE FROM ad_scripts WHERE org_id = ANY($1)`, [orgs]);
        for (const t of ["ad_metrics_daily", "ads", "ad_sets", "campaigns", "ad_platform_connections", "ad_platform_category_map"]) {
          await tx.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [orgs]);
        }
      });
      await db.query(`DELETE FROM marketing_batches WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_funnels WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_settings WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM partners WHERE org_id = ANY($1)`, [orgs]);
    }
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    for (const id of orgs) {
      try { await db.query(`DELETE FROM orgs WHERE id = $1`, [id]); } catch { /* reused next run */ }
    }
  }

  async function staffIn(role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}.${RUN}@example.com`, `Next ${tag}`, role]
    )).rows[0];
    return (await createSession(db, { staffId: row.id, orgId: org })).token;
  }

  before(async () => {
    await cleanup();
    org = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1, 'Next batch fixture') RETURNING id`, [SLUG])).rows[0].id;
    partner = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1, 'Fundhub house', 'fundhub-house') RETURNING id`, [org]
    )).rows[0].id;
    tokenOwner = await staffIn("owner", "owner");
    tokenCloser = await staffIn("closer", "closer");

    await db.query(
      `INSERT INTO marketing_funnels (org_id, key, name, landing_url, lane, format_mix, meta_campaign_ids, book_call)
       VALUES ($1, 'roadmap_147', 'Roadmap $147', 'https://apply.fundhub.ai/roadmap', 'uwiq', '{"standard":1}', '{111}', false),
              ($1, 'book_call', 'Book a call', 'https://apply.fundhub.ai/watch', 'sorting', '{"standard":2,"sorting":1}', '{222}', true)`,
      [org]
    );

    await asStaff(async (tx) => {
      await tx.query(
        `INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category)
         VALUES ($1,'meta','funding','CREDIT')`, [org]);
      const conn = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'meta','acct-mm-next','active','approved','v1:x:y:z') RETURNING id`,
        [org, partner]
      )).rows[0].id;
      const camp = {};
      const adSet = {};
      for (const ext of ["111", "222", "333"]) {
        camp[ext] = (await tx.query(
          `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, budget_cents, approval_state, external_id)
           VALUES ($1,$2,$3,$4,'funding',10000,'draft',$5) RETURNING id`,
          [org, partner, conn, `Next campaign ${ext}`, ext]   // Meta ids are unique per connection only
        )).rows[0].id;
        adSet[ext] = (await tx.query(
          `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state, external_id)
           VALUES ($1,$2,$3,$4,$5,10000,'draft',$6) RETURNING id`,
          [org, partner, conn, camp[ext], `Next ad set ${ext}`, `9${ext}`]
        )).rows[0].id;
      }
      const ad = async (ext, number, tag) => (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state,
                          fundhub_ad_number, external_id)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8) RETURNING id`,
        [org, partner, conn, camp[ext], adSet[ext], `Next ad ${tag}`, number, `mm-next-${tag}-${RUN}`]
      )).rows[0].id;
      const day = (adId, date, cents) => tx.query(
        `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, impressions)
         VALUES ($1,$2,$3,$4::date,$5,100)`,
        [org, partner, adId, date, cents]
      );
      const a91 = await ad("333", "91", "91");
      await day(a91, "2026-10-08", 20000);
      await day(a91, "2026-10-14", 21200);
      await day(a91, "2026-10-07", 77777);              // the day before the window
      const a92 = await ad("222", "92", "92");
      await day(a92, "2026-10-10", 11150);
      const a93 = await ad("111", "93", "93");
      await day(a93, "2026-10-12", 5000);
      const a95 = await ad("111", "95", "95");
      await day(a95, "2026-10-11", 1000);
      const au = await ad("333", null, "nonum");
      await day(au, "2026-10-09", 9150);
      const a94 = await ad("111", "94", "94");
      await day(a94, "2026-09-24", 3000);

      const script = (fields) => {
        const row = { org_id: org, partner_id: partner, body: "Fixture script body.", source: "import", status: "locked", ...fields };
        const cols = Object.keys(row);
        return tx.query(
          `INSERT INTO ad_scripts (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
          cols.map((k) => row[k])
        );
      };
      await script({ ad_id: "91", funnel_key: "roadmap_147", angle_key: "two_files" });
      await script({ ad_id: "93", funnel_key: "book_call", angle_key: "speed" });
      await script({ ad_id: "94", funnel_key: "roadmap_147", angle_key: "rates_rising" });
      await script({ ad_id: "95", funnel_key: "book_call", angle_key: "bank_said_no", status: "superseded", archived_at: "2026-10-01T00:00:00Z" });
    });
  });

  after(async () => { await cleanup(); await close(); });

  test("a closer gets 403 on GET and POST; no session 401; the wrong method 405", async () => {
    assert.equal((await get(tokenCloser)).code, 403);
    const p = await post(tokenCloser, { request_id: rid("gate"), updated_at: new Date().toISOString(), overrides: {} });
    assert.equal(p.code, 403);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_requests WHERE org_id = $1`, [org])).rows[0].n, 0);
    assert.equal((await get(null)).code, 401);
    const put = await call(tokenOwner, { method: "PUT", body: {} });
    assert.equal(put.code, 405);
    assert.equal(put.headers.Allow, "GET, POST");
  });

  test("GET: the contract's shape; spend maps through the script's funnel first, then the campaign, the rest Unmapped", async () => {
    const r = await get(tokenOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/batches/next", r.body);
    const { next } = r.body;
    assert.equal(next.release_at, NEXT_RELEASE);
    assert.equal(next.week_key, NEXT_WEEK);
    assert.equal(next.enabled, false);
    assert.equal(next.size_rule, "total");
    assert.equal(next.total, 21);
    assert.equal(next.slots.length, 21);
    assert.equal(next.overrides, null);
    assert.equal(r.body.saved, null, "no weekly batch planned yet");

    const f = Object.fromEntries(next.funnels.map((x) => [x.funnel_key, x]));
    assert.equal(f.roadmap_147.spend_7d_cents, 42200, "ad 91 by its script + ad 95 by its campaign (archived script ignored)");
    assert.equal(f.book_call.spend_7d_cents, 16150, "ad 92 by its campaign + ad 93 by its script");
    assert.equal(next.unmapped_spend_cents, 9150, "the ad with no number in a campaign no funnel holds");
    assert.equal(f.roadmap_147.slots + f.book_call.slots, 21);
    assert.equal(f.roadmap_147.slots, 15);
    assert.equal(f.book_call.slots, 6);

    const money = next.slots.filter((s) => s.source === "follow_money");
    assert.ok(money.filter((s) => s.funnel_key === "roadmap_147").every((s) => s.angle_key === "two_files"));
    assert.ok(money.some((s) => s.funnel_key === "book_call" && s.angle_key === "speed"), "the book_call money follows ad 93's angle");
    assert.ok(next.slots.every((s) => typeof s.reason === "string" && s.reason.length > 10));
    assert.equal(next.suggestions.length, 3);

    // A read writes nothing but the settings row's first-read default.
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_requests WHERE org_id = $1`, [org])).rows[0].n, 0);
    assert.equal((await settingsRow()).next_overrides, null);
  });

  test("POST saves the overrides through withRequest and answers the plan with them on; a repeat writes nothing", async () => {
    const before = await settingsRow();
    const requestId = rid("save");
    const body = { request_id: requestId, updated_at: before.updated_at.toISOString(), overrides: { total: 12, funnel_slots: { book_call: 5 }, skip_angles: ["two_files"] } };
    const r = await post(tokenOwner, body);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/batches/next", r.body);
    assert.deepEqual(r.body.next.overrides, { total: 12, funnel_slots: { book_call: 5 }, skip_angles: ["two_files"] });
    assert.equal(r.body.next.total, 12);
    const f = Object.fromEntries(r.body.next.funnels.map((x) => [x.funnel_key, x]));
    assert.equal(f.book_call.slots, 5);
    assert.equal(f.roadmap_147.slots, 7);
    assert.ok(!r.body.next.slots.some((s) => s.angle_key === "two_files"), "skipped this time");

    const saved = await settingsRow();
    assert.deepEqual(saved.next_overrides, body.overrides);
    assert.ok(saved.updated_at.getTime() > before.updated_at.getTime());
    const req = (await db.query(`SELECT route, org_id FROM marketing_requests WHERE request_id = $1`, [requestId])).rows[0];
    assert.equal(req.route, "marketing/batches/next");
    assert.equal(req.org_id, org);

    const again = await post(tokenOwner, body);
    assert.equal(again.code, 200);
    assert.deepEqual(again.body, r.body, "the saved answer comes back");
    assert.equal((await settingsRow()).updated_at.getTime(), saved.updated_at.getTime(), "nothing written twice");

    const g = await get(tokenOwner);
    assert.deepEqual(g.body.next.overrides, body.overrides, "GET shows them too");
    assert.equal(g.body.next.total, 12);
  });

  test("a stale updated_at gets 409 with what is saved now; nothing changes", async () => {
    const cur = await settingsRow();
    const old = new Date(cur.updated_at.getTime() - 60_000).toISOString();
    const r = await post(tokenOwner, { request_id: rid("stale"), updated_at: old, overrides: { total: 3 } });
    assert.equal(r.code, 409, JSON.stringify(r.body));
    assert.equal(r.body.error, "stale");
    assert.equal(typeof r.body.message, "string");
    assert.deepEqual(Object.keys(r.body.current).sort(), ["overrides", "updated_at"]);
    assert.deepEqual(r.body.current.overrides, cur.next_overrides);
    assert.equal(r.body.current.updated_at, cur.updated_at.toISOString());
    const after = await settingsRow();
    assert.deepEqual(after.next_overrides, cur.next_overrides);
    assert.equal(after.updated_at.getTime(), cur.updated_at.getTime());
  });

  test("bad input is a 400 that names the field, and nothing is saved", async () => {
    const cur = await settingsRow();
    const at = cur.updated_at.toISOString();
    const cases = [
      [{ request_id: rid("b1"), updated_at: at, overrides: "more" }, "overrides"],
      [{ request_id: rid("b2"), updated_at: at }, "overrides"],
      [{ request_id: rid("b3"), updated_at: at, overrides: { total: 0 } }, "overrides.total"],
      [{ request_id: rid("b4"), updated_at: at, overrides: { funnel_slots: { no_such: 2 } } }, "overrides.funnel_slots.no_such"],
      [{ request_id: rid("b5"), overrides: {} }, "updated_at"],
      [{ updated_at: at, overrides: {} }, "request_id"]
    ];
    for (const [body, field] of cases) {
      const r = await post(tokenOwner, body);
      assert.equal(r.code, 400, `${field}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, "invalid");
      assert.equal(r.body.field, field);
      assert.equal(typeof r.body.message, "string");
    }
    assert.equal((await settingsRow()).updated_at.getTime(), cur.updated_at.getTime());
  });

  test("{} clears the overrides", async () => {
    const cur = await settingsRow();
    const r = await post(tokenOwner, { request_id: rid("clear"), updated_at: cur.updated_at.toISOString(), overrides: {} });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.next.overrides, null);
    assert.equal(r.body.next.total, 21);
    assert.equal((await settingsRow()).next_overrides, null);
  });

  test("savePlan: the plan lands on the planned weekly batch, its ideas are held, the overrides are used up; GET shows it as saved", async () => {
    // One-time overrides and one waiting idea from Chris.
    const cur = await settingsRow();
    const set = await post(tokenOwner, { request_id: rid("pre"), updated_at: cur.updated_at.toISOString(), overrides: { total: 6 } });
    assert.equal(set.code, 200);
    const idea = (await db.query(
      `INSERT INTO ad_ideas (org_id, source, raw_points, funnel_key) VALUES ($1, 'chris', 'Lenders read two files first.', 'roadmap_147') RETURNING id`,
      [org]
    )).rows[0].id;
    const batch = (await db.query(
      `INSERT INTO marketing_batches (org_id, kind, week_key, status, release_at)
       VALUES ($1, 'weekly', $2, 'planned', $3) RETURNING id`,
      [org, NEXT_WEEK, NEXT_RELEASE]
    )).rows[0].id;

    const out = await asStaff(async (tx) => {
      const inputs = await gatherPlanInputs(tx, { orgId: org, now: NOW });
      const plan = planBatch(inputs);
      assert.equal(plan.total, 6);
      assert.equal(plan.slots[0].idea_id, idea, "Chris's idea is slot 1");
      return { plan, saved: await savePlan(tx, { batchId: batch, plan, rulesSha: "abc123" }) };
    });
    assert.deepEqual(out.saved, { batch_id: batch, kind: "weekly", status: "planned", ideas_held: 1, overrides_cleared: true });

    const row = (await db.query(`SELECT plan, rules_sha, total FROM marketing_batches WHERE id = $1`, [batch])).rows[0];
    assert.equal(row.rules_sha, "abc123");
    assert.equal(row.total, 6);
    assert.equal(row.plan.slots.length, 6);
    assert.deepEqual(row.plan.overrides, { total: 6 });
    assert.equal((await db.query(`SELECT batch_id FROM ad_ideas WHERE id = $1`, [idea])).rows[0].batch_id, batch);
    assert.equal((await settingsRow()).next_overrides, null, "one-time: used up by the weekly plan");

    const g = await get(tokenOwner);
    assert.deepEqual(g.body.saved, { batch_id: batch, status: "planned" });
    assert.ok(!g.body.next.slots.some((s) => s.idea_id === idea), "a held idea is not planned again");

    // A batch past 'planned' is not written over.
    await db.query(`UPDATE marketing_batches SET status = 'writing' WHERE id = $1`, [batch]);
    const again = await asStaff((tx) => savePlan(tx, { batchId: batch, plan: out.plan }));
    assert.equal(again, null);
  });

  test("on command: the ideas Write now holds for its batch come first, on its funnel", async () => {
    const batch = (await db.query(
      `INSERT INTO marketing_batches (org_id, kind, week_key, status, release_at)
       VALUES ($1, 'on_command', $2, 'planned', now()) RETURNING id`,
      [org, NEXT_WEEK]
    )).rows[0].id;
    const idea = (await db.query(
      `INSERT INTO ad_ideas (org_id, source, raw_points, batch_id) VALUES ($1, 'chris', 'Rates are rising.', $2) RETURNING id`,
      [org, batch]
    )).rows[0].id;
    const plan = await asStaff(async (tx) => planBatch(await gatherPlanInputs(tx, {
      orgId: org, now: NOW, onCommand: { count: 2, funnel_key: "book_call", idea_ids: [idea], batch_id: batch }
    })));
    assert.equal(plan.total, 2);
    assert.equal(plan.slots[0].idea_id, idea);
    assert.ok(plan.slots.every((s) => s.funnel_key === "book_call"));
    assert.equal(plan.overrides, null);
  });
});
