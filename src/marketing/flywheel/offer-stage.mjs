// @ts-check
// Step 3's file (marketing/flywheel/<campaign>/03-offer.md), written from the newest
// finished offer run when Chris taps Approve on the offer row. Unit GL.
//
// Why: the offer is written by the Write offer path (src/marketing/offer-*.mjs, job
// kind 'offer'), which saves its answer in marketing_jobs.result and never wrote the
// stage file. Without 03-offer.md step 3 could not be approved, so the copy (step 4)
// and the ad strategy (step 5) stayed blocked (docs/specs/blueprint-funnel-test-plan-
// 2026-10-06.md, "Likely outcome", A4 to A6).
//
// THE RULES
//   * A run is WAITING when it is the newest offer run for the campaign, it is done,
//     it was never written to the file (no outbox save under its op id), and the file
//     on hand does not already say it came from that run. The Ideas row then shows the
//     run's offer and its review card, and Approve is on.
//   * Approve on a waiting run writes the whole stamped file in ONE outbox save with
//     status approved, and records the stamp on the run (result.stage_file) with Chris's
//     staff id. The old file, if any, stays in git history; nothing is deleted.
//   * The stamp records the input hashes honestly: the hash of 01-avatar.md and
//     02-ad-research.md as they are now when the run read that same text, else the hash
//     of the text the run did read, so the status script says "built on the old avatar".
//     An input the run did not have is left out (the script then says so).
//   * The counts are the run's own (priceSet, bonuses, valueEquationScores, guarantees),
//     whole numbers only. A thin offer is saved thin; the row says it does not clear the bar.

import { createHash } from "node:crypto";
import { stampStage, nextVersion, hashOf, bodyOf, splitFrontMatter, parseFrontMatter } from "./stamp.mjs";
import { AVATAR_MAX_CHARS, RESEARCH_MAX_CHARS } from "../offer-rubric.mjs";

export const OFFER_FILE = "03-offer.md";
export const OFFER_STAGE = 3;

/** The outbox op id for "run <jobId> was written to 03-offer.md". One per run, per company. */
export const offerOpId = (jobId) => `flywheel-offer:${jobId}`;

/** @param {Record<string, {text: string|null}>|null|undefined} files @param {string} name */
const textOf = (files, name) => (files && files[name] && files[name].text != null ? String(files[name].text) : null);

function meta(text) {
  return text == null ? {} : parseFrontMatter(splitFrontMatter(String(text)).frontMatter);
}

/** The offer run a stage file says it was written from (its `job:` line), or null. */
export function stampJob(text) {
  const j = meta(text).job;
  return typeof j === "string" && j ? j : null;
}

/** A stage file's version (0 when it has no stamp or no version). */
export function stampVersion(text) {
  const v = Number(meta(text).version);
  return Number.isInteger(v) && v > 0 ? v : 0;
}

/** First 8 hex of the sha256 of a text: the same form bodyHash() gives a file's body. */
function textHash(s) {
  return createHash("sha256").update(String(s), "utf8").digest("hex").slice(0, 8);
}

/**
 * offerInputHashes(payload, files) → { "01-avatar.md"?: hash, "02-ad-research.md"?: hash }
 * payload: the offer run's inputs (avatarSummary, adResearchSummary, cut).
 * @param {any} payload
 * @param {Record<string, {text: string|null}>} files
 */
export function offerInputHashes(payload, files) {
  const p = payload && typeof payload === "object" ? payload : {};
  const cut = p.cut && typeof p.cut === "object" ? p.cut : {};
  /** @type {Record<string, string>} */
  const out = {};
  const one = (name, summary, wasCut, max) => {
    const s = typeof summary === "string" ? summary.trim() : "";
    if (!s) return;
    const cur = textOf(files, name);
    const body = cur == null ? null : bodyOf(cur);
    // The offer path cut the trimmed body to `max` characters and the summary was trimmed
    // again, so a cut that ends on a space or a new line loses that space: trim the cut
    // slice the same way before comparing (unit GL review, GL-1).
    const same = body != null && (body === s || (wasCut === true && body.slice(0, max).trim() === s));
    out[name] = same ? /** @type {string} */ (hashOf(cur)) : textHash(s);
  };
  one("01-avatar.md", p.avatarSummary, cut.avatar, AVATAR_MAX_CHARS);
  one("02-ad-research.md", p.adResearchSummary, cut.adResearch, RESEARCH_MAX_CHARS);
  return out;
}

/** The run's gate counts, whole numbers only. */
function countsOf(result) {
  const c = result && result.counts && typeof result.counts === "object" ? result.counts : {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of ["priceSet", "bonuses", "valueEquationScores", "guarantees"]) {
    if (Number.isInteger(c[k])) out[k] = c[k];
  }
  return out;
}

/** Does this offer run hold a whole offer document? */
export function hasOfferDocument(job) {
  return Boolean(job && job.result && typeof job.result.document === "string" && job.result.document.trim());
}

/**
 * offerStageFile({ job, files, now, staffId }) → { text, stageFile }
 * The whole 03-offer.md for one finished run, approved, one version above the file on
 * hand; stageFile is the record kept on the run so the same text can be built again.
 * @param {{job: any, files: Record<string, {text: string|null}>, now?: Date, staffId?: string|null}} args
 */
