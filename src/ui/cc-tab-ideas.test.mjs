// The Command Center's Ideas tab (build unit X8): every rule that turns data
// into words. public/app/cc-tab-ideas.js puts them on window.FundhubIdeasTab,
// so this file runs the real script in node:vm (the same pattern as
// src/ui/marketing-command-center.test.mjs) with no browser and no server.
// The tap paths themselves run in e2e/cc-tab-ideas.spec.mjs.
//
// What it holds the tab to (design docs/specs/command-center-design-2026-10-05.md):
//   §5 rule 3   a cost line before every paid tap; unmeasured = "unknown"
//   §5 rule 5   Push live's second tap names the address
//   §5 rule 8   null is "unknown", never $0
//   §5 rule 9   a part with no back end says one honest sentence, no button
//   §3.9        nothing says "Runs in chat"

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { OFFERS, OFFER_KEYS } from "../config/offers.mjs";
import { FUNNEL_OFFERS } from "../marketing/funnel-paths.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SRC = fs.readFileSync(path.join(APP, "cc-tab-ideas.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "cc-tab-ideas.css"), "utf8");

function load() {
  const ctx = createContext({ console });
  runInContext(SRC, ctx);
  return ctx.FundhubIdeasTab;
}
const T = load();

const COSTS = T.normalizeCosts({
  ok: true,
  data: {
    kinds: {
      offer: { last_cost_usd: 0.67, last_minutes: 4.5, measured_at: "2026-10-04T22:00:00.000Z" },
      script: { last_cost_usd: 0.42, last_minutes: 3, measured_at: "2026-10-05T14:00:00.000Z" },
      avatar: null
    },
    month: { used_usd: 12.34, cap_usd: 300 },
    run_caps: { avatar: 20, ad_research: 40 }
  }
});
const NO_COSTS = T.normalizeCosts({ ok: false, notBuilt: true });

describe("never a fake number", () => {
  test("money and dollars print unknown for null and keep a real 0", () => {
    assert.equal(T.money(null), "unknown");
    assert.equal(T.money(undefined), "unknown");
    assert.equal(T.money(0), "$0.00");
    assert.equal(T.money(49801), "$498.01");
    assert.equal(T.dollars(null), "unknown");
    assert.equal(T.dollars(0.67), "$0.67");
    assert.equal(T.dollars(0.004), "under 1 cent");
  });

  test("the planner's numbers say unknown, never $0", () => {
    assert.equal(T.suggestionNumbers({ spend_7d_cents: 41200, leads: 9, cpl_cents: 4578 }), "$412.00 spend, 9 leads, $45.78 a lead");
    assert.equal(T.suggestionNumbers({ spend_7d_cents: null, leads: null, cpl_cents: null }), "unknown spend, leads unknown, cost per lead unknown");
  });
});

