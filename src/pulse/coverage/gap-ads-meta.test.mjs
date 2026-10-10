import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CAMPAIGNS_SQL,
  CAMPAIGN_FIELDS,
  CHECK_IDS,
  CLOCK_SLACK_MS,
  CONNECTIONS_SQL,
  CONNECTION_COUNT_SQL,
  DEFAULT_META_API_VERSION,
  LOAD_JOBS_SQL,
  MAX_PAGES,
  QUEUE_WAIT_MS,
  RUNNING_WAIT_MS,
  STALE_AFTER_MINUTES,
  gapChecks,
  judgeCampaigns,
  naVerify,
  readMetaCampaigns
} from "./gap-ads-meta.mjs";
import { QUEUE_WAIT_MS as MQ_WAIT, FAILED_LOOKBACK_DAYS } from "./gap-marketing-queue.mjs";
import { STALE_AFTER_MINUTES as REAL_STALE } from "../../marketing/jobs.mjs";
import { DEFAULT_META_API_VERSION as SYNC_VERSION } from "../../../api/campaigns/sync.mjs";
import { encryptToken } from "../../adplatforms/tokens.mjs";
import { verifyNa } from "../na-conditions.mjs";
import {
  HAS_DB, ORG, closeShadowDb, runShadowSql, shadow, tagDb, withShadows
} from "./money-test-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-ads-meta.mjs"), "utf8");
const NOW = new Date("2026-10-10T18:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const byId = (rows, id) => rows.find((r) => r.id === id);

const KEY = crypto.randomBytes(32).toString("base64");
const ENV = { AD_TOKEN_ENC_KEY: KEY };
const PARTNER = "99999999-0000-4000-8000-000000000001";
const TOKEN = "EAAB_test_token_value_that_must_never_be_printed";
const STORED = encryptToken(TOKEN, { partnerId: PARTNER, env: ENV });
const CONN = { id: "cccccccc-0000-4000-8000-0000000000aa", partner_id: PARTNER, external_ad_account_id: "act_555", encrypted_access_token: STORED };

const mine = (over = {}) => ({
  external_id: "100", name: "Funding VSL", status: "PAUSED", budget_cents: 5000, synced_at: ago(2 * HOUR), updated_at: ago(2 * HOUR), ...over
});
const theirs = (over = {}) => ({ id: "100", name: "Funding VSL", status: "PAUSED", daily_budget: "5000", updated_time: ago(3 * HOUR), ...over });

function metaFetch(pages, log = []) {
  let i = 0;
  return async (url, init = {}) => {
    log.push({ url: String(url), method: init.method, auth: init.headers && init.headers.authorization });
    const p = pages[Math.min(i, pages.length - 1)];
    i += 1;
    if (p instanceof Error) throw p;
    return { status: p.status ?? 200, text: async () => (typeof p.body === "string" ? p.body : JSON.stringify(p.body)) };
  };
}

function db({ conns = [CONN], campaigns = [mine()], jobs = {} } = {}, seen = []) {
  return tagDb({
    "ads-meta-connections": conns,
    "ads-meta-campaigns": campaigns,
    "ads-meta-connection-count": { n: conns.length },
    "ads-meta-load-jobs": {
      total_n: 0, failed_n: 0, queued_n: 0, running_n: 0, video_error_n: 0, oldest: null, errors: null, ...jobs
    }
  }, seen);
}
const run = (over = {}, ctx = {}) => gapChecks({
  db: db(over.db), scope: (fn) => fn(db(over.db)), orgId: ORG, now: NOW, env: ENV,
  fetchImpl: metaFetch(over.pages || [{ body: { data: [theirs()] } }], over.log || []), ...ctx
});

test("gap ads-meta: the source is read only, never sends a method but GET, and never writes a key", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b\s+(INTO|FROM|TABLE|SET)?/);
  assert.doesNotMatch(SRC, /\bfetchImpl\s*\(/);
  assert.doesNotMatch(SRC, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(SRC, /encryptToken|updateBudget|createCampaign|createAd\b|resume|pauseCampaign|guardedWrite|callPlatform/);
  assert.deepEqual([...CHECK_IDS], ["ads-meta:matches", "ads-meta:load-jobs"]);
});

test("gap ads-meta: the windows and the version are the ones the code they mirror uses", () => {
  assert.equal(DEFAULT_META_API_VERSION, SYNC_VERSION);
  assert.equal(QUEUE_WAIT_MS, MQ_WAIT);
  assert.equal(STALE_AFTER_MINUTES, REAL_STALE);
  assert.equal(RUNNING_WAIT_MS, (REAL_STALE + 15) * MIN);
  assert.equal(CLOCK_SLACK_MS, 2 * MIN);
  assert.ok(FAILED_LOOKBACK_DAYS > 0);
  assert.match(CAMPAIGN_FIELDS, /\bdaily_budget\b/);
  assert.match(CAMPAIGN_FIELDS, /\bupdated_time\b/);
});

describe("gap ads-meta: judgeCampaigns", () => {
  test("equal state and budget is clean, and counts the pair", () => {
    const j = judgeCampaigns({ ours: [mine()], meta: [theirs()] });
    assert.deepEqual(j, { compared: 1, behind: 0, status: [], budget: [], missing: [], unread: 0 });
  });

  test("we say paused and Meta says active: the money case, named with both words", () => {
    const j = judgeCampaigns({ ours: [mine({ status: "PAUSED" })], meta: [theirs({ status: "ACTIVE" })] });
    assert.deepEqual(j.status, ["Funding VSL: we show PAUSED, Meta says ACTIVE"]);
  });

  test("case does not matter, and a campaign with no status on one side is not a mismatch", () => {
    assert.deepEqual(judgeCampaigns({ ours: [mine({ status: "paused" })], meta: [theirs({ status: "PAUSED" })] }).status, []);
    assert.deepEqual(judgeCampaigns({ ours: [mine({ status: null })], meta: [theirs()] }).status, []);
  });

  test("the budget is compared only when Meta sends one, in whole cents", () => {
    assert.deepEqual(judgeCampaigns({ ours: [mine({ budget_cents: 5000 })], meta: [theirs({ daily_budget: "7500" })] }).budget,
      ["Funding VSL: we show 5000 cents a day, Meta says 7500"]);
    assert.deepEqual(judgeCampaigns({ ours: [mine()], meta: [theirs({ daily_budget: undefined })] }).budget, []);
    assert.deepEqual(judgeCampaigns({ ours: [mine()], meta: [theirs({ daily_budget: null })] }).budget, []);
    assert.deepEqual(judgeCampaigns({ ours: [mine({ budget_cents: null })], meta: [theirs()] }).budget, []);
  });

  test("a campaign Meta changed after our row was last saved is behind, not wrong", () => {
    const j = judgeCampaigns({
      ours: [mine({ status: "PAUSED", synced_at: ago(2 * HOUR), updated_at: ago(2 * HOUR) })],
      meta: [theirs({ status: "ACTIVE", updated_time: ago(10 * MIN) })]
    });
    assert.equal(j.behind, 1);
    assert.deepEqual(j.status, []);
  });

  test("Meta changed it two minutes or less after our save is clock slop, still judged", () => {
    const t = new Date(NOW.getTime() - HOUR);
    const j = judgeCampaigns({
      ours: [mine({ status: "PAUSED", synced_at: t.toISOString(), updated_at: t.toISOString() })],
      meta: [theirs({ status: "ACTIVE", updated_time: new Date(t.getTime() + CLOCK_SLACK_MS - 1000).toISOString() })]
    });
    assert.equal(j.status.length, 1);
  });

  test("our local write after Meta's last change counts as our touch (the Stop spending that Meta did not take)", () => {
    const j = judgeCampaigns({
      ours: [mine({ status: "PAUSED", synced_at: ago(5 * HOUR), updated_at: ago(HOUR) })],
      meta: [theirs({ status: "ACTIVE", updated_time: ago(3 * HOUR) })]
    });
    assert.equal(j.status.length, 1);
  });

  test("a running campaign Meta does not list is missing, but a cut-short list proves nothing", () => {
    assert.deepEqual(judgeCampaigns({ ours: [mine({ status: "ACTIVE" })], meta: [] }).missing, ["Funding VSL"]);
    const cut = judgeCampaigns({ ours: [mine({ status: "ACTIVE" })], meta: [], truncated: true });
    assert.deepEqual(cut.missing, []);
    assert.equal(cut.unread, 1);
    assert.deepEqual(judgeCampaigns({ ours: [mine({ status: "PAUSED" })], meta: [] }).missing, []);
  });
});

describe("gap ads-meta: readMetaCampaigns", () => {
  test("one GET per page, a Bearer header, the account path, no key in the address, the next link followed", async () => {
    const log = [];
    const fetchImpl = metaFetch([
      { body: { data: [theirs({ id: "1" })], paging: { next: "https://graph.facebook.com/v26.0/act_555/campaigns?after=A" } } },
      { body: { data: [theirs({ id: "2" })] } }
    ], log);
    const got = await readMetaCampaigns({ fetchImpl, token: TOKEN, accountId: "555", version: "v26.0" });
    assert.deepEqual(got.rows.map((r) => r.id), ["1", "2"]);
    assert.equal(got.truncated, false);
    assert.equal(log.length, 2);
    assert.ok(log.every((c) => c.method === "GET" && c.auth === `Bearer ${TOKEN}`));
    assert.ok(log.every((c) => !c.url.includes(TOKEN)));
    assert.match(log[0].url, /^https:\/\/graph\.facebook\.com\/v26\.0\/act_555\/campaigns\?fields=id%2Cname%2Cstatus/);
    assert.equal(log[1].url, "https://graph.facebook.com/v26.0/act_555/campaigns?after=A");
  });

  test("it stops at the page cap and says the list was cut short", async () => {
    const log = [];
    const pages = Array.from({ length: 6 }, (_, i) => ({ body: { data: [theirs({ id: String(i) })], paging: { next: `https://graph.facebook.com/v26.0/act_555/campaigns?after=${i}` } } }));
    const got = await readMetaCampaigns({ fetchImpl: metaFetch(pages, log), token: TOKEN, accountId: "act_555", version: "v26.0" });
    assert.equal(log.length, MAX_PAGES);
    assert.equal(got.truncated, true);
    assert.match(log[0].url, /\/act_555\/campaigns/);
  });

  test("a refusal throws with the status and never the body", async () => {
    await assert.rejects(
      readMetaCampaigns({ fetchImpl: metaFetch([{ status: 401, body: { error: { message: `bad token ${TOKEN}` } } }]), token: TOKEN, accountId: "1", version: "v26.0" }),
      (err) => err.status === 401 && !String(err.message).includes(TOKEN)
    );
  });
});

describe("gap ads-meta: ads-meta:matches", () => {
  test("campaigns that agree with Meta are a PASS, and the Meta key is not in any row", async () => {
    const log = [];
    const rows = await run({ log });
    const r = byId(rows, "ads-meta:matches");
    assert.equal(r.status, "PASS");
    assert.match(r.detail, /1 campaign compared with Meta on 1 connection: running state and daily budget agree/);
    assert.equal(log.length, 1);
    assert.equal(log[0].method, "GET");
    assert.equal(log[0].auth, `Bearer ${TOKEN}`);
    assert.ok(!JSON.stringify(rows).includes(TOKEN));
    assert.ok(!JSON.stringify(rows).includes(STORED));
  });

  test("META_API_VERSION wins when it is set, as it does in the sync", async () => {
    const log = [];
    await run({ log }, { env: { ...ENV, META_API_VERSION: "v27.0" } });
    assert.match(log[0].url, /\/v27\.0\/act_555\/campaigns/);
  });

  test("a paused campaign Meta still runs is red, the budget is red, a missing running campaign is red", async () => {
    const status = byId(await run({ pages: [{ body: { data: [theirs({ status: "ACTIVE", updated_time: ago(9 * HOUR) })] } }] }), "ads-meta:matches");
    assert.equal(status.status, "FAIL");
    assert.match(status.detail, /1 campaign with the wrong running state \(Funding VSL: we show PAUSED, Meta says ACTIVE\)/);
    assert.match(status.suggestedFix, /spending real money/);
    assert.match(status.suggestedFix, /Recon \(AG-07\) is the one tripwire/);

    const budget = byId(await run({ pages: [{ body: { data: [theirs({ daily_budget: "9900" })] } }] }), "ads-meta:matches");
    assert.equal(budget.status, "FAIL");
    assert.match(budget.detail, /wrong daily budget/);

    const missing = byId(await run({ db: { campaigns: [mine({ status: "ACTIVE" })] }, pages: [{ body: { data: [] } }] }), "ads-meta:matches");
    assert.equal(missing.status, "FAIL");
    assert.match(missing.detail, /we show as running that Meta does not list \(Funding VSL\)/);
  });

  test("a change made in Meta since our last save is a note on a PASS, not a red", async () => {
    const r = byId(await run({ pages: [{ body: { data: [theirs({ status: "ACTIVE", updated_time: ago(5 * MIN) })] } }] }), "ads-meta:matches");
    assert.equal(r.status, "PASS");
    assert.match(r.detail, /1 campaign changed in Meta since our last sync/);
  });

  test("a key it cannot open, Meta refusing the key, and a network failure are skips with the reason", async () => {
    const noKey = byId(await run({}, { env: {} }), "ads-meta:matches");
    assert.equal(noKey.status, "skip");
    assert.match(noKey.detail, /AD_TOKEN_ENC_KEY is not set/);
    assert.ok(!JSON.stringify(noKey).includes(TOKEN));

    const refused = byId(await run({ pages: [{ status: 401, body: { error: { message: "Invalid OAuth access token" } } }] }), "ads-meta:matches");
    assert.equal(refused.status, "skip");
    assert.match(refused.detail, /Meta answered 401/);

    const down = byId(await run({ pages: [new Error("getaddrinfo ENOTFOUND graph.facebook.com")] }), "ads-meta:matches");
    assert.equal(down.status, "skip");
  });

  test("no connected account is nothing to judge with a staff scope, and a skip without one", async () => {
    const scoped = byId(await run({ db: { conns: [] } }), "ads-meta:matches");
    assert.equal(scoped.status, "na");
    assert.equal(scoped.na.code, "not-connected");
    assert.deepEqual(scoped.na.args, { check: "ads-meta:matches", what: "A Meta ad account" });
    const blind = byId(await gapChecks({ db: db({ conns: [] }), orgId: ORG, now: NOW, env: ENV, fetchImpl: metaFetch([{ body: { data: [] } }]) }), "ads-meta:matches");
    assert.equal(blind.status, "skip");
    assert.match(blind.detail, /no staff scope/);
  });

  test("naVerify is true only while no active connection with a key is saved", async () => {
    const none = db({ conns: [] });
    const some = db({ conns: [CONN] });
    const args = { check: "ads-meta:matches", what: "A Meta ad account" };
    assert.equal(await naVerify["not-connected"](args, { db: none, scope: (fn) => fn(none), now: NOW }), true);
    assert.equal(await naVerify["not-connected"](args, { db: some, scope: (fn) => fn(some), now: NOW }), false);
    assert.equal(await naVerify["not-connected"](args, { db: none, now: NOW }), false, "without a staff scope the ad tables read empty, so it cannot say");
    const row = { id: "gap-ads-meta:ads-meta:matches", sliceId: "gap-ads-meta", status: "na", na: { code: "not-connected", args } };
    const ok = await verifyNa(row, { laneNaVerify: async (_s, code, a) => naVerify[code](a, { db: none, scope: (fn) => fn(none), now: NOW }) });
    assert.equal(ok.ok, true, ok.reason);
  });

  test("no database and no fetch are skips", async () => {
    assert.equal(byId(await gapChecks({ now: NOW, env: ENV }), "ads-meta:matches").status, "skip");
    const noFetch = byId(await gapChecks({ db: db(), scope: (fn) => fn(db()), orgId: ORG, now: NOW, env: ENV }), "ads-meta:matches");
    assert.equal(noFetch.status, "skip");
    assert.match(noFetch.detail, /no fetch/);
  });
});

describe("gap ads-meta: ads-meta:load-jobs", () => {
  const rowFor = async (jobs) => byId(await run({ db: { jobs } }), "ads-meta:load-jobs");

  test("no loader job yet is a PASS that says so; jobs on file with none failed or stuck is a PASS", async () => {
    const none = await rowFor({});
    assert.equal(none.status, "PASS");
    assert.match(none.detail, /no ad has been sent to Meta by the loader yet/);
    const fine = await rowFor({ total_n: 4 });
    assert.match(fine.detail, /4 Load-to-Meta jobs on file, none failed in 7 days, none stuck/);
  });

  test("failed, queued too long, claimed and silent, and an approved video holding a load error are each red", async () => {
    const r = await rowFor({
      total_n: 6, failed_n: 1, queued_n: 2, running_n: 1, video_error_n: 1, oldest: ago(2 * DAY),
      errors: "Meta said the video could not be processed"
    });
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /1 load failed for good in the last 7 days/);
    assert.match(r.detail, /2 loads queued past the 45 minute wait/);
    assert.match(r.detail, /1 load claimed and silent for over 31 minutes/);
    assert.match(r.detail, /1 approved video holding a load error and never loaded/);
    assert.match(r.detail, /could not be processed/);
    assert.match(r.suggestedFix, /only ever loads an ad PAUSED/);
  });

  test("a failed read is a skip with the reason", async () => {
    const bad = tagDb({ "ads-meta-connections": [], "ads-meta-load-jobs": new Error("relation \"marketing_jobs\" does not exist") });
    const rows = await gapChecks({ db: bad, orgId: ORG, now: NOW, env: ENV });
    const r = byId(rows, "ads-meta:load-jobs");
    assert.equal(r.status, "skip");
    assert.match(r.detail, /does not exist/);
  });
});

