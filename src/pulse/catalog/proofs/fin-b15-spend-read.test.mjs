// Practice test (fake data, the REAL step 6 code) for the Marketing Command Center row
//   "Ideas flywheel step 6 (spend): run button 'Read the spend (free, no model)', Read it, Approve, Tweak, ..."
//
// The live check on this row reads the saved file's SHAPE (its stamp, its path, its approve edit) and the
// Tweak note's line. It cannot read the numbers inside 06-spend.md without reading the ad metrics again,
// and a metrics read that moves by the hour (late Meta counts) would turn a saved file red for no break.
// So the numbers are judged here, once, the way they are made: readSpend (src/marketing/flywheel/
// spend-read.mjs) over a stand-in transaction that answers the three reads it makes with known rows, then
// spendDocument over that read. The file must say every number the reads gave, nothing else, and the
// file must agree with itself: the total spend equals the ads with a number plus the spend on ads with no
// number (which is how the total and the rows are cut, src/marketing/metrics.mjs readTotals).
//
// Breaks made on purpose (each alone, then put back): totals.spend_cents doubled in readSpend (the
// checker's break); one ad's spend_cents doubled; the unmatched spend dropped. Each turns a test red.

import assert from "node:assert/strict";
import test from "node:test";

import { readSpend, concludeSpend, spendDocument } from "../../../marketing/flywheel/spend-read.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-06T19:00:00Z");

const spendCols = { impressions: null, link_clicks: null, plays: null, p25: null, thruplay: null, two_sec: null, ad_days: 5, link_click_days: 0, play_days: 0, two_sec_days: 0 };
const leadCols = { leads: 0, booked: 0, showed: 0, sales: 0, roadmaps: 0, cash_cents: 0, cash_unknown: 0, reported_cash_cents: 0, maturing_leads: 0 };

/** The three statements readSpend makes, answered with rows whose numbers are known. */
function stand({ numbers, totals, purchases = [] }) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/lead_by_number/.test(sql)) return { rows: numbers };
      if (/FROM spend_total, lead_total/.test(sql)) return { rows: [totals] };
      if (/sum\(m\.purchases\)/.test(sql)) return { rows: purchases };
      throw new Error(`unexpected statement: ${sql.slice(0, 60)}`);
    }
  };
}

const KNOWN = () => stand({
  numbers: [
    { ad_number: "84", ads: 1, ...spendCols, spend_cents: 49801, impressions: 9000, link_clicks: 31, plays: 400, p25: 300, ...leadCols, leads: 0 },
    { ad_number: "90", ads: 1, ...spendCols, spend_cents: 15000, impressions: 3000, link_clicks: 120, plays: 90, p25: 40, ...leadCols, leads: 3, booked: 1, showed: 1, sales: 1, cash_cents: 29700 }
  ],
  totals: {
    ...spendCols, spend_cents: 71801, impressions: 12000, link_clicks: 151, plays: 490, p25: 340, ad_days: 11,
    ...leadCols, leads: 3, booked: 1, showed: 1, sales: 1, cash_cents: 29700,
    unmapped_spend_cents: 7000, unmapped_ad_days: 1, unmapped_ads: 1, unmapped_leads: 0
  },
  purchases: [{ ad_number: "90", purchases: 2, purchase_days: 3 }]
});

const dollars = (text) => Math.round(Number(String(text).replace(/[$,]/g, "")) * 100);

async function theFile() {
  const tx = KNOWN();
  const read = await readSpend(tx, { orgId: ORG, now: NOW });
  const doc = spendDocument({ campaignName: "Partner offer", read, conclusion: concludeSpend(read.totals) });
  return { read, doc, tx };
}

test("the read gives back every number the three statements gave, for the 30 Arizona days ending yesterday", async () => {
  const { read, tx } = await theFile();
  assert.deepEqual({ from: read.from, to: read.to }, { from: "2026-09-06", to: "2026-10-05" });
  assert.ok(tx.calls.every((c) => c.params[0] === ORG && c.params[1] === "2026-09-06" && c.params[2] === "2026-10-05"));
  assert.equal(read.totals.spend_cents, 71801);
  assert.equal(read.totals.link_clicks, 151);
  assert.equal(read.totals.leads, 3);
  assert.equal(read.totals.sales_ours, 1);
  assert.equal(read.totals.sales_meta, 2);
  assert.deepEqual(read.unmatched, { spend_cents: 7000, ads: 1, ad_days: 1, leads: 0 });
  assert.deepEqual(read.rows.map((r) => [r.ad_number, r.spend_cents, r.link_clicks, r.leads, r.sales_ours, r.sales_meta]), [
    ["84", 49801, 31, 0, 0, null],
    ["90", 15000, 120, 3, 1, 2]
  ]);
});

test("the file prints those numbers and no others, and unknown stays unknown", async () => {
  const { doc } = await theFile();
  assert.match(doc, /- Ad spend: \$718\.01/);
  assert.match(doc, /- Taps to the page: 151/);
  assert.match(doc, /- Leads: 3/);
  assert.match(doc, /- Our checkout: 1 paid/);
  assert.match(doc, /- Meta says: 2 purchases/);
  assert.match(doc, /\| Ad 84 \| \$498\.01 \| 31 \| unknown \| 0 \| 0 \| unknown \|/);
  assert.match(doc, /\| Ad 90 \| \$150\.00 \| 120 \| \$50\.00 \| 3 \| 1 \| 2 \|/);
  assert.match(doc, /\$70\.00 on 1 ad with no Fundhub ad number/);
  // The conclusion is read from those same numbers: one paid sale in our checkout is "selling", and says so.
  assert.match(doc, /## The answer\n\nIt is selling: 1 paid in our checkout\./);
  assert.match(doc, /\*\*What this decided:\*\* It is selling: 1 paid in our checkout\./);
});

test("the file agrees with itself: the total spend is the ads with a number plus the spend on ads with no number", async () => {
  const { doc } = await theFile();
  const total = dollars(/- Ad spend: (\$[\d,]+\.\d\d)/.exec(doc)[1]);
  const rows = [...doc.matchAll(/^\| Ad \d+ \| (\$[\d,]+\.\d\d) \|/gm)].map((m) => dollars(m[1]));
  const unmatched = dollars(/(\$[\d,]+\.\d\d) on \d+ ads? with no Fundhub ad number/.exec(doc)[1]);
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((a, b) => a + b, 0) + unmatched, total, "rows plus unmatched must be the total");
});

test("no spend saved at all reads as nothing to read, never as a spend of 0", async () => {
  const tx = stand({
    numbers: [],
    totals: { ...spendCols, spend_cents: null, ad_days: 0, ...leadCols, unmapped_spend_cents: null, unmapped_ad_days: 0, unmapped_ads: 0, unmapped_leads: 0 }
  });
  const read = await readSpend(tx, { orgId: ORG, now: NOW });
  assert.equal(read.totals.spend_cents, null);
  const doc = spendDocument({ campaignName: "Partner offer", read, conclusion: concludeSpend(read.totals) });
  assert.match(doc, /- Ad spend: unknown/);
  assert.match(doc, /No ad spend is saved for these 30 days/);
  assert.ok(!/- Ad spend: \$0/.test(doc));
});
