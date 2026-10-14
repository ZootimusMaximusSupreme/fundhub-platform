// POST /api/agent-call action=call, through the REAL handler with a stand-in
// database and a stubbed network. The five gates, the dry-run fence, and the
// exact call that would be dialled are judged here. No call is ever placed: the
// phone vendor's address is answered by a stub that only records the request.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/agent-call.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, STAFF_ID,
} from "../testing/handler-harness.mjs";

const AGENT = "AG-04";
const CLIENT = "c1000000-0000-4000-8000-000000000001";

const realFetch = globalThis.fetch;
const saved = { key: process.env.BLAND_API_KEY, fence: process.env.MESSAGING_DRY_RUN };
const wire = [];
before(() => {
  globalThis.fetch = async (url, init = {}) => {
    wire.push({ url: String(url), headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ call_id: "call-proof-0001" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  process.env.BLAND_API_KEY = ["fake", "phone", "system", "value"].join("-");
});
after(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of [["BLAND_API_KEY", saved.key], ["MESSAGING_DRY_RUN", saved.fence]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
beforeEach(() => { wire.length = 0; delete process.env.MESSAGING_DRY_RUN; });

const agentRow = (over = {}) => ({
  code: AGENT, name: "Josh", status: "live", channel: "voice", agent_class: "client_facing",
  runtime: "bland", runtime_ref: null, prompt: "You are Josh. Ask when the client wants to book a call.", ...over,
});
const clientRow = (over = {}) => ({ id: CLIENT, first_name: "Dana", last_name: "Whitfield", phone: "(602) 555-0100", dnd_voice: false, ...over });

async function call(body, { role = "closer", agent = agentRow(), client = clientRow(), optedOut = false } = {}) {
  const fake = fakeDb([
    staffSession({ role }),
    [/FROM agents WHERE org_id/, agent ? [agent] : []],
    [/FROM clients WHERE id = \$1::uuid AND org_id = \$2::uuid/, client ? [client] : []],
    [/FROM opt_outs/, optedOut ? [{ "?column?": 1 }] : []],
    [/FROM compliance_rules/, []],
    [/INSERT INTO outbound_calls/, []],
  ]);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body }), res));
  return { res, fake };
}

describe("POST /api/agent-call action=call", () => {
  test("the dry-run fence holds the call: nothing is dialled and nothing is recorded", async () => {
    const { res, fake } = await call({ action: "call", agent_code: AGENT, client_id: CLIENT });
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.placed, false);
    assert.equal(res.body.reason, "dry_run");
    assert.equal(wire.length, 0);
    assert.equal(fake.find(/INSERT INTO outbound_calls/).length, 0);
  });

  test("with the fence off, exactly one call is placed to the client's number, tied back to their file", async () => {
    process.env.MESSAGING_DRY_RUN = "off";
    const { res, fake } = await call({ action: "call", agent_code: AGENT, client_id: CLIENT });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.placed, true);
    assert.equal(res.body.call_id, "call-proof-0001");
    assert.equal(res.body.attributed, true);
    assert.match(res.body.message, /Josh is calling Dana Whitfield\./);

    assert.equal(wire.length, 1);
    assert.match(wire[0].url, /\/calls$/);
    assert.equal(wire[0].body.phone_number, "+16025550100");
    assert.match(wire[0].body.task, /Ask when the client wants to book a call/);
    assert.match(wire[0].body.task, /recorded/i);
    assert.equal(wire[0].body.record, true);
    assert.equal(wire[0].body.metadata.client_id, CLIENT);
    assert.equal(wire[0].body.metadata.agent_code, AGENT);
    assert.equal(wire[0].body.metadata.org_id, ORG_ID);
    assert.equal(wire[0].body.metadata.placed_by, STAFF_ID);

    const [row] = fake.find(/INSERT INTO outbound_calls/);
    assert.deepEqual(row.params, ["call-proof-0001", CLIENT, ORG_ID, "agent_editor"]);
  });

  test("a do-not-call flag, a voice opt-out, an internal agent and an agent that is not live each stop the call", async () => {
    process.env.MESSAGING_DRY_RUN = "off";
    const cases = [
      [{ client: clientRow({ dnd_voice: true }) }, "dnd_voice"],
      [{ optedOut: true }, "opted_out"],
      [{ agent: agentRow({ agent_class: "internal" }) }, "not_client_facing"],
      [{ agent: agentRow({ status: "shadow" }) }, "not_live"],
      [{ client: clientRow({ phone: "" }) }, "no_phone"],
    ];
    for (const [options, reason] of cases) {
      const { res, fake } = await call({ action: "call", agent_code: AGENT, client_id: CLIENT }, options);
      assert.equal(res.statusCode, 409, reason);
      assert.equal(res.body.placed, false, reason);
      assert.equal(res.body.reason, reason);
      assert.equal(fake.find(/INSERT INTO outbound_calls/).length, 0, reason);
    }
    assert.equal(wire.length, 0);
  });

  test("a funding advisor is refused before any lookup, and an unknown client is 404", async () => {
    process.env.MESSAGING_DRY_RUN = "off";
    const advisor = await call({ action: "call", agent_code: AGENT, client_id: CLIENT }, { role: "funding_advisor" });
    assert.equal(advisor.res.statusCode, 403);
    assert.equal(advisor.fake.find(/FROM agents/).length, 0);
    const unknown = await call({ action: "call", agent_code: AGENT, client_id: CLIENT }, { client: null });
    assert.equal(unknown.res.statusCode, 404);
    assert.equal(unknown.res.body.reason, "client_not_found");
    assert.equal(wire.length, 0);
  });
});
