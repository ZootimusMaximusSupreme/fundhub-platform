// How /api/campaigns/sync pulls the numbers, and what it says when a run died.
//
// THIS FILE NEEDS NO DATABASE AND DOES RUN. The four functions it checks are
// exported from api/campaigns/sync.mjs with no database in them, so the two
// breaks below can be pinned without Postgres. The end-to-end proof — the whole
// pull driven against a fake Meta, writing real rows — lives in
// campaigns-video-metrics.pg.test.mjs and needs DATABASE_URL, so it has never
// run on this machine.
//
// Lives under src/ deliberately: npm test's glob is "src/**" and "scripts/**",
// so a test placed under api/ silently never runs (CLAUDE.md §12).
//
// ── THE TWO BREAKS THIS PINS ────────────────────────────────────────────────
//
// 1. ONE CALL PER AD. The numbers used to be pulled with a separate request to
//    Meta for every single ad. Four hundred ads meant four hundred requests one
//    after another inside one page load, which does not finish before the
//    server gives up. Meta's insights endpoint takes a `level` setting, so
//    asking the AD ACCOUNT for `level=ad` brings back a row per ad in one
//    answer. The rows are matched back to each ad by the `ad_id` Meta puts on
//    every row.
//
// 2. SAYING "ok" AFTER THE RUN DIED. The answer used to be ok:true with counts
//    even when the writing had already failed and nothing had been saved. Chris
//    would then go looking for data that was never there. Now a run that lost
//    anything says so, and says what it did manage to save.

import { test, describe } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

import {
  insightsRequestUrl,
  fetchInsightPages,
  groupInsightsByAd,
  mergeInsightRows,
  insightPullErrors,
  insightWindow,
  buildSyncResponse,
  INSIGHT_WINDOW_DAYS,
  INSIGHT_CORE_FIELDS,
  INSIGHT_DETAIL_FIELDS,
  INSIGHT_CORE_VALUES
} from "../../api/campaigns/sync.mjs";

const connection = { external_ad_account_id: "act_1234567890" };

/* A fake Meta. Answers the shape callPlatform reads: ok + text()
   (src/adplatforms/_api.mjs:22-39). */
const replyWith = (pages) => {
  const seen = [];
  let i = 0;
  const fetchImpl = async (url) => {
    seen.push(String(url));
    const body = pages[Math.min(i, pages.length - 1)];
    i += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetchImpl, seen };
};

// ── 1. one call, at the account, keyed by ad ────────────────────────────────

