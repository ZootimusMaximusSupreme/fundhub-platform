// The research building blocks, pure: the source checks, the cost guard, the pause_turn
// loop, the Hormozi vault scorer on the real vault, and the route helpers' words.
// No database, no network. Unit X2.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUrl, normText, collectSources, textAfterLastToolResult, parseJsonObject,
  linkIsSourced, quoteStatus, priceStated, vaultQuoteHolds, keepOnlySourcedLinks, READER_PREFIX, hostOf
} from "./provenance.mjs";
import { reserveUsd, fitBatch, dollars, capSentence } from "./cost-guard.mjs";
import { callCostUsd, SEARCH_USD } from "./usage.mjs";
import { researchCall, webTools, plainError, searcherModel, WEB_SEARCH_TOOL, WEB_FETCH_TOOL } from "./web-call.mjs";
import { loadVault, scorePassages, vaultBlocks, readVaultFile, terms, VAULT_DIR } from "./vault.mjs";
import {
  checkResearchStart, BadQuestionError, researchStateWord, researchJobView, researchReportView,
  monthState, hasModelKey, researchLimits, marketLimits, marketRunView, researchNotReady, checkMarketStart
} from "./store.mjs";
import { InvalidError } from "../http.mjs";
import { readStageFiles, repoFlywheelDefaults } from "./repo-read.mjs";
import { bodyHash } from "../../../scripts/flywheel/status.mjs";

