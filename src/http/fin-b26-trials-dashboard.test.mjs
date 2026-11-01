// finish-853 batch 26: GET /api/trials/dashboard. The real handler runs the real dashboard library
// (src/trials/dashboard.mjs and store.mjs) over stand-in tables. Practice test, fake data, no network,
// no database. The row's words: counts of booked calls, spend (null when nothing has synced), bookings,
// plan and events in the trial window; no earnings claims, no lender data; read-only; the caller is a
// partner (own trial; a partner_id sent is ignored) or staff naming ?partner_id.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/trials/dashboard.mjs";
import { trialDashboard } from "../trials/dashboard.mjs";
import { listTrialEvents } from "../trials/store.mjs";
import { strictFakeDb } from "../testing/s3-handler-call.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, sqlOf, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, OTHER_PARTNER, FOREIGN_PARTNER, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";
import {
  cleanSql, selectList, projectRow, evalSql, orderRows, orderOf, whereOf, keep,
} from "../testing/fin-b26-sql.mjs";

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
    // Two leads who left no name: one booked under a typed attendee name, one under nothing.
    client("c6", PARTNER, ORG_ID, -1, [null, null]),
    client("c7", PARTNER, ORG_ID, -1.2, ["", ""]),
    // Came in AFTER the seventh day ended, and came in BEFORE the clock started: neither is in the window.
    client("c8", PARTNER, ORG_ID, 6, ["Late", "Lead"]),
    client("c9", PARTNER, ORG_ID, -2.5, ["Early", "Lead"]),
  ];
  const metric = (partner, org, days, spend, imp, clicks) => ({
    partner_id: partner, org_id: org, date: at(days).slice(0, 10), spend_cents: spend, impressions: imp, clicks,
  });
  const booking = (id, clientId, org, startsDays, createdDays, attendee = null) => ({
    id, client_id: clientId, org_id: org, starts_at: startsDays == null ? null : at(startsDays),
    ends_at: startsDays == null ? null : at(startsDays + 0.02),
    status: "booked", source: "calendar", event_type_slug: "call", created_at: at(createdDays), attendee_name: attendee,
  });
  return {
    live_trials: [trialRow(), trialRow({ id: "f2", partner_id: OTHER_PARTNER }), trialRow({ id: "f3", org_id: OTHER_ORG_ID, partner_id: FOREIGN_PARTNER })],
    clients,
    ad_metrics_daily: [
      metric(PARTNER, ORG_ID, -1, 1200, 1000, 40),
      metric(PARTNER, ORG_ID, -0.5, 800, 500, 20),
      metric(PARTNER, ORG_ID, -9, 9999, 9999, 999),
      // The day before the clock started (the trial row was created then): not part of the seven days.
      metric(PARTNER, ORG_ID, -3, 4444, 4444, 444),
      metric(OTHER_PARTNER, ORG_ID, -1, 7777, 7777, 777),
      metric(PARTNER, OTHER_ORG_ID, -1, 5555, 5555, 555),
    ],
    bookings: [
      booking("b2", "c2", ORG_ID, 3, -1),
      booking("b1", "c1", ORG_ID, 1, -1),
      booking("b3", "c6", ORG_ID, 2, -1, "Walk In"),
      booking("b4", "c7", ORG_ID, null, -1),
      booking("bx", "c4", ORG_ID, 1, -1),
      booking("bf", "c5", OTHER_ORG_ID, 1, -1),
      booking("bo", "c3", ORG_ID, 2, -8),
      // Created after the seventh day ended, and before the clock started: not in the window.
      booking("bz", "c8", ORG_ID, 7, 6),
      booking("bq", "c9", ORG_ID, 0, -2.5),
    ],
    live_trial_events: [
      { id: "e1", org_id: ORG_ID, live_trial_id: TRIAL_ID, kind: "clock_started", detail: {}, actor_staff_id: null, occurred_at: at(-2) },
      { id: "e2", org_id: OTHER_ORG_ID, live_trial_id: TRIAL_ID, kind: "foreign", detail: {}, actor_staff_id: null, occurred_at: at(-1) },
    ],
    ...over,
  };
}

/**
 * Stand-in rules: every statement is read, not assumed. WHERE is evaluated as written (company, partner,
 * window, both ends), every aggregate the SELECT names (count, SUM) is worked out from the rows that
 * WHERE keeps, the booking read follows its own JOIN, ORDER BY, LIMIT and display-name expression, and
 * every output column is only what the SELECT list names.
 */
