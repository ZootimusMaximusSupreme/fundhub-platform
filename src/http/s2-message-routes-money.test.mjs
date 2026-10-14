// The money helper and the payment-ask doors that speak to a customer, run
// through the REAL handlers with a stand-in database and no network:
//
//   route:money/helper    POST send: the turn is saved and queued; the helper never texts
//   route:payment-links   action=send texts the checkout link; action=expire kills a live ask
//
// The staff and portal chat doors are in s2-message-routes-chat.test.mjs.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import moneyHelper from "../../api/money/helper.mjs";
import paymentLinks from "../../api/payment-links.mjs";
import {
  accountSession, makeRes, req, runWithSharedDb, staffSession, ORG_ID, OTHER_ORG_ID,
} from "../testing/handler-harness.mjs";
import { queueDb } from "../pulse/catalog/proofs/s2-queue-db.mjs";
import {
  call, clientIn, refuseNetwork, splitRoles, CLIENT, DANA,
} from "../pulse/catalog/proofs/s2-route-kit.mjs";
import { dispatchOne, OUTCOME } from "../messaging/dispatch.mjs";
import { recorded, reset } from "../messaging/providers/memory.mjs";

const LINK = "9f000000-0000-4000-8000-000000000001";

refuseNetwork({ before, after });

describe("POST /api/money/helper action=send", () => {
  const FINANCE_OS = ["owner", "admin", "sales_manager", "closer"];
  const helperAgent = (status) => [/SELECT \* FROM agents WHERE org_id = \$1 AND code = \$2/, status
    ? [{ code: "FOS-01", name: "Money helper", status, prompt: "p", guardrails: {} }] : []];
  const bridgeOn = [/FROM agent_bridge_heartbeats/, [{ last_at: new Date().toISOString() }]];
  const noHalt = [/FROM money_helper_threads/, []];
  const noTurnsToday = [/count\(\*\)::int AS n FROM money_helper_turns/, [{ n: 0 }]];
  const turnInsert = [/INSERT INTO money_helper_turns/, (_s, p) => [{
    id: "74000000-0000-4000-8000-000000000001", org_id: p[0], client_id: p[1], kind: p[2], actor: p[3], input: p[5], status: p[7], reply: null,
  }]];
  const clientOnFile = clientIn(/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, { "?column?": 1 });
  const live = [helperAgent("shadow"), noHalt, noTurnsToday, bridgeOn, turnInsert];
  const send = (body, rules, who = accountSession({ kind: "client", clientId: CLIENT })) => call(
    moneyHelper, req("POST", { body }), [...who, ...rules]);
  const asStaff = (role, org_id = ORG_ID) => [staffSession({ role, org_id }), clientOnFile];
  const savedTurn = (fake) => fake.find(/INSERT INTO money_helper_turns/)[0].params;

  test("a client's message is saved as a queued turn for the helper brain and nothing is texted", async () => {
    const { res, fake } = await send({ action: "send", message: "  What is due this week?  " }, live);
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.queued, true);
    assert.equal(res.body.turn.status, "queued");
    const turn = savedTurn(fake);
    assert.match(fake.find(/INSERT INTO money_helper_turns/)[0].sql, /\(org_id, client_id, kind, actor, staff_id, input, task_id, status, claimed_at\)\s+VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8/);
    assert.deepEqual([turn[0], turn[1], turn[2], turn[3], turn[5], turn[7]],
      [ORG_ID, CLIENT, "message", "client", "What is due this week?", "queued"]);
    assert.equal(fake.find(/INSERT INTO messages/).length, 0);
  });

  test("a client's own file is the one on the login, whatever the request names", async () => {
    const { res, fake } = await send({ action: "send", message: "hi", client_id: "c9000000-0000-4000-8000-000000000009" }, live);
    assert.equal(res.statusCode, 202);
    assert.equal(savedTurn(fake)[1], CLIENT);
  });

  test("staff in the FinanceOS roles may write on a client's thread, as staff; every other role is refused and nothing is saved", async () => {
    const { admitted, refused } = splitRoles(FINANCE_OS);
    assert.deepEqual([...admitted].sort(), [...FINANCE_OS].sort());
    for (const role of admitted) {
      const { res, fake } = await send({ action: "send", message: "role play", client_id: CLIENT }, live, asStaff(role));
      assert.equal(res.statusCode, 202, role);
      const turn = savedTurn(fake);
      assert.deepEqual([turn[0], turn[1], turn[3]], [ORG_ID, CLIENT, "staff"], role);
      assert.equal(fake.find(/INSERT INTO messages/).length, 0, role);
    }
    assert.equal(refused.length, 4);
    for (const role of refused) {
      const { res, fake } = await send({ action: "send", message: "role play", client_id: CLIENT }, live, asStaff(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(fake.find(/INSERT INTO money_helper_turns/).length, 0, role);
    }
  });

  test("staff must name a file, and a file in another company is 404 with nothing saved", async () => {
    const none = await send({ action: "send", message: "hi" }, live, asStaff("owner"));
    assert.equal(none.res.statusCode, 400);
    const stranger = await send({ action: "send", message: "hi", client_id: CLIENT }, live, asStaff("owner", OTHER_ORG_ID));
    assert.equal(stranger.res.statusCode, 404);
    assert.deepEqual(stranger.fake.find(/SELECT 1 FROM clients/)[0].params, [CLIENT, OTHER_ORG_ID]);
    for (const r of [none, stranger]) assert.equal(r.fake.find(/INSERT INTO money_helper_turns/).length, 0);
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
    const { res } = await send({ action: "wire_money", message: "hi" }, live);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_action");
  });
});

describe("POST /api/payment-links action=send and action=expire", () => {
  const PAYMENT_ROLES = ["owner", "admin", "sales_manager"];
  const link = (over = {}) => ({
    id: LINK, org_id: ORG_ID, client_id: CLIENT, status: "created", purpose: "setup", description: "Setup fee",
    amount_cents: 49700, checkout_url: "https://pay.example.test/checkout/abc", ...over,
  });
  const TEMPLATE = { body: "Hi {{contact.first_name}}, pay {{payment_link.amount}} for {{payment_link.description}}: {{payment_link.url}}" };

  async function ask(body, { role = "owner", org_id = ORG_ID, row = link(), template = TEMPLATE } = {}) {
    const fake = queueDb({
      templates: template ? { payment_link_notice: template } : {},
      clients: { [CLIENT]: DANA },
      extra: [
        staffSession({ role, org_id }),
        // The ask is found by its id AND the signed-in person's company.
        [/SELECT \* FROM payment_links WHERE id = \$1 AND org_id = \$2/, (_s, p) => (row && p[0] === row.id && p[1] === row.org_id ? [row] : [])],
        [/UPDATE payment_links\s+SET status = 'sent'/, (_s, p) => (row.status === "created" ? [{ ...row, status: "sent", sent_at: p[2] }] : [])],
        // The expire statement carries the statuses it may change ($4); the stand-in reads that list, so
        // a handler that lets a paid ask be expired is not saved by a rule written into the stand-in.
        [/UPDATE payment_links\s+SET status = 'expired'/, (_s, p) => (p[3].includes(row.status) ? [{ ...row, status: "expired", expired_at: p[2] }] : [])],
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
    assert.equal(fake.state.messages.length, 1);
    const [text] = fake.state.messages;
    assert.equal(text.channel, "sms");
    assert.equal(text.template_key, "payment_link_notice");
    assert.equal(text.to_address, "+16025550100");
    assert.match(text.rendered_body, /Hi Dana, pay 497\.00 for Setup fee: https:\/\/pay\.example\.test\/checkout\/abc/);
  });

  test("asking again for the same ask is not a second text: one message per link", async () => {
    const fake = queueDb({
      templates: { payment_link_notice: TEMPLATE },
      clients: { [CLIENT]: DANA },
      extra: [
        staffSession({ role: "owner" }),
        [/SELECT \* FROM payment_links WHERE id = \$1 AND org_id = \$2/, (_s, p) => (p[0] === LINK && p[1] === ORG_ID ? [link()] : [])],
        [/UPDATE payment_links\s+SET status = 'sent'/, [{ ...link(), status: "sent" }]],
      ],
    });
    for (let i = 0; i < 2; i += 1) {
      const res = makeRes();
      await runWithSharedDb(fake, () => paymentLinks(req("POST", { body: { action: "send", id: LINK } }), res));
      assert.equal(res.statusCode, 200);
    }
    assert.equal(fake.state.messages.length, 1);
    assert.equal(fake.state.messages[0].provider_ref, `workflow:payment_link_notice:${LINK}`);
  });

  test("the queued text reaches the provider at the client's phone with every placeholder filled", async () => {
    reset();
    const { fake } = await ask({ action: "send", id: LINK });
    const [queuedRow] = fake.state.messages;
    const claimed = { ...queuedRow, status: "sending", attempts: 1 };
    const out = await dispatchOne(fake, claimed, { env: {}, now: () => new Date("2026-10-13T19:00:00Z") });
    assert.equal(out.outcome, OUTCOME.SENT);
    const [text] = recorded();
    assert.equal(text.to, "+16025550100");
    assert.doesNotMatch(text.body, /{{[^}]+}}/);
    assert.match(text.body, /497\.00 for Setup fee: https:\/\/pay\.example\.test\/checkout\/abc/);
  });

  test("a link already sent may be sent again, and it stays sent", async () => {
    const { res, fake } = await ask({ action: "send", id: LINK }, { row: link({ status: "sent" }) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message_queued, true);
    assert.equal(res.body.link.status, "sent");
    assert.equal(fake.state.messages.length, 1);
  });

  test("an unapproved text sends nothing and the ask stays unsent", async () => {
    const { res, fake } = await ask({ action: "send", id: LINK }, { template: { ...TEMPLATE, compliance_passed: false } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message_queued, false);
    assert.equal(res.body.message_reason, "template_pending");
    assert.equal(res.body.link.status, "created");
    assert.equal(fake.state.messages.length, 0);
  });

  test("a paid, expired or void ask is never texted again", async () => {
    for (const status of ["paid", "expired", "void"]) {
      const { res, fake } = await ask({ action: "send", id: LINK }, { row: link({ status }) });
      assert.equal(res.statusCode, 409, status);
      assert.match(res.body.error, new RegExp(`this link is ${status}`));
      assert.equal(fake.state.messages.length, 0, status);
    }
  });

  test("expire kills a live ask, and a paid one cannot be expired", async () => {
    for (const status of ["created", "sent"]) {
      const live = await ask({ action: "expire", id: LINK }, { row: link({ status }) });
      assert.equal(live.res.statusCode, 200, status);
      assert.equal(live.res.body.link.status, "expired", status);
      assert.equal(live.fake.state.messages.length, 0, status);
    }
    for (const status of ["paid", "expired"]) {
      const dead = await ask({ action: "expire", id: LINK }, { row: link({ status }) });
      assert.equal(dead.res.statusCode, 409, status);
      assert.match(dead.res.body.error, /already paid or expired/);
    }
  });

  test("only an owner, an admin or a sales manager may send or expire; a closer and every other role are refused and nothing is queued", async () => {
    const { admitted, refused } = splitRoles(PAYMENT_ROLES);
    assert.deepEqual([...admitted].sort(), [...PAYMENT_ROLES].sort());
    for (const role of admitted) {
      for (const action of ["send", "expire"]) {
        const { res } = await ask({ action, id: LINK }, { role });
        assert.equal(res.statusCode, 200, `${role} ${action}`);
      }
    }
    assert.ok(refused.includes("closer"));
    for (const role of refused) {
      for (const action of ["send", "expire"]) {
        const { res, fake } = await ask({ action, id: LINK }, { role });
        assert.equal(res.statusCode, 403, `${role} ${action}`);
        assert.equal(res.body.error, "forbidden", `${role} ${action}`);
        assert.equal(fake.state.messages.length, 0, `${role} ${action}`);
        assert.equal(fake.find(/UPDATE payment_links/).length, 0, `${role} ${action}`);
      }
    }
  });

  test("an ask in another company is 404: it is not texted and not expired", async () => {
    for (const action of ["send", "expire"]) {
      const { res, fake } = await ask({ action, id: LINK }, { org_id: OTHER_ORG_ID });
      assert.equal(res.statusCode, 404, action);
      assert.deepEqual(fake.find(/SELECT \* FROM payment_links/)[0].params, [LINK, OTHER_ORG_ID], action);
      assert.equal(fake.state.messages.length, 0, action);
      assert.equal(fake.find(/UPDATE payment_links/).length, 0, action);
    }
  });
});
