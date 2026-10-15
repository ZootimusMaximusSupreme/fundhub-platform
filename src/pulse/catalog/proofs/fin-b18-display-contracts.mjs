// Finish-853 batch 18 (tier 4, lane gap-catalog-display): the client money pages (Applications, Money helper,
// Transfers) and the Ops & Admin C-suite task writer.
//
// LIVE CHECKS in this file. Each is one read-only SQL text the display lane runs for the company. It takes
// $1::uuid (the company) and returns sample_count (how many saved results exist) and bad_count (how many
// are wrong). A control nobody has used has no results, so every check here is `emptyAs: "quiet"`: green
// with the words "no saved results yet", red on the first wrong result.
//
// Every check is built from NAMED bad-result conditions joined with OR. fin-b18-live-contracts.test.mjs
// runs the exact text over stand-in rows (real column names from db/migrations), then drops each named
// condition from the text and shows the row it guards is no longer caught.
//
// The practice-test rows of this batch are listed in fin-b18-rows.json and attached in
// fin-b18-display-proofs.mjs.
//
// This file imports nothing. scripts/pulse/compile-catalog.mjs reads it at build time; the live bundle
// reads the compiled copy in src/pulse/catalog/generated.json. It must not import display-saved-result.mjs
// (that file imports this one).

export const FIN_B18_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B18_LIVE_TEST = "src/pulse/catalog/proofs/fin-b18-live-contracts.test.mjs";
// The real C-suite task writer run through its check (the two Ops & Admin rows).
export const FIN_B18_WRITER_TEST = "src/pulse/catalog/proofs/fin-b18-live-writer.test.mjs";

const BLANK = (expr) => `NULLIF(BTRIM(COALESCE(${expr}, '')), '') IS NULL`;

/** `names` kept out of the text, for the test that drops one condition at a time. */
function orJoin(pairs, without, indent = "         ") {
  const kept = pairs.filter(([name]) => !without.includes(name));
  if (!kept.length) return "1 = 0";
  return kept.map(([, expr]) => `(${expr})`).join(`\n${indent}OR `);
}

// ───────────────────── Applications: "Your steps list + Fundhub's steps expander" ─────────────────────
//
// money-declines.html lists the plan of each decline (blueprint_decline_steps): the steps the client does
// ("Your steps", who = client) and the steps Fundhub does (a fold that counts the finished ones). Every
// decline is saved with its plan in one transaction (src/blueprint/decline-defense.mjs recordDecline), and
// the plan always holds at least "read the letter" and "send the letter". A step set to done or skipped
// carries who did it and when; a step set back to open carries neither (setStepStatus). The database holds
// the rest (a stamp on every finished step, a cited source on every worded step).

export const STEPS_BAD = Object.freeze([
  ["a decline has no plan steps at all",
    `NOT EXISTS (SELECT 1 FROM blueprint_decline_steps s WHERE s.decline_id = d.id)`],
  ["a plan step belongs to a different company than its decline",
    `EXISTS (SELECT 1 FROM blueprint_decline_steps s WHERE s.decline_id = d.id AND s.org_id <> d.org_id)`],
  ["a step is done or skipped but names nobody who did it",
    `EXISTS (SELECT 1 FROM blueprint_decline_steps s
                  WHERE s.decline_id = d.id AND s.status <> 'open' AND ${BLANK("s.done_by")})`],
  ["a step that is open still carries a finished time",
    `EXISTS (SELECT 1 FROM blueprint_decline_steps s
                  WHERE s.decline_id = d.id AND s.status = 'open' AND s.done_at IS NOT NULL)`],
  ["two steps of one decline share a place in the list",
    `EXISTS (SELECT 1 FROM blueprint_decline_steps s
                  JOIN blueprint_decline_steps t ON t.decline_id = s.decline_id AND t.position = s.position AND t.id <> s.id
                 WHERE s.decline_id = d.id)`],
]);

export function stepsSql({ without = [] } = {}) {
  return `/* display-result:fin-b18-decline-steps */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(STEPS_BAD, without)})::int AS bad_count
  FROM blueprint_declines d
 WHERE d.org_id = $1::uuid
   AND d.created_at >= now() - interval '180 days'`;
}

// ───────────────────── Applications: "Your bank applications list" ─────────────────────
//
// The same page lists each application as "<bank> · <product>" with the bank's word beside it. The bank is
// lender_name, then bank; the word comes from the application's status (Apply, Applied, Approved, Denied,
// Missing Docs, Action Required), and a decline on the application replaces it with the decline's own words.
// Reconsideration moves the application too: approved on reconsideration makes it Approved, still declined
// makes it Denied (recordOutcome). Only a client's own applications of the last 90 days are judged.

