// The money helper's thread (src/finance/money-helper.mjs): who answers a
// message, what gets written, and what is never sent. An in-memory database
// stands in for Postgres; the client's records are the one sample file
// (fixtures/money-helper-context.sample.json, the FinanceOS test client).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  submitMessage, processTurn, executeActions, answerOrphans, claimNextTurn, viewTurn, reasonWords,
  bridgeStatus, BRIDGE_FRESH_MS, INLINE_AI_TIMEOUT_MS, TASK_SOURCE, DAILY_TURN_CAP, readBlueprintBuyer, actionLabel,
  MAX_INPUT_CHARS
} from "./money-helper.mjs";
import { HELPER_PROMPT, HELPER_GUARDRAILS, HELPER_SCHEMA } from "./money-agent-ai.mjs";
import { readDeclinePaste, MAX_PASTE_CHARS } from "./money-decline.mjs";
import { SAMPLE_DECLINE_LETTER } from "./money-agent-sim.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CTX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-helper-context.sample.json"), "utf8"));
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const BIZ_CHECKING = "c73daf51-36a8-4c25-a365-3b2281ae9fc7";
const AMEX = "d6ce2c94-3632-4c63-af98-802fef41ac62";
const NOW = new Date("2026-10-07T17:00:00.000Z");
const AGENT_ROW = { code: "FOS-01", name: "FinanceOS Money Helper", status: "shadow", prompt: HELPER_PROMPT, guardrails: HELPER_GUARDRAILS };

function world({ agentRow = AGENT_ROW, halted = null, today = 0, bridgeLast = null, queued = [], recent = [] } = {}) {
  const turns = new Map();
  let seq = 0;
  const w = {
    calls: [], turns, halt: null, pins: [], taskUpdates: [],
    async query(sql, params = []) {
      w.calls.push({ sql, params });
      if (/INSERT INTO messages|UPDATE messages/.test(sql)) throw new Error("the helper must never write a message");
      if (/FROM agents WHERE org_id = \$1 AND code = \$2/.test(sql)) return { rows: agentRow ? [agentRow] : [] };
      if (/FROM money_helper_threads WHERE client_id/.test(sql)) return { rows: halted ? [{ halted_at: NOW, halt_reason: halted }] : [] };
      if (/count\(\*\)::int AS n FROM money_helper_turns/.test(sql)) return { rows: [{ n: today }] };
      if (/FROM agent_bridge_heartbeats WHERE name/.test(sql)) return { rows: bridgeLast ? [{ last_at: bridgeLast }] : [] };
      if (/INSERT INTO money_helper_turns/.test(sql)) {
        const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
        const row = { id, org_id: params[0], client_id: params[1], kind: params[2], actor: params[3], staff_id: params[4], input: params[5], task_id: params[6], status: params[7], reply: null, actions: [], brain: null, model: null, reason: null, attempts: 0, created_at: NOW };
        turns.set(id, row);
        return { rows: [row] };
      }
      if (/FROM money_helper_turns\s+WHERE org_id = \$1 AND client_id = \$2 AND status IN \('answered', 'halted'\)/.test(sql)) return { rows: recent };
      if (/UPDATE money_helper_turns\s+SET status = \$2, reply = \$3/.test(sql)) {
        const t = turns.get(params[0]);
        Object.assign(t, { status: params[1], reply: params[2], actions: JSON.parse(params[3]), brain: params[4], model: params[5], reason: params[6], answered_at: params[8] });
        return { rows: [t] };
      }
      if (/UPDATE money_helper_turns SET status = 'running', claimed_at = now\(\)\s+WHERE org_id/.test(sql)) {
        const rows = queued.map((q) => { const t = { ...q, status: "running" }; turns.set(t.id, t); return t; });
        return { rows };
      }
      if (/INSERT INTO money_helper_threads/.test(sql)) { w.halt = params[2]; return { rows: [] }; }
      if (/INSERT INTO money_agent_pins/.test(sql)) { w.pins.push(params); return { rows: [{ id: `pin-${w.pins.length}` }] }; }
      if (/UPDATE money_agent_tasks/.test(sql)) { w.taskUpdates.push({ sql, params }); return { rows: [{ id: params[0] }] }; }
      throw new Error(`unexpected SQL: ${sql.slice(0, 140)}`);
    }
  };
  return w;
}