describe("the insights request", () => {
  /* Two requests since 2026-10-21 (the money, then the rest — see
     campaigns-sync-false-zeros.test.mjs). Each one is still ONE request for
     the whole ad account at level=ad, so every rule below holds for both. */
  for (const part of ["core", "detail"]) describe(`the ${part} request`, () => {
  test("asks the ad account, not one ad", () => {
    const url = insightsRequestUrl(connection, { part, since: "2026-09-01", until: "2026-09-08" });
    assert.ok(url.includes("/act_1234567890/insights?"),
      `the request went to ${url} — it must be the ad account`);
  });

  test("asks for level=ad, which is what makes one call enough", () => {
    const url = decodeURIComponent(
      insightsRequestUrl(connection, { part, since: "2026-09-01", until: "2026-09-08" })
    );
    assert.ok(url.includes("level=ad"),
      "without level=ad Meta answers with one lump for the account and every ad looks identical");
  });

  test("asks for ad_id, or the rows cannot be tied back to an ad", () => {
    const url = decodeURIComponent(
      insightsRequestUrl(connection, { part, since: "2026-09-01", until: "2026-09-08" })
    );
    assert.ok(/(^|[?&,])ad_id(,|&|$)/.test(url) || url.includes("fields=ad_id"),
      "ad_id is not in the field list");
  });

  test("keeps the same date window and one row per day", () => {
    const url = decodeURIComponent(
      insightsRequestUrl(connection, { part, since: "2026-09-01", until: "2026-09-08" })
    );
    assert.ok(url.includes('"since":"2026-09-01"'), "the start of the window moved");
    assert.ok(url.includes('"until":"2026-09-08"'), "the end of the window moved");
    assert.ok(url.includes("time_increment=1"), "the day-by-day breakdown was lost");
  });
  });

  test("there is no combined request: a missing or unknown part is refused", () => {
    for (const part of [undefined, "", "all", "combined", "__proto__"]) {
      assert.throws(
        () => insightsRequestUrl(connection, { part, since: "2026-09-01", until: "2026-09-08" }),
        /part must be "core" or "detail"/,
        String(part)
      );
    }
  });

  /* THE 2026-10-21 BREAK. Over many days Meta answers spend, impressions and
     clicks with "0" when the same request also asks for `actions`,
     `inline_link_clicks`, `cost_per_action_type` or any *_actions field. */
  test("the money request is exactly the list Meta answered for real, and nothing that brings the zeros back", () => {
    assert.deepEqual([...INSIGHT_CORE_FIELDS],
      ["ad_id", "spend", "impressions", "clicks", "ctr", "purchase_roas", "date_start"]);
    const fields = new URL(insightsRequestUrl(connection, { part: "core", since: "2026-09-01", until: "2026-09-08" }))
      .searchParams.get("fields").split(",");
    assert.deepEqual(fields, [...INSIGHT_CORE_FIELDS]);
    for (const f of fields) {
      assert.equal(f === "actions" || f === "inline_link_clicks" || f === "cost_per_action_type" || f.endsWith("_actions"),
        false, `${f} on the money request brings Meta's false zeros back`);
    }
  });

  test("the other request carries no money field, and every video and results field", () => {
    const fields = new URL(insightsRequestUrl(connection, { part: "detail", since: "2026-09-01", until: "2026-09-08" }))
      .searchParams.get("fields").split(",");
    assert.deepEqual(fields, [...INSIGHT_DETAIL_FIELDS]);
    for (const f of INSIGHT_CORE_VALUES) assert.equal(fields.includes(f), false, `${f} is on the second request`);
    assert.deepEqual([...INSIGHT_CORE_VALUES], ["spend", "impressions", "clicks", "ctr", "purchase_roas"]);
    for (const f of ["ad_id", "date_start", "actions", "cost_per_action_type", "inline_link_clicks", "video_play_curve_actions"]) {
      assert.ok(fields.includes(f), `${f} is missing from the second request`);
    }
    assert.equal(new Set(fields).size, fields.length, "a field asked for twice");
  });

  /* WAS SEVEN DAYS, AND SEVEN DAYS LOST NUMBERS FOR GOOD — changed 2026-09-09.
     Nothing ran this pull on a schedule; a person pressing Sync was the whole
     mechanism. So eight days without a press meant day eight could never be
     asked for again, and the screens draw a missing day as zero spend. 28 days
     means a missed week is still recoverable, and it re-reads days Meta has
     since restated. Re-pulling a stored day overwrites it through
     ON CONFLICT (ad_id, date) — db/migrations/046_ad_platforms.sql:461. */
  test("the window reaches back 28 days, so a missed week can still be caught up", () => {
    const { since, until } = insightWindow(Date.UTC(2026, 8, 9));
    assert.equal(until, "2026-09-09");
    assert.equal(since, "2026-08-12");
    assert.equal(INSIGHT_WINDOW_DAYS, 28);
  });

  /* An account with hundreds of ads used to mean hundreds of requests. */
  test("one ad account is one request when Meta sends no next page", async () => {
    const { fetchImpl, seen } = replyWith([
      { data: [{ ad_id: "a1" }, { ad_id: "a2" }, { ad_id: "a3" }] }
    ]);
    const out = await fetchInsightPages({
      url: insightsRequestUrl(connection, { part: "core", since: "2026-09-01", until: "2026-09-08" }),
      token: "t",
      ctx: { fetch: fetchImpl }
    });
    assert.equal(seen.length, 1, `Meta was called ${seen.length} times for one account`);
    assert.equal(out.rows.length, 3);
    assert.equal(out.truncated, false);
  });
});

