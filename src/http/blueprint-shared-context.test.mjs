import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { formatPromptBlock } from "../agents/context.mjs";
import { offersForClient } from "../config/offers.mjs";

const present = readFileSync(new URL("../../public/app/present.js", import.meta.url), "utf8");
const closer = readFileSync(new URL("../../public/app/closer-call.js", import.meta.url), "utf8");
const context = {
  client: { first_name: "Known", last_name: "Client" },
  blueprint: { access_active: true, payment: { status: "succeeded", amount_cents: 750000 },
    contract: { status: "signed", package_fee: "$7,500" }, human_advisor: { name: "Real Advisor" } },
  checklist: { open_step: { title: "Upload mailing proof", state: "in_progress", verify_kind: "dispute_mail_receipt" }, open_count: 1 },
  recent_messages: [
    { direction: "outbound", sender_kind: "agent", sender_agent_code: "COACH", channel: "sms", status: "queued", body: "Please upload the mailing proof" },
    { direction: "outbound", channel: "voice", status: "completed", body: "Bland call: client will upload tomorrow <script>bad()</script>" }
  ],
  recent_calls: [{ outcome: "callback", notes: "Ask about the receipt", transcript: "I saved the receipt", logged_at: "2026-10-20" }],
  open_tasks: [{ title: "Advisor review", detail: "Check the uploaded receipt" }]
};
context.as_prompt_block = formatPromptBlock(context);
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function renderPresent(response) {
  const root = { innerHTML: "" };
  const reads = [];
  const sandbox = {
    URLSearchParams, console, clearTimeout,
    setTimeout: () => 1,
    location: { search: "?contact=known-client", pathname: "/app/present.html" },
    document: { readyState: "complete", getElementById: (id) => id === "app" ? root : null, addEventListener() {} },
    localStorage: { getItem: () => "closer" },
    FHData: { async read(key, query) {
      reads.push({ key, query });
      return key === "agent-context" ? response : { ok: true, data: { survey: { name: "Known Client" }, offers: offersForClient(), engine: { available: false, fico: {}, reasons: [] } } };
    } },
    addEventListener() {}
  };
  sandbox.window = sandbox;
  vm.runInNewContext(present, sandbox);
  await flush();
  await flush();
  return { html: root.innerHTML, reads };
}

function renderCloser(responseContext, message = null) {
  function node(tag) {
    return {
      tag, children: [], attrs: {}, textContent: "", parent: null,
      setAttribute(key, value) { this.attrs[key] = value; },
      appendChild(child) { child.parent = this; this.children.push(child); },
      remove() { this.parent.children = this.parent.children.filter((child) => child !== this); },
      querySelector(selector) {
        const key = selector.slice(1, -1);
        for (const child of this.children) {
          if (Object.hasOwn(child.attrs, key)) return child;
          const found = child.querySelector(selector);
          if (found) return found;
        }
        return null;
      }
    };
  }
  const root = node("section");
  const start = closer.indexOf("  function paintSharedContext(");
  const end = closer.indexOf("  function wireDisposition(", start);
  assert.ok(start > 0 && end > start);
  const sandbox = { document: { createElement: node }, $: () => root };
  vm.runInNewContext(closer.slice(start, end), sandbox);
  sandbox.paintSharedContext(responseContext, message);
  const body = root.querySelector("[data-fh-context-lines]");
  return { text: body.children.map((child) => child.textContent).join("\n"), body };
}

test("Closer Dashboard and Present show the identical canonical Blueprint context", async () => {
  const shown = await renderPresent({ ok: true, data: { context } });
  assert.ok(shown.reads.some((r) => r.key === "agent-context" && r.query.client_id === "known-client"));
  for (const phrase of ["Human advisor: Real Advisor", "signed · $7,500", "Upload mailing proof", "sms · queued", "Bland call:", "I saved the receipt", "Advisor review"]) {
    assert.ok(shown.html.includes(phrase), phrase);
  }
  assert.ok(shown.html.includes("&lt;script&gt;bad()&lt;/script&gt;"));
  assert.ok(!shown.html.includes("<script>bad()</script>"));
  const dashboard = renderCloser(context);
  assert.equal(dashboard.text, context.as_prompt_block);
  assert.ok(dashboard.body.children.every((child) => child.tag === "p"), "message content must stay text, never executable markup");
});

test("both shared-context panels show a read failure instead of fake missing access or advisor", async () => {
  const failure = "The shared client file could not be loaded. Reload to try again.";
  const shown = await renderPresent({ ok: false, error: "read_failed" });
  assert.ok(shown.html.includes(failure));
  assert.ok(!shown.html.includes("Capital Blueprint access: not active"));
  assert.ok(!shown.html.includes("Human advisor: not assigned"));
  assert.equal(renderCloser(null, failure).text, failure);
});
