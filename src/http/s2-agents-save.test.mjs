// POST /api/agents action=save — the server half of every Agent Editor control.
// The page sends one payload (e2e/s2-agent-editor-save.spec.mjs proves which
// field each switch lands in); this proves the saved row holds exactly that.
// Real handler, stand-in database, no network.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/agents.mjs";
import { accountSession, fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const current = {
  id: "a1000000-0000-4000-8000-000000000001", org_id: ORG_ID, code: "AG-01", name: "Lead Follow-up",
  agent_class: "client_facing", channel: "sms", status: "draft", runtime: null, runtime_ref: null,
  prompt: "old prompt", guardrails: { block: "old" }, owner_label: "Sarah Whitfield", sort_order: 1,
};

// An agent is found by its company ($1) AND its code ($2).
const found = (row) => [/FROM agents\s+WHERE org_id = \$1::uuid AND code = \$2/,
  (_s, p) => (row && p[0] === row.org_id && p[1] === row.code ? [row] : [])];

async function save(body, role = "owner", row = current, session = [staffSession({ role })]) {
  const fake = fakeDb([
    ...session,
    found(row),
    [/UPDATE agents SET\s+name = \$3/, (_s, p) => [{ ...current, name: p[2], channel: p[3], agent_class: p[4], owner_label: p[5], prompt: p[6], guardrails: JSON.parse(p[7]) }]],
  ]);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body }), res));
  return { res, fake };
}

// An agent whose prompt (80 characters) and guardrails (two keys) are written.
const ready = { ...current, prompt: "x".repeat(80), guardrails: { block: "y".repeat(40), triggers: ["entry.captured"] } };

// Run promote or demote against a stand-in that hands back the row it was given.
async function lifecycle(action, row) {
  const fake = fakeDb([
    staffSession({ role: "owner" }),
    found(row),
    [/UPDATE agents SET\s+status = 'live'/, (_s, p) => [{ ...row, status: "live", runtime: p[2] }]],
    [/UPDATE agents SET\s+status = 'shadow'/, (_s, p) => [{ ...row, status: "shadow", runtime: p[2] }]],
  ]);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body: { action, code: row.code } }), res));
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
    const live = await lifecycle("promote", ready);
    assert.equal(live.res.statusCode, 200);
    assert.equal(live.res.body.agent.status, "live");
    assert.equal(live.res.body.agent.runtime, "internal");
    const blocked = await lifecycle("promote", { ...ready, prompt: "short" });
    assert.equal(blocked.res.statusCode, 409);
    assert.equal(blocked.res.body.error, "promotion_blocked");
    assert.equal(blocked.fake.find(/UPDATE agents SET/).length, 0);
    const shadow = await lifecycle("demote", { ...ready, status: "live", runtime: "internal" });
    assert.equal(shadow.res.statusCode, 200);
    assert.equal(shadow.res.body.agent.status, "shadow");
  });

  test("promote needs a prompt of 60 characters AND a guardrail block of 20 (or two guardrail keys): one under either line is refused and nothing is written", async () => {
    const cases = [
      // [what the agent holds, prompt, guardrails, does it go live]
      ["a prompt of exactly 60", "x".repeat(60), ready.guardrails, true],
      ["a prompt one short of 60", "x".repeat(59), ready.guardrails, false],
      ["a lone guardrail block of exactly 20", "x".repeat(60), { block: "y".repeat(20) }, true],
      ["a lone guardrail block one short of 20", "x".repeat(60), { block: "y".repeat(19) }, false],
      ["a written prompt and an empty guardrail object", "x".repeat(60), {}, false],
      ["a written prompt and no guardrails at all", "x".repeat(60), null, false],
    ];
    for (const [why, prompt, guardrails, goesLive] of cases) {
      const { res, fake } = await lifecycle("promote", { ...ready, prompt, guardrails });
      assert.equal(res.statusCode, goesLive ? 200 : 409, why);
      if (goesLive) {
        assert.equal(res.body.agent.status, "live", why);
        assert.equal(fake.find(/UPDATE agents SET\s+status = 'live'/).length, 1, why);
      } else {
        assert.equal(res.body.error, "promotion_blocked", why);
        assert.equal(fake.find(/UPDATE agents SET/).length, 0, why);
      }
    }
  });

  test("every staff role in the app's staff set may save; a client, partner or affiliate login and no login may not", async () => {
    const body = { action: "save", code: "AG-01", name: "Renamed" };
    for (const role of STAFF_ROLES) {
      const { res, fake } = await save(body, role);
      assert.equal(res.statusCode, 200, role);
      assert.equal(fake.find(/UPDATE agents SET/).length, 1, role);
    }
    const outsiders = [
      accountSession({ kind: "client", clientId: "c1000000-0000-4000-8000-000000000001" }),
      accountSession({ kind: "partner", partnerId: "b1000000-0000-4000-8000-000000000001" }),
      accountSession({ kind: "affiliate" }),
      [],
    ];
    for (const session of outsiders) {
      const { res, fake } = await save(body, "owner", current, session);
      assert.ok([401, 403].includes(res.statusCode), String(res.statusCode));
      assert.equal(fake.find(/UPDATE agents SET/).length, 0);
    }
  });

  test("an agent in another company is 404: it is not saved, promoted or returned to shadow", async () => {
    for (const body of [
      { action: "save", code: "AG-01", name: "Renamed" },
      { action: "promote", code: "AG-01" },
      { action: "demote", code: "AG-01" },
    ]) {
      const fake = fakeDb([
        staffSession({ role: "owner", org_id: OTHER_ORG_ID }),
        found(ready),
        [/UPDATE agents SET/, [{ ...ready }]],
      ]);
      const res = makeRes();
      await runWithSharedDb(fake, () => handler(req("POST", { body }), res));
      assert.equal(res.statusCode, 404, body.action);
      assert.deepEqual(fake.find(/FROM agents/)[0].params, [OTHER_ORG_ID, "AG-01"], body.action);
      assert.equal(fake.find(/UPDATE agents SET/).length, 0, body.action);
    }
  });
});
