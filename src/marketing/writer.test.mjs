// The script writer (spec §7.6), with a fake fetch and a fake store: no network, no
// database. The real callModel (src/agents/model.mjs) builds every request, so what the
// fake fetch sees is exactly what Anthropic would get. The real rule files are read from
// the repo (no GITHUB_REPO_TOKEN in these envs, so GitHub is never called).
//
// The database half (the save under partner row security, no transaction open during a
// model call, no repo write) is src/http/marketing-writer.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { callModel } from "../agents/model.mjs";
import { SLO_PRICE_CENTS, SLO_LIST_PRICE_CENTS } from "../slo/offer.mjs";
import { OFFERS } from "../config/offers.mjs";
import { JOB_KINDS } from "./job-kinds.mjs";
import {
  writeSlot, fixScript, runWriteSlot, runFixScript, makeStore, failureOf,
  SAVE_SCRIPT_SCHEMA, JUDGE_SCHEMA, DEFAULT_WRITER_MODEL, DEFAULT_CHECK_MODEL,
  WRITER_TIMEOUT_MS, WRITER_MAX_TOKENS, STRICT_ROUNDS, COST_CAP_REASON, COST_CAP_BUZZ_KIND
} from "./writer.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const PARTNER = "00000000-0000-4000-8000-000000000002";
const BATCH = "00000000-0000-4000-8000-000000000003";
const SCRIPT = "00000000-0000-4000-8000-000000000004";
const IDEA = "00000000-0000-4000-8000-000000000005";

const ENV = Object.freeze({ OPENAI_API_KEY: "sk-openai-test-not-real", ANTHROPIC_API_KEY: "sk-ant-test-not-real" });

const FUNNELS = {
  roadmap_147: { key: "roadmap_147", name: "Roadmap", landing_url: "https://apply.fundhub.ai/roadmap", offer_key: "slo_roadmap", lane: "uwiq", book_call: false, cta_type: "LEARN_MORE", active: true },
  book_call: { key: "book_call", name: "Book a call", landing_url: "https://apply.fundhub.ai/watch", offer_key: "funding_dfy", lane: "sorting", book_call: true, cta_type: "LEARN_MORE", active: true }
};
const SETTINGS = { org_id: ORG, max_batch_cost_usd: "40", max_month_cost_usd: "300", quiet_start: "21:00", quiet_end: "07:00", timezone: "America/Phoenix", format_style: { standard: "bullets", sorting: "words" } };
const BATCH_ROW = { id: BATCH, org_id: ORG, kind: "on_command", status: "writing", rules_sha: null, total: 3 };
const SLOT = { n: 1, funnel_key: "roadmap_147", script_format: "standard", style: "bullets", source: "fresh_angle", angle_key: "the_conveyor_belt", idea_id: null, reason: "Not run in 30 days." };

// ── A draft that passes every code check (standard, bullets) ─────────────────────────

const HOOK = "Lenders read two files before they say yes, and you have probably only fixed one of them.";
const LINE2 = "Which one they read FIRST sets how much funding you can get.";
const CUES = [
  "Your personal file shows every card balance",
  "Your business file shows how long the company has been open",
  "On bigger lines the business file gets read first"
];
const REVEAL = "So fix the file they read first, and the rest gets easier ↑";
const CTA = "Tap below to get your Roadmap. It is a soft pull only, so there is zero impact on your score, and nothing moves until you say so.";

function goodDraft({ hook = HOOK, cta = CTA, cues = CUES, extra = {} } = {}) {
  const body = [hook, "", LINE2, "", ...cues.map((c) => `- ${c}`), "", REVEAL, "", cta].join("\n");
  return {
    title: "The Conveyor Belt",
    angle_key: "the_conveyor_belt",
    hook_key: "lenders_read_two_files",
    offer_key: "slo_roadmap",
    lane: "uwiq",
    script_format: "standard",
    style: "bullets",
    body,
    parts: [
      { kind: "hook", text: hook }, { kind: "line2", text: LINE2 },
      ...cues.map((t) => ({ kind: "cue", text: t })),
      { kind: "reveal", text: REVEAL }, { kind: "cta", text: cta }
    ],
    meta_copy: {
      primary_text: "Lenders read two files before they say yes. See what both of yours say first.",
      headline: "See both files first",
      description: "Your Funding Roadmap",
      cta_type: "LEARN_MORE"
    },
    animation_plan: [
      { anchor: { phrase: null, cue: 1, keyword: "personal" }, template: "FileItems", props: "{}", seconds: 2.5 },
      { anchor: { phrase: null, cue: 3, keyword: "first" }, template: "StepPath", props: "{\"eyebrow\":\"What lenders read\"}", seconds: 3 }
    ],
    ...extra
  };
}

// ── The fake Anthropic ────────────────────────────────────────────────────────────────

const message = ({ model, text, stop = "end_turn", content, stopDetails = null }) => ({
  id: "msg_test", type: "message", role: "assistant", model,
  content: content ?? [{ type: "text", text }],
  stop_reason: stop, stop_details: stopDetails,
  usage: { input_tokens: 1200, output_tokens: 800, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 }
});

/**
 * writer: a list of replies for the writer, used in order (the last one repeats).
 *   each is an object (sent as JSON), or {raw: <message fields>} or {status, body}
 * judge: the same, for the judge (default: no violations)
 */
function fakeAnthropic({ writer = [goodDraft()], judge = [{ violations: [] }], served = null, tick = null } = {}) {
  const calls = [];
  let w = 0;
  let j = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const isJudge = !!body.output_config?.format?.schema?.properties?.violations;
    calls.push({ url: String(url), body, headers: init.headers, kind: isJudge ? "judge" : "writer" });
    if (tick) tick(isJudge ? "judge" : "writer");
    const list = isJudge ? judge : writer;
    const reply = list[Math.min(isJudge ? j++ : w++, list.length - 1)];
    const model = served || body.model;
    if (reply && reply.status) {
      return { ok: false, status: reply.status, json: async () => reply.body ?? { type: "error", error: { type: "api_error", message: "boom" } } };
    }
    const msg = reply && reply.raw
      ? message({ model, ...reply.raw })
      : message({ model, text: JSON.stringify(reply) });
    return { ok: true, status: 200, json: async () => msg };
  };
  return { fetchImpl, calls };
}

