/* POST /api/journeys/run — walk every branch of every journey and report what
 * the code actually did.
 *
 * Owner/admin only, same gate as /api/journeys and /api/journeys/ask and for
 * the same reason: a run drives the real event bus into the real workflows.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WHOLE RUN HAPPENS INSIDE ONE TRANSACTION THAT IS ALWAYS ROLLED BACK
 *
 * This is the answer to "a synthetic client must never show up on the closer
 * dashboard next to a real one", and it is a stronger answer than filtering
 * every read path would be:
 *
 *   * nothing the run writes is ever visible to anything else — not the
 *     clients it mints, not the messages, not the tasks, not the events
 *   * it needs no deletes, which CLAUDE.md §11 reserves for the owner
 *   * it cannot be forgotten, because the rollback is in the `finally`
 *
 * The routing flip to the memory provider lives inside the same transaction,
 * so the org's real routing configuration is never modified — the UPDATE is
 * visible only to this run and dies with it.
 *
 * The synthetic marker still goes on every client. Belt and braces: the
 * transaction protects this path, the marker protects any other.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY IT WALKS THE SEEDED TREES WHEN THE TABLE IS EMPTY
 *
 * The journeys table has no SQL seed — a row appears only once someone opens
 * the editor and saves. Refusing to run on a fresh database would make the
 * harness useless exactly when it is most useful, so the runner falls back to
 * src/journeys/seed-journeys.mjs and SAYS SO in the response `source` field.
 * It never silently mixes the two.
 *
 * "Empty" now means "empty after the demo rows are filtered out" — see
 * loadJourneys below for the whole story of what those rows did to a run.
 */

import { db, pool } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";

import { run as walk } from "../../src/journeys/runner/index.mjs";
import { gather } from "../../src/journeys/runner/facts.mjs";
import { diff } from "../../src/journeys/runner/diff.mjs";
import { summary, headline, text } from "../../src/journeys/runner/report.mjs";
import { SEED_JOURNEYS } from "../../src/journeys/seed-journeys.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());

/* The six journeys the editor owns. Same list as api/journeys.mjs's KEYS, and
   it is the same list on purpose: a run is a test of what the editor can
   author. Anything else in the table came from somewhere else and the runner
   has no reading of how it starts. */
const EDITOR_KEYS = new Set(["client", "setter", "closer", "advisor", "affiliate", "partner"]);
const JOURNEY_AUTHOR_ROLES = new Set(["owner", "admin"]);

/* Journeys from the table, or the seeded fallback. Never a blend of the two:
   a half-real, half-example run would report on a journey nobody has.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILTERS, AND WHAT IT COST WHEN IT DID NOT
 *
 * This used to select EVERY row in the journeys table. Demo Mode seeds two
 * (src/demo/seed-ui-coverage.mjs — keys "demo-platform-nurture" and
 * "demo-platform-funding", flagged is_demo), and once those rows existed a run
 * did this:
 *
 *   1. Neither demo key is one the runner knows how to start, so no opening
 *      event was fired for either. Their nodes contain no payment step, and a
 *      payment step is the only kind that fires an event mid-walk. Zero events.
 *      Zero events means zero automations, and the screen reported
 *      "0 of 51 automations reached" — which reads as "every automation in the
 *      product is disconnected" and is not what happened at all.
 *   2. Worse, and this is the part that made it dangerous: because those two
 *      rows exist, the table was not empty, so the seeded-journeys fallback
 *      below never ran. THE SIX REAL JOURNEYS WERE NEVER TESTED. The report
 *      was of two demo rows, and nothing on it said so.
 *   3. Their steps use a different node shape entirely ({type:"wait", days:1},
 *      no cfg), which is where the report's 'wait unit "undefined"' rows came
 *      from. Removing the rows removes those findings at the source, which is
 *      the right place — the runner must never guess a missing unit.
 *
 * Excluded keys are RETURNED, not dropped quietly. A filter nobody can see is
 * the next version of this same bug.
 *
 * is_demo is NOT TRUE rather than = false on purpose: db/migrations/153 adds
 * the column with a default, but a row written before it landed can still be
 * null, and null = false is null, which excludes nothing. */
