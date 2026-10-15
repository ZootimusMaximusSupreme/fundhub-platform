// Finish-the-853 batch 25, practice tests for the marketing funnel doors: the funnel list and save,
// make a draft funnel, queue its page writer, rename it, and the numbers by funnel. Each test runs the
// REAL api/ handler (real sign-in and role gate, real store code) over a stand-in database that answers
// by the SQL text the code sends. Fake data only. No Postgres, no ClickFunnels, no worker is started.
import assert from "node:assert/strict";
import test from "node:test";

import funnelsHandler from "../../api/marketing/funnels.mjs";
import buildHandler from "../../api/marketing/funnels/build.mjs";
import createHandler from "../../api/marketing/funnels/create.mjs";
import renameHandler from "../../api/marketing/funnels/rename.mjs";
import statsHandler from "../../api/marketing/funnels/stats.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import {
  ORG_ID, OTHER_ORG_ID, STAFF_ID, assertRoleGate, assertSqlHas, call, dataCalls, insertedRow, requestLog, sqlCalls, updatedFields,
} from "../testing/fin-b25-kit.mjs";

const NOW = new Date("2026-10-14T18:00:00.000Z"); // Arizona day 2026-10-14
const FUNNEL_ID = "f0000000-0000-4000-8000-000000000001";
const BUILT_ID = "f0000000-0000-4000-8000-000000000002";
const OTHER_FUNNEL_ID = "f0000000-0000-4000-8000-0000000000aa";
const JOB_ID = "10000000-0000-4000-8000-000000000001";
const REQ = (n) => `req-${String(n).padStart(8, "0")}`;
const WAKE_OK = async () => ({ ok: true, status: 202, reason: null });

/* ── the funnel list and save: marketing/funnels ───────────────────────────────────────────────────── */

function funnelRow(over = {}) {
  return {
    id: FUNNEL_ID, org_id: ORG_ID, key: "book_call", name: "Book a call", landing_url: "https://fundhub.ai/watch",
    offer_key: "funding_dfy", lane: "funding600", book_call: true, format_mix: { standard: 2 }, cta_type: "LEARN_MORE",
    meta_campaign_ids: ["120212345678901234"], default_ad_set_external_id: null, weight: "2.5", active: true,
    created_at: new Date("2026-10-01T10:00:00.000Z"), updated_at: new Date("2026-10-02T11:00:00.000Z"),
    kind: null, path: null, tag: null, utm_campaign: null, campaign: null, status: "live", live_at: null, created_by: null,
    pages: [],
    ...over,
  };
}

function listRules({ funnels, campaigns = [], adSets = [], meta = null, metrics = null }) {
  return [
    [/FROM marketing_funnels f\s+WHERE f\.org_id = \$1/, (sql, params) => rowsWhere(funnels, sql, params)],
    [/FROM campaigns c\s+LEFT JOIN LATERAL/, (_sql, params) => campaigns.filter((row) => row.org_id === params[0])],
    [/FROM ad_sets s\s+JOIN campaigns c/, (_sql, params) => adSets.filter((row) => row.org_id === params[0])],
    [/FROM ad_platform_connections/, () => [{ meta_synced_at: meta }]],
    [/FROM ad_metrics_daily\s+WHERE org_id = \$1/, () => [{ metrics_synced_at: metrics, latest_metrics_date: null }]],
  ];
}