function spies() {
  const s = { shadow: [], runs: [], optOuts: [], tasks: [], asks: [], proposals: [], declines: [] };
  s.deps = {
    recordDecline: async (_db, args) => { s.declines.push(args); return { ok: true, created: true, decline_id: "decline-1" }; },
    readContext: async () => JSON.parse(JSON.stringify(CTX)),
    recordShadow: async (_db, row) => { s.shadow.push(row); return { id: "s" }; },
    recordRun: async (_db, row) => { s.runs.push(row); return { id: "r" }; },
    recordOptOut: async (_db, ...args) => { s.optOuts.push(args); },
    createTask: async (_db, args) => { s.tasks.push(args); return { created: true, id: "task-1" }; },
    askForPerson: async (_db, args) => { s.asks.push(args); return { ok: true, created: true, taskId: "task-ask" }; },
    proposeTransfer: async (_db, p) => { s.proposals.push(p); return { ok: true, created: true, proposalId: "prop-1", status: "needs_approval" }; }
  };
  return s;
}

function model(json) {
  const calls = [];
  const fn = async (args) => { calls.push(args); return { mode: "live", json, text: JSON.stringify(json), error: null, status: 200, servedModel: "claude-opus-5-5", request: { model: "claude-opus-5-5", provider: "anthropic", output_schema: true, system: "s", user: "u" } }; };
  fn.calls = calls;
  return fn;
}
const blank = { title: null, detail: null, date: null, pin_kind: null, amount_cents: null, from_account_id: null, to_account_id: null, task_id: null, reason: null };
const send = (w, s, input, extra = {}) => submitMessage(w, { orgId: ORG, clientId: CLIENT, input, actor: "client", now: NOW, deps: s.deps, ...extra });

describe("who answers a message", () => {
  test("no FOS-01 row → the helper is off", async () => {
    const r = await send(world({ agentRow: null }), spies(), "hi");
    assert.deepEqual([r.ok, r.error], [false, "helper_off"]);
  });

  test("a stopped thread takes no more messages", async () => {
    const r = await send(world({ halted: "stop" }), spies(), "hello?");
    assert.deepEqual([r.ok, r.error], [false, "helper_stopped"]);
  });

  test("an empty or a too-long message, and the daily cap", async () => {
    assert.equal((await send(world(), spies(), "  ")).error, "message_required");
    assert.equal((await send(world(), spies(), "x".repeat(2001))).error, "message_too_long");
    assert.equal((await send(world({ today: DAILY_TURN_CAP }), spies(), "hi")).error, "too_many");
  });

  test("Mac runner off (the default mode): the rules brain answers at once and says why", async () => {
    const w = world();
    const s = spies();
    const r = await send(w, s, "What is due this week?", { env: {} });
    assert.equal(r.ok, true);
    assert.equal(r.queued, false);
    assert.deepEqual([r.turn.status, r.turn.brain, r.turn.reason], ["answered", "rules", "bridge_off"]);
    assert.match(r.turn.reply, /Next up: Business Amex on Oct 15 \(\$135\.00\)/);
    assert.equal(s.shadow.length, 1);
    assert.deepEqual([s.shadow[0].reason, s.shadow[0].channel, s.shadow[0].agentCode], ["shadow_status", "in_app", "FOS-01"]);
    assert.equal(s.shadow[0].wouldSendBody, r.turn.reply, "the text it WOULD have sent is logged; nothing is sent");
    assert.deepEqual([s.runs[0].outcome, s.runs[0].mode, s.runs[0].triggerEvent], ["rules", "shadow", "money.helper.message"]);
  });

  test("Mac runner on: the turn is queued for it — nothing answered here", async () => {
    const w = world({ bridgeLast: new Date(NOW.getTime() - 5000) });
    const s = spies();
    let read = 0;
    s.deps.readContext = async () => { read += 1; return CTX; };
    const r = await send(w, s, "What is due?", { env: {} });
    assert.deepEqual([r.ok, r.queued, r.turn.status], [true, true, "queued"]);
    assert.equal(read, 0);
    assert.equal(s.shadow.length, 0);
  });

  test("a stale heartbeat is the Mac off", async () => {
    const b = await bridgeStatus(world({ bridgeLast: new Date(NOW.getTime() - BRIDGE_FRESH_MS - 1) }), { now: NOW });
    assert.equal(b.on, false);
  });

  test("server mode (the API funded): the AI answers inside the request, through callModel", async () => {
    const w = world();
    const s = spies();
    const fn = model({ reply: "Your Business Amex has $135.00 due Oct 15.", actions: [] });
    const r = await send(w, s, "What is due?", { env: { MONEY_HELPER_RUNNER: "server" }, callModelFn: fn });
    assert.deepEqual([r.turn.status, r.turn.brain, r.turn.model], ["answered", "ai", "claude-opus-5-5"]);
    assert.equal(fn.calls[0].provider, "anthropic");
    assert.equal(fn.calls[0].outputSchema, HELPER_SCHEMA);
    assert.equal(fn.calls[0].timeoutMs, INLINE_AI_TIMEOUT_MS);
  });
});

