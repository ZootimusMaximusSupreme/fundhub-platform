// The staff chat widget and the client portal chat widget, run through the REAL
// handlers with a stand-in database and no network:
//
//   route:chat/messages        kind=client: staff sends a text or an email, through the compliance gate
//   route:chat/portal-message  the portal widget: save the client's note, save the reply, never text it
//
// The helper and the payment-ask doors are in s2-message-routes-money.test.mjs.
import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";

import chatMessages from "../../api/chat/messages.mjs";
import portalMessage from "../../api/chat/portal-message.mjs";
import {
  accountSession, makeRes, req, runWithSharedDb, staffSession, ORG_ID, OTHER_ORG_ID, STAFF_ID,
} from "../testing/handler-harness.mjs";
import { queueDb } from "../pulse/catalog/proofs/s2-queue-db.mjs";
import {
  call, clientIn, refuseNetwork, CLIENT, DANA, STAFF_ROLES,
} from "../pulse/catalog/proofs/s2-route-kit.mjs";
import { recorded, reset } from "../messaging/providers/memory.mjs";

const CONVO = "cc000000-0000-4000-8000-000000000001";
const MSG = "ee000000-0000-4000-8000-000000000001";

const netCalls = refuseNetwork({ before, after });
const savedKey = process.env.ANTHROPIC_API_KEY;
before(() => { delete process.env.ANTHROPIC_API_KEY; });
after(() => { if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey; });

describe("POST /api/chat/messages kind=client", () => {
  const clientInOrg = clientIn(/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, { id: CLIENT });
  const clientAddress = [/AS address FROM clients/, (_s, p) => [{ address: p[0] === CLIENT ? (/SELECT phone/.test(_s) ? DANA.phone : DANA.email) : null }]];
  const convoUpsert = [/INSERT INTO conversations/, [{ id: CONVO, org_id: ORG_ID, client_id: CLIENT, channel: "email" }]];
  const msgInsert = [/INSERT INTO messages/, [{ id: MSG, created_at: "2026-10-13T17:00:00Z" }]];
  const send = (body, role = "owner", org_id = ORG_ID) => call(chatMessages, req("POST", { body: { kind: "client", client_id: CLIENT, ...body } }),
    [staffSession({ role, org_id }), clientInOrg, clientAddress, convoUpsert, msgInsert]);

  test("a text or an email to a client is queued for the compliance gate, to the address of that channel, with the sender named", async () => {
    netCalls.length = 0;
    const cases = [
      [{ channel: "email", subject: "Your file", body: "  Hi Dana, your file is ready.  " }, "email", "dana@example.test", "Your file"],
      [{ channel: "sms", body: "  Hi Dana, your call is at 3.  " }, "sms", "+16025550100", null],
    ];
    for (const [input, channel, address, subject] of cases) {
      const { res, fake } = await send(input);
      assert.equal(res.statusCode, 200, channel);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.kind, "client");
      const writes = fake.find(/INSERT INTO messages/);
      assert.equal(writes.length, 1, channel);
      const [ins] = writes;
      assert.match(ins.sql, /VALUES \(\$1,\$2,\$3,'outbound',\$4,\$5,\$6,'queued',false,\$7,\$8,\$9,'staff'/);
      // org, client, conversation, channel, text, provider_ref, to, subject, sender
      assert.equal(ins.params[0], ORG_ID);
      assert.equal(ins.params[1], CLIENT);
      assert.equal(ins.params[3], channel);
      assert.equal(ins.params[4], input.body.trim());
      assert.equal(ins.params[6], address, channel);
      assert.equal(ins.params[7], subject, channel);
      assert.equal(ins.params[8], STAFF_ID);
    }
    assert.equal(netCalls.length, 0);
  });

  test("every staff role may send once it has a shift; a client's own login and a client in another company are never written to", async () => {
    // The owner needs no shift; every other role is stopped without one (see
    // chat-messages-handler.test.mjs). Here each role is judged WITH a shift.
    const openShift = [/FROM shifts/, [{ id: "5f000000-0000-4000-8000-000000000001", staff_id: STAFF_ID, started_at: "2026-10-13T15:00:00Z", ended_at: null }]];
    for (const role of STAFF_ROLES) {
      const { res, fake } = await call(chatMessages, req("POST", { body: { kind: "client", client_id: CLIENT, channel: "sms", body: "Hello" } }),
        [staffSession({ role }), openShift, clientInOrg, clientAddress, convoUpsert, msgInsert]);
      assert.equal(res.statusCode, 200, role);
      assert.equal(fake.find(/INSERT INTO messages/).length, 1, role);
    }
    // A signed-in client is not staff: they cannot use the staff widget to text anyone.
    const portal = await call(chatMessages, req("POST", { body: { kind: "client", client_id: CLIENT, body: "Hello" } }),
      [...accountSession({ kind: "client", clientId: CLIENT }), clientInOrg, clientAddress, convoUpsert, msgInsert]);
    assert.ok([401, 403].includes(portal.res.statusCode));
    assert.equal(portal.fake.find(/INSERT INTO messages/).length, 0);
    const stranger = await send({ channel: "sms", body: "Hello" }, "owner", OTHER_ORG_ID);
    assert.ok(stranger.res.statusCode >= 400);
    assert.equal(stranger.res.body.ok, false);
    assert.deepEqual(stranger.fake.find(/SELECT id FROM clients/)[0].params, [CLIENT, OTHER_ORG_ID]);
    assert.equal(stranger.fake.find(/INSERT INTO messages/).length, 0);
  });
});

