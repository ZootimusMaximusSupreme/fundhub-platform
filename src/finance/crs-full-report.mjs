// The full credit report a client gets after every real soft pull.
// src/handlers/crs-full-report.mjs saves it, emails it and lists it per pull.
//
// WHAT IT LOOKS LIKE (Chris, 2026-11-07: "the real ones from CRS that we
// rebranded... basic credit reports with the Fundhub stuff on it"). A standard
// consumer credit report with the Fundhub wordmark on top: the client's name and
// the report date, the score from each bureau, a summary, every account with its
// payment history, the inquiries, public records, then personal info.
//
// NOTHING IS MADE UP. Every value is read from the saved bureau report. A value
// a bureau did not send prints "—", never 0. The summary only counts saved rows,
// and card use is that bureau's own open card balances over its own open card
// limits. No account is matched across bureaus (crs-map.mjs, DEDUPLICATION, says
// why), so each bureau keeps its own list. Social Security numbers, birth dates
// and full account numbers are never printed: an account shows its last 4.
//
// ONE VIEW, TWO DRAWINGS. creditReportView() reads the saved result once. The
// PDF (what is saved, emailed and opened) and the HTML page draw that one view.
import { PDFDocument, PDFString, StandardFonts, rgb } from "pdf-lib";
import { BOOK_CALL_URL } from "../deliverables/chrome.mjs";
import { esc } from "../deliverables/escape.mjs";
import { classifyBureauReport, pickCreditScore } from "./crs-map.mjs";
import { WORDMARK_BOX, WORDMARK_GROUP, WORDMARK_SVG, wordmarkPdfPaths } from "./fundhub-wordmark.mjs";

/* Experian, Equifax, TransUnion: the order of the score cards on the old report
   and of every Finance OS credit screen. `key` is the merged payload's scores key. */
export const REPORT_BUREAUS = Object.freeze([
  Object.freeze({ code: "EX", key: "ex", name: "Experian" }),
  Object.freeze({ code: "EQ", key: "eq", name: "Equifax" }),
  Object.freeze({ code: "TU", key: "tu", name: "TransUnion" })
]);

/* The pull's own per-bureau word (crs-map.mjs BUREAU_FILE_STATUS), in plain words. */
const STATUS_WORDS = Object.freeze({ frozen: "Frozen", no_file: "No file", error: "Did not load", not_pulled: "Not pulled" });

/* Payment history. Each character of paymentPatternData is one month, newest
   first from paymentPatternStartDate (vendor/underwriteiq-crs/metro2-violation-
   checker.js reads it the same way: "left = newest"). The letters are the same
   scale as currentRatingCode; the vendor's own files pair C=AsAgreed,
   2=Late60Days, 7=BankruptcyOrWageEarnerPlan, 9=ChargeOff and -=NoDataAvailable.
   Any other character prints as itself. */
export const HISTORY_MONTHS = 24;
const HISTORY_CODES = Object.freeze({
  C: { label: "OK", tone: "ok", words: "On time" },
  1: { label: "30", tone: "late", words: "30 days late" },
  2: { label: "60", tone: "late", words: "60 days late" },
  3: { label: "90", tone: "bad", words: "90 days late" },
  4: { label: "120", tone: "bad", words: "120 days late" },
  5: { label: "150", tone: "bad", words: "150 days late" },
  6: { label: "180", tone: "bad", words: "180 days late" },
  7: { label: "BK", tone: "bad", words: "Bankruptcy" },
  8: { label: "RF", tone: "bad", words: "Repossession or foreclosure" },
  9: { label: "CO", tone: "bad", words: "Charged off or collection" },
  X: { label: "–", tone: "none", words: "No data" },
  "-": { label: "–", tone: "none", words: "No data" }
});
export const HISTORY_KEY = "OK on time · 30 to 180 days late · CO charged off · BK bankruptcy · RF repo or foreclosure · – no data";

/* Plain words for the vendor's own type and status words. A word not listed is
   split into words as the bureau sent it ("MedicalDebt" -> "Medical debt"). */
const LOAN_WORDS = Object.freeze({
  CreditCard: "Credit card", ChargeAccount: "Charge card", SecuredCreditCard: "Secured card",
  CheckCreditOrLineOfCredit: "Line of credit", Automobile: "Auto loan", InstallmentLoan: "Installment loan",
  Unsecured: "Unsecured loan", Secured: "Secured loan", Educational: "Student loan",
  FHARealEstateMortgage: "FHA mortgage", VARealEstateMortgage: "VA mortgage",
  ConventionalRealEstateMortgage: "Mortgage", UnknownLoanType: null
});
const ACCOUNT_WORDS = Object.freeze({ Revolving: "Revolving", Installment: "Installment", Mortgage: "Mortgage", Open: "Open account", Unknown: null });
const OWNER_WORDS = Object.freeze({
  Individual: "Individual", JointContractualLiability: "Joint", JointParticipating: "Joint",
  AuthorizedUser: "Authorized user", Comaker: "Co-signer", Undesignated: null
});
const RATING_WORDS = Object.freeze({
  AsAgreed: "Paid as agreed", Late30Days: "30 days late", Late60Days: "60 days late", Late90Days: "90 days late",
  LateOver120Days: "120+ days late", ChargeOff: "Charged off", Collection: "Collection",
  CollectionOrChargeOff: "Collection or charge-off", BankruptcyOrWageEarnerPlan: "Bankruptcy",
  Foreclosure: "Foreclosure", Repossession: "Repossession", ForeclosureOrRepossession: "Foreclosure or repossession",
  TooNew: "Too new to rate", NoDataAvailable: null
});
const RECORD_WORDS = Object.freeze({
  BankruptcyChapter7: "Bankruptcy, Chapter 7", BankruptcyChapter11: "Bankruptcy, Chapter 11",
  BankruptcyChapter12: "Bankruptcy, Chapter 12", BankruptcyChapter13: "Bankruptcy, Chapter 13"
});
const MONTHS = Object.freeze(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);

const asArray = (value) => (Array.isArray(value) ? value : []);
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function text(value) {
  if (value == null || typeof value === "object") return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s || null;
}
function wholeNumber(value) {
  const s = text(value);
  return s && /^\d+$/.test(s) ? Number(s) : null;
}

/** A bureau amount ("4798", 4798, "1,200.50") as integer cents. Unknown is null. */
export function amountCents(value) {
  if (value == null || typeof value === "boolean" || typeof value === "object") return null;
  const s = String(value).replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Whole dollars when the cents are whole, which bureau amounts always are. */
export function money(cents) {
  if (!Number.isSafeInteger(cents)) return "—";
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD",
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
}

function dateParts(value) {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(text(value) || "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : null;
  if (month < 1 || month > 12 || (day !== null && (day < 1 || day > 31))) return null;
  return { year, month, day };
}
const sortKey = (value) => {
  const p = dateParts(value);
  return p ? p.year * 10000 + p.month * 100 + (p.day || 0) : -1;
};
function monthYear(value) {
  const p = dateParts(value);
  return p ? `${MONTHS[p.month - 1]} ${p.year}` : null;
}
function fullDate(value) {
  const p = dateParts(value);
  if (!p) return null;
  return p.day ? `${MONTHS[p.month - 1]} ${p.day}, ${p.year}` : `${MONTHS[p.month - 1]} ${p.year}`;
}

/** The pull's moment as a day on the company clock (Arizona, owner-set). */
export function reportDate(value) {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString("en-US", { timeZone: "America/Phoenix", month: "short", day: "numeric", year: "numeric" });
}

/* "CheckCreditOrLineOfCredit" -> "Check credit or line of credit". Text that is
   already words is kept as the bureau wrote it. */
function words(value) {
  const s = text(value);
  if (!s) return null;
  if (!/^[A-Za-z0-9]+$/.test(s) || s === s.toUpperCase()) return s;
  const spaced = s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-zA-Z])(\d)/g, "$1 $2");
  const lower = spaced.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
