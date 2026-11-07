/* The Decline Autopsy report — the three rules it has to enforce in code.
 *
 *   1. NO EARNINGS CLAIM anywhere. FundHub has zero measured paid closes.
 *   2. NO CREDIT-OUTCOME CLAIM anywhere.
 *   3. NULL IS NOT ZERO. An unmodelled row is counted, shown as a dash, and
 *      excluded from every total — with the exclusion printed.
 *
 * Pure: no database, no clock beyond the one passed in.
 */
import { test, describe } from "node:test";
import assert from "node:assert";

import { buildAutopsyReport, money, partnerEntryTerm, AUTOPSY_PRODUCT_CODE } from "./report.mjs";
import { OFFERS, formatCents } from "../config/offers.mjs";
import { BUCKETS } from "./fields.mjs";
import { FUNDING_PRODUCT_CODES, REPAIR_PRODUCT_CODES } from "../affiliates/economics.mjs";
import { fromCents } from "../commissions/money.mjs";

const scored = (over = {}) => ({
  row_label: "A-1",
  fico_band: "720+",
  state: "TX",
  decline_reason: "credit_score",
  bucket: BUCKETS.FUNDABLE_NOW,
  estimated_capacity_cents: 10_000_000,
  estimated_fee_cents: 1_000_000,
  estimated_partner_share_cents: 500_000,
  lender_match_count: 3,
  assumptions: ["midpoint 740"],
  ...over
});

const unknownRow = (label) => scored({
  row_label: label,
  bucket: BUCKETS.NOT_ENOUGH_INFORMATION,
  estimated_capacity_cents: null,
  estimated_fee_cents: null,
  estimated_partner_share_cents: null,
  lender_match_count: null
});

const REVIEWED = new Date("2026-08-31T12:00:00Z");

describe("*** NULL IS NOT ZERO, all the way to the screen ***", () => {
  const report = buildAutopsyReport({
    rows: [scored(), scored({ row_label: "A-2" }), unknownRow("A-3"), unknownRow("A-4")],
    reviewedAt: REVIEWED
  });

  test("an unmodelled row shows a dash, never $0.00", () => {
    const row = report.rows.find((r) => r.row_label === "A-3");
    assert.equal(row.estimated_capacity.display, "—");
    assert.equal(row.estimated_capacity.cents, null);
    assert.equal(row.estimated_capacity.known, false);
    assert.notEqual(row.estimated_capacity.display, "0.00");
  });

  test("*** unmodelled rows are in NO total ***", () => {
    // Two modelled rows at $100,000 each. If the two unknowns had become zero
    // the total would be the same number — so the count is asserted too.
    assert.equal(report.worth.rows_reviewed, 4);
    assert.equal(report.worth.rows_counted_in_totals, 2);
    assert.equal(report.worth.rows_excluded, 2);
    assert.equal(report.worth.steps[0].value.cents, 20_000_000);
    assert.equal(report.worth.steps[0].value.display, fromCents(20_000_000));
  });

  test("the exclusion is printed, and it names the rows", () => {
    assert.match(report.worth.excluded_note, /2 rows excluded/);
    assert.match(report.worth.excluded_note, /not enough information/);
    assert.deepEqual(report.worth.excluded_row_labels, ["A-3", "A-4"]);
  });

  test("the fourth count is shown as prominently as the other three", () => {
    assert.deepEqual(report.counts.fundable_now, 2);
    assert.deepEqual(report.counts.not_enough_information, 2);
    assert.equal(typeof report.counts.labels.not_enough_information, "string");
  });

  test("money(null) is a dash with a reason; money(0) is a real zero", () => {
    assert.equal(money(null).display, "—");
    assert.equal(money(null).known, false);
    assert.equal(money(0).display, "0.00");
    assert.equal(money(0).known, true);
  });

  test("a lender count we do not have is null, not zero", () => {
    const row = report.rows.find((r) => r.row_label === "A-3");
    assert.equal(row.lender_match_count, null);
    assert.equal(report.lender_eligibility.rows_checked, 2, "an unknown was counted as a checked row");
  });
});