// ── The fake store ────────────────────────────────────────────────────────────────────

function fakeStore(over = {}) {
  const log = { saves: [], fixes: [], usage: [], buzzes: [], ideaFailed: [], screens: [], cost: 0 };
  const store = {
    loadSlotContext: async ({ slot }) => ({
      batch: BATCH_ROW, settings: SETTINGS, funnel: FUNNELS[slot.funnel_key] || null, partnerId: PARTNER,
      idea: null, recent: [], siblings: [], examples: []
    }),
    loadFixContext: async () => ({
      script: {
        id: SCRIPT, org_id: ORG, partner_id: PARTNER, version: 2, root_script_id: SCRIPT, ad_id: null, status: "draft",
        source: "machine", archived_at: null, title: "The Conveyor Belt", body: goodDraft().body, parts: goodDraft().parts,
        meta_copy: goodDraft().meta_copy, animation_plan: [], script_format: "standard", style: "bullets",
        funnel_key: "roadmap_147", batch_id: BATCH, idea_id: null, angle_key: "the_conveyor_belt", hook_key: "x_hook",
        offer_key: "slo_roadmap", lane: "uwiq"
      },
      batch: BATCH_ROW, settings: SETTINGS, funnel: FUNNELS.roadmap_147, partnerId: PARTNER, recent: [], siblings: [], examples: []
    }),
    screenCopy: async (args) => {
      log.screens.push(args);
      return { state: "needs_approval", reasons: [{ code: "human_approval_required_setting", rule_set: "approval", message: "A human approves first." }] };
    },
    saveDraft: async (args) => {
      log.saves.push(args);
      return { id: "11111111-1111-4111-8111-111111111111", root_script_id: "11111111-1111-4111-8111-111111111111", version: 1, status: "draft", source: "machine", check_results: args.checkResults };
    },
    saveFix: async (args) => {
      log.fixes.push(args);
      return { id: "22222222-2222-4222-8222-222222222222", version: args.parentVersion + 1, status: "draft", ad_id: null, root_script_id: SCRIPT };
    },
    markIdeaFailed: async (args) => { log.ideaFailed.push(args); },
    logUsage: async (row) => { log.usage.push(row); },
    costStatus: async () => ({ batch_usd: 0, month_usd: 0, unpriced_rows: 0, batch_capped: false, month_capped: false }),
    buzzOnce: async (b) => { log.buzzes.push(b); return { queued: true }; },
    ...over
  };
  return { store, log };
}

/** Runs writeSlot with a spy on callModel. */
async function write({ env = ENV, slot = SLOT, writer, judge, served, tick, store: over, deps = {} } = {}) {
  const ai = fakeAnthropic({ writer, judge, served, tick });
  const { store, log } = fakeStore(over);
  const modelArgs = [];
  const spy = async (args) => { modelArgs.push(args); return callModel(args); };
  const out = await writeSlot(null, env, { batch: BATCH_ROW, slot }, { orgId: ORG, store, fetchImpl: ai.fetchImpl, callModel: spy, ...deps });
  return { out, ai, log, modelArgs, writerArgs: modelArgs.filter((a) => a.outputSchema === SAVE_SCRIPT_SCHEMA), judgeArgs: modelArgs.filter((a) => a.outputSchema === JUDGE_SCHEMA) };
}

/** A slot context whose slot came from one of Chris's ideas. */
const ideaCtx = (extra = {}) => async () => ({
  batch: BATCH_ROW, settings: SETTINGS, funnel: FUNNELS.roadmap_147, partnerId: PARTNER,
  idea: { id: IDEA, raw_points: "Lenders look at two files.", topic: null, angle_key: null, status: "new" },
  recent: [], siblings: [], examples: [], ...extra
});
const IDEA_SLOT = { ...SLOT, idea_id: IDEA, angle_key: null, source: "chris_idea" };

/** The user turn of the Nth writer request. */
const userOf = (ai, n = 0) => ai.calls.filter((c) => c.kind === "writer")[n].body.messages[0].content;

// ── The call ──────────────────────────────────────────────────────────────────────────

