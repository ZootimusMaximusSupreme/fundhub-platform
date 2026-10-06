// "Research the market" (J2, flywheel step 2) end to end on a fake database and a fake
// model: 5 saved steps, the source checks in code, the reader fallback rule, the cap stop
// with Resume, the stamped stage file through the outbox. Unit X2.
// The same run against real Postgres: src/http/marketing-research.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fakeResearchDb, driveJob } from "../research/fixtures/fake-db.mjs";
import { fakeMarketModel } from "../research/fixtures/fake-market-model.mjs";
import * as stageJob from "./stage-job.mjs";
import { searchCeiling, keepMarketFindings, confidenceOf, campaignWords, renderStageFile, LIMITS } from "./ad-research.mjs";
import { collectSources, READER_PREFIX } from "../research/provenance.mjs";
import { splitFrontMatter, parseFrontMatter } from "../../../scripts/flywheel/status.mjs";

const ORG = "00000000-0000-0000-0000-0000000000aa";
const AVATAR = "---\nstage: 1\nversion: 2\nstatus: approved\n---\n\n# Who we sell to\n\nBrokers who want their own shop.\n";
const NOTES = "# Owner notes\n\n## Notes\n\n- 2026-10-01 · all · never say credit repair\n";

const fakeRead = async () => ({
  source: "github", sha: "4f2a9c1e7b3d5a8c0e6f1b2d3c4a5e6f7a8b9c0d", pending: [],
  files: { notes: NOTES, avatar: AVATAR, research: "---\nstage: 2\nversion: 3\n---\nold" },
  avatar: { body: "# Who we sell to\n\nBrokers who want their own shop.", hash: "a1b2c3d4" },
  ownerNotes: "- 2026-10-01 · all · never say credit repair",
  priorVersion: 3
});

function ctxFor(db, model, extra = {}) {
  return { db, env: { ANTHROPIC_API_KEY: "test-key-not-real" }, deps: { callModel: model.callModel, readStageFiles: fakeRead, ...extra } };
}
const payload = (over = {}) => ({ campaign: "partner", stage: 2, market: null, competitors: ["Fund&Grow"], today: "2026-10-06", ...over });

describe("the numbers on the cost sheet are computed from the limits (design §3.2 row 2)", () => {
  test("at most 106 searches, 138 with a slow surface retried", () => {
    assert.equal(searchCeiling(), 106);
    assert.equal(searchCeiling({ withRetries: true }), 138);
    assert.equal(LIMITS.rounds, 3);
    assert.equal(LIMITS.surfaces, 4);
  });
  test("campaign folders map to words", () => {
    assert.equal(campaignWords("partner"), "Partner offer");
    assert.equal(campaignWords("capital-blueprint"), "Capital blueprint");
  });
  test("the confidence formula is the chat workflow's", () => {
    const f = (n, c) => Array.from({ length: n }, (_, i) => ({ evidenceTier: i < c ? "C" : "D" }));
    assert.equal(confidenceOf({ findings: f(10, 3), solid: 6, teardowns: 2 }), "measured");
    assert.equal(confidenceOf({ findings: f(8, 3), solid: 5, teardowns: 2 }), "indirect");
    assert.equal(confidenceOf({ findings: f(3, 0), solid: 0, teardowns: 0 }), "inferred");
    assert.equal(confidenceOf({ findings: f(2, 2), solid: 0, teardowns: 0 }), "unknown");
  });
});

