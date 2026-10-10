// The shape of every board: does it paint every card, is anything sitting too long, is anything
// landing where nobody is watching, did anybody get lost. Report only. Read only.
// Never moves a card. Never texts. Never charges. Never pulls credit.
//
// Built for the 2026-10-10 coverage batch, workflow W3 "Pipelines truth".
// Board: ops/workflows/coverage-every-surface-2026-10-10.md, section 3 (P1, P3, P5, P6).
// The other half (is each card in the stage the facts say, did each move fire its event, do two
// records agree) is gap-pipeline-facts.mjs. The two lanes are split so each stays under 20 seconds.
//
//   pipeline:count-true      P1  every column paints as many cards as the database holds
//   pipeline:age             P3  no card sits past a stage time limit the repo already wrote
//   pipeline:age-no-limit    P3  boards with no written limit: a named setting, off, said out loud
//   pipeline:dead-stage      P5  stages no code moves a card to: green until a card lands there
//   pipeline:nobody-lost     P6  paying clients with no card, archived clients who paid, cards off the board
//
// What this file reuses and does not copy:
//   gap-crm-links.mjs   BOARD_STAGES_SQL and BOARD_CARDS_SQL. They are the route's own reads
//                       (api/dashboard/pipeline.mjs); a test there fails the day they drift.
//   gap-consent.mjs     TEST_CLIENT_EMAIL_RE, the one test-client address pattern.
//   src/repair/sla.mjs  STAGE_SLA and isBreached, the Repair stage clocks.
//
// What is NOT invented: a board with no written stage clock gets no clock. Its limit is one named
// setting (AGE_LIMIT_HOURS), off, and the row says so in a way the audit checks again.

import { BOARD_CARDS_SQL, BOARD_STAGES_SQL } from "./gap-crm-links.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";
import { STAGE_SLA, isBreached } from "../../repair/sla.mjs";
import { orgDemoModeEnabled } from "../../demo/exclude-demo.mjs";

