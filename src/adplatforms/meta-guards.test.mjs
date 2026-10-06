// The ad set guard (spec §10.5): which Meta ad sets a new paused ad may go into.
// Pure — the info is shaped like getAdSetGuardInfo's answer (meta.mjs).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkAdSetGuard, META_MAX_ADS_PER_AD_SET } from "./meta-guards.mjs";
import { adSetGuardInfoFrom } from "./meta.mjs";

const GOOD = Object.freeze({
  effective_status: "ACTIVE",
  is_dynamic_creative: false,
  ad_count: 3,
  campaign: { special_ad_categories: ["CREDIT"], effective_status: "ACTIVE" }
});
const OURS = { ourSpecialAdCategory: "CREDIT" };

const refuses = (info, opts, pattern) => {
  const v = checkAdSetGuard(info, opts);
  assert.equal(v.ok, false, JSON.stringify(v));
  assert.ok(v.reasons.length >= 1);
  assert.ok(v.reasons.some((r) => pattern.test(r)), `no reason matched ${pattern}: ${v.reasons.join(" | ")}`);
  // Plain words: whole sentences, no codes or stack traces.
  for (const r of v.reasons) assert.match(r, /^[A-Z].*\.$/);
  return v;
};

describe("checkAdSetGuard", () => {
  test("a live, normal ad set in a CREDIT campaign that matches ours passes", () => {
    assert.deepEqual(checkAdSetGuard(GOOD, OURS), { ok: true, reasons: [], notes: [] });
  });

  test("archived ad set: refused", () => {
    refuses({ ...GOOD, effective_status: "ARCHIVED" }, OURS, /archived/);
  });

  test("deleted ad set: refused", () => {
    refuses({ ...GOOD, effective_status: "DELETED" }, OURS, /deleted/);
  });

  test("dynamic creative: refused", () => {
    refuses({ ...GOOD, is_dynamic_creative: true }, OURS, /dynamic creative/);
  });

  test(`${META_MAX_ADS_PER_AD_SET} ads already: refused (and 49 is fine)`, () => {
    assert.equal(META_MAX_ADS_PER_AD_SET, 50);
    refuses({ ...GOOD, ad_count: 50 }, OURS, /already has 50 ads/);
    refuses({ ...GOOD, ad_count: 51 }, OURS, /already has 51 ads/);
    assert.equal(checkAdSetGuard({ ...GOOD, ad_count: 49 }, OURS).ok, true);
  });

  test("a count Meta did not give: refused (unknown is not zero)", () => {
    refuses({ ...GOOD, ad_count: null }, OURS, /how many ads/);
  });

  test("a campaign with no special ad category: refused", () => {
    refuses({ ...GOOD, campaign: { ...GOOD.campaign, special_ad_categories: [] } }, OURS, /no special ad category in Meta/);
    refuses({ ...GOOD, campaign: { ...GOOD.campaign, special_ad_categories: ["NONE"] } }, OURS, /no special ad category in Meta/);
    refuses({ ...GOOD, campaign: { ...GOOD.campaign, special_ad_categories: null } }, OURS, /no special ad category in Meta/);
  });

  test("Meta's category differs from our campaigns.special_ad_category: refused", () => {
    const v = refuses(
      { ...GOOD, campaign: { ...GOOD.campaign, special_ad_categories: ["FINANCIAL_PRODUCTS_SERVICES"] } },
      OURS,
      /Meta's campaign says FINANCIAL_PRODUCTS_SERVICES, but our campaign record says CREDIT/
    );
    assert.equal(v.reasons.length, 1);
  });

  test("our record with no category: refused, because Meta's cannot be checked", () => {
    refuses(GOOD, { ourSpecialAdCategory: null }, /Our campaign record has no special ad category/);
    refuses(GOOD, {}, /Our campaign record has no special ad category/);
  });

  test("case and spaces do not make a false mismatch", () => {
    assert.equal(checkAdSetGuard(
      { ...GOOD, campaign: { ...GOOD.campaign, special_ad_categories: ["credit"] } },
      { ourSpecialAdCategory: " CREDIT " }
    ).ok, true);
  });

  test("archived or deleted campaign: refused", () => {
    refuses({ ...GOOD, campaign: { ...GOOD.campaign, effective_status: "ARCHIVED" } }, OURS, /campaign is archived/);
    refuses({ ...GOOD, campaign: { ...GOOD.campaign, effective_status: "DELETED" } }, OURS, /campaign is deleted/);
  });

  test("no campaign, no status, no info at all: refused", () => {
    refuses({ ...GOOD, campaign: null }, OURS, /which campaign/);
    refuses({ ...GOOD, effective_status: null }, OURS, /whether this ad set is live/);
    refuses(null, OURS, /anything about this ad set/);
  });

  test("every broken rule is reported at once", () => {
    const v = checkAdSetGuard({
      effective_status: "ARCHIVED", is_dynamic_creative: true, ad_count: 50,
      campaign: { special_ad_categories: [], effective_status: "ACTIVE" }
    }, OURS);
    assert.equal(v.ok, false);
    assert.equal(v.reasons.length, 4);
  });

  test("paused is not a refusal; it is a note for the Launch tab", () => {
    const v = checkAdSetGuard(
      { ...GOOD, effective_status: "CAMPAIGN_PAUSED", campaign: { ...GOOD.campaign, effective_status: "PAUSED" } },
      OURS
    );
    assert.equal(v.ok, true);
    assert.equal(v.notes.length, 2);
    assert.match(v.notes[0], /paused/);
  });

  test("works on getAdSetGuardInfo's own parse of a Meta answer", () => {
    const info = adSetGuardInfoFrom({
      id: "1", effective_status: "ACTIVE", is_dynamic_creative: false,
      campaign: { id: "2", special_ad_categories: ["CREDIT"], effective_status: "ACTIVE" }
      // no `ads` key: an ad set with no ads yet
    });
    assert.deepEqual(checkAdSetGuard(info, OURS), { ok: true, reasons: [], notes: [] });
  });
});
