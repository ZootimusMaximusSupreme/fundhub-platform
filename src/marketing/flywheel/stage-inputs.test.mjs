// The one reader every flywheel step uses (unit GL): with GITHUB_REPO_TOKEN unset every
// save waits in repo_outbox ('no_token'), and the chain avatar → ad research → offer →
// copy → ad strategy must still read each step's newest approved output from the
// database. No network: GitHub is a stand-in, the outbox rows are handed in.
//
// The runs themselves, each reading through this reader:
//   step 1  src/marketing/avatar/run.test.mjs          "unit GL: ..."
//   step 2  src/marketing/flywheel/ad-research.test.mjs "unit GL: ..."
//   step 3  this file, "step 3" (the flywheel run route's hand-off and the Write offer defaults)
//   step 4, 5  src/marketing/flywheel/stage-runs.test.mjs "unit GL: ..."
//   real Postgres: src/http/marketing-flywheel.pg.test.mjs "the Blueprint chain with no GitHub token"

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readStageInputs, readStageFile, inputText, layApprovedOffer, STAGE_INPUTS } from "./stage-inputs.mjs";
import { clearReaderCache } from "./reader.mjs";
import { readCampaign, startOffer } from "./http.mjs";
import { repoFlywheelDefaults } from "../research/repo-read.mjs";
import { stampStage, hashOf, bodyOf } from "./stamp.mjs";
import { offerStageFile } from "./offer-stage.mjs";

const ORG = "33333333-3333-4333-8333-333333333333";
const NO_TOKEN = Object.freeze({});
const CARD = "\n## Review card\n\n**What this decided:** x\n";
const dir = (c) => `marketing/flywheel/${c}`;

const NOTES = "# Capital Blueprint\n\nOffer key: UWIQ_DELIVERABLES\n\n## Notes\n";
const AVATAR = stampStage({ stage: 1, version: 1, status: "draft", counts: { quotes: 30, languageEntries: 120 }, body: `# Buyer\nOwners a bank turned down.${CARD}` });
const BANK = "# Market Language Bank\n- my file got declined\n";
const RESEARCH = stampStage({ stage: 2, version: 1, status: "draft", inputs: { "01-avatar.md": hashOf(AVATAR) },
  counts: { rowsVerified: 9, competitorsFound: 4, rowsWithFirstSeen: 6 }, body: `# Market${CARD}` });

/** The company's flywheel saves, oldest first: replaces, then Approve and Tweak edits. */
function saves(campaign, list) {
  let id = 0;
  return list.map(([file, kind, value]) => ({
    id: ++id,
    path: `${dir(campaign)}/${file}`,
    mode: kind === "replace" ? "replace" : "edit",
    content: kind === "replace" ? value : null,
    edit: kind === "approve" ? { op: "set_front_matter_key", key: "status", value: "approved" }
      : kind === "tweak" ? { op: "append_line_under_heading", heading: "## Notes", line: value } : null,
    committed_sha: null
  }));
}

const chain = () => saves("capital-blueprint", [
  ["00-OWNER-NOTES.md", "replace", NOTES],
  ["00-OWNER-NOTES.md", "tweak", "2026-10-06 | stage 1 | lean on the business file"],
  ["01-avatar.md", "replace", AVATAR],
  ["01-avatar/Market_Language_Bank.md", "replace", BANK],
  ["01-avatar.md", "approve"],
  ["02-ad-research.md", "replace", RESEARCH],
  ["02-ad-research.md", "approve"]
]);

beforeEach(() => clearReaderCache());