export function offerStageFile({ job, files, now = new Date(), staffId = null }) {
  if (!hasOfferDocument(job)) throw new TypeError("this offer run holds no offer document");
  const stageFile = {
    version: nextVersion(textOf(files, OFFER_FILE)),
    inputs: offerInputHashes(job.payload, files),
    counts: countsOf(job.result),
    approved_at: now.toISOString(),
    approved_by: staffId
  };
  return { text: offerFileFromStamp(job, stageFile), stageFile };
}

/**
 * The same text again from a run's saved record (result.stage_file), or null when the
 * run was never approved as step 3.
 * @param {any} job
 * @param {any} [stageFile]
 */
export function offerFileFromStamp(job, stageFile = job && job.result && job.result.stage_file) {
  if (!stageFile || typeof stageFile !== "object" || !hasOfferDocument(job)) return null;
  return stampStage({
    stage: OFFER_STAGE,
    version: Number(stageFile.version) || 1,
    status: "approved",
    inputs: stageFile.inputs || {},
    counts: stageFile.counts || {},
    extra: { job: String(job.id) },
    body: String(job.result.document)
  });
}

/**
 * offerWaiting({ job, fileText, written }) → null | { job_id, finished_at, replaces_file }
 * job: the newest offer run for the campaign (any state). written: true when an outbox
 * save under offerOpId(job.id) exists.
 * @param {{job: any, fileText: string|null, written: boolean}} args
 */
export function offerWaiting({ job, fileText, written }) {
  if (!job || job.kind !== "offer" || job.status !== "done" || !hasOfferDocument(job)) return null;
  if (written) return null;
  if (fileText != null && stampJob(fileText) === String(job.id)) return null;
  const at = job.finished_at instanceof Date ? job.finished_at.toISOString() : (job.finished_at || null);
  return { job_id: String(job.id), finished_at: at, replaces_file: fileText != null };
}

/** "Oct 6" in Arizona, or "" when there is no date. */
function shortDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric" });
}

/**
 * The offer row's words while a run waits for Approve.
 * @param {{finished_at: string|null, replaces_file: boolean}} waiting
 * @param {any} job
 */
export function waitingWords(waiting, job) {
  const day = shortDay(waiting.finished_at);
  const misses = (job && job.result && job.result.checks && job.result.checks.gate && Array.isArray(job.result.checks.gate.misses))
    ? job.result.checks.gate.misses : [];
  const parts = [
    `Done. A new offer is ready to read${day ? ` (written ${day})` : ""}.`,
    `Approve saves it as step 3${waiting.replaces_file ? " in place of the offer on file" : ""}.`
  ];
  if (misses.length) parts.push(`It does not clear the bar for the next step yet: ${String(misses[0]).replace(/\.$/, "")}.`);
  return { state_word: "Done", sentence: parts.join(" ") };
}

/** The review card of a run, as markdown, or null. */
export function jobReviewCard(job) {
  const r = job && job.result;
  const md = r && r.reviewCard && typeof r.reviewCard.markdown === "string" ? r.reviewCard.markdown.trim() : "";
  return md || null;
}

/** The run's document without its review card (the row's "Show more"), or null. */
export function jobDocument(job) {
  if (!hasOfferDocument(job)) return null;
  const doc = String(job.result.document);
  const at = doc.indexOf("## Review card");
  return (at === -1 ? doc : doc.slice(0, at)).trim() || null;
}

/* ── the database ─────────────────────────────────────────────────────────── */

/**
 * Was this run already written to 03-offer.md? (An outbox save under its op id.)
 * @param {{query: Function}} db
 * @param {{orgId: string, jobId: string}} args
 */
export async function offerWritten(db, { orgId, jobId }) {
  const r = await db.query(
    `SELECT 1 FROM repo_outbox WHERE org_id = $1 AND op_id = $2 LIMIT 1`,
    [orgId, offerOpId(jobId)]
  );
  return r.rows.length > 0;
}

/**
 * Keep the approved stamp on the run, inside the caller's transaction. Only a done
 * offer run of this company changes. Returns true when the row was updated.
 * @param {{query: Function}} tx
 * @param {{orgId: string, jobId: string, stageFile: object}} args
 */
export async function markOfferApproved(tx, { orgId, jobId, stageFile }) {
  const r = await tx.query(
    `UPDATE marketing_jobs
        SET result = result || jsonb_build_object('stage_file', $3::jsonb)
      WHERE id = $1 AND org_id = $2 AND kind = 'offer' AND status = 'done'
      RETURNING id`,
    [jobId, orgId, JSON.stringify(stageFile)]
  );
  return r.rows.length === 1;
}

/** The newest offer run of a campaign that Chris approved as step 3. */
export const APPROVED_OFFER_SQL = `
  SELECT id, kind, status, payload, result, finished_at
    FROM marketing_jobs
   WHERE org_id = $1 AND kind = 'offer' AND status = 'done'
     AND payload->>'campaign' = $2
     AND result ? 'stage_file'
   ORDER BY result->'stage_file'->>'approved_at' DESC NULLS LAST, finished_at DESC NULLS LAST
   LIMIT 1`;

/**
 * @param {{query: Function}} db
 * @param {{orgId: string, campaign: string}} args
 */
export async function newestApprovedOffer(db, { orgId, campaign }) {
  const r = await db.query(APPROVED_OFFER_SQL, [orgId, campaign]);
  return r.rows[0] || null;
}
