// "Research it" (J20) end to end on a fake database and a fake model: saved steps, the
// source checks in code, the caps, the report, the repo save. Unit X2.
// The same run against real Postgres: src/http/marketing-research.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fakeResearchDb, driveJob } from "./fixtures/fake-db.mjs";
import { fakeResearchModel, QUOTE } from "./fixtures/fake-model.mjs";
import * as deep from "./deep-research.mjs";
import { DEPTHS, searchCeiling, slugOf, keepWebFindings, keepVaultFindings, HONESTY, reportReserveUsd } from "./deep-research.mjs";
import { collectSources } from "./provenance.mjs";

const ORG = "00000000-0000-0000-0000-0000000000aa";
const VAULT_DOC = {
  path: "marketing/knowledge/hormozi/alex-hormozi-library/100m-offers.md",
  title: "$100M Offers",
  text: "# $100M Offers\n\nThe offer is the thing that matters most for a funding broker. Make the offer so good people feel stupid saying no.\n\nPrice is a function of value and the value equation decides it."
};

function ctxFor(db, model, extra = {}) {
  return {
    db,
    env: { ANTHROPIC_API_KEY: "test-key-not-real" },
    deps: {
      callModel: model.callModel,
      loadVault: () => [VAULT_DOC],
      readVaultFile: (p) => (p === VAULT_DOC.path ? VAULT_DOC.text : null),
      ...extra
    }
  };
}

const payload = (over = {}) => ({
  question: "Who sells business funding broker programs and for how much?",
  depth: "quick",
  sources: { web: true, vault: true, own_files: false },
  belief: null,
  max_cost_usd: 5,
  today: "2026-10-06",
  ...over
});

describe("the depth limits are computed, never typed (design §3.2)", () => {
  test("Quick look 62 searches ($0.62), Leave nothing unturned 542 ($5.42)", () => {
    assert.equal(searchCeiling("quick"), 62);
    assert.equal(searchCeiling("deep"), 542);
    assert.equal(DEPTHS.quick.rounds, 1);
    assert.equal(DEPTHS.deep.rounds, 6);
  });
  test("the HONESTY block is the chat workflow's, word for word", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../../../.claude/workflows/deep-research.js", import.meta.url), "utf8");
    assert.ok(src.includes(HONESTY), "HONESTY must match .claude/workflows/deep-research.js exactly");
  });
  test("slugs are short and plain", () => {
    assert.equal(slugOf("Who sells business funding broker programs, and for how much?"), "who-sells-business-funding-broker");
    assert.equal(slugOf("???"), "research");
  });
});

describe("source checks in code (design §5 rule 14)", () => {
  test("a web finding is kept only when its link is in the call's own results; an unmatched quote is left out and counted", () => {
    const sources = collectSources([
      { type: "web_search_tool_result", tool_use_id: "a", content: [{ type: "web_search_result", url: "https://good.example/a", title: "A" }] },
      { type: "text", text: "x", citations: [{ type: "web_search_result_location", url: "https://good.example/a", cited_text: `it says ${QUOTE} here` }] }
    ]);
    const out = keepWebFindings({ findings: [
      { claim: "kept, verbatim", source: "https://good.example/a/", quote: QUOTE, importance: "key" },
      { claim: "kept, quote dropped", source: "https://www.good.example/a?utm_source=x", quote: "never said this at all ever", importance: "key" },
      { claim: "dropped: link the model typed", source: "https://made-up.example/", importance: "key" },
      { claim: "", source: "https://good.example/a" }
    ] }, sources, "sweep", 1);
    assert.equal(out.kept.length, 2);
    assert.equal(out.kept[0].quote_status, "verbatim");
    assert.equal(out.kept[1].quote, undefined);
    assert.equal(out.dropped, 2);
    assert.equal(out.quotesUnchecked, 1);
  });
  test("a vault finding needs a given file and a quote that is in that file", () => {
    const out = keepVaultFindings({ findings: [
      { claim: "ok", source: VAULT_DOC.path, quote: "Make the offer so good people feel stupid saying no" },
      { claim: "not in file", source: VAULT_DOC.path, quote: "a sentence Hormozi never wrote in this file" },
      { claim: "other file", source: "marketing/knowledge/hormozi/other.md", quote: "Make the offer so good" },
      { claim: "no quote", source: VAULT_DOC.path }
    ] }, [{ path: VAULT_DOC.path }], (p) => (p === VAULT_DOC.path ? VAULT_DOC.text : null));
    assert.equal(out.kept.length, 1);
    assert.equal(out.dropped, 3);
  });
});

