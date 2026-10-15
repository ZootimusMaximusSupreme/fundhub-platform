// finish-853 batch 26: GET /api/trials/dashboard. The real handler runs the real dashboard library
// (src/trials/dashboard.mjs and store.mjs) over stand-in tables. Practice test, fake data, no network,
// no database. The row's words: counts of booked calls, spend (null when nothing has synced), bookings,
// plan and events in the trial window; no earnings claims, no lender data; read-only; the caller is a
// partner (own trial; a partner_id sent is ignored) or staff naming ?partner_id.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/trials/dashboard.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, inSql, sqlOf, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, OTHER_PARTNER, FOREIGN_PARTNER, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";

const DAY = 86400000;
const at = (days) => new Date(Date.now() + days * DAY).toISOString();
const TRIAL_ID = "f1000000-0000-4000-8000-000000000001";

const trialRow = (over = {}) => ({
  id: TRIAL_ID, org_id: ORG_ID, partner_id: PARTNER, affiliate_id: null, contact_email: "buyer@example.test",
  status: "running", price_cents: 29700, held_start: false, eligibility: {}, paid_at: at(-3),
  provisioned_at: at(-3), verification_confirmed_at: null, started_at: at(-2), ends_at: at(5),
  frozen_until: at(35), converted_at: null, declined_at: null, refunded_at: null, remedy: null,
  notes: null, created_at: at(-3), updated_at: at(-1), ...over,
});

function world(over = {}) {
  const client = (id, partner, org, createdDays, name) => ({
    id, partner_id: partner, org_id: org, created_at: at(createdDays), first_name: name[0], last_name: name[1],
  });
  const clients = [
    client("c1", PARTNER, ORG_ID, -1, ["Dana", "Whitfield"]),
    client("c2", PARTNER, ORG_ID, -1.5, ["Eli", ""]),
    client("c3", PARTNER, ORG_ID, -10, ["Old", "Lead"]),
    client("c4", OTHER_PARTNER, ORG_ID, -1, ["Other", "Buyer"]),
    client("c5", PARTNER, OTHER_ORG_ID, -1, ["Foreign", "Lead"]),
  ];
  const metric = (partner, org, days, spend, imp, clicks) => ({
    partner_id: partner, org_id: org, date: at(days).slice(0, 10), spend_cents: spend, impressions: imp, clicks,
  });
  const booking = (id, clientId, org, startsDays, createdDays, attendee = null) => ({
    id, client_id: clientId, org_id: org, starts_at: at(startsDays), ends_at: at(startsDays + 0.02),
    status: "booked", source: "calendar", event_type_slug: "call", created_at: at(createdDays), attendee_name: attendee,
  });
  return {
    live_trials: [trialRow(), trialRow({ id: "f2", partner_id: OTHER_PARTNER }), trialRow({ id: "f3", org_id: OTHER_ORG_ID, partner_id: FOREIGN_PARTNER })],
    clients,
    ad_metrics_daily: [
      metric(PARTNER, ORG_ID, -1, 1200, 1000, 40),
      metric(PARTNER, ORG_ID, -0.5, 800, 500, 20),
      metric(PARTNER, ORG_ID, -9, 9999, 9999, 999),
      metric(OTHER_PARTNER, ORG_ID, -1, 7777, 7777, 777),
      metric(PARTNER, OTHER_ORG_ID, -1, 5555, 5555, 555),
    ],
    bookings: [
      booking("b2", "c2", ORG_ID, 3, -1),
      booking("b1", "c1", ORG_ID, 1, -1),
      booking("bx", "c4", ORG_ID, 1, -1),
      booking("bf", "c5", OTHER_ORG_ID, 1, -1),
      booking("bo", "c3", ORG_ID, 2, -8),
    ],
    live_trial_events: [
      { id: "e1", org_id: ORG_ID, live_trial_id: TRIAL_ID, kind: "clock_started", detail: {}, actor_staff_id: null, occurred_at: at(-2) },
      { id: "e2", org_id: OTHER_ORG_ID, live_trial_id: TRIAL_ID, kind: "foreign", detail: {}, actor_staff_id: null, occurred_at: at(-1) },
    ],
    ...over,
  };
}