test("GET marketing/funnels lists this company's funnels, the synced Meta campaigns with 7-day spend (unknown stays null) and the ad sets", async () => {
  const funnels = [
    funnelRow(),
    funnelRow({
      id: BUILT_ID, key: "blueprint", name: "Blueprint", landing_url: "https://apply.fundhub.ai/blueprint", offer_key: "capital_blueprint",
      lane: "uwiq", active: false, kind: "book_a_call", path: "/blueprint", tag: "fnl-blueprint", utm_campaign: "uwiq", status: "draft",
      weight: "1", meta_campaign_ids: [],
      pages: [
        { id: "p1", position: 1, role: "landing", path: "/blueprint", built_at: "2026-10-12T10:00:00.000Z", cf_page_id: null, events_seen: 4 },
        { id: "p2", position: 2, role: "booking", path: "/blueprint-book", built_at: null, cf_page_id: null, events_seen: 3 },
      ],
    }),
    funnelRow({ id: OTHER_FUNNEL_ID, org_id: OTHER_ORG_ID, key: "other_company", name: "Another company's funnel" }),
  ];
  const campaigns = [
    { org_id: ORG_ID, external_id: "120212345678901234", name: "Funding cold", status: "ACTIVE", spend_cents: "125000", ad_days: 6, funnel_key: "book_call" },
    { org_id: ORG_ID, external_id: "120299999999999999", name: "No days yet", status: "PAUSED", spend_cents: null, ad_days: 0, funnel_key: null },
    { org_id: OTHER_ORG_ID, external_id: "120277777777777777", name: "Not ours", status: "ACTIVE", spend_cents: "5", ad_days: 1, funnel_key: null },
  ];
  const adSets = [
    { org_id: ORG_ID, external_id: "230000000000000001", name: "Broad", status: "ACTIVE", campaign_external_id: "120212345678901234" },
    { org_id: OTHER_ORG_ID, external_id: "230000000000000099", name: "Not ours", status: "ACTIVE", campaign_external_id: "x" },
  ];
  const metaAt = new Date("2026-10-14T14:30:00.000Z");
  const result = await call(funnelsHandler, {
    deps: { now: () => NOW },
    rules: listRules({ funnels, campaigns, adSets, meta: metaAt, metrics: new Date("2026-10-13T09:00:00.000Z") }),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.funnels.map((f) => f.key), ["book_call", "blueprint"], "only this company's funnels");
  const [hand, built] = result.body.funnels;
  assert.equal(hand.weight, 2.5, "numeric arrives as text and is answered as a number");
  assert.equal(hand.events_seen, null, "a hand-mapped funnel has no page events to count: unknown, not 0");
  assert.equal(hand.status, "live");
  assert.equal(hand.utm_template, "utm_source=fb&utm_medium=paid&utm_campaign=funding600&utm_content={ad_number}");
  assert.equal(built.kind, "book_a_call");
  assert.equal(built.tag, "fnl-blueprint");
  assert.equal(built.events_seen, 7, "a built funnel adds up the events seen on its pages");
  assert.deepEqual(built.pages.map((p) => [p.role, p.status]), [["landing", "built"], ["booking", "empty"]]);
  assert.deepEqual(result.body.campaigns, [
    { external_id: "120212345678901234", name: "Funding cold", status: "ACTIVE", spend_7d_cents: 125000, funnel_key: "book_call" },
    { external_id: "120299999999999999", name: "No days yet", status: "PAUSED", spend_7d_cents: null, funnel_key: null },
  ]);
  assert.deepEqual(result.body.ad_sets, [
    { external_id: "230000000000000001", name: "Broad", status: "ACTIVE", campaign_external_id: "120212345678901234" },
  ]);
  assert.equal(result.body.as_of, metaAt.toISOString(), "as_of is the last Meta sync");

  const [list] = sqlCalls(result, /FROM marketing_funnels f/);
  assert.deepEqual(list.params, [ORG_ID]);
  assertSqlHas(list.sql, { company: "WHERE f.org_id = $1", order: "ORDER BY f.active DESC, f.key" });
  const [spend] = sqlCalls(result, /FROM campaigns c/);
  assert.deepEqual(spend.params, [ORG_ID, "2026-10-08", "2026-10-14"], "the last 7 Arizona days, today included");
  assertSqlHas(spend.sql, { company: "WHERE c.org_id = $1", meta: "c.platform = 'meta'" });
  const [sets] = sqlCalls(result, /FROM ad_sets s/);
  assert.deepEqual(sets.params, [ORG_ID]);
  assertSqlHas(sets.sql, { company: "WHERE s.org_id = $1" });
  assert.deepEqual(sqlCalls(result, /FROM ad_platform_connections/)[0].params, [ORG_ID]);
});

test("GET marketing/funnels says as_of is null when Meta never synced, and a closer or setter is refused", async () => {
  const none = await call(funnelsHandler, { deps: { now: () => NOW }, rules: listRules({ funnels: [] }) });
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.funnels, []);
  assert.equal(none.body.as_of, null);
  await assertRoleGate(funnelsHandler, ["owner", "admin"], { rules: listRules({ funnels: [] }) });
});

test("POST marketing/funnels makes a new funnel in the session's company, saves the answer once per request_id, and writes nothing on a repeat", async () => {
  const log = requestLog();
  const inserts = [];
  const rules = [
    ...log.rules,
    [/FROM marketing_funnels WHERE org_id = \$1 AND key = \$2 FOR UPDATE/, []],
    [/INSERT INTO marketing_funnels/, (sql, params) => {
      const row = insertedRow(sql, params);
      inserts.push({ sql, params, row });
      return [{
        id: FUNNEL_ID, created_at: NOW, updated_at: NOW, weight: row.weight == null ? "1" : String(row.weight),
        active: row.active ?? true, kind: null, status: "live", pages: [], ...row,
        format_mix: row.format_mix ? JSON.parse(row.format_mix) : { standard: 1 },
      }];
    }],
  ];
  const funnel = {
    key: "vip_call", name: "VIP call", landing_url: "https://apply.fundhub.ai/vip", lane: "uwiq", offer_key: "capital_blueprint",
    book_call: true, format_mix: { standard: 2, sorting: 1 }, cta_type: "LEARN_MORE", meta_campaign_ids: ["120212345678901234"],
    weight: 3, active: true,
  };
  const first = await call(funnelsHandler, { method: "POST", body: { request_id: REQ(1), funnel }, rules, deps: { now: () => NOW } });
  assert.equal(first.status, 200);
  assert.equal(first.body.funnel.key, "vip_call");
  assert.equal(first.body.funnel.name, "VIP call");
  assert.equal(first.body.funnel.lane, "uwiq");
  assert.equal(first.body.funnel.weight, 3);
  assert.deepEqual(first.body.funnel.meta_campaign_ids, ["120212345678901234"]);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].row.org_id, ORG_ID, "filed under the session's company");
  assert.equal(inserts[0].row.key, "vip_call");
  assert.equal(inserts[0].row.lane, "uwiq");
  assert.deepEqual(JSON.parse(inserts[0].row.format_mix), { standard: 2, sorting: 1 });
  assertSqlHas(inserts[0].sql, { conflict: "ON CONFLICT (org_id, key) DO NOTHING", lane: "::ad_lane" });
  const taken = sqlCalls(first, /meta_campaign_ids && \$3::text\[\]/)[0];
  assert.deepEqual(taken.params, [ORG_ID, "vip_call", ["120212345678901234"]], "a campaign on another funnel of this company is looked for");
  assert.equal(first.db.count("COMMIT"), 1);
  assert.equal(log.saved.get(REQ(1)).route, "marketing/funnels");
  assert.equal(log.saved.get(REQ(1)).org_id, ORG_ID);

  const again = await call(funnelsHandler, { method: "POST", body: { request_id: REQ(1), funnel }, rules, deps: { now: () => NOW } });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body, "a repeated request_id answers the first save");
  assert.equal(inserts.length, 1, "and writes nothing");
});

