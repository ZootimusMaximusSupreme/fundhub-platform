// The full credit report: one view read from the saved CRS result, drawn as a
// PDF and as a web page. Pure; no database, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { mergeBureauReports } from "./crs-map.mjs";
import { extractPdfText } from "../company-brain/pdf-text.mjs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  amountCents, buildCrsFullReportPdf, creditReportView, lastFour, money, paymentHistory, renderCrsFullReportHtml
} from "./crs-full-report.mjs";

const SSN = "123456789";
const DOB = "1980-01-02";
const CARD_NUMBER = "4111222233334444";
const card = (over = {}) => ({
  creditorName: "BANK ONE", accountIdentifier: CARD_NUMBER, accountType: "Revolving", loanType: "CreditCard",
  accountOwnershipType: "Individual", accountStatusType: "Open", currentRatingType: "AsAgreed",
  creditLimitAmount: "5000", currentBalanceAmount: "1250", accountOpenedDate: "2020-03-15",
  paymentPatternData: "CC1C", paymentPatternStartDate: "2026-10-01", derogatoryDataIndicator: false, ...over
});
const RESULT = {
  pulledAt: "2026-10-29T18:00:00Z",
  scores: { ex: 703, eq: null, tu: null },
  scoreModels: { ex: "FICO Score 9", eq: null, tu: null },
  bureauStatus: { EX: "file_returned", EQ: "frozen" },
  bureaus: {
    EX: {
      requestData: { firstName: "TEST", lastName: "PERSON", ssnLast4: "6789", birthDate: DOB },
      creditFiles: [{
        aliases: [{ firstName: "TEST", lastName: "PERSON" }],
        ssns: [{ ssn: SSN }], dobs: [{ dob: DOB }],
        addresses: [{ addressLine1: "1 MAIN ST", city: "PHOENIX", state: "AZ", postalCode: "85004", dateReported: "2026-09-01" }],
        employments: [{ employerName: "ACME", employmentReportedDate: "2025-05-01" }]
      }],
      scores: [
        { modelName: "Income Insight", scoreValue: "37" },
        { modelName: "FICO Score 9", scoreValue: "703", scoreMinimumValue: "300", scoreMaximumValue: "850",
          scoreFactors: [{ scoreFactorText: "TOO MANY INQUIRIES LAST 12 MONTHS" }] }
      ],
      tradelines: [
        card(),
        card({ creditorName: "BANK TWO", accountIdentifier: "XX9", creditLimitAmount: "3000", currentBalanceAmount: "0", accountOpenedDate: "2022-06-01", paymentPatternData: "" }),
        { creditorName: "SIGNET BANK", accountIdentifier: "1200119007344443", accountType: "Installment", loanType: "InstallmentLoan",
          accountStatusType: "Closed", accountClosedDate: "2021-10-28", currentRatingType: "ChargeOff", highBalanceAmount: "5301",
          currentBalanceAmount: "4798", pastDueAmount: "709", accountOpenedDate: "2019-09-10", derogatoryDataIndicator: true,
          paymentPatternData: "9X", paymentPatternStartDate: "2021-09-03" },
        // A closed card with a big balance: if card use counted it, the 16% below would move.
        card({ creditorName: "OLD STORE CARD", accountIdentifier: "6011000000009999", accountStatusType: "Closed",
          accountClosedDate: "2024-01-01", creditLimitAmount: "1000", currentBalanceAmount: "900", accountOpenedDate: "2015-01-01" })
      ],
      inquiries: [
        { creditorName: "OLD BANK", inquiryDate: "2025-01-05", businessType: "Banking" },
        { creditorName: "NEW BANK", inquiryDate: "2026-09-01", businessType: "ConsumerFinance" }
      ],
      publicRecords: [{ publicRecordType: "BankruptcyChapter7", filedDate: "2021-10-28", dispositionType: "Discharged",
        dispositionDate: "2022-02-11", courtName: "US BKPT CT", docketIdentifier: "BK1", legalObligationAmount: "UNKNOWN" }]
    }
  }
};

