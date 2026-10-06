// Meta's purchases, cost per purchase, link clicks and landing page views —
// parsed from recorded-shape insights rows. Runs with no database.
//
// The rows below are in the shape Meta's Ads Action Stats reference documents:
// `actions` and `cost_per_action_type` are lists of { action_type, value } with
// value as a STRING. They are written from the documentation, not captured
// from the live ad account (the live account had 0 purchases on 2026-10-05).

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  metaResultMetrics,
  actionCount,
  actionCostCents,
  purchaseActionType,
  META_PURCHASE_ACTION_TYPES,
  MONEY_INSIGHT_REQUEST_FIELDS,
  META_RESULT_COLUMNS
} from "./meta-results.mjs";

const act = (type, value) => ({ action_type: type, value: String(value) });

describe("metaResultMetrics — the four numbers off one ad-day", () => {
  test("a full row: two purchases, Meta's own cost, link clicks, landing page views", () => {
    const out = metaResultMetrics({
      spend: "272.35",
      actions: [
        act("link_click", 43), act("landing_page_view", 33),
        act("omni_purchase", 2), act("offsite_conversion.fb_pixel_purchase", 2),
        act("lead", 1), act("video_view", 900)
      ],
      cost_per_action_type: [act("omni_purchase", "136.18"), act("link_click", "6.33")]
    });
    assert.deepEqual(out, {
      purchases: 2,
      cost_per_purchase_cents: 13618,
      link_clicks: 43,
      landing_page_views: 33
    });
  });

  test("omni_purchase and the pixel purchase are never added together", () => {
    const out = metaResultMetrics({
      actions: [act("omni_purchase", 3), act("offsite_conversion.fb_pixel_purchase", 3)]
    });
    assert.equal(out.purchases, 3);
  });

  test("no omni_purchase line: the pixel purchase is used", () => {
    const out = metaResultMetrics({
      spend: "95.48",
      actions: [act("offsite_conversion.fb_pixel_purchase", 1)],
      cost_per_action_type: [act("offsite_conversion.fb_pixel_purchase", "95.48")]
    });
    assert.equal(out.purchases, 1);
    assert.equal(out.cost_per_purchase_cents, 9548);
  });

  test("the cost line must be for the SAME purchase action as the count", () => {
    const out = metaResultMetrics({
      spend: "100.00",
      actions: [act("omni_purchase", 4)],
      cost_per_action_type: [act("offsite_conversion.fb_pixel_purchase", "1.00")]
    });
    assert.equal(out.cost_per_purchase_cents, 2500, "a cost line for a different action was used");
  });

  test("purchases but no cost line: spend ÷ purchases, rounded half up", () => {
    assert.equal(metaResultMetrics({ spend: "10.00", actions: [act("omni_purchase", 3)] })
      .cost_per_purchase_cents, 333);
    assert.equal(metaResultMetrics({ spend: "0.05", actions: [act("omni_purchase", 2)] })
      .cost_per_purchase_cents, 3, "2.5 cents rounds half up to 3");
  });

  test("purchases but no spend and no cost line: cost stays NULL", () => {
    assert.equal(metaResultMetrics({ actions: [act("omni_purchase", 2)] }).cost_per_purchase_cents, null);
  });

  test("Meta sent no actions at all: four NULLs, not four zeros", () => {
    const out = metaResultMetrics({ spend: "52.42", impressions: "585", clicks: "9" });
    for (const c of META_RESULT_COLUMNS) assert.strictEqual(out[c], null, c);
  });

  test("an actions list with no purchase line: purchases and cost NULL, the rest read", () => {
    const out = metaResultMetrics({ spend: "50", actions: [act("link_click", 7)] });
    assert.strictEqual(out.purchases, null);
    assert.strictEqual(out.cost_per_purchase_cents, null);
    assert.equal(out.link_clicks, 7);
    assert.strictEqual(out.landing_page_views, null);
  });

  test("a real zero Meta sent stays 0, and zero purchases has no cost", () => {
    const out = metaResultMetrics({
      spend: "20", actions: [act("omni_purchase", 0), act("link_click", 0)],
      cost_per_action_type: [act("omni_purchase", "0")]
    });
    assert.strictEqual(out.purchases, 0);
    assert.strictEqual(out.cost_per_purchase_cents, null, "there is no cost of zero purchases");
    assert.strictEqual(out.link_clicks, 0);
  });

  test("junk values are NULL, never a number made up from them", () => {
    const out = metaResultMetrics({
      spend: "abc",
      actions: [act("omni_purchase", "lots"), act("link_click", -4), act("landing_page_view", "")],
      cost_per_action_type: "not a list"
    });
    for (const c of META_RESULT_COLUMNS) assert.strictEqual(out[c], null, c);
  });

  test("a junk spend with purchases and no cost line: cost NULL, not a throw", () => {
    assert.strictEqual(metaResultMetrics({ spend: "NaN", actions: [act("omni_purchase", 2)] })
      .cost_per_purchase_cents, null);
  });

  test("nothing at all, or not an object: four NULLs and no throw", () => {
    for (const row of [undefined, null, {}, 7, "row"]) {
      const out = metaResultMetrics(row);
      for (const c of META_RESULT_COLUMNS) assert.strictEqual(out[c], null, `${String(row)} ${c}`);
    }
  });
});

describe("the helpers", () => {
  test("actionCount takes the largest entry for a type, never the sum", () => {
    assert.equal(actionCount([act("link_click", 5), act("link_click", 12)], "link_click"), 12);
    assert.equal(actionCount([act("link_click", 5)], "landing_page_view"), null);
    assert.equal(actionCount("nope", "link_click"), null);
    assert.equal(actionCount([null, 3, act("link_click", "4.9")], "link_click"), 4, "whole numbers only");
  });

  test("actionCostCents reads Meta's decimal string as integer cents", () => {
    assert.equal(actionCostCents([act("omni_purchase", "12.35")], "omni_purchase"), 1235);
    assert.equal(actionCostCents([act("omni_purchase", "x"), act("omni_purchase", "1.10")], "omni_purchase"), 110);
    assert.equal(actionCostCents([], "omni_purchase"), null);
  });

  test("purchaseActionType prefers omni_purchase", () => {
    assert.equal(purchaseActionType([act("offsite_conversion.fb_pixel_purchase", 1), act("omni_purchase", 1)]), "omni_purchase");
    assert.equal(purchaseActionType([act("offsite_conversion.fb_pixel_purchase", 1)]), "offsite_conversion.fb_pixel_purchase");
    assert.equal(purchaseActionType([act("lead", 1)]), null);
  });
});

describe("only Meta's own names", () => {
  test("the purchase names are the two Meta's reference lists, in order", () => {
    assert.deepEqual([...META_PURCHASE_ACTION_TYPES], ["omni_purchase", "offsite_conversion.fb_pixel_purchase"]);
  });

  test("the request adds exactly one field, cost_per_action_type", () => {
    assert.deepEqual([...MONEY_INSIGHT_REQUEST_FIELDS], ["actions", "cost_per_action_type"]);
  });

  test("the columns are the four 408 adds", () => {
    assert.deepEqual([...META_RESULT_COLUMNS],
      ["purchases", "cost_per_purchase_cents", "link_clicks", "landing_page_views"]);
  });
});
