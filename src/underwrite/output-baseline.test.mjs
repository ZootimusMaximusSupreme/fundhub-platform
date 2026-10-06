// UnderwriteIQ OUTPUT BASELINE — the tripwire.
//
// WHAT THIS FILE IS FOR
// Somebody is about to merge changes that touch UnderwriteIQ. This file records
// exactly what UnderwriteIQ produces TODAY, from inputs that never change. If a
// merge, a refactor or an upstream refresh alters what a client is told — a
// number, a sentence, a document that appears or disappears — one of these tests
// goes red and names the surface that moved.
//
// It does not judge whether a change is good. It only makes a change impossible
// to miss. A red test here means: a human has to look and decide.
//
// WHEN ONE OF THESE FAILS
// Do NOT edit the recorded value to make it green. That deletes the alarm. Find
// out what moved, confirm the new output is intended, then update the recorded
// value in the SAME commit as the change that caused it, and say so in the
// commit message.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY EVERY INPUT HERE IS CLOCK-STABLE
//
// Three things in this pipeline read the system clock, and each one would turn
// this file into a false alarm on a future date:
//
//   1. computeUnderwrite ages tradelines through monthsSince(tl.opened) and calls
//      a line "seasoned" at >= 24 months. Same rule as ./fixtures.test.mjs: every
//      `opened` here is either null (never seasoned) or "1990-01" (seasoned for
//      centuries). Never a date near the 24-month line.
//   2. black-report-client's monthsOpen() ages the AU account. Every openedDate
//      in the fixture is null, so au_account.age is "" forever.
//   3. The WeasyPrint printer stamps today's date into the PDF. That is why the
//      byte/text pin below runs against the pdf-lib printer (engine: "node") and
//      the WeasyPrint path is pinned by its INPUT (the CLIENT dict) and its
//      TEMPLATE (the generator script), not its output. See NOT LOCKED, below.
//   4. The pdf-lib printer used to leave the cover DATE blank, which is what made
//      it clock-safe and is exactly the defect F50 recorded — every document the
//      live site produced carried an empty date box. It now prints the day the
//      credit file was pulled, so ENGINE_RESULT below carries a fixed `pulledAt`
//      and the printed date is a property of the INPUT, not of the calendar.
//
// ─────────────────────────────────────────────────────────────────────────────
// NOT LOCKED BY THIS FILE — stated so nobody mistakes green here for total cover
//
//   * The WeasyPrint PDF text itself. It carries today's date and depends on a
//     Python install that is not on every machine. Locked instead: the CLIENT
//     dict handed to it, and the sha256 of scripts/black-reports/fundhub_gen.py.
//   * A real database. buildLetterPackForClient is exercised below through a
//     read-only stub of its two queries — that is deliberate, because building
//     the repair pack WITHOUT a stored credit pull skips the whole escalation
//     path and pins nothing. Real Postgres behaviour stays in
//     ./underwriteiq.pg.test.mjs.
//   * The exact dispute-letter list produced from the vendored sandbox pull.
//     Which accounts the scoring engine calls derogatory can move with the
//     calendar, and this file must never turn into a dated false alarm. What IS
//     pinned for that pull: that dispute letters exist at all, and the exact
//     escalation tail that follows them.
//   * Live Claude summary text. ANTHROPIC_API_KEY is removed below, exactly as
//     ./letter-pack.test.mjs does, so the letter pack never calls out.
//   * PDF byte size. PDFs embed timestamps, so byte length is not a stable pin.
//     Extracted TEXT is.
// ─────────────────────────────────────────────────────────────────────────────

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeUnderwrite, buildSuggestions } from "./engine.mjs";
import { buildBlackReportClient, emptyBlackReportClient } from "./black-report-client.mjs";
import { printBlackReports, BLACK_REPORT_SCRIPT } from "./black-report-pdf.mjs";
import { printBlackReportsNode } from "./black-report-node.mjs";
import { buildLetterPack, buildLetterPackForClient, PACK_REASON } from "./letter-pack.mjs";
import { mergeBureauReports } from "../finance/crs-map.mjs";
import { extractPdfText } from "../company-brain/pdf-text.mjs";

// Never call live Claude from a unit test. Same guard as ./letter-pack.test.mjs.
delete process.env.ANTHROPIC_API_KEY;
// buildBlackReportClient resolves the booking link into the client dict, so a
// developer with either of these set locally would otherwise see a different
// digest than CI. With both gone the resolver returns its own fixed default.
delete process.env.BOOKING_URL;
delete process.env.SALES_MEET_BOOKING_URL;

/* ─────────────── digest helpers ─────────────── */

