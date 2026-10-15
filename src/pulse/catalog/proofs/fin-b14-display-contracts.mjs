// Finish-853 batch 14 (tier 4, lane gap-catalog-display): the Journeys editor and the Lenders desk.
//
// LIVE CHECKS in this file. Each is one read-only SQL text the display lane runs for the company. It
// takes $1::uuid (the company) and returns sample_count (how many saved results exist) and bad_count
// (how many are wrong). A control nobody has used has no results, so every check here is
// `emptyAs: "quiet"`: green with the words "no saved results yet", red on the first wrong result.
//
// Every check is built from NAMED bad-result conditions joined with OR. fin-b14-live-contracts.test.mjs
// runs the exact text over stand-in rows (real column names from db/migrations), then drops each named
// condition from the text and shows the row it guards is no longer caught.
//
// The practice-test rows of this batch are listed in fin-b14-rows.json and attached in
// fin-b14-display-proofs.mjs. The rows that cannot honestly be attached are in fin-b14-not-attachable.mjs.
//
// This file imports nothing. scripts/pulse/compile-catalog.mjs reads it at build time; the live bundle
// reads the compiled copy in src/pulse/catalog/generated.json. It must not import display-saved-result.mjs
// (that file imports this one).

export const FIN_B14_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B14_LIVE_TEST = "src/pulse/catalog/proofs/fin-b14-live-contracts.test.mjs";
export const FIN_B14_SOURCE_FILE = "desks-c.json";

const BLANK = (expr) => `NULLIF(BTRIM(COALESCE(${expr}, '')), '') IS NULL`;

/** `names` kept out of the text, for the test that drops one condition at a time. */
function orJoin(pairs, without, indent = "         ") {
  const kept = pairs.filter(([name]) => !without.includes(name));
  if (!kept.length) return "1 = 0";
  return kept.map(([, expr]) => `(${expr})`).join(`\n${indent}OR `);
}

// ───────────────────────── journeys.html ─────────────────────────

const JOURNEY_KEYS = "('client', 'setter', 'closer', 'advisor', 'affiliate', 'partner')";
const STEP_TYPES = "('sms', 'email', 'wait', 'condition', 'stage', 'assign', 'handoff', 'agent', 'payment', 'record')";

// The same six checks api/journeys.mjs makes on save (header and every step, including the steps inside a
// question's two paths), so a saved row that got in around the endpoint is caught.
export const JOURNEY_HEADER_BAD = Object.freeze([
  ["a journey's steps are not a list", `jsonb_typeof(j.nodes) IS DISTINCT FROM 'array'`],
  ["a journey has no name", BLANK("j.name")],
  ["a journey has no start line", BLANK("j.start_when")],
  ["a journey has no end line", BLANK("j.end_when")],
  ["a journey has a key the editor does not own", `j.key NOT IN ${JOURNEY_KEYS}`],
]);

export const JOURNEY_STEP_BAD = Object.freeze([
  ["a step is not a step at all", `jsonb_typeof(step) IS DISTINCT FROM 'object'`],
  ["a step has no type", `jsonb_typeof(step) = 'object' AND ${BLANK("step ->> 'type'")}`],
  ["a step has a type nothing renders",
    `NOT (${BLANK("step ->> 'type'")}) AND step ->> 'type' NOT IN ${STEP_TYPES}`],
  ["a wait has no minutes, hours or days",
    `step ->> 'type' = 'wait' AND COALESCE(step -> 'cfg' ->> 'unit', '') NOT IN ('minutes', 'hours', 'days')`],
  ["a wait has no length above zero",
    `step ->> 'type' = 'wait' AND (BTRIM(COALESCE(step -> 'cfg' ->> 'amount', '')) !~ '^[0-9]+([.][0-9]+)?$'
            OR BTRIM(COALESCE(step -> 'cfg' ->> 'amount', ''), '0.') = '')`],
  ["a question has nothing to check",
    `step ->> 'type' = 'condition' AND ${BLANK("step -> 'cfg' ->> 'field'")}`],
  ["a question has no paths coming off it",
    `step ->> 'type' = 'condition' AND CASE WHEN jsonb_typeof(step -> 'branches') = 'array'
              THEN jsonb_array_length(step -> 'branches') = 0 ELSE true END`],
  ["a move-the-card step names no pipeline or no stage",
    `step ->> 'type' = 'stage' AND (${BLANK("step -> 'cfg' ->> 'stage'")} OR ${BLANK("step -> 'cfg' ->> 'pipeline'")})`],
  ["a text or email body uses single braces",
    `step ->> 'type' IN ('sms', 'email') AND COALESCE(step -> 'cfg' ->> 'body', '') ~ '(^|[^{])[{][A-Za-z0-9_]+[}]($|[^}])'`],
  ["an email subject uses single braces",
    `step ->> 'type' = 'email' AND COALESCE(step -> 'cfg' ->> 'subject', '') ~ '(^|[^{])[{][A-Za-z0-9_]+[}]($|[^}])'`],
]);

