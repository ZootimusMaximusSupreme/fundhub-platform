// Give a client their checklist. This is the thing that did not exist.
//
// MEASURED BEFORE THIS FILE WAS WRITTEN, 2026-09-06, on origin/main 8010b1b9:
// `client_waypoints` has existed since migration 330 and src/waypoints/store.mjs
// has had upsertWaypoint() the whole time, and a grep for every caller of it
// across the repository returned FOUR files — three test files and one manual
// check script under ops/workflows/wave-3-checks/. NOTHING IN THE PRODUCT HAS
// EVER WRITTEN A ROW. So no real client has a checklist, every portal read of
// the table returns the empty list, and any nudge loop built on top of it would
// have nothing to chase. Proved by running it too: enrolling a client on a
// scratch database with this call removed leaves client_waypoints empty.
//
// WHEN IT RUNS. Two callers, both best-effort:
//   1. src/repair/enroll.mjs — emits repair.enrolled and calls this beside it.
//   2. src/waypoints/purchase.mjs, from src/handlers/money-chain.mjs
//      grantForPurchase() — paying for the Capital Blueprint (owner rule,
//      Chris 2026-09-17: "paying for the blueprint should create the client
//      checklist"). Its backfill runs this for people who paid before that.
// Both call this same function, so there is one seeder to keep in step.
//
// IDEMPOTENT, THREE WAYS OVER:
//   1. client_waypoints has UNIQUE (client_id, key) and upsertWaypoint() is an
//      ON CONFLICT DO UPDATE, so the same key twice is one row.
//   2. That DO UPDATE deliberately does not touch `state` or `completed_at`, so
//      re-seeding never re-opens something the client already finished.
//   3. A paydown row is matched to its account by params, not by its key, so a
//      re-seed after the balances moved updates the card's existing waypoint
//      instead of adding a second one next to it. Existing due dates are kept
//      too — a re-seed must not quietly push a client's deadline forward.
//
// BEST-EFFORT AT THE CALL SITE, NOT HERE. This function throws on a real
// failure and enroll.mjs catches it, because by the time it runs the enrolment,
// the entitlement and the welcome email are already committed and a checklist
// that failed to build must not undo any of them.

import {
  buildBlackReportClient,
  hasBlackReportSource
} from "../underwrite/black-report-client.mjs";
import { personalFromClient } from "../underwrite/letter-pack.mjs";
import {
  loadWaypointDefinitions,
  expandDefinitions,
  revolvingAccounts,
  mergeByCreditor,
  withAccountPrints,
  isBlueprintOnlyDefinitionKey
} from "./definitions.mjs";
import { upsertWaypoint, completeWaypoint, WaypointError } from "./store.mjs";

/** The freshest real credit file for this client, or null.
 *  is_demo rows are excluded — the same filter src/progress/read.mjs:129 uses,
 *  because a demo file must never put a real paydown on a real client. */
export async function latestCreditFile(db, { orgId, clientId } = {}) {
  const r = await db.query(
    `SELECT id, created_at, result
       FROM crs_results
      WHERE client_id = $1::uuid AND org_id = $2::uuid
        AND is_demo IS NOT TRUE
      ORDER BY created_at DESC
      LIMIT 1`,
    [clientId, orgId]
  );
  return r.rows[0] || null;
}

/** The name and address fields personalFromClient() reads. Reused rather than
 *  re-derived — src/underwrite/letter-pack.mjs:92 already owns the rule for
 *  where a client's state lives in custom_fields. */
async function loadPersonal(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT first_name, last_name, custom_fields
       FROM clients WHERE id = $1::uuid AND org_id = $2::uuid`,
    [clientId, orgId]
  );
  return r.rows[0] ? personalFromClient(r.rows[0]) : null;
}

/** What this client already has, so a second run lands on the same rows.
 *
 *  FOUR INDEXES, and the second one is the one that stops a client being
 *  accused of something. `paydownPrints` maps a card's PRINT — the day it was
 *  opened plus the last four digits of its number — to the waypoint key that
 *  card already has. A bureau that rewrites "Credit One Bank" as "CREDIT ONE
 *  BANK N.A." changes the name and nothing else, so the name index misses and
 *  the print index hits. Without it a re-seed would open a second waypoint for
 *  a card that already has one. */
async function existingWaypoints(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT key, due_at, verify_kind, params, state
       FROM client_waypoints
      WHERE org_id = $1::uuid AND client_id = $2::uuid`,
    [orgId, clientId]
  );
  const paydownKeys = new Map();
  const paydownPrints = new Map();
  const dueAt = new Map();
  const params = new Map();
  const state = new Map();
  for (const row of r.rows || []) {
    dueAt.set(row.key, row.due_at);
    params.set(row.key, row.params || null);
    state.set(row.key, row.state);
    if (row.verify_kind === "paydown" && row.params) {
      const ck = row.params.creditor_key;
      if (ck) paydownKeys.set(ck, row.key);
      for (const print of Array.isArray(row.params.account_prints) ? row.params.account_prints : []) {
        if (print) paydownPrints.set(print, row.key);
      }
    }
  }
  return { paydownKeys, paydownPrints, dueAt, params, state };
}

