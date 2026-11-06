// One read-only judge for the daily and hourly OffersIQ sort checks.
// No provider request is made. Only saved rule receipts are read.
import { classifyOffersIqReceipt, isOffersIqStarterReceipt } from "../../../finance/offersiq-lead-sort.mjs";
import { OFFERSIQ_LEAD_SORT_CONFIG } from "../../../finance/offersiq-lead-sort-config.mjs";

export const CHECK_IDS = Object.freeze(["offersiq-lead-sort:integrity"]);
export const NOTHING_TO_JUDGE = "offersiq-sort-not-ready";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// A bounded read must fail closed if it cannot judge the complete ledger.
export const RECEIPT_LIMIT = 5000;
export const FINISHED_RECEIPTS_SQL = `
/* gap:offersiq-lead-sort-finished */
SELECT r.rule_set_id, r.environment, r.identity_fingerprint,
       (c.id IS NOT NULL) AS client_in_org,
       COALESCE(r.lead_sort_receipt, r.normalized_response) AS receipt,
       r.lead_sort_bucket, r.lead_sort_points, r.lead_sort_version,
       r.lead_sort_reasons, r.lead_sort_result
  FROM offersiq_requests r
  LEFT JOIN clients c ON c.id = r.client_id AND c.org_id = r.org_id
 WHERE r.org_id = $1::uuid
   AND r.status IN ('matched', 'not_matched', 'needs_review', 'error')
 ORDER BY r.id
 LIMIT ${RECEIPT_LIMIT + 1}
`.trim();

const FIX = "Read the saved OffersIQ rule list and sort config, then rescore the saved receipts. " +
  "Wait for CRS to load the agreed rules before using the free reevaluation tool. " +
  "Never start a paid check from the heartbeat.";
const row = (status, detail, suggestedFix = null) => ({ id: CHECK_IDS[0], status, detail, suggestedFix });
const isPlain = value => value !== null && typeof value === "object" && !Array.isArray(value);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isPlain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const sameJson = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function receiptBelongsToRow(receipt, saved) {
  return isPlain(receipt)
    && Number(receipt.rule_set_id ?? receipt.ruleSetId) === Number(saved.rule_set_id)
    && receipt.environment === saved.environment
    && typeof receipt.identity_fingerprint === "string"
    && /^[a-f0-9]{64}$/.test(receipt.identity_fingerprint)
    && receipt.identity_fingerprint === saved.identity_fingerprint;
}

/** No receipt values, client ids or names leave this judge. */
export function judgeOffersIqLeadSort(rows, { orgId, config = OFFERSIQ_LEAD_SORT_CONFIG } = {}) {
  if (!Array.isArray(rows)) return row("FAIL", "OffersIQ sort receipt read returned no usable list.", FIX);
  if (rows.length > RECEIPT_LIMIT) return row("FAIL", "OffersIQ sort has more saved checks than this run can judge; the full ledger was not proved.", FIX);
  let starters = 0;
  let mismatches = 0;
  let missing = 0;
  let wrong = 0;
  for (const saved of rows) {
    if (!isPlain(saved) || saved.client_in_org === false || !receiptBelongsToRow(saved.receipt, saved)) {
      mismatches += 1;
      continue;
    }
    if (isOffersIqStarterReceipt(saved.receipt)) {
      starters += 1;
      continue;
    }
    const expected = classifyOffersIqReceipt(saved.receipt, config);
    // A trustworthy no-file response has no evaluated questions. Its stored
    // Can't tell result still has to match, but it does not prove rule drift.
    if (!["matched", "not_evaluated"].includes(expected.ruleListStatus)) mismatches += 1;
    if (saved.lead_sort_bucket == null || saved.lead_sort_points == null || saved.lead_sort_version == null
        || saved.lead_sort_reasons == null || saved.lead_sort_result == null) {
      missing += 1;
      continue;
    }
    if (saved.lead_sort_bucket !== expected.bucket || saved.lead_sort_points !== expected.points
        || saved.lead_sort_version !== expected.version || !sameJson(saved.lead_sort_reasons, expected.reasons)
        || !sameJson(saved.lead_sort_result, expected)) wrong += 1;
  }
  if (mismatches + missing + wrong > 0) {
    return row("FAIL", `${mismatches} saved OffersIQ checks have a rule list mismatch; ${missing} have no complete bucket; ${wrong} have stale or wrong sort data.`, FIX);
  }
  if (rows.length === starters) {
    const why = rows.length ? "starter_only" : "no_finished_receipts";
    return {
      ...row("na", rows.length
        ? `${starters} saved OffersIQ checks have the exact CRS starter rules. Nothing to judge until CRS loads the sort rules.`
        : "No finished OffersIQ checks are saved for this company. Nothing to judge yet."),
      na: { code: NOTHING_TO_JUDGE, args: { orgId, version: config.version, why, check: CHECK_IDS[0] } }
    };
  }
  return row("PASS", `${rows.length - starters} finished OffersIQ checks have the current bucket and points; ${starters} exact starter checks wait for CRS.`);
}

export async function checkOffersIqLeadSort({ read, orgId, config = OFFERSIQ_LEAD_SORT_CONFIG } = {}) {
  if (typeof read !== "function") return row("skip", "No database in this run, so saved OffersIQ sort data was not read.");
  if (typeof orgId !== "string" || !UUID.test(orgId)) return row("skip", "No company in this run, so saved OffersIQ sort data was not read.");
  try {
    const found = await read(FINISHED_RECEIPTS_SQL, [orgId]);
    return judgeOffersIqLeadSort(found?.rows, { orgId, config });
  } catch {
    // Provider payloads or database diagnostics can contain private data.
    return row("FAIL", "The saved OffersIQ sort data could not be read. The bucket check was not proved.", FIX);
  }
}

export async function verifyOffersIqSortNothingToJudge(args, { read } = {}) {
  if (!isPlain(args) || args.check !== CHECK_IDS[0] || args.version !== OFFERSIQ_LEAD_SORT_CONFIG.version
      || !["starter_only", "no_finished_receipts"].includes(args.why)) return false;
  const result = await checkOffersIqLeadSort({ read, orgId: args.orgId });
  return result.status === "na" && result.na?.args?.why === args.why;
}
