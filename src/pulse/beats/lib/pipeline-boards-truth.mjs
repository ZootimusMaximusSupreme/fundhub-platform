// The shape of every board, the half of it the hourly beat can read: does each column paint every
// card, did a card land on a stage nothing moves a card to, did anybody get lost. Report only.
// Read only. Never moves a card. Never texts. Never charges. Never pulls credit.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). These checks used to live in
// src/pulse/coverage/gap-pipeline-boards.mjs. They moved here, unchanged except for the read path,
// so the morning lane (which imports them back) and the hourly beat (beat-pipeline-boards.mjs) run
// the same SQL and the same verdicts. A beat may import only from src/pulse/beats/lib, so the truth
// lives here. pipeline:age and pipeline:age-no-limit stay in the lane: they need the Repair stage
// clocks (src/repair/sla.mjs) and the owner hold (src/pulse/owner-hold.mjs).
//
//   pipeline:count-true      P1  every column paints as many cards as the database holds
//   pipeline:dead-stage      P5  unsupported stages or missing stage evidence
//   pipeline:nobody-lost     P6  paying clients with no card, archived clients who paid, cards off the board
//
// Held copies (a beat cannot import the files they come from). beat-pipeline-boards.test.mjs fails the
// day a copy and its source differ:
//   BOARD_STAGES_SQL, BOARD_CARDS_SQL   src/pulse/coverage/gap-crm-links.mjs (the route's own reads,
//                                       api/dashboard/pipeline.mjs; a test there holds them to the route)
//   orgDemoModeEnabled                  src/demo/exclude-demo.mjs (the board read asks it first)
//   TEST_CLIENT_EMAIL_RE                src/pulse/coverage/gap-consent.mjs (via pipeline-facts-truth.mjs)

import { TEST_CLIENT_EMAIL_RE } from "./pipeline-facts-truth.mjs";

export { TEST_CLIENT_EMAIL_RE };

/** The three checks this file judges. The lane's CHECK_IDS adds the two age rows it keeps. */
export const BOARDS_TRUTH_IDS = Object.freeze([
  "pipeline:count-true",
  "pipeline:dead-stage",
  "pipeline:nobody-lost"
]);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NO_AUTOFIX = "The pulse only reports. Do not auto-fix from this pulse. Chris fixes reds.";
export const HOUR_MS = 60 * 60 * 1000;

/** The most cards the board read hands back by default (api/dashboard/pipeline.mjs, fallback 500). */
export const BOARD_READ_LIMIT = 500;
/** The most applications the hiring page's read hands back (src/http/read-api.mjs MAX_LIMIT, page asks 200). */
export const HIRING_READ_LIMIT = 200;
/** A payment this fresh is still on its way to a board. */
export const PAID_GRACE_MS = HOUR_MS;
/** The most cases of each kind named in a detail line. */
export const NAME_AT_MOST = 4;

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

export const BOARD_NAME = new Map(BOARDS.map((b) => [b.key, b.name]));
export const boardName = (key) => BOARD_NAME.get(key) || key;

/* ───────────── unsupported stages or missing stage evidence (P5) ─────────────
   [board, stage, why]. Most have no automatic mover. Sales Set has one, but a card
   there without a completed setter handoff is still unsupported. */
