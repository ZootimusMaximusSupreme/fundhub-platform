// Unit tests for src/marketing/metrics.mjs — no database.
//
// The ratios, the "unknown is null, never 0" rule, the 14-day maturing line,
// and what the SQL readers send and hand back (driven with a fake tx that
// records the query). The real-Postgres proof of the SQL is
// src/http/marketing-metrics.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MATURE_DAYS, ctr, hookRate, hold25, thruplayRate, cpl, costPerBooked, roas, closeRate,
  clickToPage, pageToLead, ratiosFor, settlesAt, isMaturing,
  readAdNumbers, readTotals, readDaily, readFunnelEvents, roadmapPaidPredicates,
  ROADMAP_BY_ORDER, ROADMAP_BY_FUNNEL
} from "./metrics.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";

/* A tx that records every query and answers with the rows it is given. */
function fakeTx(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    }
  };
}

// ── the ratios ──────────────────────────────────────────────────────────────

describe("ratios", () => {
  test("ctr = link clicks ÷ impressions", () => {
    assert.equal(ctr({ link_clicks: 43, impressions: 1247 }), 0.0345);
    assert.equal(ctr({ link_clicks: 0, impressions: 1000 }), 0, "a real zero stays 0");
  });

  test("hook rate = 2-second plays ÷ impressions", () => {
    assert.equal(hookRate({ two_sec: 250, impressions: 1000 }), 0.25);
  });

  test("25% hold = p25 ÷ plays", () => {
    assert.equal(hold25({ p25: 30, plays: 120 }), 0.25);
  });

  test("thruplay rate = thruplays ÷ plays", () => {
    assert.equal(thruplayRate({ thruplay: 1, plays: 3 }), 0.3333);
  });

  test("cost per lead = spend ÷ leads, whole cents", () => {
    assert.equal(cpl({ spend_cents: 10000, leads: 3 }), 3333);
    assert.equal(cpl({ spend_cents: 10001, leads: 2 }), 5001, "half a cent rounds up");
  });

  test("cost per booked call = spend ÷ booked, whole cents", () => {
    assert.equal(costPerBooked({ spend_cents: 27235, booked: 2 }), 13618);
  });

  test("ROAS = cash ÷ spend", () => {
    assert.equal(roas({ cash_cents: 29400, spend_cents: 12000 }), 2.45);
    assert.equal(roas({ cash_cents: 0, spend_cents: 12000 }), 0, "spent and made nothing is 0, a fact");
  });

  test("close rate = sales ÷ showed", () => {
    assert.equal(closeRate({ sales: 1, showed: 4 }), 0.25);
  });

  test("click → page and page → lead", () => {
    assert.equal(clickToPage({ page_views: 33, link_clicks: 43 }), 0.7674);
    assert.equal(pageToLead({ leads: 2, page_views: 40 }), 0.05);
  });

  test("bigint strings from pg read as numbers", () => {
    assert.equal(ctr({ link_clicks: "43", impressions: "1247" }), 0.0345);
    assert.equal(cpl({ spend_cents: "10000", leads: 4 }), 2500);
  });

  test("a rate can come back above 1 — Meta restates counts, never clamped", () => {
    assert.equal(hold25({ p25: 13, plays: 10 }), 1.3);
  });
});