export const APPLICATIONS_BAD = Object.freeze([
  ["an application has no bank name, so the list says only 'A bank'",
    `${BLANK("a.lender_name")} AND ${BLANK("a.bank")}`],
  ["an application has no status, so the list says 'Status not set'",
    `${BLANK("a.status")}`],
  ["a decline is attached to an application of another client or company",
    `EXISTS (SELECT 1 FROM blueprint_declines d
                  WHERE d.application_id = a.id AND (d.client_id IS DISTINCT FROM a.client_id OR d.org_id <> a.org_id))`],
  ["a decline was approved on reconsideration but the application is not Approved",
    `EXISTS (SELECT 1 FROM blueprint_declines d
                  WHERE d.application_id = a.id AND d.outcome = 'approved_on_recon' AND a.status IS DISTINCT FROM 'Approved')`],
  ["a decline stayed declined after reconsideration but the application is not Denied",
    `EXISTS (SELECT 1 FROM blueprint_declines d
                  WHERE d.application_id = a.id AND d.outcome = 'still_declined' AND a.status IS DISTINCT FROM 'Denied')`],
]);

export function applicationsSql({ without = [] } = {}) {
  return `/* display-result:fin-b18-applications-list */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(APPLICATIONS_BAD, without)})::int AS bad_count
  FROM applications a
 WHERE a.org_id = $1::uuid
   AND a.client_id IS NOT NULL
   AND COALESCE(a.is_demo, false) = false
   AND a.updated_at >= now() - interval '90 days'`;
}

// ───────────────────── Money helper: "Banner: helper stopped / not switched on" ─────────────────────
//
// money-helper.html shows "The money helper stopped here" when the client's thread is stopped
// (money_helper_threads.halted_at), and says "You asked it to stop, so it will not text you" when the stop
// reason is stop. A stop is written by the same pass that writes the stopped turn, and a stop the client
// asked for also writes a text opt-out through the one sanctioned writer (src/lib/opt-out.mjs). After a stop
// the helper takes no more messages (routeTurn answers helper_stopped), so no message made after the stop
// may have been answered. "Not switched on" reads the agent's own status today, so it leaves nothing saved.

export const HELPER_BAD = Object.freeze([
  ["a stopped helper has no stopped turn behind it",
    `NOT EXISTS (SELECT 1 FROM money_helper_turns u
                  WHERE u.org_id = h.org_id AND u.client_id = h.client_id AND u.status = 'halted')`],
  ["a stop the client asked for left no text opt-out, so the banner's promise is false",
    `h.halt_reason = 'stop' AND NOT EXISTS (SELECT 1 FROM opt_outs o
                  WHERE o.client_id = h.client_id AND o.channel = 'sms')`],
  ["the helper kept answering messages after it stopped",
    `EXISTS (SELECT 1 FROM money_helper_turns u
                  WHERE u.org_id = h.org_id AND u.client_id = h.client_id AND u.kind = 'message'
                    AND u.status = 'answered' AND u.created_at > h.halted_at)`],
  ["a stopped thread belongs to a client of another company",
    `NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = h.client_id AND c.org_id = h.org_id)`],
]);

export function helperSql({ without = [] } = {}) {
  return `/* display-result:fin-b18-helper-stop */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(HELPER_BAD, without)})::int AS bad_count
  FROM money_helper_threads h
 WHERE h.org_id = $1::uuid
   AND h.halted_at IS NOT NULL`;
}

// ───────────────────── Transfers: "What happened (details toggle: ledger events in words)" ─────────────────────
//
// Every status change of a money move is one line in money_transfer_events (the ledger trigger), and the
// page tells each line in words (money-transfers.js eventWords): a fixed list of words, and a "plaid_<what>"
// line for the bank's own events, told on the debit side or the credit side. A line with no words prints
// the raw event name; a bank line with no side prints on the wrong side. Moves of the last 90 days.

const EVENT_WORDS_KEYS = [
  "approved", "started", "authorized", "declined", "submitted", "credit_authorized", "credit_submitted",
  "cancelled", "date_passed", "failed", "provider_wait", "provider_not_enabled", "needs_bank_login", "account_removed",
];
const WORDS_LIST = EVENT_WORDS_KEYS.map((key) => `'${key}'`).join(", ");

