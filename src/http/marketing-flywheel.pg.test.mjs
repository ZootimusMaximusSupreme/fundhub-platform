// The Ideas tab's flywheel routes against real Postgres (unit X3, design
// docs/specs/command-center-design-2026-10-05.md §3.2 row 6 and §6 slice 5):
//   GET  marketing/flywheel
//   POST marketing/flywheel/campaign | approve | tweak | spend-read | run
// and the worker's flywheel_stage handler writing a real ledger, a real job
// result and a real outbox row. Lives under src/http/ because npm test globs
// src/** and scripts/** only (CLAUDE.md §12).
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations. Without DATABASE_URL every test skips,
// and a skipped .pg.test.mjs is not green.
//
// NO NETWORK. env has no GITHUB_REPO_TOKEN, so the routes read the flywheel
// files from this checkout (the bundle fallback) with the company's pending
// outbox rows on top, exactly as a site with no token would. Where a test needs
// a campaign whose step 3 is approved it hands the route a stand-in GitHub
// reader (deps.readFlywheel / deps.reader). The model is a stand-in
// (src/marketing/fixtures/flywheel-fakes.mjs). The worker is never woken: wake
// is a counter.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import getFlywheel from "../../api/marketing/flywheel.mjs";
import postCampaign from "../../api/marketing/flywheel/campaign.mjs";
import postApprove from "../../api/marketing/flywheel/approve.mjs";
import postTweak from "../../api/marketing/flywheel/tweak.mjs";
import postSpendRead from "../../api/marketing/flywheel/spend-read.mjs";
import postRun from "../../api/marketing/flywheel/run.mjs";
import { readFlywheel } from "../marketing/flywheel/reader.mjs";
import { spendWindow } from "../marketing/flywheel/spend-read.mjs";
import { latestStageJobs } from "../marketing/flywheel/store.mjs";
import { run as runStageJob } from "../marketing/flywheel/stage-job.mjs";
import { finishJob } from "../marketing/jobs.mjs";
import { addDays } from "../metro2/dates.mjs";
import { campaignFiles, readerDeps, fakeModel } from "../marketing/fixtures/flywheel-fakes.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SLUG_TAG = "zz-mm-flywheel-pg";
const EMAIL_TAG = "zz_mm_flywheel_pg";

let seq = 0;
const rid = (tag) => `mm-fly-${tag}-${RUN}-${++seq}`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

