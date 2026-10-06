// EVERY LIST META ANSWERS IS FOLLOWED TO ITS END, AND A LIST THAT WAS CUT
// SHORT SAYS SO.
//
// THE BREAK THIS PINS. Meta never answers a list in one go. It answers a page
// of rows plus a link to the next page. The sync asked for a page of campaigns,
// a page of ad sets and a page of ads and never once followed that link. An ad
// account with more than a hundred campaigns, or an ad set with more than a
// hundred ads, lost everything past the first hundred — and nothing anywhere
// said so. The screen just showed fewer ads than exist, forever.
//
// The second half matters as much as the first: a walk that stops at the cap
// must put a line in the answer. Swapping one silent shortfall for another
// silent shortfall would be no fix at all.
//
// THIS FILE NEEDS NO DATABASE AND DOES RUN. It drives the exported pieces of
// api/campaigns/sync.mjs against a fake Meta. The whole-handler proof, with
// real rows written, lives in the .pg.test.mjs files, and there is no Postgres
// on this machine, so those have never run.
//
// Lives under src/ deliberately: npm test's glob is "src/**" and "scripts/**",
// so a test placed under api/ silently never runs (CLAUDE.md §12).

import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

import {
  fetchAllPages,
  fetchInsightPages,
  metaListUrl,
  listTruncationMessage,
  buildSyncResponse,
  syncPartnerConnections,
  newAdNumberTally,
  AD_LIST_FIELDS,
  LIST_PAGE_SIZE,
  LIST_MAX_PAGES
} from "../../api/campaigns/sync.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";
import { adAccountDay } from "../lib/ad-account-day.mjs";

/* A fake Meta. Answers the shape callPlatform reads — ok plus text()
   (src/adplatforms/_api.mjs:22-39) — handing out `pages` in order and
   recording every URL it was asked for. */
function fakeMeta(pages) {
  const seen = [];
  let i = 0;
  const fetchImpl = async (url) => {
    seen.push(String(url));
    const body = pages[Math.min(i, pages.length - 1)];
    i += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetchImpl, seen };
}

/* n pages of one row each, every page pointing at the next. Never runs out, so
   only the cap can stop it. */
function endlessPages() {
  let n = 0;
  return async () => {
    n += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ id: `x${n}` }],
        paging: { next: `https://graph.facebook.com/v26.0/page${n + 1}` }
      })
    };
  };
}

// ── the first page is asked for the way it always was ───────────────────────

describe("the first page of a list", () => {
  test("keeps the fields the caller asked for", () => {
    const url = decodeURIComponent(metaListUrl("act_1/campaigns", "id,name,status"));
    assert.ok(url.includes("/act_1/campaigns?"), `the request went to ${url}`);
    assert.ok(url.includes("fields=id,name,status"), "the field list changed");
  });

  test("asks for a full page, not a handful", () => {
    const url = metaListUrl("act_1/campaigns", "id");
    assert.ok(url.includes(`limit=${LIST_PAGE_SIZE}`), "the page size changed");
    assert.equal(LIST_PAGE_SIZE, 100);
  });
});

// ── the link to the next page is followed ───────────────────────────────────