/** Key-order-independent JSON. Reordering object keys must not fire the alarm. */
function canon(value) {
  if (Array.isArray(value)) return "[" + value.map(canon).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort()
      .map((k) => JSON.stringify(k) + ":" + canon(value[k])).join(",") + "}";
  }
  return JSON.stringify(value === undefined ? null : value);
}
const sha256 = (input) => createHash("sha256").update(input).digest("hex");
const digest = (value) => sha256(canon(value));

/** One line of plain English on every failure, so the red test explains itself. */
function pinned(actual, expected, surface) {
  assert.equal(actual, expected,
    `UNDERWRITEIQ OUTPUT CHANGED — ${surface}. What this client is shown is not what ` +
    `it was when this baseline was recorded (2026-08-28, branch audit/baseline-wf, ` +
    `origin/main 4d6cf31b). Do not edit the expected value to go green: find what moved, ` +
    `confirm it was meant, then update this line in the same commit.`);
}

/* ═══════════════ THE PINNED INPUTS ═══════════════ */

const PERSONAL = Object.freeze({
  name: "Fixture Client",
  address: "100 Test Ave\nDenton, TX 76205",
  state: "TX"
});

/** The shape a stored credit pull arrives in, trimmed to what these surfaces read. */
const ENGINE_RESULT = Object.freeze({
  outcome: "FUNDING_PLUS_REPAIR",
  // Fixed on purpose. See clock-stability note 4 above.
  pulledAt: "2026-03-01T00:00:00.000Z",
  suggestions: ["Pay balances down."],
  consumerSignals: {
    scores: { median: 610, perBureau: { ex: 600, eq: 610, tu: 620 } },
    utilization: { totalBalance: 800, totalLimit: 2000, pct: 40 },
    bureauNegatives: {
      experian: {
        pulled: true, clean: false, count: 1,
        items: [{ creditorName: "TEST CARD BANK", source: "experian", currentRatingType: "ChargeOff", balance: 400 }]
      },
      equifax: { pulled: true, clean: true, count: 0, items: [] },
      transunion: { pulled: true, clean: true, count: 0, items: [] }
    }
  },
  preapprovals: { totalCombined: 5000 },
  projectedPreapproval: { totalCombined: 9000 },
  businessSignals: { available: false },
  normalized: {
    // buildDocuments reads normalized.meta.availableBureaus. Without it the
    // summary documents throw and buildLetterPack reports summarySkip. Present
    // here on purpose so the summary document is exercised rather than skipped.
    meta: { availableBureaus: ["experian", "equifax", "transunion"], bureauCount: 3 },
    tradelines: [
      { source: "experian", creditorName: "TEST CARD BANK", accountType: "revolving", status: "open",
        isDerogatory: true, isAU: false, currentBalance: 800, effectiveLimit: 2000,
        currentRatingType: "ChargeOff", openedDate: null, accountIdentifier: "1234567890" },
      { source: "transunion", creditorName: "TEST AUTO LENDER", accountType: "installment", status: "open",
        isDerogatory: false, isAU: false, currentBalance: 12000, openedDate: null }
    ],
    inquiries: [{ source: "experian", creditorName: "TEST PULL A", date: "2024-04-01" }],
    identity: {
      names: [{ first: "FIXTURE", last: "CLIENT", source: "experian" }],
      addresses: [{ line1: "100 TEST AVE", city: "DENTON", state: "TX", zip: "76205", source: "experian" }],
      employers: [], ssns: [], dobs: []
    }
  }
});

/** Bureau input for the scoring engine. 1990 open dates = seasoned forever. */
const BUREAUS_MAXED = Object.freeze({
  experian: {
    score: 720, utilization_pct: 85, inquiries: 14, negatives: 6, late_payment_events: 2,
    tradelines: [
      { type: "revolving", status: "open", limit: 20000, balance: 17000, opened: "1990-01" },
      { type: "revolving", status: "open", limit: 5000, balance: 4000, opened: "1990-02" },
      { type: "installment", status: "open", limit: 30000, balance: 12000, opened: "1990-03" }
    ]
  }
});
const BUREAUS_SCORE_ONLY = Object.freeze({
  experian: { score: 700, utilization_pct: null, inquiries: null, negatives: null, late_payment_events: null, tradelines: [] }
});
const BUREAUS_NONE = Object.freeze({});

/* ═══════════════ THE RECORDED BASELINE ═══════════════
   Every value below was measured on 2026-08-28 on branch audit/baseline-wf,
   cut from origin/main at commit 4d6cf31b, on macOS with Node 26. */