export const CHECK_IDS = Object.freeze([
  "pipeline:count-true",
  "pipeline:age",
  "pipeline:age-no-limit",
  "pipeline:dead-stage",
  "pipeline:nobody-lost"
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_AUTOFIX = "The pulse only reports. Do not auto-fix from this pulse. Chris fixes reds.";
const HOUR_MS = 60 * 60 * 1000;

/** The most cards the board read hands back by default (api/dashboard/pipeline.mjs, fallback 500). */
export const BOARD_READ_LIMIT = 500;
/** The most applications the hiring page's read hands back (src/http/read-api.mjs MAX_LIMIT, page asks 200). */
export const HIRING_READ_LIMIT = 200;
/** A payment this fresh is still on its way to a board. */
export const PAID_GRACE_MS = HOUR_MS;
/** The most cards read for the age check in one run. */
export const MAX_AGE_ROWS = 2000;
/** The most cases of each kind named in a detail line. */
const NAME_AT_MOST = 4;

/** The boards, in the order the screen shows them, and the stages where a card is finished. */
export const BOARDS = Object.freeze([
  { key: "sales", name: "Sales", done: ["closed_won", "downsell", "lost"] },
  { key: "funding_card_stacking", name: "Funding", done: ["funded", "closed"] },
  { key: "funding_altfin", name: "Alt-Fin funding", done: ["funded", "closed"] },
  { key: "optimization", name: "Repair", done: ["program_complete", "cancelled"] },
  { key: "inquiry_removal", name: "Inquiry removal", done: ["removed", "resume_funding", "hold"] },
  { key: "ar_collections", name: "AR and collections", done: ["paid", "written_off"] },
  { key: "affiliates_white_label", name: "Partners", done: ["active", "paused"] },
  { key: "hiring", name: "Hiring", done: ["hired", "rejected", "withdrawn", "performing"] }
]);

const BOARD_NAME = new Map(BOARDS.map((b) => [b.key, b.name]));
const boardName = (key) => BOARD_NAME.get(key) || key;

/* ───────────── the stage time limits ─────────────
   Written already, so imported and not copied:
     optimization   src/repair/sla.mjs STAGE_SLA (intake 3 business days ... response_received 24 hours)
   Nothing else has a clock per stage anywhere in the repo.
     Sales      DPC-05 is 72 hours of no progress for one client (pipeline:clients), not a limit per stage.
     Funding    the 72 hour line in gap-funding.mjs is the same no-progress line, and it only reddens when
                the screen shows no next step (funding:advisor-queue). A card may legitimately wait longer.
     Inquiry    72 hours per case (inquiry:case-stuck), not per card.
   Each of those is judged by its own check. None is a stage clock, so none is copied here as one.

   AGE_LIMIT_HOURS is the one named setting per board that has no written clock. null is off. A number
   turns the check on for every stage that board does not count as finished (BOARDS[].done).
   Chris decides the numbers. They are listed on the board under "Chris decides". */
export const AGE_LIMIT_HOURS = Object.freeze({
  sales: null,
  funding_card_stacking: null,
  funding_altfin: null,
  inquiry_removal: null,
  ar_collections: null,
  affiliates_white_label: null,
  hiring: null
});

/** Boards that run on a written clock. The age check reads these; every other board is judged by AGE_LIMIT_HOURS. */
export const WRITTEN_CLOCK_BOARDS = Object.freeze(["optimization"]);

/* ───────────── stages nothing moves a card to (P5) ─────────────
   [board, stage, why]. From the board, section 3. A card landing on one of these was put there by a
   hand or by something unplanned, and nothing watches what happens next. */
export const DEAD_STAGES = Object.freeze([
  ["sales", "confirmed", "no code moves a card to Confirmed"],
  ["inquiry_removal", "removed", "mark cleared sets the case and fires inquiry.removed but never moves the card"],
  ["inquiry_removal", "hold", "a fraud alert sets a hold reason but never the Hold stage"],
  ["optimization", "round_complete", "no emitter for repair.round.complete"],
  ["optimization", "program_complete", "no clock and no check after the program ends"],
  ["optimization", "on_hold", "no event maps to On Hold"],
  ["optimization", "cancelled", "nothing emits repair.cancelled"],
  ["optimization", "round_sent", "retired by migration 161"],
  ["optimization", "bureau_processing", "retired by migration 161"],
  ["optimization", "portal_updated", "retired by migration 161"],
  ["optimization", "upgrade_invite", "retired by migration 161"],
  ["funding_altfin", "app_created", "the Alt-Fin tab was parked 2026-08-25 and no code moves a card here"],
  ["funding_altfin", "docs_stips", "the Alt-Fin tab was parked 2026-08-25 and no code moves a card here"],
  ["funding_altfin", "underwriting", "the Alt-Fin tab was parked 2026-08-25 and no code moves a card here"],
  ["funding_altfin", "offers", "the Alt-Fin tab was parked 2026-08-25 and no code moves a card here"],
  ["funding_altfin", "offer_accepted", "the Alt-Fin tab was parked 2026-08-25 and no code moves a card here"],
  ["funding_altfin", "funded", "the Alt-Fin tab was parked 2026-08-25 and no code moves a card here"],
  ["funding_altfin", "closed", "the Alt-Fin tab was parked 2026-08-25 and no code moves a card here"],
  ["ar_collections", "invoice_sent", "no code puts a card on the AR board"],
  ["ar_collections", "reminder", "no code puts a card on the AR board"],
  ["ar_collections", "escalation", "no code puts a card on the AR board"],
  ["ar_collections", "paid", "no code puts a card on the AR board"],
  ["ar_collections", "written_off", "no code puts a card on the AR board"],
  ["hiring", "onboarding", "no working transition reaches Onboarding"],
  ["hiring", "ramp", "no working transition reaches Ramp"],
  ["hiring", "performing", "no working transition reaches Performing"],
  ["hiring", "withdrawn", "nothing writes a withdraw decision"],
  ["affiliates_white_label", "recruiting", "no code places a card on Recruiting"],
  ["affiliates_white_label", "agreement_signed", "the signed stamp is saved on the partner and the card is not moved"],
  ["affiliates_white_label", "paused", "a trial that ends changes the partner and not the card"]
]);

/** The "board/stage" keys of DEAD_STAGES, the shape the SQL and the audit both use. */
export const DEAD_STAGE_KEYS = Object.freeze(DEAD_STAGES.map(([board, stage]) => `${board}/${stage}`));

/* ───────────── SQL ─────────────
   Every statement is one SELECT. No write verb, no transaction control. */

/** P1. What each column should show: same visibility rule as the board read, with no row limit. */
export const TRUTH_SQL = `
  /* gap:pipeline-count-truth */
  SELECT p.key AS pipeline,
         s.key AS stage,
         s.sort_order,
         (
           SELECT count(*)::int
             FROM cards cd
             LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = p.org_id
             LEFT JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = p.org_id
            WHERE cd.stage_id = s.id
              AND cd.pipeline_id = p.id
              AND cd.org_id = p.org_id
              AND (c.id IS NOT NULL OR pr.id IS NOT NULL)
              AND ($2::boolean OR COALESCE(c.is_demo, false) = false)
              AND (c.custom_fields->>'crm_archived_at') IS NULL
         ) AS n
    FROM pipelines p
    JOIN pipeline_stages s ON s.pipeline_id = p.id
   WHERE p.org_id = $1::uuid
   ORDER BY p.key ASC, s.sort_order ASC, s.key ASC
`;

/** P1, hiring.html. The page reads applications, not cards. All of them, then what the read hands back. */
export const HIRING_TRUTH_SQL = `
  /* gap:pipeline-hiring-truth */
  SELECT count(*)::int AS n
    FROM candidate_applications a
   WHERE a.org_id = $1::uuid
`;

/** The same joins and order as api/hiring/candidates.mjs, cut at the page's limit. */
export const HIRING_PAINTED_SQL = `
  /* gap:pipeline-hiring-painted */
  SELECT count(*)::int AS n
    FROM (
      SELECT a.id
        FROM candidate_applications a
        JOIN candidates c ON c.id = a.candidate_id
        JOIN hiring_roles r ON r.id = a.role_id
        JOIN pipeline_stages s ON s.id = a.stage_id
       WHERE a.org_id = $1::uuid
       ORDER BY s.sort_order, a.entered_stage_at DESC
       LIMIT $2::int
    ) shown
`;

/** P3. $1 org, $2 test-client pattern. Every open card with its stage and, for Repair, the date the bureau answer is due. */
export const AGE_SQL = `
  /* gap:pipeline-age */
  SELECT p.key AS pipeline,
         s.key AS stage,
         s.name AS stage_name,
         cd.id::text AS card_id,
         cd.entered_at,
         CASE WHEN p.key = 'optimization' THEN (
           SELECT min(dc.response_due_at)
             FROM dispute_cases dc
            WHERE dc.client_id = cd.client_id
              AND dc.org_id = cd.org_id
              AND dc.status NOT IN ('closed', 'cancelled')
              AND dc.response_due_at IS NOT NULL
         ) END AS response_due_at
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.org_id = cd.org_id
    JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
    LEFT JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = cd.org_id
   WHERE cd.org_id = $1::uuid
     AND (c.id IS NOT NULL OR pr.id IS NOT NULL)
     AND COALESCE(cd.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
     AND COALESCE(c.email, '') !~* $2::text
     AND (c.custom_fields->>'crm_archived_at') IS NULL
   ORDER BY cd.entered_at ASC
   LIMIT ${MAX_AGE_ROWS}
`;

/** P5. Cards sitting on the stages in DEAD_STAGES. $2 is the list of "board/stage" keys, $3 the test-client pattern. */
export const DEAD_CARDS_SQL = `
  /* gap:pipeline-dead-stage */
  SELECT p.key AS pipeline,
         s.key AS stage,
         count(cd.id)::int AS n
    FROM pipelines p
    JOIN pipeline_stages s ON s.pipeline_id = p.id
    JOIN cards cd ON cd.stage_id = s.id AND cd.pipeline_id = p.id AND cd.org_id = p.org_id
    LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
   WHERE p.org_id = $1::uuid
     AND (p.key || '/' || s.key) = ANY($2::text[])
     AND COALESCE(cd.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
     AND COALESCE(c.email, '') !~* $3::text
   GROUP BY p.key, s.key
`;

/** P5, hiring.html: applications on the stages in DEAD_STAGES. The real hiring board is these rows, not cards. */
export const DEAD_APPLICATIONS_SQL = `
  /* gap:pipeline-dead-applications */
  SELECT 'hiring' AS pipeline,
         s.key AS stage,
         count(a.id)::int AS n
    FROM candidate_applications a
    JOIN pipeline_stages s ON s.id = a.stage_id
    JOIN pipelines p ON p.id = s.pipeline_id AND p.key = 'hiring'
   WHERE a.org_id = $1::uuid
     AND ('hiring/' || s.key) = ANY($2::text[])
   GROUP BY s.key
`;

/* P6, the three ways a person gets lost. */

/** A person who paid for a product that owns a board (funding or repair) and has no card on that board. */
export const PAID_NO_CARD_SQL = `
  /* gap:pipeline-paid-no-card */
  WITH paid AS (
    SELECT s.client_id, pr.category, s.sold_at AS paid_at, 'sale' AS src
      FROM sales s
      JOIN products pr ON pr.id = s.product_id
     WHERE s.org_id = $1::uuid
       AND s.status = 'active'
       AND s.client_id IS NOT NULL
       AND COALESCE(s.is_demo, false) = false
       AND pr.category IN ('funding', 'repair')
    UNION ALL
    SELECT t.client_id, pr.category, t.created_at AS paid_at, 'payment' AS src
      FROM transactions t
      JOIN products pr ON pr.id = resolve_product_id(t.org_id, t.product_name)
     WHERE t.org_id = $1::uuid
       AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
       AND t.client_id IS NOT NULL
       AND COALESCE(t.is_demo, false) = false
       AND pr.category IN ('funding', 'repair')
  )
  SELECT c.id::text AS client_id,
         x.category,
         max(x.paid_at) AS paid_at,
         bool_or(x.src = 'sale') AS has_sale,
         count(*) OVER ()::int AS total
    FROM paid x
    JOIN clients c ON c.id = x.client_id AND c.org_id = $1::uuid
   WHERE COALESCE(c.is_demo, false) = false
     AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
     AND COALESCE(c.email, '') !~* $3::text
     AND (c.custom_fields->>'crm_archived_at') IS NULL
     AND x.paid_at < $2::timestamptz
     AND NOT EXISTS (
       SELECT 1
         FROM cards cd
         JOIN pipelines p ON p.id = cd.pipeline_id AND p.org_id = cd.org_id
        WHERE cd.client_id = c.id
          AND cd.org_id = c.org_id
          AND p.key = ANY(
                CASE WHEN x.category = 'funding'
                     THEN ARRAY['funding_card_stacking', 'funding_altfin']
                     ELSE ARRAY['optimization'] END
              )
     )
   GROUP BY c.id, x.category
   ORDER BY max(x.paid_at) ASC
   LIMIT 25
`;

/** A client archived (the card is deleted on every board) who then paid. Only a payment after the archive counts. */
export const ARCHIVED_THEN_PAID_SQL = `
  /* gap:pipeline-archived-then-paid */
  SELECT a.client_id,
         a.archived_at,
         x.paid_at,
         x.src,
         count(*) OVER ()::int AS total
    FROM (
      SELECT c.id::text AS client_id,
             c.id AS cid,
             CASE WHEN (c.custom_fields->>'crm_archived_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                  THEN (c.custom_fields->>'crm_archived_at')::timestamptz END AS archived_at
        FROM clients c
       WHERE c.org_id = $1::uuid
         AND (c.custom_fields->>'crm_archived_at') IS NOT NULL
         AND COALESCE(c.is_demo, false) = false
         AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
         AND COALESCE(c.email, '') !~* $2::text
    ) a
    JOIN LATERAL (
      SELECT t.created_at AS paid_at, 'payment' AS src
        FROM transactions t
       WHERE t.client_id = a.cid
         AND t.org_id = $1::uuid
         AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
         AND COALESCE(t.is_demo, false) = false
         AND t.created_at > a.archived_at
      UNION ALL
      SELECT s.sold_at, 'sale'
        FROM sales s
       WHERE s.client_id = a.cid
         AND s.org_id = $1::uuid
         AND s.status = 'active'
         AND COALESCE(s.is_demo, false) = false
         AND s.sold_at > a.archived_at
      ORDER BY 1 DESC
      LIMIT 1
    ) x ON a.archived_at IS NOT NULL
   ORDER BY x.paid_at DESC
   LIMIT 25
`;

/** A card whose stage belongs to some other board, so its own board cannot paint it. */
export const OFF_BOARD_SQL = `
  /* gap:pipeline-off-board */
  SELECT p.key AS pipeline,
         count(*)::int AS n
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.org_id = cd.org_id
    LEFT JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
   WHERE cd.org_id = $1::uuid
     AND s.id IS NULL
   GROUP BY p.key
   ORDER BY p.key ASC
`;

/* ───────────── small helpers ───────────── */

function clip(s, n = 400) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function row(id, status, detail, suggestedFix = null, extra = null) {
  const out = { id, status, detail: clip(detail, 500), suggestedFix: suggestedFix ? clip(suggestedFix, 300) : null };
  if (extra) Object.assign(out, extra);
  return out;
}

function errText(err) {
  return clip(err && err.message ? err.message : err, 140);
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function short(id) {
  return String(id || "").slice(0, 8);
}

/** ctx.db is what the read routes use (the plain role). The staff scope is only the fallback. */
function bind(ctx) {
  if (ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  if (typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  return null;
}

async function all(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && out.rows) || [];
}

/** One read. A throw is kept as `error` so a failed read can never look like a clean one. */
async function read(run, sql, params) {
  try {
    return { rows: await all(run, sql, params), error: null };
  } catch (err) {
    return { rows: [], error: errText(err) };
  }
}

function skipAll(why) {
  return CHECK_IDS.map((id) => row(id, "skip", why));
}

/** A written limit, as the repo says it: hours up to 72, days after. */
function limitText(ms) {
  const h = Math.round(ms / HOUR_MS);
  if (h <= 72) return `${h} ${h === 1 ? "hour" : "hours"}`;
  return `${Math.round(h / 24)} days`;
}

function hoursText(ms) {
  const h = ms / HOUR_MS;
  if (h < 48) return `${Math.max(1, Math.round(h))} ${Math.round(h) === 1 ? "hour" : "hours"}`;
  const d = Math.round(h / 24);
  return `${d} days`;
}

/* ───────────── P1 pipeline:count-true ───────────── */

/**
 * Pure. `truth` is TRUTH_SQL rows, `painted` is Map(boardKey -> Map(stageKey -> count)) of what the
 * board read really returned, `hiring` is { truth, painted } or null.
 * Returns { problems, boards, cards, biggest }.
 */
export function judgeCounts({ truth = [], painted = new Map(), hiring = null } = {}) {
  const problems = [];
  const totals = new Map();
  for (const r of truth) {
    const key = String(r.pipeline);
    const n = Number(r.n) || 0;
    totals.set(key, (totals.get(key) || 0) + n);
    const shown = painted.has(key) ? (painted.get(key).get(String(r.stage)) || 0) : null;
    if (shown === null) continue; // that board could not be read; the caller names it
    if (shown !== n) {
      problems.push({ board: key, stage: String(r.stage), db: n, shown });
    }
  }
  let biggest = { board: null, n: 0 };
  for (const [key, n] of totals) if (n > biggest.n) biggest = { board: key, n };
  const cards = [...totals.values()].reduce((a, b) => a + b, 0);
  const hiringProblem = hiring && hiring.truth !== hiring.painted
    ? { board: "hiring.html", db: hiring.truth, shown: hiring.painted }
    : null;
  return { problems, hiringProblem, boards: totals.size, cards, biggest };
}

async function checkCountTrue(run, orgId) {
  const id = "pipeline:count-true";
  const fix = `Open Pipeline. A column shows fewer cards than the database holds, so a client is on the board and not on the screen. ${NO_AUTOFIX}`;
  let demoOn;
  try {
    // The board read asks the same question first (api/dashboard/pipeline.mjs).
    demoOn = (await orgDemoModeEnabled({ query: (text, params) => run((tx) => tx.query(text, params)) }, orgId)) === true;
  } catch (err) {
    return row(id, "skip", `could not read the demo mode setting the board read starts with: ${errText(err)}`);
  }
  const truthRead = await read(run, TRUTH_SQL, [orgId, demoOn]);
  if (truthRead.error) return row(id, "skip", `could not read the cards on every board: ${truthRead.error}`);
  const truth = truthRead.rows;
  if (!truth.length) return row(id, "skip", "this company has no boards, so there is nothing to count (crm-data:pipeline-cards names that)");

  const boardKeys = [...new Set(truth.map((r) => String(r.pipeline)))];
  const painted = new Map();
  const unread = [];
  for (const key of boardKeys) {
    const stagesRead = await read(run, BOARD_STAGES_SQL, [key, orgId]);
    if (stagesRead.error) { unread.push(`${boardName(key)} (${stagesRead.error})`); continue; }
    if (!stagesRead.rows.length) { unread.push(`${boardName(key)} (the board has no columns)`); continue; }
    const cardsRead = await read(run, BOARD_CARDS_SQL, [key, orgId, BOARD_READ_LIMIT, demoOn]);
    if (cardsRead.error) { unread.push(`${boardName(key)} (${cardsRead.error})`); continue; }
    const byStageId = new Map(stagesRead.rows.map((s) => [String(s.id), String(s.key)]));
    const counts = new Map(stagesRead.rows.map((s) => [String(s.key), 0]));
    for (const card of cardsRead.rows) {
      const stage = byStageId.get(String(card.stage_id));
      // The route drops a card whose stage is not on this board. So does this count.
      if (stage) counts.set(stage, (counts.get(stage) || 0) + 1);
    }
    painted.set(key, counts);
  }

  let hiring = null;
  let hiringError = null;
  const [hTruth, hPainted] = await Promise.all([
    read(run, HIRING_TRUTH_SQL, [orgId]),
    read(run, HIRING_PAINTED_SQL, [orgId, HIRING_READ_LIMIT])
  ]);
  if (hTruth.error || hPainted.error) {
    hiringError = hTruth.error || hPainted.error;
  } else {
    hiring = { truth: Number(hTruth.rows[0] && hTruth.rows[0].n) || 0, painted: Number(hPainted.rows[0] && hPainted.rows[0].n) || 0 };
  }

  const j = judgeCounts({ truth, painted, hiring });
  const lines = [];
  for (const p of j.problems.slice(0, NAME_AT_MOST)) {
    lines.push(`${boardName(p.board)} ${p.stage} holds ${p.db} and shows ${p.shown}`);
  }
  if (j.hiringProblem) {
    lines.push(`the Hiring page holds ${j.hiringProblem.db} applications and shows ${j.hiringProblem.shown}`);
  }
  const more = j.problems.length > NAME_AT_MOST ? `, and ${j.problems.length - NAME_AT_MOST} more columns` : "";
  if (lines.length) {
    const lost = j.problems.reduce((n, p) => n + Math.max(0, p.db - p.shown), 0) +
      (j.hiringProblem ? Math.max(0, j.hiringProblem.db - j.hiringProblem.shown) : 0);
    return row(id, "FAIL", `${plural(lost, "card")} on a board ${lost === 1 ? "is" : "are"} not on the screen: ${lines.join("; ")}${more}.`, fix);
  }
  if (unread.length || hiringError) {
    const why = [...unread, ...(hiringError ? [`Hiring page (${hiringError})`] : [])];
    return row(id, "skip", `could not read every board, so the count is not proved: ${why.join("; ")}`);
  }
  const bigName = j.biggest.board ? `${boardName(j.biggest.board)} holds ${j.biggest.n} of the ${BOARD_READ_LIMIT} a board can show` : "no board has a card";
  return row(
    id,
    "PASS",
    `${plural(j.cards, "card")} on ${plural(j.boards, "board")}. Every column shows as many as the database holds. ${bigName}. The Hiring page holds ${hiring.truth} of the ${HIRING_READ_LIMIT} it can show.`
  );
}

/* ───────────── P3 pipeline:age ───────────── */

/**
 * Pure. rows are AGE_SQL rows. Returns the cards past a limit, for the boards that have one.
 * limits is AGE_LIMIT_HOURS. Boards in WRITTEN_CLOCK_BOARDS use the written clocks.
 */
export function judgeAges(rows, now, limits = AGE_LIMIT_HOURS) {
  const over = [];
  let judged = 0;
  const doneOf = new Map(BOARDS.map((b) => [b.key, new Set(b.done)]));
  for (const r of rows || []) {
    const board = String(r.pipeline);
    const stage = String(r.stage);
    const entered = r.entered_at ? new Date(r.entered_at) : null;
    if (!entered || !Number.isFinite(entered.getTime())) continue;
    const age = now.getTime() - entered.getTime();
    if (board === "optimization") {
      if (!STAGE_SLA[stage]) continue;
      judged += 1;
      const out = isBreached({ stageKey: stage, enteredAt: entered, asOf: now, responseDueAt: r.response_due_at });
      if (out.breached) over.push({ board, stage, name: r.stage_name || stage, age, limit: describeSla(STAGE_SLA[stage]) });
    } else {
      const hours = limits[board];
      if (!(Number(hours) > 0)) continue;
      if ((doneOf.get(board) || new Set()).has(stage)) continue;
      judged += 1;
      if (age > Number(hours) * HOUR_MS) over.push({ board, stage, name: r.stage_name || stage, age, limit: limitText(Number(hours) * HOUR_MS) });
    }
  }
  return { over, judged };
}

function describeSla(sla) {
  if (sla.minutes) return `${sla.minutes} minutes`;
  if (sla.hours) return `${sla.hours} ${sla.hours === 1 ? "hour" : "hours"}`;
  if (sla.days) return `${sla.days} ${sla.businessDays ? "business days" : "days"}`;
  if (sla.daysAfterDue != null) return `${sla.daysAfterDue} days after the bureau answer is due`;
  return "its limit";
}

async function checkAge(run, orgId, now) {
  const id = "pipeline:age";
  const fix = `Open Pipeline and read the stage the card sits in. The time limit is written in code; a card past it is not moving. ${NO_AUTOFIX}`;
  const read1 = await read(run, AGE_SQL, [orgId, TEST_CLIENT_EMAIL_RE]);
  if (read1.error) return row(id, "skip", `could not read the cards and their ages: ${read1.error}`);
  const { over, judged } = judgeAges(read1.rows, now);
  if (over.length) {
    const byGroup = new Map();
    for (const o of over) {
      const key = `${o.board}|${o.stage}|${o.limit}`;
      const g = byGroup.get(key) || { ...o, n: 0, oldest: 0 };
      g.n += 1;
      g.oldest = Math.max(g.oldest, o.age);
      byGroup.set(key, g);
    }
    const lines = [...byGroup.values()]
      .sort((a, b) => b.oldest - a.oldest)
      .slice(0, NAME_AT_MOST)
      .map((g) => `${boardName(g.board)} ${g.name}: ${plural(g.n, "card")} past ${g.limit} (oldest ${hoursText(g.oldest)})`);
    const more = byGroup.size > NAME_AT_MOST ? `, and ${byGroup.size - NAME_AT_MOST} more stages` : "";
    return row(id, "FAIL", `${plural(over.length, "card")} ${over.length === 1 ? "sits" : "sit"} past a stage time limit: ${lines.join("; ")}${more}.`, fix);
  }
  const boards = WRITTEN_CLOCK_BOARDS.map(boardName).join(" and ");
  const set = Object.keys(AGE_LIMIT_HOURS).filter((k) => Number(AGE_LIMIT_HOURS[k]) > 0).map(boardName);
  return row(
    id,
    "PASS",
    `${plural(judged, "card")} judged against a written time limit (${boards}${set.length ? `, and ${set.join(", ")} by its set limit` : ""}). None is past its limit.`
  );
}

/** Boards that have no written clock and no limit set. Pure. */
export function boardsWithNoLimit(limits = AGE_LIMIT_HOURS) {
  return Object.keys(limits).filter((k) => !(Number(limits[k]) > 0)).sort();
}

function ageNoLimitRow() {
  const id = "pipeline:age-no-limit";
  const boards = boardsWithNoLimit();
  if (!boards.length) {
    return row(id, "PASS", "every board has a stage time limit, written or set");
  }
  const names = boards.map(boardName);
  return row(
    id,
    "na",
    `${names.join(", ")} ${names.length === 1 ? "has" : "have"} no stage time limit written. The limit is one named setting per board (AGE_LIMIT_HOURS) and it is off. Chris sets the numbers.`,
    null,
    { na: { code: "no-limit-set", args: { check: id, boards } } }
  );
}

/* ───────────── P5 pipeline:dead-stage ───────────── */

async function checkDeadStage(run, orgId) {
  const id = "pipeline:dead-stage";
  const fix = `A card landed on a stage that no code moves a card to. Open Pipeline, find the card, and see how it got there. Nothing watches what happens to it next. ${NO_AUTOFIX}`;
  const [cards, apps] = await Promise.all([
    read(run, DEAD_CARDS_SQL, [orgId, [...DEAD_STAGE_KEYS], TEST_CLIENT_EMAIL_RE]),
    read(run, DEAD_APPLICATIONS_SQL, [orgId, [...DEAD_STAGE_KEYS]])
  ]);
  if (cards.error || apps.error) {
    return row(id, "skip", `could not read the cards on the stages nothing moves to: ${cards.error || apps.error}`);
  }
  const hits = [...cards.rows, ...apps.rows].filter((r) => Number(r.n) > 0);
  if (hits.length) {
    const why = new Map(DEAD_STAGES.map(([b, s, w]) => [`${b}/${s}`, w]));
    const total = hits.reduce((n, r) => n + Number(r.n), 0);
    const lines = hits
      .slice(0, NAME_AT_MOST)
      .map((r) => `${boardName(r.pipeline)} ${r.stage} holds ${r.n} (${why.get(`${r.pipeline}/${r.stage}`) || "no mover"})`);
    const more = hits.length > NAME_AT_MOST ? `, and ${hits.length - NAME_AT_MOST} more stages` : "";
    return row(id, "FAIL", `${plural(total, "card")} landed on ${plural(hits.length, "stage")} nothing moves a card to: ${lines.join("; ")}${more}.`, fix);
  }
  return row(
    id,
    "na",
    `${DEAD_STAGES.length} stages have no automatic mover and no card sits on one. This goes red the day a card lands.`,
    null,
    { na: { code: "no-card-on-stage", args: { check: id, orgId, stages: [...DEAD_STAGE_KEYS] } } }
  );
}

/* ───────────── P6 pipeline:nobody-lost ───────────── */

async function checkNobodyLost(run, orgId, now) {
  const id = "pipeline:nobody-lost";
  const fix = `Open Pipeline and put each person on their board by hand, or find why the move never fired. ${NO_AUTOFIX}`;
  const cut = new Date(now.getTime() - PAID_GRACE_MS).toISOString();
  const [paid, archived, off] = await Promise.all([
    read(run, PAID_NO_CARD_SQL, [orgId, cut, TEST_CLIENT_EMAIL_RE]),
    read(run, ARCHIVED_THEN_PAID_SQL, [orgId, TEST_CLIENT_EMAIL_RE]),
    read(run, OFF_BOARD_SQL, [orgId])
  ]);
  const problems = [];
  if (paid.rows.length) {
    const total = Math.max(Number(paid.rows[0].total) || 0, paid.rows.length);
    const ids = paid.rows.slice(0, NAME_AT_MOST).map((r) => `${short(r.client_id)} (${r.category})`).join(", ");
    problems.push(`${plural(total, "paying client")} ${total === 1 ? "has" : "have"} no card on the board that owns what they bought: ${ids}`);
  }
  if (archived.rows.length) {
    const total = Math.max(Number(archived.rows[0].total) || 0, archived.rows.length);
    const ids = archived.rows.slice(0, NAME_AT_MOST).map((r) => short(r.client_id)).join(", ");
    problems.push(`${plural(total, "client")} paid after being archived and ${total === 1 ? "is" : "are"} on no board: ${ids}`);
  }
  if (off.rows.length) {
    const total = off.rows.reduce((n, r) => n + Number(r.n), 0);
    const where = off.rows.slice(0, NAME_AT_MOST).map((r) => `${boardName(r.pipeline)} ${r.n}`).join(", ");
    problems.push(`${plural(total, "card")} ${total === 1 ? "sits" : "sit"} on a stage its own board does not have: ${where}`);
  }
  if (problems.length) return row(id, "FAIL", `${problems.join(". ")}.`, fix);
  const failed = [
    paid.error && `paid clients (${paid.error})`,
    archived.error && `archived clients (${archived.error})`,
    off.error && `cards off the board (${off.error})`
  ].filter(Boolean);
  if (failed.length) return row(id, "skip", `could not read everything, so nobody-lost is not proved: ${failed.join("; ")}`);
  return row(
    id,
    "PASS",
    "Every client who paid for funding or repair has a card on that board. No archived client has paid since. Every card sits on a stage of its own board."
  );
}

/* ───────────── the lane ───────────── */

/** The audit asks the lane to prove a "nothing to judge" row again. Same SQL, same keys. */
export const naVerify = Object.freeze({
  "no-card-on-stage": async (args, ctx = {}) => {
    if (!args || args.check !== "pipeline:dead-stage") return false;
    const run = bind(ctx);
    if (!run) return false;
    const orgId = args.orgId || ctx.orgId || null;
    if (!orgId || !UUID_RE.test(String(orgId))) return false;
    const keys = Array.isArray(args.stages) ? args.stages.filter((k) => typeof k === "string") : [];
    if (!keys.length) return false;
    const [cards, apps] = await Promise.all([
      all(run, DEAD_CARDS_SQL, [orgId, keys, TEST_CLIENT_EMAIL_RE]),
      all(run, DEAD_APPLICATIONS_SQL, [orgId, keys])
    ]);
    return [...cards, ...apps].every((r) => !(Number(r.n) > 0));
  },
  "no-limit-set": async (args) => {
    if (!args || args.check !== "pipeline:age-no-limit") return false;
    const boards = Array.isArray(args.boards) ? args.boards : [];
    if (!boards.length) return false;
    // Still true only while every named board has no limit. Set a number and the claim stops holding.
    return boards.every((b) => Object.hasOwn(AGE_LIMIT_HOURS, b) && !(Number(AGE_LIMIT_HOURS[b]) > 0));
  }
});

/**
 * Morning-pulse rows for the shape of every board.
 * ctx: { db, scope, now, orgId }. SELECT only. No POST. Nothing is sent.
 */
export async function gapChecks(ctx = {}) {
  const run = bind(ctx);
  if (!run) return skipAll("no database in this run — the boards were not read");
  const orgRaw = String(ctx.orgId || "").trim();
  if (!UUID_RE.test(orgRaw)) return skipAll("no company id in this run — the boards were not read");
  const now = ctx.now instanceof Date ? ctx.now : new Date();

  const [count, age, dead, lost] = await Promise.all([
    checkCountTrue(run, orgRaw).catch((err) => row("pipeline:count-true", "skip", `the count check threw: ${errText(err)}`)),
    checkAge(run, orgRaw, now).catch((err) => row("pipeline:age", "skip", `the age check threw: ${errText(err)}`)),
    checkDeadStage(run, orgRaw).catch((err) => row("pipeline:dead-stage", "skip", `the dead stage check threw: ${errText(err)}`)),
    checkNobodyLost(run, orgRaw, now).catch((err) => row("pipeline:nobody-lost", "skip", `the nobody-lost check threw: ${errText(err)}`))
  ]);
  return [count, age, ageNoLimitRow(), dead, lost];
}