describe("STOP, a lawyer, a person", () => {
  test("STOP: one fixed answer, an SMS opt-out through the one writer, the thread stopped, no model", async () => {
    const w = world();
    const s = spies();
    const fn = model({ reply: "x", actions: [] });
    const r = await send(w, s, "STOP", { env: { MONEY_HELPER_RUNNER: "server" }, callModelFn: fn });
    assert.deepEqual([r.turn.status, r.turn.brain, r.turn.reason], ["halted", "rules", "intent:stop"]);
    assert.deepEqual(s.optOuts, [[CLIENT, ORG, "sms", "money_helper"]]);
    assert.equal(w.halt, "stop");
    assert.equal(fn.calls.length, 0);
    assert.equal(s.shadow[0].reason, "guardrail_halt");
    assert.deepEqual(r.turn.actions.map((a) => a.type), ["halt"]);
  });

  test("a lawyer: stopped, and a person gets a task — no opt-out written", async () => {
    const w = world();
    const s = spies();
    const r = await send(w, s, "I am talking to my attorney about this.");
    assert.equal(r.turn.status, "halted");
    assert.equal(w.halt, "legal");
    assert.equal(s.optOuts.length, 0);
    assert.deepEqual([s.tasks[0].sourceWorkflow, s.tasks[0].assigneeRole], [TASK_SOURCE, "csm"]);
  });

  test("a person: the Payments page's own askForPerson (one CSM task a day)", async () => {
    const s = spies();
    const r = await send(world(), s, "Can I talk to a real person please?");
    assert.deepEqual([r.turn.status, r.turn.brain, r.turn.reason], ["answered", "rules", "intent:person"]);
    assert.equal(s.asks.length, 1);
    assert.equal(s.tasks.length, 0);
  });
});

describe("a blocked AI answer", () => {
  test("rules answer the client; the AI's would-be text goes to the shadow log as guardrail_block", async () => {
    const s = spies();
    const fn = model({ reply: "You qualify for $50,000. You will get approved.", actions: [] });
    const r = await send(world(), s, "Can I get funded?", { env: { MONEY_HELPER_RUNNER: "server" }, callModelFn: fn });
    assert.equal(r.turn.brain, "rules");
    assert.match(r.turn.reason, /^ai_blocked/);
    assert.deepEqual(s.shadow.map((x) => x.reason), ["shadow_status", "guardrail_block"]);
    assert.equal(s.shadow[1].wouldSendBody, "You qualify for $50,000. You will get approved.");
    assert.equal(s.runs[0].outcome, "blocked_then_rules");
  });
});

