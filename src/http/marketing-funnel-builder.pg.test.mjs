// The funnel builder (build unit X4) against real Postgres: migration 425's
// rules, the create / rename / build / push-live routes, the build and push jobs
// with a fake model and a fake ClickFunnels, the two reads, and the track door's
// lookup. Lives under src/http/ because npm test globs src/** and scripts/**
// only (CLAUDE.md §12); it imports the api/ handlers.
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations and db/seed. Without DATABASE_URL every
// test skips, and a skipped .pg.test.mjs is not green.
//
// THE FAKE CLICKFUNNELS (src/marketing/fixtures/fake-clickfunnels.mjs, X4F) is
// the real provider (src/messaging/providers/clickfunnels-pages.mjs) with a fake
// fetch behind it, answering the way the live workspace did on 2026-10-06: a
// page is served on apply.fundhub.ai only as a step of a funnel on that domain.
// The proof is at the HTTP level: every request is recorded, and the pages and
// funnels that were there get no PUT, no POST and no DELETE.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import createHandler from "../../api/marketing/funnels/create.mjs";
import renameHandler from "../../api/marketing/funnels/rename.mjs";
import buildHandler from "../../api/marketing/funnels/build.mjs";
import pushHandler from "../../api/marketing/funnels/push-live.mjs";
import funnelHandler from "../../api/marketing/funnel.mjs";
import funnelsHandler from "../../api/marketing/funnels.mjs";
import { runFunnelJob } from "../marketing/funnel-worker.mjs";
import { pageMarker, stepMarker, cfFunnelName, cfFunnelPath, STEP_ORDER } from "../marketing/funnel-push.mjs";
import { fakeClickFunnels, APPLY_DOMAIN_ID, SUB_HOST } from "../marketing/fixtures/fake-clickfunnels.mjs";
import { tagMeta } from "../marketing/funnel-tracking.mjs";
import { findFunnelPage } from "../funnel/track.mjs";
import { FUNNEL_KEYS } from "../marketing/settings-store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOOD = JSON.parse(fs.readFileSync(path.resolve(HERE, "../marketing/fixtures/funnel-copy-good.json"), "utf8"));

const ORG_SLUG = "mfb-pg-test";
const EMAIL_TAG = "mfb_pg_test";
const ENV = {
  ANTHROPIC_API_KEY: "sk-ant-test-not-real",
  CLICKFUNNELS_API_KEY: "cf_test_key", CLICKFUNNELS_SUBDOMAIN: "acme", CLICKFUNNELS_WORKSPACE_ID: "77",
  ADAPTERS_DRY_RUN: "0", META_PIXEL_ID: "1234567890"
};

let seq = 0;
const rid = (tag) => `mfb-pg-${tag}-${process.pid}-${Date.now()}-${++seq}`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

async function call(handler, token, { method = "POST", body, query = {}, deps = {} } = {}) {
  const r = res();
  await handler({ method, headers: token ? { authorization: "Bearer " + token } : {}, query, body }, r,
    { db, env: ENV, wake: async () => ({ ok: true, status: 202, reason: null }), liveTaken: async () => ({ ok: true, taken: new Set() }), ...deps });
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}

const PAGE_POST = "/api/v2/workspaces/77/pages/custom_html";
const FUNNEL_POST = "/api/v2/workspaces/77/funnels";
const pagePosts = (cfk) => cfk.writes().filter((c) => c.method === "POST" && c.path === PAGE_POST);
const funnelPosts = (cfk) => cfk.writes().filter((c) => c.method === "POST" && c.path === FUNNEL_POST);
const PUSH_DEPS = (cfk) => ({ cf: cfk.cf, sleep: async () => {}, proofWaitMs: 0 });