test("POST marketing/funnels refuses a bad value, a stale save, an existing funnel with no updated_at, and a campaign already on another funnel", async () => {
  const existing = funnelRow();
  const stale = new Date("2026-10-02T11:00:00.000Z");
  const writes = [];
  const rules = [
    ...requestLog().rules,
    [/FROM marketing_funnels WHERE org_id = \$1 AND key = \$2 FOR UPDATE/, (_sql, params) =>
      (params[1] === "book_call" ? [existing] : [])],
    [/meta_campaign_ids && \$3::text\[\]/, (_sql, params) =>
      (params[2].includes("120200000000000009") ? [{ key: "roadmap_147", ids: ["120200000000000009"] }] : [])],
    [/^\s*(INSERT INTO marketing_funnels|UPDATE marketing_funnels)/, (sql, params) => {
      writes.push({ sql, params });
      return [{ ...existing, ...updatedFields(sql, params), updated_at: NOW }];
    }],
  ];
  const post = (funnel, requestId) => call(funnelsHandler, { method: "POST", body: { request_id: requestId, funnel }, rules, deps: { now: () => NOW } });

  const badLane = await post({ key: "x_funnel", name: "X", landing_url: "https://a.example/x", lane: "nonsense" }, REQ(2));
  assert.equal(badLane.status, 400);
  assert.equal(badLane.body.field, "funnel.lane");
  const http = await post({ key: "x_funnel", name: "X", landing_url: "http://a.example/x", lane: "uwiq" }, REQ(3));
  assert.equal(http.status, 400);
  assert.equal(http.body.field, "funnel.landing_url");
  const unknownField = await post({ key: "x_funnel", color: "red" }, REQ(4));
  assert.equal(unknownField.status, 400);
  assert.equal(unknownField.body.field, "funnel.color");
  const needsName = await post({ key: "brand_new", landing_url: "https://a.example/x", lane: "uwiq" }, REQ(5));
  assert.equal(needsName.status, 400);
  assert.equal(needsName.body.field, "funnel.name");

  const noStamp = await post({ key: "book_call", name: "Renamed" }, REQ(6));
  assert.equal(noStamp.status, 409, "an existing funnel only changes with the updated_at the screen read");
  assert.equal(noStamp.body.error, "stale");
  assert.match(noStamp.body.message, /already exists/, "the words say why: it exists, so send updated_at");
  assert.equal(noStamp.body.current.key, "book_call");
  const old = await post({ key: "book_call", name: "Renamed", updated_at: "2026-09-01T00:00:00.000Z" }, REQ(7));
  assert.equal(old.status, 409);
  assert.equal(old.body.current.updated_at, stale.toISOString(), "the 409 hands back what is saved now");

  const taken = await post({ key: "book_call", updated_at: stale.toISOString(), meta_campaign_ids: ["120200000000000009"] }, REQ(8));
  assert.equal(taken.status, 400);
  assert.equal(taken.body.field, "funnel.meta_campaign_ids");
  assert.match(taken.body.message, /roadmap_147/);
  assert.equal(writes.length, 0, "nothing was written by any refusal");

  const ok = await post({ key: "book_call", updated_at: stale.toISOString(), name: "Book a call (new)", active: false }, REQ(9));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.funnel.name, "Book a call (new)");
  assert.equal(writes.length, 1);
  assertSqlHas(writes[0].sql, { byId: "WHERE id = $1", moves: "updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')" });
  assert.equal(writes[0].params[0], FUNNEL_ID);
  assert.deepEqual(updatedFields(writes[0].sql, writes[0].params), { name: "Book a call (new)", active: false });

  await assertRoleGate(funnelsHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(10), funnel: { key: "x" } }, rules });
});

/* ── the funnel builder: build, create, rename ─────────────────────────────────────────────────────── */