/* ---- the SQL, run for real against made-up tables -------------------------------------------- */

const JOB_COLS = [
  ["org_id", "uuid"], ["kind", "text"], ["status", "text"], ["finished_at", "timestamptz"], ["updated_at", "timestamptz"],
  ["run_after", "timestamptz"], ["claimed_at", "timestamptz"], ["created_at", "timestamptz"], ["error", "text"]
];
const VIDEO_COLS = [["org_id", "uuid"], ["load_error", "text"], ["loaded_at", "timestamptz"]];
const job = (over = {}) => ({
  org_id: ORG, kind: "meta_load", status: "done", finished_at: ago(DAY), updated_at: ago(DAY), run_after: ago(DAY),
  claimed_at: ago(DAY), created_at: ago(DAY), error: null, ...over
});

// want: [total_n, failed_n, queued_n, running_n, video_error_n]
const JOB_CASES = [
  ["no jobs", { jobs: [], videos: [] }, [0, 0, 0, 0, 0]],
  ["a done job is fine", { jobs: [job()], videos: [] }, [1, 0, 0, 0, 0]],
  ["failed 2 days ago is red", { jobs: [job({ status: "failed", error: "Meta could not process the video", finished_at: ago(2 * DAY) })], videos: [] }, [1, 1, 0, 0, 0]],
  ["failed 9 days ago is history", { jobs: [job({ status: "failed", error: "old", finished_at: ago(9 * DAY), updated_at: ago(9 * DAY) })], videos: [] }, [1, 0, 0, 0, 0]],
  ["queued and due 2 hours ago is stuck", { jobs: [job({ status: "queued", run_after: ago(2 * HOUR), claimed_at: null })], videos: [] }, [1, 0, 1, 0, 0]],
  ["queued and due 10 minutes ago is the clock's job", { jobs: [job({ status: "queued", run_after: ago(10 * MIN), claimed_at: null })], videos: [] }, [1, 0, 0, 0, 0]],
  ["queued for later (a 10 second wait loop) is not stuck", { jobs: [job({ status: "queued", run_after: new Date(NOW.getTime() + 10 * 1000).toISOString() })], videos: [] }, [1, 0, 0, 0, 0]],
  ["running and claimed 40 minutes ago is stuck", { jobs: [job({ status: "running", claimed_at: ago(40 * MIN) })], videos: [] }, [1, 0, 0, 1, 0]],
  ["running and claimed 5 minutes ago is working", { jobs: [job({ status: "running", claimed_at: ago(5 * MIN) })], videos: [] }, [1, 0, 0, 0, 0]],
  ["a job of another kind is not read", { jobs: [job({ kind: "avatar", status: "failed", error: "x" })], videos: [] }, [0, 0, 0, 0, 0]],
  ["another org's job is not read", { jobs: [job({ org_id: "22222222-2222-4222-8222-222222222222", status: "failed", error: "x" })], videos: [] }, [0, 0, 0, 0, 0]],
  [
    "a video holding a load error and never loaded is red",
    { jobs: [], videos: [{ org_id: ORG, load_error: "Meta read back an enhancement turned on", loaded_at: null }] },
    [0, 0, 0, 0, 1]
  ],
  [
    "a video that loaded after an error is fine",
    { jobs: [], videos: [{ org_id: ORG, load_error: "old error", loaded_at: ago(DAY) }] },
    [0, 0, 0, 0, 0]
  ]
];