function rulesFor(t) {
  return [
    [/FROM live_trials WHERE/i, (sql, p) => {
      const items = selectList(sql, 0);
      return keep(t.live_trials, whereOf(sql), p, { alias: "live_trials" }).slice(0, 1)
        .map((r) => projectRow(items, { params: p, row: r, rows: { live_trials: r } }));
    }],
    [/SELECT count\(\*\)::int AS n\s+FROM clients/i, (sql, p) => {
      const items = selectList(sql, 0);
      const group = keep(t.clients, whereOf(sql), p, { alias: "clients" }).map((r) => ({ params: p, row: r, rows: { clients: r } }));
      return [projectRow(items, { params: p, group, rows: {} })];
    }],
    [/FROM ad_metrics_daily/i, (sql, p) => {
      const items = selectList(sql, 0);
      const group = keep(t.ad_metrics_daily, whereOf(sql), p, { alias: "ad_metrics_daily" })
        .map((r) => ({ params: p, row: r, rows: { ad_metrics_daily: r } }));
      return [projectRow(items, { params: p, group, rows: {} })];
    }],
    [/FROM bookings b/i, (sql, p) => {
      const text = cleanSql(sql);
      const items = selectList(sql, 0);
      const joinText = /JOIN clients c ON ([\s\S]*?) WHERE/i.exec(text)[1];
      const limit = p[Number(/LIMIT \$(\d+)/i.exec(text)[1]) - 1];
      const joined = [];
      for (const b of t.bookings) {
        const c = t.clients.find((x) => evalSql(joinText, { params: p, rows: { b, c: x } }) === true);
        if (!c) continue;
        const env = { params: p, rows: { b, c } };
        if (evalSql(whereOf(sql), env) === true) joined.push(env);
      }
      return orderRows(joined, orderOf(sql), (env) => env).slice(0, limit).map((env) => projectRow(items, env));
    }],
    [/FROM live_trial_events/i, (sql, p) => {
      const items = selectList(sql, 0);
      const kept = keep(t.live_trial_events, whereOf(sql), p, { alias: "live_trial_events" });
      const ordered = orderRows(kept, orderOf(sql), (r) => ({ row: r }));
      const limit = p[Number(/LIMIT \$(\d+)/i.exec(cleanSql(sql))[1]) - 1];
      return ordered.slice(0, limit).map((r) => projectRow(items, { params: p, row: r, rows: { live_trial_events: r } }));
    }],
  ];
}

const get = (query, who, t = world()) =>
  run(handler, req("GET", { query }), [...who, ...rulesFor(t)]);

