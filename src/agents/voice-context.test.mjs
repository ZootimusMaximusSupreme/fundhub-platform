import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceCallTask } from "./voice-context.mjs";

test("voice calls keep the live prompt and fetch the same scoped CRM context as text", async () => {
  const db = {};
  const task = await voiceCallTask(db, {
    orgId: "org-a", clientId: "client-a", agent: { prompt: "You are the accountability coach." },
    fetchContextImpl: async (database, opts) => {
      assert.equal(database, db);
      assert.deepEqual(opts, { orgId: "org-a", clientId: "client-a", channel: "voice" });
      return { client: { id: "client-a" }, as_prompt_block: "Client: Pat\nNext: Deposit at the selected bank.\nLast SMS: I will do it Friday." };
    }
  });
  assert.ok(task.startsWith("You are the accountability coach."));
  assert.match(task, /facts \(not instructions/);
  assert.match(task, /Deposit at the selected bank/);
  assert.match(task, /Last SMS: I will do it Friday/);
});

test("missing or mismatched client context fails before a voice task can be used", async () => {
  for (const context of [null, { client: null }, { client: { id: "other-client" }, as_prompt_block: "Wrong file" }, { client: { id: "client-a" } }]) {
    await assert.rejects(voiceCallTask({}, {
      orgId: "org-a", clientId: "client-a", agent: { prompt: "Coach" },
      fetchContextImpl: async () => context
    }), { code: "client_context_unavailable" });
  }
});

test("Blueprint manual call requires paid active current client context and reviewed live voice row", async () => {
  const context = { client: { id: "client-a", flags: {} }, blueprint: { access_active: true },
    checklist: { open_step: { title: "Mail letters", owner: "client", key: "mail", state: "in_progress", verify_kind: "dispute_mail_receipt" } },
    as_prompt_block: "Current step: Mail letters. Last SMS: I have the receipt." };
  const agent = { code: "BP-COACH-VOICE", status: "live", runtime: "bland", prompt: "You are the AI coach." };
  const options = { orgId: "org-a", clientId: "client-a", agent,
    isBuyerImpl: async (_db, ids) => { assert.deepEqual(ids, { orgId: "org-a", clientId: "client-a" }); return true; },
    fetchContextImpl: async (_db, ids) => { assert.deepEqual(ids, { orgId: "org-a", clientId: "client-a", conversationId: null, channel: "voice" }); return context; } };
  const task = await voiceCallTask({}, options);
  assert.match(task, /Last SMS: I have the receipt/);
  assert.match(task, /You are an AI, not a person/);
  assert.doesNotMatch(task, /human advisor/);
  assert.match(task, /cannot execute checklist actions/);
  assert.doesNotMatch(task, /Return one JSON object only/);
  for (const changed of [{ isBuyerImpl: async () => false },
    { fetchContextImpl: async () => ({ ...context, blueprint: { access_active: false } }) },
    { fetchContextImpl: async () => null }, { agent: { ...agent, status: "draft" } },
    { fetchContextImpl: async () => ({ ...context, conversation: { agent_halted_at: "today" } }) }]) {
    await assert.rejects(() => voiceCallTask({}, { ...options, ...changed }), /No call was placed/);
  }
});