describe("POST /api/chat/messages: from the staff widget to the provider receipt", () => {
  test("an owner's email to a client is queued, passes the gate and reaches the provider, once, at the client's address", async () => {
    reset();
    const fake = queueDb({
      clients: { [CLIENT]: DANA },
      extra: [
        staffSession({ role: "owner" }),
        clientIn(/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, { id: CLIENT }),
      ],
    });
    const res = makeRes();
    await runWithSharedDb(fake, () => chatMessages(req("POST", {
      body: { kind: "client", client_id: CLIENT, channel: "email", subject: "Your file", body: "Hi Dana, your file is ready." },
    }), res));
    assert.equal(res.statusCode, 200);
    const [row] = fake.state.messages;
    assert.equal(row.sender_staff_id, STAFF_ID);
    assert.equal(row.to_address, "dana@example.test");
    assert.equal(row.status, "sent");
    const [mail] = recorded();
    assert.deepEqual([mail.to, mail.subject, mail.body.includes("Hi Dana, your file is ready.")], ["dana@example.test", "Your file", true]);
    assert.equal(recorded().length, 1);
  });

  test("a text between 8 pm and 8 am Arizona is held until 8 am, a text at any other hour goes, and an email is never held", async () => {
    const send = async (channel) => {
      reset();
      const fake = queueDb({
        clients: { [CLIENT]: DANA },
        extra: [staffSession({ role: "owner" }), clientIn(/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, { id: CLIENT })],
      });
      const res = makeRes();
      await runWithSharedDb(fake, () => chatMessages(req("POST", {
        body: { kind: "client", client_id: CLIENT, channel, body: "Hi Dana." },
      }), res));
      return { res, fake };
    };
    // [time in UTC (Phoenix is UTC-7, no daylight saving), is the text held, when it is released]
    const clock = [
      ["2026-10-14T02:55:00Z", false, null],                       // 7:55 pm
      ["2026-10-14T03:05:00Z", true, "2026-10-14T15:00:00.000Z"],  // 8:05 pm
      ["2026-10-14T06:30:00Z", true, "2026-10-14T15:00:00.000Z"],  // 11:30 pm
      ["2026-10-14T14:55:00Z", true, "2026-10-14T15:00:00.000Z"],  // 7:55 am
      ["2026-10-14T15:05:00Z", false, null],                       // 8:05 am
      ["2026-10-14T19:00:00Z", false, null],                       // noon
    ];
    try {
      for (const [at, held, release] of clock) {
        mock.timers.reset();
        mock.timers.enable({ apis: ["Date"], now: new Date(at) });
        const text = await send("sms");
        assert.equal(text.res.statusCode, 200, at);
        const [row] = text.fake.state.messages;
        if (held) {
          assert.equal(recorded().length, 0, at);
          assert.equal(row.status, "queued", at);
          assert.equal(row.scheduled_at, release, at);
        } else {
          assert.deepEqual(recorded().map((m) => m.to), ["+16025550100"], at);
          assert.equal(row.status, "sent", at);
        }
      }
      mock.timers.reset();
      mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-14T06:30:00Z") });
      const email = await send("email");
      assert.deepEqual(recorded().map((m) => m.to), ["dana@example.test"]);
      assert.equal(email.fake.state.messages[0].status, "sent");
    } finally {
      mock.timers.reset();
    }
  });

  test("a client who opted out is never sent the staff reply", async () => {
    reset();
    const fake = queueDb({
      clients: { [CLIENT]: DANA },
      optedOut: [CLIENT],
      extra: [staffSession({ role: "owner" }), clientIn(/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, { id: CLIENT })],
    });
    const res = makeRes();
    await runWithSharedDb(fake, () => chatMessages(req("POST", {
      body: { kind: "client", client_id: CLIENT, channel: "email", body: "Hi Dana." },
    }), res));
    assert.equal(recorded().length, 0);
    assert.equal(fake.state.messages[0]?.status, "blocked");
  });
});