async function loadJourneys(client, orgId) {
  const { rows } = await client.query(
    `SELECT key, name, start_when, end_when, description, nodes, is_demo
       FROM journeys WHERE org_id = $1`,
    [orgId]
  );

  const journeys = {};
  const skipped = [];
  for (const r of rows) {
    if (r.is_demo === true) {
      skipped.push({ key: r.key, reason: "it is a Demo Mode example, not a real journey" });
      continue;
    }
    if (!EDITOR_KEYS.has(r.key)) {
      skipped.push({ key: r.key, reason: "the Journeys editor does not own this one, so nothing in the code knows how it starts" });
      continue;
    }
    journeys[r.key] = { name: r.name, start: r.start_when, end: r.end_when, desc: r.description, nodes: r.nodes || [] };
  }

  if (!Object.keys(journeys).length) {
    return { source: "seed", journeys: SEED_JOURNEYS, skipped };
  }
  return { source: "database", journeys, skipped };
}

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, JOURNEY_AUTHOR_ROLES)) return;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // FAIL CLOSED ON A SESSION WITH NO ORG. Every query below is org-scoped and
  // an unscoped run would mint clients into somebody else's tenant.
  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden", message: "this session has no organisation" });
  }

  const body = req.body || {};
  const only = typeof body.journey === "string" && body.journey.trim() ? body.journey.trim() : null;
  const format = body.format === "text" ? "text" : "json";
  const runId = `run-${Date.now().toString(36)}`;

  let client;
  try {
    client = await pool().connect();
  } catch (err) {
    return res.status(503).json({ ok: false, error: "db_unavailable", db: "down", message: safeError(err) });
  }

  try {
    await client.query("BEGIN");

    // The routing flip. Ticket 8's rule: the memory provider is selected ONLY
    // through message_channel_routing, never an env var or a test flag. Inside
    // the transaction, so the org's real configuration is untouched.
    await client.query(
      `UPDATE message_channel_routing SET provider = 'memory' WHERE org_id = $1`,
      [orgId]
    );

    const { source, journeys, skipped } = await loadJourneys(client, orgId);
    if (only && !journeys[only]) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "unknown_journey", allowed: Object.keys(journeys) });
    }

    const report = await walk(client, { journeys, orgId, runId, env: process.env, only });
    const facts = await gather(client, { orgId, env: process.env, journeys });
    const diffed = diff(only ? { [only]: journeys[only] } : journeys, facts, report);
    const s = summary(report, diffed);

    if (format === "text") {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      return res.status(200).send(text(report, diffed));
    }

    return res.status(200).json({
      ok: true,
      runId,
      journeySource: source,
      /* Rows in the table this run deliberately did NOT walk, and why. Sent to
         the browser so the exclusion is on screen — a filter the reader cannot
         see is how the demo rows silently replaced the real journeys in the
         first place. */
      journeysSkipped: skipped,
      /* Journeys nothing in the code can start, with the reason. Not the same
         thing as an automation that failed. */
      startEventFindings: report.startEventFindings || [],
      /* True when public/app could not be read at all, so the screen counts
         below are absent rather than zero. */
      screensUnreadable: Boolean(diffed.screensUnreadable),
      headline: headline(s),
      summary: s,
      paths: report.paths.map((p) => ({
        pathId: p.pathId,
        journeyKey: p.journeyKey,
        startEventStatus: p.startEventStatus,
        branches: p.branches,
        steps: p.steps,
        events: p.events.map((e) => ({ name: e.name, at: e.at, workflows: e.workflows.map((w) => w.id) })),
        workflowsFired: p.workflowsFired,
        messages: p.messages,
        /* messages[] is only what reached the sending step. The ledger is the
           rows that were written, split sent vs held — without it a path that
           the safety fence stopped looks identical to a path that sends
           nothing. Both of these travel, and both are rendered. */
        messageLedger: p.messageLedger,
        dispatched: p.dispatched,
        dispatchRefused: p.dispatchRefused,
        dispatchTruncated: p.dispatchTruncated,
        virtualElapsedMs: p.virtualElapsedMs,
        terminal: p.terminal,
        failure: p.failure
      }))
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "run_failed", message: safeError(err) });
  } finally {
    /* ALWAYS. Not conditional on success, not skipped on an early return —
       every exit from the block above passes through here. A committed journey
       run is a bug, so there is deliberately no code path that commits. */
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the connection is already broken; releasing it is what matters */
    }
    client.release();
  }
}
