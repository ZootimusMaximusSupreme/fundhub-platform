// The owner-set UTM format for a Meta ad (spec §10.3, migration 286) — no
// database. The same strings run through the real SQL (fundhub_ad_id,
// fundhub_ad_lane, the 407 trigger) in src/http/ad-number-source.pg.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildUrlTags, URL_TAG_LANES } from "./url-tags.mjs";
import defaultBuild from "./url-tags.mjs";
import { mapAdNumber } from "../ads/ad-number.mjs";
import { adIdOf, laneOf, variantOf, LANES, SLO_LANE } from "../ads/registry.mjs";

const tagsOf = (s) => Object.fromEntries(new URLSearchParams(s));

describe("buildUrlTags — the exact owner-set string", () => {
  test("no variant: four tags, in the owner's order", () => {
    assert.equal(
      buildUrlTags({ lane: "slo", adNumber: "91" }),
      "utm_source=fb&utm_medium=paid&utm_campaign=slo&utm_content=91"
    );
  });

  test("with a variant: utm_term goes last", () => {
    assert.equal(
      buildUrlTags({ lane: "uwiq", adNumber: "91", variant: "sun" }),
      "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content=91&utm_term=sun"
    );
  });

  test("the default export is the same builder", () => {
    assert.equal(defaultBuild, buildUrlTags);
  });

  test("a whole-number ad number is written as its digits", () => {
    assert.equal(tagsOf(buildUrlTags({ lane: "wl", adNumber: 91 })).utm_content, "91");
  });

  test("the lane is written lowercase, the way fundhub_ad_lane() reads it", () => {
    assert.equal(tagsOf(buildUrlTags({ lane: " SLO ", adNumber: "84" })).utm_campaign, "slo");
  });
});

describe("buildUrlTags — utm_term only with a variant", () => {
  for (const variant of [undefined, null, "", "   "]) {
    test(`variant ${JSON.stringify(variant)} → no utm_term at all`, () => {
      const s = buildUrlTags({ lane: "slo", adNumber: "91", variant });
      assert.equal(s.includes("utm_term"), false, s);
      assert.equal(Object.keys(tagsOf(s)).length, 4);
    });
  }

  test("the variant is squeezed exactly as the database will store it", () => {
    const raw = "Sun Burst / V2";
    const s = buildUrlTags({ lane: "slo", adNumber: "91", variant: raw });
    assert.equal(tagsOf(s).utm_term, "sun-burst-v2");
    assert.equal(tagsOf(s).utm_term, variantOf(raw), "the JS mirror of fundhub_ad_variant()");
  });

  test("a variant with nothing left once squeezed is refused, not dropped", () => {
    assert.throws(() => buildUrlTags({ lane: "slo", adNumber: "91", variant: "!!!" }), /variant/);
  });
});

describe("buildUrlTags — refusals", () => {
  test("an unknown lane is refused", () => {
    for (const lane of ["meta", "unknown", "roadmap", "slo2", "", null, undefined]) {
      assert.throws(() => buildUrlTags({ lane, adNumber: "91" }), /lane/, String(lane));
    }
  });

  test("every allowed lane is one fundhub_ad_lane() maps to itself", () => {
    assert.deepEqual([...URL_TAG_LANES], [...LANES, SLO_LANE]);
    for (const lane of URL_TAG_LANES) assert.equal(laneOf(lane), lane, lane);
  });

  test("a Meta ad id is refused as our ad number", () => {
    assert.throws(() => buildUrlTags({ lane: "slo", adNumber: "120253626574340264" }), /ad number/);
  });

  test("a slug, a blank, a fraction and a negative are refused", () => {
    for (const adNumber of ["91-roadmap", "", "  ", 91.5, -1, null, undefined, "nine", NaN]) {
      assert.throws(() => buildUrlTags({ lane: "slo", adNumber }), /ad number/, String(adNumber));
    }
  });

  test("no argument at all is a refusal, not a crash with no message", () => {
    assert.throws(() => buildUrlTags(), /lane/);
  });
});

describe("round trip: what the builder writes, the mapper and the lead row read back", () => {
  for (const lane of ["funding600", "premium", "sorting", "uwiq", "wl", "slo"]) {
    for (const adNumber of ["1", "84", "91", "123456789"]) {
      test(`${lane} · ad ${adNumber}`, () => {
        const urlTags = buildUrlTags({ lane, adNumber });
        const mapped = mapAdNumber({ urlTags });
        assert.ok(mapped, urlTags);
        assert.strictEqual(mapped.number, adNumber);
        assert.equal(mapped.source, "utm");
        // fundhub_ad_id()'s JS mirror reads the same number off utm_content,
        // and fundhub_ad_lane()'s mirror reads the same lane off utm_campaign.
        assert.equal(adIdOf(tagsOf(urlTags).utm_content), adNumber);
        assert.equal(laneOf(tagsOf(urlTags).utm_campaign), lane);
      });
    }
  }

  test("a variant does not change the number", () => {
    const urlTags = buildUrlTags({ lane: "slo", adNumber: "91", variant: "sun" });
    assert.deepEqual(mapAdNumber({ urlTags }), { number: "91", source: "utm" });
  });
});
