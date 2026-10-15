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
  run, req, asRole, asPartner, asClient, asAffiliate, inSql, sqlOf, writes, wrote, pinned, txTables,
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

function rulesFor(t) {
  const tx = txTables(t);
  let n = 0;
  const q = (re, fn) => [re, fn];
  return [
    ...tx.rules,
    q(/FROM marketing_content_queue\s+WHERE partner_id = \$1\s+ORDER BY created_at DESC/i, (sql, p) =>
      inSql(t.marketing_content_queue, sql, p).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 100)),
    q(/FROM partner_module_settings\s+WHERE partner_id = \$1$/i, (sql, p) => inSql(t.partner_module_settings, sql, p).slice(0, 1)),
    q(/SELECT approve_before_launch FROM partner_module_settings/i, (sql, p) => inSql(t.partner_module_settings, sql, p).slice(0, 1)),
    q(/SELECT org_id FROM partners WHERE id = \$1/i, (sql, p) => inSql(t.partners, sql, p).slice(0, 1).map((r) => ({ org_id: r.org_id }))),
    q(/^\s*SELECT \* FROM marketing_content_queue/i, (sql, p) => inSql(t.marketing_content_queue, sql, p).slice(0, 1)),
    q(/^\s*UPDATE social_posts\s+SET approved_at = now\(\)/i, (sql, p) => {
      // The guard that the post must still be held is read from the statement's own text.
      const guarded = /WHERE id = \$1 AND status = 'awaiting_approval'/.test(sql);
      const post = t.social_posts.find((r) => r.id === p[0] && (!guarded || r.status === "awaiting_approval"));
      if (!post) return [];
      Object.assign(post, { approved_at: "now", approved_by: p[1], status: "queued" });
      return [{ id: post.id, status: post.status, approved_at: post.approved_at }];
    }),
    q(/^\s*UPDATE social_posts\s+SET status = 'blocked',\s+blocked_reasons = COALESCE/i, (sql, p) => {
      const guarded = /WHERE id = \$1 AND status = 'awaiting_approval'/.test(sql);
      const post = t.social_posts.find((r) => r.id === p[0] && (!guarded || r.status === "awaiting_approval"));
      if (!post) return [];
      post.status = "blocked";
      post.blocked_reasons = [...(post.blocked_reasons || []), ...JSON.parse(p[1])];
      return [{ id: post.id, status: post.status }];
    }),
    q(/^\s*UPDATE social_posts SET status = 'blocked', blocked_reasons = \$2::jsonb/i, (sql, p) => {
      const post = t.social_posts.find((r) => r.id === p[0]);
      Object.assign(post, { status: "blocked", blocked_reasons: JSON.parse(p[1]) });
      return [{ ...post }];
    }),
    q(/^\s*UPDATE social_posts SET status = \$2 WHERE id = \$1/i, (sql, p) => {
      const post = t.social_posts.find((r) => r.id === p[0]);
      post.status = p[1];
      return [{ ...post }];
    }),
    q(/^\s*UPDATE marketing_content_queue\s+SET status = 'scheduled'/i, (sql, p) => {
      const row = t.marketing_content_queue.find((r) => r.id === p[0]);
      row.status = "scheduled";
      return [{ ...row }];
    }),
    q(/^\s*UPDATE marketing_content_queue\s+SET status = 'blocked',\s+blocked_reasons = COALESCE/i, (sql, p) => {
      const row = t.marketing_content_queue.find((r) => r.id === p[0]);
      row.status = "blocked";
      row.blocked_reasons = [...(row.blocked_reasons || []), ...JSON.parse(p[1])];
      return [{ ...row }];
    }),
    q(/^\s*UPDATE marketing_content_queue\s+SET status = 'discarded'/i, (sql, p) => {
      const row = t.marketing_content_queue.find((r) => r.id === p[0]);
      row.status = "discarded";
      return [{ ...row }];
    }),
    q(/^\s*UPDATE marketing_content_queue\s+SET status = 'queued',\s+scheduled_for = COALESCE/i, (sql, p) => {
      const row = t.marketing_content_queue.find((r) => r.id === p[0]);
      row.status = "queued";
      row.scheduled_for = p[1] || row.scheduled_for;
      return [{ ...row }];
    }),
    q(/^\s*UPDATE marketing_content_queue\s+SET status = \$2,\s+social_post_id = \$3/i, (sql, p) => {
      const row = t.marketing_content_queue.find((r) => r.id === p[0]);
      Object.assign(row, { status: p[1], social_post_id: p[2], blocked_reasons: JSON.parse(p[3]), scheduled_for: p[4] || row.scheduled_for });
      return [{ ...row }];
    }),
    q(/FROM social_channels WHERE id = \$1/i, (sql, p) => inSql(t.social_channels, sql, p).slice(0, 1)),
    q(/^\s*INSERT INTO social_posts/i, (sql, p) => {
      const row = { id: `a${++n}000000-0000-4000-8000-00000000000${n}`, org_id: p[0], partner_id: p[1], channel_id: p[2], asset_id: p[3],
        caption: p[4], offer_type: p[5], status: "draft", scheduled_for: p[6], approved_at: null, approved_by: null, blocked_reasons: [] };
      t.social_posts.push(row);
      return [{ ...row }];
    }),
    q(/FROM compliance_rules/i, (sql, p) => inSql(t.compliance_rules.map((r) => ({ ...r, org_id: ORG_ID })), "WHERE org_id = $1", p)),
    q(/^\s*INSERT INTO compliance_screenings/i, (sql, p) => {
      t.compliance_screenings.push({ org_id: p[0], partner_id: p[1], subject_id: p[2], offer_type: p[3], state: p[4], reasons: JSON.parse(p[5]) });
      return [];
    }),
  ];
}

const call = (method, who, { query = {}, body = {} } = {}, t = world()) => {
  clearRuleCache();
  return run(handler, req(method, { query, body }), [...who, ...rulesFor(t)]).then((out) => ({ ...out, t }));
};
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
    const sorted = res.body.items.map((i) => i.created_at);
    assert.deepEqual(sorted, [...sorted].sort().reverse());
    const read = sqlOf(fake, /FROM marketing_content_queue/)[0];
    assert.deepEqual(read.params, [PARTNER]);
    pinned(read.sql, "this partner, newest first, 100 at most", "WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 100");
    assert.equal(wrote(fake), false);
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
    }
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
