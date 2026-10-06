// Step 3's file from the newest finished offer run (unit GL): when a run waits, the
// stamped 03-offer.md Approve writes, its honest input hashes, and the same text built
// again from the record kept on the run. No database, no network.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  offerWaiting, offerStageFile, offerFileFromStamp, offerInputHashes, stampJob, stampVersion,
  waitingWords, jobReviewCard, jobDocument, offerOpId, OFFER_FILE
} from "./offer-stage.mjs";
import { stampStage, hashOf, bodyOf } from "./stamp.mjs";
import { evaluateFiles, splitFrontMatter, parseFrontMatter } from "../../../scripts/flywheel/status.mjs";
import { AVATAR_MAX_CHARS } from "../offer-rubric.mjs";

const CARD = "## Review card\n\n**What this decided:** Sell the Capital Blueprint at $5,000.\n\n**Say one of:** approve";
const DOC = `# Offer — capital-blueprint\nAs of 2026-10-06.\n\n## 1. The offer in one sentence\n\nA funding plan in 30 days.\n\n## 2. The price, and why that number\n\n$5,000\n\n${CARD}\n`;

function files() {
  const avatar = stampStage({ stage: 1, version: 1, status: "approved", counts: { quotes: 30, languageEntries: 120 }, body: "# Buyer\nOwners who were turned down.\n\n## Review card\n\nx\n" });
  const research = stampStage({ stage: 2, version: 1, status: "approved", inputs: { "01-avatar.md": hashOf(avatar) },
    counts: { rowsVerified: 9, competitorsFound: 4, rowsWithFirstSeen: 6 }, body: "# Market\n\n## Review card\n\nx\n" });
  return {
    "00-OWNER-NOTES.md": { text: "# n\nOffer key: UWIQ_DELIVERABLES\n\n## Notes\n", source: "outbox-pending" },
    "01-avatar.md": { text: avatar, source: "outbox-pending" },
    "02-ad-research.md": { text: research, source: "outbox-pending" },
    "03-offer.md": { text: null, source: "missing" }
  };
}

function job(over = {}) {
  const f = files();
  return {
    id: "6f1d8a52-1111-4a1a-9b1b-000000000001",
    kind: "offer",
    status: "done",
    finished_at: "2026-10-06T16:00:00.000Z",
    payload: {
      campaign: "capital-blueprint",
      avatarSummary: bodyOf(f["01-avatar.md"].text),
      adResearchSummary: bodyOf(f["02-ad-research.md"].text),
      cut: { avatar: false, adResearch: false, ownerNotes: false }
    },
    result: {
      document: DOC,
      reviewCard: { markdown: CARD },
      counts: { priceSet: 1, bonuses: 3, guarantees: 2, valueEquationScores: 4 },
      checks: { gate: { passes: true, misses: [] } }
    },
    ...over
  };
}