/* MOVED DELIBERATELY 2026-09-04, W10 — the deliverables rebuild (F43, F44, F45,
   F46, F50). Three of the seven pins below were re-recorded on this branch; the
   four scoring-engine pins did not move, which is the point: the funding numbers
   are exactly what they were and only what is PRINTED changed.

   blackReportClient / emptyBlackReportClient moved because the record gained the
   fields the designed reference set needs and the live documents never had — the
   cover date, a real booking link, the two lender buckets kept apart, the score
   ladder, the engine's own costing-you and not-a-factor findings, and the
   client's business entity — and because accounts that furnish to more than one
   bureau now appear once instead of once per bureau.

   The four printed documents moved for the same reason: they carry those
   sections now. Page counts went 4/3/6/3 to 4/4/8/5.

   MOVED AGAIN 2026-09-04, W10 ROUND 2 REPAIR — generatorScript only, and the
   change is five comment lines plus `*_extra` on the three `for ... in
   c["lenders"]` unpacks in fundhub_gen.py. lenderRow() now returns eleven
   columns, not nine, and the Python read them positionally into exactly nine
   names, so this printer raised ValueError and black-report-pdf.mjs silently
   fell through to the Node printer. Nothing about the LAYOUT moved; the other
   six pins are unchanged, which is the evidence.

   MOVED AGAIN 2026-09-06, W10 ROUND 3 REPAIR — generatorScript ONLY, again, and
   the other six pins are again unchanged. What moved in fundhub_gen.py is one
   defect, in the seven places it was printed: a revolving card with NO REPORTED
   CREDIT LIMIT had no 10% target, and every one of those seven sites fell back
   to row[5], which is the empty string for exactly that card. Sentences ran off
   the end ("Pay AMEX PLATINUM (NPSL) from $5,200 down to ") and two table cells
   went blank where the Node printer has always printed "-". Two new helpers,
   target_text() and paydown_sentence(), are now the only way a target reaches
   the page, and hero_card() will not nominate a card it cannot state a target
   for. No layout, no CSS, no section moved.

   That the other six pins did NOT move is the evidence that the Node printer's
   matching fix — the same defect at its one remaining site, the 6-month
   checklist — changed no byte for a client whose cards all report a limit. It
   only changes the document for the client who has one that does not.

   MOVED AGAIN 2026-09-06, W10 ROUND 4 REPAIR — generatorScript ONLY for the
   THIRD time, and the other six pins are unchanged for the third time. Two
   defects moved in fundhub_gen.py:

     F52. A TOTAL BUILT FROM UNKNOWNS IS UNKNOWN. The vendor engine sums
     `effectiveLimit || 0`, so a file whose open cards report no limit gives a
     total limit of 0 and a 10% target of 0. This printer's Month 1 line then
     read "Total paydown to reach 10% utilization: $0." — telling a client who
     owes $5,200 that he owes nothing — while the Node printer's version of the
     same line printed his ENTIRE balance. black-report-client.mjs now leaves
     that total null and every overall figure here asks util_totals_known()
     first.

     F45. THE LENDER SPLIT REACHED ONLY THE NODE PRINTER. The matcher answers in
     two buckets and black-report-client.mjs:761-762 has carried both across
     since 2026-09-04. This printer still read the flattened `lenders` list, so
     every document it made said "No lenders are matched for immediate funding
     right now" and showed all fifteen as locked, for a client with five open to
     him today. lender_buckets() reads the two buckets and falls back to the flat
     list for a client.json written before they existed.

   blackReportClient did NOT move, which is the evidence that F52's mapper change
   touches only a file where no open card reports a limit — the baseline fixture
   has limits, so its record is byte-identical.

   MOVED AGAIN 2026-09-06, W10 ROUND 3 VERIFIER REPAIR — generatorScript AND, for
   the first time in this sequence, ALL FOUR Node PDF text shas. The four engine
   pins and both client-dict pins are unchanged, which is the evidence that
   nothing about what the mapper computes moved: only what the printers SAY.

     WHY ALL FOUR PDFs AND NOT ONE. The closing page is the same page in all four
     documents, and its opening sentence changed. It used to read "You have
     clean bureaus ready for funding now." in the web pages and the WeasyPrint
     printer — printed to EVERY client, including one whose every bureau this
     system had just marked DIRTY — while this printer led on lenders instead, so
     the same client's pack said two different things depending on which printer
     made it. All three now run one order: the clean bureaus if the file shows
     any, else the lenders already open today, else no claim about either. For
     this baseline client the page now reads "You have clean bureaus ready for
     funding now - Equifax, TransUnion.", which is what its own `bureaus` rows
     say. Verified by extracting the text of all four PDFs on 2026-09-06.

     ALSO IN THIS PRINTER, and not visible in this fixture's text: "You are
     fundable at $0 right now" is no longer printed when the file gives no
     pre-approval, and the lender list's "your utilization is -." no longer puts
     a bare dash inside a sentence. This client has both figures, so its words
     are unchanged by those two.

     IN fundhub_gen.py: the $0-limit repair (a limit REPORTED as zero is a known
     value, not a missing one, and has no 10% target), the same closing-page
     sentence, and the removal of eleven hardcoded claims about accounts,
     bureaus and history that the file may not carry. */
