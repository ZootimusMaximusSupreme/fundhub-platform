// Three bureau reports in, ONE stored payload out.
//
// WHY ONE ROW AND NOT THREE. `crs_results` is the record of a pull, and a
// tri-bureau prequal is one pull that asked three questions. Writing a row per
// bureau would make "the client's latest credit result" a query with a tie to
// break, and every reader in this repo — triMerge, toBureaus, the inquiry gate,
// the sales cockpit — is written against one row.
//
// SHAPED FOR THE READERS THAT ALREADY EXIST, NOT FOR ITS OWN ELEGANCE:
//
//   tradelines[]   top level, because src/tradelines/index.mjs looks for a
//                  top-level `tradelines` container and will not go hunting.
//   scores{ex,eq,tu}  the key names triMerge and toBureaus already read.
//   inquiries[]    each carrying `source` as a bureau CODE, because
//                  src/inquiry-ops/extract-disputables.mjs reads `source` and
//                  would not recognise the vendor's `sourceType`.
//   bureaus{}      the full per-bureau report, unflattened, so nothing this
//                  mapper failed to understand is lost.
//
// WHAT IT REFUSES TO DO. It does not decide an outcome tier, it does not score
// the client, and it does not reconcile the same account appearing on two
// bureaus beyond the vendor's own account identifier. See DEDUPLICATION below —
// that limit is a known gap, recorded rather than papered over.

import { parseBureaus } from "../lenders/match.mjs";
import { maskSsn } from "../pii/index.mjs";
/* pickCreditScore, asArray and asInt live in src/pulse/beats/lib/lenders-credit.mjs (2026-10-20) so the
   hourly lender-book beat reads the credit file the same way. One copy; re-exported below. */
import { asArray, asInt, pickCreditScore } from "../pulse/beats/lib/lenders-credit.mjs";

export { pickCreditScore };

/** Bureau codes, in the order a merged payload lists them. */
export const BUREAU_CODES = Object.freeze(["TU", "EX", "EQ"]);

const SCORE_KEY = Object.freeze({ TU: "tu", EX: "ex", EQ: "eq" });

/* bureauOf — the vendor's `sourceType` ("TransUnion") → a bureau code ("TU").
   parseBureaus already owns every spelling of a bureau name in this repo, so
   this reuses it rather than starting a second list that can disagree. */
export function bureauOf(sourceType) {
  const codes = parseBureaus(sourceType);
  return codes.find((c) => BUREAU_CODES.includes(c)) || null;
}

