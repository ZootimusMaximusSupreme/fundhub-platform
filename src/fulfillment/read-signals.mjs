/* Fulfillment — THE READ LAYER for src/fulfillment/next-action.mjs.
 *
 * READ ONLY. Every statement in this file is a SELECT. There is no INSERT,
 * UPDATE or DELETE, no migration, no new table and no new column. Nothing here
 * transmits.
 *
 * next-action.mjs decides; this gathers. The split is deliberate — the decider
 * is pure and testable without a database, and the SAME gathered signals feed
 * the client control panel (api/dashboard/client.mjs) and the client list
 * (api/dashboard/clients.mjs) so the two screens cannot show one client two
 * different answers.
 *
 * Phase 0 mapping and the file:line evidence for every signal:
 *   ops/workflows/fulfillment-layer-2026-08-19.md
 *
 *
 * ONE PASS, NEVER A LOOP.
 *
 * The list endpoint asks for a page of up to 500 clients. Every read below
 * takes `clientIds` and answers for the whole page in ONE statement
 * (`client_id = ANY($2::uuid[])`). Nothing in this file runs a query per
 * client, and nothing may be added that does.
 *
 *
 * WHY THESE ARE SEPARATE STATEMENTS AND NOT JOINS ON THE LIST'S OWN SQL.
 *
 * Two of the tables read here arrived late — inquiry_removal_cases in
 * db/migrations/140 and dispute_cases / dispute_responses in 160. Folding them
 * into the list endpoint's main query means a database missing either
 * migration answers the whole client list with a 500 and the screen goes
 * blank. api/dashboard/client.mjs already wraps its inquiry-case read in its
 * own try/catch for exactly this reason ("Table may be absent before migration
 * — never break the dashboard"). So each read stands alone, they all run in
 * parallel, and one of them failing costs one signal, never the screen.
 *
 *
 * DEGRADE HONESTLY, NEVER GUESS.
 *
 * A read that fails answers `null` / `undefined`, not a default. next-action.mjs
 * treats a missing REQUIRED signal as degraded (next_action: null, so the
 * screen falls back to today's display) and a missing OPTIONAL signal as
 * "none". Turning "we could not look" into "there is nothing there" is Phase 0
 * defect 7 and it is not repeated here.
 */

import { CONSENT_REASONS, CONSENT_VALID_SQL } from "../consent/index.mjs";
import { FUNDING_TIERS } from "../config/product-path.mjs";
import { checkDocPacket } from "../inquiry-ops/doc-gate.mjs";
import { openBlockers } from "../http/client-detail.mjs";

/** The consent kind the credit pull is gated on. Same string
 *  src/finance/soft-pulls.mjs:306-314 passes to consentStatus(). */
export const SOFT_PULL_KIND = "soft_pull_consent";

/** Inquiry-removal case states that count as "still being worked".
 *  Same five as src/inquiry-ops/cases.mjs:14 (`ACTIVE`). */
const ACTIVE_INQUIRY_STATES = ["Queued", "Scheduled", "In Progress", "Escalated", "Blocked"];

/** The one funding board a card can sit on for "Prepare Next Round".
 *  db/seed/002_pipelines.sql:35. */
const CARD_STACKING_PIPELINE = "funding_card_stacking";

/* ── plumbing ─────────────────────────────────────────────────────────────── */

function idList(clientIds) {
  const seen = new Set();
  for (const id of Array.isArray(clientIds) ? clientIds : []) {
    if (typeof id === "string" && id.trim() !== "") seen.add(id.trim());
  }
  return [...seen];
}

/** Bucket rows by client_id. Rows arrive in the query's ORDER BY, and push
 *  preserves it, so "newest first" survives into the bucket. */
function byClient(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = r && r.client_id != null ? String(r.client_id) : null;
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  return out;
}

/** Run a read that is allowed to fail. A missing table, a permission refusal or
 *  a syntax drift costs this one signal and nothing else. */
async function safeRows(db, sql, params, label) {
  try {
    const r = await db.query(sql, params);
    return r && Array.isArray(r.rows) ? r.rows : [];
  } catch (err) {
    console.warn(`[fulfillment] signal read failed (${label}):`, err && err.message);
    return null;
  }
}