const BASELINE = Object.freeze({
  engineMaxed:            "0581c1b9b5f713dc7958b5e3e1e961b0be245beac174814d9a04068e1a692d0a",
  engineMaxedSuggestions: "d06e816746ef7dddb015f77ebf605b9a7f30f15df1d233b8e47702f4577f2d19",
  engineScoreOnly:        "0fe3f24ebe0560a04fe24fdb14afc974e0725f3e96571ab12b34c5a7e8a589e7",
  engineNoBureaus:        "79f0c7c1d8eb1853e314681051005eeafd3b07550da2855ab9eb6bbffe8a8260",
  blackReportClient:      "d4ead7287903034f5100f0b80ff5e85925e514a34611164beb727bef969599a8",
  emptyBlackReportClient: "21826d2ea2496e6674a8bb909de81d2aef49a277c3470c1f854094950fb2ca79",
  generatorScript:        "0c427de4723017a5046c0dbe41863efa9199378ad99751d39ca050d825ad655e"
});

/** The four PDFs the in-process printer produces, and the words inside each.
 *
 *  All four textSha moved on 2026-09-25, and only on the closing page, which all
 *  four share. The owner replaced the `[ QR CODE ]` square — it drew those literal
 *  words and encoded nothing — with one CTA, "Book your strategy call", on
 *  https://apply.fundhub.ai/roadmap-book. So "SCAN TO BOOK YOUR CALL INSTANTLY"
 *  and "[ QR CODE ]" left the text, and the printed address changed from the
 *  resolved c.booking_url to that page. Page counts are unchanged. */
const BASELINE_NODE_PDFS = Object.freeze([
  { filename: "Credit-Analysis-Report.pdf",     type: "credit_analysis",  pages: 4, textSha: "07f6f52fc59748d9636c159df97950e1e2a37ec909942191b8a2940b2fdf2548" },
  { filename: "Funding-Snapshot.pdf",           type: "funding_snapshot", pages: 4, textSha: "fbd50425127b06b1403ae263618bad6c2d9064287a4036ffe91c1d232ceef659" },
  { filename: "Bank-Lender-Match-List.pdf",     type: "lender_match",     pages: 8, textSha: "1633ece17b34a455a4933cc7b9f527ad62328691b55e5dc2206affd28f4318d4" },
  { filename: "Credit-Optimization-Roadmap.pdf", type: "roadmap",         pages: 5, textSha: "4b3e4698ce339556fc0d2e272812503de54de13bd5059e220661c055dcf132a5" }
]);

/** Every document a client receives, in order. [filename, type, bureau].
 *
 *  The four analysis documents are the web pages, not the short PDFs, since
 *  2026-09-17 (fa847f61b, owner via Cursor: "The four analysis pages are the
 *  pretty web docs, not the short PDFs. Letters stay PDFs."). Same four types,
 *  same order; only the file each one ships as changed. Re-recorded 2026-10-05;
 *  this row was red from that commit until then. The in-process PDF printer
 *  above still makes the four PDFs, and BASELINE_NODE_PDFS still pins them. */
const BASELINE_FUNDING_PACK = Object.freeze([
  ["credit_analysis_report.html",    "credit_analysis",  null],
  ["funding_snapshot.html",          "funding_snapshot", null],
  ["lender_match_list.html",         "lender_match",     null],
  ["optimization_roadmap.html",      "roadmap",          null],
  // Recorded 2026-10-02 with the change that added it: the Business Duplication
  // Map rides right after the four analysis pages (src/underwrite/letter-pack.mjs).
  ["business_duplication_map.html",  "business_duplication_map", null],
  ["Capital-Readiness-Summary.pdf",  "funding_summary",  null],
  ["inquiry_ex.pdf",                 "inquiry_removal",  "experian"],
  ["ex_round1.pdf",                  "dispute",          "experian"]
]);
const BASELINE_REPAIR_PACK = Object.freeze([
  ["ex_round1.pdf", "dispute", "experian"]
]);

/**
 * The escalation tail of a repair pack built from a stored credit pull. The
 * folder name and the cover sheet are part of the document, not decoration:
 * both complaints are sworn under penalty of perjury and are out of order
 * before Round 3. If this tail ever ships loose, or ships without the cover,
 * this baseline goes red.
 */
