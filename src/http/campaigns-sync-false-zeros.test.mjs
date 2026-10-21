// META'S FALSE ZEROS MUST NEVER REACH ad_metrics_daily — 2026-10-21.
//
// What happened. The 07:00 UTC nightly pull on 2026-10-21 wrote spend 0,
// impressions 0 and clicks 0 over every real ad day from 2026-09-26 to
// 2026-10-07. ctr, the video counts and link clicks on the same rows stayed
// filled. Read-only GETs to Meta the same morning showed why: over a window of
// more than one day, with one row per day (time_increment=1), Meta answers the
// money fields with "0" whenever the same request also asks for `actions`,
// `inline_link_clicks`, `cost_per_action_type` or any *_actions field. Asked on
// their own, the money fields come back real.
//
// The fake Meta below answers exactly that way. The sync must store the REAL
// spend. Run against the old single-request sync, the first test stores 0 and
// fails — that is the proof this file would have caught the break.
//
// NO DATABASE AND NO NETWORK. syncPartnerConnections() takes its scope as an
// argument, so the whole pull runs against a fake transaction. This file
// imports nothing the old sync did not already export, on purpose.
//
// Lives under src/ because npm test's glob is "src/**" and "scripts/**"
// (CLAUDE.md §12).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { syncPartnerConnections } from "../../api/campaigns/sync.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";

const PARTNER = "11111111-1111-1111-1111-111111111111";
const ORG = "22222222-2222-2222-2222-222222222222";
const CONN = "33333333-3333-3333-3333-333333333333";

const saved = {};
before(() => {
  for (const k of ["AD_TOKEN_ENC_KEY", "META_API_VERSION"]) saved[k] = process.env[k];
  process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
  delete process.env.META_API_VERSION;
});
after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/* The exact core list that Meta answered with real numbers on 2026-10-21. */
const CORE_LIST = "ad_id,spend,impressions,clicks,ctr,purchase_roas,date_start";
const MONEY = ["spend", "impressions", "clicks", "ctr", "purchase_roas"];
const triggersZeros = (f) =>
  f === "actions" || f === "inline_link_clicks" || f === "cost_per_action_type" || f.endsWith("_actions");

const views = (n) => [{ action_type: "video_view", value: String(n) }];

/* What Meta really holds. Values copied from the read-only one-day pulls of
   2026-10-21 (SLO1 and SLO2 on 2026-10-01). PHOTO has delivery and no video
   or results line. ATTRIB has a results line and no delivery that day — Meta
   sends that row only to a request that asks for the action fields (seen live:
   the core request answered 36 rows, the detail request 38). */
const TRUTH = [
  {
    ad_id: "slo1", date_start: "2026-10-01",
    spend: "2.35", impressions: "23", clicks: "1", ctr: "4.347826",
    inline_link_clicks: "1",
    actions: [{ action_type: "link_click", value: "1" }, { action_type: "video_view", value: "9" }],
    video_p25_watched_actions: views(2), video_play_actions: [{ action_type: "video_play", value: "9" }]
  },
  {
    ad_id: "slo2", date_start: "2026-10-01",
    spend: "123.33", impressions: "538", clicks: "26", ctr: "4.832714",
    inline_link_clicks: "20",
    actions: [
      { action_type: "link_click", value: "20" },
      { action_type: "landing_page_view", value: "14" },
      { action_type: "omni_purchase", value: "1" }
    ],
    cost_per_action_type: [{ action_type: "omni_purchase", value: "123.33" }],
    video_p25_watched_actions: views(42)
  },
  {
    ad_id: "photo", date_start: "2026-10-02",
    spend: "7.10", impressions: "300", clicks: "4", ctr: "1.333333"
  },
  {
    ad_id: "attrib", date_start: "2026-10-06",
    actions: [{ action_type: "omni_purchase", value: "1" }]
  }
];

const ADS = ["slo1", "slo2", "photo", "attrib"];