/* ── consent ──────────────────────────────────────────────────────────────────
   GATE A's evidence. next-action.mjs will not offer "Pull CRS" without a
   consent verdict that is KNOWN VALID, and it refuses to read a missing
   verdict as "no".

   THE VALIDITY RULE IS NOT COPIED HERE. `CONSENT_VALID_SQL` is the exact
   predicate src/consent/index.mjs evaluates for consentStatus(), imported so
   there is one copy of it in the repository. Its own header says why: "a second
   copy that drifts by one boundary condition is the defect class this repo
   keeps finding, and here it would drift in the direction of allowing a credit
   pull." The ORDER BY below mirrors consentStatus()'s — valid rows first, then
   newest — so the row this picks is the row that function would pick.

   The detail endpoint does not use this. It calls consentStatus() itself, one
   client, one query. This exists only because a list of 500 clients cannot call
   it 500 times. */
function consentSql() {
  return `
    SELECT DISTINCT ON (client_id)
           client_id,
           (${CONSENT_VALID_SQL}) AS is_valid,
           revoked_at,
           granted_at
      FROM client_consents
     WHERE org_id = $1::uuid
       AND client_id = ANY($2::uuid[])
       AND kind = $3
     ORDER BY client_id, (${CONSENT_VALID_SQL}) DESC, granted_at DESC, id DESC`;
}

/** Turn one client_consents row into the { valid, reason, consent } object
 *  next-action.mjs expects — the same shape consentStatus() returns.
 *
 *  The reason precedence mirrors consentStatus()'s tail (src/consent/index.mjs):
 *  revoked beats not-yet beats expired, because revoked is the fact the
 *  consumer acted on and the one they would expect to be told. The strings
 *  themselves are imported, not retyped. */
export function consentSignalFromRow(row, now = new Date()) {
  if (!row) return { valid: false, reason: CONSENT_REASONS.NONE, consent: null };
  if (row.is_valid === true) return { valid: true, reason: CONSENT_REASONS.OK, consent: null };
  let reason = CONSENT_REASONS.EXPIRED;
  if (row.revoked_at) reason = CONSENT_REASONS.REVOKED;
  else if (row.granted_at && new Date(row.granted_at) > now) reason = CONSENT_REASONS.NOT_YET;
  return { valid: false, reason, consent: null };
}

/* ── the reads ────────────────────────────────────────────────────────────── */

/* A DEMO ROW IS NOT A REAL ROW, IN EVERY READ BELOW — NOT ONLY THE CREDIT ONE.
   The credit read has always excluded is_demo. The rest did not, so with Demo
   Mode OFF a demo task still inflated "Action Needed" and painted a blocker
   pill on a real client, and a demo funding round still drove a funding chip.
   One clause, the same clause, on every table that carries the column:

     crs_results           db/migrations/148_demo_mode.sql:20
     funding_rounds        148:7
     cards                 148:18
     inquiry_removal_cases 148:15
     tasks                 db/migrations/153_demo_ui_coverage.sql:2
     documents             153:3

   TWO ARE NOT FILTERED, BECAUSE THERE IS NOTHING TO FILTER ON. dispute_cases
   and dispute_responses (db/migrations/160_metro2_dispute_engine.sql) never got
   an is_demo column, and v_invoice_balance is a view (031_invoices.sql:445)
   that does not carry invoices.is_demo through. Either one needs a migration,
   and this layer does not write schema. Recorded here rather than left silent.

   UNCONDITIONAL, exactly as the credit read has always been. Demo Mode decides
   which CLIENTS a screen shows; it is not a reason for a demo row to count as
   a real one underneath a real client. */

/* REAL credit pulls. crs_results carries is_demo (db/migrations/148:20) and a
   demo row is not a real pull. Phase 0 found api/dashboard/clients.mjs:33's
   crs_count has NO is_demo filter, so it counts demo rows as real. That bug is
   Chris's for a later batch and is left alone — this is a separate count that
   does the filtering, and the derivation reads this one. */
const REAL_CRS_SQL = `
  SELECT client_id, COUNT(*)::int AS n
    FROM crs_results
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND COALESCE(is_demo, false) = false
   GROUP BY client_id`;

/* Rows the control panel would paint as scores — including a planted sample.
   Demo rows still do not count as a live bureau pull (REAL_CRS_SQL above). */
const PAINTED_CRS_SQL = `
  SELECT client_id, result, created_at
    FROM crs_results
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])`;