describe("gap ads-meta: the load-jobs SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);
  for (const [name, scenario, want] of JOB_CASES) {
    test(name, async () => {
      const sql = withShadows(LOAD_JOBS_SQL, [shadow("marketing_jobs", JOB_COLS, scenario.jobs), shadow("ad_videos", VIDEO_COLS, scenario.videos)]);
      const { rows } = await runShadowSql(sql, [ORG, ago(FAILED_LOOKBACK_DAYS * DAY), ago(QUEUE_WAIT_MS), ago(RUNNING_WAIT_MS)]);
      const r = rows[0];
      assert.deepEqual([r.total_n, r.failed_n, r.queued_n, r.running_n, r.video_error_n].map(Number), want, name);
    });
  }

  test("the failure reasons are joined and cut short", async () => {
    const sql = withShadows(LOAD_JOBS_SQL, [
      shadow("marketing_jobs", JOB_COLS, [
        job({ status: "failed", error: "first reason", finished_at: ago(HOUR) }),
        job({ status: "failed", error: "second reason", finished_at: ago(HOUR) })
      ]),
      shadow("ad_videos", VIDEO_COLS, [])
    ]);
    const { rows } = await runShadowSql(sql, [ORG, ago(FAILED_LOOKBACK_DAYS * DAY), ago(QUEUE_WAIT_MS), ago(RUNNING_WAIT_MS)]);
    assert.match(rows[0].errors, /first reason/);
    assert.match(rows[0].errors, /second reason/);
  });
});