function builderWorld({ funnels = [], pages = [], jobs = [] } = {}) {
  const log = requestLog();
  const written = { jobs: [], jobUpdates: [], pageUpdates: [], funnelUpdates: [], funnelInserts: [], pageInserts: [], failedJobs: [] };
  const rules = [
    ...log.rules,
    [/pg_advisory_xact_lock\(hashtextextended\('marketing_funnel_create/, []],
    [/^\s*SELECT id, key, tag FROM marketing_funnels WHERE org_id = \$1/, (_sql, params) =>
      funnels.filter((f) => f.org_id === params[0]).map(({ id, key, tag }) => ({ id, key, tag }))],
    [/^\s*UPDATE marketing_funnels SET tag = \$2 WHERE id = \$1 AND org_id = \$3 AND tag IS NULL AND kind IS NULL/, (sql, params) => {
      const hit = funnels.find((f) => f.id === params[0] && f.org_id === params[2] && !f.tag && !f.kind);
      return hit ? [{ key: hit.key, tag: params[1] }] : [];
    }],
    [/^\s*SELECT path FROM marketing_funnel_pages WHERE org_id = \$1/, (_sql, params) =>
      pages.filter((p) => p.org_id === params[0] && (params[1] === null || p.funnel_id !== params[1])).map((p) => ({ path: p.path }))],
    [/^\s*SELECT id, key, path, landing_url FROM marketing_funnels WHERE org_id = \$1/, (_sql, params) =>
      funnels.filter((f) => f.org_id === params[0]).map(({ id, key, path, landing_url }) => ({ id, key, path, landing_url }))],
    [/^\s*SELECT \* FROM marketing_funnels WHERE id = \$1 AND org_id = \$2/, (sql, params) => rowsWhere(funnels, sql, params)],
    [/^\s*SELECT \* FROM marketing_funnel_pages WHERE funnel_id = \$1 AND org_id = \$2/, (sql, params) =>
      rowsWhere(pages, sql, params).sort((a, b) => a.position - b.position)],
    [/FROM marketing_jobs\s+WHERE kind = ANY\(\$2::text\[\]\) AND status IN \('queued', 'running'\)/, (_sql, params) =>
      jobs.filter((j) => params[1].includes(j.kind) && ["queued", "running"].includes(j.status) && j.payload.funnel_id === params[0])],
    [/^\s*INSERT INTO marketing_funnels/, (sql, params) => {
      const row = { id: BUILT_ID, created_at: NOW, updated_at: NOW, weight: 1, active: false, ...insertedRow(sql, params), landing_url: insertedRow(sql, params).landing_url };
      written.funnelInserts.push({ sql, params, row });
      funnels.push(row);
      return [row];
    }],
    [/^\s*INSERT INTO marketing_funnel_pages/, (sql, params) => {
      const row = { id: `a0000000-0000-4000-8000-00000000000${params[2]}`, built_at: null, cf_page_id: null, html: null, page_copy: null, ...insertedRow(sql, params) };
      written.pageInserts.push({ sql, params, row });
      pages.push(row);
      return [row];
    }],
    [/^\s*INSERT INTO marketing_jobs/, (sql, params) => {
      const job = { id: JOB_ID, org_id: params[0], kind: params[1], payload: JSON.parse(params[2]), status: "queued", created_at: NOW };
      written.jobs.push({ sql, params, job });
      jobs.push(job);
      return [job];
    }],
    [/^\s*UPDATE marketing_jobs SET requested_by = \$2 WHERE id = \$1/, (sql, params) => {
      written.jobUpdates.push({ sql, params });
      return [];
    }],
    [/^\s*UPDATE marketing_jobs SET status = 'failed'/, (sql, params) => {
      written.failedJobs.push({ sql, params });
      return [];
    }],
    [/^\s*UPDATE marketing_funnel_pages SET path = \$2 WHERE id = \$1/, (sql, params) => {
      written.pageUpdates.push({ sql, params });
      const hit = pages.find((p) => p.id === params[0]);
      if (hit) hit.path = params[1];
      return [];
    }],
    [/^\s*UPDATE marketing_funnels\s+SET path = \$2, landing_url = \$3/, (sql, params) => {
      written.funnelUpdates.push({ sql, params });
      const hit = funnels.find((f) => f.id === params[0]);
      Object.assign(hit, { path: params[1], landing_url: params[2], updated_at: NOW });
      return [hit];
    }],
  ];
  return { rules, written, funnels, pages, jobs, log };
}

test("POST marketing/funnels/create picks the first free address for the offer, makes a draft funnel with three empty pages, queues the page writer and wakes it", async () => {
  const taken = new Set(["/blueprint", "/blueprint-book"]); // read live from ClickFunnels: /blueprint is taken
  const world = builderWorld({
    funnels: [{ id: OTHER_FUNNEL_ID, org_id: ORG_ID, key: "roadmap_147", tag: null, kind: null, path: null, landing_url: "https://apply.fundhub.ai/roadmap" }],
  });
  const wakes = [];
  const result = await call(createHandler, {
    method: "POST", body: { request_id: REQ(20), offer_key: "capital_blueprint", name: "Blueprint call" }, rules: world.rules,
    deps: { liveTaken: async () => ({ ok: true, taken }), wake: async (args) => { wakes.push(args); return { ok: true, status: 202, reason: null }; }, env: {} },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.funnel.path, "/blueprint-2", "the base word is taken on the live workspace, so the next free one is picked");
  assert.equal(result.body.funnel.tag, "fnl-blueprint-2");
  assert.equal(result.body.funnel.status, "draft");
  assert.equal(result.body.funnel.url, "https://apply.fundhub.ai/blueprint-2");
  assert.equal(result.body.funnel.lane, "uwiq");
  assert.deepEqual(result.body.funnel.pages.map((p) => [p.role, p.path, p.status]), [
    ["landing", "/blueprint-2", "empty"], ["booking", "/blueprint-2-book", "empty"], ["thank_you", "/blueprint-2-thank-you", "empty"],
  ]);
  assert.deepEqual(result.body.job, { id: JOB_ID, kind: "funnel", status: "queued", created_at: NOW.toISOString() });
  assert.deepEqual(result.body.worker, { started: true, reason: null });

  const [made] = world.written.funnelInserts;
  assert.equal(made.row.org_id, ORG_ID);
  assert.equal(made.row.key, "blueprint_2");
  assert.equal(made.row.status, "draft");
  assert.equal(made.row.active, false, "a draft is not active, so nothing plans or loads ads for it");
  assert.equal(made.row.created_by, STAFF_ID);
  assertSqlHas(made.sql, { lane: "$6::ad_lane", kind: "'book_a_call'", draft: "'draft'" });
  assert.equal(world.written.pageInserts.length, 3);
  assert.ok(world.written.pageInserts.every((p) => p.row.org_id === ORG_ID && p.row.funnel_id === BUILT_ID));
  assert.deepEqual(JSON.parse(world.written.jobs[0].params[2]), { funnel_id: BUILT_ID });
  assert.equal(world.written.jobs[0].params[0], ORG_ID);
  assert.deepEqual(world.written.jobUpdates[0].params, [JOB_ID, STAFF_ID], "the job names who asked for it");
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].jobId, JOB_ID);
  assert.equal(world.log.saved.get(REQ(20)).route, "marketing/funnels/create");
  const tagged = sqlCalls(result, /UPDATE marketing_funnels SET tag/);
  assert.deepEqual(tagged.map((entry) => entry.params), [[OTHER_FUNNEL_ID, "fnl-roadmap-147", ORG_ID]], "the older hand-mapped funnel gets its tag, in this company only");
  assertSqlHas(tagged[0].sql, { onlyUntagged: "AND tag IS NULL AND kind IS NULL" });
});

test("POST marketing/funnels/create tags an untagged hand-mapped funnel, refuses a taken typed address, build:false queues nothing, and a ClickFunnels read failure makes nothing", async () => {
  const world = builderWorld({
    funnels: [{ id: OTHER_FUNNEL_ID, org_id: ORG_ID, key: "book_call", tag: null, kind: null, path: null, landing_url: "https://fundhub.ai/watch" }],
  });
  const noBuild = await call(createHandler, {
    method: "POST", body: { request_id: REQ(21), offer_key: "funding_dfy", path: "Funding Fast", build: false }, rules: world.rules,
    deps: { liveTaken: async () => ({ ok: true, taken: new Set() }), wake: WAKE_OK, env: {} },
  });
  assert.equal(noBuild.status, 200);
  assert.equal(noBuild.body.funnel.path, "/funding-fast", "the typed address is used");
  assert.equal(noBuild.body.job, null, "build:false queues nothing");
  assert.equal(world.written.jobs.length, 0);
  assert.deepEqual(world.written.funnelInserts[0].row.tag, "fnl-funding-fast");
  const tagUpdate = sqlCalls(noBuild, /UPDATE marketing_funnels SET tag/)[0];
  assert.deepEqual(tagUpdate.params, [OTHER_FUNNEL_ID, "fnl-book-call", ORG_ID], "the old funnel's tag is saved under this company only");

  const taken = await call(createHandler, {
    method: "POST", body: { request_id: REQ(22), offer_key: "funding_dfy", path: "/watch" }, rules: world.rules,
    deps: { liveTaken: async () => ({ ok: true, taken: new Set() }), wake: WAKE_OK, env: {} },
  });
  assert.equal(taken.status, 400);
  assert.equal(taken.body.field, "path");

  const before = world.written.funnelInserts.length;
  const unreadable = await call(createHandler, {
    method: "POST", body: { request_id: REQ(23), offer_key: "funding_dfy" }, rules: world.rules,
    deps: { liveTaken: async () => ({ ok: false, error: "ClickFunnels said 401" }), wake: WAKE_OK, env: {} },
  });
  assert.equal(unreadable.status, 503);
  assert.equal(unreadable.body.error, "clickfunnels_unreadable");
  assert.equal(world.written.funnelInserts.length, before, "nothing is made blind");

  const badOffer = await call(createHandler, { method: "POST", body: { request_id: REQ(24), offer_key: "slo_roadmap" }, rules: world.rules, deps: { liveTaken: async () => ({ ok: true, taken: new Set() }) } });
  assert.equal(badOffer.status, 400);
  assert.equal(badOffer.body.field, "offer_key");
  const wrongMethod = await call(createHandler, { method: "GET", rules: [] });
  assert.equal(wrongMethod.status, 405);
});

test("POST marketing/funnels/create fails the queued job in plain words when the worker cannot be woken", async () => {
  const world = builderWorld();
  const result = await call(createHandler, {
    method: "POST", body: { request_id: REQ(25), offer_key: "capital_blueprint" }, rules: world.rules,
    deps: { liveTaken: async () => ({ ok: true, taken: new Set() }), wake: async () => ({ ok: false, status: 500, reason: "the worker answered 500" }), env: {} },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.worker.started, false);
  assert.match(result.body.worker.reason, /the worker answered 500/);
  assert.equal(result.body.job.status, "failed");
  assert.equal(world.written.failedJobs.length, 1, "the job nothing would run is marked failed");
  assert.equal(world.written.failedJobs[0].params[0], JOB_ID);
});

test("POST marketing/funnels/create is owner and admin only", async () => {
  const world = builderWorld();
  await assertRoleGate(createHandler, ["owner", "admin"], {
    method: "POST", body: { request_id: REQ(26), offer_key: "capital_blueprint" }, rules: world.rules,
    deps: { liveTaken: async () => ({ ok: true, taken: new Set() }), wake: WAKE_OK, env: {} },
  });
});

function draftFunnel(over = {}) {
  return {
    id: BUILT_ID, org_id: ORG_ID, key: "blueprint", name: "Blueprint", landing_url: "https://apply.fundhub.ai/blueprint", kind: "book_a_call",
    path: "/blueprint", tag: "fnl-blueprint", status: "draft", lane: "uwiq", active: false, updated_at: NOW,
    ...over,
  };
}
const draftPages = (over = {}) => ["landing", "booking", "thank_you"].map((role, index) => ({
  id: `a0000000-0000-4000-8000-00000000000${index + 1}`, org_id: ORG_ID, funnel_id: BUILT_ID, position: index + 1, role,
  path: ["/blueprint", "/blueprint-book", "/blueprint-thank-you"][index], built_at: null, cf_page_id: null, html: null, page_copy: null, ...over,
}));

test("POST marketing/funnels/build queues one page-writer job for a draft funnel of this company, and wakes it", async () => {
  const world = builderWorld({ funnels: [draftFunnel()], pages: draftPages() });
  const wakes = [];
  const result = await call(buildHandler, {
    method: "POST", body: { request_id: REQ(30), id: BUILT_ID }, rules: world.rules,
    deps: { wake: async (args) => { wakes.push(args); return { ok: true, status: 202, reason: null }; }, env: {} },
  });
  assert.equal(result.status, 202);
  assert.equal(result.body.queued, true);
  assert.deepEqual(result.body.job, { id: JOB_ID, kind: "funnel", status: "queued", created_at: NOW.toISOString() });
  assert.deepEqual(result.body.worker, { started: true, reason: null });
  assert.equal(world.written.jobs.length, 1);
  assert.deepEqual(JSON.parse(world.written.jobs[0].params[2]), { funnel_id: BUILT_ID });
  assert.equal(world.written.jobs[0].params[0], ORG_ID);
  assert.deepEqual(world.written.jobUpdates[0].params, [JOB_ID, STAFF_ID]);
  const lookup = sqlCalls(result, /FROM marketing_funnels WHERE id = \$1 AND org_id = \$2/)[0];
  assert.deepEqual(lookup.params, [BUILT_ID, ORG_ID]);
  assertSqlHas(lookup.sql, { locked: "FOR UPDATE" });
  assert.equal(wakes.length, 1);
});

test("POST marketing/funnels/build refuses a live funnel, a page already on ClickFunnels, a run already in flight, another company's funnel and a stray key", async () => {
  const jobsInFlight = [];
  const live = builderWorld({ funnels: [draftFunnel({ status: "live" })], pages: draftPages() });
  const liveAnswer = await call(buildHandler, { method: "POST", body: { request_id: REQ(31), id: BUILT_ID }, rules: live.rules, deps: { wake: WAKE_OK, env: {} } });
  assert.equal(liveAnswer.status, 400);
  assert.equal(liveAnswer.body.field, "id");
  assert.match(liveAnswer.body.message, /live page is never rewritten/);
  assert.equal(live.written.jobs.length, 0);

  const pushed = builderWorld({ funnels: [draftFunnel()], pages: draftPages({ cf_page_id: "cf-9" }) });
  const pushedAnswer = await call(buildHandler, { method: "POST", body: { request_id: REQ(32), id: BUILT_ID }, rules: pushed.rules, deps: { wake: WAKE_OK, env: {} } });
  assert.equal(pushedAnswer.status, 400);
  assert.equal(pushed.written.jobs.length, 0);

  jobsInFlight.push({ id: JOB_ID, kind: "funnel_push", status: "running", payload: { funnel_id: BUILT_ID } });
  const busy = builderWorld({ funnels: [draftFunnel()], pages: draftPages(), jobs: jobsInFlight });
  const busyAnswer = await call(buildHandler, { method: "POST", body: { request_id: REQ(33), id: BUILT_ID }, rules: busy.rules, deps: { wake: WAKE_OK, env: {} } });
  assert.equal(busyAnswer.status, 400);
  assert.match(busyAnswer.body.message, /already being written or pushed/);
  assert.equal(busy.written.jobs.length, 0);

  const otherCompany = builderWorld({ funnels: [draftFunnel({ org_id: OTHER_ORG_ID })], pages: draftPages() });
  const missing = await call(buildHandler, { method: "POST", body: { request_id: REQ(34), id: BUILT_ID }, rules: otherCompany.rules, deps: { wake: WAKE_OK, env: {} } });
  assert.equal(missing.status, 404, "another company's funnel is not found");
  assert.equal(otherCompany.written.jobs.length, 0);

  const handMapped = builderWorld({ funnels: [draftFunnel({ kind: null })], pages: [] });
  const notBuilt = await call(buildHandler, { method: "POST", body: { request_id: REQ(35), id: BUILT_ID }, rules: handMapped.rules, deps: { wake: WAKE_OK, env: {} } });
  assert.equal(notBuilt.status, 404, "a funnel mapped by hand was not built here");

  const stray = await call(buildHandler, { method: "POST", body: { request_id: REQ(36), id: BUILT_ID, org_id: OTHER_ORG_ID }, rules: [], deps: { wake: WAKE_OK, env: {} } });
  assert.equal(stray.status, 400);
  assert.equal(stray.body.field, "org_id");
  await assertRoleGate(buildHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(37), id: BUILT_ID }, rules: [], deps: { wake: WAKE_OK, env: {} } });
});

test("POST marketing/funnels/rename moves the three page addresses and the landing url of a draft funnel, redraws built pages, and refuses live, taken and reserved addresses", async () => {
  const world = builderWorld({
    funnels: [draftFunnel()],
    pages: draftPages({ html: "<a href=\"/blueprint-book\">book</a>", page_copy: { headline: "Hi" } }),
  });
  const result = await call(renameHandler, {
    method: "POST", body: { request_id: REQ(40), id: BUILT_ID, path: "Capital Plan" }, rules: world.rules,
    deps: { liveTaken: async () => ({ ok: true, taken: new Set(["/something-else"]) }), env: {} },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.funnel.path, "/capital-plan");
  assert.equal(result.body.funnel.url, "https://apply.fundhub.ai/capital-plan");
  assert.equal(result.body.funnel.tag, "fnl-blueprint", "the tag never changes with the address");
  assert.deepEqual(result.body.funnel.pages.map((p) => p.path), ["/capital-plan", "/capital-plan-book", "/capital-plan-thank-you"]);
  assert.deepEqual(world.written.pageUpdates.map((u) => u.params[1]), ["/capital-plan", "/capital-plan-book", "/capital-plan-thank-you"]);
  assert.deepEqual(world.written.funnelUpdates[0].params, [BUILT_ID, "/capital-plan", "https://apply.fundhub.ai/capital-plan"]);
  const html = sqlCalls(result, /UPDATE marketing_funnel_pages SET html = \$2/);
  assert.equal(html.length, 3, "every built page is drawn again from its saved words, with no model call");
  assert.ok(html.every((entry) => /capital-plan/.test(entry.params[1])));
  assert.equal(world.log.saved.get(REQ(40)).route, "marketing/funnels/rename");

  const sameAddress = await call(renameHandler, {
    method: "POST", body: { request_id: REQ(41), id: BUILT_ID, path: "/capital-plan" }, rules: world.rules,
    deps: { liveTaken: async () => ({ ok: true, taken: new Set() }), env: {} },
  });
  assert.equal(sameAddress.status, 400);
  assert.equal(sameAddress.body.field, "path");
  assert.match(sameAddress.body.message, /already at \/capital-plan/);
});

test("POST marketing/funnels/rename refuses a live funnel, a taken or reserved address, a run in flight, and makes nothing move when ClickFunnels cannot be read", async () => {
  const ok = { liveTaken: async () => ({ ok: true, taken: new Set(["/taken-word"]) }), env: {} };
  const ask = (world, path, requestId, deps = ok) => call(renameHandler, { method: "POST", body: { request_id: requestId, id: BUILT_ID, path }, rules: world.rules, deps });

  const live = builderWorld({ funnels: [draftFunnel({ status: "live" })], pages: draftPages() });
  const liveAnswer = await ask(live, "new-word", REQ(42));
  assert.equal(liveAnswer.status, 400);
  assert.match(liveAnswer.body.message, /never changes/);
  assert.equal(live.written.funnelUpdates.length, 0);

  const takenAnswer = await ask(builderWorld({ funnels: [draftFunnel()], pages: draftPages() }), "taken-word", REQ(43));
  assert.equal(takenAnswer.status, 400);
  assert.equal(takenAnswer.body.field, "path");
  assert.match(takenAnswer.body.message, /already a page/);

  const reservedAnswer = await ask(builderWorld({ funnels: [draftFunnel()], pages: draftPages() }), "watch", REQ(44));
  assert.equal(reservedAnswer.status, 400);
  assert.match(reservedAnswer.body.message, /site already uses/);

  const ownPage = builderWorld({
    funnels: [draftFunnel(), draftFunnel({ id: OTHER_FUNNEL_ID, key: "second", path: "/second", landing_url: "https://apply.fundhub.ai/second" })],
    pages: [...draftPages(), ...draftPages({ funnel_id: OTHER_FUNNEL_ID }).map((p, i) => ({ ...p, id: `b0000000-0000-4000-8000-00000000000${i}`, path: ["/second", "/second-book", "/second-thank-you"][i] }))],
  });
  const clash = await ask(ownPage, "second", REQ(45));
  assert.equal(clash.status, 400, "another funnel of this company already holds that address");

  const busy = builderWorld({ funnels: [draftFunnel()], pages: draftPages(), jobs: [{ id: JOB_ID, kind: "funnel", status: "queued", payload: { funnel_id: BUILT_ID } }] });
  const busyAnswer = await ask(busy, "new-word", REQ(46));
  assert.equal(busyAnswer.status, 400);
  assert.match(busyAnswer.body.message, /being written or pushed/);

  const unreadable = await ask(builderWorld({ funnels: [draftFunnel()], pages: draftPages() }), "new-word", REQ(47), { liveTaken: async () => ({ ok: false, error: "no key" }), env: {} });
  assert.equal(unreadable.status, 503);
  assert.equal(unreadable.body.error, "clickfunnels_unreadable");

  const otherCompany = builderWorld({ funnels: [draftFunnel({ org_id: OTHER_ORG_ID })], pages: draftPages() });
  const notFound = await ask(otherCompany, "new-word", REQ(48));
  assert.equal(notFound.status, 404);
  await assertRoleGate(renameHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(49), id: BUILT_ID, path: "x-y" }, rules: [], deps: ok });
});