describe("source checks for one sweep call (design §5 rule 14)", () => {
  test("unsourced findings are thrown out; headlines checked word for word; prices only when a page states them; reader only after an HTTP error", () => {
    const blocks = [
      { type: "server_tool_use", id: "f1", name: "web_fetch", input: { url: "https://a.example/p" } },
      { type: "web_fetch_tool_result", tool_use_id: "f1", content: { type: "web_fetch_result", url: "https://a.example/p", content: { type: "document", source: { type: "text", data: "Own Your Funding Shop. Only $997 today." } } } },
      { type: "server_tool_use", id: "f2", name: "web_fetch", input: { url: "https://slow.example/x" } },
      { type: "web_fetch_tool_result", tool_use_id: "f2", content: { type: "web_fetch_tool_result_error", error_code: "url_not_accessible" } },
      { type: "server_tool_use", id: "f3", name: "web_fetch", input: { url: "https://robots.example/x" } },
      { type: "web_fetch_tool_result", tool_use_id: "f3", content: { type: "web_fetch_tool_result_error", error_code: "url_not_allowed" } }
    ];
    const out = keepMarketFindings({ findings: [
      { advertiser: "A", headline: "Own Your Funding Shop", price: "$997", sourceUrl: "https://a.example/p", evidenceTier: "C" },
      { advertiser: "A", headline: "Words not on the page", price: "$5,000", sourceUrl: "https://a.example/p/", evidenceTier: "X" },
      { advertiser: "B", headline: "Ghost", sourceUrl: "https://b.example/", evidenceTier: "C" }
    ] }, collectSources(blocks), 1);
    assert.equal(out.kept.length, 2);
    assert.equal(out.dropped, 1);
    assert.equal(out.kept[0].headline_verbatim, true);
    assert.equal(out.kept[0].price, "$997");
    assert.equal(out.kept[1].headline_verbatim, false);
    assert.equal(out.kept[1].price, "", "a price no page stated is left out");
    assert.equal(out.kept[1].evidenceTier, "D");
    assert.equal(out.paraphrased, 1);
    assert.equal(out.pricesDropped, 1);
    assert.deepEqual(out.readerUrls, ["https://slow.example/x"], "never after a robots.txt or domain refusal");
  });
});