const ACTIVE_INQUIRY_SQL = `
  SELECT client_id, case_status::text AS case_status, fraud_alert_after
    FROM inquiry_removal_cases
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND case_status::text = ANY($3::text[])
     AND COALESCE(is_demo, false) = false
   ORDER BY requested_at DESC`;

/* The identity packet, evaluated by src/inquiry-ops/doc-gate.mjs. Only the two
   columns checkDocPacket() reads are lifted, and only live documents count —
   the same `expires_at` filter loadClientDocuments() applies. */
const DOCUMENTS_SQL = `
  SELECT client_id, kind, subtype
    FROM documents
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND COALESCE(is_demo, false) = false
     AND (expires_at IS NULL OR expires_at > now())`;

const DISPUTE_RESPONSES_SQL = `
  SELECT client_id, confirmed
    FROM dispute_responses
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND confirmed = false`;

const DISPUTE_CASES_SQL = `
  SELECT client_id, status, response_due_at
    FROM dispute_cases
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND status = 'awaiting_response'`;

/* Repair letter counts — same statuses src/repair/cases.mjs LIST_SQL uses.
   No is_demo column on dispute_letters (160_metro2_dispute_engine.sql). */
const REPAIR_LETTERS_SQL = `
  SELECT client_id,
         COUNT(*) FILTER (WHERE status IN ('generated', 'ready'))::int AS letters_ready,
         COUNT(*) FILTER (WHERE status IN ('sent', 'delivered'))::int AS letters_sent
    FROM dispute_letters
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
   GROUP BY client_id`;

/* The funding card. "Prepare Next Round" fires when it sits on the Approved
   stage of the card-stacking board. cards stores ids, so the two keys the
   derivation compares come from a join, not from the card row. */
const CARD_SQL = `
  SELECT ca.client_id, p.key AS pipeline_key, ps.key AS stage_key
    FROM cards ca
    JOIN pipelines p        ON p.id  = ca.pipeline_id
    JOIN pipeline_stages ps ON ps.id = ca.stage_id
   WHERE ca.org_id = $1::uuid
     AND ca.client_id = ANY($2::uuid[])
     AND p.key = $3
     AND COALESCE(ca.is_demo, false) = false
   ORDER BY ca.updated_at DESC`;

/* The three inputs openBlockers() (src/http/client-detail.mjs:169-215) takes
   beyond the client row. The list endpoint does not load any of them, and
   without them "Ready to Fund" — whose whole test is "no active blockers" —
   would fire on the list for a client the control panel says is blocked. Two
   screens disagreeing about one client is the failure this read prevents. */
const OPEN_TASKS_SQL = `
  SELECT client_id, id, title, assignee_role, source_workflow, done
    FROM tasks
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND done = false
     AND COALESCE(is_demo, false) = false
   ORDER BY created_at DESC`;

/* created_at rides along so the screen can say HOW LONG this round has been
   open. Without it, a round waiting since June and one opened this morning read
   identically — see summariseRound() in next-action.mjs, which is the only
   thing that reads it. It is a timestamp on a row we already select; no extra
   query, no extra join. */
const ROUNDS_SQL = `
  SELECT client_id, id, round_number, status, hold_reason, approved_amount, created_at
    FROM funding_rounds
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND COALESCE(is_demo, false) = false
   ORDER BY round_number DESC`;

// A void or written-off bill owes nothing, whatever its raw balance_due says
// (see CLIENT_INVOICES_SQL in ./client-step.mjs).
export const BALANCES_SQL = `
  SELECT client_id, invoice_id AS id, currency, balance_due, due_at
    FROM v_invoice_balance
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND status NOT IN ('void', 'written_off')
     AND balance_due > 0`;

const OPEN_PAYMENT_LINK_STATUSES = Object.freeze(["created", "sent"]);

const PAYMENT_LINKS_SQL = `
  SELECT client_id, id, purpose, description, amount_cents, status, paid_at
    FROM payment_links
   WHERE org_id = $1::uuid
     AND client_id = ANY($2::uuid[])
     AND status = ANY($3::text[])
     AND paid_at IS NULL
     AND COALESCE(is_demo, false) = false`;

/**
 * gatherListSignals — every derivation signal for a whole page of clients, in
 * one round of parallel reads. Returns a Map keyed by client id.
 *
 * The caller supplies the client row itself (tags, custom_fields,
 * outcome_tier), which the list's own SQL already has in hand.
 *
 * @returns {Promise<Map<string, object>>} id → the optional half of `signals`
 */