describe("following Meta's next-page link", () => {
  test("a second page of campaigns is read, not dropped", async () => {
    const { fetchImpl, seen } = fakeMeta([
      {
        data: [{ id: "c1" }, { id: "c2" }],
        paging: { next: "https://graph.facebook.com/v26.0/act_1/campaigns?after=AAA" }
      },
      { data: [{ id: "c3" }] }
    ]);

    const out = await fetchAllPages({
      url: metaListUrl("act_1/campaigns", "id,name"),
      token: "t",
      ctx: { fetch: fetchImpl }
    });

    assert.equal(seen.length, 2, `Meta was asked ${seen.length} times — the next page was never fetched`);
    assert.ok(seen[1].includes("after=AAA"), "the second call did not use Meta's own next link");
    assert.deepEqual(out.rows.map((r) => r.id), ["c1", "c2", "c3"],
      "a campaign past the first page was lost");
    assert.equal(out.truncated, false, "a complete walk claimed it was cut short");
  });

  test("a second page of ads under one ad set is read too", async () => {
    const { fetchImpl } = fakeMeta([
      { data: [{ id: "ad1" }], paging: { next: "https://graph.facebook.com/v26.0/set1/ads?after=BBB" } },
      { data: [{ id: "ad2" }], paging: { next: "https://graph.facebook.com/v26.0/set1/ads?after=CCC" } },
      { data: [{ id: "ad3" }] }
    ]);

    const out = await fetchAllPages({
      url: metaListUrl("set1/ads", "id,name,status,adset_id"),
      token: "t",
      ctx: { fetch: fetchImpl }
    });

    assert.equal(out.pages, 3);
    assert.deepEqual(out.rows.map((r) => r.id), ["ad1", "ad2", "ad3"],
      "an ad past the first page was lost — this is the screen showing fewer ads than exist");
    assert.equal(out.truncated, false);
  });

  test("one page with no next link is one call", async () => {
    const { fetchImpl, seen } = fakeMeta([{ data: [{ id: "c1" }] }]);
    const out = await fetchAllPages({
      url: metaListUrl("act_1/campaigns", "id"),
      token: "t",
      ctx: { fetch: fetchImpl }
    });
    assert.equal(seen.length, 1, "Meta was called again for a page it never offered");
    assert.equal(out.pages, 1);
    assert.equal(out.truncated, false);
  });

  /* The name the walker had when it only walked the numbers. The journey pages
     and campaigns-sync-insights.test.mjs still call it that. */
  test("the old name is the same walker", () => {
    assert.equal(fetchInsightPages, fetchAllPages);
  });
});

// ── the cap holds, and hitting it is reported ───────────────────────────────

describe("the page cap", () => {
  test("is generous enough for a real ad account", () => {
    assert.equal(LIST_MAX_PAGES, 50);
    assert.equal(LIST_MAX_PAGES * LIST_PAGE_SIZE, 5000,
      "50 pages of 100 is Meta's own published per-account ceiling for campaigns, ad sets and ads");
  });

  test("a list that never ends is stopped", async () => {
    const out = await fetchAllPages({
      url: metaListUrl("act_1/campaigns", "id"),
      token: "t",
      ctx: { fetch: endlessPages() },
      maxPages: 4
    });
    assert.equal(out.pages, 4, "the cap did not hold — one runaway account can spin forever");
  });

  test("what was already read is kept, never thrown away", async () => {
    const out = await fetchAllPages({
      url: metaListUrl("act_1/campaigns", "id"),
      token: "t",
      ctx: { fetch: endlessPages() },
      maxPages: 4
    });
    assert.equal(out.rows.length, 4, "the rows already read were dropped on the floor");
  });

  test("hitting the cap is said out loud, not swallowed", async () => {
    const out = await fetchAllPages({
      url: metaListUrl("act_1/campaigns", "id"),
      token: "t",
      ctx: { fetch: endlessPages() },
      maxPages: 4
    });
    assert.equal(out.truncated, true,
      "a walk that stopped early reported itself as complete — the exact failure this fix is about");
  });

  test("a next link that points back at itself does not hang", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ id: "c1" }],
        paging: { next: "https://graph.facebook.com/v26.0/same" }
      })
    });
    const out = await fetchAllPages({
      url: "https://graph.facebook.com/v26.0/same",
      token: "t",
      ctx: { fetch: fetchImpl }
    });
    assert.equal(out.pages, 1);
    assert.equal(out.rows.length, 1);
  });
});

// ── the shortfall reaches the screen ────────────────────────────────────────