describe("the flywheel routes", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, partnerA, ownerA, tokenOwnerA, tokenAdminA, tokenCloserA, tokenOwnerB;
  let wakes = 0;
  const ENV = {};
  const wake = async () => { wakes++; return { ok: true, started: false }; };

  async function call(handler, token, { method = "POST", body = {}, query = {}, deps = {} } = {}) {
    const r = res();
    await handler(
      { method, headers: token ? { authorization: "Bearer " + token } : {}, query, body },
      r,
      { db, env: ENV, wake, ...deps }
    );
    if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
    return r;
  }

  const outbox = async (org, path) => (await db.query(
    `SELECT * FROM repo_outbox WHERE org_id = $1 AND path = $2 ORDER BY id`, [org, path])).rows;

  /** A stand-in reader for a campaign whose step 3 is approved. */
  const readyReader = (files = campaignFiles()) => ({
    readFlywheel: (args) => readFlywheel({ ...args, deps: readerDeps(files) })
  });

  async function cleanup() {
    const orgs = `(SELECT id FROM orgs WHERE slug LIKE '${SLUG_TAG}%')`;
    await db.query(`DELETE FROM marketing_requests WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM repo_outbox WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_model_usage WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_jobs WHERE org_id IN ${orgs}`);
    await asStaff(async (tx) => {
      for (const t of ["ad_metrics_daily", "ads", "ad_sets", "campaigns", "ad_platform_connections", "ad_platform_category_map"]) {
        await tx.query(`DELETE FROM ${t} WHERE org_id IN ${orgs}`);
      }
    });
    await db.query(`DELETE FROM partners WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug LIKE '${SLUG_TAG}%'`); } catch { /* reused next run */ }
  }

  async function staffIn(org, role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}.${RUN}@example.com`, `Flywheel ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  const mkOrg = async (suffix) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Flywheel fixture') RETURNING id`, [`${SLUG_TAG}-${suffix}-${RUN}`]
  )).rows[0].id;

  before(async () => {
    await cleanup();
    orgA = await mkOrg("a");
    orgB = await mkOrg("b");
    const owner = await staffIn(orgA, "owner", "a.owner");
    ownerA = owner.id;
    tokenOwnerA = owner.token;
    tokenAdminA = (await staffIn(orgA, "admin", "a.admin")).token;
    tokenCloserA = (await staffIn(orgA, "closer", "a.closer")).token;
    tokenOwnerB = (await staffIn(orgB, "owner", "b.owner")).token;

    // Saved Meta days for company A inside the spend read's window (30 Arizona days ending yesterday).
    const { to } = spendWindow(new Date());
    partnerA = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'Flywheel fixture',$2) RETURNING id`, [orgA, `mmfly-${RUN}`]
    )).rows[0].id;
    await asStaff(async (tx) => {
      await tx.query(`INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category) VALUES ($1,'meta','funding','CREDIT')`, [orgA]);
      const conn = (await tx.query(
        `INSERT INTO ad_platform_connections (org_id, partner_id, platform, external_ad_account_id, connection_state,
           platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'meta',$3,'active','approved','v1:x:y:z') RETURNING id`, [orgA, partnerA, `acct-mmfly-${RUN}`]
      )).rows[0].id;
      const camp = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, budget_cents, approval_state)
         VALUES ($1,$2,$3,'Flywheel fixture','funding',10000,'draft') RETURNING id`, [orgA, partnerA, conn]
      )).rows[0].id;
      const set = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state, external_id)
         VALUES ($1,$2,$3,$4,'Flywheel set',10000,'draft',$5) RETURNING id`, [orgA, partnerA, conn, camp, `mmfly-set-${RUN}`]
      )).rows[0].id;
      const ad = async (name, number) => (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state, fundhub_ad_number, external_id)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8) RETURNING id`,
        [orgA, partnerA, conn, camp, set, name, number, `mmfly-${name}-${RUN}`]
      )).rows[0].id;
      const a84 = await ad("ad84", "84");
      const anon = await ad("anon", null);
      const day = (adId, date, m) => tx.query(
        `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, impressions, link_clicks,
           video_plays, video_p25_watched, purchases)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)`,
        [orgA, partnerA, adId, date, m.spend, m.imp, m.lc ?? null, m.plays ?? null, m.p25 ?? null, m.purchases ?? null]);
      await day(a84, to, { spend: 30000, imp: 4000, lc: 40, plays: 300, p25: 60, purchases: null });
      await day(a84, addDays(to, -1), { spend: 19801, imp: 3000, lc: 20, plays: 200, p25: 40, purchases: 0 });
      await day(anon, to, { spend: 7000, imp: 900, lc: 5 });
      await day(a84, addDays(to, 1), { spend: 99999, imp: 9, lc: 9 }); // today: outside the window
    });
  });

  after(async () => {
    await cleanup();
    await close();
  });

  describe("GET marketing/flywheel", () => {
    test("owner and admin only", async () => {
      assert.equal((await call(getFlywheel, null, { method: "GET" })).code, 401);
      assert.equal((await call(getFlywheel, tokenCloserA, { method: "GET" })).code, 403);
      assert.equal((await call(getFlywheel, tokenAdminA, { method: "GET" })).code, 200);
      assert.equal((await call(getFlywheel, tokenOwnerA, { method: "POST" })).code, 405);
    });

    test("partner by default: six rows in Chris's words, read from the copy built into the site, and it says so", async () => {
      const r = await call(getFlywheel, tokenOwnerA, { method: "GET" });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.campaign, "partner");
      assert.equal(r.body.campaign_words, "Partner offer");
      assert.equal(r.body.source, "bundle-fallback");
      assert.match(r.body.fallback_reason, /GITHUB_REPO_TOKEN is not set/);
      assert.equal(r.body.stages.length, 6);
      assert.equal(r.body.stages[3].label_words, "Ad copy for the Partner offer");
      assert.equal(r.body.stages[3].can_run.ok, false);
      assert.match(r.body.stages[3].can_run.reason, /Approve step 3/);
      assert.ok(r.body.offers.some((o) => o.key === "UWIQ_DELIVERABLES" && o.campaign === "capital-blueprint"));
      assert.ok(r.body.campaigns.some((c) => c.name === "partner" && c.words === "Partner offer"));
    });

    test("a bad name is 400, a missing campaign is 404", async () => {
      const bad = await call(getFlywheel, tokenOwnerA, { method: "GET", query: { campaign: "../x" } });
      assert.equal(bad.code, 400);
      assert.equal(bad.body.field, "campaign");
      assert.equal((await call(getFlywheel, tokenOwnerA, { method: "GET", query: { campaign: "nope-nope" } })).code, 404);
    });
  });

  describe("POST marketing/flywheel/campaign", () => {
    test("Start a flywheel for the Capital Blueprint: one owner-notes file queued with its offer line; once per request_id", async () => {
      const before = wakes;
      const id = rid("camp");
      const r = await call(postCampaign, tokenOwnerA, { body: { request_id: id, key: "UWIQ_DELIVERABLES" } });
      assert.equal(r.code, 201, JSON.stringify(r.body));
      assert.equal(r.body.campaign, "capital-blueprint");
      assert.equal(r.body.campaign_words, "Capital Blueprint");
      assert.equal(r.body.created, true);
      assert.equal(wakes, before + 1, "the worker is woken to carry the save to git");
      const rows = await outbox(orgA, "marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].mode, "replace");
      assert.match(rows[0].content, /\nOffer key: UWIQ_DELIVERABLES\n/);
      assert.match(rows[0].content, /\n## Notes\n$/);

      const again = await call(postCampaign, tokenOwnerA, { body: { request_id: id, key: "UWIQ_DELIVERABLES" } });
      assert.deepEqual(again.body, r.body);
      assert.equal((await outbox(orgA, "marketing/flywheel/capital-blueprint/00-OWNER-NOTES.md")).length, 1);

      const exists = await call(postCampaign, tokenOwnerA, { body: { request_id: rid("camp2"), key: "UWIQ_DELIVERABLES" } });
      assert.equal(exists.code, 200);
      assert.equal(exists.body.created, false);
    });

    test("the new flywheel reads from its pending save for this company only", async () => {
      const r = await call(getFlywheel, tokenOwnerA, { method: "GET", query: { campaign: "capital-blueprint" } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.campaign_words, "Capital Blueprint");
      assert.deepEqual(r.body.stages.map((s) => s.state), ["MISSING", "MISSING", "MISSING", "MISSING", "MISSING", "MISSING"]);
      assert.equal(r.body.stages[0].state_word, "Not on this page yet");
      assert.equal(r.body.stages[2].can_run.ok, false, "the offer needs who we sell to first");
      assert.equal((await call(getFlywheel, tokenOwnerB, { method: "GET", query: { campaign: "capital-blueprint" } })).code, 404);
    });

    test("a key that is not an offer is refused by field", async () => {
      const r = await call(postCampaign, tokenOwnerA, { body: { request_id: rid("bad"), key: "NOT_AN_OFFER" } });
      assert.equal(r.code, 400);
      assert.equal(r.body.field, "key");
      assert.equal((await call(postCampaign, tokenCloserA, { body: { request_id: rid("x"), key: "UWIQ_DELIVERABLES" } })).code, 403);
    });
  });

  describe("POST marketing/flywheel/approve", () => {
    test("flips the stamp through one outbox edit; the page reads it at once", async () => {
      const r = await call(postApprove, tokenOwnerA, { body: { request_id: rid("ap"), campaign: "partner", stage: 4 } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.deepEqual({ ...r.body, outbox_id: null }, { ok: true, campaign: "partner", stage: 4, file: "04-copy.md", outbox_id: null, already_approved: false });
      const rows = await outbox(orgA, "marketing/flywheel/partner/04-copy.md");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].mode, "edit");
      assert.deepEqual(rows[0].edit, { op: "set_front_matter_key", key: "status", value: "approved" });
      const seen = await readFlywheel({ db, orgId: orgA, campaign: "partner", env: ENV });
      assert.match(seen.files["04-copy.md"].text, /^---\nstage: 4\nversion: \d+\nstatus: approved\n/);
      assert.equal(seen.files["04-copy.md"].source, "bundle-fallback");
    });

    test("a step with no file has nothing to approve", async () => {
      const r = await call(postApprove, tokenOwnerA, { body: { request_id: rid("ap6"), campaign: "partner", stage: 6 } });
      assert.equal(r.code, 400);
      assert.equal(r.body.field, "stage");
      const bad = await call(postApprove, tokenOwnerA, { body: { request_id: rid("ap7"), campaign: "partner", stage: 7 } });
      assert.equal(bad.body.field, "stage");
    });
  });

  describe("POST marketing/flywheel/spend-read", () => {
    test("reads the saved numbers as staff, words one conclusion, and queues 06-spend.md", async () => {
      const r = await call(postSpendRead, tokenOwnerA, { body: { request_id: rid("sp"), campaign: "partner" } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.window, spendWindow(new Date()));
      const ad84 = r.body.rows.find((x) => x.ad_number === "84");
      assert.ok(ad84, JSON.stringify(r.body.rows));
      assert.equal(ad84.spend_cents, 49801, "today's spend is not in the window");
      assert.equal(ad84.link_clicks, 60);
      assert.equal(ad84.cpl_cents, null, "no leads is no cost per lead, never $0");
      assert.equal(ad84.sales_meta, 0, "Meta's measured 0 is 0");
      assert.equal(r.body.unmatched.spend_cents, 7000);
      assert.equal(r.body.unmatched.ads, 1);
      assert.equal(r.body.totals.spend_cents, 56801);
      // 500 plays, 100 past 25%: most never reach the quarter mark, and no leads.
      assert.deepEqual(r.body.conclusion.points_to_stage, 4);
      assert.match(r.body.conclusion.text, /never reach the quarter mark/);
      const rows = await outbox(orgA, "marketing/flywheel/partner/06-spend.md");
      assert.equal(rows.length, 1);
      assert.match(rows[0].content, /^---\nstage: 6\nversion: 1\nstatus: draft\ninputs:\n {2}04-copy\.md: [0-9a-f]{8}\n/);
      assert.match(rows[0].content, /\| Ad 84 \| \$498\.01 \| 60 \| unknown \| 0 \| 0 \| 0 \|/);
      assert.match(rows[0].content, /## Review card/);
    });

    test("another company's numbers are never read", async () => {
      const r = await call(postSpendRead, tokenOwnerB, { body: { request_id: rid("spb"), campaign: "partner" } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.rows, []);
      assert.equal(r.body.conclusion.points_to_stage, null);
      assert.match(r.body.conclusion.text, /No ad spend is saved/);
    });
  });

  describe("POST marketing/flywheel/tweak", () => {
    test("adds one dated line to the owner notes; a blocked step keeps the note and says why it did not re-run", async () => {
      const r = await call(postTweak, tokenOwnerA, { body: { request_id: rid("tw"), campaign: "partner", stage: 4, note: "lead with the backdoor fear" } });
      assert.equal(r.code, 202, JSON.stringify(r.body));
      assert.match(r.body.line, /^\d{4}-\d{2}-\d{2} \| stage 4 \| lead with the backdoor fear$/);
      assert.equal(r.body.job, null);
      assert.equal(r.body.rerun.started, false);
      assert.match(r.body.rerun.reason, /Approve step 3/);
      const rows = await outbox(orgA, "marketing/flywheel/partner/00-OWNER-NOTES.md");
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0].edit, { op: "append_line_under_heading", heading: "## Notes", line: r.body.line });
      const seen = await readFlywheel({ db, orgId: orgA, campaign: "partner", env: ENV });
      assert.ok(seen.files["00-OWNER-NOTES.md"].text.trimEnd().endsWith(r.body.line), "appended, never rewritten");
      assert.match(seen.files["00-OWNER-NOTES.md"].text, /2026-08-31 \| stage 1 \| the avatar is assumed on purpose/);
    });

    test("step 6 re-runs at once (free); steps 1 and 2 say they are not on this page yet; an empty note is refused", async () => {
      const six = await call(postTweak, tokenOwnerA, { body: { request_id: rid("tw6"), campaign: "partner", stage: 6, note: "read the last 30 days" } });
      assert.equal(six.code, 202, JSON.stringify(six.body));
      assert.equal(six.body.rerun.started, true);
      assert.ok(six.body.spend && six.body.spend.ok);
      const one = await call(postTweak, tokenOwnerA, { body: { request_id: rid("tw1"), campaign: "partner", stage: 1, note: "more broker quotes" } });
      assert.equal(one.body.rerun.started, false);
      assert.match(one.body.rerun.reason, /slice 5a/);
      const empty = await call(postTweak, tokenOwnerA, { body: { request_id: rid("tw0"), campaign: "partner", stage: 4, note: "  " } });
      assert.equal(empty.code, 400);
      assert.equal(empty.body.field, "note");
    });
  });

  describe("POST marketing/flywheel/run", () => {
    test("steps 1 and 2 are not built here; step 4 waits on step 3's approval", async () => {
      const one = await call(postRun, tokenOwnerA, { body: { request_id: rid("r1"), campaign: "partner", stage: 1 } });
      assert.equal(one.code, 409);
      assert.equal(one.body.error, "not_built");
      const four = await call(postRun, tokenOwnerA, { body: { request_id: rid("r4"), campaign: "partner", stage: 4 } });
      assert.equal(four.code, 409);
      assert.equal(four.body.error, "blocked");
      assert.match(four.body.message, /Approve step 3/);
    });

    test("step 3 is handed to the Write offer path with the campaign's own files", async () => {
      let seen = null;
      const offerHandler = async (req, r) => { seen = req.body; r.status(202).json({ ok: true, started: true, already_running: false, job: { id: "o1" } }); };
      const r = await call(postRun, tokenOwnerA, { body: { request_id: rid("r3"), campaign: "partner", stage: 3 }, deps: { offerHandler } });
      assert.equal(r.code, 202);
      assert.equal(r.body.stage, 3);
      assert.equal(seen.campaign, "partner");
      assert.match(seen.avatar_summary, /\S/);
      assert.match(seen.owner_notes, /the avatar is assumed on purpose/);
    });

    test("step 6 runs now and answers the read", async () => {
      const r = await call(postRun, tokenOwnerA, { body: { request_id: rid("r6"), campaign: "partner", stage: 6 } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.stage, 6);
      assert.ok(Array.isArray(r.body.rows));
    });

    test("step 4 with the offer approved: no key is 503; with a key one job, one in flight, the same answer for the same request_id", async () => {
      const deps = readyReader();
      const noKey = await call(postRun, tokenOwnerA, { body: { request_id: rid("r4a"), campaign: "capital-blueprint", stage: 4 }, deps });
      assert.equal(noKey.code, 503);
      assert.equal(noKey.body.error, "no_model");

      ENV.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
      try {
        const before = wakes;
        const id = rid("r4b");
        const first = await call(postRun, tokenOwnerA, { body: { request_id: id, campaign: "capital-blueprint", stage: 4, note: "say the price" }, deps });
        assert.equal(first.code, 202, JSON.stringify(first.body));
        assert.equal(first.body.started, true);
        assert.equal(first.body.already_running, false);
        assert.equal(first.body.job.kind, "flywheel_stage");
        assert.equal(first.body.job.stage, 4);
        assert.equal(wakes, before + 1);
        const row = (await db.query(`SELECT * FROM marketing_jobs WHERE id = $1`, [first.body.job.id])).rows[0];
        assert.equal(row.status, "queued");
        assert.equal(row.requested_by, ownerA);
        assert.equal(row.payload.campaign, "capital-blueprint");
        assert.equal(row.payload.note, "say the price");

        const repeat = await call(postRun, tokenOwnerA, { body: { request_id: id, campaign: "capital-blueprint", stage: 4 }, deps });
        assert.deepEqual(repeat.body, first.body);
        const second = await call(postRun, tokenOwnerA, { body: { request_id: rid("r4c"), campaign: "capital-blueprint", stage: 4 }, deps });
        assert.equal(second.code, 202);
        assert.equal(second.body.started, false);
        assert.equal(second.body.already_running, true);
        assert.equal(second.body.job.id, first.body.job.id);
        const count = (await db.query(
          `SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1 AND kind = 'flywheel_stage' AND status IN ('queued','running')`, [orgA]
        )).rows[0].n;
        assert.equal(count, 1);
      } finally {
        delete ENV.ANTHROPIC_API_KEY;
      }
    });

    test("the month cap reached is 409 cap_hit, before any job", async () => {
      await db.query(
        `INSERT INTO marketing_model_usage (org_id, model, input_tokens, output_tokens, cost_usd) VALUES ($1, 'claude-opus-5-5', 1, 1, 300.000000)`, [orgB]);
      ENV.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
      try {
        const r = await call(postRun, tokenOwnerB, { body: { request_id: rid("cap"), campaign: "capital-blueprint", stage: 4 }, deps: readyReader() });
        assert.equal(r.code, 409, JSON.stringify(r.body));
        assert.equal(r.body.error, "cap_hit");
        assert.match(r.body.message, /\$300 month cap/);
      } finally {
        delete ENV.ANTHROPIC_API_KEY;
      }
      const jobs = (await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1`, [orgB])).rows[0].n;
      assert.equal(jobs, 0);
    });
  });

  describe("the worker runs step 4 against the real tables", () => {
    test("every call is in the ledger under the job; the stamped 04-copy.md is queued; the row reads Done", async () => {
      const queued = (await db.query(
        `SELECT * FROM marketing_jobs WHERE org_id = $1 AND kind = 'flywheel_stage' AND status = 'queued'`, [orgA]
      )).rows[0];
      assert.ok(queued, "the job from the run test");
      const job = (await db.query(
        `UPDATE marketing_jobs SET status = 'running', claimed_at = now() WHERE id = $1 RETURNING *`, [queued.id]
      )).rows[0];
      const model = fakeModel({ dirty: { "reason-birch": true } });
      const result = await runStageJob(job, {
        db,
        env: { ANTHROPIC_API_KEY: "sk-ant-test-not-real" },
        deps: { call: model.call, reader: readerDeps(campaignFiles()) }
      });
      assert.equal(result.stage, 4, JSON.stringify(result).slice(0, 300));
      await finishJob(db, job.id, result);

      const usage = (await db.query(`SELECT model, cost_usd FROM marketing_model_usage WHERE job_id = $1`, [job.id])).rows;
      assert.equal(usage.length, model.calls.length, "one ledger row per model call");
      assert.ok(usage.every((u) => /^claude-(opus|sonnet)-5-5$/.test(u.model) && u.cost_usd != null));
      const saved = await outbox(orgA, "marketing/flywheel/capital-blueprint/04-copy.md");
      assert.equal(saved.length, 1);
      assert.equal(saved[0].op_id, `flywheel:${job.id}:04-copy.md`);
      assert.match(saved[0].content, /^---\nstage: 4\nversion: 1\nstatus: draft\ninputs:\n {2}03-offer\.md: [0-9a-f]{8}\n/);
      assert.match(saved[0].content, /counts:\n {2}hooks: \d+\n {2}humanizerPassRun: 1\n/);

      const jobs = await latestStageJobs(db, { orgId: orgA, campaign: "capital-blueprint" });
      assert.equal(jobs[4].job.status, "done");
      assert.ok(jobs[4].spentUsd > 0, "the run's own spend, from the ledger");
      assert.equal(jobs[4].job.result.repo_path, "marketing/flywheel/capital-blueprint/04-copy.md");

      const page = await call(getFlywheel, tokenOwnerA, { method: "GET", query: { campaign: "capital-blueprint" } });
      assert.equal(page.code, 200);
      assert.equal(page.body.stages[3].source, "outbox-pending", "the saved copy shows before the commit lands");
      assert.equal(page.body.stages[3].run.status, "done");
      assert.match(page.body.stages[3].review_card_md, /^## Review card/);
    });
  });
});
