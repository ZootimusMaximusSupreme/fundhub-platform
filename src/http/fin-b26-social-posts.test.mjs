// finish-853 batch 26: GET and POST /api/social/posts. The real handler, the real sign-in and role
// gates, the real scheduler (src/social/scheduler.mjs) and the real compliance screen
// (src/compliance/screen.mjs) run over stand-in tables that answer by the conditions each statement
// names. A BEGIN is snapshotted and a ROLLBACK restores it, so "nothing changed" is judged honestly.
// Practice test, fake data, no network, no database. Nothing is sent: no adapter is called.
// Row 1 (POST): queue / schedule / approve / reject / discard a social post. Approve and reject are
//   owner or admin staff only; a post goes public when scheduled.
// Row 2 (GET): Social Studio queue read: the partner's queued, held, scheduled posts with blocked reasons.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/social/posts.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";
import {
  cleanSql, selectList, projectRow, orderRows, orderOf, whereOf, keep, runUpdate, runInsert,
} from "../testing/fin-b26-sql.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, sqlOf, writes, wrote, pinned, txTables,
  ORG_ID, OTHER_ORG_ID, PARTNER, OTHER_PARTNER, FOREIGN_PARTNER, ALL_STAFF_ROLES, STAFF_ID,
} from "../testing/fin-b26-kit.mjs";

const CHANNEL = "d1000000-0000-4000-8000-000000000001";
const Q = (n) => `e${n}000000-0000-4000-8000-00000000000${n}`;
const POST = (n) => `f${n}000000-0000-4000-8000-00000000000${n}`;
const REFUSAL = "refused_by_a_person";
let seq = 0;

const queueRow = (id, partner, over = {}) => ({
  id, org_id: ORG_ID, partner_id: partner, caption: "Ask us how repair works", offer_type: "funding",
  scheduled_for: "2026-10-20T16:00:00.000Z", status: "draft", social_post_id: null, blocked_reasons: [],
  created_at: `2026-10-0${1 + (seq++ % 8)}T00:00:00.000Z`, updated_at: "2026-10-01T00:00:00.000Z", ...over,
});

function world(over = {}) {
  const t = {
    marketing_content_queue: [
      queueRow(Q(1), PARTNER),
      queueRow(Q(2), PARTNER, { status: "awaiting_approval", social_post_id: POST(2), blocked_reasons: [{ code: "human_approval_required_setting" }] }),
      queueRow(Q(3), PARTNER, { status: "awaiting_approval", social_post_id: null }),
      queueRow(Q(4), PARTNER, { status: "blocked", blocked_reasons: [{ code: "banned_phrase", message: "no guarantees" }] }),
      queueRow(Q(5), OTHER_PARTNER, { status: "queued" }),
      queueRow(Q(6), FOREIGN_PARTNER, { org_id: OTHER_ORG_ID, status: "awaiting_approval", social_post_id: POST(6) }),
      queueRow(Q(7), PARTNER, { status: "scheduled", social_post_id: POST(7) }),
    ],
    social_posts: [
      { id: POST(2), org_id: ORG_ID, partner_id: PARTNER, status: "awaiting_approval", approved_at: null, approved_by: null, blocked_reasons: [{ code: "human_approval_required_setting" }] },
      { id: POST(6), org_id: OTHER_ORG_ID, partner_id: FOREIGN_PARTNER, status: "awaiting_approval", approved_at: null, approved_by: null, blocked_reasons: [] },
      { id: POST(7), org_id: ORG_ID, partner_id: PARTNER, status: "queued", approved_at: null, approved_by: null, blocked_reasons: [] },
    ],
    social_channels: [{ id: CHANNEL, org_id: ORG_ID, partner_id: PARTNER, channel: "facebook", connection_state: "active", best_times: {}, timezone: "America/Phoenix" }],
    partner_module_settings: [
      { org_id: ORG_ID, partner_id: PARTNER, marketing_suite_enabled: true, ai_token_cap_monthly: null, approve_before_launch: true },
      { org_id: ORG_ID, partner_id: OTHER_PARTNER, marketing_suite_enabled: true, ai_token_cap_monthly: null, approve_before_launch: true },
      { org_id: OTHER_ORG_ID, partner_id: FOREIGN_PARTNER, marketing_suite_enabled: true, ai_token_cap_monthly: null, approve_before_launch: true },
    ],
    partners: [
      { id: PARTNER, org_id: ORG_ID }, { id: OTHER_PARTNER, org_id: ORG_ID }, { id: FOREIGN_PARTNER, org_id: OTHER_ORG_ID },
    ],
    compliance_rules: [
      { rule_set: "claims", rule_key: "no-guarantees", offer_types: [], platforms: [], match_type: "phrase",
        pattern: "guaranteed approval", severity: "block", message: "No approval guarantees.", citation: null },
    ],
    compliance_screenings: [],
    ...over,
  };
  return t;
}

