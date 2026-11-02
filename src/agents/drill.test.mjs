import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCallSamples,
  gradeCallOutcome,
  isDrillAgent,
  runDrill
} from "./drill.mjs";

test("only the closer-drill ops agent may run, never the setter or inquiry", () => {
  assert.equal(isDrillAgent({
    code: "OP-06", agent_class: "ops", channel: "internal", status: "live"
  }), true);
  assert.equal(isDrillAgent({
    code: "AG-04", agent_class: "ops", channel: "internal", status: "live"
  }), false);
  assert.equal(isDrillAgent({
    code: "AG-09", agent_class: "client_facing", channel: "sms", status: "live"
  }), false);
  assert.equal(isDrillAgent({
    code: "OP-06", agent_class: "ops", channel: "sms", status: "live"
  }), false);
});

test("logged outcomes split easy paid vs hard missed", () => {
  assert.equal(gradeCallOutcome("deposit"), "easy");
  assert.equal(gradeCallOutcome("downsell"), "easy");
  assert.equal(gradeCallOutcome("callback"), "hard");
  assert.equal(gradeCallOutcome("not_a_fit"), "hard");
  assert.equal(gradeCallOutcome("no_show"), "other");
  const block = formatCallSamples([
    { outcome: "deposit", duration_seconds: 400, has_recording: true, has_words: true, notes: "paid start", transcript_excerpt: "three thousand is a start" },
    { outcome: "not_a_fit", belief_failed: "trust", has_recording: false }
  ]);
  assert.match(block, /Easy closes/);
  assert.match(block, /Hard closes/);
  assert.match(block, /DEPOSIT/i);
  assert.match(block, /words=yes/);
  assert.match(block, /three thousand/);
});

test("a draft coach does not run", async () => {
  const out = await runDrill({}, {
    orgId: "11111111-1111-4111-8111-111111111111",
    agent: { code: "OP-06", agent_class: "ops", channel: "internal", status: "draft", prompt: "x".repeat(80) },
    message: "Start D1"
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "not_live");
});

test("a live drill turn uses the model and real call rows", async () => {
  const db = {
    query: async (sql) => {
      if (/FROM call_outcomes/i.test(sql)) {
        return { rows: [{ outcome: "deposit", has_recording: false, notes: "start paid" }] };
      }
      return { rows: [] };
    }
  };
  const out = await runDrill(db, {
    orgId: "11111111-1111-4111-8111-111111111111",
    agent: {
      code: "OP-06",
      agent_class: "ops",
      channel: "internal",
      status: "live",
      prompt: "You are the closer drill coach. Play the buyer.",
      guardrails: { banned_buyer_lines: ["score will go up"] }
    },
    message: "Start D1",
    callModelFn: async ({ system, user }) => {
      assert.match(system, /Easy closes/);
      assert.match(user, /Start D1/);
      return { mode: "live", text: "I am the buyer. Why $32?", error: null };
    }
  });
  assert.equal(out.ok, true);
  assert.match(out.reply, /Why \$32/);
  assert.equal(out.call_samples.easy, 1);
});
