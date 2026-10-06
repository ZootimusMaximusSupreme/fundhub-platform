// @ts-check
// ONE reader for what every flywheel step reads before it runs. Unit GL.
//
// Steps 1 to 5 (avatar, ad research, offer, copy, ad strategy) each read the files of
// the steps before them. They used three readers (X1's repo-read.mjs, X2's
// research/repo-read.mjs, X3's reader.mjs) that disagreed on the edge that matters while
// GITHUB_REPO_TOKEN is unset (every save then waits in repo_outbox, held 'no_token'):
// X2's skipped waiting edits (an Approve, a Tweak line) and both X1's and X2's dropped
// saves already committed but newer than the copy built into the site. Now every step
// reads through this file, so the chain runs on the database's copy whenever the repo's
// copy is missing or older.
//
// WHERE EACH FILE COMES FROM, NEWEST WINS:
//   1. the repo: GitHub at one pinned commit when the token works, else the copy
//      built into the site ('github' | 'bundle-fallback'; reader.mjs readFlywheel)
//   2. the database's saves for that path in repo_outbox, laid on top in the order they
//      were queued: only the ones not yet committed when the base is GitHub; every one
//      when the base is the built-in copy, because that copy is older than all of them
//      ('outbox-pending'). A replace is the whole file; an edit (Approve, a Tweak line)
//      is re-applied.
//   3. for 03-offer.md only: the newest offer run Chris approved as step 3
//      (marketing_jobs.result.stage_file, written by Approve), when the file above is
//      missing or has a lower version ('job-result'). src/marketing/flywheel/offer-stage.mjs.
// Every file says where it came from, whether its stamp says approved, and its version.
//
// Nothing here writes anything.

import { readFlywheel, CAMPAIGN_FILES } from "./reader.mjs";
import { readRepoFile as readAnyRepoFile } from "./repo-read.mjs";
import { isCampaign } from "./campaigns.mjs";
import { splitFrontMatter, parseFrontMatter } from "./stamp.mjs";
import { OFFER_FILE, newestApprovedOffer, offerFileFromStamp, stampVersion } from "./offer-stage.mjs";

/** What each step reads (relative to marketing/flywheel/<campaign>/). */
export const STAGE_INPUTS = Object.freeze({
  1: Object.freeze(["00-OWNER-NOTES.md", "01-avatar.md", "01-avatar/Service_Business_Foundation.md", "01-avatar/Market_Language_Bank.md"]),
  2: Object.freeze(["00-OWNER-NOTES.md", "01-avatar.md", "02-ad-research.md"]),
  3: Object.freeze(["00-OWNER-NOTES.md", "01-avatar.md", "02-ad-research.md", "03-offer.md"]),
  4: Object.freeze(["00-OWNER-NOTES.md", "01-avatar.md", "01-avatar/Market_Language_Bank.md", "03-offer.md", "04-copy.md"]),
  5: Object.freeze(["00-OWNER-NOTES.md", "03-offer.md", "04-copy.md", "05-ad-strategy.md"])
});

/**
 * @typedef {{text: string|null, source: string, approved: boolean, version: number}} StageInput
 */

/**
 * readStageInputs({ db, orgId, campaign, files, env, deps, list, via }) → {
 *   source: 'github' | 'bundle-fallback', fallback_reason, commit_sha, campaigns,
 *   files: { [name]: StageInput }
 * }
 * deps: the reader's test hooks (getRef, getContents, listFolder, pendingRows,
 * bundleRoots) plus approvedOffer(campaign) → the newest approved offer run, or null.
 * list: also list every campaign folder (the Ideas card; a step run does not need it).
 * via: the folder reader (reader.mjs readFlywheel; a route test may hand in its own).
 * @param {{db?: any, orgId?: string|null, campaign: string, files?: readonly string[], env?: any, deps?: any,
 *          list?: boolean, via?: Function}} args
 */