describe("what the screen is told when a list was cut short", () => {
  test("the sentence names the count and says rows are missing", () => {
    const line = listTruncationMessage({ pages: 50, listed: "ads" });
    assert.match(line, /stopped after 50 pages of ads/);
    assert.match(line, /some ads are missing/);
  });

  test("the numbers pull can name days rather than rows", () => {
    const line = listTruncationMessage({ pages: 100, listed: "numbers", missing: "days" });
    assert.match(line, /stopped after 100 pages of numbers/);
    assert.match(line, /some days are missing/);
  });

  /* A truncated list is a failure of the run, so the answer must not say ok.
     ok:true with a short list is the silent loss, wearing a green tick. */
  test("a cut-short campaign list makes the run say it is not complete", () => {
    const { status, body } = buildSyncResponse({
      stats: {
        connections: 1, campaigns: 5000, ad_sets: 10, ads: 40, insights: 280,
        errors: [{
          connection: "c-1",
          error: listTruncationMessage({ pages: 50, listed: "campaigns" })
        }]
      },
      missingApp: false
    });
    assert.equal(body.ok, false, "a run that lost campaigns still said ok");
    assert.equal(body.partial, true, "the run did save things, so it is partial, not a total failure");
    assert.equal(status, 200);
    assert.match(body.message, /stopped after 50 pages of campaigns/);
    assert.match(body.message, /some campaigns are missing/);
    assert.equal(body.errors.length, 1, "the shortfall did not reach the answer the screen reads");
  });

  test("a cut-short ad list names the campaign it happened under", () => {
    const { body } = buildSyncResponse({
      stats: {
        connections: 1, campaigns: 1, ad_sets: 1, ads: 5000, insights: 0,
        errors: [{
          campaign: "23849",
          error: `ad set 987 — ${listTruncationMessage({ pages: 50, listed: "ads" })}`
        }]
      },
      missingApp: false
    });
    assert.equal(body.ok, false);
    assert.match(body.message, /campaign 23849 — ad set 987 — stopped after 50 pages of ads/);
  });
});

// ── U27: the ad list asks for url_tags, and the sync stores the ad number ───
//
// Spec docs/specs/marketing-machine-2026-10-04.md §10.5 "Sync mapping". The ad
// list now asks Meta for creative{url_tags}; each ad saved by the sync gets the
// number its url_tags or its name carries (mapAdNumber), never over a 'manual'
// number, and a failed number write is counted, never thrown, and never costs
// the campaign. The whole pass runs here against a fake transaction and a fake
// Meta. The same rules against real Postgres: src/http/ad-number-sync.pg.test.mjs.

