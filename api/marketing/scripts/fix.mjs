// /api/marketing/scripts/fix — Chris's Fix button on a script card: "rewrite it
// from my note", with an optional "Make this a rule" box.
//
// Route key "marketing/scripts/fix" (netlify/functions/api.mjs ROUTES; the key is
// this file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md
// §7.8 (fix row). Shape: docs/specs/marketing-machine-api.md §6.3 (plan unit U26).
//
//   POST {request_id, id, version, note, make_rule} → 202 {queued:true, job_id}
//        In ONE staff transaction: one 'fix_script' job {script_id, version, note}
//        (plan unit U24 runs it: the writer rewrites from the note and saves a
//        new version), and — when make_rule is true — one outbox edit that adds
//        the note to Part 0 of RULES.md (part0_add_rule). Then the worker is woken.
//        The note goes to the writer exactly as Chris typed it.
//        400 {error:'invalid', field}  note empty or too long, make_rule not
//                                      true or false, id or version missing
//        404 {error:'not_found'}       no script with that id in this company
//        409 {error:'stale', current:{version, body, parts}}  version is not the
//                                      live version (someone saved a newer one)
//        A repeated request_id answers the first 202 again and queues nothing.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). The company is the session's.
// ad_scripts forces partner row security, so every read runs in the staff
// transaction withRequest opens.

import { randomUUID } from "node:crypto";
import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../../src/http/read-api.mjs";
import {
  withRequest, readBody, checkRequestId, sendKnownError, sendNotReady, hasCompany,
  InvalidError, NotFoundError, StaleError
} from "../../../src/marketing/http.mjs";
import { enqueueJob } from "../../../src/marketing/jobs.mjs";
import { ruleEdit, rulePath, MAX_RULE_CHARS } from "../../../src/marketing/rules-store.mjs";
import { enqueueRepoWrite } from "../../../src/repo/outbox.mjs";
import { wakeWorker } from "../../../src/marketing/wake.mjs";

export const ROUTE = "marketing/scripts/fix";

/** The job plan unit U24 handles. */
export const FIX_SCRIPT_KIND = "fix_script";

/** Longest note. The writer reads it word for word; a page of notes is still fine. */
export const MAX_NOTE_CHARS = 4000;

/** The fields of a fix, checked (no lookups). Throws InvalidError. */
export function validateFixInput(body) {
  const b = body || {};
  if (!isUuid(b.id)) throw new InvalidError("id", "Which script? Send the id of the version you are looking at.");
  if (typeof b.version !== "number" || !Number.isInteger(b.version) || b.version < 1) {
    throw new InvalidError("version", "Send the version number of the script you are looking at.");
  }
  if (typeof b.note !== "string" || !b.note.trim()) {
    throw new InvalidError("note", "Say what to fix first. The note is empty.");
  }
  if (b.note.length > MAX_NOTE_CHARS) {
    throw new InvalidError("note", `The note is too long (over ${MAX_NOTE_CHARS.toLocaleString("en-US")} characters). Keep it to what needs fixing.`);
  }
  if (typeof b.make_rule !== "boolean") {
    throw new InvalidError("make_rule", "make_rule must be true or false.");
  }
  const oneLine = b.note.replace(/\s+/g, " ").trim();
  if (b.make_rule && oneLine.length > MAX_RULE_CHARS) {
    throw new InvalidError("note", `A note saved as a rule can be at most ${MAX_RULE_CHARS} characters. Shorten it, or untick "Make this a rule".`);
  }
  return { id: b.id.trim().toLowerCase(), version: b.version, note: b.note, makeRule: b.make_rule, ruleText: oneLine };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to ask for a rewrite." });
  }

  // The gate, in this file on purpose: scripts/journeys/extract.mjs reads each
  // route's gate from the route's own source (src/marketing/http.mjs
  // gateMarketing does the same three steps).
  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    const fix = validateFixInput(body);
    const edit = fix.makeRule ? ruleEdit("add", { text: fix.ruleText }) : null;

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const script = (await tx.query(
        `SELECT id, root_script_id, version, archived_at FROM ad_scripts WHERE id = $1 AND org_id = $2`,
        [fix.id, orgId]
      )).rows[0];
      if (!script) throw new NotFoundError("That script was not found.");

      // The live version of this script: the one row of its root not archived.
      const live = (await tx.query(
        `SELECT id, version, body, parts FROM ad_scripts
          WHERE root_script_id = $1 AND org_id = $2 AND archived_at IS NULL`,
        [script.root_script_id, orgId]
      )).rows[0];
      if (!live) throw new NotFoundError("That script was retired. There is no live version to fix.");
      if (live.id !== script.id || Number(live.version) !== fix.version) {
        throw new StaleError({ version: Number(live.version), body: live.body, parts: live.parts ?? null });
      }

      const job = await enqueueJob(tx, {
        orgId,
        kind: FIX_SCRIPT_KIND,
        payload: { script_id: live.id, version: fix.version, note: fix.note }
      });
      if (edit) {
        await enqueueRepoWrite(tx, { orgId, opId: randomUUID(), path: rulePath("add"), mode: "edit", edit });
      }
      return { queued: true, job_id: job.id };
    });

    // After COMMIT: wake the worker so the rewrite (and the rule) run now. Never throws.
    await (deps.wake ?? wakeWorker)(env);
    return res.status(202).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (sendNotReady(res, err, "Fix")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