describe("when a run waits for Approve", () => {
  test("the newest run, done, never written, and not the file's own run", () => {
    const j = job();
    assert.deepEqual(offerWaiting({ job: j, fileText: null, written: false }),
      { job_id: j.id, finished_at: "2026-10-06T16:00:00.000Z", replaces_file: false });
    assert.equal(offerWaiting({ job: j, fileText: null, written: true }), null, "already written once");
    assert.equal(offerWaiting({ job: { ...j, status: "running" }, fileText: null, written: false }), null);
    assert.equal(offerWaiting({ job: { ...j, status: "failed" }, fileText: null, written: false }), null);
    assert.equal(offerWaiting({ job: { ...j, kind: "flywheel_stage" }, fileText: null, written: false }), null);
    assert.equal(offerWaiting({ job: { ...j, result: { counts: {} } }, fileText: null, written: false }), null, "no document, nothing to save");
    const built = offerStageFile({ job: j, files: files() }).text;
    assert.equal(offerWaiting({ job: j, fileText: built, written: false }), null, "the file already says it came from this run");
    const older = stampStage({ stage: 3, version: 1, status: "draft", body: "# An older offer written by hand\n" });
    assert.equal(offerWaiting({ job: j, fileText: older, written: false }).replaces_file, true);
    assert.equal(offerOpId(j.id), `flywheel-offer:${j.id}`);
  });

  test("the row words: what Approve does, and the bar it misses if any", () => {
    const w = waitingWords({ finished_at: "2026-10-06T16:00:00.000Z", replaces_file: false }, job());
    assert.deepEqual(w, { state_word: "Done", sentence: "Done. A new offer is ready to read (written Oct 6). Approve saves it as step 3." });
    const thin = job({ result: { ...job().result, checks: { gate: { passes: false, misses: ["The flywheel's stage 3 check wants at least 3 bonuses; this offer has 2."] } } } });
    assert.match(waitingWords({ finished_at: null, replaces_file: true }, thin).sentence,
      /^Done\. A new offer is ready to read\. Approve saves it as step 3 in place of the offer on file\. It does not clear the bar for the next step yet: The flywheel's stage 3 check wants at least 3 bonuses; this offer has 2\.$/);
    assert.match(jobReviewCard(job()), /^## Review card/);
    assert.equal(jobDocument(job()).includes("Review card"), false);
  });
});

describe("the stamped 03-offer.md", () => {
  test("approved, version 1, the run's counts and job, inputs hashed from the files the run read; the status script reads it READY", () => {
    const f = files();
    const now = new Date("2026-10-06T17:00:00.000Z");
    const { text, stageFile } = offerStageFile({ job: job(), files: f, now, staffId: "staff-1" });
    const meta = parseFrontMatter(splitFrontMatter(text).frontMatter);
    assert.equal(meta.stage, 3);
    assert.equal(meta.version, 1);
    assert.equal(meta.status, "approved");
    assert.equal(meta.job, job().id);
    assert.deepEqual(meta.counts, { priceSet: 1, bonuses: 3, valueEquationScores: 4, guarantees: 2 });
    assert.equal(meta.inputs["01-avatar.md"], hashOf(f["01-avatar.md"].text));
    assert.equal(meta.inputs["02-ad-research.md"], hashOf(f["02-ad-research.md"].text));
    assert.equal(splitFrontMatter(text).body.trim(), DOC.trim(), "the body is the run's document, word for word");
    assert.equal(stampJob(text), job().id);
    assert.equal(stampVersion(text), 1);
    assert.deepEqual(stageFile, { version: 1, inputs: meta.inputs, counts: meta.counts, approved_at: now.toISOString(), approved_by: "staff-1" });

    const all = { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.text])), [OFFER_FILE]: text };
    const rows = evaluateFiles((name) => all[name] ?? null);
    assert.equal(rows[2].state, "READY", rows[2].reasons.join("; "));
    assert.equal(rows[2].meta.status, "approved");
  });

  test("one version above the file it replaces", () => {
    const f = files();
    f[OFFER_FILE] = { text: stampStage({ stage: 3, version: 4, status: "draft", body: "# old\n" }), source: "github" };
    assert.equal(stampVersion(offerStageFile({ job: job(), files: f }).text), 5);
  });

  test("the same text again from the record kept on the run", () => {
    const { text, stageFile } = offerStageFile({ job: job(), files: files(), now: new Date("2026-10-06T17:00:00.000Z") });
    const approved = job({ result: { ...job().result, stage_file: { ...stageFile, outbox_id: 9 } } });
    assert.equal(offerFileFromStamp(approved), text);
    assert.equal(offerFileFromStamp(job()), null, "a run never approved builds nothing");
  });

  test("honest input hashes: a changed or missing input never reads as current", () => {
    const f = files();
    const j = job();
    // The avatar changed after the run read it: the stamp records what the run read.
    const changed = { ...f, "01-avatar.md": { text: stampStage({ stage: 1, version: 2, status: "draft", body: "# Buyer, version 2\n" }), source: "outbox-pending" } };
    const h = offerInputHashes(j.payload, changed);
    assert.notEqual(h["01-avatar.md"], hashOf(changed["01-avatar.md"].text));
    const all = { ...Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.text])), [OFFER_FILE]: offerStageFile({ job: j, files: changed }).text };
    assert.equal(evaluateFiles((name) => all[name] ?? null)[2].state, "STALE", "built on the old avatar");
    // The run had no ad research: that input is left out (the script says so).
    assert.deepEqual(Object.keys(offerInputHashes({ ...j.payload, adResearchSummary: "" }, f)), ["01-avatar.md"]);
    // A summary the offer path cut to its limit still matches the whole file.
    const longBody = `# Buyer\n${"word ".repeat(2000)}`;
    const long = stampStage({ stage: 1, version: 1, status: "approved", body: longBody });
    const cut = bodyOf(long).slice(0, AVATAR_MAX_CHARS);
    assert.equal(offerInputHashes({ avatarSummary: cut, cut: { avatar: true } }, { "01-avatar.md": { text: long } })["01-avatar.md"], hashOf(long));
  });
});