const BASELINE_ESCALATION_TAIL = Object.freeze([
  ["06-complaints-CONDITIONAL/COVER.txt",                            null,                 null],
  ["06-complaints-CONDITIONAL/CFPB-Complaint.pdf",                   "cfpb_complaint",     null],
  ["06-complaints-CONDITIONAL/State-Attorney-General-Complaint.pdf", "state_ag_complaint", null]
]);

const manifest = (pack) => pack.files.map((f) => [f.filename, f.type ?? null, f.bureau ?? null]);

/* ─────────────── stored credit pulls, for the repair pack ───────────────
   buildLetterPackForClient makes three reads and writes nothing — the client,
   the stored credit pull, and the confirmed bureau answers on file — so a
   read-only stub is enough to run the real entry point the app calls. */

const SANDBOX = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../vendor/underwriteiq-full/api/lite/crs/sandbox"
);
const loadSandbox = (name) => JSON.parse(readFileSync(path.join(SANDBOX, name), "utf8"));

/** A real three-bureau pull the scoring engine can read. */
const STORED_SCOREABLE = mergeBureauReports({
  reports: { TU: loadSandbox("tu.json"), EX: loadSandbox("exp.json"), EQ: loadSandbox("efx.json") },
  requestIds: { TU: "tu-1", EX: "ex-1", EQ: "eq-1" },
  environment: "sandbox"
});

/**
 * A pull stored as one bare bureau file, with no `bureaus` key. The scoring
 * engine throws on this shape (../finance/crs-tier.test.mjs pins the throw),
 * so the pack can write no dispute letters at all.
 */
const STORED_UNSCOREABLE = Object.freeze({
  requestedBureaus: { transunion: false, experian: false, equifax: true },
  responseDetail: { dateRequested: "2026-03-01T21:46:24.834278Z" },
  creditFiles: [{ creditFileDetail: { creditFileInfileDate: "2026-03-01", creditFileResultStatusType: "FileReturned", sourceType: "Equifax" } }],
  tradelines: [{
    accountIdentifier: "5121080011112222", accountOpenedDate: "2019-06-12",
    accountOwnershipType: "Individual", accountReportedDate: "2024-01-01",
    accountStatusType: "Open", accountType: "Revolving", creditorName: "EXAMPLE BANK NA",
    currentBalanceAmount: "1842", currentRatingType: "AsAgreed", sourceType: "Equifax"
  }]
});

/**
 * A client who genuinely reached the escalation rounds: Round 3 was answered
 * "verified" and a human confirmed it, so the round machine moved the account up
 * to R4. Only that pair of facts — status 'escalated', outcome 'verified' —
 * survives the SQL filter in ../underwrite/prior-outcome.mjs loadPriorOutcomes.
 */
const ESCALATED_R4 = Object.freeze([
  Object.freeze({ bureau: "EX", creditor: "EXAMPLE BANK NA", account_last4: "1234", round: "R4" })
]);

// The home address sits on the identity record, where the letters read it
// (letter-pack.mjs NO_HOME_ADDRESS). Same address the fixture always used.
const FIXTURE_HOME = [{ addressLine1: "100 Test Ave", city: "Denton", state: "TX", postalCode: "76205" }];

function fakeClientDb(storedCrs, priorOutcomes = []) {
  return {
    async query(sql) {
      if (/FROM clients/i.test(sql)) {
        return {
          rows: [{
            first_name: "Fixture",
            last_name: "Client",
            custom_fields: {},
            outcome_tier: "REPAIR_ONLY"
          }]
        };
      }
      if (/FROM pii_identity/i.test(sql)) return { rows: [{ addresses: FIXTURE_HOME }] };
      if (/FROM crs_results/i.test(sql)) return { rows: storedCrs ? [{ result: storedCrs }] : [] };
      // The confirmed bureau answers on file. Empty is the default and means the
      // client is still on Round 1, which is where every client starts.
      if (/FROM dispute_items/i.test(sql)) return { rows: [...priorOutcomes] };
      return { rows: [] };
    }
  };
}

/* ═══════════════ 1. THE SCORING ENGINE ═══════════════ */