export async function readStageInputs({ db, orgId = null, campaign, files = CAMPAIGN_FILES, env = process.env, deps = {}, list = false, via = readFlywheel }) {
  if (!isCampaign(campaign)) throw new TypeError(`not a campaign name: ${JSON.stringify(campaign)}`);
  const names = [...new Set(files)];
  const read = await via({ db, orgId: orgId || undefined, campaign, env, deps, files: names, list });
  const out = names.includes(OFFER_FILE)
    ? await layApprovedOffer(read.files || {}, { db, orgId, campaign, deps })
    : { ...(read.files || {}) };

  /** @type {Record<string, StageInput>} */
  const filesOut = {};
  for (const [name, f] of Object.entries(out)) {
    const text = f && f.text != null ? String(f.text) : null;
    const meta = text == null ? {} : parseFrontMatter(splitFrontMatter(text).frontMatter);
    filesOut[name] = {
      text,
      source: text == null ? "missing" : f.source,
      approved: meta.status === "approved",
      version: stampVersion(text)
    };
  }
  for (const name of names) if (!filesOut[name]) filesOut[name] = { text: null, source: "missing", approved: false, version: 0 };
  return {
    source: read.source, fallback_reason: read.fallback_reason, commit_sha: read.commit_sha,
    campaigns: Array.isArray(read.campaigns) ? read.campaigns : [], files: filesOut
  };
}

/**
 * layApprovedOffer(files, { db, orgId, campaign, deps }) → files, with 03-offer.md taken
 * from the newest offer run Chris approved as step 3 when the copy in `files` is missing
 * or has a lower version (source 'job-result'). The Ideas card (GET marketing/flywheel)
 * and every step read 03-offer.md through this, so they always agree.
 * @param {Record<string, {text: string|null, source: string}>} files
 * @param {{db?: any, orgId?: string|null, campaign: string, deps?: any}} args
 */
export async function layApprovedOffer(files, { db, orgId = null, campaign, deps = {} }) {
  const out = { ...(files || {}) };
  const job = deps && deps.approvedOffer
    ? await deps.approvedOffer(campaign)
    : (db && orgId ? await newestApprovedOffer(db, { orgId, campaign }) : null);
  const fromJob = job ? offerFileFromStamp(job) : null;
  if (fromJob) {
    const cur = out[OFFER_FILE] ? out[OFFER_FILE].text : null;
    if (cur == null || stampVersion(cur) < stampVersion(fromJob)) out[OFFER_FILE] = { text: fromJob, source: "job-result" };
  }
  return out;
}

/** A file's text from readStageInputs' answer, or null. */
export function inputText(read, name) {
  const f = read && read.files ? read.files[name] : null;
  return f && f.text != null ? f.text : null;
}

/**
 * readStageFile(db, { orgId, path, env, deps }) → { content, source, sha? }
 * One repo path in the shape src/marketing/avatar/run.mjs reads. A flywheel stage path
 * (marketing/flywheel/<campaign>/<file>) goes through readStageInputs; any other path
 * (the testimonials file) through the plain repo read.
 * @param {any} db
 * @param {{orgId?: string, path: string, env?: any, deps?: any}} args
 */
export async function readStageFile(db, { orgId, path: p, env = process.env, deps = {} }) {
  const m = /^marketing\/flywheel\/([a-z0-9][a-z0-9-]{0,40})\/((?:[A-Za-z0-9_][A-Za-z0-9_ .()-]*\/)*[A-Za-z0-9_][A-Za-z0-9_ .()-]*)$/.exec(String(p || ""));
  if (!m || !isCampaign(m[1]) || m[2].split("/").includes("..")) return readAnyRepoFile(db, { orgId, path: p, env, deps });
  const read = await readStageInputs({ db, orgId, campaign: m[1], files: [m[2]], env, deps });
  const f = read.files[m[2]];
  return { content: f.text, source: f.source, sha: read.commit_sha };
}