export const DEAD_STAGES = Object.freeze([
  ["sales", "confirmed", "a completed setter handoff is required"],
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

/* ───────────── the route's own board reads (held copies) ─────────────
   Copies of gap-crm-links.mjs BOARD_STAGES_SQL and BOARD_CARDS_SQL, which are the route's reads
   (api/dashboard/pipeline.mjs STAGES_SQL and CARDS_SQL). BOARD_CARDS_SQL is printed with
   unpricedApprovalConditions("a") (src/funding/success-fee.mjs) already filled in. */

export const BOARD_STAGES_SQL = `
  SELECT s.id, s.key, s.name, s.sort_order
    FROM pipeline_stages s
    JOIN pipelines p ON p.id = s.pipeline_id
   WHERE p.key = $1 AND p.org_id = $2
   ORDER BY s.sort_order ASC, s.name ASC
`;

/* Every board's columns in ONE read: the route's own stages read (BOARD_STAGES_SQL) for all board keys at once,
   with the board key on each row. Built from BOARD_STAGES_SQL, so the two cannot drift: a change to the route's
   read that these three swaps no longer fit throws when this file loads. One read instead of one per board keeps
   the hourly beat inside half its deadline on a slow link (ship 2026-10-21 on the GitHub runner: about 25 reads,
   6.2 s against a 10 s deadline, which stopped the ship). */
function allBoardsStagesSql(one) {
  const swaps = [
    ["SELECT s.id, s.key, s.name, s.sort_order", "SELECT p.key AS pipeline_key, s.id, s.key, s.name, s.sort_order"],
    ["WHERE p.key = $1 AND p.org_id = $2", "WHERE p.key = ANY($1::text[]) AND p.org_id = $2"],
    ["ORDER BY s.sort_order ASC, s.name ASC", "ORDER BY p.key ASC, s.sort_order ASC, s.name ASC"]
  ];
  let out = one;
  for (const [from, to] of swaps) {
    if (!out.includes(from)) throw new Error(`BOARD_STAGES_SQL changed: "${from}" is gone, so the all-boards read cannot be built`);
    out = out.replace(from, to);
  }
  return out;
}

export const BOARD_STAGES_ALL_SQL = allBoardsStagesSql(BOARD_STAGES_SQL);

export const BOARD_CARDS_SQL = `
  SELECT
    cd.id,
    cd.stage_id,
    cd.owner,
    cd.entered_at,
    c.id            AS client_id,
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    c.outcome_tier,
    c.funded,
    c.funded_amount,
    c.is_demo,
    (c.custom_fields->>'call_confirmed') = 'true' AS call_confirmed,
    CASE WHEN p.key = 'sales' THEN (
      SELECT b.starts_at
        FROM bookings b
       WHERE b.org_id = p.org_id
         AND b.client_id = c.id
         AND b.status IN ('booked', 'rescheduled')
         AND b.starts_at IS NOT NULL
       ORDER BY (b.starts_at >= NOW()) DESC,
                CASE WHEN b.starts_at >= NOW() THEN b.starts_at END ASC NULLS LAST,
                b.starts_at DESC, b.created_at DESC
       LIMIT 1
    ) ELSE NULL END AS booked_starts_at,
    CASE WHEN p.key = 'sales' THEN (
      SELECT CASE
               WHEN b.status = 'rescheduled' THEN 'rescheduled'
               WHEN EXISTS (
                 SELECT 1 FROM bookings previous
                  WHERE previous.org_id = b.org_id
                    AND previous.client_id = b.client_id
                    AND previous.id <> b.id
                    AND previous.created_at < b.created_at
               ) THEN 'rebooked'
               ELSE 'booked'
             END
        FROM bookings b
       WHERE b.org_id = p.org_id
         AND b.client_id = c.id
         AND b.status IN ('booked', 'rescheduled')
         AND b.starts_at IS NOT NULL
       ORDER BY (b.starts_at >= NOW()) DESC,
                CASE WHEN b.starts_at >= NOW() THEN b.starts_at END ASC NULLS LAST,
                b.starts_at DESC, b.created_at DESC
       LIMIT 1
    ) ELSE NULL END AS booked_kind,
    (c.custom_fields->>'total_funding_estimate') AS total_funding_estimate,
    c.custom_fields->>'cf_svy_self_reported_fico' AS survey_fico_raw,
    c.custom_fields->>'cf_svy_self_reported_fico_label' AS survey_fico_label,
    pr.name AS partner_name,
    pr.contact_email AS partner_email,
    EXISTS (
      SELECT 1
        FROM conversations conv
        JOIN LATERAL (
          SELECT m.direction
            FROM messages m
           WHERE m.conversation_id = conv.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1
        ) last ON true
       WHERE conv.client_id = c.id
         AND conv.org_id = p.org_id
         AND conv.channel IN ('sms', 'text')
         AND last.direction = 'inbound'
    ) AS sms_needs_reply,
    EXISTS (
      SELECT 1
        FROM conversations conv
        JOIN LATERAL (
          SELECT m.direction
            FROM messages m
           WHERE m.conversation_id = conv.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1
        ) last ON true
       WHERE conv.client_id = c.id
         AND conv.org_id = p.org_id
         AND conv.channel = 'email'
         AND last.direction = 'inbound'
    ) AS email_needs_reply,
    (
      p.key IN ('funding_card_stacking', 'funding_altfin')
      AND EXISTS (
        SELECT 1
          FROM applications a
         WHERE a.client_id = c.id
           AND a.org_id = p.org_id
           AND a.status = 'Approved'
   AND a.approval_excluded_at IS NULL
   AND (a.approved_amount IS NULL OR a.approved_amount <= 0)
           AND a.funding_round_id = (
                 SELECT fr.id
                   FROM funding_rounds fr
                  WHERE fr.client_id = c.id
                    AND fr.org_id = p.org_id
                  ORDER BY fr.round_number DESC, fr.created_at DESC
                  LIMIT 1
               )
      )
    ) AS approval_amount_missing
  FROM cards cd
  JOIN pipelines p ON p.id = cd.pipeline_id
  LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = p.org_id
  LEFT JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = p.org_id
  WHERE p.key = $1 AND p.org_id = $2 AND cd.org_id = $2
    AND (c.id IS NOT NULL OR pr.id IS NOT NULL)
    AND ($4::boolean OR COALESCE(c.is_demo, false) = false)
    AND (c.custom_fields->>'crm_archived_at' IS NULL)
  ORDER BY cd.entered_at DESC
  LIMIT $3
`;

/** A copy of src/demo/exclude-demo.mjs orgDemoModeEnabled: same SQL, same answer. */
export async function orgDemoModeEnabled(db, orgId) {
  if (!orgId) return false;
  const r = await db.query(`SELECT demo_mode_enabled FROM orgs WHERE id = $1`, [orgId]);
  return r.rows[0]?.demo_mode_enabled === true;
}

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
     AND (p.key <> 'sales' OR s.key <> 'confirmed'
          OR NULLIF(c.custom_fields->'setter_handoff'->>'complete_at', '') IS NULL)
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

export function clip(s, n = 400) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

export function row(id, status, detail, suggestedFix = null, extra = null) {
  const out = { id, status, detail: clip(detail, 500), suggestedFix: suggestedFix ? clip(suggestedFix, 300) : null };
  if (extra) Object.assign(out, extra);
  return out;
}

export function errText(err) {
  return clip(err && err.message ? err.message : err, 140);
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function short(id) {
  return String(id || "").slice(0, 8);
}

export async function all(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && out.rows) || [];
}

/** One read. A throw is kept as `error` so a failed read can never look like a clean one. */
export async function read(run, sql, params) {
  try {
    return { rows: await all(run, sql, params), error: null };
  } catch (err) {
    return { rows: [], error: errText(err) };
  }
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

export async function checkCountTrue(run, orgId) {
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
  // Every board's columns in one read (BOARD_STAGES_ALL_SQL); the cards stay one read per board, as the route reads them.
  const allStages = await read(run, BOARD_STAGES_ALL_SQL, [boardKeys, orgId]);
  const stagesByBoard = new Map(boardKeys.map((key) => [key, []]));
  if (!allStages.error) {
    for (const s of allStages.rows) {
      const key = String(s.pipeline_key);
      if (stagesByBoard.has(key)) stagesByBoard.get(key).push(s);
    }
  }
  for (const key of boardKeys) {
    if (allStages.error) { unread.push(`${boardName(key)} (${allStages.error})`); continue; }
    const stagesRead = { rows: stagesByBoard.get(key) };
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

/* ───────────── P5 pipeline:dead-stage ───────────── */

export async function checkDeadStage(run, orgId) {
  const id = "pipeline:dead-stage";
  const fix = `A card landed on an unsupported stage or is missing its required workflow evidence. Open Pipeline, find the card, and check how it got there. ${NO_AUTOFIX}`;
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

export async function checkNobodyLost(run, orgId, now) {
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

/* ───────────── the runner ───────────── */

const RUNNERS = Object.freeze({
  "pipeline:count-true": [(run, orgId) => checkCountTrue(run, orgId), "the count check threw"],
  "pipeline:dead-stage": [(run, orgId) => checkDeadStage(run, orgId), "the dead stage check threw"],
  "pipeline:nobody-lost": [(run, orgId, now) => checkNobodyLost(run, orgId, now), "the nobody-lost check threw"]
});

/**
 * Rows for the three board checks, in BOARDS_TRUTH_IDS order (only the ids in `only`).
 * io: { run, orgId, now }. run is (fn) => fn(tx) where tx.query(sql, params) reads one statement.
 * The hourly beat builds run from the read box. SELECT only. No POST. Nothing is sent.
 */
export async function runBoardsChecks(io = {}, { only = BOARDS_TRUTH_IDS } = {}) {
  const ids = BOARDS_TRUTH_IDS.filter((id) => only.includes(id));
  const skipEach = (why) => ids.map((id) => row(id, "skip", why));
  const run = typeof io.run === "function" ? io.run : null;
  if (!run) return skipEach("no database in this run — the boards were not read");
  const orgRaw = String(io.orgId || "").trim();
  if (!UUID_RE.test(orgRaw)) return skipEach("no company id in this run — the boards were not read");
  const now = io.now instanceof Date ? io.now : new Date();
  return Promise.all(ids.map((id) => {
    const [check, threw] = RUNNERS[id];
    return check(run, orgRaw, now).catch((err) => row(id, "skip", `${threw}: ${errText(err)}`));
  }));
}
