// The ad number rule (407), in JS — runs with no database.
//
// The live ads send utm_content={{ad.name}} ("oVid: SLO2") and
// utm_term={{adset.id}}. Until 407 none of the 18 visitor rows on production had
// an ad number. These tests pin the rule that fixes it: match, no match stays
// NULL, ambiguous stays NULL, and the old leading-digits rule still wins.
//
// THIS IS THE MIRROR. The rule that actually fills the column is SQL
// (db/migrations/407_ad_number_from_meta.sql). The SAME case table runs through
// that SQL in src/http/ad-number.pg.test.mjs, which needs DATABASE_URL.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { adNumberOf, metaAdNumberOf } from "./ad-number.mjs";
import { laneOf, SLO_LANE, LANES } from "./registry.mjs";
import { ADS, CASES, ORG_A, SLO_SET } from "./ad-number-cases.mjs";

describe("ad number from Meta tags — the shared case table", () => {
  for (const [name, tags, want] of CASES) {
    test(name, () => {
      assert.equal(adNumberOf(tags, ADS, { orgId: ORG_A }), want);
    });
  }
});

describe("metaAdNumberOf — the Meta half on its own", () => {
  test("never answers from leading digits — that is step 1's job", () => {
    assert.equal(metaAdNumberOf(ADS, { orgId: ORG_A, adsetId: SLO_SET, adName: "84-slo-ad-1" }), null);
  });

  test("an empty or missing ad list is NULL, never a throw", () => {
    assert.equal(metaAdNumberOf([], { adsetId: SLO_SET, adName: "oVid: SLO2" }), null);
    assert.equal(metaAdNumberOf(null, { adsetId: SLO_SET, adName: "oVid: SLO2" }), null);
    assert.equal(metaAdNumberOf(undefined, {}), null);
  });

  test("junk rows in the list are skipped", () => {
    const ads = [null, 7, "x", { adset_external_id: SLO_SET, external_id: "1", name: "oVid: SLO2", fundhub_ad_number: "90" }];
    assert.equal(metaAdNumberOf(ads, { adsetId: SLO_SET, adName: "oVid: SLO2" }), "90");
  });

  test("a number is always returned as text, like the column", () => {
    const ads = [{ adset_external_id: SLO_SET, external_id: "1", name: "A", fundhub_ad_number: 90 }];
    assert.equal(metaAdNumberOf(ads, { adsetId: SLO_SET, adName: "A" }), "90");
  });

  test("a stored name with spaces around it still matches, like btrim", () => {
    const ads = [{ adset_external_id: SLO_SET, external_id: "1", name: "  A  ", fundhub_ad_number: "77" }];
    assert.equal(metaAdNumberOf(ads, { adsetId: SLO_SET, adName: "A" }), "77");
  });

  test("a tab is not trimmed — Postgres btrim strips spaces only", () => {
    const ads = [{ adset_external_id: SLO_SET, external_id: "1", name: "A", fundhub_ad_number: "77" }];
    assert.equal(metaAdNumberOf(ads, { adsetId: SLO_SET, adName: "\tA" }), null);
  });
});

describe("the roadmap (SLO) lane", () => {
  test("the live campaign name reads slo, not unknown", () => {
    assert.equal(laneOf("oPur: TOF-SLO: $297"), "slo");
  });

  test("a later price in the same name still reads slo", () => {
    assert.equal(laneOf("oPur: TOF-SLO: $147"), "slo");
  });

  test("the bare wire value reads slo", () => {
    assert.equal(laneOf(" SLO "), "slo");
  });

  test("SLO inside another word is not the lane", () => {
    assert.equal(laneOf("slow burn"), "unknown");
    assert.equal(laneOf("oVid: SLO2"), "unknown");
    assert.equal(laneOf("Islo"), "unknown");
  });

  test("the five exact lanes are unchanged", () => {
    for (const lane of LANES) assert.equal(laneOf(lane.toUpperCase()), lane);
    assert.equal(laneOf("meta"), "unknown");
    assert.equal(laneOf(null), "unknown");
  });

  test("slo is a wire lane, not a script lane — LANES stays five", () => {
    assert.equal(SLO_LANE, "slo");
    assert.equal(LANES.includes("slo"), false);
  });
});

describe("the SQL says the same thing", () => {
  const sql407 = readFileSync(new URL("../../db/migrations/407_ad_number_from_meta.sql", import.meta.url), "utf8");
  const sql406 = readFileSync(new URL("../../db/migrations/406_ad_lane_slo.sql", import.meta.url), "utf8");

  test("406 adds the enum value and nothing else, so 407 may use it", () => {
    const body = sql406.split("\n").filter((l) => !l.trim().startsWith("--") && l.trim()).join("\n");
    assert.equal(body.trim(), "ALTER TYPE ad_lane ADD VALUE IF NOT EXISTS 'slo' BEFORE 'unknown';");
  });

  test("the lane regex in SQL is the same word rule as laneOf", () => {
    assert.ok(sql407.includes("~ '(^|[^a-z0-9])slo([^a-z0-9]|$)'"));
  });

  test("the resolver answers only with exactly one Meta ad and one number", () => {
    assert.ok(sql407.includes("count(DISTINCT a.external_id) = 1"));
    assert.ok(sql407.includes("count(DISTINCT a.fundhub_ad_number) = 1"));
    assert.ok(sql407.includes("'^[0-9]{1,30}$'"), "the ad set id must be digits");
  });

  test("leading digits come first in the trigger, the Meta match second", () => {
    const i = sql407.indexOf("fundhub_ad_id(NEW.utm_content)");
    const j = sql407.indexOf("fundhub_meta_ad_number(NEW.org_id, NEW.utm_term, NEW.utm_content)");
    assert.ok(i > 0 && j > i);
  });

  test("the backfill only fills NULLs and deletes nothing", () => {
    const code = sql407.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.ok(code.includes("WHERE c.ad_id IS NULL"));
    assert.equal(/\bDELETE\b/i.test(code), false);
    assert.equal(/\bTRUNCATE\b/i.test(code), false);
  });

  test("the owner-rights resolver is closed to the browser roles, not just PUBLIC", () => {
    // Supabase grants EXECUTE on new public functions to anon and authenticated
    // by name, so REVOKE ... FROM PUBLIC alone would leave them callable.
    assert.ok(sql407.includes("ARRAY['anon', 'authenticated']"));
    assert.ok(sql407.includes("REVOKE ALL ON FUNCTION fundhub_meta_ad_number(uuid, text, text) FROM %I"));
    assert.ok(sql407.includes("SET search_path = public, pg_temp"));
  });

  test("an ads row is only numbered when it has no number and the number is free", () => {
    assert.ok(sql407.includes("WHERE a.fundhub_ad_number IS NULL"));
    assert.ok(sql407.includes("o.org_id = a.org_id AND o.fundhub_ad_number = w.num"));
  });

  test("the four live SLO ads get the numbers the evidence names", () => {
    for (const [metaId, name, num] of [
      ["120253626444660264", "oVid: SLO1", "84"],
      ["120253626574340264", "oVid: SLO2", "90"],
      ["120253626579160264", "oVid: SLO3", "89"],
      ["120253626580720264", "oVid: SLO4", "86"]
    ]) {
      assert.ok(sql407.includes(`('${metaId}', '${name}', '120253626444640264', '${num}')`), `${name} → ${num}`);
    }
  });
});