describe("paging through the numbers", () => {
  test("follows Meta's next link and keeps every page", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      const body = call === 1
        ? { data: [{ ad_id: "a1" }], paging: { next: "https://graph.facebook.com/page2" } }
        : { data: [{ ad_id: "a2" }] };
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const out = await fetchInsightPages({ url: "https://graph.facebook.com/page1", token: "t", ctx: { fetch: fetchImpl } });
    assert.equal(out.rows.length, 2, "a page of numbers was lost");
    assert.equal(out.pages, 2);
    assert.equal(out.truncated, false);
  });

  test("stops at the page cap and says it stopped, keeping what it read", async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          data: [{ ad_id: `a${n}` }],
          paging: { next: `https://graph.facebook.com/page${n + 1}` }
        })
      };
    };
    const out = await fetchInsightPages({
      url: "https://graph.facebook.com/page1", token: "t",
      ctx: { fetch: fetchImpl }, maxPages: 3
    });
    assert.equal(out.pages, 3, "the cap did not hold");
    assert.equal(out.rows.length, 3, "the rows already read were thrown away");
    assert.equal(out.truncated, true, "a short pull said it was complete");
  });

  /* A cursor that points back at itself would otherwise never end. */
  test("a page link that loops back on itself does not hang", async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({
        data: [{ ad_id: "a1" }],
        paging: { next: "https://graph.facebook.com/same" }
      })
    });
    const out = await fetchInsightPages({
      url: "https://graph.facebook.com/same", token: "t", ctx: { fetch: fetchImpl }
    });
    assert.equal(out.pages, 1);
    assert.equal(out.rows.length, 1);
  });
});

describe("matching the rows back to each ad", () => {
  test("every row lands on the ad Meta named", () => {
    const byAd = groupInsightsByAd([
      { ad_id: "a1", date_start: "2026-09-01" },
      { ad_id: "a1", date_start: "2026-09-02" },
      { ad_id: "a2", date_start: "2026-09-01" }
    ]);
    assert.equal(byAd.get("a1").length, 2);
    assert.equal(byAd.get("a2").length, 1);
    assert.equal(byAd.get("a3"), undefined, "an ad with no numbers was invented");
  });

  test("a row with no ad on it is dropped, never guessed onto another ad", () => {
    const byAd = groupInsightsByAd([{ date_start: "2026-09-01", spend: "9.99" }, { ad_id: "a1" }]);
    assert.equal(byAd.size, 1, "an unlabelled row was attached to something");
    assert.equal(byAd.get("a1").length, 1);
  });

  test("a number for an ad id survives being a number", () => {
    const byAd = groupInsightsByAd([{ ad_id: 123456 }]);
    assert.equal(byAd.get("123456").length, 1, "a numeric ad id did not match");
  });
});