describe("a market research run in 5 saved steps", () => {
  test("reach → plan → 3 sweep rounds → teardowns → two-way checks → board → stamped 02-ad-research.md", async () => {
    const db = fakeResearchDb();
    const model = fakeMarketModel();
    const job = db.addJob({ org_id: ORG, kind: "flywheel_stage", payload: payload() });
    const { job: done } = await driveJob(db, job.id, stageJob, ctxFor(db, model), { maxClaims: 40 });
    assert.equal(done.status, "done", done.error);
    const r = done.result;
    const s = r.state;

    // Reach is decided in code from the fetch results.
    assert.deepEqual(s.probes.filter((p) => p.reachable).map((p) => p.target), ["google.com", "youtube.com"]);
    assert.deepEqual(s.blocked, ["trustpilot.com", "reddit.com"]);

    // Sweeps: 3 rounds × 4 surfaces, Sonnet, at most 7 searches each.
    const sweeps = model.calls.filter((c) => c.label === "sweep");
    assert.equal(sweeps.length, 12);
    assert.ok(sweeps.every((c) => c.model === "claude-sonnet-5-5" && c.tools.includes("web_search:7")));
    assert.equal(s.round, 3);
    // The reader fallback reaches round 2 for the HTTP error only, never for the robots refusal.
    const r2 = sweeps.find((c) => /^Round 2/.test(c.text)).text;
    assert.ok(r2.includes(`${READER_PREFIX}https://slow-1direct.example/pricing`));
    assert.ok(!r2.includes("robots-1direct.example"));

    // Source checks.
    assert.ok(s.findings.every((f) => !/^Ghost/.test(f.advertiser)), "a finding whose page was never read is thrown out");
    assert.equal(s.dropped, 12);
    assert.equal(s.prices_dropped, 12 + 4, "12 sweep prices no page stated, 4 teardown prices no page stated");
    assert.ok(s.findings.filter((f) => f.price).every((f) => f.price === "$997"));
    assert.equal(s.burned_out.length, 12, "burned-out angles without a read source are left out");

    // Teardowns read pages only; checks two ways; confidence in code.
    assert.equal(s.teardowns.length, 4);
    assert.deepEqual(s.teardowns[0].prices, ["$997"]);
    assert.equal(model.calls.filter((c) => c.label === "provenance").length, 12);
    assert.equal(model.calls.filter((c) => c.label === "staleness").length, 12);
    assert.equal(s.confidence, "measured");
    assert.equal(model.calls.find((c) => c.label === "board").model, "claude-opus-5-5");

    // The stage file: stamped, counted, every link a kept source, review card at the end.
    assert.equal(db.outbox.length, 1);
    const row = db.outbox[0];
    assert.equal(row.path, "marketing/flywheel/partner/02-ad-research.md");
    assert.equal(row.mode, "replace");
    const fm = parseFrontMatter(splitFrontMatter(row.content).frontMatter);
    assert.equal(fm.stage, 2);
    assert.equal(fm.version, 4, "one more than the file it replaces");
    assert.equal(fm.status, "draft");
    assert.equal(fm.inputs["01-avatar.md"], "a1b2c3d4", "the avatar hash from the same pinned read");
    assert.equal(fm.counts.rowsVerified, 12);
    assert.equal(fm.counts.competitorsFound, 12);
    assert.ok(!row.content.includes("invented.example"));
    assert.match(row.content, /## Review card/);
    assert.match(row.content, /## Sources\n\n- https:\/\/competitor-/);
    assert.equal(db.buzzes.length, 1);
    assert.equal(db.buzzes[0].body, "The market research for Partner offer is ready to read.");
    assert.equal(r.board.version, 4);
    assert.match(r.board.sentence, /^Done\. \d+ findings, 12 checked, 12 competitors\. Not reviewed\.$/);

    // Every call on the ledger, searches counted.
    assert.equal(db.usage.length, model.calls.length);
    assert.ok(r.progress.searches_used > 0 && r.progress.searches_used <= searchCeiling({ withRetries: true }));
  });

  test("nothing reachable: stops at step 1 with the plain sentence, nothing else paid for", async () => {
    const db = fakeResearchDb();
    const model = fakeMarketModel({ noReach: true });
    const job = db.addJob({ org_id: ORG, kind: "flywheel_stage", payload: payload() });
    const { job: done } = await driveJob(db, job.id, stageJob, ctxFor(db, model));
    assert.equal(done.status, "failed");
    assert.match(done.error, /Anthropic's reader could not open any page\. Nothing was researched\./);
    assert.deepEqual(model.calls.map((c) => c.label), ["reach"]);
  });

  test("the run cap stops it with what it found saved, and Resume continues from the saved steps", async () => {
    // A 95-cent cap for market research (run_caps.ad_research, the Settings dial): room for
    // step 1 with the board's reserve held back, not for one sweep call on top.
    const db = fakeResearchDb({ settings: { run_caps: { ad_research: 0.95 } } });
    const model = fakeMarketModel();
    const job = db.addJob({ org_id: ORG, kind: "flywheel_stage", payload: payload() });
    const first = await driveJob(db, job.id, stageJob, ctxFor(db, model));
    assert.equal(first.job.status, "failed");
    assert.equal(first.job.error, "Stopped at the $0.95 run cap after step 1. What it found so far is saved.");
    const cp = first.job.result;
    assert.ok(cp.stopped && cp.stopped.reason === "run_cap");
    assert.equal(cp.step, "sweep");
    assert.ok(cp.steps.plan.done_at, "step 1 stays done");
    assert.equal(model.calls.filter((c) => c.label === "sweep").length, 0, "no call started past the cap");
    const callsBefore = model.calls.length;

    // Chris raises the cap and taps Resume (POST marketing/jobs/retry keeps the saved steps):
    // the row is queued again with its checkpoint.
    db.settings.run_caps = { ad_research: 40 };
    Object.assign(db.jobs.get(job.id), { status: "queued", attempts: 0, error: null });
    const second = await driveJob(db, job.id, stageJob, ctxFor(db, model), { maxClaims: 40 });
    assert.equal(second.job.status, "done", second.job.error);
    assert.equal(model.calls.slice(callsBefore).filter((c) => c.label === "reach" || c.label === "plan").length, 0, "finished steps are never paid for twice");
    assert.equal(db.outbox.length, 1);
  });

  test("the stage file renders without an avatar on file (no inputs line) and prints the checks", () => {
    const text = renderStageFile({
      campaign: "partner", today: "2026-10-06", prior_version: null, avatar_hash: null,
      counts: { rowsFound: 3, rowsVerified: 0, rowsWithFirstSeen: 1, competitorsFound: 2 },
      findings: [{ sourceUrl: "https://a.example/p" }], teardowns: [], document: "# Board",
      inputs_source: "bundle-fallback", dropped: 1, paraphrased: 0, prices_dropped: 2, links_removed: 1, shrunk: ["Round 3 read 2 of 4 surfaces to stay under $40."]
    });
    const fm = parseFrontMatter(splitFrontMatter(text).frontMatter);
    assert.equal(fm.version, 1);
    assert.deepEqual(fm.inputs, {});
    assert.match(text, /Round 3 read 2 of 4 surfaces to stay under \$40\./);
    assert.match(text, /the copy bundled with the site/);
  });
});
