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
  run, req, asRole, asPartner, asClient, asAffiliate, inSql, sqlOf, writes, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, OTHER_PARTNER, FOREIGN_PARTNER, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";

const sent = [];            // every post an adapter was asked to publish
let failFor = new Set();    // post ids whose adapter call throws
const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (url) => { throw new Error(`network refused in this test: ${url}`); };
  ensureSocialAdapters(); // registers the real adapters once (no network at registration) ...
  for (const channel of ["facebook", "instagram", "linkedin"]) {
    // ... then every channel the test uses is replaced by a recorder.
    registerAdapter(channel, {
      async post(post) {
        sent.push({ id: post.id, channel: post.channel, caption: post.caption });
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
      post("p-due-2", PARTNER, { scheduled_for: ago(1), channel_id: `ch-${PARTNER}-ig` }),
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

function rulesFor(t) {
  const byId = (id) => t.social_posts.find((p) => p.id === id);
  return [
    [/FROM partners WHERE id = \$1/i, (sql, p) => inSql(t.partners, sql, p).slice(0, 1).map((r) => ({ org_id: r.org_id }))],
    [/SELECT DISTINCT p\.partner_id, p\.org_id\s+FROM social_posts p/i, (sql, p) => {
      const now = p[0] ? new Date(p[0]).getTime() : Date.now();
      const seen = new Map();
      // The status condition is read from the statement's own text.
      const onlyQueued = /p\.status = 'queued'/.test(sql);
      for (const r of t.social_posts) {
        if ((!onlyQueued || r.status === "queued") && r.scheduled_for && new Date(r.scheduled_for).getTime() <= now) seen.set(r.partner_id, r.org_id);
      }
      return [...seen].slice(0, p[1]).map(([partner_id, org_id]) => ({ partner_id, org_id }));
    }],
    [/FROM social_posts p\s+JOIN social_channels c ON c\.id = p\.channel_id/i, (sql, p) => {
      const now = p[1] ? new Date(p[1]).getTime() : Date.now();
      return t.social_posts
        .filter((r) => r.partner_id === p[0] && r.status === "queued" && new Date(r.scheduled_for).getTime() <= now)
        .sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)))
        .slice(0, 50)
        .map((r) => {
          const c = t.social_channels.find((ch) => ch.id === r.channel_id);
          return { ...r, channel: c.channel, connection_state: c.connection_state, encrypted_access_token: c.encrypted_access_token,
            external_account_id: c.external_account_id, channel_partner_id: c.partner_id };
        });
    }],
    [/^\s*INSERT INTO action_log/i, (sql, p) => {
      const row = { id: `log-${t.action_log.length + 1}`, target_id: p[3], executed_at: null, execute_error: null, order: sent.length };
      t.action_log.push(row);
      return [{ id: row.id }];
    }],
    [/^\s*UPDATE social_posts SET status = 'posting'/i, (sql, p) => { const r = byId(p[0]); r.status = "posting"; r.attempt += 1; return []; }],
    [/^\s*UPDATE social_posts SET status = 'posted'/i, (sql, p) => {
      const r = byId(p[0]); Object.assign(r, { status: "posted", external_post_id: p[1], last_error: null }); return [];
    }],
    [/^\s*UPDATE social_posts SET status = \$2, last_error = \$3/i, (sql, p) => {
      const r = byId(p[0]); Object.assign(r, { status: p[1], last_error: p[2] }); return [];
    }],
    [/^\s*UPDATE action_log SET executed_at = now\(\), execute_error = \$2/i, (sql, p) => {
      const r = t.action_log.find((l) => l.id === p[0]); Object.assign(r, { executed_at: "now", execute_error: p[1] }); return [];
    }],
    [/^\s*UPDATE action_log SET executed_at = now\(\) WHERE id = \$1/i, (sql, p) => {
      const r = t.action_log.find((l) => l.id === p[0]); r.executed_at = "now"; return [];
    }],
    [/^\s*INSERT INTO partner_onboarding_tasks/i, (sql, p) => {
      const row = { id: `task-${t.onboarding_tasks.length + 1}`, org_id: p[0], partner_id: p[1], task_key: p[2], title: p[3], detail: p[4], severity: p[5] };
      t.onboarding_tasks.push(row);
      return [row];
    }],
    [/^\s*INSERT INTO tasks/i, (sql, p) => { t.internal_tasks.push({ org_id: p[0], title: p[2] }); return [{ id: `it-${t.internal_tasks.length}` }]; }],
  ];
}

const call = (who, body = {}, { query = {}, t = world() } = {}) => {
  sent.length = 0;
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
    assert.ok(t.action_log.every((l) => l.executed_at === "now" && l.execute_error === null));
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
    assert.equal(t.internal_tasks.length, 1);
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
