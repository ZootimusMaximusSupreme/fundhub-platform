// Real funding work — the one place the pulse decides what counts as REAL.
//
// Owner facts (2026-10-20, final): "There are zero funding rounds." Every round
// in the database today is test or fake. Fake work must never raise a red, and
// when there is no real work the row says "nothing to judge" with a reason the
// morning audit checks again (src/pulse/na-conditions.mjs), never a quiet PASS.
//
// Real means: not marked demo, and not on a client marked demo. A row whose
// client is gone and was never marked demo still counts as real, so a broken
// real record is judged, not hidden.
//
// READ ONLY. Every function here is a SELECT.

/* A funding_rounds row `fr` is real. */
export const REAL_ROUND_SQL = `COALESCE(fr.is_demo, false) = false
     AND NOT EXISTS (SELECT 1 FROM clients rdc WHERE rdc.id = fr.client_id AND COALESCE(rdc.is_demo, false) = true)`;

/* An events row `e` is real. */
export const REAL_EVENT_SQL = `COALESCE(e.is_demo, false) = false
     AND NOT EXISTS (SELECT 1 FROM clients rdc WHERE rdc.id = e.client_id AND COALESCE(rdc.is_demo, false) = true)`;

/* An application_decisions row `d` is real: its application is not demo and not on a demo client. */
export const REAL_DECISION_SQL = `NOT EXISTS (
       SELECT 1 FROM applications rda
         LEFT JOIN clients rdc ON rdc.id = rda.client_id
        WHERE rda.id = d.application_id
          AND (COALESCE(rda.is_demo, false) = true OR COALESCE(rdc.is_demo, false) = true))`;

/* How much real funding work exists: rounds, card-stacking round receipts and bank decisions. */
export const REAL_FUNDING_COUNT_SQL = `
SELECT (SELECT count(*)::int FROM funding_rounds fr
         WHERE fr.org_id = $1::uuid AND ${REAL_ROUND_SQL}) AS rounds,
       (SELECT count(*)::int FROM events e
         WHERE e.org_id = $1::uuid AND e.name LIKE 'round.%'
           AND e.payload->>'source' = 'card_stacking' AND ${REAL_EVENT_SQL}) AS receipts,
       (SELECT count(*)::int FROM application_decisions d
         WHERE d.org_id = $1::uuid AND ${REAL_DECISION_SQL}) AS decisions`;

/* Real clients the 72-hour no-progress line watches ($2: the DPC-05 client tags). */
export const REAL_WATCHED_CLIENT_COUNT_SQL = `
SELECT count(*)::int AS n
  FROM clients
 WHERE org_id = $1::uuid
   AND tags && $2::text[]
   AND COALESCE(is_demo, false) = false`;

/* The display controls whose saved result is a funding-round receipt or a bank
   decision. Only these rows may say "no real funding round". */
export const FUNDING_ROUND_CONTROLS = Object.freeze([
  "Mark round submitted button",
  "Mark funded… button, amount box, Save funded, Cancel",
  "Close round button",
  "Lender row: Approved $ amount input",
  "Lender row: Approved button",
  "Lender row: Declined button",
  "Lender row: Doesn't count / Count again button (exclude or reinstate an approval, asks for a reason)",
  "Funded amount prompt (window.prompt, up to 3 tries; blank or cancel abandons the move, never sends zero)",
]);

/* The funding lane rows that judge stalled rounds. */
export const FUNDING_STALL_ROWS = Object.freeze(["funding:round-stuck", "funding:submit-path"]);

export const NO_REAL_FUNDING_CODE = "no-real-funding-round";
export const NO_REAL_WATCHED_CLIENT_CODE = "no-real-client-on-watch";

/** True when this row may carry the no-real-funding-round reason. */
export function isFundingRoundRow(id) {
  const text = String(id || "");
  if (FUNDING_STALL_ROWS.includes(text)) return true;
  if (!text.startsWith("catalog-display:")) return false;
  return FUNDING_ROUND_CONTROLS.some((control) => text.endsWith(`:${control}`));
}

/** { rounds, receipts, decisions, total } of real funding work for one company. */
export async function countRealFunding(query, orgId) {
  const rows = await query(REAL_FUNDING_COUNT_SQL, [orgId]);
  const row = rows?.[0] || {};
  const rounds = Number(row.rounds || 0);
  const receipts = Number(row.receipts || 0);
  const decisions = Number(row.decisions || 0);
  return { rounds, receipts, decisions, total: rounds + receipts + decisions };
}

/** How many real clients the 72-hour no-progress line watches. tags: the DPC-05 client tags. */
export async function countRealWatchedClients(query, orgId, tags) {
  const rows = await query(REAL_WATCHED_CLIENT_COUNT_SQL, [orgId, tags]);
  return Number(rows?.[0]?.n || 0);
}

/** The "nothing to judge" proof a funding row carries. */
export function noRealFundingNa(orgId) {
  return { code: NO_REAL_FUNDING_CODE, args: { orgId: String(orgId || "") } };
}