export async function gatherListSignals(db, { orgId, clientIds } = {}) {
  const ids = idList(clientIds);
  const out = new Map();
  if (!orgId || ids.length === 0) return out;

  const args = [orgId, ids];
  const [
    consentRows, crsRows, inquiryRows, docRows,
    respRows, caseRows, letterRows, cardRows, taskRows, roundRows, balanceRows,
    linkRows, paintedCrsRows
  ] = await Promise.all([
    safeRows(db, consentSql(), [orgId, ids, SOFT_PULL_KIND], "consent"),
    safeRows(db, REAL_CRS_SQL, args, "crs_results"),
    safeRows(db, ACTIVE_INQUIRY_SQL, [orgId, ids, ACTIVE_INQUIRY_STATES], "inquiry_removal_cases"),
    safeRows(db, DOCUMENTS_SQL, args, "documents"),
    safeRows(db, DISPUTE_RESPONSES_SQL, args, "dispute_responses"),
    safeRows(db, DISPUTE_CASES_SQL, args, "dispute_cases"),
    safeRows(db, REPAIR_LETTERS_SQL, args, "dispute_letters"),
    safeRows(db, CARD_SQL, [orgId, ids, CARD_STACKING_PIPELINE], "cards"),
    safeRows(db, OPEN_TASKS_SQL, args, "tasks"),
    safeRows(db, ROUNDS_SQL, args, "funding_rounds"),
    safeRows(db, BALANCES_SQL, args, "v_invoice_balance"),
    safeRows(db, PAYMENT_LINKS_SQL, [orgId, ids, OPEN_PAYMENT_LINK_STATUSES], "payment_links"),
    safeRows(db, PAINTED_CRS_SQL, args, "crs_results_painted")
  ]);

  const consentBy = byClient(consentRows);
  const crsBy = byClient(crsRows);
  const inquiryBy = byClient(inquiryRows);
  const docsBy = byClient(docRows);
  const respBy = byClient(respRows);
  const caseBy = byClient(caseRows);
  const letterBy = byClient(letterRows);
  const cardBy = byClient(cardRows);
  const taskBy = byClient(taskRows);
  const roundBy = byClient(roundRows);
  const balanceBy = byClient(balanceRows);
  const linkBy = byClient(linkRows);
  const paintedCrsBy = byClient(paintedCrsRows);
  const now = new Date();

  for (const id of ids) {
    const signals = {};

    /* REQUIRED. A failed consent read leaves `consent` undefined on purpose:
       next-action.mjs degrades rather than reading silence as "no permission
       needed". */
    if (consentRows !== null) {
      signals.consent = consentSignalFromRow((consentBy.get(id) || [])[0], now);
    }
    /* REQUIRED. Same rule — a failed read leaves the count off entirely. */
    if (crsRows !== null) {
      const row = (crsBy.get(id) || [])[0];
      signals.real_crs_result_count = row ? Number(row.n) : 0;
    }

    if (inquiryRows !== null) signals.inquiry_cases = inquiryBy.get(id) || [];
    if (docRows !== null) signals.doc_packet = checkDocPacket(docsBy.get(id) || []);
    if (respRows !== null) signals.dispute_responses = respBy.get(id) || [];
    if (caseRows !== null) signals.dispute_cases = caseBy.get(id) || [];
    if (letterRows !== null) {
      const row = (letterBy.get(id) || [])[0];
      signals.repair_letters = {
        letters_ready: row ? Number(row.letters_ready) : 0,
        letters_sent: row ? Number(row.letters_sent) : 0
      };
    }
    if (cardRows !== null) signals.card = (cardBy.get(id) || [])[0] || null;
    if (taskRows !== null) signals.tasks = taskBy.get(id) || [];
    if (roundRows !== null) signals.funding_rounds = roundBy.get(id) || [];
    if (linkRows !== null) signals.payment_links = linkBy.get(id) || [];

    /* openBlockers() (src/http/client-detail.mjs:169-215) is REUSED, not
       rebuilt — the same function the control panel already paints. It also
       reads two custom_fields gates, and the raw blob lives on the client row,
       so the call itself is made in signalsForListRow() below. These are its
       three row inputs, carried over only when ALL THREE were read: a partial
       blocker list understates what is stopping the file, and "Ready to Fund"
       is decided by the length of it. */
    if (taskRows !== null && roundRows !== null && balanceRows !== null) {
      signals.blocker_inputs = {
        tasks: taskBy.get(id) || [],
        fundingRounds: roundBy.get(id) || [],
        invoices: balanceBy.get(id) || [],
        crsResults: paintedCrsRows === null ? undefined : (paintedCrsBy.get(id) || [])
      };
    } else {
      /* A FAILED BLOCKER READ IS NOT "NOTHING IS BLOCKING THIS FILE".
         Dropping the inputs silently left the blocker list EMPTY, and an empty
         blocker list is the entire condition for "Ready to Fund" — so one
         unreadable table turned into a chip saying the file is clear to fund.
         Nothing was marked degraded, so no screen could tell the difference.
         This flag is the difference: next-action.mjs answers UNKNOWN for that
         chip and marks the whole answer degraded, which sends the screen back
         to today's display instead of a claim nobody measured. */
      signals.blockers_unknown = true;
    }

    signals.now = now;
    out.set(id, signals);
  }

  return out;
}

