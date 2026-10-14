// The chat, helper and payment-ask doors that speak to a customer, run through
// the REAL handlers with a stand-in database and no network:
//
//   route:chat/messages        kind=client: staff sends a text or an email (email half)
//   route:chat/portal-message  the portal widget: save the client's note, save the reply, never text it
//   route:money/helper         POST send: the turn is saved and queued; the helper never texts
//   route:payment-links        action=send texts the checkout link; action=expire kills a live ask
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import chatMessages from "../../api/chat/messages.mjs";
import portalMessage from "../../api/chat/portal-message.mjs";
import moneyHelper from "../../api/money/helper.mjs";
import paymentLinks from "../../api/payment-links.mjs";
import {
  accountSession, fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, STAFF_ID,
} from "../testing/handler-harness.mjs";
import { queueDb } from "../pulse/catalog/proofs/s2-queue-db.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const CONVO = "cc000000-0000-4000-8000-000000000001";
const MSG = "ee000000-0000-4000-8000-000000000001";
const LINK = "9f000000-0000-4000-8000-000000000001";

const realFetch = globalThis.fetch;
const netCalls = [];
const savedKey = process.env.ANTHROPIC_API_KEY;
before(() => {
  delete process.env.ANTHROPIC_API_KEY;
  globalThis.fetch = async (url) => { netCalls.push(String(url)); throw new Error("network refused in this test"); };
});
after(() => {
  globalThis.fetch = realFetch;
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
});

async function call(handler, request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

describe("POST /api/chat/messages kind=client by email", () => {
  const clientInOrg = [/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, [{ id: CLIENT }]];
  const clientEmail = [/AS address FROM clients/, [{ address: "dana@example.test" }]];
  const convoUpsert = [/INSERT INTO conversations/, [{ id: CONVO, org_id: ORG_ID, client_id: CLIENT, channel: "email" }]];
  const msgInsert = [/INSERT INTO messages/, [{ id: MSG, created_at: "2026-10-13T17:00:00Z" }]];

  test("an email to a client is queued for the compliance gate, to their own address, with the sender named", async () => {
    netCalls.length = 0;
    const { res, fake } = await call(chatMessages, req("POST", {
      body: { kind: "client", client_id: CLIENT, channel: "email", subject: "Your file", body: "  Hi Dana, your file is ready.  " },
    }), [staffSession({ role: "owner" }), clientInOrg, clientEmail, convoUpsert, msgInsert]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.kind, "client");
    const [ins] = fake.find(/INSERT INTO messages/);
    assert.match(ins.sql, /'queued',false/);
    // org, client, conversation, channel, text, provider_ref, to, subject, sender
    assert.equal(ins.params[0], ORG_ID);
    assert.equal(ins.params[1], CLIENT);
    assert.equal(ins.params[3], "email");
    assert.equal(ins.params[4], "Hi Dana, your file is ready.");
    assert.equal(ins.params[6], "dana@example.test");
    assert.equal(ins.params[7], "Your file");
    assert.equal(ins.params[8], STAFF_ID);
    assert.equal(netCalls.length, 0);
  });
});

describe("/api/chat/portal-message", () => {
  const session = () => accountSession({ kind: "client", clientId: CLIENT });
  const convoUpsert = [/INSERT INTO conversations/, [{ id: CONVO }]];
  const client = [/SELECT first_name, custom_fields FROM clients WHERE id = \$1 AND org_id = \$2/, [{ first_name: "Dana", custom_fields: {} }]];
  const inbound = (s) => /'inbound'/.test(s);
  const insertRow = [/INSERT INTO messages/, (s) => [{ id: inbound(s) ? MSG : "ee000000-0000-4000-8000-000000000002", direction: inbound(s) ? "inbound" : "outbound" }]];
  const link = [/UPDATE messages m\s+SET conversation_id/, (_s, p) => [{ id: p[0] }]];

  test("the client's note is saved as inbound, and the reply is saved delivered so it is never texted on top", async () => {
    netCalls.length = 0;
    const { res, fake } = await call(portalMessage, req("POST", { body: { body: "  When is my call?  ", channel: "sms" } }),
      [...session(), convoUpsert, insertRow, client, link]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.conversation_id, CONVO);
    assert.equal(res.body.reply.source, "fallback");
    assert.ok(res.body.reply.text.length > 10);

    const writes = fake.find(/INSERT INTO messages/);
    assert.equal(writes.length, 2);
    const [note, reply] = writes;
    assert.match(note.sql, /'inbound'.*'received'/s);
    assert.deepEqual(note.params, [ORG_ID, CLIENT, CONVO, "sms", "When is my call?"]);
    assert.match(reply.sql, /'outbound'.*'delivered', 'internal'/s);
    assert.equal(reply.params[4], res.body.reply.text);
    // No row is written as queued: nothing in this exchange can be dispatched.
    assert.equal(writes.filter((w) => /'queued'/.test(w.sql)).length, 0);
    assert.equal(netCalls.filter((u) => /anthropic/i.test(u)).length, 0);
  });

  test("an empty note, a fax channel and a staff session are each refused with no write", async () => {
    const empty = await call(portalMessage, req("POST", { body: { body: "   " } }), [...session(), convoUpsert, insertRow]);
    assert.equal(empty.res.statusCode, 400);
    const fax = await call(portalMessage, req("POST", { body: { body: "hi", channel: "fax" } }), [...session(), convoUpsert, insertRow]);
    assert.equal(fax.res.statusCode, 400);
    const staff = await call(portalMessage, req("POST", { body: { body: "hi" } }), [staffSession({ role: "owner" }), convoUpsert, insertRow]);
    assert.equal(staff.res.statusCode, 403);
    for (const r of [empty, fax, staff]) assert.equal(r.fake.find(/INSERT INTO messages/).length, 0);
  });

  test("GET reads only the client's own thread", async () => {
    const { res, fake } = await call(portalMessage, req("GET"), [...session(), [/FROM conversations\s+WHERE org_id = \$1 AND client_id = \$2/, []]]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, conversation_id: null, messages: [] });
    assert.deepEqual(fake.find(/FROM conversations/)[0].params, [ORG_ID, CLIENT]);
  });
});

