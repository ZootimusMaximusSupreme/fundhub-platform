import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { buildCrsFullReportPdf, creditReportLines } from "./crs-full-report.mjs";

const RESULT = {
  pulledAt: "2026-10-29T18:00:00Z",
  scores: { ex: 703, eq: 711, tu: 702 },
  bureauStatus: { TU: "file_returned", EX: "file_returned", EQ: "file_returned" },
  requestIds: { TU: "request-tu" },
  businessReports: [{ businessName: "Example Company", status: "found" }],
  bureaus: {
    TU: { scores: [{ modelName: "FICO 9", scoreValue: 703 }], tradelines: [{ creditorName: "Bank One", currentBalance: 450 }], requestData: { ssn: "123456789", ssnLast4: "6789" } },
    EX: { inquiries: [{ creditorName: "Bank Two", inquiryDate: "2026-09-01" }] },
    EQ: { publicRecords: [{ type: "Bankruptcy", reportedDate: "2020-01-01" }] }
  }
};

test("full source report includes every bureau field without inventing scores", () => {
  const lines = creditReportLines(RESULT).map((row) => row.heading || row.text);
  assert.deepEqual(lines.filter((line) => ["TransUnion", "Experian", "Equifax"].includes(line)),
    ["TransUnion", "Experian", "Equifax"]);
  assert.ok(lines.includes("scores[1].scoreValue: 703"));
  assert.ok(lines.includes("tradelines[1].currentBalance: 450"));
  assert.ok(lines.includes("inquiries[1].creditorName: Bank Two"));
  assert.ok(lines.includes("publicRecords[1].type: Bankruptcy"));
  assert.ok(lines.includes("scores.ex: 703"));
  assert.ok(lines.includes("bureauStatus.EQ: file_returned"));
  assert.ok(lines.includes("requestIds.TU: request-tu"));
  assert.ok(lines.includes("businessReports[1].businessName: Example Company"));
  assert.ok(lines.includes("requestData.ssn: [redacted]"));
  assert.equal(lines.some((line) => line.includes("123456789")), false);
});

test("partial result identifies absent bureaus and never paints a zero score", async () => {
  const result = { ...RESULT, bureaus: { EX: RESULT.bureaus.EX }, bureauStatus: { TU: "frozen", EQ: "no_file" } };
  const lines = creditReportLines(result).map((row) => row.heading || row.text);
  assert.ok(lines.includes("Status: frozen"));
  assert.ok(lines.includes("Status: no_file"));
  assert.equal(lines.some((line) => /scoreValue: 0/.test(line)), false);
  const bytes = await buildCrsFullReportPdf(result, { clientName: "Test Person" });
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
});

test("long source data paginates instead of truncating", async () => {
  const result = { ...RESULT, bureaus: { TU: { tradelines: Array.from({ length: 120 }, (_, i) => ({ accountIdentifier: `account-${i}`, balance: i })) } } };
  const bytes = await buildCrsFullReportPdf(result);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
});