/** Apply to code: every saved journey row, header and every step. */
export function journeysApplySql({ without = [] } = {}) {
  return `/* display-result:journeys-apply-saved */
WITH RECURSIVE steps(journey_id, step) AS (
  SELECT j.id, e.value
    FROM journeys j,
         jsonb_array_elements(CASE WHEN jsonb_typeof(j.nodes) = 'array' THEN j.nodes ELSE '[]'::jsonb END) AS e(value)
   WHERE j.org_id = $1::uuid AND COALESCE(j.is_demo, false) = false
  UNION ALL
  SELECT s.journey_id, c.value
    FROM steps s,
         jsonb_array_elements(CASE WHEN jsonb_typeof(s.step -> 'branches') = 'array' THEN s.step -> 'branches' ELSE '[]'::jsonb END) AS b(value),
         jsonb_array_elements(CASE WHEN jsonb_typeof(b.value -> 'nodes') = 'array' THEN b.value -> 'nodes' ELSE '[]'::jsonb END) AS c(value)
),
bad_steps AS (
  SELECT DISTINCT journey_id
    FROM steps
   WHERE ${orJoin(JOURNEY_STEP_BAD, without, "         ")}
)
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(JOURNEY_HEADER_BAD, without)}
         OR j.id IN (SELECT journey_id FROM bad_steps))::int AS bad_count
  FROM journeys j
 WHERE j.org_id = $1::uuid AND COALESCE(j.is_demo, false) = false`;
}

export const JOURNEY_LOAD_BAD = Object.freeze([
  ["a saved journey has no steps, so the page draws the example in its place",
    `CASE WHEN jsonb_typeof(j.nodes) = 'array' THEN jsonb_array_length(j.nodes) = 0 ELSE true END`],
  ["a saved journey has no name, so the page shows the example's name",
    BLANK("j.name")],
  ["a saved journey has no start line, so the page shows the example's",
    BLANK("j.start_when")],
  ["a saved journey has no end line, so the page shows the example's",
    BLANK("j.end_when")],
  ["a saved journey has a key the page never asks for", `j.key NOT IN ${JOURNEY_KEYS}`],
]);

/** Page load: every saved journey row the page would try to draw. */
export function journeysLoadSql({ without = [] } = {}) {
  return `/* display-result:journeys-page-load */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(JOURNEY_LOAD_BAD, without)})::int AS bad_count
  FROM journeys j
 WHERE j.org_id = $1::uuid AND COALESCE(j.is_demo, false) = false`;
}

// ───────────────────────── lenders.html ─────────────────────────

// A tip row is a note from the spreadsheet, not a bank (src/lenders/tips.mjs isTipRow). The import skips
// them, so one that is saved as a lender got in some other way.
const TIP_PREFIXES = ["apply ", "amex often", "if ", "when ", "note:", "same ", "use ", "do not", "must ", "can ", "should ", "wait ", "open ", "call ", "visit "];
const TIP_NAME = `(${TIP_PREFIXES.map((p) => `LOWER(BTRIM(l.name)) LIKE '${p}%'`).join(" OR ")} OR LENGTH(BTRIM(l.name)) > 72)`;