describe("joining the money answer and the rest (mergeInsightRows)", () => {
  const core = (rows, complete = true) => ({ rows, complete });
  const detail = core;
  const C = (ad, day, spend) => ({ ad_id: ad, date_start: day, spend, impressions: "10", clicks: "1", ctr: "10" });
  const D = (ad, day, extra = {}) => ({ ad_id: ad, date_start: day, actions: [{ action_type: "link_click", value: "1" }], ...extra });

  test("both answers: one row, money from the money answer, the rest from the other", () => {
    const out = mergeInsightRows({
      core: core([C("a1", "2026-10-01", "2.35")]),
      detail: detail([D("a1", "2026-10-01", { spend: "0", impressions: "0", clicks: "0", ctr: "0", video_p25_watched_actions: [{ action_type: "video_view", value: "2" }] })])
    });
    assert.equal(out.rows.length, 1);
    assert.equal(out.held, 0);
    const r = out.rows[0];
    assert.equal(r.spend, "2.35", "a money field came from the second answer");
    assert.equal(r.impressions, "10");
    assert.equal(r.clicks, "1");
    assert.equal(r.ctr, "10");
    assert.deepEqual(r.actions, [{ action_type: "link_click", value: "1" }]);
    assert.deepEqual(r.video_p25_watched_actions, [{ action_type: "video_view", value: "2" }]);
  });

  test("a money field on the second answer never survives, even with no money row to join", () => {
    const out = mergeInsightRows({
      core: core([]),
      detail: detail([D("a1", "2026-10-06", { spend: "0", impressions: "0", purchase_roas: [{ value: "9" }] })])
    });
    assert.equal(out.rows.length, 1);
    for (const f of INSIGHT_CORE_VALUES) assert.equal(f in out.rows[0], false, `${f} came from the second answer`);
  });

  test("money row only, other answer complete: kept as it is (video and results stay unknown)", () => {
    const out = mergeInsightRows({ core: core([C("a1", "2026-10-01", "5")]), detail: detail([]) });
    assert.deepEqual(out.rows, [C("a1", "2026-10-01", "5")]);
    assert.equal(out.held, 0);
  });

  test("money row only, other answer cut short: held, not written", () => {
    const out = mergeInsightRows({ core: core([C("a1", "2026-10-01", "5")]), detail: detail([], false) });
    assert.deepEqual(out.rows, []);
    assert.equal(out.held, 1);
    assert.deepEqual(out.heldBy, { core: 0, detail: 1 });
  });

  test("other row only, money answer complete: kept with no money fields (no delivery that day)", () => {
    const out = mergeInsightRows({ core: core([]), detail: detail([D("a1", "2026-10-06")]) });
    assert.deepEqual(out.rows, [D("a1", "2026-10-06")]);
    assert.equal(out.held, 0);
  });

  test("other row only, money answer cut short: held — never a guessed 0", () => {
    const out = mergeInsightRows({ core: core([], false), detail: detail([D("a1", "2026-10-06")]) });
    assert.deepEqual(out.rows, []);
    assert.equal(out.held, 1);
    assert.deepEqual(out.heldBy, { core: 1, detail: 0 });
  });

  test("completeness must be said: an answer not marked complete counts as cut short", () => {
    const out = mergeInsightRows({ core: { rows: [C("a1", "2026-10-01", "5")] }, detail: { rows: [D("a2", "2026-10-01")] } });
    assert.deepEqual(out.rows, []);
    assert.equal(out.held, 2);
  });

  test("rows match on ad AND day; a numeric ad id matches its text twin; a row with no ad or no day is dropped", () => {
    const out = mergeInsightRows({
      core: core([C(111, "2026-10-01", "1"), C("111", "2026-10-02", "2"), { spend: "9", date_start: "2026-10-01" }, { ad_id: "z", spend: "9" }]),
      detail: detail([D("111", "2026-10-01"), D("111", "2026-10-03")])
    });
    const byKey = Object.fromEntries(out.rows.map((r) => [`${r.ad_id}|${r.date_start}`, r]));
    assert.deepEqual(Object.keys(byKey).sort(), ["111|2026-10-01", "111|2026-10-02", "111|2026-10-03"]);
    assert.equal(byKey["111|2026-10-01"].spend, "1");
    assert.ok(byKey["111|2026-10-01"].actions, "the two halves of 10-01 were not joined");
    assert.equal("spend" in byKey["111|2026-10-03"], false);
  });

  test("insightPullErrors: one line per cut answer, one for held days, none for a clean pull", () => {
    assert.deepEqual(insightPullErrors({ held: 0, core: { pages: 2, truncated: false }, detail: { pages: 2, truncated: false } }), []);
    const lines = insightPullErrors({ held: 3, core: { pages: 100, truncated: true }, detail: { pages: 100, truncated: true } });
    assert.equal(lines.length, 3);
    assert.match(lines[0], /stopped after 100 pages of spend numbers/);
    assert.match(lines[1], /stopped after 100 pages of video and results numbers/);
    assert.match(lines[2], /^3 days of numbers were not saved/);
    assert.match(insightPullErrors({ held: 1, core: {}, detail: {} })[0], /^1 day of numbers was not saved/);
  });
});