describe("unknown is null, never 0", () => {
  const cases = [
    ["ctr", ctr, { link_clicks: null, impressions: 100 }],
    ["ctr", ctr, { link_clicks: 5, impressions: null }],
    ["ctr", ctr, { link_clicks: 5, impressions: 0 }],
    ["hookRate", hookRate, { two_sec: null, impressions: 100 }],
    ["hookRate", hookRate, { two_sec: 3, impressions: 0 }],
    ["hold25", hold25, { p25: 4, plays: null }],
    ["hold25", hold25, { p25: 4, plays: 0 }],
    ["thruplayRate", thruplayRate, { thruplay: undefined, plays: 10 }],
    ["thruplayRate", thruplayRate, { thruplay: 1, plays: 0 }],
    ["cpl", cpl, { spend_cents: 1000, leads: 0 }],
    ["cpl", cpl, { spend_cents: null, leads: 3 }],
    ["costPerBooked", costPerBooked, { spend_cents: 1000, booked: 0 }],
    ["costPerBooked", costPerBooked, { spend_cents: 1000, booked: null }],
    ["roas", roas, { cash_cents: null, spend_cents: 1000 }],
    ["roas", roas, { cash_cents: 500, spend_cents: 0 }],
    ["roas", roas, { cash_cents: 500, spend_cents: null }],
    ["closeRate", closeRate, { sales: 1, showed: 0 }],
    ["closeRate", closeRate, { sales: null, showed: 3 }],
    ["clickToPage", clickToPage, { page_views: 3, link_clicks: 0 }],
    ["pageToLead", pageToLead, { leads: 1, page_views: null }]
  ];
  for (const [name, fn, row] of cases) {
    test(`${name}(${JSON.stringify(row)}) → null`, () => {
      assert.equal(fn(row), null);
    });
  }

  test("garbage is unknown, not a number", () => {
    assert.equal(ctr({ link_clicks: "abc", impressions: 100 }), null);
    assert.equal(ctr({ link_clicks: -1, impressions: 100 }), null);
    assert.equal(ctr({ link_clicks: "", impressions: 100 }), null);
    assert.equal(cpl({ spend_cents: Infinity, leads: 1 }), null);
  });

  test("no argument at all → null, not a throw", () => {
    for (const fn of [ctr, hookRate, hold25, thruplayRate, cpl, costPerBooked, roas, closeRate, clickToPage, pageToLead]) {
      assert.equal(fn(), null, fn.name);
    }
  });

  test("ratiosFor fills every key; unknowns stay null", () => {
    const r = ratiosFor({
      spend_cents: 12000, impressions: 1000, link_clicks: 40, plays: 200, p25: 50,
      thruplay: 20, two_sec: null, leads: 4, booked: 2, showed: 0, sales: 0,
      cash_cents: 14700, page_views: 30
    });
    assert.deepEqual(r, {
      ctr: 0.04,
      hook_rate: null,
      hold_25: 0.25,
      thruplay_rate: 0.1,
      cpl_cents: 3000,
      cost_per_booked_cents: 6000,
      roas: 1.225,
      close_rate: null,
      click_to_page: 0.75,
      page_to_lead: 0.1333
    });
  });
});

// ── the 14-day maturing line ────────────────────────────────────────────────

describe("maturing", () => {
  const lead = new Date("2026-09-20T15:00:00Z");

  test("results count for 14 days", () => {
    assert.equal(MATURE_DAYS, 14);
    assert.equal(settlesAt(lead).toISOString(), "2026-10-04T15:00:00.000Z");
  });

  test("13 days old → still maturing", () => {
    assert.equal(isMaturing(lead, new Date("2026-10-03T15:00:00Z")), true);
  });

  test("one millisecond before 14 days → still maturing", () => {
    assert.equal(isMaturing(lead, new Date(settlesAt(lead).getTime() - 1)), true);
  });

  test("exactly 14 days → settled", () => {
    assert.equal(isMaturing(lead, new Date("2026-10-04T15:00:00Z")), false);
  });

  test("15 days → settled", () => {
    assert.equal(isMaturing(lead, new Date("2026-10-05T15:00:00Z")), false);
  });

  test("an ISO string works the same as a Date", () => {
    assert.equal(isMaturing("2026-09-20T15:00:00Z", "2026-10-04T14:59:59Z"), true);
  });

  test("an unreadable time is unknown (null), never 'settled'", () => {
    assert.equal(isMaturing(null, new Date()), null);
    assert.equal(isMaturing("not a date", new Date()), null);
    assert.equal(settlesAt(undefined), null);
  });
});

// ── the readers: guards ─────────────────────────────────────────────────────

