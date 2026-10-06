// @ts-check
// The flywheel stage files a research run reads, from the repo as it is now: GitHub at one
// pinned commit, with saves still waiting in the repo outbox laid on top, and the copy
// bundled with the function only when GitHub cannot be read.
//
// Design docs/specs/command-center-design-2026-10-05.md §6 "Slice 1 additions" ("a GitHub
// READ path (Contents ... API with an ETag, pinned to a commit SHA) with pending outbox rows
// laid on top ... with the function bundle as the fallback only and every response naming
// its source") and "Slice 10" ("the stamp with the avatar body hash from the same pinned
// repo read"). Unit X2. The bundle has the files because netlify.toml ships
// "marketing/flywheel/**" to every function.
//
// Unit GL: the reading itself is the one stage reader every flywheel step uses
// (src/marketing/flywheel/stage-inputs.mjs). This file keeps X2's answer shape.

import { ownerNotesSection, isCampaign } from "../offer-inputs.mjs";
import { splitFrontMatter, parseFrontMatter, bodyHash } from "../../../scripts/flywheel/status.mjs";
import { readStageInputs, STAGE_INPUTS } from "../flywheel/stage-inputs.mjs";

export const STAGE_FILES = Object.freeze({
  notes: "00-OWNER-NOTES.md",
  avatar: "01-avatar.md",
  research: "02-ad-research.md"
});

/** "marketing/flywheel/<campaign>/<file>" */
export function stagePath(campaign, file) {
  return `marketing/flywheel/${campaign}/${file}`;
}

/**
 * repoFlywheelDefaults(db, campaign, opts) → the offer writer's default inputs in
 * readFlywheelDefaults' shape ({avatar, research, ownerNotes, files}, plus `source`), read
 * through the same pinned repo read as the research runs, so a board saved by "Research
 * the market" reaches the offer writer without a ship (design §6 slice 10).
 * opts: readStageFiles' options (pass orgId, or no saves are read).
 */
export async function repoFlywheelDefaults(db, campaign, opts = {}) {
  const r = await readStageFiles(db, campaign, opts);
  const body = (t) => (t ? splitFrontMatter(t).body.trim() : "");
  const rel = (f) => stagePath(campaign, f);
  const avatar = body(r.files.avatar);
  const research = body(r.files.research);
  return {
    avatar,
    research,
    ownerNotes: r.ownerNotes,
    source: r.source,
    files: {
      avatar: avatar ? rel(STAGE_FILES.avatar) : null,
      research: research ? rel(STAGE_FILES.research) : null,
      ownerNotes: r.ownerNotes ? rel(STAGE_FILES.notes) : null
    }
  };
}

/**
 * readStageFiles(db, campaign, { env, orgId, getRef, getContents, deps }) → {
 *   source: 'github' | 'bundle-fallback', sha, pending: [paths read from the database],
 *   files: { notes, avatar, research } (whole text or null),
 *   avatar: { body, hash } | null, ownerNotes, priorVersion
 * }
 * Never throws for a missing file: a stage that is not on file is null.
 *
 * Unit GL: this is the one stage reader in X2's shape. So a waiting Approve or Tweak line
 * counts, a save committed after the copy built into the site still counts, and only this
 * company's saves are read (orgId; with no orgId no saves are read, never another
 * company's).
 * @param {any} db
 * @param {string} campaign
 * @param {{env?: any, orgId?: string|null, getRef?: Function, getContents?: Function, deps?: any}} [opts]
 */
export async function readStageFiles(db, campaign, { env = process.env, orgId = null, getRef, getContents, deps = {} } = {}) {
  if (!isCampaign(campaign)) throw new TypeError(`not a campaign name: ${JSON.stringify(campaign)}`);
  const reader = { ...deps };
  if (getRef) reader.getRef = getRef;
  if (getContents) reader.getContents = getContents;
  const read = await readStageInputs({ db, orgId, campaign, files: STAGE_INPUTS[2], env, deps: reader });
  /** @type {Record<string, string|null>} */
  const files = { notes: null, avatar: null, research: null };
  const pending = [];
  for (const [k, file] of Object.entries(STAGE_FILES)) {
    const f = read.files[file];
    files[k] = f && f.text != null ? f.text : null;
    if (f && (f.source === "outbox-pending" || f.source === "job-result")) pending.push(stagePath(campaign, file));
  }
  let priorVersion = null;
  if (files.research) {
    const fm = parseFrontMatter(splitFrontMatter(files.research).frontMatter);
    const v = Number(fm.version);
    priorVersion = Number.isInteger(v) && v > 0 ? v : null;
  }
  return {
    source: read.source,
    sha: read.commit_sha,
    pending,
    files,
    avatar: files.avatar ? { body: splitFrontMatter(files.avatar).body.trim(), hash: bodyHash(files.avatar) } : null,
    ownerNotes: files.notes ? ownerNotesSection(files.notes) : "",
    priorVersion
  };
}