describe("/api/chat/portal-message", () => {
  const session = (clientId = CLIENT) => accountSession({ kind: "client", clientId });
  const convoUpsert = [/INSERT INTO conversations/, [{ id: CONVO }]];
  const client = [/SELECT first_name, custom_fields FROM clients WHERE id = \$1 AND org_id = \$2/, [{ first_name: "Dana", custom_fields: {} }]];
  const inbound = (s) => /'inbound'/.test(s);
  const insertRow = [/INSERT INTO messages/, (s) => [{ id: inbound(s) ? MSG : "ee000000-0000-4000-8000-000000000002", direction: inbound(s) ? "inbound" : "outbound" }]];
  const link = [/UPDATE messages m\s+SET conversation_id/, (_s, p) => [{ id: p[0] }]];
  const post = (body, rules) => call(portalMessage, req("POST", { body }), rules);

  test("the client's note is saved as inbound on the channel they used, and the reply is saved delivered so it is never texted on top", async () => {
    netCalls.length = 0;
    for (const channel of ["sms", "email"]) {
      const { res, fake } = await post({ body: "  When is my call?  ", channel }, [...session(), convoUpsert, insertRow, client, link]);
      assert.equal(res.statusCode, 200, channel);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.conversation_id, CONVO);
      assert.equal(res.body.reply.source, "fallback");
      assert.ok(res.body.reply.text.length > 10);

      const writes = fake.find(/INSERT INTO messages/);
      assert.equal(writes.length, 2, channel);
      const [note, reply] = writes;
      // The channel and the words go into the statement through $4 and $5, not as a fixed value.
      assert.match(note.sql, /VALUES \(\$1, \$2, \$3, 'inbound', \$4, \$5, 'received'/);
      assert.deepEqual(note.params, [ORG_ID, CLIENT, CONVO, channel, "When is my call?"]);
      assert.match(reply.sql, /VALUES \(\$1, \$2, \$3, 'outbound', \$4, \$5, 'delivered', 'internal'/);
      assert.deepEqual([reply.params[0], reply.params[1], reply.params[2], reply.params[3]], [ORG_ID, CLIENT, CONVO, channel]);
      assert.equal(reply.params[4], res.body.reply.text);
      // No row is written as queued: nothing in this exchange can be dispatched.
      assert.equal(writes.filter((w) => /'queued'/.test(w.sql)).length, 0, channel);
    }
    assert.equal(netCalls.filter((u) => /anthropic/i.test(u)).length, 0);
  });

  test("the file is the one on the login, never one named in the request", async () => {
    const other = "c9000000-0000-4000-8000-000000000009";
    const { res, fake } = await post({ body: "hi", client_id: other, org_id: OTHER_ORG_ID }, [...session(), convoUpsert, insertRow, client, link]);
    assert.equal(res.statusCode, 200);
    const [note] = fake.find(/INSERT INTO messages/);
    assert.deepEqual([note.params[0], note.params[1]], [ORG_ID, CLIENT]);
    assert.deepEqual(fake.find(/INSERT INTO conversations/)[0].params.slice(0, 2), [ORG_ID, CLIENT]);
  });

  test("an empty note, a fax channel, a staff login, another kind of login and no login are each refused with no write", async () => {
    const refused = [
      [await post({ body: "   " }, [...session(), convoUpsert, insertRow]), 400],
      [await post({ body: "hi", channel: "fax" }, [...session(), convoUpsert, insertRow]), 400],
      [await post({ body: "hi" }, [staffSession({ role: "owner" }), convoUpsert, insertRow]), 403],
      [await post({ body: "hi" }, [...accountSession({ kind: "partner", partnerId: "b1000000-0000-4000-8000-000000000001" }), convoUpsert, insertRow]), 403],
      [await post({ body: "hi" }, [...accountSession({ kind: "affiliate" }), convoUpsert, insertRow]), 403],
      [await post({ body: "hi" }, [convoUpsert, insertRow]), 401],
    ];
    for (const [r, status] of refused) {
      assert.equal(r.res.statusCode, status);
      assert.equal(r.fake.find(/INSERT INTO messages/).length, 0);
    }
  });

  test("GET reads only the signed-in client's own thread, and a staff login or no login gets nothing", async () => {
    const own = [/FROM conversations\s+WHERE org_id = \$1 AND client_id = \$2/, []];
    const { res, fake } = await call(portalMessage, req("GET"), [...session(), own]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, conversation_id: null, messages: [] });
    assert.deepEqual(fake.find(/FROM conversations/)[0].params, [ORG_ID, CLIENT]);
    const staff = await call(portalMessage, req("GET"), [staffSession({ role: "owner" }), own]);
    assert.equal(staff.res.statusCode, 403);
    const nobody = await call(portalMessage, req("GET"), [own]);
    assert.equal(nobody.res.statusCode, 401);
    for (const r of [staff, nobody]) assert.equal(r.fake.find(/FROM conversations/).length, 0);
  });
});