describe("a Quick look runs in saved steps to a cited report", () => {
  test("plan → vault → sweep → verify → write-up → save; every call on the ledger; sources checked; links checked", async () => {
    const db = fakeResearchDb();
    const model = fakeResearchModel();
    const job = db.addJob({ org_id: ORG, kind: "deep_research", payload: payload() });
    const { job: done, claims } = await driveJob(db, job.id, deep, ctxFor(db, model));
    assert.equal(done.status, "done", done.error);
    assert.ok(claims >= 6, `one step per claim (took ${claims})`);
    const r = done.result;
    assert.equal(r.step, "done");
    assert.deepEqual(Object.keys(r.steps).sort(), ["plan", "save", "sweep", "synthesize", "vault", "verify"].sort());

    // Quick look: 4 sub-questions, one round, no chase, no critic.
    assert.equal(model.calls.filter((c) => c.label === "sweep").length, 4);
    assert.equal(model.calls.filter((c) => c.label === "chase" || c.label === "critic").length, 0);
    assert.ok(model.calls.filter((c) => c.label === "sweep").every((c) => c.model === "claude-sonnet-5-5" && c.tools.includes("web_search:13")));
    assert.equal(model.calls.find((c) => c.label === "plan").model, "claude-opus-5-5");
    assert.equal(model.calls.find((c) => c.label === "report").model, "claude-opus-5-5");

    // Source checks: per sweep call 1 kept with quote, 1 invented dropped, 1 kept without its quote.
    const st = r.state;
    assert.equal(st.findings.filter((f) => f.origin === "sweep").length, 8);
    assert.ok(st.findings.every((f) => !/invented/i.test(f.claim)));
    assert.equal(st.dropped, 4 + 2, "4 invented web links + 2 bad vault findings");
    assert.equal(st.findings.filter((f) => f.origin === "vault").length, 1);
    assert.ok(st.unreachable.some((u) => /blocked\.example\/pricing \(url not accessible\)/.test(u)));

    // Report: the made-up link is stripped, the footer prints the counts and the lists.
    const md = r.report.markdown;
    assert.ok(!md.includes("made-up.example"), "a link that was not read never reaches the report");
    assert.match(md, /link removed: not one of the sources this run read/);
    assert.match(md, /## How this was checked/);
    assert.match(md, /### Treat with caution/);
    assert.match(md, /### What we could not reach/);
    assert.equal(r.report.fallback_report, false);
    assert.ok(r.report.key_verified >= 1);
    assert.ok(r.report.cost_usd > 0);
    assert.match(r.report.repo_path, /^marketing\/research\/2026-10-06-who-sells-business-funding-broker-[0-9a-f]{8}\/report\.md$/);

    // Saved through the outbox (two files), one buzz.
    assert.deepEqual(db.outbox.map((o) => o.path.split("/").pop()).sort(), ["report.md", "sources.json"]);
    assert.match(db.outbox.find((o) => o.path.endsWith("report.md")).content, /^---\nkind: deep-research\n/);
    assert.equal(JSON.parse(db.outbox.find((o) => o.path.endsWith("sources.json")).content).findings.length, st.findings.length);
    assert.equal(db.buzzes.length, 1);
    assert.match(db.buzzes[0].body, /^The research is ready to read: /);

    // The ledger: one row per call, with searches priced inside cost_usd.
    assert.equal(db.usage.length, model.calls.length);
    const sweepRow = db.usage.find((u) => /^sweep-r1-q1$/.test(u.step));
    assert.equal(sweepRow.web_search_requests, 3);
    assert.equal(Number(sweepRow.cost_usd), 0.002 + 0.005 + 0.03, "1000 in at $2, 500 out at $10, 3 searches at a cent");
  });

  test("a step that fails once is tried again and finished steps are never paid for twice", async () => {
    const db = fakeResearchDb();
    const model = fakeResearchModel({ failFirst: ["sweep", "report"] });
    const job = db.addJob({ org_id: ORG, kind: "deep_research", payload: payload() });
    const { job: done } = await driveJob(db, job.id, deep, ctxFor(db, model));
    assert.equal(done.status, "done", done.error);
    assert.equal(model.calls.filter((c) => c.label === "plan").length, 1, "plan ran once");
    // One sweep call failed: it is counted, the round goes on with the other three, and a
    // failed call never makes a round "dry".
    assert.equal(model.calls.filter((c) => c.label === "sweep").length, 4);
    assert.equal(done.result.state.failed_calls, 1);
    // The write-up failed once: the step was tried again (one more call), nothing before it re-ran.
    assert.equal(model.calls.filter((c) => c.label === "report").length, 2);
    assert.equal(done.result.steps.synthesize.attempts, 1);
    assert.equal(done.attempts, 0, "a step retry never counts against the job's own tries");
  });

  test("the write-up failing twice ends with a report built by code", async () => {
    const db = fakeResearchDb();
    const model = fakeResearchModel();
    const flaky = async (args) => {
      if (/^Write the research report/.test(String(args.messages?.[0]?.content || ""))) {
        return { mode: "live", status: 529, error: "anthropic 529: overloaded", content: [], usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, serverToolUse: { web_search_requests: 0, web_fetch_requests: 0 } };
      }
      return model.callModel(args);
    };
    const job = db.addJob({ org_id: ORG, kind: "deep_research", payload: payload() });
    const { job: done } = await driveJob(db, job.id, deep, ctxFor(db, model, { callModel: flaky }));
    assert.equal(done.status, "done", done.error);
    assert.equal(done.result.report.fallback_report, true);
    assert.match(done.result.report.markdown, /built by code from what was found/);
    assert.match(done.result.report.markdown, /https:\/\/good\.example\//);
  });
});

describe("caps (design §5 rule 13)", () => {
  test("a run whose stop amount cannot cover the sweep still ends with a report that says it stopped", async () => {
    const db = fakeResearchDb();
    const model = fakeResearchModel();
    // Room for the plan and the vault, not for a sweep call on top of the write-up's reserve.
    const cap = reportReserveUsd() + 0.45;
    const job = db.addJob({ org_id: ORG, kind: "deep_research", payload: payload({ max_cost_usd: cap }) });
    const { job: done } = await driveJob(db, job.id, deep, ctxFor(db, model));
    assert.equal(done.status, "done", done.error);
    assert.equal(model.calls.filter((c) => c.label === "sweep").length, 0, "no sweep call started past the cap");
    assert.ok(done.result.report.stopped_at_cap, "the report says it stopped at the cap");
    assert.match(done.result.report.markdown, /Stopped at the \$/);
  });

  test("the month cap counts: a month already spent stops every paid step", async () => {
    const db = fakeResearchDb({ settings: { max_month_cost_usd: 1 } });
    db.usage.push({ org_id: ORG, job_id: "other", cost_usd: "1.000000", web_search_requests: 0, web_fetch_requests: 0 });
    const model = fakeResearchModel();
    const job = db.addJob({ org_id: ORG, kind: "deep_research", payload: payload() });
    const { job: done } = await driveJob(db, job.id, deep, ctxFor(db, model));
    assert.equal(done.status, "done");
    assert.equal(model.calls.length, 0, "nothing was paid for");
    assert.equal(done.result.report.fallback_report, true);
    assert.equal(done.result.report.stopped_at_cap.reason, "month_cap");
  });
});

describe("Leave nothing unturned", () => {
  test("sweeps until two rounds come back dry, then chase, critic, two-way checks", async () => {
    const db = fakeResearchDb();
    const model = fakeResearchModel();
    const job = db.addJob({ org_id: ORG, kind: "deep_research", payload: payload({ depth: "deep", max_cost_usd: 40 }) });
    const { job: done } = await driveJob(db, job.id, deep, ctxFor(db, model), { maxClaims: 80 });
    assert.equal(done.status, "done", done.error);
    const s = done.result.state;
    assert.equal(s.subs.length, 5);
    assert.equal(s.round, 3, "round 1 new, rounds 2 and 3 marked nothing new: two dry rounds");
    assert.ok(model.calls.some((c) => c.label === "chase"));
    assert.equal(model.calls.filter((c) => c.label === "critic").length, 1);
    const verifyCalls = model.calls.filter((c) => c.label === "verify");
    assert.ok(verifyCalls.length >= 2 && verifyCalls.length % 2 === 0, "every key claim checked two ways");
  });
});