const fakeModel = (json = GOOD) => {
  const asked = [];
  const fn = async (args) => {
    asked.push(args);
    return { mode: "live", error: null, json: structuredClone(json), servedModel: "claude-opus-5-5",
      usage: { input_tokens: 4000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  };
  return { fn, asked };
};

describe("the funnel builder", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, ownerId, tokenOwner, tokenCloser;

  async function cleanup() {
    const o = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [ORG_SLUG])).rows[0];
    if (o) {
      await db.query(`DELETE FROM marketing_model_usage WHERE org_id = $1`, [o.id]);
      await db.query(`DELETE FROM repo_outbox WHERE org_id = $1`, [o.id]);
      await db.query(`DELETE FROM marketing_funnel_pages WHERE org_id = $1`, [o.id]);
      await db.query(`DELETE FROM marketing_jobs WHERE org_id = $1`, [o.id]);
      await db.query(`DELETE FROM marketing_requests WHERE org_id = $1`, [o.id]);
      await db.query(`DELETE FROM marketing_funnels WHERE org_id = $1`, [o.id]);
    }
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug = $1`, [ORG_SLUG]); } catch { /* reused next run */ }
  }

  async function staffIn(role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}@example.com`, `Funnel builder ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  const funnelRow = async (id) => (await db.query(`SELECT * FROM marketing_funnels WHERE id = $1`, [id])).rows[0];
  const pageRows = async (id) => (await db.query(`SELECT * FROM marketing_funnel_pages WHERE funnel_id = $1 ORDER BY position`, [id])).rows;
  const jobRow = async (id) => (await db.query(`SELECT * FROM marketing_jobs WHERE id = $1`, [id])).rows[0];
  const create = (body, deps) => call(createHandler, tokenOwner, { body: { request_id: rid("create"), offer_key: "capital_blueprint", ...body }, deps });

  before(async () => {
    await cleanup();
    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'Funnel builder fixture')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [ORG_SLUG]
    )).rows[0].id;
    const owner = await staffIn("owner", "owner");
    ownerId = owner.id;
    tokenOwner = owner.token;
    tokenCloser = (await staffIn("closer", "closer")).token;
  });

  after(async () => { await cleanup(); await close(); });

  // ── the gate ──────────────────────────────────────────────────────────────

  test("no session 401; a closer 403; nothing is made", async () => {
    assert.equal((await call(createHandler, null, { body: { request_id: rid("g"), offer_key: "capital_blueprint" } })).code, 401);
    for (const h of [createHandler, renameHandler, buildHandler, pushHandler]) {
      assert.equal((await call(h, tokenCloser, { body: { request_id: rid("g") } })).code, 403);
    }
    assert.equal((await call(funnelHandler, tokenCloser, { method: "GET", query: { id: "00000000-0000-4000-8000-000000000000" } })).code, 403);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_funnels WHERE org_id = $1`, [org])).rows[0].n, 0);
  });

  // ── create: the address, the tag, the UTMs ───────────────────────────────

  // Two funnels mapped by hand before the builder, like book_call (/watch) and
  // roadmap_147 (/roadmap) on the live database: no kind, no tag.
  const handMapped = {};
  test("setup: two funnels mapped by hand, with no tag", async () => {
    for (const [key, url, lane] of [["book_call", "https://apply.fundhub.ai/watch", "sorting"], ["roadmap_147", "https://apply.fundhub.ai/roadmap", "uwiq"]]) {
      handMapped[key] = (await db.query(
        `INSERT INTO marketing_funnels (org_id, key, name, landing_url, lane, book_call)
         VALUES ($1, $2, $3, $4, $5::ad_lane, $6) RETURNING *`,
        [org, key, key, url, lane, key === "book_call"])).rows[0];
      assert.equal(handMapped[key].tag, null);
      assert.equal(handMapped[key].kind, null);
    }
  });

  let blueprint;
  test("create: /blueprint, tag fnl-blueprint, the uwiq UTMs, three draft pages, a build job", async () => {
    const r = await create({});
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const f = r.body.funnel;
    blueprint = f;
    assert.deepEqual(Object.keys(f), [...FUNNEL_KEYS]);
    assert.equal(f.path, "/blueprint");
    assert.equal(f.url, "https://apply.fundhub.ai/blueprint");
    assert.equal(f.landing_url, "https://apply.fundhub.ai/blueprint");
    assert.equal(f.tag, "fnl-blueprint");
    assert.equal(f.key, "blueprint");
    assert.equal(f.kind, "book_a_call");
    assert.equal(f.status, "draft");
    assert.equal(f.offer_key, "capital_blueprint");
    assert.equal(f.lane, "uwiq");
    assert.equal(f.utm_campaign, "uwiq");
    assert.equal(f.utm_template, "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content={ad_number}");
    assert.equal(f.book_call, true);
    assert.equal(f.active, false, "a draft takes no ads");
    assert.equal(f.created_by, ownerId);
    assert.equal(f.events_seen, 0);
    assert.deepEqual(f.pages.map((p) => [p.position, p.role, p.path, p.status]), [
      [1, "landing", "/blueprint", "empty"], [2, "booking", "/blueprint-book", "empty"], [3, "thank_you", "/blueprint-thank-you", "empty"]
    ]);
    assert.equal(r.body.job.kind, "funnel");
    assert.equal(r.body.job.status, "queued");
    assert.deepEqual(r.body.worker, { started: true, reason: null });
    const job = await jobRow(r.body.job.id);
    assert.equal(job.payload.funnel_id, f.id);
    assert.equal(job.requested_by, ownerId);
  });

  test("create tags the funnels mapped by hand by the same rule, in the database only (X4F)", async () => {
    for (const [key, tag] of [["book_call", "fnl-book-call"], ["roadmap_147", "fnl-roadmap-147"]]) {
      const now = (await db.query(`SELECT * FROM marketing_funnels WHERE id = $1`, [handMapped[key].id])).rows[0];
      assert.equal(now.tag, tag, key);
      assert.equal(now.kind, null, "still mapped by hand");
      assert.equal(now.landing_url, handMapped[key].landing_url, "its address is untouched");
      assert.equal(now.status, handMapped[key].status);
      assert.equal(now.active, handMapped[key].active);
      assert.equal(new Date(now.updated_at).getTime(), new Date(handMapped[key].updated_at).getTime(), "updated_at is left alone");
    }
    // A tag, once set, never changes (425), so a second create leaves them as they are.
    await assert.rejects(db.query(`UPDATE marketing_funnels SET tag = 'fnl-other' WHERE id = $1`, [handMapped.book_call.id]), /tag never changes/);
  });

  test("create again: /blueprint-2; a live ClickFunnels page on /blueprint-3-book moves the third to /blueprint-4", async () => {
    const second = await create({ build: false });
    assert.equal(second.code, 200, JSON.stringify(second.body));
    assert.equal(second.body.funnel.path, "/blueprint-2");
    assert.equal(second.body.funnel.tag, "fnl-blueprint-2");
    assert.equal(second.body.job, null);
    const third = await create({ build: false }, { liveTaken: async () => ({ ok: true, taken: new Set(["/blueprint-3-book"]) }) });
    assert.equal(third.body.funnel.path, "/blueprint-4");
  });

  test("create: a typed address is checked; ClickFunnels unreadable makes nothing", async () => {
    const typed = await create({ path: "Capital VIP", build: false });
    assert.equal(typed.body.funnel.path, "/capital-vip");
    const taken = await create({ path: "capital-vip" });
    assert.equal(taken.code, 400);
    assert.equal(taken.body.field, "path");
    const reserved = await create({ path: "watch" });
    assert.equal(reserved.code, 400);
    assert.match(reserved.body.message, /already uses/);
    const before = (await db.query(`SELECT count(*)::int AS n FROM marketing_funnels WHERE org_id = $1`, [org])).rows[0].n;
    const down = await create({ path: "anything" }, { liveTaken: async () => ({ ok: false, error: "ClickFunnels could not be reached." }) });
    assert.equal(down.code, 503);
    assert.equal(down.body.error, "clickfunnels_unreadable");
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_funnels WHERE org_id = $1`, [org])).rows[0].n, before);
    const bad = await create({ offer_key: "slo_roadmap" });
    assert.equal(bad.code, 400);
    assert.equal(bad.body.field, "offer_key");
  });

  test("a repeated request_id answers the first save and makes nothing new", async () => {
    const body = { request_id: rid("again"), offer_key: "funding_dfy", build: false };
    const a = await call(createHandler, tokenOwner, { body });
    const b = await call(createHandler, tokenOwner, { body });
    assert.equal(a.body.funnel.id, b.body.funnel.id);
    assert.equal(a.body.funnel.path, "/funding");
    assert.equal(a.body.funnel.lane, "funding600");
  });

  // ── the rules in the database (migration 425) ────────────────────────────

  test("the database: a tag never changes, an address is used once, a page carries its tag", async () => {
    await assert.rejects(db.query(`UPDATE marketing_funnels SET tag = 'fnl-other' WHERE id = $1`, [blueprint.id]), /tag never changes/);
    await assert.rejects(db.query(`UPDATE marketing_funnels SET utm_campaign = 'nonsense' WHERE id = $1`, [blueprint.id]), /marketing_funnels_utm_ck|built_ck/);
    const pages = await pageRows(blueprint.id);
    const second = (await db.query(`SELECT id FROM marketing_funnels WHERE org_id = $1 AND path = '/blueprint-2'`, [org])).rows[0];
    await assert.rejects(db.query(`UPDATE marketing_funnel_pages SET path = '/blueprint' WHERE funnel_id = $1 AND role = 'landing'`, [second.id]), /marketing_funnel_pages_org_path_uq/);
    await assert.rejects(db.query(
      `UPDATE marketing_funnel_pages SET page_copy = '{}'::jsonb, html = '<html>no tag</html>', html_sha256 = $2, built_at = now() WHERE id = $1`,
      [pages[0].id, "a".repeat(64)]), /does not carry the funnel tag/);
    await assert.rejects(db.query(`UPDATE marketing_funnel_pages SET cf_page_id = '1', pushed_at = now(), live_url = 'https://x.y/z' WHERE id = $1`, [pages[0].id]), /pushed_ck/);
    await assert.rejects(db.query(
      `INSERT INTO marketing_funnels (org_id, key, name, landing_url, lane, book_call, kind, path, tag, utm_campaign, status)
       VALUES ($1, 'mismatch', 'x', 'https://apply.fundhub.ai/other', 'uwiq', true, 'book_a_call', '/mismatch', 'fnl-mismatch', 'uwiq', 'draft')`, [org]),
      /built_ck/);
  });

  // ── rename ───────────────────────────────────────────────────────────────

  test("rename: refused for a live ClickFunnels address, our own funnel's address and a reserved word", async () => {
    // /blueprint-4 was made with build: false, so nothing is in flight for it.
    const four = (await db.query(`SELECT id FROM marketing_funnels WHERE org_id = $1 AND path = '/blueprint-4'`, [org])).rows[0];
    const live = await call(renameHandler, tokenOwner, {
      body: { request_id: rid("ren"), id: four.id, path: "capital" },
      deps: { liveTaken: async () => ({ ok: true, taken: new Set(["/capital-book"]) }) }
    });
    assert.equal(live.code, 400);
    assert.equal(live.body.field, "path");
    assert.match(live.body.message, /\/capital-book is already a page/);
    const ours = await call(renameHandler, tokenOwner, { body: { request_id: rid("ren"), id: four.id, path: "blueprint-2" } });
    assert.equal(ours.code, 400);
    assert.equal(ours.body.field, "path");
    const reserved = await call(renameHandler, tokenOwner, { body: { request_id: rid("ren"), id: four.id, path: "roadmap" } });
    assert.equal(reserved.code, 400);
    assert.equal(reserved.body.field, "path");
    assert.equal((await funnelRow(four.id)).path, "/blueprint-4", "nothing moved");
    // While its pages are being written, a funnel is not renamed at all.
    const busy = await call(renameHandler, tokenOwner, { body: { request_id: rid("ren"), id: blueprint.id, path: "elsewhere" } });
    assert.equal(busy.code, 400);
    assert.equal(busy.body.field, "id");
    assert.match(busy.body.message, /being written or pushed/);
  });

  test("rename: a free address moves the funnel and its pages; the tag stays", async () => {
    const two = (await db.query(`SELECT id FROM marketing_funnels WHERE org_id = $1 AND path = '/blueprint-2'`, [org])).rows[0];
    const r = await call(renameHandler, tokenOwner, { body: { request_id: rid("ren"), id: two.id, path: "/blueprint-vip" } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.funnel.path, "/blueprint-vip");
    assert.equal(r.body.funnel.landing_url, "https://apply.fundhub.ai/blueprint-vip");
    assert.equal(r.body.funnel.tag, "fnl-blueprint-2");
    assert.deepEqual(r.body.funnel.pages.map((p) => p.path), ["/blueprint-vip", "/blueprint-vip-book", "/blueprint-vip-thank-you"]);
  });

  // ── build (fake model) ───────────────────────────────────────────────────

  test("build: one model call, checked words, three pages with the tag and the tracking; the cost is logged", async () => {
    const model = fakeModel();
    const out = await runFunnelJob(db, { jobId: blueprint.id && (await jobForFunnel(blueprint.id)).id, orgId: org, env: ENV,
      deps: { callModel: model.fn, readSources: () => ({ avatar: "", offer: "", copy: "", ownerNotes: "", files: {} }) } });
    assert.equal(out.status, "done", JSON.stringify(out));
    assert.equal(model.asked.length, 1);
    assert.equal(model.asked[0].provider, "anthropic");
    assert.equal(model.asked[0].model, "claude-opus-5-5");
    assert.ok(model.asked[0].outputSchema, "structured output");
    const pages = await pageRows(blueprint.id);
    for (const p of pages) {
      assert.ok(p.html.split("</head>")[0].includes(tagMeta("fnl-blueprint")), `${p.role}: tag in the head`);
      assert.match(p.html, /src="https:\/\/fundhub\.ai\/funnel\/fh-events\.js"/);
      assert.match(p.html, /src="https:\/\/fundhub\.ai\/funnel\/fh-attribution\.js"/);
      assert.match(p.html, /fbq\('init', '1234567890'\)/);
      assert.ok(p.built_at && p.page_copy);
    }
    const usage = (await db.query(`SELECT * FROM marketing_model_usage WHERE org_id = $1`, [org])).rows;
    assert.equal(usage.length, 1);
    assert.equal(usage[0].model, "claude-opus-5-5");
    assert.ok(Number(usage[0].cost_usd) > 0);
    assert.equal(out.result.checks, "passed");
  });

  async function jobForFunnel(funnelId) {
    return (await db.query(`SELECT * FROM marketing_jobs WHERE payload->>'funnel_id' = $1 ORDER BY created_at DESC LIMIT 1`, [funnelId])).rows[0];
  }

  test("build: words that fail the copy check twice save nothing and say why", async () => {
    const fd = (await db.query(`SELECT id FROM marketing_funnels WHERE org_id = $1 AND path = '/blueprint-4'`, [org])).rows[0];
    const queued = await call(buildHandler, tokenOwner, { body: { request_id: rid("b"), id: fd.id } });
    assert.equal(queued.code, 202, JSON.stringify(queued.body));
    assert.equal(queued.body.queued, true);
    const second = await call(buildHandler, tokenOwner, { body: { request_id: rid("b"), id: fd.id } });
    assert.equal(second.code, 400, "one build at a time");
    const bad = structuredClone(GOOD);
    bad.landing.headline = "FundHub has helped 437 owners";
    const model = fakeModel(bad);
    const out = await runFunnelJob(db, { jobId: queued.body.job.id, orgId: org, env: ENV, deps: { callModel: model.fn, readSources: () => ({ files: {} }) } });
    assert.equal(out.status, "failed");
    assert.equal(model.asked.length, 2, "one fix round");
    assert.match(model.asked[1].user, /FAILED THESE CHECKS/);
    assert.match((await jobRow(queued.body.job.id)).error, /copy check/);
    assert.ok((await pageRows(fd.id)).every((p) => p.html === null), "nothing saved");
  });

  // ── push live (fake ClickFunnels) ────────────────────────────────────────

  test("push-live: refused without the confirmed address, or before the pages are built", async () => {
    const wrong = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: blueprint.id, confirm_url: "https://apply.fundhub.ai/roadmap" } });
    assert.equal(wrong.code, 400);
    assert.equal(wrong.body.field, "confirm_url");
    const none = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: blueprint.id } });
    assert.equal(none.code, 400);
    const fd = (await db.query(`SELECT id, landing_url FROM marketing_funnels WHERE org_id = $1 AND path = '/blueprint-4'`, [org])).rows[0];
    const unbuilt = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: fd.id, confirm_url: fd.landing_url } });
    assert.equal(unbuilt.code, 400);
    assert.match(unbuilt.body.message, /Build the pages first/);
  });

  test("push-live: one ClickFunnels funnel on apply.fundhub.ai, three NEW pages in it in order, each proven; nothing that was there is touched", async () => {
    const cfk = fakeClickFunnels();
    const queued = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: blueprint.id, confirm_url: blueprint.landing_url } });
    assert.equal(queued.code, 202, JSON.stringify(queued.body));
    assert.equal(queued.body.job.kind, "funnel_push");
    assert.equal(queued.body.url, "https://apply.fundhub.ai/blueprint");
    const out = await runFunnelJob(db, { jobId: queued.body.job.id, orgId: org, env: ENV, deps: PUSH_DEPS(cfk) });
    assert.equal(out.status, "done", JSON.stringify(out));

    // One NEW ClickFunnels funnel, on the apply.fundhub.ai domain, named for our funnel row.
    const fposts = funnelPosts(cfk);
    assert.equal(fposts.length, 1);
    assert.deepEqual(fposts[0].body, { funnel: { name: cfFunnelName(blueprint), current_path: cfFunnelPath(blueprint), domain_id: APPLY_DOMAIN_ID, live_mode: true } });
    const cfFunnelId = String(out.result.cf_funnel_id);

    // Three NEW pages, each made inside that funnel, the landing page last.
    const pposts = pagePosts(cfk);
    assert.deepEqual(pposts.map((c) => c.body.page.current_path), ["/blueprint-thank-you", "/blueprint-book", "/blueprint"], "the landing page goes last");
    assert.ok(pposts.every((c) => String(c.body.page.funnel.funnel_id) === cfFunnelId), "every page is a step of our funnel");
    assert.ok(pposts.every((c) => !("head_code" in c.body.page)));
    assert.ok(cfk.writes().every((c) => c.method === "POST" || c.method === "PUT"), "no DELETE");

    const pages = await pageRows(blueprint.id);
    const ids = pages.map((p) => p.cf_page_id);
    assert.deepEqual(cfk.stepPages(cfFunnelId), ids, "in order: landing, booking, thank-you");
    const putIds = cfk.writes().filter((c) => c.method === "PUT").map((c) => c.path.split("/").pop());
    assert.equal(putIds.length, 3);
    assert.ok(putIds.every((id) => ids.includes(id)), "every PUT is on a page this push made");
    assert.deepEqual(cfk.touchedBefore(), [], "no request names a page or funnel that was there");
    for (const p of pages) {
      assert.equal(cfk.liveAddress(p.cf_page_id), `https://apply.fundhub.ai${p.path}`, `${p.role} is served at its own address`);
      assert.ok(cfk.pages.find((x) => String(x.id) === p.cf_page_id).html.includes(`<meta name="cf-page-token" content="cfp_${p.cf_page_id}">`), `${p.role}: its own token`);
    }
    assert.ok(cfk.calls.some((c) => c.host === "apply.fundhub.ai"), "proved by reading the live pages");

    const f = await funnelRow(blueprint.id);
    assert.equal(f.status, "live");
    assert.equal(f.active, true);
    assert.ok(f.live_at);
    assert.equal(f.landing_url, "https://apply.fundhub.ai/blueprint");
    assert.ok(pages.every((p) => p.cf_page_id && p.proved_at && p.sent_sha256 && p.live_url === `https://apply.fundhub.ai${p.path}`));

    // The three live pages are queued for the repo, in the funnel builder's own folder.
    const outbox = (await db.query(
      `SELECT path, mode, content FROM repo_outbox WHERE org_id = $1 AND op_id LIKE 'funnel-page-live-%' ORDER BY id`, [org])).rows;
    assert.deepEqual(outbox.map((r) => r.path), [
      "marketing/landing-pages/funnels/blueprint/thank-you.html",
      "marketing/landing-pages/funnels/blueprint/booking.html",
      "marketing/landing-pages/funnels/blueprint/landing.html"
    ]);
    assert.ok(outbox.every((r) => r.mode === "replace" && r.content.includes(tagMeta("fnl-blueprint"))));
  });

  test("a live funnel: its pages never change, it is never renamed, rebuilt or pushed again", async () => {
    const pages = await pageRows(blueprint.id);
    await assert.rejects(db.query(`UPDATE marketing_funnel_pages SET path = '/blueprint-new' WHERE id = $1`, [pages[0].id]), /never change/);
    await assert.rejects(db.query(`UPDATE marketing_funnel_pages SET cf_page_id = '25516164' WHERE id = $1`, [pages[0].id]), /never change/);
    await assert.rejects(db.query(`UPDATE marketing_funnels SET path = '/x' WHERE id = $1`, [blueprint.id]), /never changes/);
    const ren = await call(renameHandler, tokenOwner, { body: { request_id: rid("ren"), id: blueprint.id, path: "elsewhere" } });
    assert.equal(ren.code, 400);
    assert.match(ren.body.message, /is live/);
    const build = await call(buildHandler, tokenOwner, { body: { request_id: rid("b"), id: blueprint.id } });
    assert.equal(build.code, 400);
    const push = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: blueprint.id, confirm_url: blueprint.landing_url } });
    assert.equal(push.code, 400);
    assert.match(push.body.message, /already live/);
  });

  test("push: an address already on ClickFunnels that we did not make stops the push before anything is made", async () => {
    const vip = (await db.query(`SELECT * FROM marketing_funnels WHERE org_id = $1 AND path = '/blueprint-vip'`, [org])).rows[0];
    const job = await call(buildHandler, tokenOwner, { body: { request_id: rid("b"), id: vip.id } });
    assert.equal((await runFunnelJob(db, { jobId: job.body.job.id, orgId: org, env: ENV, deps: { callModel: fakeModel().fn, readSources: () => ({ files: {} }) } })).status, "done");
    const cfk = fakeClickFunnels();
    cfk.addStandalone({ name: "Somebody else's", description: "not ours", current_path: "/blueprint-vip-book" });
    cfk.calls.length = 0;
    const queued = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: vip.id, confirm_url: vip.landing_url } });
    const out = await runFunnelJob(db, { jobId: queued.body.job.id, orgId: org, env: ENV, deps: PUSH_DEPS(cfk) });
    assert.equal(out.status, "failed");
    assert.match((await jobRow(queued.body.job.id)).error, /already a page on ClickFunnels, and this machine did not make it/);
    assert.deepEqual(cfk.writes(), [], "nothing made, nothing changed");
    assert.ok((await pageRows(vip.id)).every((p) => p.cf_page_id === null));
  });

  test("push: a page this machine made before a crash is taken back by its marker, and the funnel by its name; nothing is made twice", async () => {
    const vip = (await db.query(`SELECT * FROM marketing_funnels WHERE org_id = $1 AND path = '/blueprint-vip'`, [org])).rows[0];
    const pages = await pageRows(vip.id);
    const thanks = pages.find((p) => p.role === "thank_you");
    const cfk = fakeClickFunnels();
    const made = await cfk.cf.createFunnel({ env: ENV, workspace: "77", name: cfFunnelName(vip), path: cfFunnelPath(vip), domainId: String(APPLY_DOMAIN_ID) });
    const early = await cfk.cf.createCustomHtmlPage({ env: ENV, workspace: "77", funnelId: made.id, sortOrder: 0, name: "made before a crash",
      description: pageMarker(vip, thanks), html: thanks.html, path: "/blueprint-vip-thank-you" });
    assert.equal(early.ok, true, early.error);
    cfk.calls.length = 0;
    const queued = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: vip.id, confirm_url: vip.landing_url } });
    const out = await runFunnelJob(db, { jobId: queued.body.job.id, orgId: org, env: ENV, deps: PUSH_DEPS(cfk) });
    assert.equal(out.status, "done", JSON.stringify(out));
    assert.equal(out.result.adopted, 1);
    assert.equal(out.result.created, 2);
    assert.equal(out.result.funnel_made, false);
    assert.equal(funnelPosts(cfk).length, 0, "no second funnel");
    assert.deepEqual(pagePosts(cfk).map((c) => c.body.page.current_path), ["/blueprint-vip-book", "/blueprint-vip"]);
    const after = await pageRows(vip.id);
    assert.equal(after.find((p) => p.role === "thank_you").cf_page_id, early.id);
    assert.deepEqual(cfk.stepPages(made.id), after.map((p) => p.cf_page_id));
  });

  test("push: a 429 from ClickFunnels is tried again later, not failed for good; no page is made", async () => {
    const cv = (await db.query(`SELECT * FROM marketing_funnels WHERE org_id = $1 AND path = '/capital-vip'`, [org])).rows[0];
    const job = await call(buildHandler, tokenOwner, { body: { request_id: rid("b"), id: cv.id } });
    assert.equal((await runFunnelJob(db, { jobId: job.body.job.id, orgId: org, env: ENV, deps: { callModel: fakeModel().fn, readSources: () => ({ files: {} }) } })).status, "done");
    const cfk = fakeClickFunnels({ busy: 1 });
    const queued = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: cv.id, confirm_url: cv.landing_url } });
    assert.equal(queued.code, 202, JSON.stringify(queued.body));
    const out = await runFunnelJob(db, { jobId: queued.body.job.id, orgId: org, env: ENV, deps: PUSH_DEPS(cfk) });
    assert.equal(out.status, "queued", JSON.stringify(out));
    const row = await jobRow(queued.body.job.id);
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, 1);
    assert.match(row.error, /HTTP 429/);
    assert.equal(pagePosts(cfk).length, 1, "one make, answered 429");
    assert.equal(cfk.pages.length, cfk.before.pageIds.size, "no page was made");
    assert.ok((await pageRows(cv.id)).every((p) => p.cf_page_id === null));
    // Close the waiting try so the next push can start.
    await db.query(`UPDATE marketing_jobs SET status = 'failed', finished_at = now() WHERE id = $1`, [queued.body.job.id]);
  });

  test("push: ClickFunnels puts a step at another address; the push stops there, the funnel stays a draft, and a Retry makes nothing new", async () => {
    const cv = (await db.query(`SELECT * FROM marketing_funnels WHERE org_id = $1 AND path = '/capital-vip'`, [org])).rows[0];
    const cfk = fakeClickFunnels({ stepSuffix: "-2" });
    for (const round of [1, 2]) {
      const queued = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: cv.id, confirm_url: cv.landing_url } });
      assert.equal(queued.code, 202, `round ${round}: ${JSON.stringify(queued.body)}`);
      const out = await runFunnelJob(db, { jobId: queued.body.job.id, orgId: org, env: ENV, deps: PUSH_DEPS(cfk) });
      assert.equal(out.status, "failed", `round ${round}: ${JSON.stringify(out)}`);
      const job = await jobRow(queued.body.job.id);
      assert.equal(job.status, "failed", "final at once: a retry gets the same answer");
      assert.match(job.error, /ClickFunnels put \/capital-vip-thank-you at https:\/\/apply\.fundhub\.ai\/capital-vip-thank-you-2, not at https:\/\/apply\.fundhub\.ai\/capital-vip-thank-you/);
    }
    // One page was made (the thank-you page, first in line); the push stopped before
    // the token, the proof and the next page, and the Retry made nothing new.
    assert.deepEqual(pagePosts(cfk).map((c) => c.body.page.current_path), ["/capital-vip-thank-you"]);
    assert.equal(funnelPosts(cfk).length, 1);
    assert.equal(cfk.writes().filter((c) => c.method === "PUT").length, 0);
    assert.ok(cfk.calls.every((c) => c.host !== "apply.fundhub.ai"), "no live page was read as proof");
    const f = await funnelRow(cv.id);
    assert.equal(f.status, "draft");
    assert.equal(f.active, false);
    assert.equal(f.live_at, null);
    assert.equal(f.landing_url, "https://apply.fundhub.ai/capital-vip");
    const pages = await pageRows(cv.id);
    const thanks = pages.find((p) => p.role === "thank_you");
    assert.ok(thanks.cf_page_id, "the page id is kept, so it is never made twice");
    assert.equal(thanks.live_url, "https://apply.fundhub.ai/capital-vip-thank-you-2", "the address ClickFunnels used is kept as it is");
    assert.equal(thanks.proved_at, null);
    assert.ok(pages.filter((p) => p.role !== "thank_you").every((p) => p.cf_page_id === null));
    const outbox = (await db.query(`SELECT count(*)::int AS n FROM repo_outbox WHERE org_id = $1 AND path LIKE 'marketing/landing-pages/funnels/capital_vip/%'`, [org])).rows[0].n;
    assert.equal(outbox, 0, "nothing queued for the repo");
  });

  test("push: an answer with no page address is never filled in; each Retry takes its page back by its marker until the funnel is live", async () => {
    const fu = (await db.query(`SELECT * FROM marketing_funnels WHERE org_id = $1 AND path = '/funding'`, [org])).rows[0];
    const job = await call(buildHandler, tokenOwner, { body: { request_id: rid("b"), id: fu.id } });
    assert.equal((await runFunnelJob(db, { jobId: job.body.job.id, orgId: org, env: ENV, deps: { callModel: fakeModel().fn, readSources: () => ({ files: {} }) } })).status, "done");
    const cfk = fakeClickFunnels({ noAddress: true });
    const run = async () => {
      const queued = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: fu.id, confirm_url: fu.landing_url } });
      assert.equal(queued.code, 202, JSON.stringify(queued.body));
      const out = await runFunnelJob(db, { jobId: queued.body.job.id, orgId: org, env: ENV, deps: PUSH_DEPS(cfk) });
      return { out, job: await jobRow(queued.body.job.id) };
    };
    const first = await run();
    assert.equal(first.out.status, "failed");
    assert.match(first.job.error, /ClickFunnels answered without the page address for \/funding-thank-you/);
    assert.ok((await pageRows(fu.id)).every((p) => p.cf_page_id === null && p.live_url === null), "no address was guessed");
    const second = await run();
    assert.match(second.job.error, /without the page address for \/funding-book/);
    const third = await run();
    assert.match(third.job.error, /without the page address for \/funding\. /);
    const fourth = await run();
    assert.equal(fourth.out.status, "done", JSON.stringify(fourth.out));
    assert.equal(fourth.out.result.adopted, 1);
    assert.equal(pagePosts(cfk).length, 3, "each page was made once; every Retry took its page back by the marker");
    assert.equal(funnelPosts(cfk).length, 1);
    assert.equal((await funnelRow(fu.id)).status, "live");
  });

  test("push: the standalone page the first push made (the live test) is moved into the funnel, never made again, never deleted", async () => {
    const r = await create({ path: "legacy-thanks" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const lf = await funnelRow(r.body.funnel.id);
    assert.equal((await runFunnelJob(db, { jobId: r.body.job.id, orgId: org, env: ENV, deps: { callModel: fakeModel().fn, readSources: () => ({ files: {} }) } })).status, "done");
    const thanks = (await pageRows(lf.id)).find((p) => p.role === "thank_you");
    const cfk = fakeClickFunnels();
    // What the shipped X4 push left: a standalone page on the subdomain, saved on the thank-you row.
    const old = cfk.addStandalone({ name: "legacy - Thank you", description: pageMarker(lf, thanks), current_path: "/legacy-thanks-thank-you", html: thanks.html });
    await db.query(
      `UPDATE marketing_funnel_pages SET cf_page_id = $2, cf_public_id = $3, live_url = $4, pushed_at = now() WHERE id = $1`,
      [thanks.id, String(old.id), old.public_id, `https://${SUB_HOST}/legacy-thanks-thank-you`]);
    cfk.calls.length = 0;

    const queued = await call(pushHandler, tokenOwner, { body: { request_id: rid("p"), id: lf.id, confirm_url: lf.landing_url } });
    assert.equal(queued.code, 202, JSON.stringify(queued.body));
    const out = await runFunnelJob(db, { jobId: queued.body.job.id, orgId: org, env: ENV, deps: PUSH_DEPS(cfk) });
    assert.equal(out.status, "done", JSON.stringify(out));
    assert.equal(out.result.moved, 1);

    // A step for it (our new page, marked), then OUR old page moved onto it. Never made again.
    const pposts = pagePosts(cfk);
    assert.deepEqual(pposts.map((c) => c.body.page.current_path), ["/legacy-thanks-thank-you", "/legacy-thanks-book", "/legacy-thanks"]);
    assert.equal(pposts[0].body.page.description, stepMarker(lf, { ...thanks, cf_page_id: String(old.id) }));
    const moves = cfk.writes().filter((c) => c.method === "PUT" && c.body.page.funnel);
    assert.deepEqual(moves.map((c) => [c.path, Object.keys(c.body.page)]), [[`/api/v2/pages/${old.id}`, ["funnel"]]]);
    assert.ok(cfk.calls.every((c) => c.method !== "DELETE"), "nothing deleted");
    const rows = await pageRows(lf.id);
    const t = rows.find((p) => p.role === "thank_you");
    assert.equal(t.cf_page_id, String(old.id), "the row keeps its page for good");
    assert.equal(t.live_url, "https://apply.fundhub.ai/legacy-thanks-thank-you");
    assert.equal(cfk.liveAddress(old.id), "https://apply.fundhub.ai/legacy-thanks-thank-you");
    assert.deepEqual(cfk.stepPages(out.result.cf_funnel_id), STEP_ORDER.map((role) => rows.find((p) => p.role === role).cf_page_id));
    assert.ok(rows.every((p) => p.proved_at));
    assert.equal((await funnelRow(lf.id)).status, "live");
  });

  // ── the reads ────────────────────────────────────────────────────────────

  test("GET marketing/funnels: url, tag, status and pages for every funnel", async () => {
    const r = await call(funnelsHandler, tokenOwner, { method: "GET" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const live = r.body.funnels.find((f) => f.id === blueprint.id);
    assert.equal(live.url, "https://apply.fundhub.ai/blueprint");
    assert.equal(live.tag, "fnl-blueprint");
    assert.equal(live.status, "live");
    assert.deepEqual(live.pages.map((p) => [p.role, p.status, p.url]), [
      ["landing", "live", "https://apply.fundhub.ai/blueprint"],
      ["booking", "live", "https://apply.fundhub.ai/blueprint-book"],
      ["thank_you", "live", "https://apply.fundhub.ai/blueprint-thank-you"]
    ]);
    const draft = r.body.funnels.find((f) => f.path === "/blueprint-4");
    assert.equal(draft.status, "draft");
    assert.ok(draft.pages.every((p) => p.status === "empty"));
    for (const f of r.body.funnels) assert.deepEqual(Object.keys(f), [...FUNNEL_KEYS]);
  });

  test("GET marketing/funnel?id=: the pages with their words and HTML, and the jobs", async () => {
    const r = await call(funnelHandler, tokenOwner, { method: "GET", query: { id: blueprint.id } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.funnel.tag, "fnl-blueprint");
    assert.equal(r.body.pages.length, 3);
    assert.ok(r.body.pages.every((p) => p.html && p.copy));
    assert.deepEqual(r.body.jobs.map((j) => j.kind).sort(), ["funnel", "funnel_push"]);
    assert.ok(r.body.as_of);
    assert.equal((await call(funnelHandler, tokenOwner, { method: "GET", query: { id: "00000000-0000-4000-8000-000000000000" } })).code, 404);
    assert.equal((await call(funnelHandler, tokenOwner, { method: "GET", query: { id: "nope" } })).code, 400);
  });

  test("the track door finds a built page by its tag and its address", async () => {
    const row = await findFunnelPage(db, org, "fnl-blueprint", "/blueprint-book");
    assert.equal(row.tag, "fnl-blueprint");
    assert.equal(Number(row.position), 2);
    assert.equal(row.funnel_id, blueprint.id);
    assert.equal(await findFunnelPage(db, org, "fnl-blueprint", "/blueprint-2-book"), null);
    assert.equal(await findFunnelPage(db, org, "fnl-other", "/blueprint-book"), null);
  });

  test("a worker run refuses a job of another company or one that is not queued", async () => {
    const done = await jobForFunnel(blueprint.id);
    assert.equal((await runFunnelJob(db, { jobId: done.id, orgId: org, env: ENV })).status, "skipped");
    const otherOrg = "00000000-0000-4000-8000-0000000000aa";
    assert.equal((await runFunnelJob(db, { jobId: done.id, orgId: otherOrg, env: ENV })).status, "skipped");
  });
});
