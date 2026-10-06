// /api/marketing/rules — Chris's copy rules: Part 0 of marketing/ads/RULES.md,
// the phrases he banned, and his recent changes. He adds or edits a rule or bans
// a phrase from the Rules screen, never from a chat.
//
// Route key "marketing/rules" (netlify/functions/api.mjs ROUTES; the key is this
// file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md §7.8,
// §7.1, §8.1 tab 5. Shapes: docs/specs/marketing-machine-api.md §6.3 (plan unit U26).
//
//   GET   → 200 {rules_sha, part0:[{n, text}], banned:[string],
//                recent:[{op_id, action, text, state, committed_sha, at}], source}
//         Read from GitHub at one commit, else from the copy built into the
//         site (source 'bundle'; rules_sha = the deploy's commit, or null).
//         503 {error:'rules_unavailable', message}  neither copy could be read
//   POST  {request_id, action:'add'|'edit'|'ban', n?, text} → 202 {queued:true, op_id}
//         One outbox edit (part0_add_rule / part0_edit_rule / ban_phrase) in one
//         staff transaction, then the worker is woken. The change reaches the
//         repo when the outbox drains and shows under `recent`.
//         400 {error:'invalid', field, message}  bad action, n or text; an edit
//                                                of a rule Part 0 does not have
//         A repeated request_id answers the first 202 again and queues nothing.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12). The company is the session's.

import { randomUUID } from "node:crypto";
import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import {
  withRequest, staffRead, readBody, checkRequestId,
  sendKnownError, sendNotReady, hasCompany, InvalidError
} from "../../src/marketing/http.mjs";
import {
  readRuleFiles, parsePart0, parseBanned, recentRuleEdits, waitingPart0Edits,
  part0NumbersAfter, validateRuleInput, ruleEdit, rulePath, RulesUnavailableError
} from "../../src/marketing/rules-store.mjs";
import { enqueueRepoWrite } from "../../src/repo/outbox.mjs";
import { wakeWorker } from "../../src/marketing/wake.mjs";

export const ROUTE = "marketing/rules";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read the rules or POST to change one." });
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
    if (req.method === "GET") {
      // GitHub first (no transaction is open while it is read), then the outbox.
      const files = await readRuleFiles({ env, deps: deps.rules });
      const part0 = parsePart0(files.rules);
      const banned = parseBanned(files.banned);
      const recent = await staffRead(database, (tx) => recentRuleEdits(tx, orgId));
      return res.status(200).json({ rules_sha: files.rules_sha, part0, banned, recent, source: files.source });
    }

    // POST — check everything that needs no database first.
    const body = readBody(req);
    const requestId = checkRequestId(body.request_id);
    const change = validateRuleInput(body);
    const edit = ruleEdit(change.action, change);

    // An edit names a rule: it must be in Part 0 now, or added by a change
    // still waiting in the outbox. Read before the transaction (GitHub is a
    // network call and no transaction is held across one).
    if (change.action === "edit") {
      const files = await readRuleFiles({ env, deps: deps.rules });
      const waiting = await staffRead(database, (tx) => waitingPart0Edits(tx, orgId));
      if (!part0NumbersAfter(files.rules, waiting).has(change.n)) {
        throw new InvalidError("n", `Part 0 has no rule ${change.n}. Pick a rule from the list.`);
      }
    }

    const answer = await withRequest(database, { orgId, route: ROUTE, requestId }, async (tx) => {
      const queued = await enqueueRepoWrite(tx, {
        orgId, opId: randomUUID(), path: rulePath(change.action), mode: "edit", edit
      });
      return { queued: true, op_id: queued.op_id };
    });

    // After COMMIT: wake the worker so the outbox drains. Never throws.
    await (deps.wake ?? wakeWorker)(env);
    return res.status(202).json(answer);
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (err instanceof RulesUnavailableError) {
      return res.status(503).json({ error: "rules_unavailable", message: err.message });
    }
    if (sendNotReady(res, err, "The rules screen")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
