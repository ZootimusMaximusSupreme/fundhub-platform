// The money helper's lessons (src/finance/money-education.mjs) and how the brain uses them
// (src/finance/money-agent-ai.mjs). Every test runs on the same sample file the brain's own
// tests use (fixtures/money-helper-context.sample.json) and needs no database or model.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOPICS, LEARN_TOPICS, NOT_IN_PLAN, EXCLUDED_RE, MAX_TOPICS,
  matchTopics, topicGuidance, topicReply, topicReplyProblems, lessonPromptBlock, fromLine, topicByKey
} from "./money-education.mjs";
import {
  HELPER_PROMPT, HELPER_GUARDRAILS, buildFacts, buildPrompt, decideTurn, replyProblems,
  collectAllowed, groundingProblems, classifyInbound
} from "./money-agent-ai.mjs";
import { PERSONAS, SAMPLE_DECLINE_LETTER } from "./money-agent-sim.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const CTX = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-helper-context.sample.json"), "utf8"));
const ctx = () => JSON.parse(JSON.stringify(CTX));
const TODAY = CTX.today;
const agent = { prompt: HELPER_PROMPT, guardrails: HELPER_GUARDRAILS, status: "shadow" };

/** A model stand-in through callModel's own result shape. */
function model(json) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    return { mode: "live", text: JSON.stringify(json), json, error: null, status: 200, servedModel: "claude-code", request: { model: "claude-code", provider: "claude-code", output_schema: true, system: args.system, user: args.user } };
  };
  fn.calls = calls;
  return fn;
}
const ask = (input, opts = {}) => decideTurn({ agent, context: ctx(), turn: { kind: "message", input }, ...opts });
const sentences = (s) => String(s).split(/(?<=[.!?])\s+/).filter(Boolean);