describe("baseline — the scoring engine's whole answer", () => {
  test("maxed-out file: every number and every sentence is unchanged", () => {
    const uw = computeUnderwrite(BUREAUS_MAXED, 30);
    pinned(digest(uw), BASELINE.engineMaxed, "the funding assessment for a maxed-out file");
    pinned(digest(buildSuggestions(uw)), BASELINE.engineMaxedSuggestions,
      "the advice sentences shown to a client with a maxed-out file");

    // Spelled out in plain terms so a failure above can be read without a debugger.
    assert.equal(uw.fundable, false);
    assert.equal(uw.metrics.score, 720);
    assert.equal(uw.metrics.utilization_pct, 85);
    assert.equal(uw.personal.highest_revolving_limit, 20000);
    assert.equal(uw.personal.card_funding, 110000);
  });

  test("a score and nothing else: unknown must not read as clean", () => {
    const uw = computeUnderwrite(BUREAUS_SCORE_ONLY, null);
    pinned(digest(uw), BASELINE.engineScoreOnly,
      "the funding assessment for a client where only a credit score was entered");
    // The rule this baseline exists to protect: blanks stay blank, never zero.
    assert.equal(uw.metrics.negative_accounts, null);
    assert.equal(uw.metrics.late_payment_events, null);
    assert.equal(uw.metrics.utilization_pct, null);
    assert.equal(uw.fundable, false);
  });

  test("no credit pull at all", () => {
    const uw = computeUnderwrite(BUREAUS_NONE, null);
    pinned(digest(uw), BASELINE.engineNoBureaus,
      "the funding assessment for a client with no credit pull on file");
    assert.equal(uw.fundable, false);
    assert.equal(uw.lite_banner_funding, null);
  });
});

/* ═══════════════ 2. THE BLACK REPORT CLIENT DICT ═══════════════
   This object is the single input to both PDF printers. If it moves, every
   document a client receives moves with it. */

describe("baseline — the black report client record", () => {
  test("the whole record is unchanged", () => {
    const client = buildBlackReportClient({ crsResult: ENGINE_RESULT, personal: PERSONAL });
    pinned(digest(client), BASELINE.blackReportClient,
      "the record that fills every client-facing funding document");

    // The handful a human would actually check on a printed report.
    assert.equal(client.applicant, "Fixture Client");
    assert.deepEqual(client.scores, { experian: 600, equifax: 610, transunion: 620 });
    assert.equal(client.preapproval_now, 5000);
    assert.equal(client.preapproval_after, 9000);
    assert.equal(client.util_pct, "40%");
    assert.equal(client.negatives.length, 1);
    // Clock-stable check: no open dates in the fixture, so no aged field is set.
    assert.equal(client.au_account.age, "");
  });

  test("the empty record stays empty — no invented client", () => {
    const empty = buildBlackReportClient({});
    pinned(digest(empty), BASELINE.emptyBlackReportClient,
      "the blank record used when there is no credit pull");
    assert.equal(empty.applicant, "Client");
    /* The booking link is the ONE field that does not come from a credit pull —
       it is where the client books a call, and that is true before any pull
       exists. Everything else on a blank record stays blank. */
    assert.equal(digest(empty),
      digest({ ...emptyBlackReportClient(), applicant: "Client", booking_url: empty.booking_url }),
      "a blank pull must produce the blank record, with nothing but the booking link filled in");
    assert.equal(empty.date, "", "no credit pull, no date");
    assert.equal(empty.preapproval_now, null, "no credit pull, no funding number");
    assert.deepEqual(empty.lenders_now, []);
    assert.deepEqual(empty.costing_you, []);
    assert.match(empty.booking_url, /^https?:\/\//,
      "the booking link must be a real address, never a placeholder");
  });
});

/* ═══════════════ 3. THE PDFs THE APP PRINTS ITSELF ═══════════════
   printBlackReportsNode is the pdf-lib printer: pure JavaScript, no Python, no
   date stamp. That is what makes it safe to pin word for word. */

describe("baseline — the four PDFs the app prints in-process", () => {
  test("same four documents, same words in each", async () => {
    const client = buildBlackReportClient({ crsResult: ENGINE_RESULT, personal: PERSONAL });
    const printed = await printBlackReportsNode({ client });
    assert.equal(printed.skip, null, "the in-process printer must not skip");
    assert.equal(printed.engine, "pdf-lib");

    const actual = [];
    for (const file of printed.files) {
      assert.equal(file.content.subarray(0, 4).toString(), "%PDF", `${file.filename} is not a PDF`);
      const read = await extractPdfText(file.content);
      actual.push({
        filename: file.filename,
        type: file.type,
        pages: read.pageCount,
        textSha: sha256(read.text.replace(/\s+/g, " ").trim())
      });
    }
    assert.deepEqual(actual.map((f) => [f.filename, f.type]),
      BASELINE_NODE_PDFS.map((f) => [f.filename, f.type]),
      "UNDERWRITEIQ OUTPUT CHANGED — the set or order of client documents moved");
    for (let i = 0; i < BASELINE_NODE_PDFS.length; i++) {
      pinned(actual[i].pages, BASELINE_NODE_PDFS[i].pages, `page count of ${actual[i].filename}`);
      pinned(actual[i].textSha, BASELINE_NODE_PDFS[i].textSha, `the words printed in ${actual[i].filename}`);
    }
  });

  test("printBlackReports with engine 'node' takes the same path", async () => {
    const client = buildBlackReportClient({ crsResult: ENGINE_RESULT, personal: PERSONAL });
    const printed = await printBlackReports({ client, engine: "node" });
    assert.equal(printed.engine, "pdf-lib");
    assert.deepEqual(printed.files.map((f) => f.filename),
      BASELINE_NODE_PDFS.map((f) => f.filename));
  });
});

