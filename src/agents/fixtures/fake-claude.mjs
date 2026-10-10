#!/usr/bin/env node
// A FAKE `claude` command for src/agents/claude-code.test.mjs and
// src/marketing/run-queue.test.mjs. No network, no real Claude Code, no model.
//
// It reads the prompt on stdin, writes one JSON line per run to FAKE_CLAUDE_LOG
// (its arguments, its working folder, the prompt, and whether an Anthropic key reached
// it), then answers the way `claude -p --output-format json|stream-json` does.
//
// FAKE_CLAUDE_MODE picks the answer:
//   text            a plain result
//   json            {"ok":true,"n":3}
//   json-bad-once   not JSON on the first run (FAKE_CLAUDE_STATE counts), then json
//   json-bad        never JSON
//   web             stream-json: one WebSearch, one WebFetch, then a JSON answer
//   error           a result marked is_error (a usage limit)
//   sleep           never answers (for the timeout)
//   crash           exits 2 with words on stderr and no result

import fs from "node:fs";

const mode = process.env.FAKE_CLAUDE_MODE || "text";
const logFile = process.env.FAKE_CLAUDE_LOG || "";
const stateFile = process.env.FAKE_CLAUDE_STATE || "";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { input += d; });
process.stdin.on("end", () => {
  let run = 1;
  if (stateFile) {
    try { run = Number(fs.readFileSync(stateFile, "utf8")) + 1; } catch { run = 1; }
    fs.writeFileSync(stateFile, String(run));
  }
  if (logFile) {
    fs.appendFileSync(logFile, JSON.stringify({
      run, args: process.argv.slice(2), cwd: process.cwd(), prompt: input,
      anthropicKey: process.env.ANTHROPIC_API_KEY != null || process.env.ANTHROPIC_AUTH_TOKEN != null,
      hasPath: !!process.env.PATH
    }) + "\n");
  }
  answer(run);
});

function result(text, extra = {}) {
  return {
    type: "result", subtype: "success", is_error: false, result: text,
    session_id: "fake", total_cost_usd: 1.23,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 },
    ...extra
  };
}

function answer(run) {
  switch (mode) {
    case "text":
      process.stdout.write(JSON.stringify(result("Hello from the fake.")));
      return;
    case "json":
      process.stdout.write(JSON.stringify(result('{"ok":true,"n":3}')));
      return;
    case "json-bad-once":
      process.stdout.write(JSON.stringify(result(run === 1 ? "Sure! Here it is: not json" : '```json\n{"ok":true,"n":4}\n```')));
      return;
    case "json-bad":
      process.stdout.write(JSON.stringify(result('{"ok":"yes"}')));
      return;
    case "web": {
      const lines = [
        { type: "system", subtype: "init" },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "WebSearch", input: { query: "business funding" } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content:
          'Web search results for query: "business funding"\n\nLinks: [{"title":"Funding Guide","url":"https://example.com/guide"},{"title":"SBA","url":"https://www.sba.gov/funding-programs"}]' }] } },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "WebFetch", input: { url: "https://example.com/guide", prompt: "read it" } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "Most owners are turned down because their credit file is thin." }] }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "done" }] } },
        result('{"findings":[{"claim":"Thin files get turned down","url":"https://example.com/guide"}]}')
      ];
      process.stdout.write(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
      return;
    }
    case "error":
      process.stdout.write(JSON.stringify(result("Claude AI usage limit reached|1760000000", { is_error: true })));
      return;
    case "sleep":
      setTimeout(() => {}, 600000);
      return;
    case "crash":
      process.stderr.write("fake crash: something went wrong\n");
      process.exit(2);
      return;
    default:
      process.stdout.write(JSON.stringify(result(`unknown mode ${mode}`)));
  }
}