/**
 * signalsForListRow — glue one row of api/dashboard/clients.mjs's own SQL onto
 * the batched signals. Takes the row EXACTLY as that query returns it.
 *
 * IT READS `custom_fields_raw` AND `tags_raw`, THE TWO COLUMNS THAT QUERY LIFTS
 * UNTOUCHED — never the response's mapped `custom_fields` object. That mapper
 * coerces a missing crs_paid to `false` (Phase 0 defect 7), which turns "we do
 * not know" into "no". Chris's house rule is that a blank must survive, and
 * next-action.mjs depends on it: `crs_paid !== true` is a NO, but a missing
 * custom_fields object is a DEGRADE, and the two must not be confused.
 *
 * openBlockers()' two custom_fields gates (crs_paid === false, and a closed sale
 * with no deposit) are only decidable with the raw blob, so the openBlockers()
 * call is made here rather than in the batch above.
 */
export function signalsForListRow(row, batched) {
  const signals = { ...(batched || {}) };
  const customFields = row ? row.custom_fields_raw : undefined;
  signals.custom_fields = customFields;
  signals.tags = row ? row.tags_raw : undefined;
  signals.outcome_tier = row ? row.outcome_tier : null;

  const inputs = signals.blocker_inputs;
  delete signals.blocker_inputs;
  if (inputs) {
    signals.open_blockers = openBlockers({
      client: { custom_fields: customFields },
      tasks: inputs.tasks,
      fundingRounds: inputs.fundingRounds,
      invoices: inputs.invoices,
      crsResults: inputs.crsResults
    });
  }
  return signals;
}

/**
 * gatherDetailSignals — the handful of signals api/dashboard/client.mjs does
 * NOT already hold. Everything else on that endpoint (custom_fields, tags,
 * tasks, funding_rounds, the active inquiry case, open_blockers) is already
 * loaded and is passed straight through by the caller.
 *
 * consentStatus() is called directly here — one client, one query, the exact
 * function the pull endpoint's own gate calls.
 */
export async function gatherDetailSignals(db, { orgId, clientId, consentStatus } = {}) {
  if (!orgId || !clientId) return {};
  const ids = [clientId];
  const args = [orgId, ids];
  const out = {};

  const [consent, crsRows, docRows, respRows, caseRows, letterRows, cardRows, linkRows] = await Promise.all([
    (async () => {
      try {
        return await consentStatus(db, { orgId, clientId, kind: SOFT_PULL_KIND });
      } catch (err) {
        console.warn("[fulfillment] signal read failed (consent):", err && err.message);
        return null;
      }
    })(),
    safeRows(db, REAL_CRS_SQL, args, "crs_results"),
    safeRows(db, DOCUMENTS_SQL, args, "documents"),
    safeRows(db, DISPUTE_RESPONSES_SQL, args, "dispute_responses"),
    safeRows(db, DISPUTE_CASES_SQL, args, "dispute_cases"),
    safeRows(db, REPAIR_LETTERS_SQL, args, "dispute_letters"),
    safeRows(db, CARD_SQL, [orgId, ids, CARD_STACKING_PIPELINE], "cards"),
    safeRows(db, PAYMENT_LINKS_SQL, [orgId, ids, OPEN_PAYMENT_LINK_STATUSES], "payment_links")
  ]);

  // Left absent, never defaulted, when the read failed. See the header.
  if (consent) out.consent = consent;
  if (crsRows !== null) out.real_crs_result_count = crsRows[0] ? Number(crsRows[0].n) : 0;
  if (docRows !== null) out.doc_packet = checkDocPacket(docRows);
  if (respRows !== null) out.dispute_responses = respRows;
  if (caseRows !== null) out.dispute_cases = caseRows;
  if (letterRows !== null) {
    const row = letterRows[0];
    out.repair_letters = {
      letters_ready: row ? Number(row.letters_ready) : 0,
      letters_sent: row ? Number(row.letters_sent) : 0
    };
  }
  if (cardRows !== null) out.card = cardRows[0] || null;
  if (linkRows !== null) out.payment_links = linkRows;

  return out;
}