describe("*** no earnings claim, no credit-outcome claim ***", () => {
  const report = buildAutopsyReport({ rows: [scored(), unknownRow("A-9")], buyerName: "Sam", reviewedAt: REVIEWED });
  const text = JSON.stringify(report).toLowerCase();

  test("every money figure is labelled an estimate", () => {
    for (const row of report.rows) {
      for (const key of ["estimated_capacity", "estimated_fee", "estimated_partner_share"]) {
        assert.equal(row[key].estimate, true, `${row.row_label}.${key} is not labelled an estimate`);
      }
    }
    for (const step of report.worth.steps) {
      assert.equal(step.value.estimate, true, `"${step.label}" is not labelled an estimate`);
      assert.ok(step.value.assumption, `"${step.label}" shows a number with no assumption beside it`);
    }
  });

  test("nothing says the buyer WILL earn anything", () => {
    for (const phrase of ["you will earn", "you will make", "guaranteed", "average broker earns", "expect to earn"]) {
      assert.equal(text.includes(phrase), false, `the report contains an earnings claim: "${phrase}"`);
    }
    assert.match(report.worth.plain_english, /not a prediction of what you will be paid/);
  });

  test("nothing claims a credit outcome", () => {
    for (const phrase of ["raise your score", "boost your score", "remove negative", "delete the negative",
                          "fix your credit", "guaranteed removal", "we will improve"]) {
      assert.equal(text.includes(phrase), false, `the report claims a credit outcome: "${phrase}"`);
    }
  });

  test("the disclosure sits at the TOP and says no credit was looked at", () => {
    assert.match(report.disclosure[0], /did not look at anyone's credit/);
    assert.match(report.disclosure.join(" "), /will not contact any of these people/);
    assert.match(report.footer.no_credit_pull, /Nothing on this page came from a credit bureau/);
  });

  test("the doors describe TERMS, not outcomes", () => {
    const partner = report.doors.find((d) => d.key === "partner");
    const affiliate = report.doors.find((d) => d.key === "affiliate");
    assert.match(partner.terms.join(" "), /\$30,000 one time/);
    assert.match(partner.terms.join(" "), /50% of funding and repair/);
    assert.match(partner.terms.join(" "), /Ten funded clients a month/);
    assert.equal(partner.apply.track, "white_label");
    assert.equal(affiliate.apply.track, "affiliate");
    assert.match(affiliate.terms.join(" "), /20% on funding deposit collected/);
    for (const d of report.doors) {
      assert.doesNotMatch(d.terms.join(" "), /\bearn(?!ing on)/i, `${d.key} promises earnings`);
    }
  });

  test("the partner door's price is the catalogue's PARTNER_ENTRY, never typed (owner-set 2026-11-07)", () => {
    const partner = report.doors.find((d) => d.key === "partner");
    assert.equal(formatCents(OFFERS.PARTNER_ENTRY.priceCents), "$30,000");
    assert.equal(partner.terms[0], `${formatCents(OFFERS.PARTNER_ENTRY.priceCents)} one time. No monthly fee on the base program.`);
  });

  test("a different entry price changes the line; an unusable one names no figure", () => {
    const other = buildAutopsyReport({ rows: [scored()], reviewedAt: REVIEWED, entryPriceCents: 2500000 });
    assert.equal(other.doors.find((d) => d.key === "partner").terms[0], "$25,000 one time. No monthly fee on the base program.");
    assert.equal(partnerEntryTerm(null), "One entry fee, one time. No monthly fee on the base program.");
  });

  test("the lender list itself never leaves — counts only", () => {
    assert.equal("lenders" in report.lender_eligibility, false);
    assert.match(report.lender_eligibility.note, /We do not publish which lenders/);
  });
});

describe("*** the $27 accrues no partner and no affiliate commission ***", () => {
  test("decline-autopsy is in neither commissionable product list", () => {
    // W0-decisions.md: e-products stay 100% FundHub. The existing lists are
    // already narrow and correct; this test is what stops somebody widening
    // them later without noticing what it costs.
    assert.equal(FUNDING_PRODUCT_CODES.includes(AUTOPSY_PRODUCT_CODE), false,
      "decline-autopsy was added to FUNDING_PRODUCT_CODES — the $27 would start splitting");
    assert.equal(REPAIR_PRODUCT_CODES.includes(AUTOPSY_PRODUCT_CODE), false,
      "decline-autopsy was added to REPAIR_PRODUCT_CODES — the $27 would start splitting");
  });

  test("and the report says so on its face", () => {
    const report = buildAutopsyReport({ rows: [scored()], reviewedAt: REVIEWED });
    assert.equal(report.footer.product_code, "decline-autopsy");
    assert.match(report.footer.commission_note, /No partner or affiliate commission is paid on it/);
  });
});

describe("the panels", () => {
  test("decline reasons are grouped so the pattern is visible", () => {
    const report = buildAutopsyReport({
      rows: [
        scored({ row_label: "A", decline_reason: "credit_score" }),
        scored({ row_label: "B", decline_reason: "credit_score" }),
        scored({ row_label: "C", decline_reason: "thin_file" }),
        scored({ row_label: "D", decline_reason: null })
      ],
      reviewedAt: REVIEWED
    });
    assert.equal(report.decline_reasons[0].reason, "credit_score");
    assert.equal(report.decline_reasons[0].count, 2);
    assert.deepEqual(report.decline_reasons[0].row_labels, ["A", "B"]);
    assert.ok(report.decline_reasons.find((g) => g.reason === "not_given"));
  });

  test("rows are keyed by the broker's OWN label", () => {
    const report = buildAutopsyReport({ rows: [scored({ row_label: "Jones file" })], reviewedAt: REVIEWED });
    assert.equal(report.rows[0].row_label, "Jones file");
  });

  test("an empty upload does not divide by anything", () => {
    const report = buildAutopsyReport({ rows: [], reviewedAt: REVIEWED });
    assert.equal(report.ok, true);
    assert.equal(report.worth.rows_reviewed, 0);
    assert.equal(report.worth.steps[0].value.cents, 0);
    assert.match(report.worth.excluded_note, /No rows were excluded/);
  });

  test("the arithmetic is shown as arithmetic", () => {
    const report = buildAutopsyReport({ rows: [scored(), scored({ row_label: "A-2" })], reviewedAt: REVIEWED });
    assert.equal(report.worth.steps[1].value.cents, 2_000_000);   // 10% of $200,000
    assert.equal(report.worth.steps[2].value.cents, 1_000_000);   // half of that
    assert.match(report.worth.steps[1].value.assumption, /percentOf\(20000000, 10\)/);
    assert.match(report.worth.steps[2].value.assumption, /applySplit\(2000000, 50\)/);
  });
});