const vendor = (rel) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../../vendor/${rel}`, import.meta.url)), "utf8"));
const SANDBOX_REPORTS = {
  EX: vendor("underwriteiq-crs/sandbox/exp.json"),
  EQ: vendor("underwriteiq-crs/sandbox/efx.json"),
  TU: vendor("underwriteiq-full/api/lite/crs/sandbox/tu.json")
};
const SANDBOX = mergeBureauReports({ reports: SANDBOX_REPORTS, environment: "production", pulledAt: "2026-11-06T18:00:00Z" });
/* Every SSN, birth date and full account number in the vendor test files. */
const SANDBOX_SECRETS = Object.values(SANDBOX_REPORTS).flatMap((r) => [
  r.requestData?.ssn, r.requestData?.birthDate,
  ...(r.creditFiles || []).flatMap((f) => [...(f.ssns || []).map((s) => s.ssn), ...(f.dobs || []).map((d) => d.dob)]),
  ...(r.tradelines || []).map((t) => t.accountIdentifier).filter((id) => String(id || "").length > 6)
]).filter(Boolean);

test("scores come from each bureau's saved score; a missing one is a word, never 0", () => {
  const view = creditReportView(RESULT, { clientName: "Test Person" });
  const [ex, eq, tu] = view.bureaus;
  assert.deepEqual([ex.name, eq.name, tu.name], ["Experian", "Equifax", "TransUnion"]);
  assert.deepEqual(ex.score, { value: 703, model: "FICO Score 9", min: 300, max: 850, factors: ["Too many inquiries last 12 months"] });
  assert.equal(eq.score.value, null);
  assert.equal(eq.statusWords, "Frozen");
  assert.equal(tu.statusWords, "Not pulled");
  assert.deepEqual(eq.summary, { accounts: null, open: null, cardUsePercent: null, negative: null, publicRecords: null, inquiries: null });
  assert.deepEqual(view.returned.map((b) => b.code), ["EX"]);
  assert.equal(view.reportDate, "Oct 29, 2026");
  // A saved score outside 300-850 is not a credit score: the bureau's own FICO row is used.
  const wrong = creditReportView({ ...RESULT, scores: { ex: 0 } });
  assert.equal(wrong.bureaus[0].score.value, 703);
});

test("summary counts the saved rows; card use is open card balances over open card limits", () => {
  const ex = creditReportView(RESULT).bureaus[0];
  assert.deepEqual(ex.summary, { accounts: 4, open: 2, cardUsePercent: 16, negative: 1, publicRecords: 1, inquiries: 2 });
  // No open card with a limit: card use is unknown, not 0%.
  const noLimit = structuredClone(RESULT);
  noLimit.bureaus.EX.tradelines = [card({ creditLimitAmount: undefined })];
  assert.equal(creditReportView(noLimit).bureaus[0].summary.cardUsePercent, null);
  // A zero balance on a card with a limit is a known 0%.
  const paid = structuredClone(RESULT);
  paid.bureaus.EX.tradelines = [card({ currentBalanceAmount: "0" })];
  assert.equal(creditReportView(paid).bureaus[0].summary.cardUsePercent, 0);
});

test("each account shows its own saved fields in plain words, negatives first, last 4 only", () => {
  const accounts = creditReportView(RESULT).bureaus[0].accounts;
  assert.deepEqual(accounts.map((a) => a.creditor), ["SIGNET BANK", "BANK TWO", "BANK ONE", "OLD STORE CARD"]);
  const [loan, two, one] = accounts;
  assert.deepEqual({ ...one, history: undefined }, {
    creditor: "BANK ONE", last4: "4444", type: "Credit card", owner: "Individual", limitCents: 500000, highCents: null,
    balanceCents: 125000, pastDueCents: null, status: "Open", rating: "Paid as agreed", negative: false,
    opened: "Mar 2020", closed: null, history: undefined
  });
  assert.equal(two.last4, null, "a short or masked number shows no digits");
  assert.equal(two.history, null, "no pattern on file means no history, not all on time");
  assert.equal(loan.limitCents, null);
  assert.equal(loan.highCents, 530100, "a loan shows its high balance, labeled as such");
  assert.equal(loan.pastDueCents, 70900);
  assert.equal(loan.rating, "Charged off");
  assert.equal(loan.negative, true);
  assert.equal(loan.closed, "Oct 2021");
});

test("payment history: newest first, the vendor's own codes, unknown codes kept as sent", () => {
  const history = paymentHistory("CC1C29X-Q", "2026-10-01");
  assert.deepEqual(history.cells.map((c) => c.label), ["OK", "OK", "30", "OK", "60", "CO", "–", "–", "Q"]);
  assert.deepEqual(history.cells.slice(0, 3).map((c) => c.month), ["Oct 2026", "Sep 2026", "Aug 2026"]);
  assert.equal(history.cells[6].month, "Apr 2026");
  assert.equal(history.from, "Oct 2026");
  assert.equal(history.to, "Feb 2026");
  assert.equal(history.cells.at(-1).tone, "none");
  assert.equal(paymentHistory("C".repeat(35), "2026-01-01").cells.length, 24, "the last 24 months");
  assert.equal(paymentHistory("CCC", "2026-01-01").cells[1].month, "Dec 2025", "months cross the year");
  assert.equal(paymentHistory("CC", null).cells[0].month, null, "no start date: no invented months");
  assert.equal(paymentHistory("", "2026-01-01"), null);
});

test("inquiries newest first; public records and personal info from the bureau, never SSN or birth date", () => {
  const ex = creditReportView(RESULT).bureaus[0];
  assert.deepEqual(ex.inquiries.map((i) => [i.company, i.date, i.type]),
    [["NEW BANK", "Sep 1, 2026", "Consumer finance"], ["OLD BANK", "Jan 5, 2025", "Banking"]]);
  assert.deepEqual(ex.publicRecords, [{ type: "Bankruptcy, Chapter 7", filed: "Oct 28, 2021", status: "Discharged",
    statusDate: "Feb 11, 2022", court: "US BKPT CT", caseNumber: "BK1", amountCents: null }]);
  assert.deepEqual(ex.personal, { names: ["TEST PERSON"],
    addresses: [{ line: "1 MAIN ST, PHOENIX, AZ 85004", reported: "Sep 2026" }],
    employers: [{ name: "ACME", reported: "May 2025" }] });
  assert.equal(JSON.stringify(creditReportView(RESULT)).includes(SSN), false);
  assert.equal(JSON.stringify(creditReportView(RESULT)).includes(DOB), false);
});

test("amounts are integer cents and unknown stays unknown", () => {
  assert.equal(amountCents("4798"), 479800);
  assert.equal(amountCents("1,200.50"), 120050);
  assert.equal(amountCents("UNKNOWN"), null);
  assert.equal(amountCents(""), null);
  assert.equal(amountCents(null), null);
  assert.equal(money(479800), "$4,798");
  assert.equal(money(120050), "$1,200.50");
  assert.equal(money(null), "—");
  assert.equal(lastFour("1200119007344443"), "4443");
  assert.equal(lastFour("517805XXXXXX"), null);
  assert.equal(lastFour("1234"), null, "a 4-digit id would print the whole number");
});

test("the web page has the Fundhub wordmark, every section in order and escapes every value", () => {
  const html = renderCrsFullReportHtml(RESULT, { clientName: "<script>alert(1)</script>" });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<svg class="rpt-logo" role="img" aria-label="Fundhub"/);
  assert.equal(html.includes("<script>alert(1)"), false);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  const order = ["Credit scores", "Summary", "Accounts", "Inquiries", "Public records", "Personal info"].map((label) => html.indexOf(`>${label}</h2>`));
  assert.ok(order.every((at) => at > 0), "every section is there");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "sections in report order");
  for (const words of ["Frozen", "Not pulled", "•••• 4444", "Paid as agreed", "Charged off", "Past due $709", "16%",
    "Bankruptcy, Chapter 7", "Payment history, newest first · Oct 2026 to Jul 2026", "Book a call"]) {
    assert.ok(html.includes(words), `shows ${words}`);
  }
  for (const secret of [SSN, DOB, CARD_NUMBER, "1200119007344443"]) assert.equal(html.includes(secret), false, `never prints ${secret}`);
  assert.equal(/<script\b/i.test(html), false, "a document page runs no script");
});

test("a returned file with no inquiries says No inquiries", () => {
  const clean = structuredClone(RESULT);
  clean.bureaus.EX.inquiries = [];
  const html = renderCrsFullReportHtml(clean, { clientName: "Test Person" });
  assert.ok(html.includes("No inquiries"));
  assert.equal(creditReportView(clean).bureaus[0].summary.inquiries, 0);
});

test("the PDF prints the same report, with page numbers, and never a secret", async () => {
  const bytes = await buildCrsFullReportPdf(RESULT, { clientName: "Test Person" });
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  const { text, pageCount } = await extractPdfText(bytes);
  for (const words of ["Credit Report", "Test Person", "Oct 29, 2026", "703", "Range 300–850", "Frozen", "Not pulled",
    "BANK ONE", "4444", "Paid as agreed", "Charged off", "Past due $709", "16%", "NEW BANK", "Bankruptcy, Chapter 7",
    "TEST PERSON", "1 MAIN ST, PHOENIX, AZ 85004", "ACME", `Page 1 of ${pageCount}`]) {
    assert.ok(text.includes(words), `PDF shows ${words}`);
  }
  for (const secret of [SSN, DOB, CARD_NUMBER, "1200119007344443"]) assert.equal(text.includes(secret), false, `PDF never prints ${secret}`);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getTitle(), "Fundhub Credit Report");
});

/* Every printed line of a PDF with its size in points, as pdf.js reads it back. */
async function printedSizes(bytes) {
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);
  const doc = await getDocument({ data, useSystemFonts: true, disableWorker: true }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const { items } = await (await doc.getPage(n)).getTextContent();
    for (const it of items) {
      if (it.str && it.str.trim()) out.push({ page: n, str: it.str.trim(), size: Math.round(Math.hypot(it.transform[0], it.transform[1]) * 100) / 100 });
    }
  }
  return out;
}

test("the score cards print their captions and factors at the report's body size (Codex CX24)", async () => {
  const printed = await printedSizes(await buildCrsFullReportPdf(RESULT, { clientName: "Test Person" }));
  const sizeOf = (start) => {
    const hit = printed.find((p) => p.str.startsWith(start));
    assert.ok(hit, `the PDF prints "${start}"`);
    return hit.size;
  };
  const body = sizeOf("BANK ONE");
  assert.ok(body >= 8.5, "body text is at least 8.5 pt");
  // Was 6.5 pt (the caption), 7.5 pt (the factor, model and range) and 8 pt (the bureau's name).
  // The card's "EXPERIAN" prints before the Summary table's, so the first one is the card's.
  for (const line of ["EXPERIAN", "SCORE FACTORS", "Too many inquiries last 12", "FICO Score 9", "Range 300"]) {
    assert.equal(sizeOf(line), body, `"${line}" is body size`);
  }
});

test("long files paginate instead of cutting accounts off", async () => {
  const result = { ...RESULT, bureaus: { EX: { ...RESULT.bureaus.EX,
    tradelines: Array.from({ length: 120 }, (_, i) => card({ creditorName: `BANK ${i}`, accountIdentifier: `55550000${String(i).padStart(4, "0")}` })) } } };
  const bytes = await buildCrsFullReportPdf(result, { clientName: "Test Person" });
  const { text, pageCount } = await extractPdfText(bytes);
  assert.ok(pageCount > 3);
  assert.ok(text.includes("BANK 0") && text.includes("BANK 119"), "the first and the last account both print");
  assert.ok(text.includes(`Page ${pageCount} of ${pageCount}`));
});

test("the vendor's own test files print in full and leak no SSN, birth date or account number", async () => {
  assert.ok(SANDBOX_SECRETS.length >= 10);
  const view = creditReportView(SANDBOX, { clientName: "Sandbox File" });
  assert.deepEqual(view.returned.map((b) => b.name), ["Experian", "Equifax", "TransUnion"]);
  assert.deepEqual(view.bureaus.map((b) => b.score.value), [630, 636, 725]);
  assert.equal(view.bureaus[0].accounts.length, SANDBOX_REPORTS.EX.tradelines.length);
  assert.equal(view.bureaus[1].inquiries.length, SANDBOX_REPORTS.EQ.inquiries.length);
  const html = renderCrsFullReportHtml(SANDBOX, { clientName: "Sandbox File" });
  const bytes = await buildCrsFullReportPdf(SANDBOX, { clientName: "Sandbox File" });
  const { text } = await extractPdfText(bytes);
  for (const secret of SANDBOX_SECRETS) {
    assert.equal(html.includes(secret), false, `page never prints ${secret}`);
    assert.equal(text.includes(secret), false, `PDF never prints ${secret}`);
  }
  for (const words of ["SIGNET BANK/VIRGINIA", "Bankruptcy, Chapter 7", "Charged off", "DISCOVERCARD"]) {
    assert.ok(text.includes(words), `PDF shows ${words}`);
  }
});

test("a result with no bureau data is refused", async () => {
  await assert.rejects(() => buildCrsFullReportPdf({ scores: { ex: 700 } }), /bureau data is required/);
});