/* ── the six rollups ──────────────────────────────────────────────────────────
   Counted in SQL over the SAME filtered population the list draws from — the
   caller's org, and demo clients excluded unless the org has Demo Mode on. The
   list's LIMIT is deliberately NOT applied: a tile that said "12 clients"
   because the page showed 12 would be a lie about the book.

   ONE OF THE SIX IS ALWAYS null, AND THAT IS THE ANSWER, NOT A GAP (Phase 0 §5):

     ready           Nothing in this system writes a status called "Ready" and
                     no definition exists. Zero would read as "nobody is ready",
                     which is a claim. null is the truth: nothing was recorded.

   total_approved WAS the second one, hard-wired to null because funding_rounds
   had no real rows. It has them now: the 2026-09-17 live walk put two funded
   rounds on Sim Eight-Funding, one carrying a $10,000 bank yes, while this tile
   still said "No bank approval has ever been recorded" (hole 8). So it is now
   counted from the honest source Phase 0 named — funding_rounds.approved_amount,
   which migration 382's trigger keeps equal to the CONFIRMED approvals on the
   round. Phase 0's warning still stands: the "Total Approved" column on
   funding_closeout is NOT this number (its own comment says it is a fee basis).

     * A DEMO ROUND is never counted, same as ROUNDS_SQL above.
     * GATE B at the number level: only clients on one of the three funding
       tiers (FUNDING_TIERS, passed in as $4 — the same list isFundingPath()
       reads). A row on any other tier is refused its round and approved amount
       by deriveNextAction(); the tile may not add up what the rows may not show.
     * No approval recorded anywhere is NULL, never 0.
     * total_approved_rounds is how many rounds the sum came from, and
       funded_rounds_no_approval is how many FUNDED rounds carry no approval at
       all — so the screen can say why the approved total is below the funded
       total instead of looking like it disagrees with the file.

   needs_pull is "paid, no real credit report on file, AND WRITTEN PERMISSION
   IS LIVE". The consent half is GATE A at the number level and it is not
   optional: without it the tile counted a strict superset of the clients the
   per-client rule (evaluatePullCrs / guardConsentBeforePull) will ever allow a
   pull for, so a tile headed "Needs Pull" listed people nobody may pull for and
   contradicted the chip painted beside it.

   THE CONSENT RULE IS NOT COPIED HERE EITHER. `CONSENT_VALID_SQL` is the same
   imported constant consentSql() above uses and the same predicate the real
   pull endpoint enforces (src/finance/soft-pulls.mjs → consentStatus). EXISTS
   over it is exactly what consentStatus() answers: that function orders valid
   rows first and asks whether the row it picked is valid, so "the picked row is
   valid" and "at least one valid row exists" are the same statement.

   needs_consent is the rest of that population — paid, nothing pulled, and no
   live permission. It is the SAME two halves recombined, so no client can fall
   out of both counts, and it exists so the screen can say where the clients
   that left "Needs Pull" went instead of quietly losing them. It is NOT a
   seventh tile.

   total_prequal is real but thin: Phase 0 measured the whole company total
   coming from ONE client out of 47. total_prequal_clients is returned beside it
   so the screen can say so rather than presenting one person as a company
   total. SUM over no rows is NULL, and it stays NULL — never 0. */

const ROLLUPS_SQL = rollupsSql();

/* Built by a function, the same shape consentSql() above uses, so the two
   fragments below sit INSIDE this statement's own text. Each is written once
   and used twice — needs_pull and needs_consent split one population in two,
   and a hand-typed second copy of either half is how the two counts would come
   to disagree about the same client. */
