// Flywheel step 6, the spend read: the window, the conclusion rules and the
// document, with no database. Unit X3. The SQL half is proved against real
// Postgres in src/http/marketing-flywheel.pg.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spendWindow, concludeSpend, spendDocument, holdWords, SPEND_WINDOW_DAYS } from "./spend-read.mjs";

const T = (o) => ({ spend_cents: 50000, impressions: 20000, link_clicks: 120, plays: 400, p25: 300, leads: 3, booked: 1, sales_ours: 0, sales_meta: null, ...o });

test("the window: 30 Arizona days ending yesterday (today's spend comes in tomorrow)", () => {
  // 2026-10-06 03:00 UTC is still Oct 5 in Arizona (UTC-7).
  assert.deepEqual(spendWindow(new Date("2026-10-06T03:00:00Z")), { from: "2026-09-05", to: "2026-10-04" });
  assert.deepEqual(spendWindow(new Date("2026-10-06T19:00:00Z")), { from: "2026-09-06", to: "2026-10-05" });
  assert.equal(SPEND_WINDOW_DAYS, 30);
});

test("the conclusion follows the watch-curve law's own words, in order", () => {
  assert.equal(concludeSpend(T({ spend_cents: null })).rule, "no_spend");
  assert.equal(concludeSpend(T({ spend_cents: 0 })).rule, "no_spend");
  assert.equal(concludeSpend(T({ sales_ours: 2 })).rule, "selling");
  const opening = concludeSpend(T({ p25: 100, leads: 0 }));
  assert.equal(opening.rule, "opening");
  assert.equal(opening.points_to_stage, 4);
  assert.match(opening.text, /never reach the quarter mark/);
  const offer = concludeSpend(T({ p25: 300, leads: 0 }));
  assert.deepEqual([offer.rule, offer.points_to_stage], ["offer_no_leads", 3]);
  assert.deepEqual([concludeSpend(T({ booked: 0 })).rule, concludeSpend(T({ booked: 0 })).points_to_stage], ["offer_no_calls", 3]);
  const ask = concludeSpend(T({ link_clicks: 0, leads: 0, plays: 0, p25: 0 }));
  assert.deepEqual([ask.rule, ask.points_to_stage], ["ask", 4]);
  assert.equal(concludeSpend(T({})).rule, "too_early");
});

test("fewer than 10 plays is no rate at all: the opening rule cannot fire on 9 plays", () => {
  const c = concludeSpend(T({ plays: 9, p25: 1, leads: 0 }));
  assert.notEqual(c.rule, "opening");
  assert.equal(holdWords(1, 9), "unknown (fewer than 10 plays)");
  assert.equal(holdWords(3, 10), "30%");
  assert.equal(holdWords(null, null), "unknown (fewer than 10 plays)");
});

test("the document: every number saved, unknown never 0, two sales counts side by side, a review card", () => {
  const read = {
    from: "2026-09-05", to: "2026-10-04",
    rows: [
      { ad_number: "84", spend_cents: 49801, link_clicks: 31, cpl_cents: null, leads: 0, sales_ours: 0, sales_meta: null, maturing: false },
      { ad_number: "90", spend_cents: 15000, link_clicks: null, cpl_cents: 5000, leads: 3, sales_ours: 1, sales_meta: 2, maturing: true }
    ],
    unmatched: { spend_cents: 7000, ads: 1, ad_days: 1, leads: 0 },
    totals: { spend_cents: 71801, impressions: 9000, link_clicks: 31, plays: 5, p25: 1, leads: 3, booked: 1, sales_ours: 1, sales_meta: null }
  };
  const conclusion = concludeSpend(read.totals);
  const doc = spendDocument({ campaignName: "Partner offer", read, conclusion });
  assert.match(doc, /^# Partner offer — what the spend says\nAs of 2026-10-04/);
  assert.match(doc, /\| Ad 84 \| \$498\.01 \| 31 \| unknown \| 0 \| 0 \| unknown \|/);
  assert.match(doc, /\| Ad 90 \| \$150\.00 \| unknown \| \$50\.00 \| 3 \(still maturing\) \| 1 \| 2 \|/);
  assert.match(doc, /- Our checkout: 1 paid\n- Meta says: unknown purchases/);
  assert.match(doc, /- Still there at 25%: unknown \(fewer than 10 plays\)/);
  assert.match(doc, /\$70\.00 on 1 ad with no Fundhub ad number/);
  assert.match(doc, /This reads every ad in the account\. Ads are not tied to one flywheel yet\./);
  assert.match(doc, /## Review card\n\n\*\*What this decided:\*\* It is selling/);
  assert.ok(!/hook rate/i.test(doc), "the words 'hook rate' never appear");
});