describe("carrying out the actions", () => {
  const turnId = "00000000-0000-4000-8000-000000000042";

  test("a transfer is a PROPOSAL through W5's seam — the exact amount and where it goes, nothing moved", async () => {
    const s = spies();
    const out = await executeActions(world(), {
      orgId: ORG, clientId: CLIENT, turnId, todayIso: "2026-10-07", actor: "client", deps: s.deps,
      actions: [{ type: "propose_transfer", from_account_id: BIZ_CHECKING, to_account_id: AMEX, amount_cents: 540000, from_name: "Business Checking", to_name: "Business Amex", to_type: "credit", reason: "Pay the Amex in full" }]
    });
    assert.equal(s.proposals.length, 1);
    const p = s.proposals[0];
    assert.deepEqual(
      [p.taskKey, p.kind, p.source, p.amountCents, p.toKind, p.toAccountId, p.requestedByKind],
      [`helper:${turnId}`, "pay_down", "money-helper", 540000, "card", AMEX, "client"]
    );
    assert.match(p.taskKey, /^[a-z][a-z0-9_-]{0,40}:[A-Za-z0-9:._-]{1,200}$/, "W5's task id rule");
    assert.equal(p.detail.suggested_from_account_id, BIZ_CHECKING, "the from account is a suggestion; the client picks it at approval");
    assert.deepEqual([out[0].status, out[0].ref_id], ["needs_approval", "prop-1"]);
    assert.match(out[0].label, /needs your approval/);
  });

  test("a reminder and a plan step are pins keyed <turn>:<n>; a CSM task is the helper's own source", async () => {
    const w = world();
    const s = spies();
    const out = await executeActions(w, {
      orgId: ORG, clientId: CLIENT, turnId, todayIso: "2026-10-07", deps: s.deps,
      actions: [
        { type: "create_reminder", date: "2026-10-14", pin_kind: "other", title: "Pay Business Amex", detail: null, amount_cents: 13500 },
        { type: "schedule_pin", date: "2026-10-20", pin_kind: "pay_down", title: "Pay down Business Amex", detail: null, amount_cents: null },
        { type: "create_csm_task", title: "Client cannot pay yet", detail: "Help them make a plan." }
      ]
    });
    assert.deepEqual(w.pins.map((p) => [p[3], p[4], p[5], p[9]]), [
      ["reminder", "2026-10-14", "other", `money-helper:${turnId}:1`],
      ["plan", "2026-10-20", "pay_down", `money-helper:${turnId}:2`]
    ]);
    assert.deepEqual([s.tasks[0].sourceWorkflow, s.tasks[0].assigneeRole, s.tasks[0].eventId], [TASK_SOURCE, "csm", `money-helper:${turnId}:3`]);
    assert.deepEqual(out.map((a) => a.status), ["done", "done", "done"]);
    assert.equal(out[0].label, "Reminder for Oct 14: Pay Business Amex · $135.00");
  });

  test("in progress is W5's 'claimed', on a no-money agent row only", async () => {
    const w = world();
    await executeActions(w, { orgId: ORG, clientId: CLIENT, turnId, todayIso: "2026-10-07", deps: spies().deps, actions: [{ type: "mark_task_in_progress", task_id: "t1", title: "Step" }] });
    const sql = w.taskUpdates[0].sql;
    assert.match(sql, /SET status = 'claimed'/);
    assert.match(sql, /assignee = 'agent' AND moves_money = false AND status IN \('queued', 'claimed'\)/);
  });

  test("a role-play run is dry: nothing is written", async () => {
    const w = world();
    const out = await executeActions(w, { orgId: null, clientId: null, turnId: "sim", dry: true, actions: [{ type: "create_reminder", date: "2026-10-14", title: "Pay", pin_kind: "other" }] });
    assert.equal(w.calls.length, 0);
    assert.equal(out[0].status, "would_do");
  });
});