function rollupsSql() {
  /* Paid for the report, and THE CREDIT IS NOT ALREADY IN. Two ways it can be
     in, and the tile must test BOTH — the chip does:

       * a REAL crs_results row (a demo row is not a pull, 148_demo_mode.sql:20);
       * custom_fields.crs_status = 'Complete'.

     THE SECOND ONE IS WHY THIS TILE USED TO DISAGREE WITH THE ROW UNDER IT.
     evaluatePullCrs() (src/fulfillment/next-action.mjs) says NO the moment
     crs_status is Complete, and evaluateGetConsent() says NO too, because
     completedCreditPull() reads Complete as "the credit is in". The tile did
     not look at crs_status at all, so it counted clients no chip would ever be
     painted on: measured on real Postgres, the tile said 4 and only 2 of those
     clients got the chip. A tile that disagrees with the row beneath it is
     worse than no tile.

     TRIM, and IS DISTINCT FROM, to match the decider exactly. next-action.mjs
     compares `str(cf.crs_status) === "Complete"`, and str() trims and treats a
     blank as nothing. IS DISTINCT FROM keeps a missing crs_status — NULL, the
     common case — on the "not complete" side, which is what the chip does with
     an absent value. */
  const paidNothingPulled = `
    c.custom_fields->>'crs_paid' = 'true'
      AND TRIM(c.custom_fields->>'crs_status') IS DISTINCT FROM 'Complete'
      AND NOT EXISTS (
        SELECT 1 FROM crs_results cr
         WHERE cr.client_id = c.id
           AND cr.org_id = c.org_id
           AND COALESCE(cr.is_demo, false) = false)`;

  /* Live written permission for the soft pull, judged by the ONE predicate in
     the repository. The column names inside CONSENT_VALID_SQL are unqualified
     and resolve to client_consents, the innermost table in this subquery. */
  const hasValidConsent = `
    EXISTS (
      SELECT 1 FROM client_consents cc
       WHERE cc.client_id = c.id
         AND cc.org_id = c.org_id
         AND cc.kind = $3
         AND (${CONSENT_VALID_SQL}))`;

  /* THE TILE HAS TO LOSE THE SAME RACES THE CHIP LOSES.
     First-match-wins puts Clear Fraud Alert above BOTH Get Consent and Pull CRS,
     so a paid, consented, unpulled client who is also flagged for fraud carries
     the fraud chip, not the pull chip. Without this term the tile counted them
     anyway: an adversary measured needs_pull = 3 against exactly 1 client
     actually carrying the pull chip, in the same response.
     These are the three sources evaluateFraud reads, in the same order — see
     src/fulfillment/next-action.mjs. Nothing below Pull CRS needs a term here,
     because Pull CRS already beats everything below it. */
  const hasFraudAlert = `
    ( 'fraud:alert-present' = ANY(COALESCE(c.tags, ARRAY[]::text[]))
      /* COALESCE IS LOAD-BEARING. Without it this is TRIM(NULL) = 'Fraud Alert',
         which is NULL, not false — and a client with no round_hold_reason is the
         common case. NULL then poisons the whole OR (false OR NULL OR false is
         NULL), NOT NULL is NULL, and COUNT(*) FILTER drops the row: measured
         2026-08-27, needs_pull AND needs_consent both read 0 for a client who
         satisfied every other term. The two counts are supposed to split one
         population, so a client vanishing from BOTH is the tell. The third term
         below already guards its NULL with COALESCE; this one did not. */
      OR TRIM(COALESCE(c.custom_fields->>'round_hold_reason', '')) = 'Fraud Alert'
      OR EXISTS (
        SELECT 1 FROM inquiry_removal_cases irc
         WHERE irc.client_id = c.id
           AND irc.org_id = c.org_id
           AND NULLIF(TRIM(COALESCE(irc.fraud_alert_after, '')), '') IS NOT NULL) )`;

  /* Total Approved (hole 8). A REAL round on this client — the same demo rule
     ROUNDS_SQL uses — and only for a client on a funding tier ($4, GATE B).
     A correlated subquery per client, summed, so the client count above is not
     multiplied by a join. */
  const realRound = `
    fr.client_id = c.id
      AND fr.org_id = c.org_id
      AND COALESCE(fr.is_demo, false) = false`;
  const onFundingTier = `c.outcome_tier = ANY($4::text[])`;
  const realPrequal = `COALESCE((
    SELECT NOT (r.is_demo OR r.result->>'simulated' = 'true'
      OR lower(r.result->>'environment') = 'simulated')
      FROM crs_results r
     WHERE r.org_id = c.org_id AND r.client_id = c.id
     ORDER BY r.created_at DESC, r.id DESC LIMIT 1
  ), true)`;

  return `
  SELECT
    COUNT(*)::int AS total_clients,
    COUNT(*) FILTER (
      WHERE (${paidNothingPulled})
        AND NOT (${hasFraudAlert})
        AND (${hasValidConsent})
    )::int AS needs_pull,
    COUNT(*) FILTER (
      WHERE (${paidNothingPulled})
        AND NOT (${hasFraudAlert})
        AND NOT (${hasValidConsent})
    )::int AS needs_consent,
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM tasks tk
         WHERE tk.client_id = c.id
           AND tk.org_id = c.org_id
           AND tk.done = false
           AND COALESCE(tk.is_demo, false) = false)
    )::int AS action_needed,
    SUM(
      CASE WHEN ${realPrequal} AND c.custom_fields->>'total_funding_estimate' ~ '^[0-9]+(\\.[0-9]+)?$'
           THEN (c.custom_fields->>'total_funding_estimate')::numeric
      END
    ) AS total_prequal,
    COUNT(*) FILTER (
      WHERE ${realPrequal} AND c.custom_fields->>'total_funding_estimate' ~ '^[0-9]+(\\.[0-9]+)?$'
        AND (c.custom_fields->>'total_funding_estimate')::numeric > 0
    )::int AS total_prequal_clients,
    SUM((
      SELECT SUM(fr.approved_amount) FROM funding_rounds fr
       WHERE ${realRound} AND fr.approved_amount > 0
    )) FILTER (WHERE ${onFundingTier}) AS total_approved,
    COALESCE(SUM((
      SELECT count(*) FROM funding_rounds fr
       WHERE ${realRound} AND fr.approved_amount > 0
    )) FILTER (WHERE ${onFundingTier}), 0)::int AS total_approved_rounds,
    COALESCE(SUM((
      SELECT count(*) FROM funding_rounds fr
       WHERE ${realRound}
         AND fr.status = 'funded'
         AND COALESCE(fr.approved_amount, 0) <= 0
    )) FILTER (WHERE ${onFundingTier}), 0)::int AS funded_rounds_no_approval
  FROM clients c
  WHERE c.org_id = $1::uuid
    AND ($2::boolean OR COALESCE(c.is_demo, false) = false)`;
}