const CONN_COLS = [
  ["id", "uuid"], ["partner_id", "uuid"], ["external_ad_account_id", "text"], ["encrypted_access_token", "text"],
  ["platform", "text"], ["connection_state", "text"], ["last_synced_at", "timestamptz"]
];
const CAMP_COLS = [
  ["connection_id", "uuid"], ["platform", "text"], ["external_id", "text"], ["name", "text"], ["status", "text"],
  ["budget_cents", "bigint"], ["synced_at", "timestamptz"], ["updated_at", "timestamptz"]
];
const conn = (n, over = {}) => ({
  id: `cccccccc-0000-4000-8000-${String(n).padStart(12, "0")}`, partner_id: PARTNER, external_ad_account_id: `act_${n}`,
  encrypted_access_token: STORED, platform: "meta", connection_state: "active", last_synced_at: ago(HOUR), ...over
});

describe("gap ads-meta: the connection and campaign SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);

  test("only an active Meta connection with a key and a real account number is read, freshest first, at most three", async () => {
    const conns = [
      conn(1, { last_synced_at: ago(5 * HOUR) }),
      conn(2, { connection_state: "pending" }),
      conn(3, { platform: "tiktok" }),
      conn(4, { encrypted_access_token: null }),
      conn(5, { external_ad_account_id: "pending:biz:123" }),
      conn(6, { external_ad_account_id: null }),
      conn(7, { last_synced_at: ago(MIN) }),
      conn(8, { last_synced_at: ago(2 * HOUR) }),
      conn(9, { last_synced_at: ago(3 * HOUR) })
    ];
    const sql = withShadows(CONNECTIONS_SQL, [shadow("ad_platform_connections", CONN_COLS, conns)]);
    const { rows } = await runShadowSql(sql);
    assert.deepEqual(rows.map((r) => r.external_ad_account_id), ["act_7", "act_8", "act_9"]);
    const count = await runShadowSql(withShadows(CONNECTION_COUNT_SQL, [shadow("ad_platform_connections", CONN_COLS, conns)]));
    assert.equal(Number(count.rows[0].n), 4);
  });

  test("our campaigns are read by connection, meta only, with an external id", async () => {
    const A = "cccccccc-0000-4000-8000-0000000000a1";
    const B = "cccccccc-0000-4000-8000-0000000000b2";
    const rows = [
      { connection_id: A, platform: "meta", external_id: "1", name: "A1", status: "ACTIVE", budget_cents: 5000, synced_at: ago(HOUR), updated_at: ago(HOUR) },
      { connection_id: A, platform: "meta", external_id: null, name: "draft", status: null, budget_cents: 0, synced_at: null, updated_at: ago(HOUR) },
      { connection_id: A, platform: "tiktok", external_id: "9", name: "T", status: "ACTIVE", budget_cents: 1, synced_at: null, updated_at: ago(HOUR) },
      { connection_id: B, platform: "meta", external_id: "2", name: "B1", status: "PAUSED", budget_cents: 100, synced_at: ago(HOUR), updated_at: ago(HOUR) }
    ];
    const sql = withShadows(CAMPAIGNS_SQL, [shadow("campaigns", CAMP_COLS, rows)]);
    const got = await runShadowSql(sql, [A]);
    assert.deepEqual(got.rows.map((r) => r.external_id), ["1"]);
  });
});