/**
 * The statements, answered by reading them: every WHERE as written (so a guard such as "AND status =
 * 'awaiting_approval'" is a real condition), every UPDATE's SET list and RETURNING list, every INSERT's
 * column list, and the named columns of the queue read. Nothing about a stored status, an approver or
 * a returned row is written by hand here.
 */
function rulesFor(t, { settingsVanish = false } = {}) {
  const tx = txTables(t);
  let n = 0;
  const q = (re, fn) => [re, fn];
  const project = (table, sql, p, rows) => {
    const items = selectList(sql, 0);
    return rows.map((r) => projectRow(items, { params: p, row: r, rows: { [table]: r } }));
  };
  const select = (table, rows) => (sql, p) =>
    project(table, sql, p, keep(rows, whereOf(sql), p, { alias: table }).slice(0, 1));
  return [
    ...tx.rules,
    q(/FROM marketing_content_queue\s+WHERE partner_id = \$1\s+ORDER BY created_at DESC/i, (sql, p) => {
      const limit = Number(/LIMIT (\d+)/i.exec(cleanSql(sql))[1]);
      const kept = keep(t.marketing_content_queue, whereOf(sql), p, { alias: "marketing_content_queue" });
      const ordered = orderRows(kept, orderOf(sql), (r) => ({ row: r }));
      return project("marketing_content_queue", sql, p, ordered.slice(0, limit));
    }),
    q(/SELECT marketing_suite_enabled[\s\S]*FROM partner_module_settings\s+WHERE partner_id = \$1$/i, select("partner_module_settings", t.partner_module_settings)),
    // settingsVanish plays a race honestly: the row the suite check read is gone by the time the scheduler reads it.
    q(/SELECT approve_before_launch FROM partner_module_settings/i, settingsVanish ? [] : select("partner_module_settings", t.partner_module_settings)),
    q(/SELECT org_id FROM partners WHERE id = \$1/i, select("partners", t.partners)),
    q(/^\s*SELECT \* FROM marketing_content_queue/i, select("marketing_content_queue", t.marketing_content_queue)),
    q(/^\s*UPDATE social_posts\b/i, (sql, p) => runUpdate(sql, p, t.social_posts)),
    q(/^\s*UPDATE marketing_content_queue\b/i, (sql, p) => runUpdate(sql, p, t.marketing_content_queue)),
    q(/FROM social_channels WHERE id = \$1/i, select("social_channels", t.social_channels)),
    q(/^\s*INSERT INTO social_posts/i, (sql, p) => runInsert(sql, p, t.social_posts, {
      fill: (row) => ({ approved_at: null, approved_by: null, blocked_reasons: [], ...row, id: `a${++n}000000-0000-4000-8000-00000000000${n}` }),
    }).rows),
    q(/FROM compliance_rules/i, (sql, p) => keep(t.compliance_rules.map((r) => ({ ...r, org_id: ORG_ID })), "org_id = $1", p)),
    q(/^\s*INSERT INTO compliance_screenings/i, (sql, p) => runInsert(sql, p, t.compliance_screenings).rows),
  ];
}

