// POST /api/agent-call action=call, through the REAL handler with a stand-in
// database and a stubbed network. The five gates, the dry-run fence, and the
// exact call that would be dialled are judged here. No call is ever placed: the
// phone vendor's address is answered by a stub that only records the request.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler, { CALL_ROLES } from "../../api/agent-call.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";
import { req, staffSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { call as run, splitRoles } from "../pulse/catalog/proofs/s2-route-kit.mjs";

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
beforeEach(() => { wire.length = 0; delete process.env.MESSAGING_DRY_RUN; clearRuleCache(); });

const agentRow = (over = {}) => ({
  code: AGENT, name: "Josh", status: "live", channel: "voice", agent_class: "client_facing",
  runtime: "bland", runtime_ref: null, prompt: "You are Josh. Ask when the client wants to book a call.", ...over,
});
const clientRow = (over = {}) => ({ id: CLIENT, first_name: "Dana", last_name: "Whitfield", phone: "(602) 555-0100", dnd_voice: false, ...over });

/* The stand-in answers each lookup from the statement's own parameters, so a
   handler that asks for the wrong company, the wrong client or the wrong channel
   is told no: the client belongs to ORG_ID, the agent is held by the companies in
   `agentIn`, and an opt-out is a (client, channel) row. */
async function call(body, {
  role = "closer", org_id = ORG_ID, agent = agentRow(), agentIn = [ORG_ID], client = clientRow(), optedOut = [], rules = [],
} = {}) {
  return run(handler, req("POST", { body }), [
    staffSession({ role, org_id }),
    [/FROM agents WHERE org_id = \$1::uuid AND code = \$2/, (_s, p) => (agent && agentIn.includes(p[0]) && p[1] === agent.code ? [agent] : [])],
    [/FROM clients WHERE id = \$1::uuid AND org_id = \$2::uuid/, (_s, p) => (client && p[0] === client.id && p[1] === (client.org_id || ORG_ID) ? [client] : [])],
    [/FROM opt_outs WHERE client_id = \$1 AND channel = \$2 AND opted_in_at IS NULL/, (_s, p) => (
      p[0] === CLIENT && optedOut.includes(p[1]) ? [{ "?column?": 1 }] : [])],
    [/FROM compliance_rules/, rules],
    [/INSERT INTO outbound_calls/, []],
  ]);
}
const CALL = { action: "call", agent_code: AGENT, client_id: CLIENT };

describe("POST /api/agent-call action=call", () => {
  test("the dry-run fence holds the call unless it is explicitly off: nothing is dialled and nothing is recorded", async () => {
    for (const value of [undefined, "", "1", "true", "yes", "on", "banana"]) {
      if (value === undefined) delete process.env.MESSAGING_DRY_RUN; else process.env.MESSAGING_DRY_RUN = value;
      const { res, fake } = await call(CALL);
      assert.equal(res.statusCode, 503, String(value));
      assert.equal(res.body.placed, false);
      assert.equal(res.body.reason, "dry_run", String(value));
      assert.equal(fake.find(/INSERT INTO outbound_calls/).length, 0);
    }
    assert.equal(wire.length, 0);
  });

  test("with the fence off, exactly one call is placed to the client's number, tied back to their file", async () => {
    process.env.MESSAGING_DRY_RUN = "off";
    const { res, fake } = await call(CALL);
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
    assert.match(row.sql, /\(call_id, client_id, org_id, kind\)\s+VALUES \(\$1, \$2, \$3, \$4\)/);
    assert.deepEqual(row.params, ["call-proof-0001", CLIENT, ORG_ID, "agent_editor"]);
  });

  test("every other fence value that means off also places the call", async () => {
    for (const value of ["0", "false", "no", "off"]) {
      wire.length = 0;
      process.env.MESSAGING_DRY_RUN = value;
      const { res } = await call(CALL);
      assert.equal(res.statusCode, 200, value);
      assert.equal(wire.length, 1, value);
    }
  });

  test("each gate stops the call by its own reason: do-not-call, voice opt-out, internal agent, not live, not on the phone system, no script, no number, restricted words", async () => {
    process.env.MESSAGING_DRY_RUN = "off";
    const restricted = [{
      rule_set: "croa", rule_key: "no-guaranteed-approval", offer_types: [], platforms: [], match_type: "phrase",
      pattern: "guaranteed approval", severity: "block", message: "Guaranteed approval can never be promised.", citation: null,
    }];
    const cases = [
      [{ client: clientRow({ dnd_voice: true }) }, "dnd_voice"],
      [{ optedOut: ["voice"] }, "opted_out"],
      [{ agent: agentRow({ agent_class: "internal" }) }, "not_client_facing"],
      [{ agent: agentRow({ status: "shadow" }) }, "not_live"],
      [{ agent: agentRow({ runtime: "internal" }) }, "not_a_voice_runtime"],
      [{ agent: agentRow({ prompt: "   " }) }, "no_prompt"],
      [{ client: clientRow({ phone: "" }) }, "no_phone"],
      [{ agent: agentRow({ prompt: "Tell the client they have guaranteed approval." }), rules: restricted }, "gate_blocked"],
    ];
    for (const [options, reason] of cases) {
      const { res, fake } = await call(CALL, options);
      assert.equal(res.statusCode, 409, reason);
      assert.equal(res.body.placed, false, reason);
      assert.equal(res.body.reason, reason);
      assert.equal(fake.find(/INSERT INTO outbound_calls/).length, 0, reason);
    }
    assert.equal(wire.length, 0);
  });

  test("a text opt-out or a restricted word that is not in the script does not stop a voice call", async () => {
    process.env.MESSAGING_DRY_RUN = "off";
    const rules = [{
      rule_set: "croa", rule_key: "no-guaranteed-approval", offer_types: [], platforms: [], match_type: "phrase",
      pattern: "guaranteed approval", severity: "block", message: "x", citation: null,
    }];
    const { res } = await call(CALL, { optedOut: ["sms", "email"], rules });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.placed, true);
    assert.equal(wire.length, 1);
  });

  test("only the six contact desks may place a call; every other staff role is refused before any lookup", async () => {
    process.env.MESSAGING_DRY_RUN = "off";
    const { admitted, refused } = splitRoles(CALL_ROLES);
    assert.deepEqual([...admitted].sort(), ["admin", "closer", "inquiry_specialist", "owner", "sales_manager", "setter"]);
    assert.deepEqual([...refused].sort(), ["csm", "funding_advisor"]);
    for (const role of admitted) {
      wire.length = 0;
      const { res } = await call(CALL, { role });
      assert.equal(res.statusCode, 200, role);
      assert.equal(wire.length, 1, role);
    }
    for (const role of refused) {
      wire.length = 0;
      const { res, fake } = await call(CALL, { role });
      assert.equal(res.statusCode, 403, role);
      assert.equal(fake.find(/FROM agents/).length, 0, role);
      assert.equal(wire.length, 0, role);
    }
  });

  test("another company's staff cannot dial this company's client or use this company's agent", async () => {
    process.env.MESSAGING_DRY_RUN = "off";
    // Their company has no AG-04 of its own: this company's agent is not theirs to use.
    const noAgent = await call(CALL, { org_id: OTHER_ORG_ID });
    assert.equal(noAgent.res.statusCode, 404);
    assert.equal(noAgent.res.body.reason, "not_found");
    assert.deepEqual(noAgent.fake.find(/FROM agents/)[0].params, [OTHER_ORG_ID, AGENT]);
    // They have an AG-04 of their own, but the client is on file in this company.
    const noClient = await call(CALL, { org_id: OTHER_ORG_ID, agentIn: [ORG_ID, OTHER_ORG_ID] });
    assert.equal(noClient.res.statusCode, 404);
    assert.equal(noClient.res.body.reason, "client_not_found");
    assert.deepEqual(noClient.fake.find(/FROM clients/)[0].params, [CLIENT, OTHER_ORG_ID]);
    assert.equal(wire.length, 0);
    for (const r of [noAgent, noClient]) assert.equal(r.fake.find(/INSERT INTO outbound_calls/).length, 0);
  });
});