export const TRANSFER_BAD = Object.freeze([
  ["a money move has no 'approved' line as the start of its story",
    `NOT EXISTS (SELECT 1 FROM money_transfer_events x WHERE x.transfer_id = t.id AND x.event_type = 'approved')`],
  ["a line in a move's story is one the page has no words for",
    `EXISTS (SELECT 1 FROM money_transfer_events x
                  WHERE x.transfer_id = t.id AND x.event_type NOT IN (${WORDS_LIST})
                    AND substr(x.event_type, 1, 6) <> 'plaid_')`],
  ["a bank line in a move's story does not say if it is the debit or the credit side",
    `EXISTS (SELECT 1 FROM money_transfer_events x
                  WHERE x.transfer_id = t.id AND substr(x.event_type, 1, 6) = 'plaid_'
                    AND x.leg IS NULL)`],
  ["a line in a move's story belongs to another company or client",
    `EXISTS (SELECT 1 FROM money_transfer_events x
                  WHERE x.transfer_id = t.id AND (x.org_id <> t.org_id OR x.client_id <> t.client_id))`],
  ["a move's current status never appears in its story",
    `NOT EXISTS (SELECT 1 FROM money_transfer_events x WHERE x.transfer_id = t.id AND x.to_status = t.status)`],
]);

export function transferSql({ without = [] } = {}) {
  return `/* display-result:fin-b18-transfer-events */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(TRANSFER_BAD, without)})::int AS bad_count
  FROM money_transfers t
 WHERE t.org_id = $1::uuid
   AND t.created_at >= now() - interval '90 days'`;
}

// ───────────────────── Ops & Admin: the C-suite task writer ─────────────────────
//
// POST /api/ops/hire-closer (src/ops/hire-closer.mjs, src/ops/csuite-tasks.mjs) writes company tasks with
// source_workflow 'ops-coo' and no client: a hire task (body hire-closer:packed:<month>) for the sales
// manager, a team-gaps task (diagnose:gaps:<month>) and an ad-spend review (ads-review:<month>) for the
// owner, one per month per kind (the body is the dedupe key). When LinkedIn is connected it also posts the
// closer job (a hiring_job_postings row whose words carry the marker hire-closer:packed:<month>), which
// ends 'posted' with an outside id, or 'failed' with the reason. Last 120 days.

const KNOWN_BODY = ["hire-closer:packed:", "diagnose:gaps:", "ads-review:", "fire:", "raise:", "bonus:"]
  .map((prefix) => `t.body LIKE '${prefix}%'`).join(" OR ");

export const CSUITE_TASK_BAD = Object.freeze([
  ["a hire task is not on the sales manager's desk",
    `t.body LIKE 'hire-closer:packed:%' AND t.assignee_role IS DISTINCT FROM 'sales_manager'`],
  ["a team gaps or ad spend review is not on the owner's desk",
    `(t.body LIKE 'diagnose:gaps:%' OR t.body LIKE 'ads-review:%') AND t.assignee_role IS DISTINCT FROM 'owner'`],
  ["a company task is hung on a client file",
    `t.client_id IS NOT NULL`],
  ["the same company task was written twice",
    `EXISTS (SELECT 1 FROM tasks o
                  WHERE o.org_id = t.org_id AND o.source_workflow = t.source_workflow AND o.body = t.body AND o.id <> t.id)`],
  ["a task from the brain is not one of the kinds it writes",
    `NOT COALESCE(${KNOWN_BODY}, false)`],
]);

export const CSUITE_POST_BAD = Object.freeze([
  ["the closer job post failed",
    `p.status = 'failed'`],
  ["a closer job post is marked posted but has no outside id or no posted time",
    `p.status = 'posted' AND (${BLANK("p.external_id")} OR p.posted_at IS NULL)`],
]);

export function csuiteSql({ without = [] } = {}) {
  return `/* display-result:fin-b18-csuite-tasks */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE r.bad = 1)::int AS bad_count
  FROM (
    SELECT CASE WHEN ${orJoin(CSUITE_TASK_BAD, without, "              ")} THEN 1 ELSE 0 END AS bad
      FROM tasks t
     WHERE t.org_id = $1::uuid
       AND t.source_workflow = 'ops-coo'
       AND t.created_at >= now() - interval '120 days'
  UNION ALL
    SELECT CASE WHEN ${orJoin(CSUITE_POST_BAD, without, "              ")} THEN 1 ELSE 0 END AS bad
      FROM hiring_job_postings p
     WHERE p.org_id = $1::uuid
       AND p.channel = 'linkedin'
       AND p.description LIKE '%hire-closer:packed:%'
       AND p.created_at >= now() - interval '120 days'
  ) r`;
}