const call = (method, who, { query = {}, body = {} } = {}, t = world(), opts = {}) => {
  clearRuleCache();
  return run(handler, req(method, { query, body }), [...who, ...rulesFor(t, opts)]).then((out) => ({ ...out, t }));
};
/** The identity every statement of a call ran as: what set_config stamped as the actor and as the partner. */
const ranAs = (fake) => ({
  actors: fake.calls.filter((c) => /set_config\('fundhub\.actor'/.test(c.sql)).map((c) => c.params[0]),
  partners: fake.calls.filter((c) => /set_config\('fundhub\.partner_id'/.test(c.sql)).map((c) => c.params[0]),
});
const find = (t, table, id) => t[table].find((r) => r.id === id);
const owner = asRole("owner");

describe("GET /api/social/posts (the queue read)", () => {
  test("a partner reads their own queue, newest first: queued, held, scheduled, with blocked reasons", async () => {
    const { res, fake } = await call("GET", asPartner(PARTNER));
    assert.equal(res.statusCode, 200);
    const ids = res.body.items.map((i) => i.id);
    assert.deepEqual([...ids].sort(), [Q(1), Q(2), Q(3), Q(4), Q(7)].sort(), "this partner's items only");
    assert.equal(ids.includes(Q(5)) || ids.includes(Q(6)), false, "another partner's and another company's posts are not shown");
    const byId = Object.fromEntries(res.body.items.map((i) => [i.id, i]));
    assert.equal(byId[Q(2)].status, "awaiting_approval");
    assert.deepEqual(byId[Q(2)].blocked_reasons, [{ code: "human_approval_required_setting" }]);
    assert.equal(byId[Q(4)].status, "blocked");
    assert.equal(byId[Q(4)].blocked_reasons[0].message, "no guarantees");
    assert.equal(byId[Q(7)].status, "scheduled");
    assert.equal(byId[Q(7)].social_post_id, POST(7));
    // Every named column is read from the statement's own SELECT list.
    assert.deepEqual([byId[Q(1)].caption, byId[Q(1)].offer_type, byId[Q(1)].scheduled_for, byId[Q(1)].social_post_id],
      ["Ask us how repair works", "funding", "2026-10-20T16:00:00.000Z", null]);
    assert.ok(res.body.items.every((i) => i.created_at && i.updated_at && i.id && i.status));
    assert.deepEqual(byId[Q(1)].blocked_reasons, [], "a held-for-nothing draft has an empty reasons list, not a missing one");
    const sorted = res.body.items.map((i) => i.created_at);
    assert.deepEqual(sorted, [...sorted].sort().reverse());
    const read = sqlOf(fake, /FROM marketing_content_queue/)[0];
    assert.deepEqual(read.params, [PARTNER]);
    pinned(read.sql, "this partner, newest first, 100 at most", "WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 100");
    assert.equal(wrote(fake), false);
    // The read runs inside that partner's own scope: stamped as a partner, bound to the partner's id.
    assert.deepEqual(ranAs(fake), { actors: ["partner"], partners: [PARTNER] }, "row-level security sees a partner, not staff");
  });

  test("a staff member reading a partner's queue runs as that partner, not as staff with the keys to every row", async () => {
    const { res, fake } = await call("GET", asRole("closer"), { query: { partner_id: OTHER_PARTNER } });
    assert.deepEqual(res.body.items.map((i) => i.id), [Q(5)]);
    assert.deepEqual(ranAs(fake), { actors: ["partner"], partners: [OTHER_PARTNER] });
  });

  test("a long queue reads the newest hundred and no more", async () => {
    const t = world();
    for (let k = 0; k < 120; k += 1) {
      t.marketing_content_queue.push(queueRow(`b${String(k).padStart(7, "0")}-0000-4000-8000-000000000000`, PARTNER, {
        created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, k)).toISOString(),
      }));
    }
    const { res } = await call("GET", asPartner(PARTNER), {}, t);
    assert.equal(res.body.items.length, 100, "a hundred rows, not the whole table");
    const times = res.body.items.map((i) => i.created_at);
    assert.deepEqual(times, [...times].sort().reverse(), "newest first");
    assert.ok(res.body.items.every((i) => i.created_at >= "2026-09-01T00:00:20.000Z" || i.created_at.startsWith("2026-10")), "the oldest twenty-plus fall off the end");
  });

  test("a partner is pinned to their own id; staff name a partner; a client, an affiliate and nobody are refused", async () => {
    const pinnedRead = await call("GET", asPartner(PARTNER), { query: { partner_id: OTHER_PARTNER } });
    assert.ok(pinnedRead.res.body.items.every((i) => i.id !== Q(5)));
    assert.deepEqual(sqlOf(pinnedRead.fake, /FROM marketing_content_queue/)[0].params, [PARTNER]);

    const none = await call("GET", owner);
    assert.equal(none.res.statusCode, 400);
    assert.equal(none.res.body.error, "partner_id_required");
    const named = await call("GET", asRole("closer"), { query: { partner_id: OTHER_PARTNER } });
    assert.deepEqual(named.res.body.items.map((i) => i.id), [Q(5)]);

    for (const who of [asClient(), asAffiliate()]) {
      const { res, fake } = await call("GET", who, { query: { partner_id: PARTNER } });
      assert.equal(res.statusCode, 403);
      assert.equal(sqlOf(fake, /FROM marketing_content_queue/).length, 0);
    }
    const nobody = await run(handler, req("GET", { query: { partner_id: PARTNER } }), rulesFor(world()));
    assert.equal(nobody.res.statusCode, 401);
  });
});

