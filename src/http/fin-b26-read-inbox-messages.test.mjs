// finish-853 batch 26: GET /api/read/inbox and GET /api/read/messages, the staff reply inbox's two
// reads. The real handlers run over stand-in tables. The stand-in plays the statement: what it keeps,
// its order, and what "needs a reply" means are read from the statement's own text, so a changed
// clause changes the answer and the test goes red. Practice test, fake data, no network, no database.
// Row 1 (inbox): every conversation in the company, newest first: who, channel, last message,
//   unread/answered state. Caller: staff, company from the session. Read-only.
// Row 2 (messages): one conversation's messages in both directions, or the company's blocked messages
//   (status=blocked).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import inbox from "../../api/read/inbox.mjs";
import messages from "../../api/read/messages.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, inSql, sqlOf, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, CLIENT, OTHER_CLIENT, FOREIGN_CLIENT, ALL_STAFF_ROLES, STAFF_ID,
} from "../testing/fin-b26-kit.mjs";

const CV = (n) => `cc00000${n}-0000-4000-8000-00000000000${n}`;
const MS = (n) => `dd0000${String(n).padStart(2, "0")}-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const at = (n) => `2026-10-${String(n).padStart(2, "0")}T12:00:00.000Z`;

function world({ reuseThreadId = false } = {}) {
  const t = {
    clients: [
      { id: CLIENT, org_id: ORG_ID, first_name: "Dana", last_name: "Whitfield" },
      { id: OTHER_CLIENT, org_id: ORG_ID, first_name: "Eli", last_name: "Park" },
      { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID, first_name: "Far", last_name: "Away" },
    ],
    conversations: [
      // activity: c1 spoke last on the 13th (inbound), c2 on the 12th (we answered), c3 has no messages, c5 other company.
      { id: CV(1), org_id: ORG_ID, client_id: CLIENT, channel: "sms", summary: "Asked about the card", sentiment: null, last_pulse_at: at(13), created_at: at(1) },
      { id: CV(2), org_id: ORG_ID, client_id: OTHER_CLIENT, channel: "email", summary: null, sentiment: null, last_pulse_at: at(12), created_at: at(2) },
      { id: CV(3), org_id: ORG_ID, client_id: CLIENT, channel: "sms", summary: null, sentiment: null, last_pulse_at: null, created_at: at(10) },
      { id: CV(5), org_id: OTHER_ORG_ID, client_id: FOREIGN_CLIENT, channel: "sms", summary: "foreign", sentiment: null, last_pulse_at: at(14), created_at: at(1) },
      // A thread whose client is in another company is never shown, whatever the thread's own company says.
      { id: CV(6), org_id: ORG_ID, client_id: FOREIGN_CLIENT, channel: "sms", summary: "mismatch", sentiment: null, last_pulse_at: at(5), created_at: at(1) },
    ],
    messages: [
      { id: MS(1), org_id: ORG_ID, conversation_id: CV(1), client_id: CLIENT, direction: "outbound", channel: "sms", rendered_body: "We can help.", subject: null, status: "sent", provider: "twilio", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: STAFF_ID, created_at: at(11), to_address: "+16025550100", provider_ref: "ref-1" },
      { id: MS(2), org_id: ORG_ID, conversation_id: CV(1), client_id: CLIENT, direction: "inbound", channel: "sms", rendered_body: "Can you call me?", subject: null, status: "received", provider: "twilio", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: null, created_at: at(13), to_address: "+16025550199", provider_ref: "ref-2" },
      { id: MS(3), org_id: ORG_ID, conversation_id: CV(2), client_id: OTHER_CLIENT, direction: "inbound", channel: "email", rendered_body: "Thanks", subject: "Re: plan", status: "received", provider: "resend", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: null, created_at: at(11), to_address: "x", provider_ref: "ref-3" },
      { id: MS(4), org_id: ORG_ID, conversation_id: CV(2), client_id: OTHER_CLIENT, direction: "outbound", channel: "email", rendered_body: "You're welcome", subject: "Re: plan", status: "sent", provider: "resend", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: STAFF_ID, created_at: at(12), to_address: "x", provider_ref: "ref-4" },
      { id: MS(5), org_id: ORG_ID, conversation_id: CV(1), client_id: CLIENT, direction: "outbound", channel: "sms", rendered_body: "Held for quiet hours", subject: null, status: "blocked", provider: null, blocked_reason: "quiet_hours", last_error: null, scheduled_at: at(15), sender_staff_id: STAFF_ID, created_at: at(9), to_address: "+16025550100", provider_ref: "ref-5" },
      // Another company's blocked message.
      { id: MS(7), org_id: OTHER_ORG_ID, conversation_id: CV(5), client_id: FOREIGN_CLIENT, direction: "outbound", channel: "sms", rendered_body: "foreign blocked", subject: null, status: "blocked", provider: null, blocked_reason: "opted_out", last_error: null, scheduled_at: null, sender_staff_id: null, created_at: at(14), to_address: "z", provider_ref: "ref-7" },
      { id: MS(8), org_id: ORG_ID, conversation_id: CV(2), client_id: OTHER_CLIENT, direction: "outbound", channel: "email", rendered_body: "Blocked by the gate", subject: "x", status: "blocked", provider: null, blocked_reason: "compliance", last_error: "gate said no", scheduled_at: null, sender_staff_id: null, created_at: at(8), to_address: "x", provider_ref: "ref-8" },
    ],
    staff: [{ id: STAFF_ID, name: "Olive Owner" }],
  };
  if (reuseThreadId) {
    // Another company's message that carries company A's thread id: the messages read filters on the
    // message's own company, so it must never appear for company A.
    t.messages.push({ id: MS(6), org_id: OTHER_ORG_ID, conversation_id: CV(1), client_id: FOREIGN_CLIENT, direction: "inbound", channel: "sms", rendered_body: "another company's words", subject: null, status: "received", provider: "twilio", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: null, created_at: at(14), to_address: "z", provider_ref: "ref-6" });
  }
  return t;
}

/** The newest message on a thread, in the direction the statement says. */
function lastOf(t, conversationId, newestFirst) {
  const mine = t.messages.filter((m) => m.conversation_id === conversationId);
  const sorted = [...mine].sort((a, b) => (newestFirst ? 1 : -1) * (String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id))));
  return sorted[0] || null;
}

function rulesFor(t) {
  return [
    [/WITH page AS/i, (sql, p) => {
      const [limitPlus, offset, org, needsReplyOnly] = p;
      const newestFirst = /WHERE m\.conversation_id = page\.id\s+ORDER BY m\.created_at DESC, m\.id DESC\s+LIMIT 1/.test(sql);
      const pageDesc = /ORDER BY COALESCE\(c\.last_pulse_at, c\.created_at\) DESC, c\.id DESC/.test(sql);
      const finalDesc = /ORDER BY COALESCE\(last\.created_at, page\.last_pulse_at, page\.created_at\) DESC, page\.id DESC/.test(sql);
      const spokeLast = (/\(last\.direction = '(\w+)'\)\s+AS needs_reply/.exec(sql) || [])[1];
      const filterLiteral = (/LIMIT 1\s*\)\s*=\s*'(\w+)'\)/.exec(sql) || [])[1];
      const keepsEmptyThreads = /LEFT JOIN LATERAL/.test(sql);
      const clientRequiresCompany = /cl\.org_id = \$3::uuid/.test(sql);
      const orgScoped = /WHERE c\.org_id = \$3::uuid/.test(sql);
      const cmp = (a, b) => String(a).localeCompare(String(b));
      let page = t.conversations.filter((c) => !orgScoped || c.org_id === org);
      if (needsReplyOnly === true && filterLiteral) {
        page = page.filter((c) => { const l = lastOf(t, c.id, newestFirst); return l && l.direction === filterLiteral; });
      }
      page.sort((a, b) => (pageDesc ? -1 : 1) * (cmp(a.last_pulse_at || a.created_at, b.last_pulse_at || b.created_at) || cmp(a.id, b.id)));
      page = page.slice(offset, offset + limitPlus);
      const rows = page
        .map((c) => ({ c, cl: t.clients.find((x) => x.id === c.client_id && (!clientRequiresCompany || x.org_id === org)) }))
        .filter(({ cl }) => cl)
        .filter(({ c }) => keepsEmptyThreads || lastOf(t, c.id, newestFirst))
        .map(({ c, cl }) => {
          const last = lastOf(t, c.id, newestFirst);
          return {
            id: c.id, client_id: c.client_id, channel: c.channel, summary: c.summary, sentiment: c.sentiment,
            last_pulse_at: c.last_pulse_at, created_at: c.created_at, first_name: cl.first_name, last_name: cl.last_name,
            last_message_id: last ? last.id : null, last_direction: last ? last.direction : null,
            last_body: last ? last.rendered_body : null, last_status: last ? last.status : null, last_at: last ? last.created_at : null,
            needs_reply: last ? last.direction === spokeLast : null,
            activity_at: (last && last.created_at) || c.last_pulse_at || c.created_at,
          };
        });
      return rows.sort((a, b) => (finalDesc ? -1 : 1) * (cmp(a.activity_at, b.activity_at) || cmp(a.id, b.id)));
    }],
    [/FROM messages m\s+LEFT JOIN staff s ON s\.id = m\.sender_staff_id/i, (sql, p) => {
      const blocked = /m\.status = \$4/.test(sql);
      const rows = inSql(t.messages, sql, p);
      const listed = /SELECT m\.id,[\s\S]*?FROM messages m/i.exec(sql)[0];
      return rows
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))
        .slice(p[1], p[1] + p[0])
        .map((m) => {
          const { to_address, provider_ref, ...plain } = m;
          return {
            ...plain,
            ...(/m\.to_address/.test(listed) ? { to_address } : {}),
            ...(/m\.provider_ref/.test(listed) ? { provider_ref } : {}),
            sender_name: (t.staff.find((s) => s.id === m.sender_staff_id) || {}).name || null,
            _blockedQuery: blocked,
          };
        }).map(({ _blockedQuery, ...m }) => m);
    }],
  ];
}

const getInbox = (who, query = {}, t = world()) => run(inbox, req("GET", { query }), [...who, ...rulesFor(t)]);
const getMessages = (who, query = {}, t = world({ reuseThreadId: true })) => run(messages, req("GET", { query }), [...who, ...rulesFor(t)]);

describe("GET /api/read/inbox", () => {
  test("every conversation in the company, newest activity first, with who it is, the channel, the last message and whether a reply is owed", async () => {
    const { res, fake } = await getInbox(asRole("setter"));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items.map((i) => i.id), [CV(1), CV(2), CV(3)], "newest first; another company's thread and a mismatched client are not shown");
    const [a, b, c] = res.body.items;
    assert.deepEqual([a.first_name, a.last_name, a.channel, a.last_direction, a.last_body, a.last_status, a.needs_reply],
      ["Dana", "Whitfield", "sms", "inbound", "Can you call me?", "received", true], "they spoke last: a reply is owed");
    assert.deepEqual([b.first_name, b.channel, b.last_direction, b.last_body, b.needs_reply],
      ["Eli", "email", "outbound", "You're welcome", false], "we answered: nothing owed");
    assert.equal(c.last_message_id, null, "a thread with no messages is still listed");
    assert.equal(c.last_body, null);
    assert.equal(c.needs_reply, null, "nobody spoke, so nobody is owed a reply, and it is not 'false'");
    assert.equal(a.summary, "Asked about the card");
    assert.equal(a.sentiment, null, "no guessed sentiment is passed on");
    assert.equal(res.body.hasMore, false);
    assert.equal(wrote(fake), false, "read only");
    const q = sqlOf(fake, /WITH page AS/)[0];
    assert.deepEqual(q.params, [51, 0, ORG_ID, false], "the company is the session's");
    pinned(q.sql, "this company's threads only", "WHERE c.org_id = $3::uuid");
    pinned(q.sql, "the client is joined inside this company", "JOIN clients cl ON cl.id = page.client_id AND cl.org_id = $3::uuid");
    pinned(q.sql, "the newest thread activity chooses the page", "ORDER BY COALESCE(c.last_pulse_at, c.created_at) DESC, c.id DESC LIMIT $1 OFFSET $2");
    pinned(q.sql, "the rows come back newest activity first", "ORDER BY COALESCE(last.created_at, page.last_pulse_at, page.created_at) DESC, page.id DESC");
    pinned(q.sql, "a reply is owed when they spoke last", "(last.direction = 'inbound') AS needs_reply");
    pinned(q.sql, "who it is with", "cl.first_name, cl.last_name");
  });

  test("the needs-reply tab is filtered in the database: only threads whose newest message is theirs", async () => {
    for (const value of ["1", "true"]) {
      const { res, fake } = await getInbox(asRole("closer"), { needs_reply: value });
      assert.deepEqual(res.body.items.map((i) => i.id), [CV(1)], value);
      assert.equal(sqlOf(fake, /WITH page AS/)[0].params[3], true);
    }
    for (const value of ["0", "yes", ""]) {
      const { res, fake } = await getInbox(asRole("closer"), { needs_reply: value });
      assert.equal(res.body.items.length, 3, JSON.stringify(value));
      assert.equal(sqlOf(fake, /WITH page AS/)[0].params[3], false);
    }
    const { fake } = await getInbox(asRole("closer"), { needs_reply: "1" });
    pinned(sqlOf(fake, /WITH page AS/)[0].sql, "needs reply keeps threads whose newest message is inbound",
      "AND ($4::boolean IS NOT TRUE OR (SELECT m.direction FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = 'inbound')");
  });

  test("a page is bounded: one extra row is asked for to say there is more, and it is not shown", async () => {
    const { res, fake } = await getInbox(asRole("owner"), { limit: "2" });
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.hasMore, true);
    assert.deepEqual(sqlOf(fake, /WITH page AS/)[0].params.slice(0, 2), [3, 0]);
    const second = await getInbox(asRole("owner"), { limit: "2", offset: "2" });
    assert.deepEqual(second.res.body.items.map((i) => i.id), [CV(3)]);
    assert.equal(second.res.body.hasMore, false);
  });

  test("a session with no company reads no threads; every staff role may read; nobody else may", async () => {
    const noOrg = await getInbox(asRole("owner", { org_id: null }));
    assert.equal(noOrg.res.statusCode, 200);
    assert.deepEqual(noOrg.res.body.items, [], "NULL is bound, so the read fails closed");
    assert.equal(sqlOf(noOrg.fake, /WITH page AS/)[0].params[2], null);
    const other = await getInbox(asRole("owner", { org_id: OTHER_ORG_ID }));
    assert.deepEqual(other.res.body.items.map((i) => i.id), [CV(5)], "company B reads company B's thread, not company A's");
    for (const role of ALL_STAFF_ROLES) assert.equal((await getInbox(asRole(role))).res.statusCode, 200, role);
    for (const role of ["partner", "affiliate", "viewer"]) {
      const { res, fake } = await getInbox(asRole(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(sqlOf(fake, /WITH page AS/).length, 0);
    }
    for (const who of [asPartner(PARTNER), asClient(), asAffiliate()]) {
      const { res, fake } = await getInbox(who);
      assert.ok([401, 403].includes(res.statusCode));
      assert.equal(sqlOf(fake, /WITH page AS/).length, 0);
    }
    const post = await run(inbox, req("POST", { body: {} }), [...asRole("owner"), ...rulesFor(world())]);
    assert.equal(post.res.statusCode, 405);
  });
});

describe("GET /api/read/messages", () => {
  test("one thread, both directions, newest first, with who sent each reply; no phone number or provider key leaves the door", async () => {
    const { res, fake } = await getMessages(asRole("closer"), { conversation_id: CV(1) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items.map((m) => [m.id, m.direction]), [[MS(2), "inbound"], [MS(1), "outbound"], [MS(5), "outbound"]]);
    assert.ok(res.body.items.every((m) => m.id !== MS(6)), "another company's message with the same thread id is not shown");
    const reply = res.body.items.find((m) => m.id === MS(1));
    assert.equal(reply.sender_name, "Olive Owner");
    assert.equal(reply.rendered_body, "We can help.");
    assert.equal(res.body.items.find((m) => m.id === MS(2)).sender_name, null, "an inbound message has no person who sent it");
    const held = res.body.items.find((m) => m.id === MS(5));
    assert.deepEqual([held.status, held.blocked_reason, held.scheduled_at], ["blocked", "quiet_hours", at(15)], "a held reply says that it was held, and why");
    for (const m of res.body.items) {
      assert.equal("to_address" in m, false);
      assert.equal("provider_ref" in m, false);
    }
    assert.doesNotMatch(JSON.stringify(res.body), /\+1602555|ref-\d/);
    const q = sqlOf(fake, /FROM messages m/)[0];
    assert.deepEqual(q.params, [51, 0, CV(1), ORG_ID]);
    pinned(q.sql, "this company's messages of this thread", "WHERE m.org_id = $4::uuid AND m.conversation_id = $3");
    pinned(q.sql, "newest first", "ORDER BY m.created_at DESC, m.id DESC LIMIT $1 OFFSET $2");
    assert.doesNotMatch(q.sql, /to_address|provider_ref/);
    assert.equal(wrote(fake), false);
  });

  test("an unknown thread is an empty answer, not a 404; the thread id is required and must be a uuid", async () => {
    const empty = await getMessages(asRole("owner"), { conversation_id: "cc0000ff-0000-4000-8000-0000000000ff" });
    assert.equal(empty.res.statusCode, 200);
    assert.deepEqual(empty.res.body.items, []);
    for (const query of [{}, { conversation_id: "not-a-uuid" }, { status: "queued" }, { status: "sent", conversation_id: "x" }]) {
      const { res, fake } = await getMessages(asRole("owner"), query);
      assert.equal(res.statusCode, 400, JSON.stringify(query));
      assert.equal(res.body.error, "invalid_parameter");
      assert.equal(sqlOf(fake, /FROM messages/).length, 0, "a forgotten parameter never becomes 'every message in the company'");
    }
  });

  test("status=blocked lists this company's blocked messages, newest first, across threads", async () => {
    const { res, fake } = await getMessages(asRole("csm"), { status: "blocked" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items.map((m) => m.id), [MS(5), MS(8)], "this company's two blocked messages, newest first");
    assert.ok(res.body.items.every((m) => m.status === "blocked" && m.id !== MS(7)));
    assert.deepEqual(res.body.items.map((m) => m.blocked_reason), ["quiet_hours", "compliance"]);
    assert.equal(res.body.items[1].last_error, "gate said no");
    const q = sqlOf(fake, /FROM messages m/)[0];
    assert.deepEqual(q.params, [51, 0, ORG_ID, "blocked"]);
    pinned(q.sql, "this company, blocked only", "WHERE m.org_id = $3::uuid AND m.status = $4");
  });

  test("a session with no company reads no messages; the same roles and the same refusals as the inbox", async () => {
    const noOrg = await getMessages(asRole("owner", { org_id: null }), { conversation_id: CV(1) });
    assert.deepEqual(noOrg.res.body.items, []);
    const noOrgBlocked = await getMessages(asRole("owner", { org_id: null }), { status: "blocked" });
    assert.deepEqual(noOrgBlocked.res.body.items, []);
    const other = await getMessages(asRole("owner", { org_id: OTHER_ORG_ID }), { conversation_id: CV(1) });
    assert.deepEqual(other.res.body.items.map((m) => m.id), [MS(6)], "company B reads only company B's message on that id");
    for (const role of ALL_STAFF_ROLES) assert.equal((await getMessages(asRole(role), { conversation_id: CV(1) })).res.statusCode, 200, role);
    for (const role of ["partner", "affiliate", "viewer"]) {
      const { res, fake } = await getMessages(asRole(role), { conversation_id: CV(1) });
      assert.equal(res.statusCode, 403, role);
      assert.equal(sqlOf(fake, /FROM messages/).length, 0);
    }
    for (const who of [asPartner(PARTNER), asClient(), asAffiliate()]) {
      const { res } = await getMessages(who, { conversation_id: CV(1) });
      assert.ok([401, 403].includes(res.statusCode));
    }
    const nobody = await run(messages, req("GET", { query: { conversation_id: CV(1) } }), rulesFor(world({ reuseThreadId: true })));
    assert.equal(nobody.res.statusCode, 401);
  });

  test("a page of messages is bounded and says if there are more", async () => {
    const { res } = await getMessages(asRole("owner"), { conversation_id: CV(1), limit: "2" });
    assert.deepEqual(res.body.items.map((m) => m.id), [MS(2), MS(1)]);
    assert.equal(res.body.hasMore, true);
  });
});