// ── 2. the answer never claims what was not saved ───────────────────────────

const stats = (over = {}) => ({
  connections: 1, campaigns: 0, ad_sets: 0, ads: 0, insights: 0, errors: [], ...over
});

describe("what the run says when it is over", () => {
  test("everything saved — ok, with the counts", () => {
    const { status, body } = buildSyncResponse({
      stats: stats({ campaigns: 2, ad_sets: 3, ads: 9, insights: 63 }),
      missingApp: true
    });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.partial, false);
    assert.match(body.message, /^Pulled in 2 campaigns, 3 ad sets, 9 ads and 63 days of numbers\./);
  });

  /* THE ONE THAT MATTERS. This used to answer ok:true with counts. */
  test("something failed — the answer is not ok, and says what did save", () => {
    const { status, body } = buildSyncResponse({
      stats: stats({
        campaigns: 1, ad_sets: 1, ads: 4, insights: 28,
        errors: [{ campaign: "23849", error: "column does not exist" }]
      }),
      missingApp: false
    });
    assert.equal(body.ok, false, "a run that lost a campaign still said ok");
    assert.equal(body.partial, true);
    assert.equal(status, 200, "a run that saved most of its work is not a server failure");
    assert.match(body.message, /Saved 1 campaign, 1 ad set, 4 ads and 28 days of numbers, then stopped\./);
    assert.match(body.message, /1 part did not save/);
    assert.match(body.message, /campaign 23849 — column does not exist/);
    assert.equal(body.campaigns, 1, "the counts stopped matching what was saved");
  });

  test("nothing saved at all — not ok, and it does not pretend otherwise", () => {
    const { status, body } = buildSyncResponse({
      stats: stats({ errors: [{ connection: "c-1", error: "platform 500: try later" }] }),
      missingApp: false
    });
    assert.equal(body.ok, false);
    assert.equal(body.partial, false);
    assert.equal(status, 502);
    assert.match(body.message, /^Nothing was saved\./);
    assert.match(body.message, /ad account link c-1 — platform 500: try later/);
  });

  test("the counts in the answer are the counts that were passed in", () => {
    const { body } = buildSyncResponse({
      stats: stats({ campaigns: 5, ad_sets: 11, ads: 40, insights: 280 }),
      missingApp: false
    });
    assert.equal(body.campaigns, 5);
    assert.equal(body.ad_sets, 11);
    assert.equal(body.ads, 40);
    assert.equal(body.insights, 280);
    assert.deepEqual(body.errors, []);
  });
});

// ── 3. the number the SCREEN prints is the number that was saved ────────────
//
// buildSyncResponse counts only what committed, but that is worth nothing if
// the page throws the sentence away and writes its own. It used to: the Sync
// Meta button built "Pulled in N campaigns · N ad sets · N ads" out of three of
// the four counts and dropped the fourth — days of numbers, the only one that
// says whether any SPEND was saved. A run that saved the shape of the account
// and none of the money read exactly like a run that saved everything.

const screen = () =>
  readFileSync(new URL("../../public/app/campaign-manager.html", import.meta.url), "utf8");

const syncBlock = () => {
  const src = screen();
  const from = src.indexOf("getElementById('syncMetaBtn')");
  assert.ok(from > 0, "the Sync Meta button handler is gone from campaign-manager.html");
  const to = src.indexOf("getElementById('metaAgencyBtn')", from);
  assert.ok(to > from, "the Sync Meta handler no longer ends where this test expects");
  return src.slice(from, to);
};

describe("what the Sync Meta button prints", () => {
  test("it prints the server's own sentence, which counts only what saved", () => {
    assert.match(
      syncBlock(),
      /msg\.textContent = \(res\.message \|\|/,
      "the Sync Meta button rebuilds its own sentence instead of printing the server's"
    );
  });

  test("even the fallback sentence names the days of numbers", () => {
    assert.match(
      syncBlock(),
      /res\.insights[\s\S]{0,60}days of numbers/,
      "the fallback sentence still drops the one count that says whether spend was saved"
    );
  });
});
