// THE HOURLY META PULL READS 3 DAYS AND NEVER THE WHOLE HISTORY.
//
// Marketing machine M0 step 5 (docs/specs/marketing-machine-2026-10-04.md):
// "Run hourly for the last 3 days, plus a nightly 28-day pass." The hourly pass
// runs inside the 26-second /api/inngest limit, so it must never take the
// first-pull path that asks Meta for up to 37 months (date_preset=maximum,
// needsFullHistory in api/campaigns/sync.mjs). The nightly pass and the Sync
// button keep that path, unchanged.
//
// NO DATABASE AND NO META. syncPartnerConnections() takes its scope as an
// argument, so the whole pass is driven here against a fake transaction and a
// fake Meta, with a stored history that is EMPTY — the exact case where the
// nightly pass reaches for the whole history. The hourly pass must not.
//
// Lives under src/ because npm test's glob is "src/**" and "scripts/**"
// (CLAUDE.md §12).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  syncPartnerConnections,
  syncPass,
  hourlyWindow,
  insightWindow,
  SYNC_PASSES,
  HOURLY_WINDOW_DAYS,
  INSIGHT_WINDOW_DAYS
} from "../../api/campaigns/sync.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";
import { adAccountDay } from "../lib/ad-account-day.mjs";

const PARTNER = "11111111-1111-1111-1111-111111111111";
const ORG = "22222222-2222-2222-2222-222222222222";
const CONN = "33333333-3333-3333-3333-333333333333";

/* A throwaway key for this process only, so the fake connection can hold an
   encrypted fake token the way a real row does. Never a real key. */
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

function connection() {
  return {
    id: CONN,
    org_id: ORG,
    partner_id: PARTNER,
    platform: "meta",
    connection_state: "active",
    external_ad_account_id: "act_982103620742368",
    external_business_id: null,
    encrypted_access_token: encryptToken("fake-meta-token-for-tests", { partnerId: PARTNER }),
    created_at: "2026-08-01T00:00:00Z"
  };
}

/* The fake database: every statement is recorded, and answered by what it
   reads. Nothing is stored for this connection (min(date) is NULL), which is
   the case that sends the NIGHTLY pass to the whole history. */
