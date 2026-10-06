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
import postTweak, { OFFER_HANDED } from "../../api/marketing/flywheel/tweak.mjs";
import postSpendRead from "../../api/marketing/flywheel/spend-read.mjs";
import postRun from "../../api/marketing/flywheel/run.mjs";
import { readFlywheel } from "../marketing/flywheel/reader.mjs";
import { spendWindow } from "../marketing/flywheel/spend-read.mjs";
import { latestStageJobs } from "../marketing/flywheel/store.mjs";
import { run as runStageJob } from "../marketing/flywheel/stage-job.mjs";
import { finishJob } from "../marketing/jobs.mjs";
import { addDays } from "../metro2/dates.mjs";
import { campaignFiles, readerDeps, fakeModel } from "../marketing/fixtures/flywheel-fakes.mjs";
import costsRoute from "../../api/marketing/costs.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { enqueueRepoWrite } from "../repo/outbox.mjs";
import { stampStage, hashOf, bodyOf } from "../marketing/flywheel/stamp.mjs";

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
      // Unit GL: rows 1 and 2 run from the card (X1's avatar, X2's market research).
      assert.equal(r.body.stages[0].state_word, "Not run yet");
      assert.deepEqual(r.body.stages[0].can_run, { ok: true, reason: null });
      assert.deepEqual(r.body.stages[1].can_run, { ok: true, reason: null });
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
      assert.equal(seen.files["04-copy.md"].source, "outbox-pending", "a save not yet in git says so");
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

    // Wave 2b merge: step 1 is unit X1's (a tweak also starts a new avatar run, and with no
    // Anthropic key on the site it is refused first, saving nothing). Unit GL: step 2 now
    // re-runs X2's market research with the note; with no key the note is kept and it says why.
    test("step 6 re-runs at once (free); step 2 keeps the note and says there is no key; step 1 is X1's; an empty note is refused", async () => {
      const six = await call(postTweak, tokenOwnerA, { body: { request_id: rid("tw6"), campaign: "partner", stage: 6, note: "read the last 30 days" } });
      assert.equal(six.code, 202, JSON.stringify(six.body));
      assert.equal(six.body.rerun.started, true);
      assert.ok(six.body.spend && six.body.spend.ok);
      const two = await call(postTweak, tokenOwnerA, { body: { request_id: rid("tw2"), campaign: "partner", stage: 2, note: "more broker quotes" } });
      assert.equal(two.code, 202, JSON.stringify(two.body));
      assert.equal(two.body.rerun.started, false);
      assert.match(two.body.rerun.reason, /Anthropic key/);
      assert.equal(two.body.job, null);
      const before = (await outbox(orgA, "marketing/flywheel/partner/00-OWNER-NOTES.md")).length;
      const one = await call(postTweak, tokenOwnerA, { body: { request_id: rid("tw1"), campaign: "partner", stage: 1, note: "more broker quotes" } });
      assert.equal(one.code, 503);
      assert.equal(one.body.error, "no_model");
      assert.equal((await outbox(orgA, "marketing/flywheel/partner/00-OWNER-NOTES.md")).length, before, "refused before anything is saved");
      const empty = await call(postTweak, tokenOwnerA, { body: { request_id: rid("tw0"), campaign: "partner", stage: 4, note: "  " } });
      assert.equal(empty.code, 400);
      assert.equal(empty.body.field, "note");
    });

    test("step 3 hands the note to Write the offer once; a replayed request_id reads true, never 'nothing happened'", async () => {
      let calls = 0;
      let seen = null;
      const offerHandler = async (req, r) => {
        calls++;
        seen = req.body;
        r.status(202).json({ ok: true, started: true, already_running: false, job: { id: "o-tw3" } });
      };
      const id = rid("tw3");
      const body = { request_id: id, campaign: "partner", stage: 3, note: "price it at 297" };
      const first = await call(postTweak, tokenOwnerA, { body, deps: { offerHandler } });
      assert.equal(first.code, 202, JSON.stringify(first.body));
      assert.equal(first.body.rerun.started, true);
      assert.equal(first.body.rerun.via, "offer");
      assert.deepEqual(first.body.job, { id: "o-tw3" });
      assert.equal(calls, 1);
      assert.ok(seen.owner_notes.includes(first.body.line), "the new line rides in the offer's notes");

      // Double tap / offline retry: the saved answer comes back and the offer is not started again.
      const replay = await call(postTweak, tokenOwnerA, { body, deps: { offerHandler } });
      assert.equal(replay.code, 202, JSON.stringify(replay.body));
      assert.equal(calls, 1, "a replay never starts the offer a second time");
      assert.equal(replay.body.line, first.body.line);
      assert.equal(replay.body.rerun.via, "offer");
      assert.equal(replay.body.rerun.reason, OFFER_HANDED);
      assert.doesNotMatch(replay.body.rerun.reason, /^pending$/);
    });
  });

  describe("POST marketing/flywheel/run", () => {
    // Wave 2b merge: steps 1 and 2 are handed to units X1 and X2, which answer in their own
    // words (with no Anthropic key on the site, X1 refuses with no_model and queues nothing).
    test("step 1 is handed to X1's Build the avatar; step 4 waits on step 3's approval", async () => {
      const one = await call(postRun, tokenOwnerA, { body: { request_id: rid("r1"), campaign: "partner", stage: 1 } });
      assert.equal(one.code, 503);
      assert.equal(one.body.error, "no_model");
      const avatars = await db.query("SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1 AND kind = 'avatar'", [orgA]);
      assert.equal(avatars.rows[0].n, 0);
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

  // Unit GL (owner order: the Blueprint test runs end to end through the dashboard).
  // ENV has no GITHUB_REPO_TOKEN, so every save waits in repo_outbox ('no_token') and
  // every step reads the database's copy through the one stage reader.
  describe("unit GL: the Blueprint chain with no GitHub token", () => {
    const BASE = "marketing/flywheel/capital-blueprint";
    const CARD = "\n## Review card\n\n**What this decided:** x\n";
    const FILES = campaignFiles();
    let offerJob;
    let offerText;

    const queue = (opId, path, content) => withTransaction(db, (tx) => enqueueRepoWrite(tx, { orgId: orgA, opId, path, mode: "replace", content }));
    const draft = (text) => text.replace(/\nstatus: approved\n/, "\nstatus: draft\n");

    async function workOne() {
      const queued = (await db.query(
        `UPDATE marketing_jobs SET status = 'running', claimed_at = now()
          WHERE id = (SELECT id FROM marketing_jobs WHERE org_id = $1 AND kind = 'flywheel_stage' AND status = 'queued' ORDER BY created_at LIMIT 1)
          RETURNING *`, [orgA])).rows[0];
      assert.ok(queued, "a queued step");
      const result = await runStageJob(queued, { db, env: { ANTHROPIC_API_KEY: "sk-ant-test-not-real" }, deps: { call: fakeModel().call } });
      await finishJob(db, queued.id, result);
      return queued;
    }

    test("steps 1 and 2 saved and approved from the card wait in the outbox, and the page reads them", async () => {
      await queue(`gl-avatar-${RUN}`, `${BASE}/01-avatar.md`, draft(FILES["01-avatar.md"]));
      await queue(`gl-bank-${RUN}`, `${BASE}/01-avatar/Market_Language_Bank.md`, FILES["01-avatar/Market_Language_Bank.md"]);
      await queue(`gl-research-${RUN}`, `${BASE}/02-ad-research.md`, draft(FILES["02-ad-research.md"]));
      for (const stage of [1, 2]) {
        const r = await call(postApprove, tokenOwnerA, { body: { request_id: rid(`gl-ap${stage}`), campaign: "capital-blueprint", stage } });
        assert.equal(r.code, 200, JSON.stringify(r.body));
        assert.equal(r.body.already_approved, false);
      }
      const page = await call(getFlywheel, tokenOwnerA, { method: "GET", query: { campaign: "capital-blueprint" } });
      assert.equal(page.body.source, "bundle-fallback");
      assert.deepEqual(page.body.stages.slice(0, 2).map((s) => [s.state, s.approved, s.source]), [["READY", true, "outbox-pending"], ["READY", true, "outbox-pending"]]);
      assert.equal(page.body.stages[2].can_run.ok, true, "the offer can run");
    });

    test("a finished offer run waits on row 3: its offer and card, Approve on, and GET marketing/costs reads its cost", async () => {
      offerJob = (await db.query(
        `INSERT INTO marketing_jobs (org_id, kind, status, payload, result, requested_by, claimed_at, finished_at)
         VALUES ($1, 'offer', 'done', $2::jsonb, $3::jsonb, $4, now() - interval '5 minutes', now()) RETURNING *`,
        [orgA,
          JSON.stringify({ campaign: "capital-blueprint", avatarSummary: bodyOf(FILES["01-avatar.md"]), adResearchSummary: bodyOf(FILES["02-ad-research.md"]),
            ownerNotes: "", cut: { avatar: false, adResearch: false, ownerNotes: false }, today: "2026-10-06" }),
          JSON.stringify({
            campaign: "capital-blueprint", asOf: "2026-10-06",
            document: `# Offer — capital-blueprint\nAs of 2026-10-06.\n\n## 1. The offer in one sentence\n\nThe Capital Blueprint: a funding plan in 30 days for $5,000.${CARD}`,
            reviewCard: { markdown: "## Review card\n\n**What this decided:** x" },
            counts: { priceSet: 1, bonuses: 3, guarantees: 2, valueEquationScores: 4 },
            checks: { gate: { passes: true, misses: [] } },
            model: "claude-opus-5-5",
            usage: { calls: [{ step: "candidates", model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 500 }], input_tokens: 1000, output_tokens: 500 }
          }),
          ownerA]
      )).rows[0];
      const page = await call(getFlywheel, tokenOwnerA, { method: "GET", query: { campaign: "capital-blueprint" } });
      const row3 = page.body.stages[2];
      assert.equal(row3.state, "MISSING");
      assert.equal(row3.state_word, "Done");
      assert.match(row3.sentence, /^Done\. A new offer is ready to read \(written \w+ \d+\)\. Approve saves it as step 3\.$/);
      assert.equal(row3.can_approve, true);
      assert.equal(row3.offer_waiting.job_id, offerJob.id);
      assert.match(row3.document_md, /a funding plan in 30 days for \$5,000/);
      assert.equal(row3.run.kind, "offer");

      const costs = await call(costsRoute, tokenOwnerA, { method: "GET" });
      assert.equal(costs.code, 200, JSON.stringify(costs.body));
      assert.equal(costs.body.kinds.offer.job_id, offerJob.id);
      assert.equal(costs.body.kinds.offer.last_cost_usd, 0.014, "1,000 in at $4 and 500 out at $20 per million");
      assert.equal(costs.body.kinds.copy.last_calls > 0, true, "the copy line reads the step 4 run on the ledger");
    });

    test("Approve on row 3 writes the stamped 03-offer.md from the run in one save, keeps the stamp on the run, once", async () => {
      const id = rid("gl-ap3");
      const r = await call(postApprove, tokenOwnerA, { body: { request_id: id, campaign: "capital-blueprint", stage: 3 } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.written_from_job, offerJob.id);
      assert.equal(r.body.version, 1);
      const rows = await outbox(orgA, `${BASE}/03-offer.md`);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].op_id, `flywheel-offer:${offerJob.id}`);
      assert.equal(rows[0].mode, "replace");
      offerText = rows[0].content;
      assert.match(offerText, new RegExp(`^---\\nstage: 3\\nversion: 1\\nstatus: approved\\njob: ${offerJob.id}\\ninputs:\\n {2}01-avatar\\.md: [0-9a-f]{8}\\n {2}02-ad-research\\.md: [0-9a-f]{8}\\ncounts:\\n`));
      const run = (await db.query(`SELECT result FROM marketing_jobs WHERE id = $1`, [offerJob.id])).rows[0];
      assert.equal(run.result.stage_file.version, 1);
      assert.equal(run.result.stage_file.approved_by, ownerA);
      assert.equal(run.result.stage_file.outbox_id, Number(rows[0].id), "pg hands bigint back as text");
      assert.ok(run.result.document, "the run keeps its own answer");

      const replay = await call(postApprove, tokenOwnerA, { body: { request_id: id, campaign: "capital-blueprint", stage: 3 } });
      assert.deepEqual(replay.body, r.body);
      const again = await call(postApprove, tokenOwnerA, { body: { request_id: rid("gl-ap3b"), campaign: "capital-blueprint", stage: 3 } });
      assert.equal(again.code, 200);
      assert.equal(again.body.already_approved, true, "the run was written once; a second tap only re-approves");
      assert.equal((await outbox(orgA, `${BASE}/03-offer.md`)).filter((x) => x.mode === "replace").length, 1);

      const page = await call(getFlywheel, tokenOwnerA, { method: "GET", query: { campaign: "capital-blueprint" } });
      assert.equal(page.body.stages[2].state, "READY", page.body.stages[2].sentence);
      assert.equal(page.body.stages[2].approved, true);
      assert.equal(page.body.stages[2].offer_waiting, null);
      assert.equal(page.body.stages[2].source, "outbox-pending");
      assert.deepEqual(page.body.stages[3].can_run, { ok: true, reason: null }, "the copy can run now");
    });

    test("step 4 runs from the card and reads that approved offer from the database", async () => {
      ENV.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
      try {
        const r = await call(postRun, tokenOwnerA, { body: { request_id: rid("gl-r4"), campaign: "capital-blueprint", stage: 4 } });
        assert.equal(r.code, 202, JSON.stringify(r.body));
        assert.equal(r.body.started, true);
      } finally {
        delete ENV.ANTHROPIC_API_KEY;
      }
      const job = await workOne();
      const saved = (await db.query(`SELECT content FROM repo_outbox WHERE org_id = $1 AND op_id = $2`, [orgA, `flywheel:${job.id}:04-copy.md`])).rows[0];
      assert.ok(saved, "the copy is queued for the repo");
      assert.match(saved.content, new RegExp(`\\n {2}03-offer\\.md: ${hashOf(offerText)}\\n`), "built on the approved offer");
    });

    test("step 5 runs from the card and reads the approved offer and copy from the database", async () => {
      const copy = stampStage({ stage: 4, version: 9, status: "draft",
        inputs: { "03-offer.md": hashOf(offerText), "01-avatar/Market_Language_Bank.md": hashOf(FILES["01-avatar/Market_Language_Bank.md"]) },
        counts: { hooks: 12, humanizerPassRun: 1, distinctReasons: 15 }, body: `# Copy for the Blueprint${CARD}` });
      await queue(`gl-copy-${RUN}`, `${BASE}/04-copy.md`, copy);
      const ap = await call(postApprove, tokenOwnerA, { body: { request_id: rid("gl-ap4"), campaign: "capital-blueprint", stage: 4 } });
      assert.equal(ap.code, 200, JSON.stringify(ap.body));
      ENV.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
      try {
        const r = await call(postRun, tokenOwnerA, { body: { request_id: rid("gl-r5"), campaign: "capital-blueprint", stage: 5 } });
        assert.equal(r.code, 202, JSON.stringify(r.body));
        assert.equal(r.body.started, true);
      } finally {
        delete ENV.ANTHROPIC_API_KEY;
      }
      const job = await workOne();
      const saved = (await db.query(`SELECT content FROM repo_outbox WHERE org_id = $1 AND op_id = $2`, [orgA, `flywheel:${job.id}:05-ad-strategy.md`])).rows[0];
      assert.ok(saved, "the strategy is queued for the repo");
      assert.match(saved.content, new RegExp(`\\n {2}04-copy\\.md: ${hashOf(copy)}\\n`));
      assert.match(saved.content, new RegExp(`\\n {2}03-offer\\.md: ${hashOf(offerText)}\\n`));
      const costs = await call(costsRoute, tokenOwnerA, { method: "GET" });
      assert.equal(costs.body.kinds.ad_strategy.job_id, job.id, "the strategy line reads this run");
    });

    test("Tweak on step 2 queues the note and starts X2's market research with it", async () => {
      ENV.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
      try {
        const r = await call(postTweak, tokenOwnerA, { body: { request_id: rid("gl-tw2"), campaign: "capital-blueprint", stage: 2, note: "look at bank overlays" } });
        assert.equal(r.code, 202, JSON.stringify(r.body));
        assert.equal(r.body.rerun.started, true);
        assert.equal(r.body.job.stage, 2);
        const row = (await db.query(`SELECT kind, status, payload, requested_by FROM marketing_jobs WHERE id = $1`, [r.body.job.id])).rows[0];
        assert.equal(row.kind, "flywheel_stage");
        assert.equal(row.status, "queued");
        assert.equal(row.payload.note, "look at bank overlays");
        assert.equal(row.requested_by, ownerA);
        const again = await call(postTweak, tokenOwnerA, { body: { request_id: rid("gl-tw2b"), campaign: "capital-blueprint", stage: 2, note: "and the brokers" } });
        assert.equal(again.body.rerun.started, false);
        assert.equal(again.body.job.id, r.body.job.id, "one run in flight");
      } finally {
        delete ENV.ANTHROPIC_API_KEY;
      }
    });
  });
});