describe("never sends", () => {
  test("the thread module holds no send path at all", () => {
    const src = fs.readFileSync(path.join(HERE, "money-helper.mjs"), "utf8");
    assert.doesNotMatch(src, /sendTemplated|dispatchMessage|composeAgentReply|fetch\(/);
  });
});

describe("the queue and the screen's view", () => {
  test("claimNextTurn takes the oldest queued turn, skipping rows another runner holds", async () => {
    const seen = [];
    await claimNextTurn({ query: async (sql) => { seen.push(sql); return { rows: [] }; } });
    assert.match(seen[0], /status = 'queued'[\s\S]*ORDER BY created_at, id[\s\S]*FOR UPDATE SKIP LOCKED/);
  });

  test("a turn left queued with the Mac off is answered by rules on the next read", async () => {
    const old = { id: "00000000-0000-4000-8000-000000000099", org_id: ORG, client_id: CLIENT, kind: "message", actor: "client", staff_id: null, input: "What is due?", task_id: null, status: "queued", created_at: new Date(NOW.getTime() - 60000) };
    const w = world({ queued: [old] });
    const s = spies();
    const n = await answerOrphans(w, { orgId: ORG, clientId: CLIENT, env: {}, now: NOW, deps: s.deps });
    assert.equal(n, 1);
    assert.deepEqual([w.turns.get(old.id).status, w.turns.get(old.id).brain, w.turns.get(old.id).reason], ["answered", "rules", "bridge_off"]);
  });

  test("staff see the full reason; a client sees it in plain words", () => {
    const row = { id: "t", kind: "message", actor: "client", input: "x", status: "answered", reply: "y", actions: [], brain: "rules", model: null, reason: "ai_blocked: number_not_in_facts: $50,000", created_at: NOW, answered_at: NOW };
    assert.equal(viewTurn(row, { staff: true }).reason, "ai_blocked: number_not_in_facts: $50,000");
    assert.equal("reason" in viewTurn(row), false);
    assert.equal(viewTurn(row).reason_words, "Answered by the rules helper: the AI's answer broke one of its rules.");
    assert.equal(reasonWords("bridge_off"), "Answered by the rules helper: the AI helper's computer is off right now.");
    assert.equal(reasonWords(null), null);
  });

  test("processTurn on a client that is gone marks the turn failed, never invents an answer", async () => {
    const w = world();
    const s = spies();
    s.deps.readContext = async () => null;
    w.query = (orig => async (sql, params) => {
      if (/UPDATE money_helper_turns SET status = 'failed'/.test(sql)) return { rows: [{ id: params[0], status: "failed", reason: params[1] }] };
      return orig(sql, params);
    })(w.query.bind(w));
    const r = await processTurn(w, { id: "t9", org_id: ORG, client_id: CLIENT, kind: "message", input: "hi", status: "running" }, { now: NOW, useAi: false, agent: { ...AGENT_ROW }, deps: s.deps });
    assert.deepEqual([r.status, r.reason], ["failed", "client_not_found"]);
  });
});

describe("the agent row", () => {
  test("the shadow row's prompt is the one the brain sends", async () => {
    const s = spies();
    const fn = model({ reply: "Okay.", actions: [] });
    await send(world({ agentRow: { ...AGENT_ROW, prompt: "Edited in the Agent Editor. Be kind and brief." } }), s, "hi", { env: { MONEY_HELPER_RUNNER: "server" }, callModelFn: fn });
    assert.ok(fn.calls[0].system.startsWith("Edited in the Agent Editor."), "the live row wins over the in-code copy");
  });

  test("blank fields on the row fall back to the in-code prompt and guardrails", async () => {
    const s = spies();
    const fn = model({ reply: "Okay.", actions: [] });
    await send(world({ agentRow: { ...AGENT_ROW, prompt: " ", guardrails: {} } }), s, "hi", { env: { MONEY_HELPER_RUNNER: "server" }, callModelFn: fn });
    assert.ok(fn.calls[0].system.startsWith(HELPER_PROMPT.slice(0, 40)));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   A PASTED BANK DECLINE (Capital Blueprint launch B1b)
   ═══════════════════════════════════════════════════════════════════════════ */
describe("a pasted bank decline in the thread", () => {
  const PASTE = `I just got declined by Chase — here's the letter:\n\n${SAMPLE_DECLINE_LETTER}`;
  const paste = readDeclinePaste(PASTE);
  const turnId = "00000000-0000-4000-8000-000000000077";
  const save = { type: "record_decline", bank: "Chase", product: "Chase Ink Business Unlimited", letter_hash: paste.hash };
  const buyerCtx = (b) => ({ ...JSON.parse(JSON.stringify(CTX)), blueprintBuyer: b });
  const GOOD = [
    "I read your letter. These are the likely reasons, not sure ones.",
    "The bank saw too many recent credit checks on your report. It wrote: \"Too many inquiries on your credit report\".",
    "It also saw high balances compared to your card limits. It wrote: \"Proportion of balances to credit limits is too high on revolving accounts\".",
    "First, find Chase's reconsideration phone number. The letter gives this number: 800-555-0142.",
    "Next, call that line and ask about the recent application.",
    "I saved this decline, and your Fundhub funding team has the second look."
  ].join("\n");
  const SAVE_ANSWER = { reply: GOOD, actions: [{ ...blank, type: "record_decline", title: "Chase", detail: "Chase Ink Business Unlimited" }] };
  const SERVER = { MONEY_HELPER_RUNNER: "server" };

  test("record_decline goes through the Capital Blueprint's own paste path: the client's masked letter, the bank and product, source client_paste", async () => {
    const s = spies();
    const out = await executeActions(world(), { orgId: ORG, clientId: CLIENT, turnId, todayIso: "2026-10-07", actor: "client", declineText: paste.text, actions: [save], deps: s.deps });
    assert.equal(s.declines.length, 1);
    const call = s.declines[0];
    assert.deepEqual([call.orgId, call.clientId, call.source, call.by], [ORG, CLIENT, "client_paste", { kind: "client" }]);
    assert.deepEqual(call.input, { text: paste.text, bank: "Chase", product: "Chase Ink Business Unlimited" });
    assert.ok(!call.input.text.includes("4471902238"), "the letter that is saved is the masked one");
    assert.deepEqual([out[0].status, out[0].ref_id, out[0].letter_hash], ["done", "decline-1", paste.hash]);
    assert.equal(out[0].label, "Saved your Chase decline. Your Fundhub funding team has the second look");
    assert.equal(actionLabel(save), out[0].label);
  });

  test("a staff member typing on the client's thread is recorded as staff", async () => {
    const s = spies();
    await executeActions(world(), { orgId: ORG, clientId: CLIENT, turnId, todayIso: "2026-10-07", actor: "staff", staffId: "5a5a5a5a-0000-4000-8000-000000000001", declineText: paste.text, actions: [save], deps: s.deps });
    assert.deepEqual([s.declines[0].source, s.declines[0].by], ["staff", { kind: "staff", staffId: "5a5a5a5a-0000-4000-8000-000000000001" }]);
  });

  test("the same letter again is 'already saved', not a second decline; a refusal or a throw is 'not done', never a pretend success", async () => {
    const run = async (record) => (await executeActions(world(), { orgId: ORG, clientId: CLIENT, turnId, todayIso: "2026-10-07", declineText: paste.text, actions: [save], deps: { recordDecline: record } }))[0];
    const dup = await run(async () => ({ ok: true, created: false, duplicate: true, decline_id: "decline-0" }));
    assert.deepEqual([dup.status, dup.ref_id, dup.label], ["skipped", "decline-0", "Your Chase decline was already saved"]);
    const refused = await run(async () => ({ ok: false, error: "not_blueprint_buyer" }));
    assert.deepEqual([refused.status, refused.error], ["failed", "not_blueprint_buyer"]);
    const capped = await run(async () => ({ ok: false, error: "too_many_pastes" }));
    assert.equal(capped.error, "too_many_pastes");
    const threw = await run(async () => { throw Object.assign(new Error("Tell us which bank sent it."), { code: "bank_required" }); });
    assert.deepEqual([threw.status, threw.error], ["failed", "Tell us which bank sent it."]);
  });

  test("no letter handed over means nothing is saved; a role-play run is dry", async () => {
    const s = spies();
    const none = await executeActions(world(), { orgId: ORG, clientId: CLIENT, turnId, todayIso: "2026-10-07", actions: [save], deps: s.deps });
    assert.deepEqual([none[0].status, none[0].error, s.declines.length], ["failed", "no_letter", 0]);
    const dry = await executeActions(world(), { orgId: null, clientId: null, turnId: "sim", dry: true, actions: [save], deps: s.deps });
    assert.deepEqual([dry[0].status, s.declines.length], ["would_do", 0]);
  });

  test("a paid buyer's paste, start to end: answered by the AI, the letter stored masked with its lines, the decline saved once", async () => {
    const w = world();
    const s = spies();
    s.deps.readContext = async () => buyerCtx(true);
    const fn = model(SAVE_ANSWER);
    const r = await send(w, s, PASTE, { env: SERVER, callModelFn: fn });
    assert.equal(r.ok, true);
    assert.deepEqual([r.turn.status, r.turn.brain], ["answered", "ai"]);
    assert.equal(s.declines.length, 1);
    assert.equal(s.declines[0].input.bank, "Chase");
    assert.equal(s.declines[0].input.text, paste.text);
    assert.deepEqual(r.turn.actions.map((a) => [a.type, a.status, a.letter_hash]), [["record_decline", "done", paste.hash]]);
    const stored = [...w.turns.values()][0].input;
    assert.equal(stored, paste.text, "what the thread keeps is the masked letter, with its line breaks");
    assert.ok(stored.length > 1500 && stored.includes("\n") && !stored.includes("4471902238"));
    assert.match(fn.calls[0].user, /"client_is_blueprint_buyer": true/);
    assert.equal(s.shadow[0].inboundBody, stored, "the shadow log holds the masked letter too");
  });

  test("a client who has not bought: the letter is read and explained, nothing is saved, and the model's attempt to save it is refused", async () => {
    const w = world();
    const s = spies();
    s.deps.readContext = async () => buyerCtx(false);
    const r = await send(w, s, PASTE, { env: SERVER, callModelFn: model(SAVE_ANSWER) });
    assert.equal(r.turn.brain, "rules");
    assert.match(r.turn.reason, /record_decline:not_a_blueprint_buyer/);
    assert.equal(s.declines.length, 0);
    assert.match(r.turn.reply, /Capital Blueprint team can run the second look for you/);
    // A file whose Blueprint status could not be read is not a buyer either.
    const s2 = spies();
    s2.deps.readContext = async () => ({ ...buyerCtx(null) });
    const r2 = await send(world(), s2, PASTE, { env: SERVER, callModelFn: model(SAVE_ANSWER) });
    assert.equal(s2.declines.length, 0);
    assert.match(r2.turn.reason, /record_decline:not_a_blueprint_buyer/);
  });

  test("with the Mac off the rules brain still reads the letter, and saves it for a buyer", async () => {
    const w = world();
    const s = spies();
    s.deps.readContext = async () => buyerCtx(true);
    const r = await send(w, s, PASTE, { env: {} });
    assert.deepEqual([r.turn.brain, r.turn.reason], ["rules", "bridge_off"]);
    assert.equal(s.declines.length, 1);
    assert.match(r.turn.reply, /^I read your letter\./);
    assert.deepEqual(r.turn.actions.map((a) => [a.type, a.status]), [["record_decline", "done"]]);
  });

  test("a bank letter is long: it is let in up to the decline reader's cap, and nothing else is", async () => {
    const long = `${PASTE}\n\n${"Please keep this letter for your records. ".repeat(60)}`;
    assert.ok(long.length > MAX_INPUT_CHARS && long.length < MAX_PASTE_CHARS);
    const s = spies();
    s.deps.readContext = async () => buyerCtx(false);
    const ok = await send(world(), s, long, { env: SERVER, callModelFn: model(SAVE_ANSWER) });
    assert.equal(ok.ok, true, ok.error);
    // The same length of anything that is not a decline letter is still a chat message that is too long.
    const chat = "I have a question about my plan and what is due. ".repeat(60);
    assert.ok(chat.length > MAX_INPUT_CHARS);
    assert.equal((await send(world(), spies(), chat)).error, "message_too_long");
    assert.equal((await send(world(), spies(), "x".repeat(MAX_PASTE_CHARS + 1))).error, "message_too_long");
    assert.equal((await send(world(), spies(), `${PASTE}\n\n${"x ".repeat(MAX_PASTE_CHARS)}`)).error, "message_too_long", "past the reader's cap even a real letter is refused");
  });

  test("the bank's own unsubscribe and opt-out notices do not stop the helper or opt the client out of texts", async () => {
    const w = world();
    const s = spies();
    s.deps.readContext = async () => buyerCtx(false);
    const footer = `${PASTE}\n\nTo unsubscribe from marketing email, or to opt out of prescreened offers, call the number above. Questions about this notice may go to the Office of the Attorney General.`;
    const r = await send(w, s, footer, { env: SERVER, callModelFn: model({ reply: GOOD.replace(/\nI saved.*$/, ""), actions: [] }) });
    assert.equal(r.turn.status, "answered");
    assert.equal(w.halt, null);
    assert.equal(s.optOuts.length, 0);
    assert.equal(s.tasks.length + s.asks.length, 0, "no lawyer task, no person task");
    // The client's own STOP ahead of the letter does stop it.
    const w2 = world();
    const s2 = spies();
    const stopped = await send(w2, s2, `STOP\n\n${SAMPLE_DECLINE_LETTER}`, { env: SERVER, callModelFn: model(SAVE_ANSWER) });
    assert.equal(stopped.turn.status, "halted");
    assert.equal(w2.halt, "stop");
    assert.equal(s2.optOuts.length, 1);
  });

  test("a follow-up after a saved decline: the helper still has the analysis, and does not save the letter again", async () => {
    const earlier = { id: "00000000-0000-4000-8000-000000000060", kind: "message", input: paste.text, reply: GOOD, actions: [{ type: "record_decline", status: "done", bank: "Chase", letter_hash: paste.hash }], brain: "ai", status: "answered" };
    const w = world({ recent: [earlier] });
    const s = spies();
    s.deps.readContext = async () => buyerCtx(true);
    const fn = model({ reply: "Use the paydown plan in FinanceOS to choose which cards to pay first.", actions: [] });
    const r = await send(w, s, "What should I fix first?", { env: SERVER, callModelFn: fn });
    assert.equal(r.turn.brain, "ai", r.turn.reason);
    assert.match(fn.calls[0].user, /"already_saved": true/);
    assert.equal(s.declines.length, 0);
  });

  test("the Blueprint status read: true, false, and null when the read itself fails (never a guess)", async () => {
    const dbOf = (rows) => ({ query: async () => ({ rows }) });
    assert.equal(await readBlueprintBuyer(dbOf([{ "?column?": 1 }]), { orgId: ORG, clientId: CLIENT }), true);
    assert.equal(await readBlueprintBuyer(dbOf([]), { orgId: ORG, clientId: CLIENT }), false);
    assert.equal(await readBlueprintBuyer({ query: async () => { throw new Error("function resolve_product_id does not exist"); } }, { orgId: ORG, clientId: CLIENT }), null);
  });

  test("the thread module still holds no send path after the decline wiring", () => {
    const src = fs.readFileSync(path.join(HERE, "money-helper.mjs"), "utf8");
    assert.doesNotMatch(src, /sendTemplated|dispatchMessage|composeAgentReply|fetch\(/);
  });
});