/**
 * listRollups — the six tiles, or null if they could not be counted.
 *
 * total_prequal and total_approved are passed through EXACTLY as Postgres hands
 * them over (a string of dollars for numeric, or null). They are not rounded,
 * not coerced and never defaulted to zero — see CLAUDE.md §12 on money and on
 * NULL meaning unknown.
 *
 * `needs_consent` rides along beside needs_pull. It is NOT a seventh tile — the
 * screen shows it as the sentence under "Needs Pull", so the clients the
 * consent rule takes out of that count are named rather than lost.
 */
export async function listRollups(db, { orgId, demoOn = false } = {}) {
  if (!orgId) return null;
  const rows = await safeRows(
    db, ROLLUPS_SQL, [orgId, demoOn === true, SOFT_PULL_KIND, [...FUNDING_TIERS]], "rollups"
  );
  if (rows === null) return null;
  const r = rows[0] || {};
  return {
    total_clients: r.total_clients == null ? null : Number(r.total_clients),
    needs_pull: r.needs_pull == null ? null : Number(r.needs_pull),
    // Paid, nothing pulled, and no live written permission. They are not
    // "Needs Pull" — nobody may pull for them yet.
    needs_consent: r.needs_consent == null ? null : Number(r.needs_consent),
    action_needed: r.action_needed == null ? null : Number(r.action_needed),
    // Phase 0 §5: no definition and no source. null, never 0.
    ready: null,
    total_prequal: r.total_prequal === undefined ? null : r.total_prequal,
    total_prequal_clients: r.total_prequal_clients == null ? null : Number(r.total_prequal_clients),
    // Confirmed bank approvals on real rounds, funding tiers only. No approval
    // recorded is null, never 0 (hole 8 — see the note above rollupsSql).
    total_approved: r.total_approved === undefined ? null : r.total_approved,
    total_approved_rounds: r.total_approved_rounds == null ? null : Number(r.total_approved_rounds),
    funded_rounds_no_approval: r.funded_rounds_no_approval == null ? null : Number(r.funded_rounds_no_approval)
  };
}