/* A fake Meta that behaves the way Meta behaved on 2026-10-21. Options:
     cutCore / cutDetail  the named rows come on page 1, then the request pages
                          on forever (so the sync's page cap cuts it short)
     refuse               "core" or "detail": that request answers 400 */
function fakeMeta({ cutCore = null, cutDetail = null, refuse = null } = {}) {
  const urls = [];
  const fetch = async (url) => {
    const u = String(url);
    urls.push(u);
    const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    if (u.includes("/insights")) {
      const q = new URL(u).searchParams;
      const fields = String(q.get("fields") || "").split(",").filter(Boolean);
      const asksDetail = fields.some(triggersZeros);
      const kind = asksDetail ? (fields.includes("spend") ? "combined" : "detail") : "core";
      if (refuse && refuse === kind) {
        return {
          ok: false, status: 400,
          text: async () => JSON.stringify({ error: { message: `Meta refused the ${kind} request`, code: 1 } })
        };
      }
      if (q.get("page")) {
        return ok({ data: [], paging: { next: `${u.split("&page=")[0]}&page=${Number(q.get("page")) + 1}` } });
      }
      const range = q.get("time_range") ? JSON.parse(q.get("time_range")) : null;
      const manyDays = Boolean(q.get("date_preset")) || (range && range.since !== range.until);
      const zeros = manyDays && q.get("time_increment") === "1" && asksDetail;
      const cut = kind === "core" ? cutCore : kind === "detail" ? cutDetail : null;
      const data = [];
      for (const t of TRUTH) {
        if (cut && !cut.includes(t.ad_id)) continue;
        const row = {};
        let has = false;
        for (const f of fields) {
          if (t[f] === undefined) continue;
          row[f] = t[f];
          if (f !== "ad_id" && f !== "date_start") has = true;
        }
        if (!has) continue;                       // Meta sends no row with nothing in it
        if (zeros) for (const f of ["spend", "impressions", "clicks"]) if (f in row) row[f] = "0";
        data.push(row);
      }
      const body = { data };
      if (cut) body.paging = { next: `${u}&page=2` };
      return ok(body);
    }
    if (u.includes("/campaigns?")) return ok({ data: [{ id: "c1", name: "Campaign", status: "ACTIVE" }] });
    if (u.includes("/adsets?")) return ok({ data: [{ id: "s1", name: "Ad set", status: "ACTIVE", campaign_id: "c1" }] });
    if (u.includes("/ads?")) {
      return ok({ data: ADS.map((id) => ({ id, name: `Ad ${id}`, status: "ACTIVE", adset_id: "s1" })) });
    }
    return ok({ data: [] });
  };
  return { fetch, urls };
}

/* A fake database. Days older than the window are already stored (so the
   nightly pass asks for its 28-day window) unless `firstPull` is set. Every
   ad_metrics_daily write is kept, keyed by the Meta ad id. */