/* ── the numbers by funnel: marketing/funnels/stats ────────────────────────────────────────────────── */

function statsRules(world) {
  return [
    [/-- m5:ad_labels/, (_sql, params) => world.ads.filter((a) => a.org_id === params[0]).map(({ org_id: _o, ...rest }) => rest)],
    [/-- m5:ad_spend/, (_sql, params) => world.spend.filter((s) => s.org_id === params[0]).map(({ org_id: _o, ...rest }) => rest)],
    [/-- m5:script_labels/, (_sql, params) => world.scripts.filter((s) => s.org_id === params[0] && params[1].includes(s.ad_number)).map(({ org_id: _o, ...rest }) => rest)],
    [/lead_by_number AS/, (_sql, params) => world.leads.filter((l) => l.org_id === params[0]).map(({ org_id: _o, ...rest }) => rest)],
    [/-- m5:funnel_steps/, (_sql, params) => world.steps.filter((s) => s.org_id === params[0]).map(({ org_id: _o, ...rest }) => rest)],
    [/FROM marketing_funnels f\s+WHERE f\.org_id = \$1/, (sql, params) => rowsWhere(world.funnels, sql, params)],
    [/FROM ad_platform_connections/, () => [{ meta_synced_at: world.metaAt }]],
    [/FROM ad_metrics_daily\s+WHERE org_id = \$1/, () => [{ metrics_synced_at: null, latest_metrics_date: null }]],
  ];
}