function fakeDb() {
  const statements = [];
  const metricWrites = [];
  const tx = {
    async query(sql, params = []) {
      const s = String(sql);
      statements.push(s);
      if (/FROM ad_platform_connections/.test(s) && /^\s*SELECT/i.test(s)) {
        return { rows: [connection()], rowCount: 1 };
      }
      if (/FROM pg_attribute/.test(s)) return { rows: [{ n: 4 }], rowCount: 1 };
      if (/min\(m\.date\)/.test(s)) return { rows: [{ d: null }], rowCount: 1 };
      if (/INSERT INTO campaigns/.test(s)) return { rows: [{ id: "camp-1" }], rowCount: 1 };
      if (/INSERT INTO ad_sets/.test(s)) return { rows: [{ id: "set-1" }], rowCount: 1 };
      if (/INSERT INTO ads /.test(s) || /INSERT INTO ads\s*\(/.test(s)) return { rows: [{ id: "ad-row-1" }], rowCount: 1 };
      if (/INSERT INTO ad_metrics_daily/.test(s)) {
        metricWrites.push({ sql: s, params });
        return { rows: [], rowCount: 1 };
      }
      if (/fundhub_reresolve_ad_numbers/.test(s)) return { rows: [{ filled: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
  };
  const scope = async (_who, fn) => fn(tx);
  return { scope, statements, metricWrites };
}

/* The fake Meta: one campaign, one ad set, one ad, one day of numbers. The day
   carries BOTH inline_link_clicks (4) and an actions link_click line (5), so
   the saved row shows which one won. */
function fakeMeta() {
  const urls = [];
  const fetch = async (url) => {
    const u = String(url);
    urls.push(u);
    let body = { data: [] };
    if (u.includes("/insights?")) {
      body = {
        data: [{
          ad_id: "ad1",
          date_start: adAccountDay(new Date()),
          spend: "10.00",
          impressions: "100",
          clicks: "5",
          inline_link_clicks: "4",
          actions: [{ action_type: "link_click", value: "5" }]
        }]
      };
    } else if (u.includes("/campaigns?")) {
      body = { data: [{ id: "c1", name: "Campaign", status: "ACTIVE", objective: "OUTCOME_SALES" }] };
    } else if (u.includes("/adsets?")) {
      body = { data: [{ id: "s1", name: "Ad set", status: "ACTIVE", campaign_id: "c1" }] };
    } else if (u.includes("/ads?")) {
      body = { data: [{ id: "ad1", name: "Ad", status: "ACTIVE", adset_id: "s1" }] };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return { fetch, urls };
}

const insightUrls = (urls) => urls.filter((u) => u.includes("/insights?")).map((u) => new URL(u));
const dayCount = (since, until) =>
  Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 864e5) + 1;

// ── the hourly pass ─────────────────────────────────────────────────────────

describe("the hourly pass asks Meta for 3 days and never the whole history", () => {
  test("with nothing stored, it still asks for exactly 3 Arizona days, once", async () => {
    const db = fakeDb();
    const meta = fakeMeta();
    const before = adAccountDay(new Date());
    const stats = await syncPartnerConnections({
      partnerId: PARTNER, deps: { fetch: meta.fetch }, pass: "hourly", scope: db.scope
    });
    const after = adAccountDay(new Date());

    const asked = insightUrls(meta.urls);
    assert.equal(asked.length, 1, `the numbers were asked for ${asked.length} times`);
    const q = asked[0].searchParams;
    assert.equal(q.get("date_preset"), null, "the hourly pass asked Meta for the whole history");
    const range = JSON.parse(q.get("time_range"));
    assert.equal(dayCount(range.since, range.until), 3, `asked for ${range.since}..${range.until}`);
    assert.ok([before, after].includes(range.until), "the last day is not today in Arizona");
    assert.equal(q.get("time_increment"), "1", "one row per ad per day");
    assert.equal(q.get("level"), "ad");

    assert.equal(stats.pass, "hourly");
    assert.deepEqual(stats.full_history, [], "the hourly pass took the whole-history path");
    assert.equal(stats.errors.length, 0, JSON.stringify(stats.errors));
  });

  test("it never even asks the database how far back the stored days go", async () => {
    const db = fakeDb();
    await syncPartnerConnections({
      partnerId: PARTNER, deps: { fetch: fakeMeta().fetch }, pass: "hourly", scope: db.scope
    });
    assert.equal(db.statements.filter((s) => /min\(m\.date\)/.test(s)).length, 0,
      "earliestStoredDay ran — the needsFullHistory question was asked on the hourly pass");
  });

  test("every Meta call goes to v26.0", async () => {
    const meta = fakeMeta();
    await syncPartnerConnections({
      partnerId: PARTNER, deps: { fetch: meta.fetch }, pass: "hourly", scope: fakeDb().scope
    });
    assert.ok(meta.urls.length >= 4, `only ${meta.urls.length} Meta calls`);
    for (const u of meta.urls) {
      assert.ok(u.startsWith("https://graph.facebook.com/v26.0/"), u);
    }
  });

  test("the day it saves takes link clicks from inline_link_clicks (4), not the actions line (5)", async () => {
    const db = fakeDb();
    const stats = await syncPartnerConnections({
      partnerId: PARTNER, deps: { fetch: fakeMeta().fetch }, pass: "hourly", scope: db.scope
    });
    assert.equal(stats.insights, 1);
    assert.equal(db.metricWrites.length, 1);
    // $19..$22 are purchases, cost_per_purchase_cents, link_clicks, landing_page_views.
    const p = db.metricWrites[0].params;
    assert.equal(p.length, 22);
    assert.equal(p[20], 4, "link_clicks did not prefer inline_link_clicks");
    assert.equal(p[18], null, "no purchase line → NULL, never 0");
  });
});

// ── the nightly pass is unchanged ───────────────────────────────────────────

describe("the nightly pass (and the button) still read the whole history on a first pull", () => {
  test("the same empty history sends the nightly pass to date_preset=maximum, once", async () => {
    const db = fakeDb();
    const meta = fakeMeta();
    const stats = await syncPartnerConnections({
      partnerId: PARTNER, deps: { fetch: meta.fetch }, scope: db.scope
    });
    const asked = insightUrls(meta.urls);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].searchParams.get("date_preset"), "maximum",
      "this harness would not have caught the hourly pass taking the path — the nightly pass did not take it either");
    assert.equal(stats.pass, "nightly");
    assert.deepEqual(stats.full_history, [{ connection: CONN, ok: true, days: 1 }]);
    assert.equal(db.statements.filter((s) => /min\(m\.date\)/.test(s)).length, 1);
  });

  test("the nightly window is still 28 days back to today, in UTC dates", () => {
    assert.equal(INSIGHT_WINDOW_DAYS, 28);
    const now = Date.UTC(2026, 9, 5, 7, 0);
    assert.deepEqual(insightWindow(now), { since: "2026-09-07", until: "2026-10-05" });
    assert.equal(SYNC_PASSES.nightly.window, insightWindow);
    assert.equal(SYNC_PASSES.nightly.mayReadWholeHistory, true);
  });
});

// ── the pass table ──────────────────────────────────────────────────────────

describe("the two passes", () => {
  test("hourly is 3 days and may never read the whole history", () => {
    assert.equal(HOURLY_WINDOW_DAYS, 3);
    assert.equal(SYNC_PASSES.hourly.windowDays, 3);
    assert.equal(SYNC_PASSES.hourly.mayReadWholeHistory, false);
    assert.ok(Object.isFrozen(SYNC_PASSES) && Object.isFrozen(SYNC_PASSES.hourly));
  });

  test("the hourly window is Arizona days: at 7pm Arizona it is still today, not tomorrow", () => {
    // 2026-10-06 02:00 UTC is 2026-10-05 19:00 in Arizona.
    assert.deepEqual(hourlyWindow(Date.UTC(2026, 9, 6, 2, 0)), { since: "2026-10-03", until: "2026-10-05" });
    assert.deepEqual(hourlyWindow(Date.UTC(2026, 9, 5, 18, 0)), { since: "2026-10-03", until: "2026-10-05" });
    // Across a month end.
    assert.deepEqual(hourlyWindow(Date.UTC(2026, 9, 1, 12, 0)), { since: "2026-09-29", until: "2026-10-01" });
  });

  test("a misspelt pass is refused before anything runs", async () => {
    assert.throws(() => syncPass("weekly"), (e) => e.code === "BAD_PASS");
    const db = fakeDb();
    await assert.rejects(
      syncPartnerConnections({ partnerId: PARTNER, pass: "weekly", scope: db.scope }),
      (e) => e.code === "BAD_PASS"
    );
    assert.equal(db.statements.length, 0, "the database was touched for a pass that does not exist");
  });
});