describe("provenance", () => {
  test("normalizeUrl: one form for the same page; the reader prefix reads as the page it read", () => {
    const n = normalizeUrl("https://www.Example.com/a/b/?utm_source=x&b=2&a=1#top");
    assert.equal(n, "example.com/a/b?a=1&b=2");
    assert.equal(normalizeUrl(`${READER_PREFIX}https://example.com/a/b`), "example.com/a/b");
    assert.equal(normalizeUrl("example.com/x"), "example.com/x");
    assert.equal(normalizeUrl("not a url"), null);
    assert.equal(normalizeUrl("javascript:alert(1)"), null);
    assert.equal(hostOf("https://www.trustpilot.com/review/x"), "trustpilot.com");
  });

  test("collectSources takes links only from result blocks and citations, never from the model's own words", () => {
    const s = collectSources([
      { type: "text", text: "I think https://typed.example/ is good" },
      { type: "server_tool_use", id: "a", name: "web_search", input: { query: "q1" } },
      { type: "web_search_tool_result", tool_use_id: "a", content: [{ type: "web_search_result", url: "https://s.example/1", title: "S" }] },
      { type: "web_search_tool_result", tool_use_id: "b", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
      { type: "server_tool_use", id: "c", name: "web_fetch", input: { url: "https://f.example/2" } },
      { type: "web_fetch_tool_result", tool_use_id: "c", content: { type: "web_fetch_result", url: "https://f.example/2", content: { type: "document", source: { type: "text", data: "page words" } } } },
      { type: "server_tool_use", id: "d", name: "web_fetch", input: { url: "https://x.example/3" } },
      { type: "web_fetch_tool_result", tool_use_id: "d", content: { type: "web_fetch_tool_result_error", error_code: "url_not_allowed" } },
      { type: "text", text: "x", citations: [{ type: "web_search_result_location", url: "https://c.example/4", cited_text: "cited words" }, { type: "search_result_location", source: "marketing/knowledge/hormozi/a.md", cited_text: "vault words" }] }
    ]);
    assert.deepEqual([...s.urls.keys()].sort(), ["c.example/4", "f.example/2", "s.example/1"]);
    assert.equal(linkIsSourced("https://typed.example/", s), false);
    assert.deepEqual(s.searchErrors, ["max_uses_exceeded"]);
    assert.deepEqual(s.fetchErrors, [{ url: "https://x.example/3", code: "url_not_allowed" }]);
    assert.equal(s.fetched.get("f.example/2"), "page words");
    assert.deepEqual(s.vaultCited.get("marketing/knowledge/hormozi/a.md"), ["vault words"]);
    assert.deepEqual(s.searchQueries, ["q1"]);
  });

  test("the JSON answer is the text after the last tool result, joined with nothing between", () => {
    const blocks = [
      { type: "text", text: "{\"not\": \"this\"}" },
      { type: "web_search_tool_result", content: [] },
      { type: "text", text: "Done. {\"a\":" },
      { type: "text", text: "1, \"b\": [2]}", citations: [] }
    ];
    assert.equal(textAfterLastToolResult(blocks), "Done. {\"a\":1, \"b\": [2]}");
    assert.deepEqual(parseJsonObject(textAfterLastToolResult(blocks)), { a: 1, b: [2] });
    assert.equal(parseJsonObject("no json here"), null);
    assert.equal(parseJsonObject("[1,2]"), null);
  });

  test("quotes: verbatim only from the cited text or the fetched page of THAT link; short or other links are paraphrase", () => {
    const s = collectSources([
      { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://p.example/", content: { type: "document", source: { type: "text", data: "We fund new brokers in 30 days. Price: $997." } } } },
      { type: "text", text: "x", citations: [{ type: "web_search_result_location", url: "https://q.example/", cited_text: "Start your own funding company today" }] }
    ]);
    assert.equal(quoteStatus("“We fund new brokers in 30 days.”", "https://p.example", s), "verbatim");
    assert.equal(quoteStatus("start your own funding company", "https://q.example/", s), "verbatim");
    assert.equal(quoteStatus("start your own funding company", "https://p.example/", s), "paraphrase", "words from another link do not count");
    assert.equal(quoteStatus("30 days", "https://p.example/", s), "paraphrase", "too short to count as checked");
    assert.equal(quoteStatus("", "https://p.example/", s), "none");
    assert.equal(priceStated("$997", "https://p.example/", s), true);
    assert.equal(priceStated("$5,000", "https://p.example/", s), false);
    assert.equal(priceStated("free", "https://p.example/", s), false, "a price must hold a digit");
    assert.equal(normText("  “Hello—World…”  "), "hello-world");
  });

  test("vault quotes must be in the named repo file", () => {
    assert.equal(vaultQuoteHolds("make the offer so good", "Make the offer so good people feel stupid"), true);
    assert.equal(vaultQuoteHolds("an offer nobody wrote", "Make the offer so good people feel stupid"), false);
  });

  test("every link in a written document must be a kept source", () => {
    const out = keepOnlySourcedLinks("See https://a.example/x. Also https://b.example/y, and (https://www.a.example/x/).", ["https://a.example/x"]);
    assert.equal(out.removed, 1);
    assert.match(out.text, /See https:\/\/a\.example\/x\. Also \(link removed: not one of the sources this run read\), and \(https:\/\/www\.a\.example\/x\/\)\./);
  });
});

describe("cost guard", () => {
  test("a reserve counts output at max_tokens, every search at a cent, pages at their size", () => {
    assert.equal(reserveUsd({ model: "claude-sonnet-5-5", maxTokens: 1000 }), 0.01);
    assert.equal(reserveUsd({ model: "claude-sonnet-5-5", searches: 2 }), Math.round((2 * 4000 * 2 * 2 / 1e6 + 0.02) * 1e6) / 1e6);
    assert.ok(reserveUsd({ model: "unknown-model", maxTokens: 1000 }) >= reserveUsd({ model: "claude-opus-5-5", maxTokens: 1000 }), "unpriced reserves at the highest rate");
  });
  test("fitBatch shrinks first, then stops on the tighter cap; the write-up reserve is held back", () => {
    assert.deepEqual(fitBatch({ wanted: 4, perCallUsd: 1, spentUsd: 0, runCapUsd: 10 }), { allowed: 4, shrunk: false, stop: null, roomUsd: 10 });
    assert.deepEqual(fitBatch({ wanted: 4, perCallUsd: 1, spentUsd: 7.5, runCapUsd: 10 }), { allowed: 2, shrunk: true, stop: null, roomUsd: 2.5 });
    assert.equal(fitBatch({ wanted: 4, perCallUsd: 1, spentUsd: 8, runCapUsd: 10, holdBackUsd: 1.5 }).stop, "run_cap");
    assert.equal(fitBatch({ wanted: 1, perCallUsd: 1, spentUsd: 0, runCapUsd: 40, monthUsedUsd: 299.5, monthCapUsd: 300 }).stop, "month_cap");
    assert.equal(fitBatch({ wanted: 1, perCallUsd: 1, spentUsd: 0, runCapUsd: 40, monthUsedUsd: 299.5, monthCapUsd: null }).allowed, 1, "research with its own budget skips the month cap");
  });
  test("the sentences", () => {
    assert.equal(dollars(40), "$40");
    assert.equal(dollars(2.5), "$2.50");
    assert.equal(dollars(0.62), "$0.62");
    assert.equal(capSentence({ stop: "run_cap", runCapUsd: 40, afterStep: 2 }), "Stopped at the $40 run cap after step 2. What it found so far is saved.");
    assert.equal(capSentence({ stop: "run_cap", runCapUsd: 40, afterStep: 0 }), "Stopped at the $40 run cap before step 1. Nothing was spent on this run.");
    assert.match(capSentence({ stop: "month_cap", monthCapUsd: 300 }), /^Stopped at the \$300 month cap\./);
  });
  test("a call's bill: tokens at the served model's price plus a cent a search; unknown model is null", () => {
    assert.equal(SEARCH_USD, 0.01);
    assert.equal(callCostUsd("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 0 }, 5), 4.05);
    assert.equal(callCostUsd("some-other-model", { input_tokens: 1 }, 5), null);
  });
});

describe("researchCall: web tools, the pause_turn loop and the ledger list", () => {
  const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  test("the tool versions are the current ones; fetch citations stay off", () => {
    assert.deepEqual(webTools({ searches: 7, fetches: 5, fetchMaxTokens: 9000 }), [
      { type: WEB_SEARCH_TOOL, name: "web_search", max_uses: 7 },
      { type: WEB_FETCH_TOOL, name: "web_fetch", max_uses: 5, max_content_tokens: 9000 }
    ]);
    assert.equal(WEB_SEARCH_TOOL, "web_search_20260318");
    assert.equal(WEB_FETCH_TOOL, "web_fetch_20260318");
    assert.deepEqual(webTools({}), []);
  });

  test("a paused turn is resent unchanged with max_uses lowered by the searches used; at most 2 continuations", async () => {
    const sent = [];
    const paused1 = [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "a" } }, { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://a.example/" }] }];
    const paused2 = [{ type: "server_tool_use", id: "s2", name: "web_search", input: { query: "b" } }];
    const final = [{ type: "web_search_tool_result", tool_use_id: "s2", content: [{ type: "web_search_result", url: "https://b.example/" }] }, { type: "text", text: "{\"findings\":[]}" }];
    const replies = [
      { stopReason: "pause_turn", content: paused1, searches: 3 },
      { stopReason: "pause_turn", content: paused2, searches: 2 },
      { stopReason: "end_turn", content: final, searches: 1 }
    ];
    const callModel = async (args) => {
      sent.push(JSON.parse(JSON.stringify({ messages: args.messages, tools: args.tools, provider: args.provider, timeoutMs: args.timeoutMs })));
      const r = replies.shift();
      return { mode: "live", status: 200, raw: {}, error: null, stopReason: r.stopReason, servedModel: "claude-sonnet-5-5", usage, content: r.content, serverToolUse: { web_search_requests: r.searches, web_fetch_requests: 0 }, json: null };
    };
    const out = await researchCall({ callModel, env: {}, model: "claude-sonnet-5-5", prompt: "go", searches: 8, fetches: 0, maxTokens: 1000 });
    assert.equal(out.ok, true);
    assert.equal(out.continuations, 2);
    assert.equal(out.searches, 6);
    assert.deepEqual(out.json, { findings: [] });
    assert.equal(sent[0].provider, "anthropic");
    assert.ok(sent[0].timeoutMs <= 270000);
    assert.equal(sent[0].tools[0].max_uses, 8);
    assert.equal(sent[1].tools[0].max_uses, 5, "8 minus the 3 already used");
    assert.deepEqual(sent[1].messages, [{ role: "user", content: "go" }, { role: "assistant", content: paused1 }], "the paused content resent unchanged");
    assert.deepEqual(sent[2].messages[1].content, [...paused1, ...paused2]);
    assert.equal(out.calls.length, 3, "one ledger row per HTTP call");
    assert.deepEqual([...out.sources.urls.keys()].sort(), ["a.example", "b.example"]);
  });

  test("errors in plain words; no key and search turned off are final", async () => {
    assert.deepEqual(plainError("not sent: ANTHROPIC_API_KEY is not set, so Claude was not called."), { plain: "No Anthropic key is set on the site. An agent must set it.", final: true, temporary: false });
    assert.equal(plainError('anthropic 400: {"type":"error","error":{"type":"invalid_request_error","message":"Web search is not enabled for this organization"}}').plain,
      "Web search is turned off for our Anthropic account. One click turns it on: https://platform.claude.com/settings/capabilities.");
    assert.equal(plainError("anthropic 529: overloaded").temporary, true);
    assert.equal(plainError("anthropic timeout: no answer").temporary, true);
    const callModel = async () => ({ mode: "shadow", error: "not sent: ANTHROPIC_API_KEY is not set, so Claude was not called.", content: [], usage: {}, serverToolUse: { web_search_requests: 0, web_fetch_requests: 0 } });
    const out = await researchCall({ callModel, env: {}, model: "claude-opus-5-5", prompt: "x" });
    assert.equal(out.ok, false);
    assert.equal(out.final, true);
    assert.equal(out.calls.length, 0, "nothing sent, nothing billed");
  });

  test("the searcher model flips by one env name, and only to a Claude model", () => {
    assert.equal(searcherModel({}), "claude-sonnet-5-5");
    assert.equal(searcherModel({ MARKETING_RESEARCH_MODEL: "claude-opus-5-5" }), "claude-opus-5-5");
    assert.equal(searcherModel({ MARKETING_RESEARCH_MODEL: "gpt-4o-mini" }), "claude-sonnet-5-5");
    assert.equal(searcherModel({ MARKETING_RESEARCH_MODEL: "****1234" }), "claude-sonnet-5-5");
  });
});

describe("the Hormozi vault (the real files in the repo)", () => {
  const docs = loadVault();
  test("it loads the notes from the repo, INDEX.md left out", () => {
    assert.ok(docs.length >= 100, `found ${docs.length} notes`);
    assert.ok(docs.every((d) => d.path.startsWith(`${VAULT_DIR}/`) && d.path.endsWith(".md") && !d.path.endsWith("INDEX.md")));
  });
  test("the keyword scorer finds offer passages for an offer question, the same way every time", () => {
    const a = scorePassages(docs, "How should a funding broker price a grand slam offer and guarantee?", { limit: 5 });
    const b = scorePassages(docs, "How should a funding broker price a grand slam offer and guarantee?", { limit: 5 });
    assert.equal(a.length, 5);
    assert.deepEqual(a.map((p) => [p.path, p.index]), b.map((p) => [p.path, p.index]));
    assert.ok(a.every((p) => /offer|guarantee|price/i.test(p.text)));
    const blocks = vaultBlocks(a.slice(0, 1));
    assert.equal(blocks[0].type, "search_result");
    assert.equal(blocks[0].source, a[0].path, "a citation names the repo file");
    assert.deepEqual(blocks[0].citations, { enabled: true });
    assert.deepEqual(scorePassages(docs, "the and of", { limit: 5 }), [], "filler words match nothing");
    assert.ok(terms("The Grand Slam Offer!").includes("grand"));
  });
  test("readVaultFile opens only a normal path inside the vault", () => {
    assert.ok(readVaultFile(docs[0].path));
    assert.equal(readVaultFile("marketing/knowledge/hormozi/../../../.env"), null);
    assert.equal(readVaultFile("credentials/env.full.snapshot"), null);
    assert.equal(readVaultFile("marketing/flywheel/partner/01-avatar.md"), null);
  });
});

describe("the repo read (GitHub at one commit, outbox saves on top, the bundle as fallback)", () => {
  // Unit GL: the read is the one stage reader (src/marketing/flywheel/stage-inputs.mjs),
  // which asks for this company's flywheel saves, newest id first.
  const ORG = "22222222-2222-4222-8222-222222222222";
  const pendingDb = (byPath, { edits = [] } = {}) => ({
    query: async (sql, params) => {
      assert.match(sql, /FROM repo_outbox/);
      assert.equal(params[0], ORG, "only this company's saves");
      let id = 0;
      const rows = Object.entries(byPath).map(([path, content]) => ({ id: ++id, path, mode: "replace", content, edit: null, committed_sha: null }));
      for (const e of edits) rows.push({ id: ++id, committed_sha: null, content: null, mode: "edit", ...e });
      return { rows: rows.reverse() };
    }
  });
  test("GitHub at the pinned commit is the source when it answers; a waiting save wins over it", async () => {
    const asked = [];
    const getRef = async () => ({ ok: true, sha: "abc123" });
    const getContents = async (p, { ref }) => {
      asked.push([p, ref]);
      if (p.endsWith("01-avatar.md")) return { ok: true, content: "---\nstage: 1\n---\nGitHub avatar" };
      if (p.endsWith("02-ad-research.md")) return { ok: true, content: "---\nstage: 2\nversion: 7\n---\nold board" };
      return { ok: true, missing: true, content: null };
    };
    const db = pendingDb({ "marketing/flywheel/partner/02-ad-research.md": "---\nstage: 2\nversion: 8\n---\nnew board waiting in the outbox" });
    const r = await readStageFiles(db, "partner", { env: {}, orgId: ORG, getRef, getContents });
    assert.equal(r.source, "github");
    assert.ok(asked.every(([, ref]) => ref === "abc123"), "every file read at the same commit");
    assert.equal(r.avatar.body, "GitHub avatar");
    assert.equal(r.avatar.hash, bodyHash("---\nstage: 1\n---\nGitHub avatar"));
    assert.equal(r.priorVersion, 8, "the waiting save is the newest copy");
    assert.deepEqual(r.pending, ["marketing/flywheel/partner/02-ad-research.md"]);
    const d = await repoFlywheelDefaults(db, "partner", { env: {}, orgId: ORG, getRef, getContents });
    assert.equal(d.research, "new board waiting in the outbox");
    assert.equal(d.files.research, "marketing/flywheel/partner/02-ad-research.md");
    assert.equal(d.ownerNotes, "");
  });
  test("no token: the bundled copy, named as such", async () => {
    const r = await readStageFiles(pendingDb({}), "partner", { env: {}, orgId: ORG });
    assert.equal(r.source, "bundle-fallback");
    assert.ok(r.avatar && r.avatar.body.length > 100, "the bundled partner avatar");
    await assert.rejects(readStageFiles(pendingDb({}), "../x", { env: {} }), TypeError);
  });
  test("unit GL: a waiting Approve counts, and with no company no saves are read at all", async () => {
    const avatar = "---\nstage: 1\nversion: 1\nstatus: draft\n---\nnew avatar from the dashboard";
    const db = pendingDb({ "marketing/flywheel/capital-blueprint/01-avatar.md": avatar },
      { edits: [{ path: "marketing/flywheel/capital-blueprint/01-avatar.md", edit: { op: "set_front_matter_key", key: "status", value: "approved" } }] });
    const r = await readStageFiles(db, "capital-blueprint", { env: {}, orgId: ORG });
    assert.equal(r.source, "bundle-fallback");
    assert.match(r.files.avatar, /^---\nstage: 1\nversion: 1\nstatus: approved\n/, "the Approve edit is laid on the save");
    assert.equal(r.avatar.body, "new avatar from the dashboard");
    assert.deepEqual(r.pending, ["marketing/flywheel/capital-blueprint/01-avatar.md"]);
    const none = await readStageFiles({ query: async () => { throw new Error("no query without a company"); } }, "capital-blueprint", { env: {} });
    assert.equal(none.avatar, null);
  });
});

describe("the route helpers", () => {
  test("checkResearchStart: the design's defaults and refusals", () => {
    const ok = checkResearchStart({ question: "  Who sells   programs? ", max_cost_usd: 5 }, null);
    assert.deepEqual(ok, { question: "Who sells programs?", depth: "quick", sources: { web: true, vault: true, own_files: false }, belief: null, max_cost_usd: 5 });
    assert.equal(checkResearchStart({ question: "Who sells programs?" }, { max_research_cost_usd: "7.50" }).max_cost_usd, 7.5, "Settings' stop amount fills a blank box");
    assert.throws(() => checkResearchStart({ question: "ab", max_cost_usd: 5 }, null), (e) => e instanceof BadQuestionError && e.field === "question");
    assert.throws(() => checkResearchStart({ question: "Who sells programs?" }, null), (e) => e instanceof BadQuestionError && e.field === "max_cost_usd");
    assert.throws(() => checkResearchStart({ question: "Who sells programs?", max_cost_usd: 0.5 }, null), (e) => e instanceof BadQuestionError && e.field === "max_cost_usd");
    assert.throws(() => checkResearchStart({ question: "Who sells programs?", max_cost_usd: 5, sources: { web: false, vault: false } }, null), (e) => e instanceof BadQuestionError && e.field === "sources");
    assert.throws(() => checkResearchStart({ question: "Who sells programs?", max_cost_usd: 5, sources: { drive: true } }, null), (e) => e instanceof InvalidError && e.field === "sources.drive");
    assert.throws(() => checkResearchStart({ question: "Who sells programs?", max_cost_usd: "5" }, null), (e) => e instanceof InvalidError);
  });

  test("the row words (design §3.2 item 5)", () => {
    const running = { status: "running", result: { step: "sweep", step_word: "sweeping round 2 of up to 6", progress: { findings: 37, cost_usd_so_far: 1.12 } } };
    assert.equal(researchStateWord(running), "Running: sweeping round 2 of up to 6 · 37 findings · $1.12 so far");
    assert.equal(researchStateWord({ status: "queued", result: null }), "Waiting to start. It runs in the background.");
    assert.equal(researchStateWord({ status: "done", result: { report: { key_verified: 11, key_killed: 3 } } }), "Done, 11 of 14 key claims held up");
    assert.equal(researchStateWord({ status: "done", result: { report: { stopped_at_cap: { reason: "run_cap" }, cost_usd: 4.98, rounds: 3 } } }), "Done, stopped at the cap: $4.98 after round 3");
    assert.equal(researchStateWord({ status: "done", result: { report: { fallback_report: true } } }), "Done, write-up failed, findings below");
    assert.equal(researchStateWord({ status: "failed", error: "Web search is turned off." }), "Could not finish: Web search is turned off.");
    const v = researchJobView({ id: "x", status: "failed", payload: { question: "q", depth: "deep" }, result: { steps: {}, state: {} }, error: "e" });
    assert.equal(v.resumable, true);
    assert.equal(v.depth, "deep");
    assert.equal(researchReportView({ status: "running", result: null }), null, "no report until done");
  });

  test("month state, the key check, limits, market words, not-ready", () => {
    assert.deepEqual(monthState({ max_month_cost_usd: 300, research_shares_month_cap: true }, 300), { month_used_usd: 300, month_cap_usd: 300, shares: true, capped: true });
    assert.equal(monthState({ max_month_cost_usd: 300, research_shares_month_cap: false }, 400).capped, false);
    assert.equal(hasModelKey({ ANTHROPIC_API_KEY: "sk-ant-x" }), true);
    assert.equal(hasModelKey({ ANTHROPIC_API_KEY: "****abcd" }), false);
    assert.equal(hasModelKey({}), false);
    assert.deepEqual(researchLimits().quick.searches, 62);
    assert.deepEqual([marketLimits().searches, marketLimits().searches_with_retries, marketLimits().search_usd], [106, 138, 1.06]);
    const m = marketRunView({ id: "j", status: "failed", payload: { campaign: "partner" }, error: "x", result: { steps: {}, state: { round: 2 }, stopped: { sentence: "Stopped at the $40 run cap after step 2. What it found so far is saved." }, progress: { findings: 23, cost_usd_so_far: 38.2 } } });
    assert.equal(m.step_word, "Stopped at the $40 run cap after step 2. What it found so far is saved.");
    assert.equal(m.resumable, true);
    assert.equal(m.campaign_words, "Partner offer");
    assert.equal(researchNotReady({ code: "42703", message: 'column "approved_at" does not exist' }), true);
    assert.equal(researchNotReady({ code: "42703", message: 'column "other" does not exist' }), false);
    assert.equal(checkMarketStart({}).campaign, "partner");
    assert.throws(() => checkMarketStart({ campaign: "Bad Name" }), InvalidError);
  });
});