describe("POST /api/social/posts", () => {
  test("discard throws a draft away and touches nothing else", async () => {
    const { res, t, fake } = await call("POST", asPartner(PARTNER), { body: { id: Q(1), action: "discard" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.item.status, "discarded");
    assert.equal(find(t, "marketing_content_queue", Q(1)).status, "discarded");
    assert.equal(t.social_posts.length, 3, "no post was made");
    assert.equal(writes(fake).length, 1);
    assert.deepEqual(ranAs(fake), { actors: ["partner"], partners: [PARTNER] }, "the write runs inside the partner's own scope");
  });

  test("queue with no account puts the draft in the queue with the new send time and makes no post", async () => {
    const { res, t, fake } = await call("POST", asPartner(PARTNER), { body: { id: Q(1), scheduled_for: "2026-11-01T17:00:00.000Z" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.item.status, "queued");
    assert.equal(find(t, "marketing_content_queue", Q(1)).scheduled_for, "2026-11-01T17:00:00.000Z");
    assert.equal(t.social_posts.length, 3);
    assert.equal(sqlOf(fake, /INSERT INTO social_posts/).length, 0);
    assert.deepEqual(sqlOf(fake, /FROM marketing_content_queue\s+WHERE id/)[0].params, [Q(1), PARTNER, null]);
  });

  test("scheduling to an account: a clean post lands queued for the sender when the partner needs no approval", async () => {
    const t = world();
    t.partner_module_settings.find((r) => r.partner_id === PARTNER).approve_before_launch = false;
    const { res, fake } = await call("POST", asPartner(PARTNER), { body: { id: Q(1), channel_id: CHANNEL } }, t);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.item.status, "scheduled");
    const post = t.social_posts.at(-1);
    assert.equal(post.status, "queued", "queued is the one status the publisher picks up");
    assert.equal(post.channel_id, CHANNEL);
    assert.equal(post.caption, "Ask us how repair works");
    assert.equal(res.body.item.social_post_id, post.id);
    assert.deepEqual(t.compliance_screenings.map((s) => s.state), ["passed"]);
    assert.equal(t.compliance_screenings[0].subject_id, post.id);
    const inserted = sqlOf(fake, /INSERT INTO social_posts/)[0];
    assert.deepEqual([inserted.params[0], inserted.params[1]], [ORG_ID, PARTNER], "the company is the partner's own company");
    // What the post and its screening record say about it.
    assert.equal(post.offer_type, "funding", "the post carries the offer it was written for");
    assert.equal(post.scheduled_for, "2026-10-20T16:00:00.000Z", "the send time the queue row already had");
    const screening = t.compliance_screenings[0];
    assert.deepEqual(
      [screening.org_id, screening.partner_id, screening.subject_type, screening.offer_type, screening.state, screening.screened_text],
      [ORG_ID, PARTNER, "social_post", "funding", "passed", "Ask us how repair works"],
      "the screening record names who, what, the offer, the verdict and the exact words that were screened");
    assert.deepEqual(screening.reasons, [], "a clean post has no reasons");
    assert.deepEqual(ranAs(fake), { actors: ["partner"], partners: [PARTNER] });
  });

  test("scheduling keeps the send time the person chose: the post and the queue row both carry it", async () => {
    const t = world();
    t.partner_module_settings.find((r) => r.partner_id === PARTNER).approve_before_launch = false;
    const when = "2026-11-03T15:30:00.000Z";
    const { res, fake } = await call("POST", asPartner(PARTNER), { body: { id: Q(1), channel_id: CHANNEL, scheduled_for: when } }, t);
    assert.equal(res.statusCode, 200);
    const post = t.social_posts.at(-1);
    assert.equal(post.scheduled_for, when, "the chosen time, not the one the draft had (2026-10-20)");
    assert.equal(find(t, "marketing_content_queue", Q(1)).scheduled_for, when, "the screen row says the same time");
    assert.equal(res.body.item.scheduled_for, when);
    assert.equal(sqlOf(fake, /INSERT INTO social_posts/)[0].params[6], when);
  });

  test("with no time on the draft and none chosen, the post takes the channel's next slot: in the future, on a configured time", async () => {
    const t = world();
    t.partner_module_settings.find((r) => r.partner_id === PARTNER).approve_before_launch = false;
    find(t, "marketing_content_queue", Q(1)).scheduled_for = null;
    t.social_channels[0].best_times = Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, ["21:41", "03:07"]]));
    const before = Date.now();
    const { res } = await call("POST", asPartner(PARTNER), { body: { id: Q(1), channel_id: CHANNEL } }, t);
    assert.equal(res.statusCode, 200);
    const post = t.social_posts.at(-1);
    const when = new Date(post.scheduled_for);
    assert.ok(Number.isFinite(when.getTime()), `a real time, got ${post.scheduled_for}`);
    assert.ok(when.getTime() > before, "a slot still to come, never one that has already gone");
    assert.ok(when.getTime() - before <= 19 * 3600e3, "the next one: slots are at most 18 hours apart");
    assert.ok(["03:07:00", "21:41:00"].includes(when.toISOString().slice(11, 19)), `on one of the configured times, got ${when.toISOString()}`);
    assert.equal(find(t, "marketing_content_queue", Q(1)).scheduled_for, null, "the draft itself is left without a time");
    assert.equal(post.status, "queued");
  });

  test("if the partner's settings row is gone when the post is screened, the post is held for a person, never published", async () => {
    const t = world();
    const { res } = await call("POST", asPartner(PARTNER), { body: { id: Q(1), channel_id: CHANNEL } }, t, { settingsVanish: true });
    assert.equal(res.statusCode, 200);
    assert.equal(t.social_posts.at(-1).status, "awaiting_approval", "no setting on file means a person looks first");
    assert.equal(res.body.item.status, "awaiting_approval");
    assert.equal(t.social_posts.some((p) => p.status === "queued" && p.caption === "Ask us how repair works"), false);
  });

  test("scheduling a post the setting holds for a person makes it awaiting approval, and says so on the queue", async () => {
    const { res, t } = await call("POST", asPartner(PARTNER), { body: { id: Q(1), channel_id: CHANNEL } });
    assert.equal(res.statusCode, 200);
    assert.equal(t.social_posts.at(-1).status, "awaiting_approval");
    assert.equal(res.body.item.status, "awaiting_approval");
    assert.equal(res.body.item.social.state, "needs_approval");
    assert.equal(res.body.item.blocked_reasons.some((r) => r.code === "human_approval_required_setting"), true);
  });

  test("a post with a banned phrase is stored blocked, with the reason, and never reaches the sender", async () => {
    const t = world();
    find(t, "marketing_content_queue", Q(1)).caption = "Guaranteed approval for everyone";
    const { res } = await call("POST", asPartner(PARTNER), { body: { id: Q(1), channel_id: CHANNEL } }, t);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.item.status, "blocked");
    assert.equal(t.social_posts.at(-1).status, "blocked");
    assert.equal(res.body.item.blocked_reasons[0].code, "no-guarantees");
    assert.equal(t.social_posts.some((p) => p.status === "queued" && p.caption === "Guaranteed approval for everyone"), false);
    // The post itself keeps the reasons it was stopped for, and so does the screening record.
    const stored = t.social_posts.at(-1);
    assert.deepEqual(stored.blocked_reasons.map((r) => r.code), ["no-guarantees"], "the reasons are on the post, not only on the screen row");
    assert.equal(stored.blocked_reasons[0].message, "No approval guarantees.");
    const screening = t.compliance_screenings.at(-1);
    assert.deepEqual([screening.state, screening.subject_id, screening.offer_type, screening.screened_text],
      ["blocked", stored.id, "funding", "Guaranteed approval for everyone"], "the words that were screened are kept");
    assert.deepEqual(screening.reasons.map((r) => r.code), ["no-guarantees"]);
    assert.equal(t.social_posts.at(-1).offer_type, "funding");
  });

  test("an owner or an admin approves a held post: it is signed, queued for the sender, and the screen row follows", async () => {
    for (const role of ["owner", "admin"]) {
      const t = world();
      const { res, fake } = await call("POST", asRole(role), { query: { partner_id: PARTNER }, body: { id: Q(2), action: "approve" } }, t);
      assert.equal(res.statusCode, 200, role);
      const post = find(t, "social_posts", POST(2));
      assert.equal(post.status, "queued", role);
      assert.equal(post.approved_by, STAFF_ID, "who approved it is on the post");
      assert.ok(post.approved_at);
      assert.equal(find(t, "marketing_content_queue", Q(2)).status, "scheduled", role);
      assert.equal(res.body.item.status, "scheduled");
      const lookup = sqlOf(fake, /FROM marketing_content_queue\s+WHERE id/)[0];
      assert.deepEqual(lookup.params, [Q(2), PARTNER, ORG_ID], "the caller's own company is bound on an approval");
      assert.equal(res.body.item.id, Q(2), "the answer is the queue row that was approved");
      assert.deepEqual(ranAs(fake), { actors: ["partner"], partners: [PARTNER] }, `${role}: runs inside the named partner's scope`);
    }
    // A company id sent in the address or the body is never the company that is bound.
    const hostile = world();
    const sneaky = await call("POST", owner, { query: { partner_id: PARTNER, org_id: OTHER_ORG_ID }, body: { id: Q(2), action: "approve", org_id: OTHER_ORG_ID } }, hostile);
    assert.equal(sneaky.res.statusCode, 200);
    assert.deepEqual(sqlOf(sneaky.fake, /FROM marketing_content_queue\s+WHERE id/)[0].params, [Q(2), PARTNER, ORG_ID]);
  });

  test("a refusal blocks the post for good and writes the reason a person gave it, keeping the old reasons", async () => {
    const t = world();
    const { res } = await call("POST", owner, { query: { partner_id: PARTNER }, body: { id: Q(2), action: "reject" } }, t);
    assert.equal(res.statusCode, 200);
    const post = find(t, "social_posts", POST(2));
    assert.equal(post.status, "blocked");
    assert.deepEqual(post.blocked_reasons.map((r) => r.code), ["human_approval_required_setting", REFUSAL]);
    const row = find(t, "marketing_content_queue", Q(2));
    assert.equal(row.status, "blocked");
    assert.deepEqual(row.blocked_reasons.map((r) => r.code), ["human_approval_required_setting", REFUSAL]);
    assert.match(row.blocked_reasons[1].message, /read this post and refused it/);
  });

  test("approve and reject are owner or admin only: every other staff role and the partner themselves are refused and nothing changes", async () => {
    const others = ALL_STAFF_ROLES.filter((r) => r !== "owner" && r !== "admin");
    for (const action of ["approve", "reject"]) {
      for (const role of others) {
        const t = world();
        const { res, fake } = await call("POST", asRole(role), { query: { partner_id: PARTNER }, body: { id: Q(2), action } }, t);
        assert.equal(res.statusCode, 403, `${role} ${action}`);
        assert.equal(wrote(fake), false, `${role} ${action}`);
        assert.equal(find(t, "social_posts", POST(2)).status, "awaiting_approval");
      }
      const t = world();
      const own = await call("POST", asPartner(PARTNER), { body: { id: Q(2), action } }, t);
      assert.equal(own.res.statusCode, 403, `partner ${action}`);
      assert.match(own.res.body.message, /cannot approve your own|Only Fundhub/);
      assert.equal(wrote(own.fake), false);
      assert.equal(find(t, "marketing_content_queue", Q(2)).status, "awaiting_approval");
    }
  });

  test("another company's held post cannot be approved or refused by this company's owner; it reads as not found", async () => {
    for (const action of ["approve", "reject"]) {
      const t = world();
      const { res, fake } = await call("POST", owner, { query: { partner_id: FOREIGN_PARTNER }, body: { id: Q(6), action } }, t);
      assert.equal(res.statusCode, 404, action);
      assert.equal(res.body.error, "not_found");
      assert.equal(wrote(fake), false);
      assert.equal(find(t, "social_posts", POST(6)).status, "awaiting_approval");
    }
    const noOrg = await call("POST", asRole("owner", { org_id: null }), { query: { partner_id: PARTNER }, body: { id: Q(2), action: "approve" } });
    assert.equal(noOrg.res.statusCode, 403);
    assert.equal(noOrg.res.body.error, "no_org_scope");
    assert.equal(wrote(noOrg.fake), false);
  });

  test("a post that is no longer held, or was moved by someone else mid-write, is a 409 and nothing changes", async () => {
    const notHeld = world();
    const a = await call("POST", owner, { query: { partner_id: PARTNER }, body: { id: Q(7), action: "approve" } }, notHeld);
    assert.equal(a.res.statusCode, 409);
    assert.equal(a.res.body.error, "not_held");
    assert.equal(wrote(a.fake), false);

    // The screen row says held, but the post itself was moved between the read and the write.
    for (const action of ["approve", "reject"]) {
      const raced = world();
      find(raced, "social_posts", POST(2)).status = "queued";
      const b = await call("POST", owner, { query: { partner_id: PARTNER }, body: { id: Q(2), action } }, raced);
      assert.equal(b.res.statusCode, 409, action);
      assert.equal(find(raced, "marketing_content_queue", Q(2)).status, "awaiting_approval", `${action}: the screen row is not changed when the post was not`);
      assert.equal(find(raced, "social_posts", POST(2)).status, "queued");
      assert.ok(b.fake.calls.some((c) => /^\s*ROLLBACK/.test(c.sql)), "the write was rolled back");
    }

    const noPost = await call("POST", owner, { query: { partner_id: PARTNER }, body: { id: Q(3), action: "approve" } });
    assert.equal(noPost.res.statusCode, 409);
    assert.equal(noPost.res.body.error, "no_post");
  });

  test("a partner can act only on their own queue: another partner's item and a missing id are refused", async () => {
    const other = await call("POST", asPartner(PARTNER), { body: { id: Q(5), action: "discard", partner_id: OTHER_PARTNER } });
    assert.equal(other.res.statusCode, 404);
    assert.equal(wrote(other.fake), false);
    const noId = await call("POST", asPartner(PARTNER), { body: { action: "discard" } });
    assert.equal(noId.res.statusCode, 400);
    assert.equal(noId.res.body.error, "id_required");
    const noPartner = await call("POST", owner, { body: { id: Q(1), action: "discard" } });
    assert.equal(noPartner.res.statusCode, 400);
    assert.equal(noPartner.res.body.error, "partner_id_required");
  });

  test("a partner whose marketing suite is off cannot queue, schedule or discard", async () => {
    const t = world();
    t.partner_module_settings.find((r) => r.partner_id === PARTNER).marketing_suite_enabled = false;
    const { res, fake } = await call("POST", asPartner(PARTNER), { body: { id: Q(1), channel_id: CHANNEL } }, t);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "suite_off");
    assert.equal(wrote(fake), false);
  });

  test("a client, an affiliate and nobody are refused; other verbs are 405", async () => {
    for (const who of [asClient(), asAffiliate()]) {
      const { res, fake } = await call("POST", who, { body: { id: Q(1), action: "discard", partner_id: PARTNER } });
      assert.equal(res.statusCode, 403);
      assert.equal(wrote(fake), false);
    }
    const put = await call("PUT", asPartner(PARTNER), { body: { id: Q(1) } });
    assert.equal(put.res.statusCode, 405);
    assert.equal(put.res.headers.allow, "GET, POST");
  });
});