/* ═══════════════ 4. THE WEASYPRINT PRINTER ═══════════════
   Its output carries today's date, so the output cannot be pinned. Its TEMPLATE
   can. If anyone edits the printer, this fires. */

describe("baseline — the WeasyPrint document template", () => {
  test("the generator script is byte-for-byte unchanged", () => {
    assert.ok(existsSync(BLACK_REPORT_SCRIPT),
      `the black report generator is missing: ${BLACK_REPORT_SCRIPT}`);
    pinned(sha256(readFileSync(BLACK_REPORT_SCRIPT)), BASELINE.generatorScript,
      "scripts/black-reports/fundhub_gen.py, which lays out every printed funding document");
  });
});

/* ═══════════════ 5. THE LETTER PACK ═══════════════
   What a client actually receives, and in what order. */

describe("baseline — the document pack a client receives", () => {
  test("funding pack: same documents, same order", async () => {
    const pack = await buildLetterPack({ crsResult: ENGINE_RESULT, personal: PERSONAL, pack: "funding" });
    assert.deepEqual(manifest(pack), BASELINE_FUNDING_PACK.map((r) => [...r]),
      "UNDERWRITEIQ OUTPUT CHANGED — the funding pack a client receives is not the same " +
      "set of documents, or not in the same order, as when this baseline was recorded.");
    pinned(pack.reason, null, "the funding pack's reason code");
    pinned(pack.deliverableCount, 5, "the four funding analysis documents plus the Business Duplication Map");
    pinned(pack.deliverableSkip, null, "the funding analysis skip reason");
    pinned(pack.summarySkip, null, "the summary document skip reason");
    /* Every file is a real document of the kind its name says: the .pdf files
       are PDFs (magic bytes, not just a label), and the web pages are HTML
       documents. Before 2026-09-17 every file here was a PDF. */
    for (const file of pack.files) {
      if (file.filename.endsWith(".html")) {
        assert.equal(file.contentType, "text/html", file.filename);
        assert.match(String(file.content).trimStart().slice(0, 15).toLowerCase(), /^<!doctype html|^<html/,
          `${file.filename} is not an HTML document`);
      } else {
        assert.equal(file.contentType, "application/pdf", file.filename);
        assert.equal(file.content.subarray(0, 4).toString(), "%PDF", `${file.filename} is not a PDF`);
      }
    }
  });

  test("repair pack, no stored credit pull: same documents, same order", async () => {
    const pack = await buildLetterPack({ crsResult: ENGINE_RESULT, personal: PERSONAL, pack: "repair" });
    assert.deepEqual(manifest(pack), BASELINE_REPAIR_PACK.map((r) => [...r]),
      "UNDERWRITEIQ OUTPUT CHANGED — the repair pack a client receives moved.");
    pinned(pack.reason, null, "the repair pack's reason code");
    pinned(pack.deliverableCount, 0, "funding analysis documents in a repair pack");
    pinned(pack.deliverableSkip, "not_funding", "why a repair pack has no funding analysis");
    // No recorded bureau answer means this client is on Round 1, and Round 1 has
    // not earned a complaint sworn under penalty of perjury. That gate is checked
    // before the stored pull, so the reason reads "not_escalated" and no longer
    // "no_stored_crs" (changed 2026-08-28 with the escalation gate; both mean
    // zero complaint files). Recorded so nobody reads this test as cover for the
    // escalation path — it is not.
    pinned(pack.complaintCount, 0, "complaints in a repair pack built with no stored credit pull");
    pinned(pack.complaintSkip, "not_escalated", "why that pack has no complaints");
  });

  test("no credit pull: the pack says so, and says which kind of nothing", async () => {
    const pack = await buildLetterPack({ personal: { name: "Chris Sample", address: "1 Main St" }, pack: "funding" });
    pinned(pack.files.length, 0, "the pack for a client with no credit pull");
    pinned(pack.reason, PACK_REASON.NO_ENGINE_RESULT, "the reason code for a client with no credit pull");
    pinned(pack.deliverableSkip, "no_engine", "the funding analysis skip reason with no credit pull");
    pinned(pack.summarySkip, "no_normalized", "the summary skip reason with no credit pull");
  });
});

