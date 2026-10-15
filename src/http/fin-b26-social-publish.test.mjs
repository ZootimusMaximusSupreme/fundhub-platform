// finish-853 batch 26: POST /api/social/publish. The real handler runs the real publisher
// (src/social/scheduler.mjs publishDue, src/social/publish-all.mjs) over stand-in tables that answer
// by the conditions each statement names. The platform adapters are stand-ins that record what they
// were asked to post; nothing is sent anywhere (the network is refused for the whole file).
// Practice test, fake data, no database.
// The row's words: run publishDue, publish every due scheduled post to its social channel (staff may
// publish all partners).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/social/publish.mjs";
import { registerAdapter } from "../social/scheduler.mjs";
import { ensureSocialAdapters } from "../social/publish-all.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, sqlOf, writes, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, OTHER_PARTNER, FOREIGN_PARTNER, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";
import {
  cleanSql, selectList, projectRow, evalSql, orderRows, orderOf, whereOf, keep, runUpdate, runInsert,
} from "../testing/fin-b26-sql.mjs";

const sent = [];            // every post an adapter was asked to publish
let currentWorld = null;    // the tables of the call in flight, so an adapter can look at what was already written
let failFor = new Set();    // post ids whose adapter call throws
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (url) => { throw new Error(`network refused in this test: ${url}`); };
  ensureSocialAdapters(); // registers the real adapters once (no network at registration) ...
  for (const channel of ["facebook", "instagram", "linkedin"]) {
    // ... then every channel the test uses is replaced by a recorder.
    registerAdapter(channel, {
      async post(post) {
        sent.push({
          id: post.id, channel: post.channel, caption: post.caption,
          // What the tables said at the moment the platform was asked: was this post already logged, and already 'posting'?
          loggedFirst: !!currentWorld && currentWorld.action_log.some((l) => l.target_id === post.id),
          wasPosting: !!currentWorld && currentWorld.social_posts.find((r) => r.id === post.id).status === "posting",
        });
        if (failFor.has(post.id)) { const e = new Error("platform said no"); e.platformMessage = "platform said no"; throw e; }
        return { external_post_id: `ext-${post.id}` };
      },
    });
  }
});
after(() => { globalThis.fetch = realFetch; });

const HELD_ONLY = "a5000000-0000-4000-8000-000000000005";
const HOUR = 3600e3;
const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
const ahead = (h) => new Date(Date.now() + h * HOUR).toISOString();
const post = (id, partner, over = {}) => ({
  id, org_id: partner === FOREIGN_PARTNER ? OTHER_ORG_ID : ORG_ID, partner_id: partner, channel_id: `ch-${partner}-fb`,
  status: "queued", scheduled_for: ago(1), attempt: 0, caption: `caption ${id}`, ...over,
});

function world(over = {}) {
  return {
    social_posts: [
      post("p-due-1", PARTNER, { scheduled_for: ago(3) }),
      // Failed once before (one attempt used, an error on file): a later success must clear that error.
      post("p-due-2", PARTNER, { scheduled_for: ago(1), channel_id: `ch-${PARTNER}-ig`, attempt: 1, last_error: "an earlier platform error" }),
      post("p-future", PARTNER, { scheduled_for: ahead(5) }),
      post("p-held", PARTNER, { status: "awaiting_approval" }),
      post("p-blocked", PARTNER, { status: "blocked" }),
      post("p-dead-channel", PARTNER, { channel_id: `ch-${PARTNER}-old` }),
      post("o-due", OTHER_PARTNER, { channel_id: `ch-${OTHER_PARTNER}-fb` }),
      // A partner whose only post is held for a person: they have nothing due for the sender.
      post("h-held", HELD_ONLY, { status: "awaiting_approval", channel_id: `ch-${HELD_ONLY}-fb` }),
    ],
    social_channels: [
      { id: `ch-${PARTNER}-fb`, partner_id: PARTNER, channel: "facebook", connection_state: "active", encrypted_access_token: null, external_account_id: "page-1" },
      { id: `ch-${PARTNER}-ig`, partner_id: PARTNER, channel: "instagram", connection_state: "active", encrypted_access_token: null, external_account_id: "ig-1" },
      { id: `ch-${PARTNER}-old`, partner_id: PARTNER, channel: "linkedin", connection_state: "expired", encrypted_access_token: null, external_account_id: "li-1" },
      { id: `ch-${OTHER_PARTNER}-fb`, partner_id: OTHER_PARTNER, channel: "facebook", connection_state: "active", encrypted_access_token: null, external_account_id: "page-2" },
      { id: `ch-${HELD_ONLY}-fb`, partner_id: HELD_ONLY, channel: "facebook", connection_state: "active", encrypted_access_token: null, external_account_id: "page-3" },
    ],
    partners: [
      { id: PARTNER, org_id: ORG_ID }, { id: OTHER_PARTNER, org_id: ORG_ID }, { id: FOREIGN_PARTNER, org_id: OTHER_ORG_ID },
      { id: HELD_ONLY, org_id: ORG_ID },
    ],
    action_log: [],
    onboarding_tasks: [],
    internal_tasks: [],
    ...over,
  };
}

