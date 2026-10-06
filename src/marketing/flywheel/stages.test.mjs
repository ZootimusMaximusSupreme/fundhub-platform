// The six flywheel rows in Chris's words (design §3.0 word table, §3.2 row 6).
// Unit X3. The states come from scripts/flywheel/status.mjs; these tests pin the
// words, the Run gates and the running/failed/cap sentences.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stagesView, reasonWords, reviewCard, adviceWords, NOT_BUILT, STAGE_RUNNERS } from "./stages.mjs";
import { stampStage, hashOf } from "./stamp.mjs";
import { evaluate } from "../../../scripts/flywheel/status.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PARTNER = path.join(ROOT, "marketing", "flywheel", "partner");
const NAMES = ["00-OWNER-NOTES.md", "01-avatar.md", "01-avatar/Market_Language_Bank.md", "02-ad-research.md",
  "03-offer.md", "04-copy.md", "05-ad-strategy.md", "06-spend.md"];

function partnerFiles() {
  const out = {};
  for (const n of NAMES) {
    let text = null;
    try { text = fs.readFileSync(path.join(PARTNER, n), "utf8"); } catch { text = null; }
    out[n] = { text, source: text == null ? "missing" : "bundle-fallback" };
  }
  return out;
}

const CARD = "\n## Review card\n\n**What this decided:** x\n";

/** A campaign whose steps 1 to 3 are done and step 3 is approved. */
function readyFiles() {
  const avatar = stampStage({ stage: 1, version: 2, status: "approved", counts: { quotes: 30, languageEntries: 120 }, body: `# Avatar\n${CARD}` });
  const bank = "# Bank\n- phrase one\n";
  const research = stampStage({ stage: 2, version: 1, status: "approved", inputs: { "01-avatar.md": hashOf(avatar) },
    counts: { rowsVerified: 9, competitorsFound: 4, rowsWithFirstSeen: 6 }, body: `# Research\n${CARD}` });
  const offer = stampStage({ stage: 3, version: 1, status: "approved",
    inputs: { "01-avatar.md": hashOf(avatar), "02-ad-research.md": hashOf(research) },
    counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 2 }, body: `# Offer\n${CARD}` });
  const f = (text) => ({ text, source: "github" });
  return {
    "00-OWNER-NOTES.md": f("# notes\nOffer key: UWIQ_DELIVERABLES\n\n## Notes\n"),
    "01-avatar.md": f(avatar), "01-avatar/Market_Language_Bank.md": f(bank), "02-ad-research.md": f(research),
    "03-offer.md": f(offer), "04-copy.md": { text: null, source: "missing" }, "05-ad-strategy.md": { text: null, source: "missing" },
    "06-spend.md": { text: null, source: "missing" }
  };
}