describe("the lessons", () => {
  test("the seven topics Chris named, then the guard for the tools he took out", () => {
    assert.deepEqual(TOPICS.map((t) => t.key),
      ["chexsystems", "opening_accounts", "seasoning", "card_use", "inquiries", "business_credit", "gas_cards", "not_in_plan"]);
    for (const t of TOPICS) {
      assert.equal(typeof t.title, "string", t.key);
      assert.ok(t.match instanceof RegExp && !t.match.global, `${t.key}: one regex, no g flag (test/exec keep no state)`);
      assert.ok(t.from && !/\d/.test(t.from), `${t.key}: the doc name carries no number`);
      assert.ok(t.sources.length >= 2, `${t.key}: rests on more than one line`);
    }
  });

  test("every doc a lesson cites is in the repo and holds the backing words, word for word", () => {
    let checked = 0;
    for (const t of TOPICS) {
      for (const s of t.sources.filter((x) => x.kind === "doc")) {
        const file = path.join(ROOT, s.path);
        assert.ok(fs.existsSync(file), `${t.key}: ${s.path} is missing`);
        assert.ok(fs.readFileSync(file, "utf8").includes(s.says), `${t.key}: ${s.path} no longer says "${s.says}"`);
        checked += 1;
      }
      assert.ok(t.sources.some((x) => x.kind === "doc"), `${t.key}: at least one line comes from a file in the repo`);
    }
    assert.ok(checked >= 25, `${checked} backing lines checked`);
  });

  test("a lesson that drifts from its doc fails the check above (the check is real)", () => {
    const t = topicByKey("card_use");
    const s = t.sources[0];
    const text = fs.readFileSync(path.join(ROOT, s.path), "utf8");
    assert.ok(text.includes(s.says));
    assert.ok(!text.includes(s.says.replace("CLOSES", "OPENS")), "a changed word is not found");
  });

  test("owner calls carry the day they were made, his words and where they are written", () => {
    const owners = TOPICS.flatMap((t) => t.sources.filter((x) => x.kind === "owner").map((x) => [t.key, x]));
    assert.ok(owners.length >= 5);
    for (const [key, o] of owners) {
      assert.match(o.said, /^2026-\d{2}-\d{2}$/, key);
      assert.ok(o.words.length > 20, key);
      assert.match(o.ref, /^ops\/workflows\//, key);
    }
  });

  test("every answer is short and plain: 2 to 4 sentences, under 260 characters, short words", () => {
    for (const t of TOPICS) {
      const n = sentences(t.answer).length;
      assert.ok(n >= 2 && n <= 4, `${t.key}: ${n} sentences`);
      assert.ok(t.answer.length < 260, `${t.key}: ${t.answer.length} characters`);
      const long = t.answer.replace(/chexsystems\.com/gi, "").split(/[^A-Za-z']+/).filter((w) => w.length > 12);
      assert.deepEqual(long, [], `${t.key}: long words`);
    }
  });

  test("every answer passes the helper's own checks: no promise, no money moved, no credit pull, no UnderwriteIQ, no legal words", () => {
    for (const t of TOPICS) {
      assert.deepEqual(replyProblems(t.answer, { tip: null }), [], t.key);
      assert.doesNotMatch(t.answer, /\bpull|guarantee|approv|underwrite|round two|\bnumber\b/i, t.key);
      assert.doesNotMatch(t.answer, /FundHub|FUNDHUB|Fund Hub/, `${t.key}: the company is Fundhub`);
    }
  });

  test("each lesson's own words are about its topic, so an AI answer that repeats one has to name its doc", () => {
    for (const t of TOPICS) assert.ok(t.match.test(t.answer), t.key);
  });

  test("no lesson offers the tools the owner took out; the guard says they are not part of the plan", () => {
    for (const t of TOPICS.filter((x) => x.key !== "not_in_plan")) assert.doesNotMatch(t.answer, EXCLUDED_RE, t.key);
    assert.ok(topicByKey("not_in_plan").answer.includes(NOT_IN_PLAN));
  });

  test("every number a lesson says is a number the helper may say once that lesson is in FACTS", () => {
    for (const t of TOPICS) {
      const allowed = collectAllowed({ topic_guidance: topicGuidance(t.ask || "net 30") }, TODAY);
      assert.deepEqual(groundingProblems(t.answer, allowed, { today: TODAY }).map((x) => x.token), [], t.key);
    }
  });

  test("the topic buttons: one per topic Chris named, and each question finds its own lesson", () => {
    assert.equal(LEARN_TOPICS.length, 7);
    for (const b of LEARN_TOPICS) assert.deepEqual(matchTopics(b.ask), [b.key], b.ask);
  });

  test("ChexSystems names its official site, and only that", () => {
    const withLink = TOPICS.filter((t) => t.link);
    assert.deepEqual(withLink.map((t) => t.key), ["chexsystems"]);
    assert.equal(withLink[0].link.url, "https://www.chexsystems.com");
    assert.ok(withLink[0].answer.includes(withLink[0].link.text));
  });
});

describe("which lessons a question names — matchTopics", () => {
  test("the ways people ask", () => {
    const cases = [
      ["what is chexsystems", ["chexsystems"]],
      ["Do banks check Chex Systems?", ["chexsystems"]],
      ["What is Early Warning Services?", ["chexsystems"]],
      ["How do I open a business checking account?", ["opening_accounts"]],
      ["Should I open an account at Chase?", ["opening_accounts"]],
      ["Which bank should I open first?", ["opening_accounts"]],
      ["opening a Chase business checking", ["opening_accounts"]],
      ["How long until my account is seasoned?", ["seasoning"]],
      ["When does my statement close?", ["card_use"]],
      ["What is utilization?", ["card_use"]],
      ["Should I keep my cards under 10%?", ["card_use"]],
      ["When does my Amex card report?", ["card_use"]],
      ["Will a credit check hurt me?", ["inquiries"]],
      ["How many hard inquiries is too many?", ["inquiries"]],
      ["How do I build my business credit score?", ["business_credit"]],
      ["What is paydex?", ["business_credit"]],
      ["Are fuel cards worth it?", ["gas_cards"]],
      ["Should I apply for WEX?", ["gas_cards"]],
      ["Should I open Net 30 accounts?", ["not_in_plan"]],
      ["Do I need a DUNS number?", ["not_in_plan"]],
      ["Is Nav worth paying for?", ["not_in_plan"]]
    ];
    for (const [q, keys] of cases) assert.deepEqual(matchTopics(q), keys, q);
  });

  test("questions about the client's own money name no lesson, so they keep their answers", () => {
    const own = [
      "What is due this week?", "Which card should I pay first?", "Got declined? Paste the letter here",
      "Pay my business credit card", "Should I get a business credit card?", "What's my balance?",
      "Move $20,000 from my business checking to my Amex right now.", "My cards feel maxed out and I want to get funded. What should I do first?",
      "Can you remind me the day before my card is due?", "I missed my Fundhub payment. What happens now?", "Thanks.", ""
    ];
    for (const q of own) assert.deepEqual(matchTopics(q), [], q);
    for (const p of PERSONAS) {
      for (const line of p.lines) {
        if (line.length < 600) assert.deepEqual(matchTopics(line), [], `${p.id}: ${line}`);
      }
    }
  });

  test("in the order asked, at most two, and the guard is never crowded out", () => {
    assert.equal(MAX_TOPICS, 2);
    assert.deepEqual(matchTopics("What is seasoning, and what is ChexSystems?"), ["seasoning", "chexsystems"]);
    assert.deepEqual(matchTopics("seasoning, inquiries and gas cards"), ["seasoning", "inquiries"]);
    assert.deepEqual(matchTopics("business credit, inquiries and net 30 accounts?"), ["business_credit", "not_in_plan"]);
  });

  test("topicGuidance carries the lesson's words and its from line, and nothing else", () => {
    const [g] = topicGuidance("What is seasoning?");
    assert.deepEqual(Object.keys(g).sort(), ["answer", "from", "from_line", "title", "topic"]);
    assert.equal(g.from_line, "From: Fundhub bank book.");
    assert.equal(g.answer, topicByKey("seasoning").answer);
    assert.deepEqual(topicGuidance("What is due this week?"), []);
  });

  test("topicReply: each lesson's words, then its doc on its own line", () => {
    const one = topicReply(topicGuidance("What is ChexSystems?"));
    assert.equal(one, `${topicByKey("chexsystems").answer}\nFrom: Blueprint lessons.`);
    const two = topicReply(topicGuidance("What are inquiries and what is seasoning?"));
    assert.equal(two.split("\n\n").length, 2);
    assert.match(two, /\nFrom: Applying On Your Own lesson\.\n\n/);
    assert.ok(two.endsWith("\nFrom: Fundhub bank book."));
    assert.equal(fromLine(topicByKey("card_use")), "From: Card Paydown lesson.");
  });
});

describe("the rules brain answers a lesson question with the lesson and its doc", () => {
  test("ChexSystems, with no model: the lesson's words, the doc, no action", async () => {
    const d = await ask("What is ChexSystems?", { useAi: false, fallbackReason: "bridge_off" });
    assert.equal(d.brain, "rules");
    assert.equal(d.reason, "bridge_off");
    assert.equal(d.reply, `${topicByKey("chexsystems").answer}\nFrom: Blueprint lessons.`);
    assert.deepEqual(d.actions, []);
    assert.equal(d.facts.topic_guidance[0].topic, "chexsystems");
  });

  test("a question about their own money is answered as before, with no lesson in FACTS", async () => {
    const d = await ask("What is due?", { useAi: false });
    assert.match(d.reply, /^Next up:|^Fundhub payment/m);
    assert.equal("topic_guidance" in d.facts, false);
  });

  test("a pasted letter, a question about it, and a Do-task press get no lesson; a new topic later in the chat does", async () => {
    const paste = await ask(`I just got declined, here is the letter:\n\n${SAMPLE_DECLINE_LETTER}`, { useAi: false });
    assert.ok(paste.facts.decline_analysis, "it was read as a decline");
    assert.equal("topic_guidance" in paste.facts, false, "the letter's own 'inquiries' line is not a lesson question");
    const first = { kind: "message", input: `I just got declined, here is the letter:\n\n${SAMPLE_DECLINE_LETTER}`, reply: "ok", actions: [] };
    const follow = await ask("What should I fix first?", { useAi: false, thread: [first] });
    assert.equal("topic_guidance" in follow.facts, false);
    assert.match(follow.reply, /^What to fix first:/);
    const later = await ask("What is seasoning?", { useAi: false, thread: [first] });
    assert.equal(later.facts.topic_guidance[0].topic, "seasoning");
    assert.ok(later.reply.endsWith("From: Fundhub bank book."));
    const task = await decideTurn({ agent, context: ctx(), turn: { kind: "task", input: "Do task: season my account", task: { id: "x", title: "Season my account", detail: null, due_on: null, amount_cents: null } }, useAi: false });
    assert.equal("topic_guidance" in task.facts, false);
  });

  test("struggling still goes to a person first: 'I can't pay my gas card' opens a CSM task", async () => {
    assert.equal(classifyInbound("I can't pay my gas card"), "cant_pay");
    const d = await ask("I can't pay my gas card", { useAi: false });
    assert.equal(d.actions[0].type, "create_csm_task");
    assert.doesNotMatch(d.reply, /From:/);
  });
});

describe("an AI answer about a lesson must name its doc", () => {
  test("an answer that uses the lesson and names its doc is used", async () => {
    const fn = model({ reply: "ChexSystems is a report on your past bank accounts. Get your free report at chexsystems.com before you open one.\nFrom: Blueprint lessons.", actions: [] });
    const d = await ask("What is ChexSystems?", { callModelFn: fn });
    assert.equal(d.brain, "ai", d.reason);
    assert.match(fn.calls[0].user, /LESSONS — FACTS\.topic_guidance holds Fundhub's own lesson/);
    assert.match(fn.calls[0].user, /"from_line": "From: Blueprint lessons\."/);
  });

  test("an answer about the lesson with no doc is blocked, and the rules brain answers with the lesson", async () => {
    const fn = model({ reply: "ChexSystems is a report on your past bank accounts.", actions: [] });
    const d = await ask("What is ChexSystems?", { callModelFn: fn });
    assert.equal(d.brain, "rules");
    assert.match(d.reason, /^ai_blocked: .*topic_without_source:chexsystems/);
    assert.ok(d.reply.endsWith("From: Blueprint lessons."));
  });

  test("a number only the lesson holds may be said with the lesson, and not without it", async () => {
    const reply = "Fundhub counts an account as seasoned at 30 days, and 60 or 90 days are even better.\nFrom: Fundhub bank book.";
    const withLesson = await ask("What is seasoning?", { callModelFn: model({ reply, actions: [] }) });
    assert.equal(withLesson.brain, "ai", withLesson.reason);
    const plain = buildFacts(ctx());
    assert.ok(groundingProblems("60 or 90 days", collectAllowed(plain.facts, TODAY), { today: TODAY }).length > 0,
      "without the lesson, 60 and 90 are numbers nobody handed the helper");
  });

  test("a mixed question: an answer about their own money that does not talk about the lesson needs no doc", async () => {
    const fn = model({ reply: "Your Business Amex has $135.00 due Oct 15.", actions: [] });
    const d = await ask("Is my utilization too high, and what is due next week?", { callModelFn: fn });
    assert.equal(d.facts.topic_guidance[0].topic, "card_use");
    assert.equal(d.brain, "ai", d.reason);
  });

  test("an answer that offers Net 30 accounts, DUNS or Nav is blocked, lesson or not", async () => {
    const pushy = model({ reply: "Get a DUNS number and open a few Net 30 accounts.", actions: [] });
    const d = await ask("How do I build my file?", { callModelFn: pushy });
    assert.equal(d.brain, "rules");
    assert.match(d.reason, /excluded_tool_named/);
    const asked = model({ reply: "Net 30 accounts are not part of your Fundhub plan. Your plan works on your personal file first.\nFrom: Capital Blueprint plan.", actions: [] });
    const ok = await ask("Should I open Net 30 accounts?", { callModelFn: asked });
    assert.equal(ok.brain, "ai", ok.reason);
    const rules = await ask("Should I open Net 30 accounts?", { useAi: false });
    assert.equal(rules.reply, `${topicByKey("not_in_plan").answer}\nFrom: Capital Blueprint plan.`);
  });

  test("topicReplyProblems on its own: the doc, any case, and nothing for a lesson that was not handed over", () => {
    const g = topicGuidance("What are inquiries?");
    assert.deepEqual(topicReplyProblems("A hard inquiry can stay on your report. from: applying on your own lesson", g), []);
    assert.deepEqual(topicReplyProblems("A hard inquiry can stay on your report.", g), ["topic_without_source:inquiries"]);
    assert.deepEqual(topicReplyProblems("Seasoning helps.", g), [], "seasoning was not handed over, so no doc is asked for");
    assert.deepEqual(topicReplyProblems("Open Net 30s.", []), ["excluded_tool_named"]);
    assert.deepEqual(topicReplyProblems("Nav is not part of your Fundhub plan.", []), []);
  });
});

describe("the prompt", () => {
  test("no lesson: the prompt is exactly as before; a lesson adds its few lines and the system prompt never changes", () => {
    const plain = buildFacts(ctx());
    const p0 = buildPrompt({ agent, facts: plain.facts, turn: { kind: "message", input: "What is due?" } });
    assert.doesNotMatch(p0.user, /LESSONS|topic_guidance/);
    const withLesson = buildFacts({ ...ctx(), topic_guidance: topicGuidance("How should I use my cards?") });
    const p1 = buildPrompt({ agent, facts: withLesson.facts, turn: { kind: "message", input: "How should I use my cards?" } });
    for (const line of lessonPromptBlock(withLesson.facts.topic_guidance).filter(Boolean)) assert.ok(p1.user.includes(line), line);
    assert.match(p1.user, /"topic": "card_use"/);
    assert.equal(p0.system, p1.system);
    assert.ok(p1.system.startsWith(HELPER_PROMPT));
  });
});