/**
 * The statements, answered by reading them: the due read (its join, WHERE, ORDER BY, LIMIT and named
 * columns), the all-partners read (its WHERE, DISTINCT list and LIMIT), the action-log INSERT by its own
 * column list, and every UPDATE by its own SET list (so "attempt = attempt + 1", "posted_at = now()",
 * "last_error = NULL" and the external id are what the statement says, not what a stand-in assumes).
 */
function rulesFor(t) {
  return [
    [/FROM partners WHERE id = \$1/i, (sql, p) => {
      const items = selectList(sql, 0);
      return keep(t.partners, whereOf(sql), p, { alias: "partners" }).slice(0, 1)
        .map((r) => projectRow(items, { params: p, row: r, rows: { partners: r } }));
    }],
    [/SELECT DISTINCT p\.partner_id, p\.org_id\s+FROM social_posts p/i, (sql, p) => {
      const items = selectList(sql, 0);
      const kept = keep(t.social_posts, whereOf(sql), p, { alias: "p" });
      const seen = new Map();
      for (const r of kept) {
        const row = projectRow(items, { params: p, row: r, rows: { p: r } });
        seen.set(JSON.stringify(row), row);
      }
      const lim = /LIMIT \$(\d+)/i.exec(cleanSql(sql));
      return [...seen.values()].slice(0, p[Number(lim[1]) - 1]);
    }],
    [/FROM social_posts p\s+JOIN social_channels c ON c\.id = p\.channel_id/i, (sql, p) => {
      const text = cleanSql(sql);
      const items = selectList(sql, 0);
      const joinText = /JOIN social_channels c ON ([\s\S]*?) WHERE/i.exec(text)[1];
      const limit = Number(/LIMIT (\d+)/i.exec(text)[1]);
      const joined = [];
      for (const post of t.social_posts) {
        const c = t.social_channels.find((x) => evalSql(joinText, { params: p, rows: { p: post, c: x } }) === true);
        if (!c) continue;
        const env = { params: p, rows: { p: post, c } };
        if (evalSql(whereOf(sql), env) === true) joined.push(env);
      }
      return orderRows(joined, orderOf(sql), (env) => env).slice(0, limit).map((env) => projectRow(items, env));
    }],
    [/^\s*INSERT INTO action_log/i, (sql, p) => runInsert(sql, p, t.action_log, {
      fill: (row) => ({ executed_at: null, execute_error: null, ...row, id: `log-${t.action_log.length + 1}` }),
    }).rows],
    [/^\s*UPDATE social_posts\b/i, (sql, p) => runUpdate(sql, p, t.social_posts)],
    [/^\s*UPDATE action_log\b/i, (sql, p) => runUpdate(sql, p, t.action_log)],
    [/^\s*INSERT INTO partner_onboarding_tasks/i, (sql, p) => runInsert(sql, p, t.onboarding_tasks, {
      fill: (row) => ({ resolved_at: null, ...row, id: `task-${t.onboarding_tasks.length + 1}` }),
    }).rows],
    [/^\s*INSERT INTO tasks/i, (sql, p) => runInsert(sql, p, t.internal_tasks, {
      fill: (row) => ({ ...row, id: `it-${t.internal_tasks.length + 1}` }),
    }).rows],
  ];
}

