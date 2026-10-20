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