function fakeDb({ firstPull = false } = {}) {
  const writes = new Map();
  const tx = {
    async query(sql, params = []) {
      const s = String(sql);
      if (/FROM ad_platform_connections/.test(s) && /^\s*SELECT/i.test(s)) {
        return {
          rows: [{
            id: CONN, org_id: ORG, partner_id: PARTNER, platform: "meta",
            connection_state: "active", external_ad_account_id: "act_982103620742368",
            external_business_id: null, created_at: "2026-08-01T00:00:00Z",
            encrypted_access_token: encryptToken("fake-meta-token-for-tests", { partnerId: PARTNER })
          }],
          rowCount: 1
        };
      }
      if (/FROM pg_attribute/.test(s)) return { rows: [{ n: 4 }], rowCount: 1 };
      if (/min\(m\.date\)/.test(s)) return { rows: [{ d: firstPull ? null : "2026-08-17" }], rowCount: 1 };
      if (/INSERT INTO campaigns/.test(s)) return { rows: [{ id: "camp-1" }], rowCount: 1 };
      if (/INSERT INTO ad_sets/.test(s)) return { rows: [{ id: "set-1" }], rowCount: 1 };
      if (/INSERT INTO ads\s*\(/.test(s)) return { rows: [{ id: `row-${params[5]}` }], rowCount: 1 };
      if (/INSERT INTO ad_metrics_daily/.test(s)) {
        writes.set(String(params[2]).replace(/^row-/, ""), params);
        return { rows: [], rowCount: 1 };
      }
      if (/fundhub_reresolve_ad_numbers/.test(s)) return { rows: [{ filled: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  };
  return { scope: async (_who, fn) => fn(tx), writes };
}

const run = (db, meta, pass = "nightly") =>
  syncPartnerConnections({ partnerId: PARTNER, deps: { fetch: meta.fetch }, pass, scope: db.scope });

const insightUrls = (urls) => urls.filter((u) => u.includes("/insights?") && !u.includes("&page="))
  .map((u) => new URL(u));

/* insightUpsertParams order: [4] spend_cents, [5] impressions, [6] clicks,
   [7] ctr, [8] roas, [9..16] the eight video counts ([11] p25), [17] curve,
   [18] purchases, [19] cost_per_purchase_cents, [20] link_clicks,
   [21] landing_page_views. */
const P = { spend: 4, impressions: 5, clicks: 6, ctr: 7, plays: 10, p25: 11, purchases: 18, cpp: 19, link: 20, lpv: 21 };

describe("Meta's false zeros never reach the money columns", () => {
  test("THE BREAK: a 28-day pull stores the REAL spend, impressions and clicks (fails on the old single request)", async () => {
    const db = fakeDb();
    const stats = await run(db, fakeMeta());
    assert.deepEqual(stats.errors, [], JSON.stringify(stats.errors));

    const slo1 = db.writes.get("slo1");
    assert.ok(slo1, "SLO1's day was not written");
    assert.equal(slo1[P.spend], 235, "SLO1 spend was stored as Meta's false zero");
    assert.equal(slo1[P.impressions], 23);
    assert.equal(slo1[P.clicks], 1);
    assert.equal(slo1[P.ctr], 4.347826);

    const slo2 = db.writes.get("slo2");
    assert.equal(slo2[P.spend], 12333, "SLO2 spend was stored as Meta's false zero");
    assert.equal(slo2[P.impressions], 538);
    assert.equal(slo2[P.clicks], 26);
  });

  test("the rest of the day still lands: video counts and results from the second request", async () => {
    const db = fakeDb();
    await run(db, fakeMeta());
    const slo1 = db.writes.get("slo1");
    assert.equal(slo1[P.p25], 2);
    assert.equal(slo1[P.plays], 9);
    assert.equal(slo1[P.link], 1);
    const slo2 = db.writes.get("slo2");
    assert.equal(slo2[P.p25], 42);
    assert.equal(slo2[P.purchases], 1);
    assert.equal(slo2[P.cpp], 12333);
    assert.equal(slo2[P.link], 20);
    assert.equal(slo2[P.lpv], 14);
  });

  test("two requests: the money on its own, and no money field on the other one", async () => {
    const meta = fakeMeta();
    await run(fakeDb(), meta);
    const asked = insightUrls(meta.urls);
    assert.equal(asked.length, 2, `the numbers were asked for ${asked.length} times`);
    const [core, detail] = asked.map((u) => u.searchParams.get("fields").split(","));
    assert.deepEqual(core.join(","), CORE_LIST, "the money request is not the list Meta answered for real");
    assert.equal(core.some(triggersZeros), false, `the money request asks for ${core.filter(triggersZeros)}`);
    for (const f of MONEY) assert.equal(detail.includes(f), false, `the second request asks for ${f}`);
    for (const f of ["actions", "inline_link_clicks", "cost_per_action_type", "video_p25_watched_actions", "video_play_curve_actions"]) {
      assert.ok(detail.includes(f), `the second request lost ${f}`);
    }
    for (const u of asked) {
      assert.equal(u.pathname, "/v26.0/act_982103620742368/insights");
      assert.equal(u.searchParams.get("level"), "ad");
      assert.equal(u.searchParams.get("time_increment"), "1");
    }
    assert.equal(asked[0].searchParams.get("time_range"), asked[1].searchParams.get("time_range"),
      "the two requests asked for different days");
  });

  test("the hourly 3-day pass is fixed the same way", async () => {
    const db = fakeDb();
    const meta = fakeMeta();
    await run(db, meta, "hourly");
    assert.equal(db.writes.get("slo2")[P.spend], 12333);
    assert.equal(insightUrls(meta.urls).length, 2);
  });

  test("a first pull (the whole history) is fixed the same way, and full_history counts the real days", async () => {
    const db = fakeDb({ firstPull: true });
    const meta = fakeMeta();
    const stats = await run(db, meta);
    const asked = insightUrls(meta.urls);
    assert.equal(asked.length, 2);
    for (const u of asked) assert.equal(u.searchParams.get("date_preset"), "maximum");
    assert.equal(db.writes.get("slo1")[P.spend], 235);
    assert.deepEqual(stats.full_history, [{ connection: CONN, ok: true, days: 4 }]);
  });
});

describe("joining the two answers: the edge cases", () => {
  test("a day with delivery and no video or results line is written with NULLs, not zeros", async () => {
    const db = fakeDb();
    await run(db, fakeMeta());
    const photo = db.writes.get("photo");
    assert.equal(photo[P.spend], 710);
    assert.equal(photo[P.impressions], 300);
    for (const i of [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]) {
      assert.strictEqual(photo[i], null, `column ${i} came back ${JSON.stringify(photo[i])}`);
    }
  });

  test("a results line with no delivery, both answers complete: written with spend 0 — that is Meta's truth", async () => {
    const db = fakeDb();
    await run(db, fakeMeta());
    const attrib = db.writes.get("attrib");
    assert.ok(attrib, "the results-only day was dropped");
    assert.equal(attrib[P.spend], 0);
    assert.equal(attrib[P.impressions], 0);
    assert.equal(attrib[P.purchases], 1);
  });

  test("the money answer cut short: a day it never reached is HELD, not written as 0, and the run says so", async () => {
    const db = fakeDb();
    const stats = await run(db, fakeMeta({ cutCore: ["slo1"] }));
    assert.equal(db.writes.get("slo1")[P.spend], 235, "the day it did reach was lost");
    for (const ad of ["slo2", "attrib"]) {
      assert.equal(db.writes.has(ad), false, `${ad}'s money was guessed from the second request`);
    }
    const errors = stats.errors.map((e) => e.error).join(" | ");
    assert.match(errors, /stopped after 100 pages of spend numbers/);
    assert.match(errors, /2 days of numbers were not saved/);
    assert.ok(stats.errors.every((e) => e.connection === CONN));
  });

  test("the video and results answer cut short: a day it never reached is HELD, so stored video numbers are not blanked", async () => {
    const db = fakeDb();
    const stats = await run(db, fakeMeta({ cutDetail: ["slo1"] }));
    assert.equal(db.writes.get("slo1")[P.p25], 2);
    for (const ad of ["slo2", "photo"]) {
      assert.equal(db.writes.has(ad), false, `${ad} was written with its video and results blanked`);
    }
    const errors = stats.errors.map((e) => e.error).join(" | ");
    assert.match(errors, /stopped after 100 pages of video and results numbers/);
    assert.match(errors, /2 days of numbers were not saved/);
  });

  test("Meta refuses the money request: nothing is written and the account names the error", async () => {
    const db = fakeDb();
    const meta = fakeMeta({ refuse: "core" });
    const stats = await run(db, meta);
    assert.equal(db.writes.size, 0);
    assert.match(stats.errors[0].error, /Meta refused the core request/);
    assert.equal(insightUrls(meta.urls).length, 1, "the second request was spent after the first was refused");
  });

  test("Meta refuses the second request: nothing is written, as when the one request failed", async () => {
    const db = fakeDb();
    const stats = await run(db, fakeMeta({ refuse: "detail" }));
    assert.equal(db.writes.size, 0);
    assert.match(stats.errors[0].error, /Meta refused the detail request/);
  });
});