function statsWorld() {
  const mine = (row) => ({ org_id: ORG_ID, ...row });
  return {
    metaAt: new Date("2026-10-14T16:00:00.000Z"),
    funnels: [
      funnelRow({ key: "book_call", name: "Book a call", landing_url: "https://fundhub.ai/watch" }),
      funnelRow({ id: BUILT_ID, key: "roadmap_147", name: "Roadmap", landing_url: "https://fundhub.ai/roadmap", meta_campaign_ids: ["C-ROAD"] }),
      funnelRow({ id: OTHER_FUNNEL_ID, org_id: OTHER_ORG_ID, key: "not_ours", name: "Not ours", landing_url: "https://fundhub.ai/watch" }),
    ],
    ads: [
      mine({ ad_row_id: "ad-1", ad_number: "43", spine_angle_key: "cause", campaign_external_id: null, campaign_funnel_key: null }),
      mine({ ad_row_id: "ad-2", ad_number: "44", spine_angle_key: null, campaign_external_id: null, campaign_funnel_key: null }),
      mine({ ad_row_id: "ad-3", ad_number: null, spine_angle_key: null, campaign_external_id: "C-ROAD", campaign_funnel_key: "roadmap_147" }),
      mine({ ad_row_id: "ad-4", ad_number: null, spine_angle_key: null, campaign_external_id: null, campaign_funnel_key: null }),
      { org_id: OTHER_ORG_ID, ad_row_id: "ad-x", ad_number: "99", spine_angle_key: null, campaign_external_id: null, campaign_funnel_key: "not_ours" },
    ],
    spend: [
      mine({ ad_row_id: "ad-1", spend_cents: "20000", link_clicks: "200", ad_days: 5, link_click_days: 5 }),
      mine({ ad_row_id: "ad-2", spend_cents: "10000", link_clicks: "100", ad_days: 5, link_click_days: 5 }),
      mine({ ad_row_id: "ad-3", spend_cents: "5000", link_clicks: "50", ad_days: 2, link_click_days: 2 }),
      mine({ ad_row_id: "ad-4", spend_cents: "700", link_clicks: "7", ad_days: 1, link_click_days: 1 }),
      { org_id: OTHER_ORG_ID, ad_row_id: "ad-x", spend_cents: "999999", link_clicks: "9", ad_days: 1, link_click_days: 1 },
    ],
    scripts: [
      mine({ ad_number: "43", funnel_key: "book_call", angle_key: "cause" }),
      mine({ ad_number: "44", funnel_key: "book_call", angle_key: null }),
    ],
    leads: [
      mine({ ad_number: "43", leads: 10, booked: 4, showed: 3, sales: 1, cash_cents: "29700" }),
      mine({ ad_number: "44", leads: 5, booked: 1, showed: 1, sales: 0, cash_cents: "0" }),
      { org_id: OTHER_ORG_ID, ad_number: "99", leads: 500, booked: 500, showed: 500, sales: 500, cash_cents: "9999999" },
    ],
    steps: [
      mine({ page: "/watch", name: "funnel.page", events: 150 }),
      mine({ page: "/roadmap", name: "funnel.page", events: 40 }),
      mine({ page: "/watch", name: "funnel.click", events: 12 }),
      { org_id: OTHER_ORG_ID, page: "/watch", name: "funnel.page", events: 777 },
    ],
  };
}