describe("the one stage reader", () => {
  test("no token, a new campaign: every file is the company's waiting save, edits laid on, approved and version read", async () => {
    const r = await readStageInputs({ campaign: "capital-blueprint", files: STAGE_INPUTS[3], env: NO_TOKEN, deps: { pendingRows: async () => chain(), approvedOffer: async () => null } });
    assert.equal(r.source, "bundle-fallback");
    assert.match(r.fallback_reason, /GITHUB_REPO_TOKEN is not set/);
    assert.equal(r.files["01-avatar.md"].source, "outbox-pending");
    assert.equal(r.files["01-avatar.md"].approved, true, "the waiting Approve counts");
    assert.equal(r.files["01-avatar.md"].version, 1);
    assert.equal(hashOf(r.files["01-avatar.md"].text), hashOf(AVATAR), "approving never changes the body hash");
    assert.equal(r.files["02-ad-research.md"].approved, true);
    assert.match(inputText(r, "00-OWNER-NOTES.md"), /2026-10-06 \| stage 1 \| lean on the business file\n$/);
    assert.deepEqual(r.files["03-offer.md"], { text: null, source: "missing", approved: false, version: 0 });
  });

  test("an older built-in copy: a save committed after it still counts; on GitHub only saves not yet committed are laid on", async () => {
    const newer = stampStage({ stage: 1, version: 99, status: "approved", counts: { quotes: 1 }, body: "# Newer avatar\n" });
    const committed = [{ id: 1, path: `${dir("partner")}/01-avatar.md`, mode: "replace", content: newer, edit: null, committed_sha: "c".repeat(40) }];
    const bundle = await readStageInputs({ campaign: "partner", files: ["01-avatar.md"], env: NO_TOKEN, deps: { pendingRows: async () => committed } });
    assert.equal(bundle.files["01-avatar.md"].text, newer, "the bundle is older than any save, so the save wins");
    assert.equal(bundle.files["01-avatar.md"].version, 99);
    const gh = {
      getRef: async () => ({ ok: true, sha: "a".repeat(40) }),
      getContents: async () => ({ ok: true, content: "---\nstage: 1\nversion: 100\nstatus: approved\n---\n# On GitHub\n" }),
      pendingRows: async () => committed
    };
    const onGitHub = await readStageInputs({ campaign: "partner", files: ["01-avatar.md"], env: NO_TOKEN, deps: gh });
    assert.equal(onGitHub.source, "github");
    assert.equal(onGitHub.files["01-avatar.md"].version, 100, "a committed save is already in git");
  });

  test("03-offer.md: the approved offer run fills in when the file is missing or older; a newer file wins", async () => {
    const f = {
      "01-avatar.md": { text: AVATAR, source: "outbox-pending" },
      "02-ad-research.md": { text: RESEARCH, source: "outbox-pending" },
      "03-offer.md": { text: null, source: "missing" }
    };
    const run = {
      id: "6f1d8a52-1111-4a1a-9b1b-0000000000aa", kind: "offer", status: "done",
      payload: { campaign: "capital-blueprint", avatarSummary: bodyOf(AVATAR), adResearchSummary: bodyOf(RESEARCH) },
      result: { document: `# Offer — capital-blueprint\nThe plan is $5,000.${CARD}`, counts: { priceSet: 1, bonuses: 3, guarantees: 2, valueEquationScores: 4 } }
    };
    const { text, stageFile } = offerStageFile({ job: run, files: f });
    const approved = { ...run, result: { ...run.result, stage_file: stageFile } };
    const deps = { approvedOffer: async () => approved };

    const missing = await layApprovedOffer(f, { campaign: "capital-blueprint", deps });
    assert.deepEqual(missing["03-offer.md"], { text, source: "job-result" });
    const older = await layApprovedOffer({ ...f, "03-offer.md": { text: stampStage({ stage: 3, version: 0, body: "# old\n" }), source: "github" } }, { campaign: "capital-blueprint", deps });
    assert.equal(older["03-offer.md"].source, "job-result");
    const newer = stampStage({ stage: 3, version: 2, status: "draft", body: "# a later offer\n" });
    const kept = await layApprovedOffer({ ...f, "03-offer.md": { text: newer, source: "outbox-pending" } }, { campaign: "capital-blueprint", deps });
    assert.equal(kept["03-offer.md"].text, newer);

    const r = await readStageInputs({ campaign: "capital-blueprint", files: STAGE_INPUTS[4], env: NO_TOKEN, deps: { pendingRows: async () => chain(), ...deps } });
    assert.equal(r.files["03-offer.md"].source, "job-result");
    assert.equal(r.files["03-offer.md"].approved, true);
    assert.equal(inputText(r, "03-offer.md"), text);
  });

  test("one path in the avatar's shape; a path outside the flywheel goes to the plain repo read", async () => {
    const deps = { pendingRows: async () => chain() };
    const notes = await readStageFile(null, { path: `${dir("capital-blueprint")}/00-OWNER-NOTES.md`, env: NO_TOKEN, deps });
    assert.equal(notes.source, "outbox-pending");
    assert.match(notes.content, /lean on the business file/);
    const none = await readStageFile(null, { path: `${dir("capital-blueprint")}/01-avatar/Service_Business_Foundation.md`, env: NO_TOKEN, deps });
    assert.deepEqual({ content: none.content, source: none.source }, { content: null, source: "missing" });
    const other = await readStageFile(null, { path: "marketing/flywheel/README.md", env: NO_TOKEN, deps });
    assert.equal(other.source, "bundle-fallback", "README is not a campaign file: the plain read");
    await assert.rejects(readStageInputs({ campaign: "../x", env: NO_TOKEN }), TypeError);
  });

  test("only this company's saves: with a database and no company id nothing is read from it", async () => {
    const db = { query: async () => { throw new Error("no company, no query"); } };
    const r = await readStageInputs({ db, campaign: "capital-blueprint", files: ["01-avatar.md", "03-offer.md"], env: NO_TOKEN });
    assert.equal(r.files["01-avatar.md"].source, "missing");
  });
});