// ───────────────────────── the registry list ─────────────────────────

const DECLINES = "public/app/money-declines.html";
const OPS = "public/app/ops-admin.html";

const CSUITE_REQUIREMENT = "Every company task the brain wrote must be a kind it writes, sit on the right desk (hire on the sales manager, review on the owner), hang on no client, and exist once; and the closer job post must not have failed or been marked posted with no outside id.";

const CHECKS = [
  {
    sourceFile: "desks-d.json",
    surface: DECLINES,
    control: "Your steps list + Fundhub's steps expander (done / skipped / not done yet)",
    requirement: "Every decline plan must hold steps, each in its own company, each done or skipped step naming who did it, no open step carrying a finished time, and no two steps sharing a place in the list.",
    sql: stepsSql,
    names: STEPS_BAD.map(([name]) => name),
  },
  {
    sourceFile: "desks-d.json",
    surface: DECLINES,
    control: "Your bank applications list",
    requirement: "Every application a client sees must name its bank and carry a status, any decline on it must belong to the same client, and a reconsideration answer must match the application's own status.",
    sql: applicationsSql,
    names: APPLICATIONS_BAD.map(([name]) => name),
  },
  {
    sourceFile: "desks-d.json",
    surface: "public/app/money-helper.html",
    control: "Banner: helper stopped / not switched on",
    requirement: "Every stopped helper thread must have a stopped turn behind it, a text opt-out when the client asked it to stop, no answered message after the stop, and a client in the same company.",
    sql: helperSql,
    names: HELPER_BAD.map(([name]) => name),
  },
  {
    sourceFile: "desks-e.json",
    surface: "public/app/money-transfers.html",
    control: "What happened (details toggle: ledger events in words)",
    requirement: "Every money move's story must start with its 'approved' line, hold only lines the page has words for (bank lines saying debit or credit), keep to its own company and client, and include its current status.",
    sql: transferSql,
    names: TRANSFER_BAD.map(([name]) => name),
  },
  {
    sourceFile: "desks-e.json",
    surface: OPS,
    control: "hire-closer (server): writes hire / diagnose / ads-review tasks and, when LinkedIn is connected, posts the closer job on LinkedIn",
    requirement: CSUITE_REQUIREMENT,
    sql: csuiteSql,
    names: [...CSUITE_TASK_BAD, ...CSUITE_POST_BAD].map(([name]) => name),
    tests: [FIN_B18_LIVE_TEST, FIN_B18_WRITER_TEST],
  },
  {
    sourceFile: "desks-e.json",
    surface: OPS,
    control: "Write today's C-suite tasks (button, shown only when the calendar is packed, a gap is short, or ad spend is above zero)",
    requirement: CSUITE_REQUIREMENT,
    sql: csuiteSql,
    names: [...CSUITE_TASK_BAD, ...CSUITE_POST_BAD].map(([name]) => name),
    tests: [FIN_B18_LIVE_TEST, FIN_B18_WRITER_TEST],
  },
];

export const FIN_B18_CHECKS = Object.freeze(CHECKS.map((check) => Object.freeze(check)));

/** The contracts the display lane runs, in the registry's own shape. */
export const FIN_B18_RESULT_CONTRACTS = Object.freeze(FIN_B18_CHECKS.map((check) => Object.freeze({
  control: check.control,
  mode: "query",
  emptyAs: "quiet",
  requirement: check.requirement,
  sql: check.sql(),
})));

/** The exact map rows (desks file, surface, control) each live check is attached to. */
export const FIN_B18_LIVE_ROWS = Object.freeze(FIN_B18_CHECKS.map((check) => Object.freeze([check.sourceFile, check.surface, check.control])));

/** Rows judged by the live lane. Also handed to the catalog compiler as deep cases. */
export const FIN_B18_LIVE_CASES = Object.freeze(FIN_B18_CHECKS.map((check) => {
  const tests = check.tests || [FIN_B18_LIVE_TEST];
  return Object.freeze({
    sourceFile: check.sourceFile,
    surface: check.surface,
    control: check.control,
    depth: "deep",
    evidence: [...tests, FIN_B18_LANE].join("; "),
    tests: Object.freeze([...tests]),
  });
}));