describe("POST /api/money/helper action=send", () => {
  const helperAgent = (status) => [/SELECT \* FROM agents WHERE org_id = \$1 AND code = \$2/, status
    ? [{ code: "FOS-01", name: "Money helper", status, prompt: "p", guardrails: {} }] : []];
  const bridgeOn = [/FROM agent_bridge_heartbeats/, [{ last_at: new Date().toISOString() }]];
  const noHalt = [/FROM money_helper_threads/, []];
  const noTurnsToday = [/count\(\*\)::int AS n FROM money_helper_turns/, [{ n: 0 }]];
  const turnInsert = [/INSERT INTO money_helper_turns/, (_s, p) => [{
    id: "74000000-0000-4000-8000-000000000001", org_id: p[0], client_id: p[1], kind: p[2], actor: p[3], input: p[5], status: p[7], reply: null,
  }]];
  const send = (body, rules) => call(moneyHelper, req("POST", { body }), [...accountSession({ kind: "client", clientId: CLIENT }), ...rules]);

  test("a client's message is saved as a queued turn for the helper brain and nothing is texted", async () => {
    const { res, fake } = await send({ action: "send", message: "  What is due this week?  " },
      [helperAgent("shadow"), noHalt, noTurnsToday, bridgeOn, turnInsert]);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.queued, true);
    assert.equal(res.body.turn.status, "queued");
    const [turn] = fake.find(/INSERT INTO money_helper_turns/);
    assert.deepEqual([turn.params[0], turn.params[1], turn.params[2], turn.params[3], turn.params[5], turn.params[7]],
      [ORG_ID, CLIENT, "message", "client", "What is due this week?", "queued"]);
    assert.equal(fake.find(/INSERT INTO messages/).length, 0);
  });

  test("a switched-off helper, a stopped thread, an empty message and a full day each refuse and save nothing", async () => {
    const off = await send({ action: "send", message: "hi" }, [helperAgent(null), noHalt, noTurnsToday, bridgeOn, turnInsert]);
    assert.equal(off.res.statusCode, 409);
    assert.equal(off.res.body.error, "helper_off");
    const halted = await send({ action: "send", message: "hi" },
      [helperAgent("live"), [/FROM money_helper_threads/, [{ halted_at: "2026-10-12T00:00:00Z", halt_reason: "person" }]], noTurnsToday, bridgeOn, turnInsert]);
    assert.equal(halted.res.statusCode, 409);
    assert.equal(halted.res.body.error, "helper_stopped");
    const empty = await send({ action: "send", message: "   " }, [helperAgent("live"), noHalt, noTurnsToday, bridgeOn, turnInsert]);
    assert.equal(empty.res.statusCode, 400);
    assert.equal(empty.res.body.error, "message_required");
    const full = await send({ action: "send", message: "hi" },
      [helperAgent("live"), noHalt, [/count\(\*\)::int AS n FROM money_helper_turns/, [{ n: 500 }]], bridgeOn, turnInsert]);
    assert.equal(full.res.statusCode, 429);
    assert.equal(full.res.body.error, "too_many");
    for (const r of [off, halted, empty, full]) assert.equal(r.fake.find(/INSERT INTO money_helper_turns/).length, 0);
  });

  test("an unknown action is 400", async () => {
    const { res } = await send({ action: "wire_money", message: "hi" }, [helperAgent("live"), noHalt, noTurnsToday, bridgeOn, turnInsert]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_action");
  });
});