/** Stand-in rules: every statement is answered from the tables by the conditions it names. */
function rulesFor(t) {
  const inWindow = (value, from, to) => String(value) >= String(from) && (to == null || String(value) <= String(to));
  return [
    [/FROM live_trials WHERE/i, (sql, p) => inSql(t.live_trials, sql, p)],
    [/SELECT count\(\*\)::int AS n\s+FROM clients/i, (sql, p) => {
      const mine = inSql(t.clients, sql, p).filter((c) => inWindow(c.created_at, p[2], p[3]));
      return [{ n: mine.length }];
    }],
    [/FROM ad_metrics_daily/i, (sql, p) => {
      const mine = inSql(t.ad_metrics_daily, sql, p)
        .filter((m) => String(m.date) >= String(p[2]).slice(0, 10) && (p[3] == null || String(m.date) <= String(p[3]).slice(0, 10)));
      if (!mine.length) return [{ spend_cents: null, impressions: null, clicks: null, days_synced: 0 }];
      const sum = (key) => mine.reduce((n, m) => n + Number(m[key] || 0), 0);
      return [{ spend_cents: sum("spend_cents"), impressions: sum("impressions"), clicks: sum("clicks"), days_synced: mine.length }];
    }],
    [/FROM bookings b/i, (sql, p) => {
      // The JOIN carries the company on both sides; the answer follows what the statement names.
      const withClient = t.bookings.map((b) => ({ b, c: t.clients.find((c) => c.id === b.client_id && c.org_id === b.org_id) }))
        .filter(({ c }) => c);
      return withClient
        .filter(({ b, c }) => b.org_id === p[0] && c.partner_id === p[1] && inWindow(b.created_at, p[2], p[3]))
        .sort((x, y) => String(x.b.starts_at).localeCompare(String(y.b.starts_at)))
        .slice(0, p[4])
        .map(({ b, c }) => ({
          id: b.id, starts_at: b.starts_at, ends_at: b.ends_at, status: b.status, source: b.source,
          event_type_slug: b.event_type_slug, created_at: b.created_at,
          display_name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || b.attendee_name || "Lead",
        }));
    }],
    [/FROM live_trial_events/i, (sql, p) => inSql(t.live_trial_events, sql, p)],
  ];
}

const get = (query, who, t = world()) =>
  run(handler, req("GET", { query }), [...who, ...rulesFor(t)]);