describe("the partner flywheel as it is in the repo", () => {
  const rows = stagesView({ campaign: "partner", files: partnerFiles() });
  const states = evaluate(PARTNER);

  test("six rows, the same states as npm run flywheel:status, labels in Chris's words", () => {
    assert.equal(rows.length, 6);
    assert.deepEqual(rows.map((r) => r.state), states.map((s) => s.state));
    assert.deepEqual(rows.map((r) => r.label_words), [
      "Who we sell to", "What the market sells", "The offer", "Ad copy for the Partner offer", "Which ad strategy", "Read the spend"
    ]);
    assert.equal(rows[2].step_words, "The offer, step 3 of 6");
    assert.ok(!rows.some((r) => /flywheel step/i.test(r.step_words)), "never 'Flywheel step 3'");
  });

  test("done rows say Done with their count; failed rows say what to redo in plain words", () => {
    assert.equal(rows[0].state_word, "Done, approved");
    assert.match(rows[0].sentence, /^Done\. \d+ customer quotes\..* Approved\.$/);
    assert.equal(rows[2].state_word, "Needs a redo");
    assert.equal(rows[2].sentence, "Needs a redo: it did not count its guarantees.");
    assert.equal(rows[3].sentence, "Needs a redo: it did not count its reasons to buy.");
    assert.equal(rows[4].state_word, "Waiting on steps 3 and 4");
  });

  // Unit GL: rows 1 and 2 run from the card (X1's avatar runner, X2's market research).
  test("1 and 2 can run; Run is off with the reason printed where it cannot: 4 needs 3 approved, 5 needs 3 and 4", () => {
    assert.deepEqual(rows[0].can_run, { ok: true, reason: null });
    assert.deepEqual(rows[1].can_run, { ok: true, reason: null });
    assert.ok(!rows.some((r) => /not on this page yet/i.test(`${r.state_word} ${r.sentence} ${r.can_run.reason || ""}`)), "no row says it is not on this page");
    assert.deepEqual(rows[2].can_run, { ok: true, reason: null }, "the offer can run: the avatar is on file");
    assert.equal(rows[3].can_run.ok, false);
    assert.match(rows[3].can_run.reason, /^Approve step 3 first \(the offer\)\.$/);
    assert.match(rows[4].can_run.reason, /^Approve steps 3 and 4 first/);
    assert.deepEqual(rows[5].can_run, { ok: true, reason: null }, "the spend read is free and always runs");
    assert.equal(rows[5].state_word, "Not run yet");
    assert.equal(rows[5].sentence, "Not started. Waiting on steps 4 and 5.");
  });

  test("Read it: the review card and the body, without the stamp; links to the file", () => {
    assert.match(rows[3].review_card_md, /^## Review card/);
    assert.ok(!rows[3].document_md.startsWith("---"), "the stamp is not shown as the document");
    assert.equal(rows[3].files[0].path, "marketing/flywheel/partner/04-copy.md");
    assert.match(rows[3].files[0].github_url, /^https:\/\/github\.com\/ZootimusMaximusSupreme\/fundhub-platform\/blob\/main\/marketing\/flywheel\/partner\/04-copy\.md$/);
    assert.equal(rows[5].review_card_md, null);
    assert.deepEqual(rows[5].files, []);
    assert.equal(rows[5].can_approve, false);
    assert.equal(rows[3].can_approve, true);
  });

  test("the advice line says what to redo, in order", () => {
    assert.equal(adviceWords(rows), "2 steps need a redo. Do them in order: 3, then 4.");
  });
});

describe("rows 1 and 2 point at their runners (unit GL)", () => {
  test("STAGE_RUNNERS: 1 is X1's avatar, 2 is X2's market research; nothing is left not built", () => {
    assert.deepEqual(STAGE_RUNNERS[1], { via: "avatar" });
    assert.deepEqual(STAGE_RUNNERS[2], { via: "market" });
    assert.deepEqual(Object.keys(NOT_BUILT), []);
  });

  test("a new campaign: step 1 and step 2 say Not run yet and can run; step 3 waits for who we sell to", () => {
    const missing = Object.fromEntries(NAMES.map((n) => [n, { text: null, source: "missing" }]));
    missing["00-OWNER-NOTES.md"] = { text: "# n\nOffer key: UWIQ_DELIVERABLES\n\n## Notes\n", source: "outbox-pending" };
    const rows = stagesView({ campaign: "capital-blueprint", files: missing });
    assert.equal(rows[0].state_word, "Not run yet");
    assert.equal(rows[0].sentence, "Not started.");
    assert.deepEqual(rows[0].can_run, { ok: true, reason: null });
    assert.equal(rows[1].state_word, "Not run yet");
    assert.deepEqual(rows[1].can_run, { ok: true, reason: null });
    assert.equal(rows[2].can_run.ok, false);
    assert.match(rows[2].can_run.reason, /Step 1 \(who we sell to\) has to be done first/);
  });

  test("step 2's run on X2's saved-step runner reads with its step, its words and its cap stop", () => {
    const running = { id: "m1", kind: "flywheel_stage", status: "running", payload: { campaign: "capital-blueprint", stage: 2 },
      result: { v: 1, kind: "flywheel_stage", step: "sweep", step_n: 2, steps_total: 5, step_word: "sweeping round 2 of up to 6",
        state: {}, progress: { findings: 14, cost_usd_so_far: 1.2 } } };
    let rows = stagesView({ campaign: "capital-blueprint", files: readyFiles(), jobs: { 2: { job: running, spentUsd: 1.2 } } });
    assert.equal(rows[1].state_word, "Running");
    assert.equal(rows[1].sentence, "Running: step 2 of 5, sweeping round 2 of up to 6. $1.20 spent so far.");
    assert.deepEqual(rows[1].run.counts_so_far, { findings: 14 });
    assert.equal(rows[1].can_run.ok, false);
    const stopped = { ...running, status: "failed", error: "Stopped at the $40 run cap.", result: { ...running.result, stopped: { reason: "run_cap" } } };
    rows = stagesView({ campaign: "capital-blueprint", files: readyFiles(), jobs: { 2: { job: stopped, spentUsd: 40 } } });
    assert.equal(rows[1].state_word, "Stopped at the cap");
    assert.equal(rows[1].run.stopped_at_cap, true);
  });
});

describe("a finished offer run waiting for Approve (unit GL)", () => {
  const doc = "# Offer — capital-blueprint\nAs of 2026-10-06.\n\n## 1. The offer in one sentence\n\nA plan.\n\n## Review card\n\n**What this decided:** Sell it.\n";
  const job = { id: "o9", kind: "offer", status: "done", finished_at: "2026-10-06T15:00:00.000Z", payload: { campaign: "capital-blueprint" },
    result: { document: doc, reviewCard: { markdown: "## Review card\n\n**What this decided:** Sell it." }, counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 2 },
      checks: { gate: { passes: true, misses: [] } } } };

  test("row 3 shows the run's offer and card, Approve is on, and it says what Approve does", () => {
    const files = readyFiles();
    files["03-offer.md"] = { text: null, source: "missing" };
    const waiting = { job_id: "o9", finished_at: job.finished_at, replaces_file: false };
    const rows = stagesView({ campaign: "capital-blueprint", files, jobs: { 3: { job, spentUsd: null } }, offerWaiting: waiting });
    assert.equal(rows[2].state, "MISSING", "the state is still the status script's");
    assert.equal(rows[2].state_word, "Done");
    assert.equal(rows[2].sentence, "Done. A new offer is ready to read (written Oct 6). Approve saves it as step 3.");
    assert.equal(rows[2].can_approve, true);
    assert.deepEqual(rows[2].offer_waiting, waiting);
    assert.match(rows[2].review_card_md, /^## Review card/);
    assert.match(rows[2].document_md, /^# Offer — capital-blueprint/);
    assert.doesNotMatch(rows[2].document_md, /Review card/);
    assert.equal(rows[3].can_run.ok, false, "the copy still waits for step 3 to be approved");
  });

  test("over an older file it says Approve takes its place; a waiting run for another job is ignored", () => {
    const waiting = { job_id: "o9", finished_at: job.finished_at, replaces_file: true };
    let rows = stagesView({ campaign: "capital-blueprint", files: readyFiles(), jobs: { 3: { job, spentUsd: null } }, offerWaiting: waiting });
    assert.match(rows[2].sentence, /Approve saves it as step 3 in place of the offer on file\.$/);
    rows = stagesView({ campaign: "capital-blueprint", files: readyFiles(), jobs: { 3: { job, spentUsd: null } }, offerWaiting: { ...waiting, job_id: "other" } });
    assert.equal(rows[2].state_word, "Done, approved");
    assert.equal(rows[2].offer_waiting, null);
  });
});

describe("a flywheel with the offer approved", () => {
  test("the copy can run; the strategy waits on the copy", () => {
    const rows = stagesView({ campaign: "capital-blueprint", files: readyFiles(), commitSha: "abc123" });
    assert.equal(rows[2].state_word, "Done, approved");
    assert.deepEqual(rows[3].can_run, { ok: true, reason: null });
    assert.equal(rows[3].label_words, "Ad copy for the Capital Blueprint");
    assert.match(rows[4].can_run.reason, /^Approve step 4 first \(the copy\)\.$/);
    assert.match(rows[2].files[0].github_url, /\/blob\/abc123\//, "links pin the commit that was read");
  });

  test("a running job: the step, its words and the live spend; Run says it is that run", () => {
    const job = { id: "j1", kind: "flywheel_stage", status: "running", payload: { campaign: "capital-blueprint", stage: 4 },
      result: { progress: { step: "write", step_n: 3, steps_total: 7, step_word: "writing ad 2 of 16", counts: { written: 6 } } },
      claimed_at: "2026-10-06T10:00:00Z" };
    const rows = stagesView({ campaign: "capital-blueprint", files: readyFiles(), jobs: { 4: { job, spentUsd: 1.9 } } });
    assert.equal(rows[3].state_word, "Running");
    assert.equal(rows[3].sentence, "Running: step 3 of 7, writing ad 2 of 16. $1.90 spent so far.");
    assert.equal(rows[3].run.cost_so_far_usd, 1.9);
    assert.equal(rows[3].can_run.ok, false);
    assert.match(rows[3].can_run.reason, /already being made\. This is that run\./);
  });

  test("a queued job with no spend yet says it is waiting, and never prints $0 for unknown", () => {
    const job = { id: "j2", kind: "flywheel_stage", status: "queued", payload: { stage: 4 }, result: null };
    const rows = stagesView({ campaign: "capital-blueprint", files: readyFiles(), jobs: { 4: { job, spentUsd: null } } });
    assert.equal(rows[3].sentence, "Running: waiting for the machine to pick it up.");
  });

  test("a failed job says why; a cap stop says Stopped at the cap with the saved sentence", () => {
    const failed = { id: "j3", kind: "flywheel_stage", status: "failed", error: "write-a: Claude did not answer (anthropic 529)", result: {} };
    let rows = stagesView({ campaign: "capital-blueprint", files: readyFiles(), jobs: { 4: { job: failed, spentUsd: 0.4 } } });
    assert.equal(rows[3].state_word, "Needs a redo");
    assert.equal(rows[3].sentence, "Could not finish: write-a: Claude did not answer (anthropic 529)");
    assert.equal(rows[3].run.resumable, true);
    const capped = { ...failed, error: "Stopped at the $40.00 run cap while writing the ads. What it made so far is saved. Raise the cap in Settings and tap Retry to finish.", result: { stopped_at_cap: true } };
    rows = stagesView({ campaign: "capital-blueprint", files: readyFiles(), jobs: { 4: { job: capped, spentUsd: 40.1 } } });
    assert.equal(rows[3].state_word, "Stopped at the cap");
    assert.match(rows[3].sentence, /^Stopped at the \$40\.00 run cap/);
  });

  test("an offer job is shown on row 3", () => {
    const job = { id: "o1", kind: "offer", status: "running", payload: { campaign: "capital-blueprint" }, result: null };
    const rows = stagesView({ campaign: "capital-blueprint", files: readyFiles(), jobs: { 3: { job, spentUsd: null } } });
    assert.equal(rows[2].state_word, "Running");
    assert.equal(rows[2].run.kind, "offer");
  });
});

test("reason words", () => {
  assert.equal(reasonWords("did not report guarantees"), "it did not count its guarantees");
  assert.equal(reasonWords("hooks is 3, needs at least 5"), "only 3 hooks, needs 5");
  assert.equal(reasonWords("9 distinct reasons, below Meta's Andromeda floor of 15"), "only 9 reasons to buy, needs 15");
  assert.equal(reasonWords("only 1 guarantee — an offer needs a stack of at least 2"), "only 1 guarantee, needs 2");
  assert.equal(reasonWords("has no review card"), "it has no review card");
  assert.equal(reasonWords("still contains TODO, TBD"), "it still has unfinished text (TODO, TBD)");
  assert.equal(reasonWords("built on the old offer"), "offer changed since it was built");
  assert.equal(reviewCard("# x\nbody"), null);
});