test("GET marketing/funnels/stats rolls spend, page views, leads, booked, showed, sales and cash up by funnel for this company's last 30 Arizona days", async () => {
  const world = statsWorld();
  const result = await call(statsHandler, { deps: { now: () => NOW }, rules: statsRules(world) });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.rows, [
    {
      funnel_key: "book_call", name: "Book a call", spend_cents: 30000, page_views: 150, click_to_page: 0.5, page_to_lead: 0.1,
      leads: 15, booked: 5, showed: 4, sales: 1, cash_cents: 29700, roas: 0.99,
    },
    {
      funnel_key: "roadmap_147", name: "Roadmap", spend_cents: 5000, page_views: 40, click_to_page: 0.8, page_to_lead: 0,
      leads: 0, booked: 0, showed: 0, sales: 0, cash_cents: 0, roas: 0,
    },
  ]);
  assert.equal(result.body.unmapped_spend_cents, 700, "spend no funnel claims is said, not hidden");
  assert.equal(result.body.as_of, world.metaAt.toISOString());

  const [spend] = sqlCalls(result, /-- m5:ad_spend/);
  assert.deepEqual(spend.params, [ORG_ID, "2026-09-15", "2026-10-14"], "30 Arizona days ending today");
  assertSqlHas(spend.sql, { company: "WHERE a.org_id = $1", metricsCompany: "AND m.org_id = $1", window: "m.date BETWEEN $2::date AND $3::date" });
  const [steps] = sqlCalls(result, /-- m5:funnel_steps/);
  assert.equal(steps.params[0], ORG_ID);
  assertSqlHas(steps.sql, { people: "e.payload->>'actor' = 'person'", demo: "e.is_demo IS NOT TRUE" });
  const [labels] = sqlCalls(result, /-- m5:ad_labels/);
  assert.deepEqual(labels.params, [ORG_ID]);
  assert.ok(result.body.rows.every((r) => r.funnel_key !== "not_ours"), "another company's funnel and numbers never appear");
});