const call = (who, body = {}, { query = {}, t = world() } = {}) => {
  sent.length = 0;
  currentWorld = t;
  return run(handler, req("POST", { body, query }), [...who, ...rulesFor(t)]).then((out) => ({ ...out, t }));
};
const status = (t, id) => t.social_posts.find((p) => p.id === id).status;

describe("POST /api/social/publish", () => {
  test("a partner publishes their own due posts: queued, due, on an active account; nothing else is touched", async () => {
    const { res, t, fake } = await call(asPartner(PARTNER));
    assert.equal(res.statusCode, 200);
    const byId = Object.fromEntries(res.body.results.map((r) => [r.id, r]));
    assert.deepEqual(Object.keys(byId).sort(), ["p-dead-channel", "p-due-1", "p-due-2"]);
    assert.equal(byId["p-due-1"].ok, true);
    assert.equal(byId["p-due-1"].external_post_id, "ext-p-due-1");
    assert.equal(byId["p-dead-channel"].skipped, "channel_not_active");
    assert.deepEqual(sent.map((s) => [s.id, s.channel]).sort(), [["p-due-1", "facebook"], ["p-due-2", "instagram"]]);
    assert.equal(status(t, "p-due-1"), "posted");
    assert.equal(status(t, "p-due-2"), "posted");
    assert.equal(t.social_posts.find((p) => p.id === "p-due-1").external_post_id, "ext-p-due-1");
    // What the UPDATE statements say, as stored.
    const one = t.social_posts.find((p) => p.id === "p-due-1");
    const two = t.social_posts.find((p) => p.id === "p-due-2");
    assert.ok(one.posted_at, "a post that went out says when");
    assert.equal(one.attempt, 1, "one try used");
    assert.equal(two.attempt, 2, "the earlier try plus this one");
    assert.equal(two.last_error, null, "a success clears the earlier error");
    assert.equal(two.external_post_id, "ext-p-due-2");
    for (const untouched of ["p-future", "p-held", "p-blocked", "p-dead-channel", "o-due"]) {
      assert.equal(t.social_posts.find((p) => p.id === untouched).attempt, 0, `${untouched} was not attempted`);
    }
    assert.equal(status(t, "p-future"), "queued", "not due yet");
    assert.equal(status(t, "p-held"), "awaiting_approval", "a held post is invisible to the sender");
    assert.equal(status(t, "p-blocked"), "blocked");
    assert.equal(status(t, "o-due"), "queued", "another partner's post is not published by this partner");
    // The words of the read: this partner, queued only, due now, oldest first.
    const due = sqlOf(fake, /FROM social_posts p\s+JOIN social_channels c/)[0];
    assert.equal(due.params[0], PARTNER);
    pinned(due.sql, "this partner, queued only, due now", "WHERE p.partner_id = $1 AND p.status = 'queued' AND p.scheduled_for <= COALESCE($2::timestamptz, now())");
    pinned(due.sql, "oldest first", "ORDER BY p.scheduled_for LIMIT 50");
    // Logged before it goes out, finished after.
    assert.equal(t.action_log.length, 2);
    assert.ok(t.action_log.every((l) => l.executed_at && l.execute_error === null), "finished after it went out, with no error");
    assert.ok(sent.every((s) => s.loggedFirst && s.wasPosting), "each post was logged, and marked 'posting', BEFORE the platform was asked");
    const logRow = t.action_log.find((l) => l.target_id === "p-due-1");
    assert.deepEqual(
      [logRow.org_id, logRow.partner_id, logRow.actor, logRow.target_type, logRow.rule_key, logRow.reason],
      [ORG_ID, PARTNER, "agent", "social_post", "social_publish", "scheduled post to facebook"]);
    assert.deepEqual([logRow.before, logRow.after], [{ status: "queued" }, { status: "posted" }], "what it was and what it became");
    assert.deepEqual(logRow.undo_payload, { action: "delete_post", post_id: "p-due-1", channel: "facebook" }, "how to take it back");
  });

  test("one run takes at most fifty due posts, oldest first, and leaves the rest queued for the next run", async () => {
    const t = world();
    for (let k = 0; k < 60; k += 1) {
      t.social_posts.push(post(`bulk-${String(k).padStart(2, "0")}`, PARTNER, { scheduled_for: new Date(Date.now() - (100 - k) * 60000 - 7 * HOUR).toISOString() }));
    }
    const { res } = await call(asPartner(PARTNER), {}, { t });
    assert.equal(res.body.results.length, 50, "fifty, not every post that is due");
    assert.equal(sent.length, 50, "fifty went to the platform");
    const left = t.social_posts.filter((p) => p.partner_id === PARTNER && p.status === "queued" && new Date(p.scheduled_for) < new Date());
    assert.equal(left.length, 13, "ten bulk posts and the three older ones wait for the next run");
    // Oldest first: the bulk posts (7+ hours old) go before the 3-hour-old one.
    assert.equal(status(t, "bulk-00"), "posted");
    assert.equal(status(t, "p-due-1"), "queued", "newer than all fifty that went, so it waits");
  });

  test("a partner is pinned to their own id: a partner_id in the body publishes nothing for anyone else", async () => {
    const { res, t, fake } = await call(asPartner(PARTNER), { partner_id: OTHER_PARTNER }, { query: { partner_id: OTHER_PARTNER } });
    assert.equal(res.statusCode, 200);
    assert.equal(status(t, "o-due"), "queued");
    assert.equal(sqlOf(fake, /FROM social_posts p\s+JOIN social_channels c/)[0].params[0], PARTNER);
  });

  test("one failing channel does not stop the rest; a failure goes back in the queue, the third failure is given up and becomes a task", async () => {
    const t = world();
    failFor = new Set(["p-due-1"]);
    const first = await call(asPartner(PARTNER), {}, { t });
    assert.equal(first.res.statusCode, 200);
    const r1 = first.res.body.results.find((r) => r.id === "p-due-1");
    assert.equal(r1.ok, false);
    assert.equal(r1.gaveUp, false);
    assert.match(r1.error, /platform said no/);
    assert.equal(status(t, "p-due-1"), "queued", "it will be tried again");
    assert.equal(t.social_posts.find((p) => p.id === "p-due-1").last_error, "platform said no");
    assert.equal(status(t, "p-due-2"), "posted", "the other channel still went out");
    assert.equal(t.onboarding_tasks.length, 0);

    await call(asPartner(PARTNER), {}, { t });
    const third = await call(asPartner(PARTNER), {}, { t });
    const r3 = third.res.body.results.find((r) => r.id === "p-due-1");
    assert.equal(r3.gaveUp, true);
    assert.equal(status(t, "p-due-1"), "failed");
    assert.equal(t.social_posts.find((p) => p.id === "p-due-1").attempt, 3);
    assert.equal(t.onboarding_tasks.length, 1, "a post given up on reaches a person");
    assert.equal(t.onboarding_tasks[0].task_key, "social_post_failed");
    assert.equal(t.onboarding_tasks[0].partner_id, PARTNER);
    assert.equal(t.onboarding_tasks[0].org_id, ORG_ID);
    assert.deepEqual([t.onboarding_tasks[0].severity, t.onboarding_tasks[0].detail], ["warning", "platform said no"], "the person is told why");
    assert.match(t.onboarding_tasks[0].title, /facebook post failed after 3 attempts/);
    assert.equal(t.internal_tasks.length, 1);
    assert.deepEqual([t.internal_tasks[0].org_id, t.internal_tasks[0].assignee_role, t.internal_tasks[0].source_workflow],
      [ORG_ID, "admin", "creative-factory-onboarding"], "a Fundhub admin owns the follow-up");
    assert.match(t.internal_tasks[0].title, /^Partner onboarding: A scheduled facebook post failed/);
    failFor = new Set();
  });

  test("staff name a partner and publish that partner's posts; the company is read from the partner; every staff role may", async () => {
    const none = await call(asRole("owner"));
    assert.equal(none.res.statusCode, 400);
    assert.equal(none.res.body.error, "partner_id_required");
    assert.deepEqual(sent, []);

    for (const role of ALL_STAFF_ROLES) {
      const { res, t } = await call(asRole(role), { partner_id: OTHER_PARTNER });
      assert.equal(res.statusCode, 200, role);
      assert.equal(status(t, "o-due"), "posted", role);
      assert.equal(status(t, "p-due-1"), "queued", `${role}: only the named partner`);
    }
    const lookup = await call(asRole("owner"), { partner_id: OTHER_PARTNER });
    assert.deepEqual(sqlOf(lookup.fake, /FROM partners WHERE id/)[0].params, [OTHER_PARTNER]);

    const unknown = await call(asRole("owner"), { partner_id: "a8000000-0000-4000-8000-000000000008" });
    assert.equal(unknown.res.statusCode, 404);
    assert.equal(unknown.res.body.error, "partner_not_found");
  });

  test("staff can publish for all partners at once; a partner cannot, and nothing is sent when they ask", async () => {
    for (const all of [true, 1, "1"]) {
      const { res, t } = await call(asRole("owner"), { all });
      assert.equal(res.statusCode, 200, String(all));
      assert.equal(res.body.partners, 2, "two partners had posts due; the one with only a held post is not walked");
      assert.deepEqual(res.body.batches.map((b) => b.partner_id).sort(), [OTHER_PARTNER, PARTNER].sort());
      assert.equal(status(t, "o-due"), "posted");
      assert.equal(status(t, "p-due-1"), "posted");
      assert.equal(status(t, "p-future"), "queued");
      assert.equal(status(t, "p-held"), "awaiting_approval");
    }
    const walk = await call(asRole("owner"), { all: true });
    const partnersRead = sqlOf(walk.fake, /SELECT DISTINCT p\.partner_id/)[0];
    assert.equal(partnersRead.params[1], 50, "at most fifty partners in one walk");
    pinned(partnersRead.sql, "queued posts that are due, with a date", "WHERE p.status = 'queued' AND p.scheduled_for IS NOT NULL AND p.scheduled_for <= COALESCE($1::timestamptz, now())");
    const mine = await call(asPartner(PARTNER), { all: true });
    assert.equal(mine.res.statusCode, 403);
    assert.equal(mine.res.body.error, "staff_only_for_all");
    assert.deepEqual(sent, []);
    assert.equal(wrote(mine.fake), false);
    const falsy = await call(asRole("owner"), { all: "yes" });
    assert.equal(falsy.res.statusCode, 400, "anything but true, 1 or '1' is not 'all'");
  });

  test("a client, an affiliate and nobody signed in are refused; only POST answers; a failed read is a 500 with no address in it", async () => {
    for (const who of [asClient(), asAffiliate()]) {
      const { res } = await call(who, { partner_id: PARTNER });
      assert.equal(res.statusCode, 403);
      assert.deepEqual(sent, []);
    }
    const nobody = await run(handler, req("POST", { body: { partner_id: PARTNER } }), rulesFor(world()));
    assert.equal(nobody.res.statusCode, 401);
    const get = await run(handler, req("GET", { query: { partner_id: PARTNER } }), [...asRole("owner"), ...rulesFor(world())]);
    assert.equal(get.res.statusCode, 405);
    assert.equal(get.res.headers.allow, "POST");
    const t = world();
    const broken = await run(handler, req("POST", { body: {} }), [...asPartner(PARTNER),
      [/FROM social_posts p\s+JOIN social_channels c/i, new Error("could not connect to postgres://u:p@h/db")], ...rulesFor(t)]);
    assert.equal(broken.res.statusCode, 500);
    assert.doesNotMatch(JSON.stringify(broken.res.body), /postgres:\/\/u:p/);
  });
});
