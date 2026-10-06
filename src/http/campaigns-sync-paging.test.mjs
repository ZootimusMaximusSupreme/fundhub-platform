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

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  fetchAllPages,
  fetchInsightPages,
  metaListUrl,
  listTruncationMessage,
  buildSyncResponse,
  LIST_PAGE_SIZE,
  LIST_MAX_PAGES
} from "../../api/campaigns/sync.mjs";

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
