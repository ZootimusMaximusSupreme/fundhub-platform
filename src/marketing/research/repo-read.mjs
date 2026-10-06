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

import fs from "node:fs";
import path from "node:path";
import { getRef as ghGetRef, getContents as ghGetContents } from "../../repo/github.mjs";
import { flywheelDir, ownerNotesSection, isCampaign } from "../offer-inputs.mjs";
import { splitFrontMatter, parseFrontMatter, bodyHash } from "../../../scripts/flywheel/status.mjs";

export const STAGE_FILES = Object.freeze({
  notes: "00-OWNER-NOTES.md",
  avatar: "01-avatar.md",
  research: "02-ad-research.md"
});

/** "marketing/flywheel/<campaign>/<file>" */
export function stagePath(campaign, file) {
  return `marketing/flywheel/${campaign}/${file}`;
}

async function pendingContent(db, repoPath) {
  if (!db) return null;
  const r = await db.query(
    `SELECT content FROM repo_outbox
      WHERE path = $1 AND mode = 'replace' AND committed_sha IS NULL AND content IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [repoPath]
  );
  return r.rows[0] ? String(r.rows[0].content) : null;
}

function bundleContent(campaign, file) {
  const dir = flywheelDir(campaign);
  if (!dir) return null;
  try { return fs.readFileSync(path.join(dir, file), "utf8"); } catch { return null; }
}

/**
 * readStageFiles(db, campaign, { env, getRef, getContents }) → {
 *   source: 'github' | 'bundle-fallback', sha, pending: [paths read from the outbox],
 *   files: { notes, avatar, research } (whole text or null),
 *   avatar: { body, hash } | null, ownerNotes, priorVersion
 * }
 * Never throws for a missing file: a stage that is not on file is null.
 */
export async function readStageFiles(db, campaign, { env = process.env, getRef = ghGetRef, getContents = ghGetContents } = {}) {
  if (!isCampaign(campaign)) throw new TypeError(`not a campaign name: ${JSON.stringify(campaign)}`);
  /** @type {Record<string, string|null>} */
  const files = { notes: null, avatar: null, research: null };
  let source = "bundle-fallback";
  let sha = null;
  let github = false;
  try {
    const ref = await getRef({ env });
    if (ref && ref.ok && ref.sha) {
      sha = ref.sha;
      const got = {};
      let allOk = true;
      for (const [k, file] of Object.entries(STAGE_FILES)) {
        const c = await getContents(stagePath(campaign, file), { ref: sha, env });
        if (!c || !c.ok) { allOk = false; break; }
        got[k] = c.missing ? null : c.content;
      }
      if (allOk) { Object.assign(files, got); github = true; source = "github"; }
    }
  } catch { github = false; }
  if (!github) {
    sha = null;
    for (const [k, file] of Object.entries(STAGE_FILES)) files[k] = bundleContent(campaign, file);
  }
  const pending = [];
  for (const [k, file] of Object.entries(STAGE_FILES)) {
    const p = await pendingContent(db, stagePath(campaign, file));
    if (p != null) { files[k] = p; pending.push(stagePath(campaign, file)); }
  }
  let priorVersion = null;
  if (files.research) {
    const fm = parseFrontMatter(splitFrontMatter(files.research).frontMatter);
    const v = Number(fm.version);
    priorVersion = Number.isInteger(v) && v > 0 ? v : null;
  }
  return {
    source,
    sha,
    pending,
    files,
    avatar: files.avatar ? { body: splitFrontMatter(files.avatar).body.trim(), hash: bodyHash(files.avatar) } : null,
    ownerNotes: files.notes ? ownerNotesSection(files.notes) : "",
    priorVersion
  };
}