describe("reader guards", () => {
  test("every reader refuses to run without a tx", async () => {
    await assert.rejects(readAdNumbers(null, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" }), /asStaff/);
    await assert.rejects(readTotals({}, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" }), /asStaff/);
    await assert.rejects(readDaily(undefined, { orgId: ORG, days: 7 }), /asStaff/);
    await assert.rejects(readFunnelEvents(null, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" }), /asStaff/);
  });

  test("no org → throws before any query", async () => {
    const tx = fakeTx();
    await assert.rejects(readAdNumbers(tx, { from: "2026-10-01", to: "2026-10-05" }), /orgId/);
    assert.equal(tx.calls.length, 0);
  });

  test("days must be real YYYY-MM-DD, and from not after to", async () => {
    const tx = fakeTx();
    await assert.rejects(readAdNumbers(tx, { orgId: ORG, from: "2026-10-1", to: "2026-10-05" }), /YYYY-MM-DD/);
    await assert.rejects(readTotals(tx, { orgId: ORG, from: "2026-02-30", to: "2026-03-05" }), /YYYY-MM-DD/);
    await assert.rejects(readFunnelEvents(tx, { orgId: ORG, from: "2026-10-06", to: "2026-10-05" }), /after/);
    assert.equal(tx.calls.length, 0);
  });

  test("ad numbers must be 1-9 digits", async () => {
    const tx = fakeTx();
    await assert.rejects(readAdNumbers(tx, { orgId: ORG, from: "2026-10-01", to: "2026-10-05", adNumbers: ["90", "oVid: SLO2"] }), /not an ad number/);
    assert.equal(tx.calls.length, 0);
  });

  test("an empty ad-number list reads nothing and asks nothing", async () => {
    const tx = fakeTx();
    assert.deepEqual(await readAdNumbers(tx, { orgId: ORG, from: "2026-10-01", to: "2026-10-05", adNumbers: [] }), []);
    assert.equal(tx.calls.length, 0);
  });

  test("days for readDaily: 1 to 400", async () => {
    const tx = fakeTx();
    await assert.rejects(readDaily(tx, { orgId: ORG, days: 0 }), /days/);
    await assert.rejects(readDaily(tx, { orgId: ORG, days: 401 }), /days/);
    await assert.rejects(readDaily(tx, { orgId: ORG, days: 2.5 }), /days/);
  });

  test("roadmapPaidPredicates needs a tx, an org and a client", async () => {
    await assert.rejects(roadmapPaidPredicates(null, { orgId: ORG, clientId: ORG }), /tx/);
    await assert.rejects(roadmapPaidPredicates(fakeTx(), { orgId: ORG }), /clientId/);
  });
});

// ── the readers: what they send ─────────────────────────────────────────────

describe("what the SQL says", () => {
  async function sqlOf(fn, args) {
    const tx = fakeTx([]);
    await fn(tx, args);
    return tx.calls[0];
  }

  test("Arizona days, never CURRENT_DATE", async () => {
    const { sql } = await sqlOf(readAdNumbers, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" });
    assert.match(sql, /AT TIME ZONE 'America\/Phoenix'/);
    assert.doesNotMatch(sql, /CURRENT_DATE/i);
  });

  test("spend by spend date, leads by lead date", async () => {
    const { sql } = await sqlOf(readAdNumbers, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" });
    assert.match(sql, /m\.date BETWEEN \$2::date AND \$3::date/);
    assert.match(sql, /\(a\.captured_at AT TIME ZONE 'America\/Phoenix'\)::date BETWEEN \$2::date AND \$3::date/);
  });

  test("each result counts only before the lead is 14 days old", async () => {
    const { sql } = await sqlOf(readAdNumbers, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" });
    assert.match(sql, /a\.captured_at \+ interval '14 days' AS settles_at/);
    for (const col of ["bk.created_at", "co.logged_at", "s.sold_at", "t.created_at"]) {
      assert.ok(sql.includes(`${col} < l.settles_at`), `${col} is not held to the 14-day window`);
    }
    assert.match(sql, /\(l\.settles_at > \$4::timestamptz\) AS maturing/);
  });

  test("the two kinds of ad_id: metrics join ads by uuid, leads keyed by number", async () => {
    const { sql } = await sqlOf(readAdNumbers, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" });
    assert.match(sql, /JOIN ads a ON a\.id = m\.ad_id/);
    assert.match(sql, /a\.ad_id AS ad_number/);
    assert.match(sql, /FULL JOIN lead_by_number l ON l\.ad_number = s\.ad_number/);
  });

  test("the roadmap count uses the lifted predicates, word for word", async () => {
    const { sql } = await sqlOf(readAdNumbers, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" });
    for (const c of [...ROADMAP_BY_ORDER.conditions, ...ROADMAP_BY_FUNNEL.conditions]) {
      assert.ok(sql.includes(c), `readAdNumbers does not use: ${c}`);
    }
  });

  test("demo rows are left out everywhere", async () => {
    const { sql } = await sqlOf(readAdNumbers, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" });
    for (const t of ["c.is_demo", "co.is_demo", "s.is_demo", "t.is_demo"]) {
      assert.ok(sql.includes(`${t} IS NOT TRUE`), `${t} not excluded`);
    }
    const ev = await sqlOf(readFunnelEvents, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" });
    assert.match(ev.sql, /e\.is_demo IS NOT TRUE/);
  });

  test("funnel events: real people only, funnel.* rows", async () => {
    const { sql } = await sqlOf(readFunnelEvents, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" });
    assert.match(sql, /e\.payload->>'actor' = 'person'/);
    assert.match(sql, /e\.name LIKE 'funnel\.%'/);
  });

  test("params: org, from, to, now, then the numbers", async () => {
    const now = new Date("2026-10-06T06:00:00Z");
    const { params } = await sqlOf(readAdNumbers, { orgId: ORG, from: "2026-10-01", to: "2026-10-05", adNumbers: [90, "84", "90"], now });
    assert.deepEqual(params, [ORG, "2026-10-01", "2026-10-05", now.toISOString(), ["90", "84"]]);
  });

  test("readDaily ends on today's Arizona day, not UTC's", async () => {
    // 2026-10-06 03:00 UTC is still 2026-10-05 in Arizona (UTC-7).
    const { params } = await sqlOf(readDaily, { orgId: ORG, days: 7, now: new Date("2026-10-06T03:00:00Z") });
    assert.equal(params[1], "2026-09-29");
    assert.equal(params[2], "2026-10-05");
  });
});

// ── the readers: what they hand back ────────────────────────────────────────

describe("row shapes", () => {
  test("readAdNumbers: bigint strings become numbers, unknown stays null", async () => {
    const tx = fakeTx([{
      ad_number: "90", ads: 2,
      spend_cents: "27235", impressions: "1247", link_clicks: null, plays: "300", p25: "30",
      thruplay: "12", two_sec: null, ad_days: 3, link_click_days: 0, play_days: 3, two_sec_days: 0,
      leads: 2, booked: 1, showed: 1, sales: 1, roadmaps: 1,
      cash_cents: "14700", cash_unknown: 0, reported_cash_cents: "50000", maturing_leads: 1
    }, {
      ad_number: "91", ads: 0,
      spend_cents: null, impressions: null, link_clicks: null, plays: null, p25: null,
      thruplay: null, two_sec: null, ad_days: null, link_click_days: null, play_days: null, two_sec_days: null,
      leads: 1, booked: 0, showed: 0, sales: 0, roadmaps: 0,
      cash_cents: null, cash_unknown: 1, reported_cash_cents: "0", maturing_leads: 0
    }, {
      ad_number: "92", ads: 1,
      spend_cents: "500", impressions: "40", link_clicks: "2", plays: null, p25: null,
      thruplay: null, two_sec: null, ad_days: 1, link_click_days: 1, play_days: 0, two_sec_days: 0,
      leads: null, booked: null, showed: null, sales: null, roadmaps: null,
      cash_cents: null, cash_unknown: null, reported_cash_cents: null, maturing_leads: null
    }]);
    const rows = await readAdNumbers(tx, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" });

    assert.equal(rows[0].spend_cents, 27235);
    assert.equal(rows[0].link_clicks, null, "Meta sent no link-click line: unknown, not 0");
    assert.equal(rows[0].cash_cents, 14700);
    assert.equal(rows[0].reported_cash_cents, 50000);
    assert.equal(rows[0].maturing, true);
    assert.deepEqual(rows[0].reported_days, { link_clicks: 0, plays: 3, two_sec: 0 });

    assert.equal(rows[1].spend_cents, null, "leads but no spend in the window: spend unknown, not $0");
    assert.equal(rows[1].cash_cents, null, "paid with no amount reported: unknown, not $0");
    assert.equal(rows[1].cash_unknown, 1);
    assert.equal(rows[1].ad_days, 0);

    assert.equal(rows[2].leads, 0, "spend and no leads: 0 leads is a fact");
    assert.equal(rows[2].cash_cents, 0);
    assert.equal(rows[2].maturing, false);
  });

  test("readTotals carries the unmapped spend and leads", async () => {
    const tx = fakeTx([{
      spend_cents: "60653", impressions: "9000", link_clicks: "120", plays: "800", p25: "90",
      thruplay: "40", two_sec: null, ad_days: 10, link_click_days: 8, play_days: 10, two_sec_days: 0,
      unmapped_spend_cents: "20000", unmapped_ad_days: 4, unmapped_ads: 3, unmapped_leads: 16,
      leads: 18, booked: 0, showed: 0, sales: 0, roadmaps: 2, cash_cents: "29400",
      cash_unknown: 0, reported_cash_cents: "0", maturing_leads: 5
    }]);
    const t = await readTotals(tx, { orgId: ORG, from: "2026-09-29", to: "2026-10-05" });
    assert.equal(t.spend_cents, 60653);
    assert.deepEqual(t.unmapped, { spend_cents: 20000, ad_days: 4, ads: 3, leads: 16 });
    assert.equal(t.leads, 18);
    assert.equal(t.maturing, true);
  });

  test("readFunnelEvents: funnel and step from the page map, old rows included", async () => {
    const tx = fakeTx([
      { name: "funnel.page", page: "/roadmap", ad_number: "90", events: 4, sessions: 4 },
      { name: "funnel.click", page: "/apply", ad_number: null, events: 2, sessions: 1 },
      { name: "funnel.page", page: "/not-on-the-map", ad_number: null, events: 1, sessions: 1 }
    ]);
    const rows = await readFunnelEvents(tx, { orgId: ORG, from: "2026-10-01", to: "2026-10-05" });
    assert.deepEqual(rows[0], { name: "funnel.page", event: "page", page: "/roadmap", funnel: "roadmap", step: 1, ad_number: "90", events: 4, sessions: 4 });
    assert.equal(rows[1].funnel, "watch");
    assert.equal(rows[1].step, 2);
    assert.equal(rows[1].event, "click");
    assert.equal(rows[2].funnel, null);
    assert.equal(rows[2].step, null);
  });

  test("roadmapPaidPredicates: either predicate is enough; nothing is swallowed", async () => {
    assert.deepEqual(await roadmapPaidPredicates(fakeTx([{ by_order: false, by_funnel: true }]), { orgId: ORG, clientId: ORG }),
      { by_order: false, by_funnel: true, paid: true });
    assert.deepEqual(await roadmapPaidPredicates(fakeTx([{ by_order: false, by_funnel: false }]), { orgId: ORG, clientId: ORG }),
      { by_order: false, by_funnel: false, paid: false });
    const broken = { query: async () => { throw new Error('relation "payment_links" does not exist'); } };
    await assert.rejects(roadmapPaidPredicates(broken, { orgId: ORG, clientId: ORG }), /does not exist/,
      "a failed read must throw, not answer 'not paid' the way safeRead does");
  });
});