function plain(map, value) {
  const s = text(value);
  if (!s) return null;
  return Object.hasOwn(map, s) ? map[s] : words(s);
}
/* Bureau score factors arrive in capitals; a sentence reads easier. */
function sentence(value) {
  const s = text(value);
  if (!s) return null;
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The last 4 digits of an account number, or null. The full number never prints. */
export function lastFour(value) {
  const s = (text(value) || "").replace(/[^0-9A-Za-z]/g, "");
  const tail = s.slice(-4);
  return s.length > 4 && /^\d{4}$/.test(tail) ? tail : null;
}

/** Up to 24 months, newest first, each with its month when the start date is known. */
export function paymentHistory(pattern, startDate) {
  const codes = Array.from(String(text(pattern) || "").replace(/\s+/g, "")).slice(0, HISTORY_MONTHS);
  if (!codes.length) return null;
  const start = dateParts(startDate);
  const cells = codes.map((code, index) => {
    const known = HISTORY_CODES[code.toUpperCase()];
    let month = null;
    if (start) {
      const total = start.year * 12 + (start.month - 1) - index;
      month = `${MONTHS[total % 12]} ${Math.floor(total / 12)}`;
    }
    return { code, label: known ? known.label : code, tone: known ? known.tone : "none", words: known ? known.words : code, month };
  });
  return { cells, from: cells[0].month, to: cells.at(-1).month };
}

const isNegative = (line) => line?.derogatoryDataIndicator === true || line?.derogatoryDataIndicator === "true";
const isOpenLine = (line) => /^open$/i.test(text(line?.accountStatusType) || "") && !dateParts(line?.accountClosedDate);
const isCardLine = (line) => /^revolving$/i.test(text(line?.accountType) || "") || text(line?.loanType) === "CreditCard";

function accountView(line) {
  const limit = amountCents(line.creditLimitAmount);
  const pastDue = amountCents(line.pastDueAmount);
  return {
    creditor: text(line.creditorName) || "Not reported",
    last4: lastFour(line.accountIdentifier),
    type: plain(LOAN_WORDS, line.loanType) || plain(ACCOUNT_WORDS, line.accountType) || null,
    owner: plain(OWNER_WORDS, line.accountOwnershipType),
    limitCents: limit,
    // A loan has no limit. Its high balance prints instead, and says so.
    highCents: limit === null ? amountCents(line.highBalanceAmount) : null,
    balanceCents: amountCents(line.currentBalanceAmount),
    pastDueCents: pastDue !== null && pastDue > 0 ? pastDue : null,
    status: plain({}, line.accountStatusType),
    rating: plain(RATING_WORDS, line.currentRatingType),
    negative: isNegative(line),
    opened: monthYear(line.accountOpenedDate),
    closed: monthYear(line.accountClosedDate),
    history: paymentHistory(line.paymentPatternData, line.paymentPatternStartDate)
  };
}

function inquiryView(inquiry) {
  return { company: text(inquiry.creditorName) || "Not reported", date: fullDate(inquiry.inquiryDate),
    type: words(inquiry.businessType), sort: sortKey(inquiry.inquiryDate) };
}

function recordView(record) {
  return {
    type: plain(RECORD_WORDS, record.publicRecordType) || words(record.bankruptcyType) || "Public record",
    filed: fullDate(record.filedDate),
    status: words(record.dispositionType),
    statusDate: fullDate(record.dispositionDate),
    court: text(record.courtName),
    caseNumber: text(record.docketIdentifier),
    amountCents: amountCents(record.legalObligationAmount)
  };
}

function personalView(body) {
  const files = asArray(body?.creditFiles).filter(isObject);
  const names = [...new Set(files.flatMap((file) => asArray(file.aliases)).filter(isObject)
    .map((a) => [a.firstName, a.middleName, a.lastName, a.suffix].map(text).filter(Boolean).join(" "))
    .filter(Boolean))];
  const seen = new Set();
  const addresses = files.flatMap((file) => asArray(file.addresses)).filter(isObject).map((a) => {
    const street = [a.addressLine1, a.addressLine2].map(text).filter(Boolean).join(" ");
    const place = [text(a.city), [text(a.state), text(a.postalCode)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return { line: [street, place].filter(Boolean).join(", "), reported: monthYear(a.dateReported) };
  }).filter((a) => a.line && !seen.has(a.line) && seen.add(a.line));
  const employers = files.flatMap((file) => asArray(file.employments)).filter(isObject)
    .map((e) => ({ name: text(e.employerName), reported: monthYear(e.employmentReportedDate || e.employmentStartDate) }))
    .filter((e) => e.name);
  return { names, addresses, employers };
}

function scoreView(result, bureau, body) {
  const rows = asArray(body?.scores).filter(isObject);
  const saved = Number(result?.scores?.[bureau.key]);
  const picked = Number.isInteger(saved) && saved >= 300 && saved <= 850
    ? { value: saved, model: text(result?.scoreModels?.[bureau.key]) }
    : pickCreditScore(rows);
  if (picked.value == null) return { value: null, model: null, min: null, max: null, factors: [] };
  const row = rows.find((s) => wholeNumber(s.scoreValue) === picked.value && (!picked.model || text(s.modelName) === picked.model))
    || rows.find((s) => wholeNumber(s.scoreValue) === picked.value) || null;
  return {
    value: picked.value,
    model: picked.model || text(row?.modelName),
    min: wholeNumber(row?.scoreMinimumValue),
    max: wholeNumber(row?.scoreMaximumValue),
    factors: asArray(row?.scoreFactors).filter(isObject).map((f) => sentence(f.scoreFactorText)).filter(Boolean)
  };
}

function summaryView(lines, inquiries, records) {
  const open = lines.filter(isOpenLine);
  const cards = open.filter(isCardLine)
    .map((line) => ({ limit: amountCents(line.creditLimitAmount), balance: amountCents(line.currentBalanceAmount) }))
    .filter((card) => card.limit !== null && card.limit > 0 && card.balance !== null);
  const limit = cards.reduce((sum, card) => sum + card.limit, 0);
  const balance = cards.reduce((sum, card) => sum + card.balance, 0);
  return {
    accounts: lines.length,
    open: open.length,
    // Unknown is null: a file with no open card limit has no card use, not 0%.
    cardUsePercent: cards.length ? Math.round((balance * 100) / limit) : null,
    negative: lines.filter(isNegative).length,
    publicRecords: records.length,
    inquiries: inquiries.length
  };
}

const EMPTY_SUMMARY = Object.freeze({ accounts: null, open: null, cardUsePercent: null, negative: null, publicRecords: null, inquiries: null });

function bureauView(result, bureau) {
  const body = isObject(result?.bureaus?.[bureau.code]) ? result.bureaus[bureau.code] : null;
  const status = text(result?.bureauStatus?.[bureau.code]) || (body ? classifyBureauReport(body) : "not_pulled");
  const returned = Boolean(body) && status === "file_returned";
  const base = { code: bureau.code, name: bureau.name, status, returned,
    statusWords: returned ? null : STATUS_WORDS[status] || (status === "file_returned" ? STATUS_WORDS.error : words(status)) };
  if (!returned) {
    return { ...base, score: { value: null, model: null, min: null, max: null, factors: [] }, summary: EMPTY_SUMMARY,
      accounts: [], inquiries: [], publicRecords: [], personal: { names: [], addresses: [], employers: [] } };
  }
  const lines = asArray(body.tradelines).filter(isObject);
  const inquiries = asArray(body.inquiries).filter(isObject);
  const records = asArray(body.publicRecords).filter(isObject);
  return {
    ...base,
    score: scoreView(result, bureau, body),
    summary: summaryView(lines, inquiries, records),
    // Negative accounts first, then open before closed, then newest opened first.
    accounts: lines.map((line, index) => ({ line, index }))
      .sort((a, b) => (isNegative(b.line) - isNegative(a.line)) || (isOpenLine(b.line) - isOpenLine(a.line))
        || (sortKey(b.line.accountOpenedDate) - sortKey(a.line.accountOpenedDate)) || (a.index - b.index))
      .map(({ line }) => accountView(line)),
    inquiries: inquiries.map(inquiryView).sort((a, b) => b.sort - a.sort),
    publicRecords: records.map(recordView),
    personal: personalView(body)
  };
}

/** The whole report, read once from the saved CRS result. */
export function creditReportView(result, { clientName = "Client" } = {}) {
  const bureaus = REPORT_BUREAUS.map((bureau) => bureauView(result, bureau));
  return {
    clientName: text(clientName) || "Client",
    reportDate: reportDate(result?.pulledAt),
    bureaus,
    returned: bureaus.filter((bureau) => bureau.returned)
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const SUMMARY_ROWS = Object.freeze([
  ["Accounts", (s) => s.accounts],
  ["Open accounts", (s) => s.open],
  ["Card use", (s) => (s.cardUsePercent === null ? null : `${s.cardUsePercent}%`)],
  ["Negative accounts", (s) => s.negative],
  ["Public records", (s) => s.publicRecords],
  ["Inquiries", (s) => s.inquiries]
]);
const shown = (value) => (value === null || value === undefined ? "—" : String(value));

/* ───────────────────────────── HTML ───────────────────────────── */

const CSS = `
:root{--ink:#0D1113;--gray:#626968;--line:#E3E5E0;--soft:#F0F1ED;--paper:#F8F8F6;
--ok:#E2F2E5;--late:#FCEBCB;--bad:#F9D6D0;--alert:#F2A69B;
--spectrum:linear-gradient(90deg,#F2A69B 0%,#F5CE8F 20%,#F2E39B 40%,#A8D8B0 60%,#A9C6E8 80%,#C4B3E5 100%);
--sans:ui-rounded,'SF Pro Rounded',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.45 var(--sans)}
.rpt{max-width:1040px;margin:0 auto;padding:0 16px 48px}
.rpt-bar{height:6px;background:var(--spectrum)}
.rpt-sheet{background:#fff;border:1px solid var(--line);border-radius:10px;margin-top:24px;padding:28px 32px}
.rpt-head{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding-bottom:20px;border-bottom:1px solid var(--line)}
.rpt-logo{display:block;width:156px;height:auto}
.rpt-head h1{margin:0;font-size:26px;line-height:1.2;font-weight:700}
.rpt-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 24px;margin:20px 0 0;padding:16px 20px;background:var(--soft);border-radius:10px}
.rpt-meta div{min-width:0}
.rpt-meta dt,.rpt-cap{font-size:13px;color:var(--gray)}
.rpt-meta dd{margin:2px 0 0;font-weight:700;overflow-wrap:anywhere}
.rpt section{margin-top:36px}
.rpt h2{margin:0 0 14px;font-size:20px;line-height:1.25;padding-bottom:8px;border-bottom:2px solid var(--ink)}
.rpt h3{margin:24px 0 10px;font-size:17px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px}
.rpt h3 .rpt-cap{font-weight:400}
.rpt-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.rpt-card{border:1px solid var(--line);border-radius:10px;padding:16px;min-width:0}
.rpt-card h3{margin:0 0 6px;font-size:16px}
.rpt-score{font-size:44px;line-height:1.05;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em;margin-bottom:4px}
.rpt-score.rpt-none{font-size:22px;line-height:1.3;color:var(--gray)}
.rpt-card ul{margin:10px 0 0;padding-left:18px;font-size:13px}
.rpt-card li+li{margin-top:4px}
.rpt-rows{margin:0}
.rpt-rows div{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--line)}
.rpt-rows div:first-child{border-top:0}
.rpt-rows dt{color:var(--gray)}
.rpt-rows dd{margin:0;font-weight:700;font-variant-numeric:tabular-nums;text-align:right}
.rpt-table{width:100%;border-collapse:collapse;font-size:15px;table-layout:fixed}
.rpt-table th{font-size:13px;font-weight:600;color:var(--gray);text-align:left;padding:8px 10px;background:var(--soft);white-space:nowrap}
.rpt-table td{padding:10px;vertical-align:top;border-top:1px solid var(--line)}
.rpt-table .rpt-num{text-align:right;font-variant-numeric:tabular-nums}
.rpt-table th.rpt-num{text-align:right}
.rpt-table small{display:block;font-size:13px;font-weight:400;color:var(--gray)}
.rpt-table .rpt-v{min-width:0;overflow-wrap:anywhere}
.rpt-acct td:first-child{font-weight:700;overflow-wrap:anywhere}
.rpt-acct.rpt-neg td:first-child,.rpt-hist.rpt-neg td{box-shadow:inset 4px 0 0 var(--alert);padding-left:14px}
.rpt-acct.rpt-neg .rpt-rating,.rpt-table small.rpt-due{font-weight:700;color:var(--ink)}
.rpt-hist td{border-top:0;padding-top:0}
.rpt-hist-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}
.rpt-cells{display:grid;grid-template-columns:repeat(24,minmax(26px,1fr));gap:2px;margin:0;padding:0;list-style:none;flex:1 1 640px;min-width:0}
.rpt-cells li{font-size:13px;font-weight:700;text-align:center;line-height:24px;border-radius:4px;background:var(--soft);font-variant-numeric:tabular-nums}
.rpt-cells .rpt-ok{background:var(--ok)}.rpt-cells .rpt-late{background:var(--late)}.rpt-cells .rpt-bad{background:var(--bad)}
.rpt-key{font-size:13px;color:var(--gray);margin:0 0 4px}
.rpt-empty{color:var(--gray);margin:6px 0 0}
.rpt-person{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.rpt-person h4{margin:0 0 6px;font-size:13px;font-weight:600;color:var(--gray)}
.rpt-person ul{margin:0;padding:0;list-style:none}
.rpt-person li{padding:6px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}
.rpt-person li:first-child{border-top:0;padding-top:0}
.rpt-person small{display:block;font-size:13px;color:var(--gray)}
.rpt-foot{margin-top:36px;padding-top:16px;border-top:1px solid var(--line)}
.rpt-foot a{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;background:var(--ink);color:#fff;border-radius:8px;font-weight:700;text-decoration:none;margin-top:8px}
@media (max-width:900px){
 .rpt-cells{grid-template-columns:repeat(12,minmax(0,1fr))}
}
@media (max-width:760px){
 .rpt-sheet{padding:20px 16px}
 .rpt-meta,.rpt-grid3,.rpt-person{grid-template-columns:minmax(0,1fr)}
 .rpt-table,.rpt-table tbody{display:block;width:100%}
 .rpt-table thead,.rpt-table colgroup{display:none}
 .rpt-table tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px;border-top:1px solid var(--line);padding:12px 0}
 .rpt-table tr.rpt-hist{display:block;border-top:0;padding-top:0}
 .rpt-table td{display:block;border:0;padding:0;min-width:0}
 .rpt-table td::before{content:attr(data-label);display:block;color:var(--gray);font-size:13px;font-weight:400}
 .rpt-table td.rpt-num{text-align:left}
 .rpt-table td.rpt-whole{grid-column:1/-1}
 .rpt-table td.rpt-whole::before{content:none}
 .rpt-acct.rpt-neg td:first-child,.rpt-hist.rpt-neg td{box-shadow:none;padding-left:0}
 .rpt-acct.rpt-neg,.rpt-hist.rpt-neg{box-shadow:inset 4px 0 0 var(--alert);padding-left:12px}
 .rpt-hist td{padding:0}
}
@media (max-width:420px){
 .rpt-cells{grid-template-columns:repeat(8,minmax(0,1fr))}
}
@media (max-width:380px){
 .rpt{padding:0 8px 40px}
 .rpt-head h1{font-size:22px}
 .rpt-score{font-size:38px}
}
@media print{
 body{background:#fff}
 .rpt{max-width:none;padding:0}
 .rpt-sheet{border:0;margin:0;padding:0}
 .rpt-acct,.rpt-hist,.rpt-card{break-inside:avoid}
 .rpt-foot a{color:var(--ink);background:none;padding:0;min-height:0;text-decoration:underline}
}
@page{size:letter;margin:.5in}
`;

const logoSvg = () => WORDMARK_SVG
  .replace(/^<svg /, '<svg class="rpt-logo" role="img" aria-label="Fundhub" focusable="false" ')
  .replace(/\swidth="[^"]*"/, "").replace(/\sheight="[^"]*"/, "");

function htmlScores(view) {
  return view.bureaus.map((b) => {
    const s = b.score;
    const value = s.value !== null
      ? `<div class="rpt-score">${esc(s.value)}</div>`
      : `<div class="rpt-score rpt-none">${esc(b.statusWords || "No score")}</div>`;
    const range = s.min !== null && s.max !== null ? `<div class="rpt-cap">Range ${esc(s.min)}–${esc(s.max)}</div>` : "";
    const factors = s.factors.length ? `<ul aria-label="${esc(b.name)} score factors">${s.factors.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "";
    return `<article class="rpt-card"><h3>${esc(b.name)}</h3>${value}${s.model ? `<div class="rpt-cap">${esc(s.model)}</div>` : ""}${range}${factors}</article>`;
  }).join("");
}

function htmlSummary(view) {
  return view.bureaus.map((b) => `<article class="rpt-card"><h3>${esc(b.name)}${b.statusWords ? ` <span class="rpt-cap">${esc(b.statusWords)}</span>` : ""}</h3>
    <dl class="rpt-rows">${SUMMARY_ROWS.map(([label, read]) => `<div><dt>${esc(label)}</dt><dd>${esc(shown(read(b.summary)))}</dd></div>`).join("")}</dl></article>`).join("");
}

function htmlHistory(history) {
  if (!history) return '<span class="rpt-cap">Payment history: not reported</span>';
  const range = history.from && history.to ? ` · ${history.from} to ${history.to}` : "";
  return `<div class="rpt-hist-row"><span class="rpt-cap">Payment history, newest first${esc(range)}</span>
    <ol class="rpt-cells">${history.cells.map((c) => `<li class="rpt-${c.tone}" title="${esc(c.month ? `${c.month}: ${c.words}` : c.words)}" aria-label="${esc(c.month ? `${c.month}: ${c.words}` : c.words)}">${esc(c.label)}</li>`).join("")}</ol></div>`;
}

/* One table cell. On a phone the label shows above the value (CSS ::before). */
const td = (label, html, cls = "") => `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}><div class="rpt-v">${html}</div></td>`;
const sub = (value) => (value ? `<small>${esc(value)}</small>` : "");
/* The same column widths in every bureau's table, so the columns line up. */
const cols = (...widths) => `<colgroup>${widths.map((w) => `<col style="width:${w}%">`).join("")}</colgroup>`;

function htmlAccounts(view) {
  if (!view.returned.length) return '<p class="rpt-empty">No bureau files on this report.</p>';
  const body = view.returned.map((b) => {
    const heading = `<h3>${esc(b.name)} <span class="rpt-cap">${esc(b.accounts.length ? plural(b.accounts.length, "account", "accounts") : "No accounts")}</span></h3>`;
    if (!b.accounts.length) return heading;
    const rows = b.accounts.map((a) => {
      const neg = a.negative ? " rpt-neg" : "";
      const limit = a.limitCents !== null ? esc(money(a.limitCents))
        : a.highCents !== null ? `${esc(money(a.highCents))}<small>High balance</small>` : "—";
      return `<tr class="rpt-acct${neg}">${td("Creditor", `${esc(a.creditor)}${sub(a.last4 ? `•••• ${a.last4}` : null)}`, "rpt-whole")}`
        + td("Type", `${esc(a.type || "—")}${sub(a.owner)}`)
        + td("Limit", limit, "rpt-num")
        + td("Balance", `${esc(money(a.balanceCents))}${a.pastDueCents !== null ? `<small class="rpt-due">Past due ${esc(money(a.pastDueCents))}</small>` : ""}`, "rpt-num")
        + td("Status", `${esc(a.status || "—")}${a.rating ? `<small class="rpt-rating">${esc(a.rating)}</small>` : ""}`)
        + td("Opened", `${esc(a.opened || "—")}${sub(a.closed ? `Closed ${a.closed}` : null)}`)
        + `</tr><tr class="rpt-hist${neg}"><td colspan="6" class="rpt-whole">${htmlHistory(a.history)}</td></tr>`;
    }).join("");
    return `${heading}<table class="rpt-table">${cols(25, 15, 13, 13, 18, 16)}<thead><tr><th>Creditor</th><th>Type</th><th class="rpt-num">Limit</th><th class="rpt-num">Balance</th><th>Status</th><th>Opened</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join("");
  // The payment history key, once, above the lists it explains.
  return `<p class="rpt-key">${esc(HISTORY_KEY)}</p>${body}`;
}

function htmlInquiries(view) {
  if (!view.returned.length) return '<p class="rpt-empty">No bureau files on this report.</p>';
  return view.returned.map((b) => {
    const heading = `<h3>${esc(b.name)} <span class="rpt-cap">${esc(b.inquiries.length ? plural(b.inquiries.length, "inquiry", "inquiries") : "No inquiries")}</span></h3>`;
    if (!b.inquiries.length) return heading;
    return `${heading}<table class="rpt-table">${cols(50, 22, 28)}<thead><tr><th>Company</th><th>Date</th><th>Type</th></tr></thead><tbody>${b.inquiries.map((i) => `<tr>${
      td("Company", `<strong>${esc(i.company)}</strong>`, "rpt-whole")}${td("Date", esc(i.date || "—"))}${td("Type", esc(i.type || "—"))}</tr>`).join("")}</tbody></table>`;
  }).join("");
}

function htmlRecords(view) {
  if (!view.returned.length) return '<p class="rpt-empty">No bureau files on this report.</p>';
  return view.returned.map((b) => {
    const heading = `<h3>${esc(b.name)} <span class="rpt-cap">${esc(b.publicRecords.length ? plural(b.publicRecords.length, "record", "records") : "No public records")}</span></h3>`;
    if (!b.publicRecords.length) return heading;
    return `${heading}<table class="rpt-table">${cols(24, 16, 18, 28, 14)}<thead><tr><th>Type</th><th>Filed</th><th>Status</th><th>Court</th><th>Case</th></tr></thead><tbody>${b.publicRecords.map((r) => `<tr>${
      td("Type", `<strong>${esc(r.type)}</strong>${sub(r.amountCents !== null ? money(r.amountCents) : null)}`, "rpt-whole")}${
      td("Filed", esc(r.filed || "—"))}${td("Status", `${esc(r.status || "—")}${sub(r.statusDate)}`)}${
      td("Court", esc(r.court || "—"))}${td("Case", esc(r.caseNumber || "—"))}</tr>`).join("")}</tbody></table>`;
  }).join("");
}

function htmlPersonal(view) {
  if (!view.returned.length) return '<p class="rpt-empty">No bureau files on this report.</p>';
  const list = (items, draw) => (items.length ? `<ul>${items.map(draw).join("")}</ul>` : '<p class="rpt-empty">Not reported</p>');
  return view.returned.map((b) => `<h3>${esc(b.name)}</h3><div class="rpt-person">
    <div><h4>Names</h4>${list(b.personal.names, (n) => `<li>${esc(n)}</li>`)}</div>
    <div><h4>Addresses</h4>${list(b.personal.addresses, (a) => `<li>${esc(a.line)}${a.reported ? `<small>Reported ${esc(a.reported)}</small>` : ""}</li>`)}</div>
    <div><h4>Employers</h4>${list(b.personal.employers, (e) => `<li>${esc(e.name)}${e.reported ? `<small>Reported ${esc(e.reported)}</small>` : ""}</li>`)}</div>
  </div>`).join("");
}

/** The same report as one self-contained web page (no outside files). */
export function renderCrsFullReportHtml(result, { clientName = "Client" } = {}) {
  const view = creditReportView(result, { clientName });
  const bureaus = view.returned.map((b) => b.name).join(", ") || "None returned";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Credit report · ${esc(view.clientName)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="rpt-bar" aria-hidden="true"></div>
<main class="rpt"><div class="rpt-sheet">
<header class="rpt-head">${logoSvg()}<h1>Credit report</h1></header>
<dl class="rpt-meta">
  <div><dt>Name</dt><dd>${esc(view.clientName)}</dd></div>
  <div><dt>Report date</dt><dd>${esc(view.reportDate || "Not reported")}</dd></div>
  <div><dt>Bureaus</dt><dd>${esc(bureaus)}</dd></div>
</dl>
<section aria-labelledby="rpt-scores"><h2 id="rpt-scores">Credit scores</h2><div class="rpt-grid3">${htmlScores(view)}</div></section>
<section aria-labelledby="rpt-summary"><h2 id="rpt-summary">Summary</h2><div class="rpt-grid3">${htmlSummary(view)}</div></section>
<section aria-labelledby="rpt-accounts"><h2 id="rpt-accounts">Accounts</h2>${htmlAccounts(view)}</section>
<section aria-labelledby="rpt-inquiries"><h2 id="rpt-inquiries">Inquiries</h2>${htmlInquiries(view)}</section>
<section aria-labelledby="rpt-records"><h2 id="rpt-records">Public records</h2>${htmlRecords(view)}</section>
<section aria-labelledby="rpt-personal"><h2 id="rpt-personal">Personal info</h2>${htmlPersonal(view)}</section>
<footer class="rpt-foot"><p class="rpt-cap">Questions about your report?</p><a href="${esc(BOOK_CALL_URL)}">Book a call</a></footer>
</div></main>
</body>
</html>
`;
}

/* ───────────────────────────── PDF ───────────────────────────── */

const PAGE = Object.freeze({ width: 612, height: 792, left: 40, right: 40, top: 40, bottom: 50 });
const WIDTH = PAGE.width - PAGE.left - PAGE.right;
/* The report's body text, in points. */
const BODY = 8.5;
const hex = (value) => rgb(parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255);
const COLOR = Object.freeze({
  ink: hex("#0D1113"), gray: hex("#626968"), line: hex("#E3E5E0"), soft: hex("#F0F1ED"), white: rgb(1, 1, 1),
  ok: hex("#E2F2E5"), late: hex("#FCEBCB"), bad: hex("#F9D6D0"), none: hex("#F0F1ED"), alert: hex("#F2A69B")
});
const SPECTRUM = Object.freeze(["#F2A69B", "#F5CE8F", "#F2E39B", "#A8D8B0", "#A9C6E8", "#C4B3E5"].map(hex));

/* Helvetica is WinAnsi. A character it cannot print keeps its exact code point
   in view ("\u{4E2D}") instead of turning into a silent "?". */
function printable(font, value) {
  return Array.from(String(value ?? ""), (char) => {
    const code = char.codePointAt(0);
    if (code < 32 || code === 127) return " ";
    if (code < 127) return char;
    try { font.encodeText(char); return char; } catch { return `\\u{${code.toString(16).toUpperCase()}}`; }
  }).join("");
}

function wrap(font, value, size, maxWidth) {
  const words = printable(font, value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { current = candidate; continue; }
    if (current) lines.push(current);
    current = "";
    for (const char of word) {
      if (current && font.widthOfTextAtSize(current + char, size) > maxWidth) { lines.push(current); current = ""; }
      current += char;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

class PdfReport {
  constructor(pdf, fonts, view) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.view = view;
    this.pages = [];
    this.repeat = null;
  }

  line(value, { font = "regular", size = BODY, color = COLOR.ink, width = WIDTH, gap = 3 } = {}) {
    const face = this.fonts[font];
    return wrap(face, value, size, width).map((textLine) => ({ text: textLine, face, size, color, height: size + gap }));
  }

  newPage() {
    const page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.pages.push(page);
    this.page = page;
    SPECTRUM.forEach((color, index) => page.drawRectangle({ x: (PAGE.width / SPECTRUM.length) * index, y: PAGE.height - 5,
      width: PAGE.width / SPECTRUM.length + 0.5, height: 5, color }));
    if (this.pages.length === 1) { this.y = PAGE.height - PAGE.top; return; }
    this.drawWordmark(PAGE.left, PAGE.height - 36, 70);
    const label = printable(this.fonts.regular, `Credit report · ${this.view.clientName}`);
    const size = 8;
    page.drawText(label, { x: PAGE.width - PAGE.right - this.fonts.regular.widthOfTextAtSize(label, size), y: PAGE.height - 33,
      size, font: this.fonts.regular, color: COLOR.gray });
    page.drawLine({ start: { x: PAGE.left, y: PAGE.height - 46 }, end: { x: PAGE.width - PAGE.right, y: PAGE.height - 46 }, thickness: 0.6, color: COLOR.line });
    this.y = PAGE.height - 62;
    if (this.repeat) this.repeat();
  }

  room(height) {
    if (this.y - height < PAGE.bottom) this.newPage();
  }

  drawWordmark(x, y, width) {
    // (x, y) is the mark's lower left. See fundhub-wordmark.mjs negateY().
    const k = width / WORDMARK_BOX.width;
    const scale = WORDMARK_GROUP.scale * k;
    const originX = x + WORDMARK_GROUP.tx * k;
    const originY = y - (WORDMARK_GROUP.ty - WORDMARK_BOX.height) * k;
    for (const d of wordmarkPdfPaths()) this.page.drawSvgPath(d, { x: originX, y: originY, scale, color: COLOR.ink });
  }

  text(value, x, y, { font = "regular", size = BODY, color = COLOR.ink, align = "left", width = 0 } = {}) {
    const face = this.fonts[font];
    const s = printable(face, value);
    const at = align === "right" ? x + width - face.widthOfTextAtSize(s, size) : x;
    this.page.drawText(s, { x: at, y, size, font: face, color });
  }

  /* A heading never sits alone at the foot of a page: `after` is the room the
     first thing under it needs. */
  heading(label, after = 24) {
    this.repeat = null;
    this.room(Math.min(45 + after, PAGE.height - 140));
    this.y -= 14;
    this.text(label, PAGE.left, this.y - 13, { font: "bold", size: 14 });
    this.y -= 19;
    this.page.drawRectangle({ x: PAGE.left, y: this.y - 1.2, width: WIDTH, height: 1.2, color: COLOR.ink });
    this.y -= 12;
  }

  subheading(name, note, after = 20) {
    this.room(Math.min(30 + after, PAGE.height - 140));
    this.y -= 10;
    this.text(name, PAGE.left, this.y - 11, { font: "bold", size: 11 });
    if (note) this.text(note, PAGE.left + this.fonts.bold.widthOfTextAtSize(printable(this.fonts.bold, name), 11) + 8, this.y - 11, { size: 9, color: COLOR.gray });
    this.y -= 20;
  }

  /* One table row. Cells are [{ x, width, align, lines }]. A row taller than
     the room left keeps going on the next page (repeat() redraws the header). */
  row(cells, { pad = 5, fill = null, bar = null, rule = true } = {}) {
    const index = cells.map(() => 0);
    const spans = [];
    while (cells.some((cell, i) => index[i] < cell.lines.length)) {
      const top = this.y;
      const room = this.y - PAGE.bottom - pad * 2;
      const fullest = Math.max(...cells.map((cell, i) => cell.lines.slice(index[i]).reduce((h, l) => h + l.height, 0)));
      if (room < Math.min(fullest, 24) && this.y < PAGE.height - 120) { this.newPage(); continue; }
      let used = 0;
      const plan = cells.map((cell, i) => {
        let h = 0;
        const take = [];
        while (index[i] < cell.lines.length && h + cell.lines[index[i]].height <= room) {
          take.push(cell.lines[index[i]]);
          h += cell.lines[index[i]].height;
          index[i] += 1;
        }
        // A line taller than a whole page still prints.
        if (!take.length && index[i] < cell.lines.length && room >= cell.lines[index[i]].height / 2) {
          take.push(cell.lines[index[i]]);
          h += cell.lines[index[i]].height;
          index[i] += 1;
        }
        used = Math.max(used, h);
        return take;
      });
      const height = used + pad * 2;
      if (fill) this.page.drawRectangle({ x: PAGE.left, y: top - height, width: WIDTH, height, color: fill });
      cells.forEach((cell, i) => {
        let lineY = top - pad;
        for (const l of plan[i]) {
          lineY -= l.height;
          const s = l.text;
          const x = cell.align === "right" ? cell.x + cell.width - l.face.widthOfTextAtSize(s, l.size) : cell.x;
          this.page.drawText(s, { x, y: lineY + (l.height - l.size) * 0.55, size: l.size, font: l.face, color: l.color });
        }
      });
      this.y = top - height;
      spans.push({ page: this.page, top, bottom: this.y });
      if (bar) this.page.drawRectangle({ x: PAGE.left, y: this.y, width: 3, height, color: bar });
      if (cells.some((cell, i) => index[i] < cell.lines.length)) this.newPage();
    }
    if (rule) this.page.drawLine({ start: { x: PAGE.left, y: this.y }, end: { x: PAGE.width - PAGE.right, y: this.y }, thickness: 0.5, color: COLOR.line });
    return spans;
  }

  columns(spec) {
    // spec: [[label, width, align]] -> cells positions, inner padding 6.
    let x = PAGE.left;
    return spec.map(([label, width, align = "left"]) => {
      const cell = { label, x: x + 6, width: width - 12, align };
      x += width;
      return cell;
    });
  }

  tableHeader(cols) {
    this.row(cols.map((c) => ({ ...c, lines: this.line(c.label, { font: "bold", size: 7.5, color: COLOR.gray, width: c.width }) })), { pad: 4, fill: COLOR.soft, rule: false });
  }

  /* ── sections ── */

  title() {
    const v = this.view;
    this.drawWordmark(PAGE.left, PAGE.height - 66, 132);
    this.text("Credit Report", PAGE.left, PAGE.height - 60, { font: "bold", size: 22, align: "right", width: WIDTH });
    this.y = PAGE.height - 82;
    this.page.drawLine({ start: { x: PAGE.left, y: this.y }, end: { x: PAGE.width - PAGE.right, y: this.y }, thickness: 0.6, color: COLOR.line });
    this.y -= 12;
    const fields = [["NAME", v.clientName], ["REPORT DATE", v.reportDate || "Not reported"],
      ["BUREAUS", v.returned.map((b) => b.name).join(", ") || "None returned"]];
    const third = WIDTH / 3;
    const valueLines = fields.map(([, value]) => this.line(value, { font: "bold", size: 11, width: third - 24 }));
    const height = 20 + Math.max(...valueLines.map((lines) => lines.length)) * 14 + 8;
    this.page.drawRectangle({ x: PAGE.left, y: this.y - height, width: WIDTH, height, color: COLOR.soft });
    fields.forEach(([label], i) => {
      const x = PAGE.left + 14 + i * third;
      this.text(label, x, this.y - 15, { font: "bold", size: 7, color: COLOR.gray });
      valueLines[i].forEach((l, n) => this.text(l.text, x, this.y - 30 - n * 14, { font: "bold", size: 11 }));
    });
    this.y -= height + 6;
  }

  scores() {
    const gap = 12;
    const width = (WIDTH - gap * 2) / 3;
    const inner = width - 24;
    // Every caption and supporting line in a card is body size, like the rest of the report.
    const caption = { size: BODY, color: COLOR.gray, width: inner };
    const cards = this.view.bureaus.map((b) => {
      const s = b.score;
      const lines = [...this.line(b.name.toUpperCase(), { ...caption, font: "bold", gap: 6 })];
      if (s.value !== null) lines.push(...this.line(String(s.value), { font: "bold", size: 30, width: inner, gap: 8 }));
      else lines.push(...this.line(b.statusWords || "No score", { font: "bold", size: 14, color: COLOR.gray, width: inner, gap: 6 }));
      if (s.model) lines.push(...this.line(s.model, caption));
      if (s.min !== null && s.max !== null) lines.push(...this.line(`Range ${s.min}–${s.max}`, caption));
      if (s.factors.length) {
        lines.push({ text: "", face: this.fonts.regular, size: 4, color: COLOR.gray, height: 8 });
        lines.push(...this.line("SCORE FACTORS", { ...caption, font: "bold", gap: 5 }));
        for (const factor of s.factors) {
          const wrapped = this.line(factor, { size: BODY, width: inner - 8, gap: 3 });
          wrapped.forEach((l, n) => { l.indent = 8; l.bullet = n === 0; });
          // The space between two factors is its own empty line, so every printed line sits the same.
          lines.push(...wrapped, { text: "", face: this.fonts.regular, size: BODY, color: COLOR.gray, height: 3 });
        }
      }
      return lines;
    });
    const height = Math.max(...cards.map((lines) => lines.reduce((h, l) => h + l.height, 0))) + 24;
    this.heading("Credit scores", height);
    this.room(height);
    const top = this.y;
    cards.forEach((lines, i) => {
      const x = PAGE.left + i * (width + gap);
      this.page.drawRectangle({ x, y: top - height, width, height, borderColor: COLOR.line, borderWidth: 0.8, color: COLOR.white });
      let lineY = top - 12;
      for (const l of lines) {
        lineY -= l.height;
        const at = x + 12 + (l.indent || 0);
        const baseline = lineY + (l.height - l.size) * 0.4;
        if (l.bullet) this.page.drawCircle({ x: at - 5, y: baseline + l.size * 0.33, size: 1.2, color: COLOR.ink });
        if (l.text) this.page.drawText(l.text, { x: at, y: baseline, size: l.size, font: l.face, color: l.color });
      }
    });
    this.y = top - height - 4;
  }

  summary() {
    this.heading("Summary", 30 + SUMMARY_ROWS.length * 19);
    const cols = this.columns([["", 172], ...this.view.bureaus.map((b) => [b.name.toUpperCase(), (WIDTH - 172) / 3, "right"])]);
    const header = () => this.row(cols.map((c, i) => {
      const b = this.view.bureaus[i - 1];
      const lines = this.line(c.label, { font: "bold", size: 7.5, color: COLOR.gray, width: c.width });
      if (b?.statusWords) lines.push(...this.line(b.statusWords, { size: 7.5, color: COLOR.gray, width: c.width }));
      return { ...c, lines };
    }), { pad: 4, fill: COLOR.soft, rule: false });
    header();
    this.repeat = header;
    SUMMARY_ROWS.forEach(([label, read]) => {
      this.row(cols.map((c, i) => ({ ...c, lines: i === 0
        ? this.line(label, { size: 9, width: c.width })
        : this.line(shown(read(this.view.bureaus[i - 1].summary)), { font: "bold", size: 9, width: c.width }) })), { pad: 5 });
    });
    this.repeat = null;
  }

  history(history) {
    const size = 6.5;
    const cellWidth = 16.5;
    const cellHeight = 11;
    const labelWidth = 74;
    this.room(cellHeight + 18);
    const top = this.y - 3;
    if (!history) {
      this.text("Payment history: not reported", PAGE.left + 6, top - 8, { size: 7, color: COLOR.gray });
      this.y = top - 14;
      return;
    }
    this.text("Payment history", PAGE.left + 6, top - 8, { size: 7, color: COLOR.gray });
    this.text("newest first", PAGE.left + 6, top - 16, { size: 6.5, color: COLOR.gray });
    const x0 = PAGE.left + labelWidth;
    history.cells.forEach((cell, i) => {
      const x = x0 + i * (cellWidth + 1);
      this.page.drawRectangle({ x, y: top - cellHeight, width: cellWidth, height: cellHeight, color: COLOR[cell.tone] || COLOR.none });
      const label = printable(this.fonts.bold, cell.label);
      this.page.drawText(label, { x: x + (cellWidth - this.fonts.bold.widthOfTextAtSize(label, size)) / 2, y: top - cellHeight + 3.2,
        size, font: this.fonts.bold, color: COLOR.ink });
    });
    const labelY = top - cellHeight - 8;
    const end = x0 + history.cells.length * (cellWidth + 1) - 1;
    const width = (value) => this.fonts.regular.widthOfTextAtSize(printable(this.fonts.regular, value), 6.5);
    if (history.from && history.to && history.cells.length > 1 && end - width(history.to) > x0 + width(history.from) + 8) {
      this.text(history.from, x0, labelY, { size: 6.5, color: COLOR.gray });
      this.text(history.to, end - 60, labelY, { size: 6.5, color: COLOR.gray, align: "right", width: 60 });
    } else if (history.from) {
      // A short strip: one label, so the two months never print on top of each other.
      this.text(history.cells.length > 1 && history.to ? `${history.from} – ${history.to}` : history.from, x0, labelY, { size: 6.5, color: COLOR.gray });
    }
    this.y = top - cellHeight - 14;
  }

  accounts() {
    this.heading("Accounts", 16 + 26 + 18 + 76);
    if (!this.view.returned.length) { this.note("No bureau files on this report."); return; }
    // The payment history key sits under the heading, once, where it is read first.
    for (const l of this.line(HISTORY_KEY, { size: 7, color: COLOR.gray })) { this.text(l.text, PAGE.left, this.y - 8, { size: 7, color: COLOR.gray }); this.y -= l.height; }
    this.y -= 4;
    const cols = this.columns([["CREDITOR", 148], ["TYPE", 84], ["LIMIT", 64, "right"], ["BALANCE", 70, "right"], ["STATUS", 90], ["OPENED", 76]]);
    for (const b of this.view.returned) {
      this.subheading(b.name, b.accounts.length ? plural(b.accounts.length, "account", "accounts") : "No accounts",
        b.accounts.length ? 18 + 76 : 0);
      if (!b.accounts.length) continue;
      const header = () => this.tableHeader(cols);
      header();
      this.repeat = header;
      for (const a of b.accounts) {
        const small = { size: 7.5, color: COLOR.gray };
        const cell = (i, lines) => ({ ...cols[i], lines });
        const limit = a.limitCents !== null ? this.line(money(a.limitCents), { width: cols[2].width })
          : a.highCents !== null ? [...this.line(money(a.highCents), { width: cols[2].width }), ...this.line("High balance", { ...small, width: cols[2].width })]
            : this.line("—", { width: cols[2].width });
        const cells = [
          cell(0, [...this.line(a.creditor, { font: "bold", width: cols[0].width }), ...(a.last4 ? this.line(`•••• ${a.last4}`, { ...small, width: cols[0].width }) : [])]),
          cell(1, [...this.line(a.type || "—", { width: cols[1].width }), ...(a.owner ? this.line(a.owner, { ...small, width: cols[1].width }) : [])]),
          cell(2, limit),
          cell(3, [...this.line(money(a.balanceCents), { width: cols[3].width }),
            ...(a.pastDueCents !== null ? this.line(`Past due ${money(a.pastDueCents)}`, { font: "bold", size: 7.5, width: cols[3].width }) : [])]),
          cell(4, [...this.line(a.status || "—", { width: cols[4].width }),
            ...(a.rating ? this.line(a.rating, { font: a.negative ? "bold" : "regular", size: 7.5, color: a.negative ? COLOR.ink : COLOR.gray, width: cols[4].width }) : [])]),
          cell(5, [...this.line(a.opened || "—", { width: cols[5].width }), ...(a.closed ? this.line(`Closed ${a.closed}`, { ...small, width: cols[5].width }) : [])])
        ];
        const tall = Math.max(...cells.map((c) => c.lines.reduce((h, l) => h + l.height, 0))) + 10 + 32;
        if (tall < PAGE.height - 160) this.room(tall);
        this.row(cells, { pad: 5, rule: false, bar: a.negative ? COLOR.alert : null });
        const before = this.page;
        const historyTop = this.y;
        this.history(a.history);
        // The coral bar runs down the history strip too, when it shares the page.
        if (a.negative && this.page === before) this.page.drawRectangle({ x: PAGE.left, y: this.y, width: 3, height: historyTop - this.y, color: COLOR.alert });
        this.page.drawLine({ start: { x: PAGE.left, y: this.y }, end: { x: PAGE.width - PAGE.right, y: this.y }, thickness: 0.5, color: COLOR.line });
      }
      this.repeat = null;
    }
  }

  note(value) {
    this.room(18);
    this.text(value, PAGE.left, this.y - 10, { size: 9, color: COLOR.gray });
    this.y -= 18;
  }

  inquiries() {
    this.heading("Inquiries", 26 + 18 + 20);
    if (!this.view.returned.length) { this.note("No bureau files on this report."); return; }
    const cols = this.columns([["COMPANY", 270], ["DATE", 110], ["TYPE", WIDTH - 380]]);
    for (const b of this.view.returned) {
      this.subheading(b.name, b.inquiries.length ? plural(b.inquiries.length, "inquiry", "inquiries") : "No inquiries",
        b.inquiries.length ? 18 + 20 : 0);
      if (!b.inquiries.length) continue;
      const header = () => this.tableHeader(cols);
      header();
      this.repeat = header;
      for (const i of b.inquiries) {
        this.row([
          { ...cols[0], lines: this.line(i.company, { font: "bold", width: cols[0].width }) },
          { ...cols[1], lines: this.line(i.date || "—", { width: cols[1].width }) },
          { ...cols[2], lines: this.line(i.type || "—", { width: cols[2].width }) }
        ], { pad: 4 });
      }
      this.repeat = null;
    }
  }

  records() {
    this.heading("Public records", 26 + 18 + 30);
    if (!this.view.returned.length) { this.note("No bureau files on this report."); return; }
    const cols = this.columns([["TYPE", 130], ["FILED", 82], ["STATUS", 104], ["COURT", 138], ["CASE", WIDTH - 454]]);
    for (const b of this.view.returned) {
      this.subheading(b.name, b.publicRecords.length ? plural(b.publicRecords.length, "record", "records") : "No public records",
        b.publicRecords.length ? 18 + 30 : 0);
      if (!b.publicRecords.length) continue;
      const header = () => this.tableHeader(cols);
      header();
      this.repeat = header;
      for (const r of b.publicRecords) {
        this.row([
          { ...cols[0], lines: [...this.line(r.type, { font: "bold", width: cols[0].width }),
            ...(r.amountCents !== null ? this.line(money(r.amountCents), { size: 7.5, color: COLOR.gray, width: cols[0].width }) : [])] },
          { ...cols[1], lines: this.line(r.filed || "—", { width: cols[1].width }) },
          { ...cols[2], lines: [...this.line(r.status || "—", { width: cols[2].width }),
            ...(r.statusDate ? this.line(r.statusDate, { size: 7.5, color: COLOR.gray, width: cols[2].width }) : [])] },
          { ...cols[3], lines: this.line(r.court || "—", { width: cols[3].width }) },
          { ...cols[4], lines: this.line(r.caseNumber || "—", { width: cols[4].width }) }
        ], { pad: 5 });
      }
      this.repeat = null;
    }
  }

  personal() {
    this.heading("Personal info", 26 + 18 + 60);
    if (!this.view.returned.length) { this.note("No bureau files on this report."); return; }
    const cols = this.columns([["NAMES", 150], ["ADDRESSES", 232], ["EMPLOYERS", WIDTH - 382]]);
    const list = (items, width, draw) => (items.length ? items.flatMap((item, n) => {
      const lines = draw(item, width);
      if (n < items.length - 1) lines.at(-1).height += 5;
      return lines;
    }) : this.line("Not reported", { color: COLOR.gray, width }));
    for (const b of this.view.returned) {
      const cells = [
        { ...cols[0], lines: list(b.personal.names, cols[0].width, (name, width) => this.line(name, { width })) },
        { ...cols[1], lines: list(b.personal.addresses, cols[1].width, (a, width) => [...this.line(a.line, { width }),
          ...(a.reported ? this.line(`Reported ${a.reported}`, { size: 7.5, color: COLOR.gray, width }) : [])]) },
        { ...cols[2], lines: list(b.personal.employers, cols[2].width, (e, width) => [...this.line(e.name, { width }),
          ...(e.reported ? this.line(`Reported ${e.reported}`, { size: 7.5, color: COLOR.gray, width }) : [])]) }
      ];
      // One bureau's block stays on one page whenever it fits on one.
      const tall = Math.max(...cells.map((c) => c.lines.reduce((h, l) => h + l.height, 0))) + 12;
      this.subheading(b.name, null, 18 + tall);
      const header = () => this.tableHeader(cols);
      header();
      this.repeat = header;
      this.row(cells, { pad: 6 });
      this.repeat = null;
    }
  }

  closing() {
    this.room(48);
    this.y -= 22;
    this.text("Questions about your report? Book a call:", PAGE.left, this.y, { font: "bold", size: 10 });
    this.y -= 16;
    const font = this.fonts.regular;
    this.page.drawText(BOOK_CALL_URL, { x: PAGE.left, y: this.y, size: 10, font, color: COLOR.ink });
    const width = font.widthOfTextAtSize(BOOK_CALL_URL, 10);
    this.page.drawLine({ start: { x: PAGE.left, y: this.y - 1.5 }, end: { x: PAGE.left + width, y: this.y - 1.5 }, thickness: 0.6, color: COLOR.ink });
    const link = this.pdf.context.obj({ Type: "Annot", Subtype: "Link", Rect: [PAGE.left, this.y - 3, PAGE.left + width, this.y + 12],
      Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of(BOOK_CALL_URL) } });
    this.page.node.addAnnot(this.pdf.context.register(link));
  }

  footers() {
    const total = this.pages.length;
    const left = printable(this.fonts.regular, ["Fundhub credit report", this.view.clientName, this.view.reportDate].filter(Boolean).join(" · "));
    this.pages.forEach((page, i) => {
      page.drawLine({ start: { x: PAGE.left, y: 36 }, end: { x: PAGE.width - PAGE.right, y: 36 }, thickness: 0.5, color: COLOR.line });
      page.drawText(left, { x: PAGE.left, y: 24, size: 7.5, font: this.fonts.regular, color: COLOR.gray });
      const label = `Page ${i + 1} of ${total}`;
      page.drawText(label, { x: PAGE.width - PAGE.right - this.fonts.regular.widthOfTextAtSize(label, 7.5), y: 24, size: 7.5, font: this.fonts.regular, color: COLOR.gray });
    });
  }
}

/** The report as a PDF. Only call for a real result with bureau data. */
export async function buildCrsFullReportPdf(result, { clientName = "Client" } = {}) {
  if (!result?.bureaus || !Object.keys(result.bureaus).length) {
    throw new Error("A CRS report with bureau data is required");
  }
  const view = creditReportView(result, { clientName });
  const pdf = await PDFDocument.create();
  pdf.setTitle("Fundhub Credit Report");
  pdf.setAuthor("Fundhub");
  pdf.setCreator("Fundhub");
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const report = new PdfReport(pdf, fonts, view);
  report.newPage();
  report.title();
  report.scores();
  report.summary();
  report.accounts();
  report.inquiries();
  report.records();
  report.personal();
  report.closing();
  report.footers();
  return Buffer.from(await pdf.save());
}