describe("cost lines (design §5 rule 3)", () => {
  test("an unmeasured kind says so and still shows its cap and searches", () => {
    const lines = T.costLines("avatar", COSTS).join(" ");
    assert.match(lines, /^Cost: unknown, not measured yet\./);
    assert.match(lines, /It stops by itself at \$20\.00\./);
    assert.match(lines, /At most 184 web searches \(\$1\.84 of it is search/);
    assert.match(lines, /\$12\.34 of \$300\.00 model spend used this month\./);
  });

  test("a measured kind prints the last real run", () => {
    assert.equal(T.costLines("offer", COSTS)[0], "About $0.67 and 5 minutes (last run, Oct 4).");
    assert.match(T.costLines("script", COSTS)[0], /^One script\. About \$0\.42 \(last script, Oct 5\)\.$/);
  });

  test("market research: the batch cap and the 106 / 138 search ceilings", () => {
    const lines = T.costLines("ad_research", COSTS).join(" ");
    assert.match(lines, /cannot go past \$40\.00 a run/);
    assert.match(lines, /At most 106 web searches \(\$1\.06\), 138 if a slow part is tried again \(\$1\.38\)/);
  });

  test("deep research: searches and fees worked out in code; no cap means no button", () => {
    assert.match(T.costLines("research", COSTS, { depth: "quick", cap: 5 }).join(" "), /About 62 web searches\..*about \$0\.62 in search fees.*It stops at your cap: \$5\.00 for this run\./);
    assert.match(T.costLines("research", COSTS, { depth: "deep", cap: 20 }).join(" "), /About 542 web searches\..*about \$5\.42/);
    assert.match(T.costLines("research", COSTS, { depth: "quick", cap: null }).join(" "), /Type a stop amount first\./);
  });

  test("the server's own search limit wins over the design number", () => {
    const c = T.normalizeCosts({ ok: true, data: { kinds: { avatar: { last_cost_usd: null, max_searches: 150 } }, month: {} } });
    assert.match(T.costLines("avatar", c).join(" "), /At most 150 web searches \(\$1\.50/);
  });

  test("no costs route yet: every line says unknown, the meter too", () => {
    for (const kind of ["avatar", "ad_research", "offer", "copy", "ad_strategy", "script", "quick_copy", "funnel"]) {
      const lines = T.costLines(kind, NO_COSTS).join(" ");
      assert.match(lines, /unknown/, kind);
      assert.match(lines, /Model spend this month: unknown, not measured yet\./, kind);
      assert.doesNotMatch(lines, /\$0\.00/, kind + " never prints $0 for unknown");
    }
    assert.equal(T.meterLine(NO_COSTS), "Model spend this month: unknown, not measured yet. Nothing on this tab spends ad money.");
    assert.equal(T.meterLine(COSTS), "Model spend this month: $12.34 of $300.00. Nothing on this tab spends ad money.");
  });
});

describe("search ceilings come from the server's own limits (design §3.2, §5 rule 3)", () => {
  test("X1's GET marketing/costs: limits.avatar.max_searches and its dollars", () => {
    const c = T.normalizeCosts({ ok: true, data: { kinds: { avatar: null }, month: {}, run_caps: { avatar: 20 }, limits: { avatar: { steps: 7, max_searches: 200, max_search_usd: 2 } } } });
    assert.match(T.costLines("avatar", c).join(" "), /At most 200 web searches \(\$2\.00 of it is search/);
    assert.equal(T.searchCeiling(c, "avatar").from, "server");
  });

  test("X2's GET marketing/research: limits.quick and limits.deep", () => {
    const rl = { quick: { searches: 70, search_usd: 0.7, rounds: 2 }, deep: { searches: 600, search_usd: 6, rounds: 5 } };
    assert.match(T.costLines("research", COSTS, { depth: "quick", cap: 5, researchLimits: rl }).join(" "), /About 70 web searches\..*about \$0\.70 in search fees/);
    assert.match(T.costLines("research", COSTS, { depth: "deep", cap: 20, researchLimits: rl }).join(" "), /About 600 web searches\..*about \$6\.00 in search fees/);
  });

  test("market research: limits.ad_research with its retries pair", () => {
    const c = T.normalizeCosts({ ok: true, data: { kinds: {}, month: {}, limits: { ad_research: { searches: 110, searches_with_retries: 140 } } } });
    assert.match(T.costLines("ad_research", c).join(" "), /At most 110 web searches \(\$1\.10\), 140 if a slow part is tried again \(\$1\.40\)/);
  });

  test("order: research limits, then costs limits, then kinds.max_searches, then the design", () => {
    const c = T.normalizeCosts({ ok: true, data: { kinds: { avatar: { last_cost_usd: null, max_searches: 150 }, research_quick: { max_searches: 40 } }, month: {}, limits: { avatar: { max_searches: 190 }, research_quick: { max_searches: 50 } } } });
    assert.equal(T.searchCeiling(c, "avatar").n, 190);
    assert.equal(T.searchCeiling(c, "research_quick", { researchLimits: { quick: { searches: 66 } } }).n, 66);
    assert.equal(T.searchCeiling(c, "research_quick").n, 50);
    const k = T.normalizeCosts({ ok: true, data: { kinds: { research_quick: { max_searches: 40 } }, month: {} } });
    assert.equal(T.searchCeiling(k, "research_quick").n, 40);
  });

  test("nothing sent: the design's numbers, and the page knows they are the design's", () => {
    for (const [kind, n] of [["avatar", 184], ["ad_research", 106], ["ad_research_retries", 138], ["research_quick", 62], ["research_deep", 542]]) {
      const s = T.searchCeiling(NO_COSTS, kind, { researchLimits: {} });
      assert.equal(s.n, n, kind);
      assert.equal(s.from, "design", kind);
    }
  });
});

describe("the API answer", () => {
  test("the router's 404 (it names the path) means not built; a handler 404 does not", () => {
    const router = T.answer({ ok: false, status: 404, data: { ok: false, error: "not_found", path: "/api/marketing/flywheel" } });
    assert.equal(router.notBuilt, true);
    const handler = T.answer({ ok: false, status: 404, data: { error: "not_found" } });
    assert.equal(handler.notBuilt, false);
  });

  test("errors are plain words, never a status code", () => {
    const cases = [
      [{ status: 0 }, /connection/],
      [{ status: 401, data: {} }, /signed out/],
      [{ status: 403, data: { error: "forbidden" } }, /owner and admins/],
      [{ status: 503, data: { error: "no_model" } }, /No Anthropic key is set on the site\. An agent must set it\./],
      [{ status: 503, data: { error: "not_ready" } }, /not live yet\. It turns on at the next ship\./],
      [{ status: 409, data: { error: "cap_hit", message: "Stopped at the $20 run cap." } }, /Stopped at the \$20 run cap\./],
      [{ status: 400, data: { error: "invalid", field: "path", message: "That address is already a live page." } }, /already a live page/],
      [{ status: 500, data: { error: "internal_error" } }, /did not work/]
    ];
    for (const [r, re] of cases) {
      const w = T.plainError(r);
      assert.match(w, re);
      assert.doesNotMatch(w, /\b[45]\d\d\b/, "no status code in: " + w);
    }
  });
});

describe("flywheel rows (design §3.2 item 6)", () => {
  test("the word table, from the state when the server sends no word", () => {
    const w = (raw) => T.stageView(raw, "partner").word;
    assert.equal(w({ n: 1, state: "READY", approved: true }), "Done, approved");
    assert.equal(w({ n: 1, state: "READY" }), "Done");
    assert.equal(w({ n: 3, state: "FAILED" }), "Needs a redo");
    assert.equal(w({ n: 2, state: "STALE" }), "Out of date");
    assert.equal(w({ n: 6, state: "MISSING" }), "Not run yet");
    assert.equal(w({ n: 1, state: "MISSING", run: { status: "running" } }), "Running");
    assert.equal(w({ n: 2, state: "MISSING", run: { status: "failed", resumable: true, stopped_at_cap: true } }), "Stopped at the cap");
    assert.equal(w({ n: 2, state: "READY", state_word: "Thin" }), "Thin");
  });

  test("plain names, never 'Flywheel step N'", () => {
    assert.equal(T.stageView({ n: 1 }, "partner").name, "Who we sell to");
    assert.equal(T.stageView({ n: 4 }, "partner").name, "Ad copy for the partner offer");
    assert.equal(T.stageView({ n: 4 }, "capital-blueprint").name, "Ad copy for the capital blueprint");
    assert.equal(T.campaignWords("partner"), "Partner offer");
  });

  test("the running row prints the step and the live spend", () => {
    const v = T.stageView({ n: 1, state: "MISSING", run: { status: "running", step_n: 3, steps_total: 10, step_word: "searching the web for buyer quotes", round: 2, counts_so_far: { added: 58, kept: 455 }, searches_so_far: 23, cost_so_far_usd: 1.9 } }, "partner");
    assert.equal(T.runningWords(v.run), "Running: step 3 of 10, searching the web for buyer quotes, round 2. 58 new quotes so far (455 kept from last time). $1.90 spent so far, 23 searches.");
  });

  test("steps 4 and 5 wait on approvals, with the reason", () => {
    const all = [
      T.stageView({ n: 3, state: "READY", approved: false }, "p"),
      T.stageView({ n: 4, state: "MISSING" }, "p"),
      T.stageView({ n: 5, state: "MISSING" }, "p")
    ];
    assert.equal(T.blockedReason(all[1], all), "Approve step 3 first.");
    assert.equal(T.blockedReason(all[2], all), "Approve steps 3 and 4 first.");
    all[0].approved = true;
    assert.equal(T.blockedReason(all[1], all), "");
  });

  test("the run body carries both the design's stage and the X1 brief's kind", () => {
    const v = T.stageView({ n: 1 }, "partner");
    assert.deepEqual({ ...T.runBody("partner", v, { service_description: "", market: null }) }, { campaign: "partner", stage: 1, kind: "avatar" });
    const v2 = T.stageView({ n: 2 }, "partner");
    assert.deepEqual({ ...T.runBody("partner", v2, { market: "Business owners", competitors: ["A"] }) }, { campaign: "partner", stage: 2, kind: "ad_research", market: "Business owners", competitors: ["A"] });
  });

  test("Build the avatar is the card's one filled button only while step 1 needs it", () => {
    const answer = (state) => ({ ok: true, data: { campaign: "partner", stages: [{ n: 1, state }] } });
    const st = { campaign: "partner", costs: COSTS, open: {}, drafts: {} };
    assert.match(T.renderFlywheel(answer("MISSING"), st), /class="btn primary"[^>]*data-act="stage-run"/);
    assert.doesNotMatch(T.renderFlywheel(answer("READY"), st), /btn primary/);
  });

  test("unit X3's own answer: server words, can_run reasons, and a step not on the site yet has no Run button", () => {
    const st = { campaign: "partner", costs: COSTS, open: {}, drafts: {} };
    const html = T.renderFlywheel({ ok: true, data: { campaign: "partner", stages: [
      { n: 1, key: "avatar", label_words: "Who we sell to", state: "MISSING", state_word: "Not on this page yet", sentence: "Not on this page yet: it ships in slice 5a. Cost not measured.", can_run: { ok: false, reason: "Not on this page yet: it ships in slice 5a. Cost not measured." }, can_approve: false, run: null, files: [] },
      { n: 4, key: "copy", label_words: "Ad copy for the Partner offer", state: "FAILED", state_word: "Needs a redo", sentence: "Needs a redo: it did not count its reasons to buy.", can_run: { ok: false, reason: "Approve step 3 first (the offer)." }, can_approve: true, run: null, files: [] }
    ] } }, st);
    const row1 = html.slice(html.indexOf('id="cci-stage-1"'), html.indexOf('id="cci-stage-4"'));
    assert.match(row1, /Not on this page yet: it ships in slice 5a\. Cost not measured\./);
    assert.doesNotMatch(row1, /<button/, "no dead button on a step the site cannot run yet");
    assert.doesNotMatch(row1, /cci-cost/);
    const row4 = html.slice(html.indexOf('id="cci-stage-4"'));
    assert.match(row4, /Ad copy for the Partner offer/);
    assert.match(row4, /<button class="btn"[^>]*data-act="stage-run"[^>]* disabled/);
    assert.match(row4, /Approve step 3 first \(the offer\)\./);
  });

  test("a run stopped at its cap offers Resume and Start over; any other failure offers Retry", () => {
    const st = { campaign: "partner", costs: COSTS, open: {}, drafts: {} };
    const cap = T.renderFlywheel({ ok: true, data: { stages: [{ n: 2, state: "MISSING", run: { job_id: "j2", status: "failed", stopped_at_cap: true, resumable: true, error: "Stopped at the $40 run cap." } }] } }, st);
    assert.match(cap, /Resume/);
    assert.match(cap, /Start over/);
    const fail = T.renderFlywheel({ ok: true, data: { stages: [{ n: 1, state: "MISSING", run: { job_id: "j1", status: "failed", resumable: true, error: "The model key is missing." } }] } }, st);
    assert.match(fail, />Retry</);
    assert.doesNotMatch(fail, /Start over/);
  });

  test("not deployed: one honest sentence and no button", () => {
    const html = T.renderFlywheel({ ok: false, notBuilt: true }, { campaign: null, costs: NO_COSTS, open: {}, drafts: {} });
    assert.equal(html, '<p class="cci-honest">Not on this page yet: it ships in slice 5.</p>');
  });
});

describe("deep research rows", () => {
  test("the row sentence for each state", () => {
    const w = (r) => T.researchWords(T.researchView(r));
    assert.equal(w({ id: "a", status: "running", step_word: "sweeping", progress: { round: 2, findings: 37, cost_usd_so_far: 1.12 } }), "Running: sweeping, round 2 · 37 findings · $1.12 so far");
    assert.equal(w({ id: "a", status: "done", report: { key_verified: 11, key_killed: 3 } }), "Done, 11 of 14 key claims held up.");
    assert.equal(w({ id: "a", status: "done", report: { stopped_at_cap: true, cost_usd: 5, rounds: 3 } }), "Done, stopped at the cap: $5.00 after round 3.");
    assert.equal(w({ id: "a", status: "done", report: { fallback_report: true } }), "Done, write-up failed, findings below.");
    assert.equal(w({ id: "a", status: "failed", error: "the model key is missing" }), "Could not finish: the model key is missing.");
  });
});

describe("funnels (X4)", () => {
  const draft = {
    id: "f1", key: "blueprint", name: "Capital Blueprint book a call", kind: "book_a_call", url: "https://apply.fundhub.ai/blueprint", path: "/blueprint",
    tag: "fnl-blueprint", utm_campaign: "uwiq", status: "draft",
    pages: [
      { position: 1, role: "landing", path: "/blueprint", status: "built", events_seen: 0 },
      { position: 2, role: "booking", path: "/blueprint-book", status: "built", events_seen: 0 },
      { position: 3, role: "thank_you", path: "/blueprint-thank-you", status: "built", events_seen: null }
    ]
  };

  test("pages, tag and tracking in words; unknown events stay unknown", () => {
    const v = T.funnelView(draft);
    assert.equal(v.built, true);
    assert.equal(T.tagLine(v), "Tag fnl-blueprint and the full tracking are on every page.");
    assert.equal(T.eventsLine(0), "No visits tracked yet.");
    assert.equal(T.eventsLine(null), "Visits tracked: unknown.");
    assert.equal(v.pages[2].word, "Written, not live");
  });

  test("Push live: blocked with a reason until written; the second tap names the address", () => {
    const empty = T.funnelView({ ...draft, pages: draft.pages.map((p) => ({ ...p, status: "empty" })) });
    assert.equal(T.funnelBlock("push", empty, null), "Write the pages first.");
    const v = T.funnelView(draft);
    assert.equal(T.funnelBlock("push", v, null), "");
    assert.equal(T.funnelBlock("push", v, { running: true, what: "write" }), "The pages are being written.");
    const live = T.funnelView({ ...draft, status: "live" });
    assert.equal(T.funnelBlock("push", live, null), "It is live.");
    assert.equal(T.funnelBlock("rename", live, null), "A live address never changes.");
    const c = T.pushConfirm(v);
    assert.equal(c.button, "Push live to apply.fundhub.ai/blueprint");
    assert.match(c.consequence, /3 new pages on ClickFunnels at apply\.fundhub\.ai\/blueprint/);
    assert.match(c.consequence, /Costs \$0\. No ad is made or changed\./);
  });

  test("a blocked See the pages prints why; the ad tag is in plain words", () => {
    const st = { funnelJobs: {}, open: {}, drafts: {}, costs: COSTS, funnelDetail: {}, previewRole: {} };
    const empty = { ...draft, pages: draft.pages.map((p) => ({ ...p, status: "empty" })) };
    assert.match(T.renderFunnels({ ok: true, data: { funnels: [empty] } }, st), /See the pages: write the pages first\./);
    const writing = T.renderFunnels({ ok: true, data: { funnels: [empty] } }, { ...st, funnelJobs: { f1: { running: true, what: "write" } } });
    assert.match(writing, /See the pages: they are being written now\./);
    const built = T.renderFunnels({ ok: true, data: { funnels: [draft] } }, st);
    assert.doesNotMatch(built, /data-why="see-pages"/);
    assert.match(built, /Its ads are tagged uwiq plus the ad number\./);
    assert.doesNotMatch(built, /utm_campaign=/);
  });

  test("the newest funnel job in words", () => {
    assert.equal(T.funnelJobState([{ id: "a", kind: "funnel", status: "running", created_at: "2026-10-06T10:00:00Z" }]).words, "Writing the 3 pages.");
    assert.equal(T.funnelJobState([{ id: "b", kind: "funnel_push", status: "failed", error: "ClickFunnels said no", created_at: "2026-10-06T11:00:00Z" }, { id: "a", kind: "funnel", status: "done", created_at: "2026-10-06T10:00:00Z" }]).words, "The push stopped: ClickFunnels said no.");
    assert.equal(T.funnelJobState([]), null);
  });

  test("the offers the tab offers are exactly the ones the funnel builder takes", () => {
    assert.deepEqual(Array.from(T.FUNNEL_OFFERS, (o) => o[0]).sort(), Object.keys(FUNNEL_OFFERS).sort());
  });
});

describe("ideas", () => {
  test("Write now hides (with a sentence) until the script writer is live", () => {
    const ideas = [T.ideaView({ id: "i1", raw_points: "An idea", status: "new" })];
    const off = T.renderIdeaList({ ok: true }, ideas, { writeNowReady: false }, COSTS);
    assert.doesNotMatch(off, /Write now from this idea/);
    assert.match(off, /Write now turns on when the script writer is live/);
    const on = T.renderIdeaList({ ok: true }, ideas, { writeNowReady: true }, COSTS);
    assert.match(on, /Write now from this idea/);
    assert.match(on, /One script\. About \$0\.42/);
  });

  test("before the planner runs, the card says when it will", () => {
    /* Monday 7:00 am Arizona drop (14:00 UTC) -> planner Monday 4:00 am. */
    assert.equal(T.plannerWhen("2026-10-12T14:00:00.000Z"), "Monday 4:00 am");
    assert.match(T.renderSuggestions({ ok: true, data: { next: { release_at: "2026-10-12T14:00:00.000Z", suggestions: [] } } }, {}), /The planner has not run yet\. It runs 3 hours before the next drop \(Monday 4:00 am\)\./);
  });

  test("status words", () => {
    assert.equal(T.ideaView({ status: "writing" }).word, "Being written");
    assert.equal(T.ideaView({ status: "written" }).word, "Written");
    assert.equal(T.ideaView({ status: "dropped" }).word, "Dropped");
  });
});

describe("Start a flywheel offers every key in src/config/offers.mjs", () => {
  test("same keys, same names", () => {
    assert.deepEqual(Array.from(T.FLYWHEEL_OFFERS, (o) => o[0]).sort(), [...OFFER_KEYS].sort());
    for (const [key, name] of T.FLYWHEEL_OFFERS) assert.equal(name, OFFERS[key].name, key);
  });
});

describe("safe markdown", () => {
  test("escapes HTML and passes only http(s) links", () => {
    const html = T.md("# Title\n\n<script>alert(1)</script>\n- a [link](https://example.com/x)\n- [bad](javascript:alert(1))");
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener noreferrer">link<\/a>/);
    assert.doesNotMatch(html, /href="javascript/);
  });
});

describe("house rules", () => {
  test("nothing says the job runs in chat (design §3.9)", () => {
    assert.doesNotMatch(SRC, /runs in chat|still in chat|chat command/i);
    assert.doesNotMatch(T.shellHtml(), /chat/i);
  });

  test("the company is Fundhub, never FundHub", () => {
    assert.doesNotMatch(SRC, /FundHub|FUNDHUB|Fund Hub/);
    assert.doesNotMatch(CSS, /FundHub/);
  });

  test("no font sizes and no hand-rolled resting shadow (UI-STANDARDS §12.2, §12.7)", () => {
    assert.doesNotMatch(CSS, /font-size|font:\s*\d/);
    assert.doesNotMatch(CSS, /box-shadow/);
    assert.doesNotMatch(SRC, /font-size/);
  });

  test("the preview iframe never runs the page's scripts", () => {
    const html = T.renderFunnelDetail({ ok: true, data: { pages: [{ role: "landing", status: "built", html: "<h1>Hi</h1><script>fbq('track')</script>" }] } }, "landing");
    assert.match(html, /<iframe class="cci-frame"[^>]* sandbox=""/);
    assert.doesNotMatch(html, /allow-scripts/);
  });

  test("the proof card is one honest sentence until slice 11", () => {
    assert.match(T.shellHtml(), /Not on this page yet: it ships in slice 11\./);
  });

  test("registers with the frame's queue whether or not the frame loaded first", () => {
    const queued = [];
    const ctx = createContext({ console, document: { getElementById() { return null; } } });
    ctx.window = ctx;
    runInContext(SRC, ctx);
    queued.push(...ctx.FundhubCC._q);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].id, "ideas");
    assert.equal(queued[0].label, "Ideas");
    assert.equal(typeof queued[0].render, "function");
    assert.equal(typeof queued[0].hide, "function");
  });
});