/**
 * Seed (or re-seed) one client's checklist.
 *
 * @param {object} db
 * @param {object}  args
 * @param {string}  args.orgId
 * @param {string}  args.clientId
 * @param {Date}    [args.now]       the clock due dates count from
 * @param {object}  [args.crsResult] a credit file, when the caller already has
 *                                   one; otherwise the freshest stored one is
 *                                   read
 * @param {object}  [args.personal]  name/address, when the caller already has it
 * @param {boolean} [args.blueprintDisputeSteps=false]
 *        When true, include the Capital Blueprint-only rows: the DIY dispute
 *        rounds (migration 400) and the ChexSystems check (migration 574).
 *        Capital Blueprint purchase sets this; repair-only enroll does not.
 * @returns {Promise<{
 *   ok: true, seeded: string[], skipped: object[], completed: string[],
 *   creditFile: 'crs_result'|'none', accounts: number, definitions: number
 * }>}
 */
export async function seedClientWaypoints(db, {
  orgId,
  clientId,
  now = new Date(),
  crsResult = undefined,
  personal = undefined,
  blueprintDisputeSteps = false
} = {}) {
  if (!db?.query) throw new WaypointError("db required", { status: 500, code: "db_required" });
  if (!orgId || !clientId) throw new WaypointError("orgId and clientId are required");

  let definitions = await loadWaypointDefinitions(db);
  if (!blueprintDisputeSteps) {
    definitions = definitions.filter((d) => !isBlueprintOnlyDefinitionKey(d.key));
  }

  /* An empty catalog is a real answer and not an error: somebody has turned
     every task off, or migration 362 has not been applied to this database. It
     seeds nothing and says so, rather than falling back to a hardcoded list —
     a hidden fallback list is exactly what the table exists to stop. */
  if (!definitions.length) {
    return {
      ok: true, seeded: [], skipped: [], completed: [],
      creditFile: "none", accounts: 0, definitions: 0
    };
  }

  let file = crsResult;
  if (file === undefined) {
    const row = await latestCreditFile(db, { orgId, clientId });
    file = row ? row.result : null;
  }
  /* hasBlackReportSource() is the existing answer to "is there enough in this
     row to read scores and tradelines off it". A row that fails it is treated
     as no file at all, which keeps the no-new-credit baseline NULL instead of
     an empty list that would later read every card as newly opened. */
  const usable = file && hasBlackReportSource(file) ? file : null;

  let who = personal;
  if (who === undefined) who = await loadPersonal(db, { orgId, clientId });

  const built = buildBlackReportClient({ crsResult: usable, personal: who || null });
  /* Merged to ONE ENTRY PER CARD before anything else looks at it. A tri-merge
     lists the same card once per bureau and a checklist must not. */
  /* withAccountPrints() reads the opened date and the last four digits straight
     off the raw file, because buildBlackReportClient()'s seven display columns
     do not carry either one. That is what lets a card be recognised later when
     the bureau has rewritten the creditor's name. */
  const accounts = withAccountPrints(mergeByCreditor(revolvingAccounts(built.revolving)), usable);
  const existing = await existingWaypoints(db, { orgId, clientId });

  const { waypoints, skipped, complete } = expandDefinitions({
    definitions,
    accounts,
    state: built.state,
    enrolledAt: now,
    hasCreditFile: !!usable,
    existingPaydownKeys: existing.paydownKeys,
    existingDueAt: existing.dueAt,
    existingPaydownPrints: existing.paydownPrints,
    existingParams: existing.params,
    existingState: existing.state
  });

  const seeded = [];
  for (const w of waypoints) {
    await upsertWaypoint(db, {
      orgId,
      clientId,
      key: w.key,
      title: w.title,
      detail: w.detail,
      position: w.position,
      ownerKind: w.ownerKind,
      dueAt: w.dueAt,
      verifyKind: w.verifyKind,
      params: w.params,
      paidAlternativePriceCents: w.paidAlternativePriceCents,
      paidAlternativeLabel: w.paidAlternativeLabel,
      paidAlternativeKind: w.paidAlternativeKind
    });
    seeded.push(w.key);
  }

  /* CLOSE WHAT THE FILE SAYS IS FINISHED, after the upsert and not instead of
     it. The upsert above refreshed the row's target and balance from the fresh
     pull; this closes it. Doing it in that order is why a client never sees a
     finished card still asking for a number that stopped being true months ago.
     completeWaypoint() writes state and completed_at together because a CHECK in
     the database refuses them apart. */
  const completed = [];
  for (const c of complete) {
    await completeWaypoint(db, { orgId, clientId, key: c.key, at: now });
    completed.push(c.key);
  }

  return {
    ok: true,
    seeded,
    skipped,
    completed,
    creditFile: usable ? "crs_result" : "none",
    accounts: accounts.length,
    definitions: definitions.length
  };
}