/* ═══════════════ 6. THE REPAIR PACK, THROUGH THE REAL ENTRY POINT ═══════════════

   COMPLIANCE REVIEW REQUIRED — dispute logic and credit-repair messaging.

   Section 5 builds the repair pack with no stored credit pull, so the escalation
   path exits at its first line and pins nothing about it. That is how the CFPB
   and state AG complaints once shipped with no dispute letters and no warning
   sheet while this file stayed green.

   These run buildLetterPackForClient — the function ds-02-diy-letters and
   closer-deck actually call — with a stored credit pull in the database stub. */

describe("baseline — the repair pack a client receives, with a credit pull on file", () => {
  test("A ROUND 1 CLIENT: the same letters, and NO sworn complaint", async () => {
    // Pinned as its own baseline because it is the common case. Almost every
    // client is here. Until 2026-08-28 this client received both complaints.
    const pack = await buildLetterPackForClient(fakeClientDb(STORED_SCOREABLE), { clientId: "cl-1", pack: "repair" });
    pinned(pack.reason, null, "the repair pack's reason code for a Round 1 client");
    const rows = manifest(pack);
    assert.ok(rows.filter(([name]) => /round\d/.test(name)).length > 0,
      "UNDERWRITEIQ OUTPUT CHANGED — a Round 1 client stopped receiving dispute letters.");
    assert.deepEqual(rows.filter(([name]) => name.startsWith("06-complaints-CONDITIONAL/")), [],
      "UNDERWRITEIQ OUTPUT CHANGED — a client on Round 1 is being handed a complaint "
      + "they must sign under penalty of perjury, saying they already disputed.");
    pinned(pack.complaintCount, 0, "complaints for a client with no recorded bureau answer");
    pinned(pack.complaintSkip, "not_escalated", "why a Round 1 client has no complaints");
    pinned(pack.escalationRound, null, "the escalation round on record for a Round 1 client");
  });

  test("a readable pull at R4: dispute letters, then the conditional complaints", async () => {
    const pack = await buildLetterPackForClient(
      fakeClientDb(STORED_SCOREABLE, ESCALATED_R4),
      { clientId: "cl-1", pack: "repair" }
    );
    pinned(pack.reason, null, "the repair pack's reason code with a readable credit pull");
    pinned(pack.escalationRound, "R4", "the recorded round that released the complaints");
    pinned(pack.engineSkip, null, "the engine skip reason for the sandbox pull");

    const rows = manifest(pack);
    const disputes = rows.filter(([name]) => /round\d/.test(name));
    assert.ok(disputes.length > 0,
      "UNDERWRITEIQ OUTPUT CHANGED — a readable credit pull stopped producing dispute letters.");
    assert.deepEqual(rows.slice(-3), BASELINE_ESCALATION_TAIL.map((r) => [...r]),
      "UNDERWRITEIQ OUTPUT CHANGED — the escalation tail moved. The two complaints must " +
      "come last, inside 06-complaints-CONDITIONAL, behind the cover sheet that says " +
      "DO NOT FILE WITH ROUND 1.");
    pinned(pack.complaintCount, 3, "the number of escalation files (cover sheet + two complaints)");
    pinned(pack.complaintSkip, null, "the escalation skip reason on a readable pull");
  });

  test("A PULL THE ENGINE CANNOT READ SHIPS NOTHING, AND SAYS WHY", async () => {
    // The regression. Complaint files must never make a failed pack look like it
    // produced something: ds-02-diy-letters and closer-deck both decide
    // Delivered vs Delivery Failed on nothing but "are there files?".
    const pack = await buildLetterPackForClient(fakeClientDb(STORED_UNSCOREABLE), { clientId: "cl-1", pack: "repair" });
    pinned(pack.files.length, 0, "the pack for a client whose stored credit pull cannot be read");
    pinned(pack.complaintCount, 0, "complaints on a pull the engine could not read");
    pinned(pack.complaintSkip, "no_dispute_letters", "why that pack has no complaints");
    pinned(pack.reason, "engine_error: rawResponsesFromMerged: no bureau reports to score",
      "the reason code for a stored credit pull the engine cannot read");
  });

  test("a readable pull with nothing to dispute: an empty pack, honestly empty", async () => {
    // The benign case. The engine ran, this client has no dispute to send, and
    // the complaints do not quietly fill the gap.
    const pack = await buildLetterPackForClient(
      fakeClientDb({ bureausPulled: ["EQ"], bureaus: { EQ: STORED_UNSCOREABLE } }),
      { clientId: "cl-1", pack: "repair" }
    );
    pinned(pack.files.length, 0, "the pack for a client with a clean readable pull");
    pinned(pack.reason, PACK_REASON.EMPTY_PACK, "the reason code for a clean readable pull");
    pinned(pack.complaintCount, 0, "complaints on a clean readable pull");
    pinned(pack.complaintSkip, "no_dispute_letters", "why a clean pull has no complaints");
  });
});
