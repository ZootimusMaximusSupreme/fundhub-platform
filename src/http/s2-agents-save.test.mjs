// POST /api/agents action=save — the server half of every Agent Editor control.
// The page sends one payload (e2e/s2-agent-editor-save.spec.mjs proves which
// field each switch lands in); this proves the saved row holds exactly that.
// Real handler, stand-in database, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/agents.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID } from "../testing/handler-harness.mjs";

const current = {
  id: "a1000000-0000-4000-8000-000000000001", org_id: ORG_ID, code: "AG-01", name: "Lead Follow-up",
  agent_class: "client_facing", channel: "sms", status: "draft", runtime: null, runtime_ref: null,
  prompt: "old prompt", guardrails: { block: "old" }, owner_label: "Sarah Whitfield", sort_order: 1,
};

async function save(body, role = "owner", row = current) {
  const fake = fakeDb([
    staffSession({ role }),
    [/FROM agents\s+WHERE org_id = \$1::uuid AND code = \$2/, row ? [row] : []],
    [/UPDATE agents SET\s+name = \$3/, (_s, p) => [{ ...current, name: p[2], channel: p[3], agent_class: p[4], owner_label: p[5], prompt: p[6], guardrails: JSON.parse(p[7]) }]],
  ]);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body }), res));
  return { res, fake };
}

const GUARDRAILS = {
  block: "Never quote a number. Hand off on any complaint.",
  triggers: ["entry.captured", "payment.received"],
  escalation: { path: "Jordan Blake · Owner", after: "4 hours", when: "client mentions bankruptcy" },
  authority: { disc: 0, msgcap: 7, pay: false, contract: true, book: true, pull: false },
  flags: { noamount: true, noscore: true, attorney: true, quiet: false },
};

describe("POST /api/agents action=save", () => {
  test("the saved row holds exactly the fields the page sent, guardrails untouched", async () => {
    const { res, fake } = await save({
      action: "save", code: "AG-01", name: "Lead Follow-up v2", channel: "email", agent_class: "client_facing",
      owner_label: "Jordan Blake", prompt: "You follow up with new leads.\nNever quote a number.", guardrails: GUARDRAILS,
    });
    assert.equal(res.statusCode, 200);
    const [write] = fake.find(/UPDATE agents SET/);
    assert.equal(write.params[0], ORG_ID);
    assert.deepEqual(write.params.slice(1, 7), ["AG-01", "Lead Follow-up v2", "email", "client_facing", "Jordan Blake", "You follow up with new leads.\nNever quote a number."]);
    assert.deepEqual(JSON.parse(write.params[7]), GUARDRAILS);
    assert.deepEqual(res.body.agent.guardrails, GUARDRAILS);
  });

  test("a switch that is off is saved as off, not dropped", async () => {
    const { fake } = await save({ action: "save", code: "AG-01", name: "x", guardrails: { ...GUARDRAILS, authority: { ...GUARDRAILS.authority, contract: false } } });
    assert.equal(JSON.parse(fake.find(/UPDATE agents SET/)[0].params[7]).authority.contract, false);
  });

  test("a bad channel or an empty name is refused and nothing is written", async () => {
    for (const [body, error] of [
      [{ action: "save", code: "AG-01", channel: "carrier-pigeon" }, "invalid_channel"],
      [{ action: "save", code: "AG-01", name: "   " }, "name_required"],
    ]) {
      const { res, fake } = await save(body);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error, error);
      assert.equal(fake.find(/UPDATE agents SET/).length, 0);
    }
  });

  test("a retired agent cannot be edited", async () => {
    const retired = await save({ action: "save", code: "AG-01", name: "x" }, "owner", { ...current, status: "retired" });
    assert.equal(retired.res.statusCode, 409);
    assert.equal(retired.fake.find(/UPDATE agents SET/).length, 0);
  });

  test("promote sets the agent live only when its prompt and guardrails are written, and demote returns it to shadow", async () => {
    const ready = { ...current, prompt: "x".repeat(80), guardrails: { block: "y".repeat(40), triggers: ["entry.captured"] } };
    const run = async (action, row) => {
      const fake = fakeDb([
        staffSession({ role: "owner" }),
        [/FROM agents\s+WHERE org_id = \$1::uuid AND code = \$2/, [row]],
        [/UPDATE agents SET\s+status = 'live'/, (_s, p) => [{ ...row, status: "live", runtime: p[2] }]],
        [/UPDATE agents SET\s+status = 'shadow'/, (_s, p) => [{ ...row, status: "shadow", runtime: p[2] }]],
      ]);
      const res = makeRes();
      await runWithSharedDb(fake, () => handler(req("POST", { body: { action, code: "AG-01" } }), res));
      return { res, fake };
    };
    const live = await run("promote", ready);
    assert.equal(live.res.statusCode, 200);
    assert.equal(live.res.body.agent.status, "live");
    assert.equal(live.res.body.agent.runtime, "internal");
    const blocked = await run("promote", { ...ready, prompt: "short" });
    assert.equal(blocked.res.statusCode, 409);
    assert.equal(blocked.res.body.error, "promotion_blocked");
    assert.equal(blocked.fake.find(/UPDATE agents SET/).length, 0);
    const shadow = await run("demote", { ...ready, status: "live", runtime: "internal" });
    assert.equal(shadow.res.statusCode, 200);
    assert.equal(shadow.res.body.agent.status, "shadow");
  });
});