export const LENDER_ADD_BAD = Object.freeze([
  ["a hand-made lender has no name", BLANK("l.name")],
  ["a hand-made lender has nobody's name on it", BLANK("l.last_updated_by")],
  ["a hand-made lender has no stamp date", "l.last_updated_date IS NULL"],
  ["the same lender was made twice by hand in one product table",
    `NOT (${BLANK("l.name")}) AND EXISTS (SELECT 1 FROM lenders d
              WHERE d.org_id = l.org_id AND d.id <> l.id AND d.external_row_id IS NULL
                AND COALESCE(d.is_demo, false) = false AND d.lender_table = l.lender_table
                AND LOWER(BTRIM(d.name)) = LOWER(BTRIM(l.name)))`],
]);

export function lendersAddSql({ without = [] } = {}) {
  return `/* display-result:lenders-add-blank-row */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(LENDER_ADD_BAD, without)})::int AS bad_count
  FROM lenders l
 WHERE l.org_id = $1::uuid
   AND COALESCE(l.is_demo, false) = false
   AND l.external_row_id IS NULL
   AND l.created_at >= now() - interval '90 days'`;
}

export const LENDER_IMPORT_BAD = Object.freeze([
  ["an imported lender has no name", BLANK("l.name")],
  ["an imported lender has an empty row id, so a re-import cannot find it", BLANK("l.external_row_id")],
  ["an imported lender has nobody's name on it", BLANK("l.last_updated_by")],
  ["an imported lender has no stamp date", "l.last_updated_date IS NULL"],
  ["a tip from the spreadsheet was saved as a bank", TIP_NAME],
  ["an imported lender has a dollar amount below zero",
    "l.typical_approval_range < 0 OR l.average_starting_loc < 0 OR l.max_known_loc < 0 OR l.minimum_deposit < 0"],
]);

export function lendersImportSql({ without = [] } = {}) {
  return `/* display-result:lenders-import-now */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(LENDER_IMPORT_BAD, without)})::int AS bad_count
  FROM lenders l
 WHERE l.org_id = $1::uuid
   AND COALESCE(l.is_demo, false) = false
   AND l.external_row_id IS NOT NULL
   AND l.updated_at >= now() - interval '90 days'`;
}

// Mismatch queue: Confirm and Corrected. The queue only lists open mismatches, so a row that was confirmed
// or corrected from it was a flagged mismatch that named the bureau seen and a lender of this company, and
// the review puts the reviewer's name on the row when nobody's was there.
function reviewedBad(status) {
  return [
    [`a ${status} observation was never flagged as a mismatch, so it could not have come from the queue`, "o.mismatch_flag = false"],
    [`a ${status} observation says no bureau was seen`, BLANK("o.observed_bureau")],
    [`a ${status} observation names no lender`, `o.lender_row_id IS NULL AND ${BLANK("o.lender_name")}`],
    [`a ${status} observation points at a lender of another company`,
      `o.lender_row_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lenders x WHERE x.id = o.lender_row_id AND x.org_id = o.org_id)`],
    [`a ${status} observation has no person on it`, BLANK("o.created_by")],
  ];
}
export const MISMATCH_CONFIRM_BAD = Object.freeze(reviewedBad("confirmed"));
export const MISMATCH_CORRECT_BAD = Object.freeze(reviewedBad("corrected"));

function mismatchSql(key, status, bad, without) {
  return `/* display-result:${key} */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${orJoin(bad, without)})::int AS bad_count
  FROM lender_bureau_observations o
 WHERE o.org_id = $1::uuid
   AND o.review_status = '${status}'`;
}
export const mismatchConfirmSql = ({ without = [] } = {}) => mismatchSql("lenders-mismatch-confirm", "confirmed", MISMATCH_CONFIRM_BAD, without);
export const mismatchCorrectSql = ({ without = [] } = {}) => mismatchSql("lenders-mismatch-corrected", "corrected", MISMATCH_CORRECT_BAD, without);