describe("U27: the ad list asks for url_tags, and each ad gets its number", () => {
  const PARTNER = "11111111-1111-1111-1111-111111111127";
  const ORG = "22222222-2222-2222-2222-222222222227";
  const CONN = "33333333-3333-3333-3333-333333333327";
  const SET = "120270000000027001";

  const saved = {};
  before(() => {
    for (const k of ["AD_TOKEN_ENC_KEY", "META_API_VERSION"]) saved[k] = process.env[k];
    // A throwaway key for this process only. Never a real key.
    process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
    delete process.env.META_API_VERSION;
  });
  after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const tags = (content) =>
    `utm_source=fb&utm_medium=paid&utm_campaign=funding600&utm_content=${content}`;
  const LIVE_TAGS = "utm_source=fb&utm_medium=paid&utm_campaign=sorting" +
    "&utm_content={{ad.name}}&utm_term={{adset.id}}";

  /* The ads Meta hands back, in this order. `pre` is the row already in our
     table before this sync (null = a new ad). */
  const ADS = [
    { id: "a91", name: "Fresh angle", creative: { id: "cr91", url_tags: tags(91) }, pre: null },
    { id: "a92", name: "SLO Ad 92 — x", creative: { id: "cr92" }, pre: null },
    { id: "live1", name: "oVid: SLO1", creative: { id: "crL1", url_tags: LIVE_TAGS }, pre: null },
    { id: "live2", name: "oVid: SLO2", pre: null },
    { id: "man", name: "Typed by a person", creative: { id: "crM", url_tags: tags(94) },
      pre: { fundhub_ad_number: "93", fundhub_ad_number_source: "manual" } },
    { id: "ldr", name: "Loaded by the machine", creative: { id: "crLd", url_tags: tags(95) },
      pre: { fundhub_ad_number: "95", fundhub_ad_number_source: "loader" } }
  ];

  function connectionRow() {
    return {
      id: CONN, org_id: ORG, partner_id: PARTNER, platform: "meta",
      connection_state: "active", external_ad_account_id: "act_2700000000000027",
      external_business_id: null,
      encrypted_access_token: encryptToken("fake-meta-token-for-tests", { partnerId: PARTNER }),
      created_at: "2026-08-01T00:00:00Z"
    };
  }

  /* The fake transaction: every statement is recorded and answered by what it
     reads. `failNumberFor` makes the number UPDATE for those Meta ad ids throw
     the way Postgres does (a CHECK refusal). `failInsights` makes the day write
     throw, which rolls the whole campaign back. */
  function fakeDb({ failNumberFor = [], failInsights = false } = {}) {
    const statements = [];
    const numberWrites = [];
    const rows = new Map();          // our ads row id → row
    const byMeta = new Map();        // Meta ad id → our ads row id
    for (const a of ADS) {
      if (!a.pre) continue;
      const id = `row-${a.id}`;
      rows.set(id, { id, external_id: a.id, name: a.name, ...a.pre });
      byMeta.set(a.id, id);
    }
    const tx = {
      async query(sql, params = []) {
        const s = String(sql);
        statements.push({ sql: s, params });
        if (/FROM ad_platform_connections/.test(s) && /^\s*SELECT/i.test(s)) {
          return { rows: [connectionRow()], rowCount: 1 };
        }
        if (/FROM pg_attribute/.test(s)) return { rows: [{ n: 4 }], rowCount: 1 };
        // Days older than the window are stored, so the 28-day window is used.
        if (/min\(m\.date\)/.test(s)) return { rows: [{ d: "2026-01-01" }], rowCount: 1 };
        if (/INSERT INTO campaigns/.test(s)) return { rows: [{ id: "camp-1" }], rowCount: 1 };
        if (/INSERT INTO ad_sets/.test(s)) return { rows: [{ id: "set-1" }], rowCount: 1 };
        if (/SELECT id FROM ads WHERE connection_id/.test(s)) {
          const id = byMeta.get(String(params[1]));
          return id ? { rows: [{ id }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO ads\s*\(/.test(s)) {
          const id = `row-${params[5]}`;
          const row = { id, external_id: params[5], name: params[6],
            fundhub_ad_number: null, fundhub_ad_number_source: null };
          rows.set(id, row);
          byMeta.set(String(params[5]), id);
          return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/UPDATE ads SET name = \$2/.test(s)) {
          const row = rows.get(params[0]);
          row.name = params[1];
          return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/SET fundhub_ad_number = \$2/.test(s)) {
          const row = rows.get(params[0]);
          if (failNumberFor.includes(row.external_id)) {
            const e = new Error('new row for relation "ads" violates check constraint');
            e.code = "23514";
            throw e;
          }
          numberWrites.push({ meta: row.external_id, number: params[1], source: params[2] });
          row.fundhub_ad_number = params[1];
          row.fundhub_ad_number_source = params[2];
          return { rows: [{ ...row }], rowCount: 1 };
        }
        if (/INSERT INTO ad_metrics_daily/.test(s)) {
          if (failInsights) throw new Error("the day write failed");
          return { rows: [], rowCount: 1 };
        }
        if (/fundhub_reresolve_ad_numbers/.test(s)) return { rows: [{ filled: 2 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }
    };
    const scope = async (_who, fn) => fn(tx);
    return { scope, statements, numberWrites, rows };
  }

  /* The fake Meta: one campaign, one ad set, the ads above, one day of numbers
     for the first ad. Records every URL. */
  function fakeMeta() {
    const urls = [];
    const fetch = async (url) => {
      const u = String(url);
      urls.push(u);
      let body = { data: [] };
      if (u.includes("/insights?")) {
        body = { data: [{ ad_id: "a91", date_start: adAccountDay(new Date()),
          spend: "10.00", impressions: "100", clicks: "5" }] };
      } else if (u.includes("/campaigns?")) {
        body = { data: [{ id: "c1", name: "Campaign", status: "PAUSED", objective: "OUTCOME_SALES" }] };
      } else if (u.includes("/adsets?")) {
        body = { data: [{ id: SET, name: "Ad set", status: "PAUSED", campaign_id: "c1" }] };
      } else if (u.includes("/ads?")) {
        body = { data: ADS.map(({ pre: _pre, ...a }) => ({ ...a, status: "PAUSED", adset_id: SET })) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    return { fetch, urls };
  }

  const run = (db, meta = fakeMeta()) =>
    syncPartnerConnections({ partnerId: PARTNER, deps: { fetch: meta.fetch }, scope: db.scope });

  test("the ad list's fields are the old four plus creative{url_tags}", () => {
    assert.deepEqual(AD_LIST_FIELDS.split(","),
      ["id", "name", "status", "adset_id", "creative{url_tags}"]);
  });

  test("the ads request Meta gets asks for creative{url_tags}, on v26.0", async () => {
    const meta = fakeMeta();
    await run(fakeDb(), meta);
    const adsCalls = meta.urls.filter((u) => u.includes("/ads?"));
    assert.equal(adsCalls.length, 1);
    const url = new URL(adsCalls[0]);
    assert.equal(url.pathname, `/v26.0/${SET}/ads`);
    assert.equal(url.searchParams.get("fields"), "id,name,status,adset_id,creative{url_tags}");
    assert.equal(url.searchParams.get("limit"), String(LIST_PAGE_SIZE));
  });

  test("utm_content 91 → 91 (utm); 'SLO Ad 92 — x' → 92 (name); the live ads → nothing", async () => {
    const db = fakeDb();
    const stats = await run(db);
    assert.deepEqual(stats.errors, [], JSON.stringify(stats.errors));
    assert.deepEqual(db.numberWrites, [
      { meta: "a91", number: "91", source: "utm" },
      { meta: "a92", number: "92", source: "name" }
    ]);
    for (const live of ["live1", "live2"]) {
      const row = db.rows.get(`row-${live}`);
      assert.equal(row.fundhub_ad_number, null, `${live} got a number from {{ad.name}} or "oVid"`);
      assert.equal(row.fundhub_ad_number_source, null);
    }
  });

  test("a 'manual' number is never overwritten, and the same number keeps its source", async () => {
    const db = fakeDb();
    const stats = await run(db);
    const man = db.rows.get("row-man");
    assert.equal(man.fundhub_ad_number, "93", "the sync overwrote a number a person typed");
    assert.equal(man.fundhub_ad_number_source, "manual");
    const ldr = db.rows.get("row-ldr");
    assert.equal(ldr.fundhub_ad_number, "95");
    assert.equal(ldr.fundhub_ad_number_source, "loader", "the same number was re-stamped as utm");
    assert.ok(!db.numberWrites.some((w) => w.meta === "man" || w.meta === "ldr"));
    assert.deepEqual(stats.ad_number_map,
      { set: 2, kept_manual: 1, same: 1, none: 2, failed: 0, failures: [] });
  });

  test("a failed number write is counted, the ad is still saved, the campaign still commits", async () => {
    const db = fakeDb({ failNumberFor: ["a91"] });
    const stats = await run(db);
    assert.deepEqual(stats.errors, [], "a number write failure became a sync failure");
    assert.equal(stats.campaigns, 1, "the campaign was rolled back over one ad number");
    assert.equal(stats.ads, ADS.length);
    assert.equal(stats.insights, 1, "the failed ad's day of numbers was lost");
    assert.equal(stats.ad_number_map.failed, 1);
    assert.equal(stats.ad_number_map.failures[0].ad, "a91");
    assert.match(stats.ad_number_map.failures[0].error, /check constraint/);
    // The ad after it still got its number: the transaction was not left aborted.
    assert.deepEqual(db.numberWrites, [{ meta: "a92", number: "92", source: "name" }]);
    // And the failure rolled back to its own savepoint, not the campaign's start.
    const sqls = db.statements.map((x) => x.sql.trim());
    const fail = sqls.findIndex((x) => /SET fundhub_ad_number = \$2/.test(x));
    assert.equal(sqls[fail - 1], "SAVEPOINT fundhub_ad_number_map");
    assert.equal(sqls[fail + 1], "ROLLBACK TO SAVEPOINT fundhub_ad_number_map");
  });

  test("numbers are counted only after the campaign commits", async () => {
    const db = fakeDb({ failInsights: true });
    const stats = await run(db);
    assert.equal(stats.campaigns, 0);
    assert.equal(stats.errors.length, 1, "the campaign's own failure is still named");
    assert.deepEqual(stats.ad_number_map, newAdNumberTally(),
      "numbers from a campaign that rolled back were counted as written");
  });

  test("reresolveAdNumbers still runs after the sync, once, after every number write", async () => {
    const db = fakeDb();
    const stats = await run(db);
    const sqls = db.statements.map((x) => x.sql);
    const reresolve = sqls.flatMap((s, i) => (/fundhub_reresolve_ad_numbers/.test(s) ? [i] : []));
    assert.equal(reresolve.length, 1, `visitor numbers were re-found ${reresolve.length} times`);
    const lastNumberWrite = sqls.flatMap((s, i) => (/SET fundhub_ad_number = \$2/.test(s) ? [i] : [])).at(-1);
    assert.ok(reresolve[0] > lastNumberWrite, "visitor numbers were re-found before the ads had theirs");
    assert.deepEqual(stats.ad_numbers, { filled: 2 });
  });
});