describe("GET /api/trials/dashboard", () => {
  test("a partner sees their own numbers: leads, spend, booked calls and bookings, counted in the trial window only", async () => {
    const t = world();
    const { res, fake } = await get({}, asPartner(PARTNER), t);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.numbers, {
      spend_cents: 2000, impressions: 1500, clicks: 60, leads: 4, booked_calls: 4, days_synced: 2,
    }, "spend, impressions and clicks are each their own sum; the day before the clock and the days after are not in it");
    assert.deepEqual(res.body.bookings.map((b) => [b.id, b.display_name]),
      [["b1", "Dana Whitfield"], ["b3", "Walk In"], ["b2", "Eli"], ["b4", "Lead"]],
      "soonest call first, the call with no time last; a lead with no name shows the name they typed, then 'Lead'");
    const first = res.body.bookings[0];
    assert.deepEqual([first.status, first.source, first.event_type_slug], ["booked", "calendar", "call"], "what each booking says about itself");
    const stored = t.bookings.find((b) => b.id === "b1");
    assert.deepEqual([first.starts_at, first.ends_at, first.created_at], [stored.starts_at, stored.ends_at, stored.created_at]);
    assert.equal(res.body.bookings[3].starts_at, null);
    assert.equal(res.body.trial.status, "running");
    assert.equal(res.body.trial.live, true);
    assert.equal(res.body.trial.of_days, 7);
    assert.equal(res.body.trial.day, 3);
    assert.equal(res.body.trial.days_remaining, 5);
    // The whole trial block a buyer reads: what they paid, when the seven days began and end, until when the
    // screen stays readable after it is over, and whether the clock was held. Each is its own stored value.
    const row = t.live_trials[0];
    assert.deepEqual(res.body.trial, {
      id: TRIAL_ID, status: "running", phase: "running", held_start: false, day: 3, of_days: 7, days_remaining: 5,
      started_at: row.started_at, ends_at: row.ends_at, frozen_until: row.frozen_until, price_cents: 29700,
      live: true, readable_until: row.frozen_until,
    });
    assert.notEqual(row.started_at, row.ends_at, "the fixture would not notice a swap if these matched");
    assert.notEqual(row.ends_at, row.frozen_until);
    assert.deepEqual(res.body.events.map((e) => [e.id, e.kind]), [["e1", "clock_started"]], "only this company's events");
    assert.deepEqual(res.body.plan.map((d) => [d.day, d.title, d.human]), [
      [1, "First spend, first clicks, first leads", false], [2, "First optimisation pass", false], [3, "Mid-trial check", true],
      [4, "Creative refresh if the first set is tiring", true], [5, "Fundhub starts fulfilling", true], [6, "Nothing new", false],
      [7, "Trial ends at the end of the seventh live day", false], [8, "The conversion call", true],
    ], "the eight days a buyer is told about");
    assert.ok(res.body.plan.every((d) => typeof d.detail === "string" && d.detail.length > 10));
    assert.equal(res.body.plan.length, 8);
    // The words of each count, as the statement must spell them: company AND partner, inside the window.
    const q = (re) => sqlOf(fake, re)[0].sql;
    pinned(q(/SELECT count\(\*\)::int AS n/), "leads: this company and this partner, inside the window",
      "WHERE org_id = $1 AND partner_id = $2 AND created_at >= $3 AND ($4::timestamptz IS NULL OR created_at <= $4)");
    pinned(q(/FROM ad_metrics_daily/), "spend: this company and this partner, by day, inside the window",
      "WHERE org_id = $1 AND partner_id = $2 AND date >= $3::date AND ($4::timestamptz IS NULL OR date <= $4::date)");
    pinned(q(/FROM bookings b/), "bookings: reached through this partner's clients, this company",
      "JOIN clients c ON c.id = b.client_id AND c.org_id = b.org_id WHERE b.org_id = $1 AND c.partner_id = $2 AND c.custom_fields->>'crm_archived_at' IS NULL AND b.created_at >= $3");
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
    assert.equal(res.body.numbers.leads, 4);
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
    assert.equal(res.body.trial.live, false, "a trial whose clock has not started is not live");
    const held = t.live_trials[0];
    assert.deepEqual(res.body.trial, {
      id: TRIAL_ID, status: "held_start", phase: "held_start", held_start: true, day: null, of_days: 7, days_remaining: null,
      started_at: null, ends_at: null, frozen_until: held.frozen_until, price_cents: 29700, live: false, readable_until: held.frozen_until,
    }, "what was paid, that the clock is being held, and until when the screen stays readable");
    assert.deepEqual(res.body.events.map((e) => e.id), ["e1"], "the activity strip still shows this trial's events");
    assert.equal(res.body.plan.length, 8);
    assert.equal(sqlOf(fake, /FROM clients|FROM ad_metrics_daily|FROM bookings/).length, 0, "no window, nothing counted");
  });

  test("a trial that has not started, and one that is over, say so: not live, the right phase, the right note", async () => {
    const waiting = await get({}, asPartner(PARTNER), world({
      live_trials: [trialRow({ status: "provisioned", started_at: null, ends_at: null })],
    }));
    assert.equal(waiting.res.statusCode, 200);
    assert.equal(waiting.res.body.notes[0].key, "not_started", "a paid, provisioned trial that has not begun says its seven days have not started");
    assert.equal(waiting.res.body.trial.phase, "waiting_for_first_impression");
    assert.equal(waiting.res.body.trial.live, false);
    assert.equal(waiting.res.body.numbers.leads, null);
    for (const [status, phase] of [["ended", "conversion_call"], ["converted", "converted"], ["declined", "declined"], ["refunded", "refunded"]]) {
      const { res } = await get({}, asPartner(PARTNER), world({
        live_trials: [trialRow({ status, started_at: at(-10), ends_at: at(-3) })],
      }));
      assert.equal(res.statusCode, 200, status);
      assert.equal(res.body.trial.live, false, `${status} is not live: the numbers are frozen`);
      assert.equal(res.body.trial.status, status);
      assert.equal(res.body.trial.phase, phase, status);
      assert.ok(res.body.numbers.leads !== null, `${status}: a trial that ran still shows its own numbers`);
    }
    const running = await get({}, asPartner(PARTNER));
    assert.equal(running.res.body.trial.live, true);
    assert.equal(running.res.body.trial.phase, "running");
  });

  test("the activity strip shows the newest twenty-five events of this trial, newest first, for a running trial and a held one", async () => {
    const many = (t) => {
      for (let k = 0; k < 30; k += 1) {
        t.live_trial_events.push({
          id: `ev-${String(k).padStart(2, "0")}`, org_id: ORG_ID, live_trial_id: TRIAL_ID, kind: "note", detail: {},
          actor_staff_id: null, occurred_at: new Date(Date.now() - k * 3600e3).toISOString(),
        });
      }
      return t;
    };
    const wantIds = Array.from({ length: 25 }, (_, k) => `ev-${String(k).padStart(2, "0")}`);
    const running = await get({}, asPartner(PARTNER), many(world()));
    assert.deepEqual(running.res.body.events.map((e) => e.id), wantIds, "twenty-five, the newest first; the 'clock_started' from two days ago and the older notes fall off");
    assert.equal(sqlOf(running.fake, /FROM live_trial_events/)[0].params[2], 25);
    const heldWorld = many(world({ live_trials: [trialRow({ status: "held_start", held_start: true, started_at: null, ends_at: null })] }));
    const held = await get({}, asPartner(PARTNER), heldWorld);
    assert.deepEqual(held.res.body.events.map((e) => e.id), wantIds, "the held trial's strip is bounded the same way");
    assert.equal(sqlOf(held.fake, /FROM live_trial_events/)[0].params[2], 25);
    // The events library has its own bounds for any other caller: 200 at most, 50 when it is not a usable number.
    for (const [limit, want] of [[undefined, 50], [5000, 200], [0, 50], [-3, 50], [Number.NaN, 50], [10, 10]]) {
      const lib = strictFakeDb(rulesFor(world()));
      await listTrialEvents(lib, { orgId: ORG_ID, liveTrialId: TRIAL_ID, ...(limit === undefined ? {} : { limit }) });
      assert.equal(sqlOf(lib, /FROM live_trial_events/)[0].params[2], want, String(limit));
    }
  });

  test("bookings are capped at a hundred on one screen", async () => {
    const t = world();
    for (let k = 0; k < 120; k += 1) {
      t.bookings.push({
        id: `many-${k}`, client_id: "c1", org_id: ORG_ID, starts_at: at(1 + k / 1000), ends_at: at(1.01 + k / 1000),
        status: "booked", source: "calendar", event_type_slug: "call", created_at: at(-1), attendee_name: null,
      });
    }
    const { res, fake } = await get({}, asPartner(PARTNER), t);
    assert.equal(res.body.bookings.length, 100);
    assert.equal(sqlOf(fake, /FROM bookings b/)[0].params[4], 100);
    // The dashboard library has the same bound for any other caller: 200 at most, 100 when it is not a usable number.
    for (const [bookingLimit, want] of [[undefined, 100], [5000, 200], [0, 100], [-3, 100], [Number.NaN, 100], [25, 25]]) {
      const lib = strictFakeDb(rulesFor(world()));
      await trialDashboard(lib, { orgId: ORG_ID, partnerId: PARTNER, ...(bookingLimit === undefined ? {} : { bookingLimit }) });
      assert.equal(sqlOf(lib, /FROM bookings b/)[0].params[4], want, String(bookingLimit));
    }
  });

  test("the company is the session's: another company's id in the address changes nothing", async () => {
    const { res, fake } = await get({ partner_id: PARTNER, org_id: OTHER_ORG_ID, orgId: OTHER_ORG_ID }, asRole("owner"));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.numbers.leads, 4);
    for (const call of fake.calls.filter((c) => /FROM (live_trials|clients|ad_metrics_daily|bookings b|live_trial_events)/.test(c.sql))) {
      assert.equal(call.params[0], ORG_ID, call.sql.slice(0, 60));
    }
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
    assert.equal(res.body.numbers.leads, 4);
    assert.equal(sqlOf(fake, /FROM live_trials WHERE/)[0].params[1], PARTNER);
    assert.ok(fake.calls.filter((c) => /FROM (clients|ad_metrics_daily|bookings b)/.test(c.sql)).every((c) => c.params[1] === PARTNER));
  });

  test("staff must name a partner, and read that partner only inside their own company", async () => {
    const noPartner = await get({}, asRole("owner"));
    assert.equal(noPartner.res.statusCode, 400);
    assert.equal(noPartner.res.body.error, "partner_id_required");

    const named = await get({ partner_id: PARTNER }, asRole("closer"));
    assert.equal(named.res.statusCode, 200);
    assert.equal(named.res.body.numbers.booked_calls, 4);

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
