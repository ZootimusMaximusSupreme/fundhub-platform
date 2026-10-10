import { test } from "node:test";
import assert from "node:assert/strict";
import { isEligibleAgent, selectAgent } from "./select.mjs";

test("isEligibleAgent: live and shadow with prompt on matching channel", () => {
  assert.equal(isEligibleAgent({
    status: "live", agent_class: "client_facing", channel: "sms",
    runtime: "anthropic", prompt: "Be brief."
  }, "sms"), true);
  assert.equal(isEligibleAgent({
    status: "draft", agent_class: "client_facing", channel: "sms",
    runtime: "anthropic", prompt: "Be brief."
  }, "sms"), false);
});

test("selectAgent: live wins over shadow when both match the channel", async () => {
  const agents = [
    {
      code: "VF-SHADOW", status: "shadow", agent_class: "client_facing",
      channel: "sms", runtime: "anthropic", prompt: "Shadow prompt.",
      sort_order: 10, created_at: "2026-01-01T00:00:00Z"
    },
    {
      code: "VF-LIVE", status: "live", agent_class: "client_facing",
      channel: "sms", runtime: "anthropic", prompt: "Live prompt.",
      sort_order: 50, created_at: "2026-01-02T00:00:00Z"
    }
  ];
  const db = {
    async query(sql) {
      if (/FROM conversations/.test(sql)) return { rows: [] };
      if (/FROM agents/.test(sql) && /status IN/.test(sql)) return { rows: agents };
      return { rows: [] };
    }
  };
  const selected = await selectAgent(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    channel: "sms"
  });
  assert.equal(selected.agent.code, "VF-LIVE");
  assert.equal(selected.reason, "tiebreak_channel_match");
  assert.match(selected.detail, /VF-LIVE/);
  assert.match(selected.detail, /VF-SHADOW/);
});

test("selectAgent: when both live, lower sort_order wins", async () => {
  const agents = [
    {
      code: "B-AGENT", status: "live", agent_class: "client_facing",
      channel: "sms", runtime: "anthropic", prompt: "B",
      sort_order: 20, created_at: "2026-01-01T00:00:00Z"
    },
    {
      code: "A-AGENT", status: "live", agent_class: "client_facing",
      channel: "sms", runtime: "anthropic", prompt: "A",
      sort_order: 10, created_at: "2026-01-02T00:00:00Z"
    }
  ];
  const db = {
    async query(sql) {
      if (/FROM conversations/.test(sql)) return { rows: [] };
      if (/FROM agents/.test(sql) && /status IN/.test(sql)) return { rows: agents };
      return { rows: [] };
    }
  };
  const selected = await selectAgent(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    channel: "sms"
  });
  assert.equal(selected.agent.code, "A-AGENT");
  assert.equal(selected.reason, "tiebreak_channel_match");
});

test("FOS-01, the FinanceOS Money Helper, answers on its own path — never picked for an inbound text", async () => {
  const helper = {
    code: "FOS-01", status: "shadow", agent_class: "client_facing", channel: "sms",
    runtime: "internal", prompt: "You are the FinanceOS Money Helper.", sort_order: 150, created_at: "2026-10-07T00:00:00Z"
  };
  assert.equal(isEligibleAgent(helper, "sms"), false);
  const db = {
    async query(sql) {
      if (/FROM conversations/.test(sql)) return { rows: [] };
      if (/FROM agents/.test(sql) && /status IN/.test(sql)) return { rows: [helper] };
      return { rows: [] };
    }
  };
  const selected = await selectAgent(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    channel: "sms"
  });
  assert.equal(selected.agent, null);
  assert.equal(selected.reason, "no_eligible_agent");
});