// ───────────────────────── the registry list ─────────────────────────

const CHECKS = [
  {
    surface: "journeys.html",
    control: "Header: Apply to code and bottom-bar Apply (saves every edited journey)",
    requirement: "Every saved journey must have its steps as a list, a name, a start line and an end line, a key the editor owns, and every step (also the steps inside a question's paths) must be a known kind with what it cannot work without: a wait needs a length above zero and minutes, hours or days; a question needs something to check and its paths; a move needs a pipeline and a stage; no text or email may use single braces.",
    sql: journeysApplySql,
    names: [...JOURNEY_HEADER_BAD, ...JOURNEY_STEP_BAD].map(([name]) => name),
  },
  {
    surface: "journeys.html",
    control: "Page load: reads saved journeys; falls back to seeded example trees if the table is empty",
    requirement: "Every saved journey must hold at least one step, a name, a start line and an end line, and use a key the page asks for, or the page silently draws its own example in the saved journey's place.",
    sql: journeysLoadSql,
    names: JOURNEY_LOAD_BAD.map(([name]) => name),
  },
  {
    surface: "lenders.html",
    control: "Add blank row button (prompts for a lender name, creates one row)",
    requirement: "Every lender made by hand in the last 90 days must have a name, the name of who made it, a stamp date, and must not appear twice in one product table.",
    sql: lendersAddSql,
    names: LENDER_ADD_BAD.map(([name]) => name),
  },
  {
    surface: "lenders.html",
    control: "Import now button (paste CSV, creates and updates lender rows)",
    requirement: "Every imported lender touched in the last 90 days must have a name, a row id, the name of who imported it and a stamp date, must not be a tip from the spreadsheet, and must not carry a dollar amount below zero.",
    sql: lendersImportSql,
    names: LENDER_IMPORT_BAD.map(([name]) => name),
  },
  {
    surface: "lenders.html",
    control: "Mismatch queue row: Confirm button",
    requirement: "Every confirmed bureau observation must have been a flagged mismatch, say which bureau was seen, name a lender of this company, and carry a person's name.",
    sql: mismatchConfirmSql,
    names: MISMATCH_CONFIRM_BAD.map(([name]) => name),
  },
  {
    surface: "lenders.html",
    control: "Mismatch queue row: Corrected button",
    requirement: "Every corrected bureau observation must have been a flagged mismatch, say which bureau was seen, name a lender of this company, and carry a person's name.",
    sql: mismatchCorrectSql,
    names: MISMATCH_CORRECT_BAD.map(([name]) => name),
  },
];

export const FIN_B14_CHECKS = Object.freeze(CHECKS.map((check) => Object.freeze(check)));

/** The contracts the display lane runs, in the registry's own shape. */
export const FIN_B14_RESULT_CONTRACTS = Object.freeze(FIN_B14_CHECKS.map((check) => Object.freeze({
  control: check.control,
  mode: "query",
  emptyAs: "quiet",
  requirement: check.requirement,
  sql: check.sql(),
})));

/** The exact map rows (desks file, surface, control) each live check is attached to. */
export const FIN_B14_LIVE_ROWS = Object.freeze(FIN_B14_CHECKS.map((check) => Object.freeze([FIN_B14_SOURCE_FILE, check.surface, check.control])));

/** Rows judged by the live lane. Also handed to the catalog compiler as deep cases. */
export const FIN_B14_LIVE_CASES = Object.freeze(FIN_B14_LIVE_ROWS.map(([sourceFile, surface, control]) => Object.freeze({
  sourceFile,
  surface,
  control,
  depth: "deep",
  evidence: `${FIN_B14_LIVE_TEST}; ${FIN_B14_LANE}`,
  tests: Object.freeze([FIN_B14_LIVE_TEST]),
})));