describe("GET /api/trials/dashboard", () => {
  test("a partner sees their own numbers: leads, spend, booked calls and bookings, counted in the trial window only", async () => {
    const { res, fake } = await get({}, asPartner(PARTNER));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.numbers, {
      spend_cents: 2000, impressions: 1500, clicks: 60, leads: 2, booked_calls: 2, days_synced: 2,
    });
    assert.deepEqual(res.body.bookings.map((b) => [b.id, b.display_name]), [["b1", "Dana Whitfield"], ["b2", "Eli"]]);
    assert.equal(res.body.trial.status, "running");
    assert.equal(res.body.trial.live, true);
    assert.equal(res.body.trial.of_days, 7);
    assert.equal(res.body.trial.day, 3);
    assert.equal(res.body.trial.days_remaining, 5);
    assert.deepEqual(res.body.events.map((e) => e.id), ["e1"], "only this company's events");
    assert.equal(res.body.plan.length, 8);
    // The words of each count, as the statement must spell them: company AND partner, inside the window.
    const q = (re) => sqlOf(fake, re)[0].sql;
    pinned(q(/SELECT count\(\*\)::int AS n/), "leads: this company and this partner, inside the window",
      "WHERE org_id = $1 AND partner_id = $2 AND created_at >= $3 AND ($4::timestamptz IS NULL OR created_at <= $4)");
    pinned(q(/FROM ad_metrics_daily/), "spend: this company and this partner, by day, inside the window",
      "WHERE org_id = $1 AND partner_id = $2 AND date >= $3::date AND ($4::timestamptz IS NULL OR date <= $4::date)");
    pinned(q(/FROM bookings b/), "bookings: reached through this partner's clients, this company",
      "JOIN clients c ON c.id = b.client_id AND c.org_id = b.org_id WHERE b.org_id = $1 AND c.partner_id = $2 AND b.created_at >= $3");
    pinned(q(/FROM bookings b/), "bookings: soonest call first", "ORDER BY b.starts_at ASC NULLS LAST, b.created_at ASC");
    pinned(q(/FROM live_trials WHERE/), "the trial is this company's and this partner's", "WHERE org_id = $1 AND partner_id = $2 LIMIT 1");
    pinned(q(/FROM live_trial_events/), "events: this company, this trial, newest first",
      "WHERE org_id = $1 AND live_trial_id = $2 ORDER BY occurred_at DESC");
    assert.equal(wrote(fake), false, "a dashboard read writes nothing");
  });

  test("zero booked calls is 0, and spend is null (not 0) when nothing has synced", async () => {
    const t = world({ ad_metrics_daily: [], bookings: [] });
    const { res } = await get({}, asPartner(PARTNER), t);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.numbers.booked_calls, 0);
    assert.equal(res.body.numbers.leads, 2);
    assert.equal(res.body.numbers.spend_cents, null);
    assert.equal(res.body.numbers.impressions, null);
    assert.equal(res.body.numbers.clicks, null);
    assert.equal(res.body.numbers.days_synced, 0);
    assert.deepEqual(res.body.bookings, []);
  });

  test("a trial whose clock has not started has no counts at all, and says so, never zeros", async () => {
    const t = world({ live_trials: [trialRow({ status: "held_start", held_start: true, started_at: null, ends_at: null })] });
    const { res, fake } = await get({}, asPartner(PARTNER), t);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.numbers, {
      spend_cents: null, impressions: null, clicks: null, leads: null, booked_calls: null, days_synced: 0,
    });
    assert.deepEqual(res.body.bookings, []);
    assert.equal(res.body.notes[0].key, "held_start");
    assert.equal(res.body.trial.phase, "held_start");
    assert.equal(sqlOf(fake, /FROM clients|FROM ad_metrics_daily|FROM bookings/).length, 0, "no window, nothing counted");
  });

  test("a partner with no trial gets a 404, not an empty dashboard", async () => {
    const { res } = await get({}, asPartner(PARTNER), world({ live_trials: [] }));
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, "no_trial");
  });

  test("a partner is pinned to their own trial: a partner_id in the address is ignored", async () => {
    const t = world();
    const { res, fake } = await get({ partner_id: OTHER_PARTNER }, asPartner(PARTNER), t);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.trial.id, TRIAL_ID);
    assert.equal(res.body.numbers.leads, 2);
    assert.equal(sqlOf(fake, /FROM live_trials WHERE/)[0].params[1], PARTNER);
    assert.ok(fake.calls.filter((c) => /FROM (clients|ad_metrics_daily|bookings b)/.test(c.sql)).every((c) => c.params[1] === PARTNER));
  });

  test("staff must name a partner, and read that partner only inside their own company", async () => {
    const noPartner = await get({}, asRole("owner"));
    assert.equal(noPartner.res.statusCode, 400);
    assert.equal(noPartner.res.body.error, "partner_id_required");

    const named = await get({ partner_id: PARTNER }, asRole("closer"));
    assert.equal(named.res.statusCode, 200);
    assert.equal(named.res.body.numbers.booked_calls, 2);

    const otherCompany = await get({ partner_id: PARTNER }, asRole("owner", { org_id: OTHER_ORG_ID }));
    assert.equal(otherCompany.res.statusCode, 404, "another company's staff do not see this buyer's trial");
    assert.equal(sqlOf(otherCompany.fake, /FROM (clients|ad_metrics_daily|bookings b)/).length, 0);
    assert.equal(sqlOf(otherCompany.fake, /FROM live_trials WHERE/)[0].params[0], OTHER_ORG_ID);

    for (const role of ALL_STAFF_ROLES) {
      const ok = await get({ partner_id: PARTNER }, asRole(role));
      assert.equal(ok.res.statusCode, 200, role);
    }
  });

  test("a client, an affiliate and nobody signed in are all refused, and nothing is read", async () => {
    for (const [name, who, status] of [["client", asClient(), 403], ["affiliate", asAffiliate(), 403]]) {
      const { res, fake } = await get({ partner_id: PARTNER }, who);
      assert.equal(res.statusCode, status, name);
      assert.equal(sqlOf(fake, /FROM live_trials/).length, 0, name);
    }
    const none = await run(handler, req("GET", { query: { partner_id: PARTNER } }), rulesFor(world()));
    assert.equal(none.res.statusCode, 401);
    assert.equal(sqlOf(none.fake, /FROM live_trials/).length, 0);
  });

  test("a session with no company is refused before any trial is read; only GET answers", async () => {
    const noOrg = await get({ partner_id: PARTNER }, asRole("owner", { org_id: null }));
    assert.equal(noOrg.res.statusCode, 403);
    assert.equal(sqlOf(noOrg.fake, /FROM live_trials/).length, 0);
    const post = await run(handler, req("POST", { body: {} }), [...asRole("owner"), ...rulesFor(world())]);
    assert.equal(post.res.statusCode, 405);
    assert.equal(post.res.headers.allow, "GET");
  });

  test("the answer makes no earnings claim and carries no lender data", async () => {
    const { res } = await get({}, asPartner(PARTNER));
    assert.deepEqual(Object.keys(res.body).sort(),
      ["bookings", "events", "guarantee", "limitation", "notes", "numbers", "ok", "plan", "trial"]);
    assert.match(res.body.limitation, /your own numbers/i);
    assert.match(res.body.limitation, /we do not show averages, typical results/i);
    const { guarantee, limitation, ...rest } = res.body;
    assert.doesNotMatch(JSON.stringify(rest), /lender|payout|share_pct|percent_of/i, "no lender or payout data in the numbers");
    assert.equal(guarantee.length, 2, "the two written promises, as the policy states them");
    assert.match(guarantee[0], /every dollar back/);
    assert.deepEqual(Object.keys(res.body.numbers).sort(),
      ["booked_calls", "clicks", "days_synced", "impressions", "leads", "spend_cents"]);
  });

  test("a failing read is a 500 that names no database address", async () => {
    const t = world();
    const rules = [...asPartner(PARTNER), [/FROM ad_metrics_daily/i, new Error("could not reach postgres://user:pw@host/db")], ...rulesFor(t)];
    const { res } = await run(handler, req("GET"), rules);
    assert.equal(res.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(res.body), /postgres:\/\/user/);
  });
});