describe("step 3 reads the same way (the flywheel's Write the offer hand-off and the Write offer defaults)", () => {
  /** A database stand-in for readCampaign: this company's saves, no runs, nothing written. */
  const db = {
    query: async (sql, params) => {
      const s = String(sql);
      if (/FROM repo_outbox/.test(s) && /path LIKE 'marketing\/flywheel\/%'/.test(s)) {
        assert.equal(params[0], ORG);
        return { rows: chain().reverse() };
      }
      if (/FROM marketing_jobs/.test(s) && /stage_file/.test(s)) return { rows: [] };
      throw new Error(`unexpected statement: ${s.slice(0, 80)}`);
    }
  };

  test("Run on step 3 hands the waiting avatar and market research to the offer writer, with the Tweak line", async () => {
    const view = await readCampaign({ db, orgId: ORG, campaign: "capital-blueprint", env: NO_TOKEN, deps: { latestStageJobs: async () => ({}) } });
    assert.ok(view.read.campaigns.includes("capital-blueprint"), "a campaign only in the outbox is listed");
    assert.equal(view.stages[0].state_word, "Done, approved", "row 1 reads the waiting save and its Approve");
    assert.equal(view.stages[0].source, "outbox-pending");
    assert.equal(view.stages[2].can_run.ok, true, "the offer can run: who we sell to is on file");
    let seen = null;
    const out = await startOffer({ headers: {} }, {
      campaign: "capital-blueprint", files: view.files,
      offerHandler: async (req, res) => { seen = req.body; res.status(202).json({ ok: true, started: true }); }
    });
    assert.equal(out.status, 202);
    assert.equal(seen.avatar_summary, bodyOf(AVATAR));
    assert.equal(seen.ad_research_summary, bodyOf(RESEARCH));
    assert.match(seen.owner_notes, /lean on the business file/);
  });

  test("the Write offer card's defaults read the same saves, for this company only", async () => {
    const d = await repoFlywheelDefaults(db, "capital-blueprint", { env: NO_TOKEN, orgId: ORG });
    assert.equal(d.avatar, bodyOf(AVATAR));
    assert.equal(d.research, bodyOf(RESEARCH));
    assert.equal(d.source, "bundle-fallback");
    assert.equal(d.files.avatar, `${dir("capital-blueprint")}/01-avatar.md`);
  });
});
