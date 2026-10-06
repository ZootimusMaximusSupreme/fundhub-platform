// POST /api/marketing/flywheel/run — the Run button on a flywheel row.
//
// Route key "marketing/flywheel/run" (netlify/functions/api.mjs ROUTES). Design
// docs/specs/command-center-design-2026-10-05.md §3.2 "Endpoints": POST
// marketing/flywheel/run {campaign, stage, request_id, ...} → 202 {ok, started,
// already_running, job, poll}.
//
// WAVE 2B MERGE GLUE. Units X1 (step 1, Build the avatar) and X2 (step 2, Research
// the market) each built this route for their own step. This file checks the gate
// once and hands each step to the unit that runs it; the step's own module answers
// exactly what that unit's route answered:
//   stage 1 → src/marketing/avatar/run-route.mjs        runAvatarStage  (unit X1)
//   stage 2 → src/marketing/research/market-run-route.mjs runMarketStage (unit X2)
// A step no unit runs yet is a 400 in plain words, never a silent no-op.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING), then a
// company on the session. The step module is handed the signed-in staff member, so
// the session is read once.

import { db } from "../../../src/db.mjs";
import { dbDown } from "../../../src/http/db-down.mjs";
import { requireAuth } from "../../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../../src/http/read-api.mjs";
import { readBody, sendKnownError, hasCompany, InvalidError } from "../../../src/marketing/http.mjs";
import { runAvatarStage } from "../../../src/marketing/avatar/run-route.mjs";
import { runMarketStage } from "../../../src/marketing/research/market-run-route.mjs";

export const ROUTE = "marketing/flywheel/run";

/** Which module runs each step. */
export const STAGE_HANDLERS = Object.freeze({ 1: runAvatarStage, 2: runMarketStage });

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use POST to run a flywheel step." });
  }

  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;

  try {
    const body = readBody(req);
    const stage = Number(body.stage);
    if (!Number.isInteger(stage) || stage < 1 || stage > 6) {
      throw new InvalidError("stage", "stage must be the step number, 1 to 6.");
    }
    const run = /** @type {any} */ (STAGE_HANDLERS)[stage];
    if (!run) {
      throw new InvalidError("stage", `Step ${stage} does not run from this button yet. Steps 1 and 2 do.`);
    }
    return await run(req, res, { ...deps, db: database, requireAuth: async () => staff });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