describe("the writer's call (M1 Done #5)", () => {
  test("with OpenAI and Anthropic keys both set, only api.anthropic.com is called", async () => {
    const { out, ai } = await write();
    assert.ok(out.script_id, JSON.stringify(out));
    assert.ok(ai.calls.length >= 2, "a writer call and a judge call");
    for (const c of ai.calls) assert.equal(new URL(c.url).host, "api.anthropic.com", c.url);
  });

  test("callModel gets provider anthropic, the model, effort medium, 16000 tokens, 5 minutes, cache and SAVE_SCRIPT_SCHEMA", async () => {
    const { writerArgs } = await write();
    assert.equal(writerArgs.length, 1);
    const a = writerArgs[0];
    assert.equal(a.provider, "anthropic");
    assert.equal(a.model, DEFAULT_WRITER_MODEL);
    assert.equal(DEFAULT_WRITER_MODEL, "claude-opus-5-5");
    assert.equal(a.effort, "medium");
    assert.equal(a.maxTokens, 16000);
    assert.equal(WRITER_MAX_TOKENS, 16000);
    assert.equal(a.timeoutMs, 300000);
    assert.equal(WRITER_TIMEOUT_MS, 300000);
    assert.equal(a.cache, true);
    assert.equal(a.outputSchema, SAVE_SCRIPT_SCHEMA);
    assert.equal(a.toolChoice, undefined);
    assert.equal(a.tools, undefined);
  });

  test("the wire request: structured output with the schema, cached system, no tool_choice, no tools", async () => {
    const { ai } = await write();
    for (const c of ai.calls) {
      assert.equal("tool_choice" in c.body, false, "no request carries a forced tool_choice");
      assert.equal("tools" in c.body, false);
      assert.equal("thinking" in c.body, false);
      assert.equal(c.body.output_config.effort, "medium");
      assert.equal(c.body.max_tokens, 16000);
      assert.deepEqual(c.body.system[0].cache_control, { type: "ephemeral" });
    }
    const w = ai.calls.find((c) => c.kind === "writer");
    assert.equal(w.body.model, "claude-opus-5-5");
    assert.deepEqual(w.body.output_config.format, { type: "json_schema", schema: JSON.parse(JSON.stringify(SAVE_SCRIPT_SCHEMA)) });
  });

  test("MARKETING_WRITER_MODEL and MARKETING_CHECK_MODEL are used when set", async () => {
    const { writerArgs, judgeArgs } = await write({ env: { ...ENV, MARKETING_WRITER_MODEL: "claude-opus-5", MARKETING_CHECK_MODEL: "claude-opus-5-5" } });
    assert.equal(writerArgs[0].model, "claude-opus-5");
    assert.equal(judgeArgs[0].model, "claude-opus-5-5");
  });

  test("the schema closes every object and requires every key", () => {
    const walk = (node, path) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "object") {
        assert.equal(node.additionalProperties, false, `${path} must be closed`);
        assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path} must require every key`);
      }
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    walk(SAVE_SCRIPT_SCHEMA, "save_script");
    walk(JUDGE_SCHEMA, "judge");
    assert.deepEqual([...SAVE_SCRIPT_SCHEMA.required].sort(), [
      "angle_key", "animation_plan", "body", "hook_key", "lane", "meta_copy", "offer_key", "parts", "script_format", "style", "title"
    ]);
    assert.deepEqual([...SAVE_SCRIPT_SCHEMA.properties.meta_copy.required].sort(), ["cta_type", "description", "headline", "primary_text"]);
    assert.deepEqual([...SAVE_SCRIPT_SCHEMA.properties.animation_plan.items.required].sort(), ["anchor", "props", "seconds", "template"]);
    assert.ok(Object.isFrozen(SAVE_SCRIPT_SCHEMA.properties.meta_copy), "the schema cannot be changed by a caller");
  });

  test("a reply with no parseable JSON is retried once", async () => {
    const { out, ai, log } = await write({ writer: [{ raw: { text: "Here is your script!" } }, goodDraft()] });
    assert.ok(out.script_id);
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 2);
    assert.equal(log.saves.length, 1);
  });

  test("a reply with no parseable JSON twice fails the slot in plain words, nothing saved", async () => {
    const { out, ai, log } = await write({ writer: [{ raw: { text: "nope" } }, { raw: { text: "still nope" } }] });
    assert.equal(out.failed, true);
    assert.equal(out.temporary, false);
    assert.match(out.reason, /had no script in it, twice/);
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 2);
    assert.equal(log.saves.length, 0);
  });

  test("a refusal fails the slot with its category, no retry", async () => {
    const { out, ai, log } = await write({
      writer: [{ raw: { content: [], stop: "refusal", stopDetails: { type: "refusal", category: "cyber", explanation: "x" } } }]
    });
    assert.equal(out.failed, true);
    assert.equal(out.category, "cyber");
    assert.match(out.reason, /refused.*category: cyber/);
    assert.equal(ai.calls.length, 1);
    assert.equal(log.saves.length, 0);
    assert.equal(log.usage.length, 1, "a refused call still got an answer, so it is logged");
  });

  test("a server error is temporary: writeSlot says so and the job handler throws so the queue retries", async () => {
    const { out } = await write({ writer: [{ status: 529 }] });
    assert.equal(out.failed, true);
    assert.equal(out.temporary, true);
    assert.match(out.reason, /server error/);

    const ai = fakeAnthropic({ writer: [{ status: 500 }] });
    const { store } = fakeStore();
    await assert.rejects(
      runWriteSlot({ id: "job-1", org_id: ORG, payload: { batch_id: BATCH_ROW, slot: SLOT } }, { db: null, env: ENV, deps: { store, fetchImpl: ai.fetchImpl } }),
      /server error/
    );
  });

  test("failureOf names a timeout in minutes", () => {
    const f = failureOf({ error: "anthropic timeout: no answer from Claude after 300000 ms, so the request was stopped." }, WRITER_TIMEOUT_MS);
    assert.deepEqual(f, { kind: "temporary", reason: "The writer stopped: the model took longer than 5 minutes." });
  });

  test("a missing Anthropic key fails before any call, in plain words, and leaves the idea alone", async () => {
    const { out, ai, log } = await write({ env: { OPENAI_API_KEY: "sk-openai-test-not-real" }, slot: IDEA_SLOT, store: { loadSlotContext: ideaCtx() } });
    assert.equal(out.failed, true);
    assert.equal(out.temporary, true, "a setup fault is the machine's: the job runs again, then Retry works");
    assert.match(out.reason, /ANTHROPIC_API_KEY is not set/);
    assert.match(out.reason, /setup problem, not the idea\. Fix it, then press Retry/);
    assert.equal(ai.calls.length, 0, "OpenAI is never called instead");
    assert.deepEqual(log.ideaFailed, [], "the idea is not marked failed");
  });
});

// ── Setup faults never burn an idea (review U24-R1) ───────────────────────────────────

describe("a setup fault is the machine's problem, not the idea's", () => {
  /** Runs the write_slot job handler on an idea slot. */
  async function runJob({ env = ENV, writer = [goodDraft()], store: over = {}, deps = {} } = {}) {
    const ai = fakeAnthropic({ writer });
    const { store, log } = fakeStore({ loadSlotContext: ideaCtx(), ...over });
    const job = { id: "job-setup", org_id: ORG, payload: { batch_id: BATCH_ROW, slot: IDEA_SLOT } };
    let thrown = null;
    let out = null;
    try {
      out = await runWriteSlot(job, { db: null, env, deps: { store, fetchImpl: ai.fetchImpl, ...deps } });
    } catch (e) {
      thrown = e;
    }
    return { thrown, out, ai, log };
  }

  test("a masked key: the job throws (so it lands in 'failed' and Retry works), no call, the idea untouched", async () => {
    const { thrown, ai, log } = await runJob({ env: { OPENAI_API_KEY: "sk-openai-test-not-real", ANTHROPIC_API_KEY: "****************abcd" } });
    assert.ok(thrown, "the handler throws");
    assert.match(thrown.message, /ANTHROPIC_API_KEY is masked/);
    assert.equal(ai.calls.length, 0);
    assert.deepEqual(log.ideaFailed, []);
    assert.equal(log.saves.length, 0);
  });

  for (const status of [400, 401, 403]) {
    test(`HTTP ${status} from Anthropic: the job throws, the idea untouched`, async () => {
      const { thrown, ai, log } = await runJob({
        writer: [{ status, body: { type: "error", error: { type: status === 401 ? "authentication_error" : "invalid_request_error", message: "turned away" } } }]
      });
      assert.ok(thrown, "the handler throws");
      assert.match(thrown.message, new RegExp(`HTTP ${status}`));
      assert.match(thrown.message, /press Retry/);
      assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 1, "no second call: waiting will not fix it");
      assert.deepEqual(log.ideaFailed, []);
    });
  }

  test("rule files nobody can read: the job throws before any call, the idea untouched", async () => {
    const readRuleFiles = async () => ({
      rules: "", voice: "", recipes: "", catalog: [], angles: [], bannedLive: [],
      missing: ["marketing/ads/RULES.md", "marketing/broll/catalog.json"], source: { sha: null, from: null }
    });
    const { thrown, ai, log } = await runJob({ deps: { readRuleFiles } });
    assert.ok(thrown);
    assert.match(thrown.message, /could not read marketing\/ads\/RULES\.md and marketing\/broll\/catalog\.json/);
    assert.equal(ai.calls.length, 0);
    assert.deepEqual(log.ideaFailed, []);
  });

  test("no funnel or no house partner: the job throws, the idea untouched", async () => {
    for (const extra of [{ funnel: null }, { partnerId: null }]) {
      const { thrown, ai, log } = await runJob({ store: { loadSlotContext: ideaCtx(extra) } });
      assert.ok(thrown, JSON.stringify(extra));
      assert.equal(ai.calls.length, 0);
      assert.deepEqual(log.ideaFailed, []);
    }
  });

  test("a refusal is still the script's: the job is done, the idea is marked failed", async () => {
    const { thrown, out, log } = await runJob({ writer: [{ raw: { content: [], stop: "refusal", stopDetails: { category: "cyber" } } }] });
    assert.equal(thrown, null);
    assert.equal(out.failed, true);
    assert.equal(out.temporary, false);
    assert.deepEqual(log.ideaFailed.map((x) => x.ideaId), [IDEA]);
  });

  test("fixScript: a setup fault is temporary too", async () => {
    const ai = fakeAnthropic();
    const { store } = fakeStore();
    const out = await fixScript(null, { ANTHROPIC_API_KEY: "****************abcd" }, { script_id: SCRIPT, version: 2, note: "shorter" }, { orgId: ORG, store, fetchImpl: ai.fetchImpl });
    assert.equal(out.failed, true);
    assert.equal(out.temporary, true);
    assert.equal(ai.calls.length, 0);
  });
});

// ── The check loop ────────────────────────────────────────────────────────────────────

describe("the check loop", () => {
  test("a clean draft: one writer call, one judge call, saved as a draft that is not flagged", async () => {
    const { out, ai, log, judgeArgs } = await write();
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 1);
    assert.equal(ai.calls.filter((c) => c.kind === "judge").length, 1);
    assert.equal(out.flagged, false, JSON.stringify(out.check_results.flag_reasons));
    const cr = out.check_results;
    assert.equal(cr.strict.passed, true);
    assert.equal(cr.strict.rounds, 0);
    assert.equal(cr.judge.ran, true);
    assert.equal(cr.judge.passed, true);
    assert.equal(cr.animation.passed, true);
    assert.equal(cr.compliance.copy_blocked, false);
    assert.equal(judgeArgs[0].model, DEFAULT_CHECK_MODEL);
    assert.equal(DEFAULT_CHECK_MODEL, "claude-sonnet-5-5");
    assert.equal(judgeArgs[0].effort, "medium");
    assert.equal(judgeArgs[0].provider, "anthropic");
    assert.equal(judgeArgs[0].outputSchema, JUDGE_SCHEMA);
    const d = log.saves[0].draft;
    assert.equal(d.script_format, "standard");
    assert.equal(d.style, "bullets");
    assert.equal(d.funnel_key, "roadmap_147");
    assert.equal(d.lane, "uwiq");
    assert.equal(d.offer_key, "slo_roadmap");
    assert.deepEqual(d.animation_plan[1].props, { eyebrow: "What lenders read" }, "props text is parsed into an object");
    assert.deepEqual(d.animation_plan[0].anchor, { cue: 1, keyword: "personal" });
    assert.equal(log.screens.length >= 1, true, "the compliance screen ran");
    assert.match(log.screens.at(-1).text, /See both files first/, "the screen reads the Meta copy too");
  });

  test("strict failures go back, with the failures in the rewrite prompt", async () => {
    const bad = goodDraft({ cues: ["We do credit repair for your file", ...CUES.slice(1)] });
    const { out, ai } = await write({ writer: [bad, goodDraft()] });
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 2);
    const second = userOf(ai, 1);
    assert.match(second, /YOUR LAST DRAFT/);
    assert.match(second, /Part 0 rule 1/);
    assert.equal(out.flagged, false);
    assert.equal(out.check_results.strict.rounds, 1);
  });

  test("at most 2 strict rounds; a draft still failing is saved flagged with its check results", async () => {
    const bad = goodDraft({ cues: ["We do credit repair for your file", ...CUES.slice(1)] });
    const { out, ai, log } = await write({ writer: [bad] });
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 1 + STRICT_ROUNDS);
    assert.equal(STRICT_ROUNDS, 2);
    assert.equal(out.flagged, true);
    assert.equal(log.saves.length, 1, "a flagged draft is still saved");
    const cr = log.saves[0].checkResults;
    assert.equal(cr.flagged, true);
    assert.equal(cr.strict.passed, false);
    assert.equal(cr.strict.rounds, 2);
    assert.ok(cr.strict.failures.some((f) => f.rule === "part0-1"));
    assert.match(cr.flag_reasons.join(" "), /rule checker/);
  });

  test("the judge checks once; its violations go back once and the fix is taken", async () => {
    const { out, ai } = await write({
      writer: [goodDraft(), goodDraft({ cta: "Tap below and get your Roadmap. It is a soft pull only, so there is zero impact on your score, and nothing moves until you say so." })],
      judge: [{ violations: [{ rule: 16, quote: "and the rest gets easier", fix: "Say it in one sentence." }, { rule: 5, quote: "x", fix: "not a judged rule" }] }]
    });
    assert.equal(ai.calls.filter((c) => c.kind === "judge").length, 1, "one judge pass");
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 2);
    assert.match(userOf(ai, 1), /Rule 16: "and the rest gets easier"/);
    const j = out.check_results.judge;
    assert.equal(j.sent_back, true);
    assert.equal(j.taken, true);
    assert.deepEqual(j.notes.map((n) => n.rule), [16], "only the rules the judge owns are kept");
    assert.equal(out.flagged, false);
  });

  test("the judge prompt names rules 13-34 plus round two, carry and man, and says if it is book-a-call", async () => {
    const { ai } = await write();
    const j = ai.calls.find((c) => c.kind === "judge");
    const sys = j.body.system[0].text;
    assert.match(sys, /Check only these rules: 3, 9, 12, 13, 14/);
    assert.match(sys, /34\b/);
    assert.match(sys, /"round two"/);
    assert.match(sys, /"carry"/);
    assert.match(sys, /"man"/);
    assert.match(sys, /# PART 0/);
    assert.match(j.body.messages[0].content, /not a book-a-call ad/);
  });

  test("a judge that cannot run leaves the draft flagged, never lost", async () => {
    const { out, log } = await write({ judge: [{ status: 500 }] });
    assert.ok(out.script_id);
    assert.equal(out.flagged, true);
    assert.equal(log.saves[0].checkResults.judge.ran, false);
    assert.match(log.saves[0].checkResults.flag_reasons.join(" "), /judge did not run/);
  });

  test("the compliance screen on body and meta copy: a blocked line goes back, and still blocked is flagged", async () => {
    const blocked = async () => ({
      state: "blocked",
      reasons: [{ code: "guaranteed-approval", rule_set: "claims", severity: "block", message: "Guaranteed approval cannot be advertised." }]
    });
    const { out, ai } = await write({ store: { screenCopy: blocked } });
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 3);
    assert.match(userOf(ai, 1), /Compliance: Guaranteed approval cannot be advertised/);
    assert.equal(out.flagged, true);
    assert.equal(out.check_results.compliance.copy_blocked, true);
    assert.match(out.check_results.flag_reasons.join(" "), /compliance screen/);
  });

  test("an unset Meta category and the approval gate are not copy problems", async () => {
    const config = async () => ({
      state: "blocked",
      reasons: [
        { code: "special_ad_category_unset", rule_set: "platform", message: "No special_ad_category is configured." },
        { code: "human_approval_required_setting", rule_set: "approval", message: "A human approves first." }
      ]
    });
    const { out } = await write({ store: { screenCopy: config } });
    assert.equal(out.flagged, false);
    assert.equal(out.check_results.compliance.copy_blocked, false);
  });

  test("validateAnimationPlan: props on a data-tied template go back to the writer", async () => {
    const bad = goodDraft();
    bad.animation_plan = [
      { anchor: { phrase: null, cue: 1, keyword: "personal" }, template: "QualifyToday", props: "{\"today\":{\"label\":\"Today\",\"value\":50000}}", seconds: 2.5 },
      { anchor: { phrase: null, cue: 3, keyword: "first" }, template: "NotATemplate", props: "not json", seconds: 3 }
    ];
    const { ai } = await write({ writer: [bad, goodDraft()] });
    const second = userOf(ai, 1);
    assert.match(second, /Animation plan: .*QualifyToday, which shows only its own real files/);
    assert.match(second, /not in the animation catalog/);
    assert.match(second, /props is not valid JSON/);
  });

  test("a headline over 40 characters goes back", async () => {
    const bad = goodDraft();
    bad.meta_copy = { ...bad.meta_copy, headline: "See both of your files before you apply anywhere" };
    const { ai } = await write({ writer: [bad, goodDraft()] });
    assert.match(userOf(ai, 1), /headline has 48 characters\. It must be 40 or fewer/);
  });

  test("parts that are not in the body word for word go back", async () => {
    const bad = goodDraft();
    bad.parts = bad.parts.map((p) => (p.kind === "reveal" ? { ...p, text: "Something the body never says." } : p));
    const { ai } = await write({ writer: [bad, goodDraft()] });
    assert.match(userOf(ai, 1), /Part 6 \(reveal\) is not in the body word for word/);
  });

  test("the slot's facts win over what the reply echoed", async () => {
    const echo = goodDraft({ extra: { offer_key: "funding_dfy", lane: "wl", script_format: "sorting", style: "words" } });
    echo.meta_copy = { ...echo.meta_copy, cta_type: "SHOP_NOW" };
    const { log } = await write({ writer: [echo] });
    const d = log.saves[0].draft;
    assert.equal(d.offer_key, "slo_roadmap");
    assert.equal(d.lane, "uwiq");
    assert.equal(d.script_format, "standard");
    assert.equal(d.style, "bullets");
    assert.equal(d.meta_copy.cta_type, "LEARN_MORE");
    assert.equal(d.angle_key, "the_conveyor_belt");
  });

  test("time: with no room for another 5-minute call, no rewrite starts and the draft is saved flagged", async () => {
    const bad = goodDraft({ cues: ["We do credit repair for your file", ...CUES.slice(1)] });
    const t0 = 1_000_000;
    const { out, ai } = await write({ writer: [bad], deps: { now: () => t0, deadlineAt: t0 + 60_000 } });
    assert.equal(ai.calls.length, 1, "only the first call ran");
    assert.equal(out.flagged, true);
    assert.equal(out.check_results.time_ran_out, true);
  });

  test("time: a rewrite reply with no JSON is not asked again when a whole call no longer fits (review U24-R3)", async () => {
    const bad = goodDraft({ cues: ["We do credit repair for your file", ...CUES.slice(1)] });
    let clock = 0;
    const { out, ai } = await write({
      writer: [bad, { raw: { text: "no json here" } }, goodDraft()],
      tick: () => { clock += 3 * 60_000; },
      deps: { now: () => clock, deadlineAt: 10 * 60_000 }
    });
    // 0:00 first draft → 3:00 the rewrite starts (a 5-minute call fits) → 6:00 no JSON;
    // 6:00 + 5:00 is past 10:00, so no second ask.
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 2, "the no-JSON retry did not start");
    assert.equal(ai.calls.filter((c) => c.kind === "judge").length, 0, "no judge either: no time left");
    assert.equal(out.flagged, true, "the first draft is saved flagged, never lost");
    assert.equal(out.check_results.time_ran_out, true);
    assert.match(out.check_results.rewrite_errors.join(" "), /not enough time left to ask again/);
  });

  test("time: a first draft with no JSON and no room for the retry is the machine's fault, the idea untouched", async () => {
    let clock = 0;
    const { out, ai, log } = await write({
      slot: IDEA_SLOT, store: { loadSlotContext: ideaCtx() },
      writer: [{ raw: { text: "no json here" } }, goodDraft()],
      tick: () => { clock += 3 * 60_000; },
      deps: { now: () => clock, deadlineAt: 6 * 60_000 }
    });
    assert.equal(ai.calls.length, 1);
    assert.equal(out.failed, true);
    assert.equal(out.temporary, true, "the job runs again with a fresh deadline");
    assert.match(out.reason, /not enough time left to ask again/);
    assert.deepEqual(log.ideaFailed, []);
  });

  test("a compliance screen that could not run is flagged, never sent back (review U24-R4)", async () => {
    const engine = async () => ({
      state: "blocked",
      reasons: [{ code: "screen_error", rule_set: "engine", message: "Compliance screening could not complete, so this is blocked.", detail: "boom" }]
    });
    const { out, ai, log } = await write({ store: { screenCopy: engine } });
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 1, "no rewrite: Claude cannot fix an engine fault");
    assert.equal(out.flagged, true, "it still fails closed");
    const cr = log.saves[0].checkResults;
    assert.equal(cr.compliance.engine_blocked, true);
    assert.equal(cr.compliance.copy_blocked, false);
    assert.equal(cr.strict.rounds, 0);
    assert.match(cr.flag_reasons.join(" "), /compliance screen could not run/);
    assert.doesNotMatch(cr.flag_reasons.join(" "), /still fails/);
  });

  test("a label key the database would refuse is flagged and saved as NULL, so the draft still saves (review U24-R2)", async () => {
    const bad = goodDraft({ extra: { hook_key: "3_files_one_lender" } });
    const { out, ai, log } = await write({ writer: [bad] });
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 1 + STRICT_ROUNDS, "the bad key went back");
    assert.match(userOf(ai, 1), /hook_key "3_files_one_lender" is not a usable key/);
    assert.equal(out.flagged, true);
    const { draft, checkResults } = log.saves[0];
    assert.equal(checkResults.labels.passed, false);
    assert.match(checkResults.flag_reasons.join(" "), /label keys/);

    // The real store's INSERT: hook_key goes in as NULL, and no ad_labels row is made for it.
    const queries = [];
    const tx = {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (/INSERT INTO ad_scripts/.test(sql)) return { rows: [{ id: "s1", root_script_id: "s1", version: 1, status: "draft", source: "machine" }] };
        return { rows: [], rowCount: 0 };
      }
    };
    const store = makeStore(null, { asStaff: (fn) => fn(tx) });
    const saved = await store.saveDraft({ orgId: ORG, partnerId: PARTNER, batch: null, ideaId: null, draft, checkResults, angleNames: {} });
    assert.equal(saved.id, "s1");
    const ins = queries.find((q) => /INSERT INTO ad_scripts/.test(q.sql));
    assert.equal(ins.params[7], "the_conveyor_belt", "angle_key");
    assert.equal(ins.params[8], null, "hook_key: NULL = unknown, never the refused key");
    const labelKeys = queries.filter((q) => /INSERT INTO ad_labels/.test(q.sql)).map((q) => `${q.params[1]}:${q.params[2]}`);
    assert.ok(labelKeys.includes("angle:the_conveyor_belt"), labelKeys.join(", "));
    assert.equal(labelKeys.some((k) => k.startsWith("hook:")), false);
  });
});

// ── Offer facts ───────────────────────────────────────────────────────────────────────

describe("offer facts come only from offerFacts()", () => {
  const dollars = (cents) => `$${(cents / 100).toLocaleString("en-US")}`;

  test("a roadmap_147 slot's prompt says the price from SLO_PRICE_CENTS and never the old one", async () => {
    const { ai } = await write();
    const user = userOf(ai);
    assert.equal(dollars(SLO_PRICE_CENTS), "$147");
    assert.ok(user.includes("$147"), user);
    assert.equal(user.includes("$297"), false);
    assert.equal(user.includes(dollars(SLO_LIST_PRICE_CENTS)), false);
    assert.match(user, /they buy the Roadmap for \$147/);
  });

  test("a book_call slot's prompt carries no price at all", async () => {
    const slot = { ...SLOT, funnel_key: "book_call", script_format: "sorting", style: "words", angle_key: null };
    const { ai } = await write({ slot });
    const user = userOf(ai);
    assert.equal(/\$\s?\d/.test(user), false, user);
    assert.equal(user.includes(dollars(OFFERS.FUNDING_DFY.priceCents)), false);
    assert.match(user, /book-a-call ad/);
    assert.match(ai.calls.find((c) => c.kind === "judge").body.messages[0].content, /This is a book-a-call ad/);
  });

  test("a book-a-call draft that says a price goes back (rule 29)", async () => {
    const slot = { ...SLOT, funnel_key: "book_call" };
    const priced = goodDraft({ cta: "Book a call below. The plan is $147, a soft pull only, so zero impact on your score, and nothing moves until you say so." });
    const { ai } = await write({ slot, writer: [priced, goodDraft()] });
    assert.match(userOf(ai, 1), /This is a book-a-call ad, so it never says a price \(rule 29\)\. It says \$147/);
  });

  test("a roadmap ad that copies the old list price from an example goes back (review U24-R6)", async () => {
    const old = dollars(SLO_LIST_PRICE_CENTS);
    const examples = [{ title: "Older approved script", body: `${HOOK}\n\nGet your Roadmap for ${old} below.` }];
    const stale = goodDraft({ cta: `Tap below to get your Roadmap for ${old}. It is a soft pull only, so there is zero impact on your score, and nothing moves until you say so.` });
    const { out, ai } = await write({
      writer: [stale, goodDraft()],
      store: { loadSlotContext: async () => ({ batch: BATCH_ROW, settings: SETTINGS, funnel: FUNNELS.roadmap_147, partnerId: PARTNER, idea: null, recent: [], siblings: [], examples }) }
    });
    assert.ok(userOf(ai, 0).includes(old), "the approved example carries the old price word for word");
    const esc = (t) => t.replace(/[$.]/g, (c) => `\\${c}`);
    assert.match(userOf(ai, 1), new RegExp(`This ad sells the Roadmap for ${esc(dollars(SLO_PRICE_CENTS))}\\. It says ${esc(old)}, which is not its price`));
    assert.equal(out.flagged, false, "the rewrite dropped it");
    assert.equal(out.check_results.offer.passed, true);
  });

  test("a roadmap ad may say its own price, and never another offer's", async () => {
    const own = goodDraft({ cta: `Tap below to get your Roadmap for ${dollars(SLO_PRICE_CENTS)}. It is a soft pull only, so there is zero impact on your score, and nothing moves until you say so.` });
    const { log } = await write({ writer: [own] });
    assert.equal(log.saves[0].checkResults.offer.passed, true, JSON.stringify(log.saves[0].checkResults.offer));
    assert.equal(log.saves[0].checkResults.offer.price, dollars(SLO_PRICE_CENTS));

    const other = goodDraft({ cta: `Tap below. The done-for-you plan is ${dollars(OFFERS.FUNDING_DFY.priceCents)}, a soft pull only, so zero impact on your score, and nothing moves until you say so.` });
    const { ai } = await write({ writer: [other, goodDraft()] });
    assert.match(userOf(ai, 1), /which is not its price/);
  });

  test("no literal price is typed into the writer's code", () => {
    const cents = [SLO_PRICE_CENTS, SLO_LIST_PRICE_CENTS, OFFERS.FUNDING_DFY.priceCents];
    const forms = new Set();
    for (const c of cents) {
      forms.add(String(c));
      const d = c / 100;
      forms.add(`$${d}`);
      forms.add(`$${d.toLocaleString("en-US")}`);
    }
    for (const file of ["writer.mjs", "writer-prompt.mjs", "sameness.mjs"]) {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      for (const f of forms) {
        const re = new RegExp(`(^|[^0-9])${f.replace(/[$.,]/g, (ch) => `\\${ch}`)}([^0-9]|$)`);
        assert.equal(re.test(src), false, `${file} has the price ${f} typed in`);
      }
    }
  });
});

// ── Cost ──────────────────────────────────────────────────────────────────────────────

describe("cost", () => {
  test("every call is logged with the model that served it", async () => {
    const { log, ai } = await write({ served: "claude-opus-5" });
    assert.equal(log.usage.length, ai.calls.length);
    for (const u of log.usage) {
      assert.equal(u.model, "claude-opus-5", "the served model, not the one asked for");
      assert.equal(u.orgId, ORG);
      assert.equal(u.batchId, BATCH);
      assert.equal(u.usage.cache_read_input_tokens, 9000);
    }
  });

  test("at the month cap: no call, the slot fails 'cost cap reached', one buzz", async () => {
    const capped = async () => ({ batch_usd: 1, month_usd: 300, unpriced_rows: 0, batch_capped: false, month_capped: true });
    const { out, ai, log } = await write({ store: { costStatus: capped } });
    assert.deepEqual({ failed: out.failed, reason: out.reason }, { failed: true, reason: COST_CAP_REASON });
    assert.equal(COST_CAP_REASON, "cost cap reached");
    assert.equal(ai.calls.length, 0);
    assert.equal(log.saves.length, 0);
    assert.equal(log.ideaFailed.length, 0, "a cost cap never marks an idea failed: it is written once the cap is raised");
    assert.equal(log.buzzes.length, 1);
    assert.equal(log.buzzes[0].kind, COST_CAP_BUZZ_KIND);
    assert.match(log.buzzes[0].groupKey, /^month:\d{4}-\d{2}$/);
    assert.match(log.buzzes[0].body, /\$300 cap/);
  });

  test("at the batch cap after the first call: the writer stops before the next one", async () => {
    let n = 0;
    const capsAfterOne = async () => ({ batch_usd: 40, month_usd: 40, unpriced_rows: 0, batch_capped: n++ >= 1, month_capped: false });
    const { out, ai, log } = await write({ store: { costStatus: capsAfterOne } });
    assert.equal(out.reason, COST_CAP_REASON);
    assert.equal(ai.calls.length, 1);
    assert.equal(log.saves.length, 0);
    assert.equal(log.buzzes.length, 1);
    assert.equal(log.buzzes[0].groupKey, `batch:${BATCH}`);
  });

  test("buzzOnce queues a cap buzz once per group, even after it was sent", async () => {
    const seen = new Set();
    const inserts = [];
    const db = {
      query: async (sql, params) => {
        if (/SELECT 1 FROM marketing_buzzes/.test(sql)) return { rows: seen.has(params.join("|")) ? [{}] : [] };
        if (/INSERT INTO marketing_buzzes/.test(sql)) {
          seen.add([params[0], params[1], params[3]].join("|"));
          inserts.push(params);
          return { rows: [{ id: "b1", created: true }] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }
    };
    const store = makeStore(db);
    const args = { orgId: ORG, kind: COST_CAP_BUZZ_KIND, groupKey: `batch:${BATCH}`, body: "The script writer stopped.", quietStart: "00:00", quietEnd: "00:00" };
    assert.deepEqual(await store.buzzOnce(args), { queued: true });
    assert.deepEqual(await store.buzzOnce(args), { queued: false });
    assert.equal(inserts.length, 1);
  });
});

// ── Sameness in the loop ──────────────────────────────────────────────────────────────

describe("sameness in the loop", () => {
  test("a hook too close to a recent one is rewritten once", async () => {
    const recent = [{ hook: HOOK, body: "an older script body with other words" }];
    const fresh = goodDraft({ hook: "Your business file gets read before your personal one on the big lines, and almost nobody checks it." });
    const { out, ai } = await write({
      writer: [goodDraft(), fresh],
      store: { loadSlotContext: async () => ({ batch: BATCH_ROW, settings: SETTINGS, funnel: FUNNELS.roadmap_147, partnerId: PARTNER, idea: null, recent, siblings: [], examples: [] }) }
    });
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 2);
    assert.match(userOf(ai, 1), /The hook repeats 100% of a recent hook/);
    assert.match(userOf(ai, 0), /Hooks from the last script/);
    assert.equal(out.check_results.sameness.rewritten, true);
    assert.equal(out.flagged, false);
  });

  test("a hook another script in the batch has, still there after the one rewrite, is refused", async () => {
    const siblings = [{ root_script_id: "x", hook: HOOK, body: goodDraft().body, parts: goodDraft().parts }];
    const { out, ai, log } = await write({
      writer: [goodDraft()],
      store: { loadSlotContext: async () => ({ batch: BATCH_ROW, settings: SETTINGS, funnel: FUNNELS.roadmap_147, partnerId: PARTNER, idea: null, recent: [], siblings, examples: [] }) }
    });
    assert.equal(ai.calls.filter((c) => c.kind === "writer").length, 2, "one rewrite");
    assert.match(userOf(ai, 0), /Already used in this batch/);
    assert.equal(out.failed, true);
    assert.match(out.reason, /^Refused: .*already has this hook/);
    assert.equal(log.saves.length, 0);
  });

  test("a save the store refuses (another slot saved the same hook first) fails the slot", async () => {
    const { out } = await write({ store: { saveDraft: async () => ({ refused: "Another script in this batch already has this hook." }) } });
    assert.equal(out.failed, true);
    assert.match(out.reason, /already has this hook/);
  });
});

// ── Ideas, fixes, job handlers ────────────────────────────────────────────────────────

describe("ideas, fixes and the job handlers", () => {
  test("Chris's points go in word for word, and a failed slot marks its idea failed", async () => {
    const points = "Lenders look at two files. People only ever fix one. Say which one gets read first.";
    const ctx = async () => ({
      batch: BATCH_ROW, settings: SETTINGS, funnel: FUNNELS.roadmap_147, partnerId: PARTNER,
      idea: { id: IDEA, raw_points: points, topic: null, angle_key: null, status: "new" }, recent: [], siblings: [], examples: []
    });
    const slot = { ...SLOT, idea_id: IDEA, angle_key: null, source: "chris_idea" };
    const ok = await write({ slot, store: { loadSlotContext: ctx } });
    assert.ok(userOf(ok.ai).includes(points));
    assert.equal(ok.log.saves[0].ideaId, IDEA);

    const refused = await write({ slot, store: { loadSlotContext: ctx }, writer: [{ raw: { content: [], stop: "refusal", stopDetails: { category: "bio" } } }] });
    assert.equal(refused.out.failed, true);
    assert.deepEqual(refused.log.ideaFailed.map((x) => x.ideaId), [IDEA]);
    assert.match(refused.log.ideaFailed[0].reason, /category: bio/);
  });

  test("fixScript: Chris's note word for word, a new version saved from the version he saw", async () => {
    const ai = fakeAnthropic();
    const { store, log } = fakeStore();
    const note = "Make the CTA about the Roadmap, not a call.";
    const out = await fixScript(null, ENV, { script_id: SCRIPT, version: 2, note }, { orgId: ORG, store, fetchImpl: ai.fetchImpl });
    assert.equal(out.script_id, "22222222-2222-4222-8222-222222222222");
    assert.equal(out.version, 3);
    const user = userOf(ai);
    assert.ok(user.includes(note));
    assert.match(user, /REWRITE THIS SCRIPT FROM CHRIS'S NOTE/);
    assert.match(user, /The script now \(version 2\)/);
    assert.equal(log.fixes.length, 1);
    assert.equal(log.fixes[0].parentId, SCRIPT);
    assert.equal(log.fixes[0].parentVersion, 2);
    assert.equal(log.fixes[0].note, note);
    assert.ok(ai.calls.find((c) => c.kind === "judge").body.messages[0].content.includes(note), "the judge is told Chris's note (rule 0)");
    for (const c of ai.calls) assert.equal(new URL(c.url).host, "api.anthropic.com");
  });

  test("fixScript on a version that is no longer the newest is skipped, no call made", async () => {
    const ai = fakeAnthropic();
    const { store } = fakeStore();
    const out = await fixScript(null, ENV, { script_id: SCRIPT, version: 1, note: "shorter" }, { orgId: ORG, store, fetchImpl: ai.fetchImpl });
    assert.equal(out.failed, true);
    assert.match(out.reason, /newer version/);
    assert.equal(ai.calls.length, 0);
  });

  test("fixScript: a save that finds a newer version reports stale", async () => {
    const ai = fakeAnthropic();
    const { store } = fakeStore({ saveFix: async () => ({ stale: true }) });
    const out = await fixScript(null, ENV, { script_id: SCRIPT, version: 2, note: "shorter" }, { orgId: ORG, store, fetchImpl: ai.fetchImpl });
    assert.equal(out.failed, true);
    assert.match(out.reason, /was not saved/);
  });

  test("runFixScript reads the job payload", async () => {
    const ai = fakeAnthropic();
    const { store, log } = fakeStore();
    const out = await runFixScript(
      { id: "job-2", org_id: ORG, payload: { script_id: SCRIPT, version: 2, note: "Say Roadmap once." } },
      { db: null, env: ENV, deps: { store, fetchImpl: ai.fetchImpl } }
    );
    assert.ok(out.script_id);
    assert.equal(log.usage[0].jobId, "job-2");
  });

  test("write_slot and fix_script are writer jobs in JOB_KINDS whose handlers are these", async () => {
    assert.equal(JOB_KINDS.write_slot.group, "writer");
    assert.equal(JOB_KINDS.fix_script.group, "writer");
    assert.equal((await JOB_KINDS.write_slot.load()).run, runWriteSlot);
    assert.equal((await JOB_KINDS.fix_script.load()).run, runFixScript);
  });
});