describe("POST /api/payment-links action=send and action=expire", () => {
  const link = (over = {}) => ({
    id: LINK, org_id: ORG_ID, client_id: CLIENT, status: "created", purpose: "setup", description: "Setup fee",
    amount_cents: 49700, checkout_url: "https://pay.example.test/checkout/abc", ...over,
  });
  const TEMPLATE = { body: "Hi {{contact.first_name}}, pay {{payment_link.amount}} for {{payment_link.description}}: {{payment_link.url}}" };

  async function ask(body, { role = "owner", row = link(), template = TEMPLATE } = {}) {
    const fake = queueDb({
      templates: template ? { payment_link_notice: template } : {},
      clients: { [CLIENT]: { first_name: "Dana", last_name: "Whitfield", email: "dana@example.test", phone: "+16025550100" } },
      extra: [
        staffSession({ role }),
        [/SELECT \* FROM payment_links WHERE id = \$1 AND org_id = \$2/, (_s, p) => (row && p[0] === row.id ? [row] : [])],
        [/UPDATE payment_links\s+SET status = 'sent'/, (_s, p) => (row.status === "created" ? [{ ...row, status: "sent", sent_at: p[2] }] : [])],
        [/UPDATE payment_links\s+SET status = 'expired'/, (_s, p) => (["created", "sent"].includes(row.status) ? [{ ...row, status: "expired", expired_at: p[2] }] : [])],
      ],
    });
    const res = makeRes();
    await runWithSharedDb(fake, () => paymentLinks(req("POST", { body }), res));
    return { res, fake };
  }

  test("send texts the checkout link with the amount and marks the ask sent", async () => {
    const { res, fake } = await ask({ action: "send", id: LINK });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message_queued, true);
    assert.equal(res.body.link.status, "sent");
    assert.equal(res.body.link.amount_display, "497.00");
    const [text] = fake.state.messages;
    assert.equal(text.channel, "sms");
    assert.equal(text.template_key, "payment_link_notice");
    assert.equal(text.to_address, "+16025550100");
    assert.match(text.rendered_body, /Hi Dana, pay 497\.00 for Setup fee: https:\/\/pay\.example\.test\/checkout\/abc/);
  });

  test("an unapproved text sends nothing and the ask stays unsent", async () => {
    const { res, fake } = await ask({ action: "send", id: LINK }, { template: { ...TEMPLATE, compliance_passed: false } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message_queued, false);
    assert.equal(res.body.message_reason, "template_pending");
    assert.equal(res.body.link.status, "created");
    assert.equal(fake.state.messages.length, 0);
  });

  test("a paid or dead ask is never texted again", async () => {
    for (const status of ["paid", "expired"]) {
      const { res, fake } = await ask({ action: "send", id: LINK }, { row: link({ status }) });
      assert.equal(res.statusCode, 409, status);
      assert.match(res.body.error, new RegExp(`this link is ${status}`));
      assert.equal(fake.state.messages.length, 0, status);
    }
  });

  test("expire kills a live ask, and a paid one cannot be expired", async () => {
    const live = await ask({ action: "expire", id: LINK }, { row: link({ status: "sent" }) });
    assert.equal(live.res.statusCode, 200);
    assert.equal(live.res.body.link.status, "expired");
    assert.equal(live.fake.state.messages.length, 0);
    const paid = await ask({ action: "expire", id: LINK }, { row: link({ status: "paid" }) });
    assert.equal(paid.res.statusCode, 409);
    assert.match(paid.res.body.error, /already paid or expired/);
  });

  test("a closer can create an ask but not send or expire one", async () => {
    for (const action of ["send", "expire"]) {
      const { res, fake } = await ask({ action, id: LINK }, { role: "closer" });
      assert.equal(res.statusCode, 403, action);
      assert.equal(res.body.error, "forbidden");
      assert.equal(fake.state.messages.length, 0, action);
    }
  });
});