test("GET marketing/funnels/stats keeps unknown numbers null: no saved ad-day means no spend figure, a page the tracker does not run has no page views", async () => {
  const world = statsWorld();
  world.spend = [];
  world.funnels = [funnelRow({ key: "book_call", name: "Book a call", landing_url: "https://elsewhere.example/page" })];
  world.leads = [{ org_id: ORG_ID, ad_number: "43", leads: 2, booked: 0, showed: 0, sales: 0, cash_cents: null }];
  const result = await call(statsHandler, { deps: { now: () => NOW }, rules: statsRules(world) });
  assert.equal(result.status, 200);
  assert.equal(result.body.unmapped_spend_cents, null, "no ad-day at all in the window: unknown, never 0");
  assert.deepEqual(result.body.rows, [{
    funnel_key: "book_call", name: "Book a call", spend_cents: null, page_views: null, click_to_page: null, page_to_lead: null,
    leads: 2, booked: 0, showed: 0, sales: 0, cash_cents: null, roas: null,
  }]);
  assert.equal(dataCalls(result).every((entry) => !/INSERT|UPDATE|DELETE/.test(entry.sql)), true, "a read writes nothing");
});

test("GET marketing/funnels/stats is owner and admin only, and POST is refused", async () => {
  await assertRoleGate(statsHandler, ["owner", "admin"], { deps: { now: () => NOW }, rules: statsRules(statsWorld()) });
  const post = await call(statsHandler, { method: "POST", rules: [] });
  assert.equal(post.status, 405);
});