function isoDate(value) {
  const s = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Bureau-refused the file (E4000 invalid DOB, etc.). Not a score. */
export function bureauHardErrors(report) {
  const msgs = asArray(report?.errorMessages)
    .map((m) => {
      const code = String(m?.creditErrorMessageCode || "").trim();
      const text = String(m?.creditErrorMessageText || "").trim();
      if (!code && !text) return null;
      return [code, text].filter(Boolean).join(" ");
    })
    .filter(Boolean);
  return msgs.length ? msgs.join("; ") : null;
}

/**
 * Per-bureau result of one pull. A pull counts as done at a bureau only when a
 * file came back (spec docs/specs/roadmap-checkout-soft-pull-2026-09-22.md §4).
 */
export const BUREAU_FILE_STATUS = Object.freeze({
  FILE_RETURNED: "file_returned",
  FROZEN: "frozen",
  NO_FILE: "no_file",
  ERROR: "error"
});

/** The vendor's own words: creditFiles[].creditFileDetail.creditFileResultStatusType. */
export function creditFileStatuses(report) {
  return asArray(report?.creditFiles)
    .map((f) => String(f?.creditFileDetail?.creditFileResultStatusType ?? "").trim())
    .filter(Boolean);
}

/**
 * classifyBureauReport — file_returned | frozen | no_file | error.
 *
 * WHAT IS KNOWN, AND WHAT IS NOT (spec independent check #9). Two status values
 * are documented: `FileReturned` (every vendor test file) and
 * `NoFileReturnedCreditFreeze` (seen once in production, a frozen Equifax
 * file). No no-hit value is documented. So:
 *   FileReturned                → file_returned
 *   anything naming a freeze    → frozen
 *   any other NoFileReturned…   → no_file   (read off the value's own words)
 *   errorMessages on the report → error     (E4000 bad birth date and the like)
 *   no status at all            → file_returned, as before. Older payloads and
 *                                 the sandbox fixtures carry the report with no
 *                                 creditFiles status, and nothing documents that
 *                                 as a miss.
 * An unrecognised status string is also left as file_returned, with the raw
 * value kept beside it on the stored payload so a human can see it.
 */
export function classifyBureauReport(report) {
  if (!report || typeof report !== "object") return BUREAU_FILE_STATUS.ERROR;
  if (bureauHardErrors(report)) return BUREAU_FILE_STATUS.ERROR;
  const raw = creditFileStatuses(report);
  if (raw.some((s) => s.toLowerCase() === "filereturned")) return BUREAU_FILE_STATUS.FILE_RETURNED;
  if (raw.some((s) => /freeze|frozen/i.test(s))) return BUREAU_FILE_STATUS.FROZEN;
  if (raw.some((s) => /^nofile/i.test(s))) return BUREAU_FILE_STATUS.NO_FILE;
  return BUREAU_FILE_STATUS.FILE_RETURNED;
}

/* redactRequestEcho — CRS echoes the identity it was asked about, SSN included,
   back inside every report.

   That echo is stored verbatim unless something removes it, and `crs_results`
   is not an encrypted column: this repo keeps full SSNs in `pii_identity`,
   encrypted, precisely so that no second plaintext copy exists. Storing the
   bureau's echo would quietly create one. The last four survive, which is all
   any screen or reconciliation needs. */
function redactRequestEcho(report) {
  const echo = report?.requestData;
  if (!echo || typeof echo !== "object") return report;
  const { ssn, ...rest } = echo;
  return {
    ...report,
    requestData: { ...rest, ssnLast4: maskSsn(ssn), ssnRedacted: true }
  };
}

/**
 * mergeBureauReports — the whole job.
 *
 * @param {object} input
 * @param {object} input.reports        { TU?: report, EX?: report, EQ?: report }
 * @param {object} [input.errors]       { EQ: "why it failed" }
 * @param {object} [input.statuses]     { EQ: "frozen" } — per bureau, from the
 *                                      client. A bureau with a report and no
 *                                      entry is classified off its report.
 * @param {object} [input.requestIds]   { TU: "..." } — the vendor's own ids
 * @param {string} [input.environment]  "sandbox" | "production"
 * @param {string} [input.pulledAt]     ISO timestamp
 */
export function mergeBureauReports({
  reports = {},
  errors = {},
  statuses = {},
  requestIds = {},
  environment = null,
  pulledAt = new Date().toISOString()
} = {}) {
  const scores = { ex: null, eq: null, tu: null };
  const scoreModels = { ex: null, eq: null, tu: null };
  const tradelines = [];
  const inquiries = [];
  const publicRecords = [];
  const bureaus = {};
  const bureausPulled = [];

  for (const code of BUREAU_CODES) {
    const report = reports[code];
    if (!report || typeof report !== "object") continue;

    bureausPulled.push(code);
    bureaus[code] = redactRequestEcho(report);

    const hard = bureauHardErrors(report);
    if (hard && !errors[code]) errors[code] = hard;

    const { value, model } = pickCreditScore(report.scores);
    scores[SCORE_KEY[code]] = value;
    scoreModels[SCORE_KEY[code]] = model;

    /* DEDUPLICATION, AND WHERE IT STOPS.
       Every bureau's lines are carried through. Where two bureaus report the
       same `accountIdentifier`, the unique index on (client_id, account_ref)
       collapses them on ingest — that is the vendor's own identifier agreeing
       with itself, not a guess.
       Where the identifiers DIFFER, both lines survive as separate tradelines,
       even if they are the same physical card. Matching them would take a
       heuristic on creditor name, open date and limit, and a wrong match either
       hides a real account or invents available credit — both of which move a
       funding number. Nobody has decided that rule, so this mapper does not
       invent one. Recorded as an open question on the workflow board. */
    for (const line of asArray(report.tradelines)) {
      if (line && typeof line === "object") tradelines.push(line);
    }

    for (const inq of asArray(report.inquiries)) {
      if (!inq || typeof inq !== "object") continue;
      inquiries.push({
        ...inq,
        // `source` as a bureau CODE: what extract-disputables reads. The
        // vendor's own sourceType is left in place beside it.
        source: bureauOf(inq.sourceType) || code,
        date: isoDate(inq.inquiryDate)
      });
    }

    for (const rec of asArray(report.publicRecords)) {
      if (rec && typeof rec === "object") publicRecords.push({ ...rec, source: code });
    }
  }

  /* One word per bureau that was asked: file_returned | frozen | no_file |
     error. A bureau nobody asked is absent, not "error". */
  const bureauStatus = {};
  for (const code of BUREAU_CODES) {
    const given = statuses?.[code];
    if (given) bureauStatus[code] = given;
    else if (reports[code] && typeof reports[code] === "object") bureauStatus[code] = classifyBureauReport(reports[code]);
    else if (errors[code]) bureauStatus[code] = BUREAU_FILE_STATUS.ERROR;
  }

  return {
    source: "crs",
    product: "prequal-fico9",
    environment,
    pulledAt,

    // Both spellings on purpose: the underscored one is the format
    // parseBureaus() consumes elsewhere in this repo, the array is what code
    // reads without parsing.
    bureausPulled,
    bureaus_pulled: bureausPulled.join("/"),

    scores,
    scoreModels,

    tradelines,
    inquiries,
    publicRecords,

    // Per-bureau, whole and unflattened. Anything this mapper did not
    // understand is still here.
    bureaus,

    // A bureau that failed is a fact about the pull, kept beside the ones that
    // worked. An empty object means all three answered.
    bureauErrors: { ...errors },
    bureauStatus,
    requestIds: { ...requestIds }
  };
}

/**
 * newInquiriesFor — the `{ bureau, inquiry }` pairs the analysis.completed
 * payload carries. Same shape src/adapters/crs.mjs already emits, so the
 * downstream handlers do not learn a second one.
 */
export function newInquiriesFor(merged) {
  return asArray(merged?.inquiries)
    .filter((i) => i && i.source && i.creditorName)
    .map((i) => ({ bureau: i.source, inquiry: i.creditorName, date: i.date ?? null }));
}
