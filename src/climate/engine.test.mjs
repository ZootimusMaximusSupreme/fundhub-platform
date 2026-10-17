import { test } from "node:test";
import assert from "node:assert/strict";
import { bandFromScore, normalize, weightedComposite } from "./config.mjs";
import { computeBusinessConditions, computeNational, computeStateScore } from "./scoring.mjs";
import { geocode, mapClimateLender, pullCrmLenders } from "./connectors.mjs";

test("climate: sage band at 80+", () => {
  assert.equal(bandFromScore(86).color_band, "very_favorable");
  assert.equal(bandFromScore(86).color, "#A8D8B0");
  assert.equal(bandFromScore(40).color_band, "tight");
});

test("climate: invert mapping — lower unemployment scores higher", () => {
  const easy = normalize(3, 2, 12, true);
  const hard = normalize(10, 2, 12, true);
  assert.ok(easy > hard);
});

test("climate: national weights sum to a 0-100 score", () => {
  const national = computeNational({
    series: {
      EFFR: { observations: [{ value: 4.3 }] },
      CPIAUCSL: { observations: [{ value: 2.8 }] },
      BAMLC0A4CBBBEY: { observations: [{ value: 5.4 }] },
      DGS10: { observations: [{ value: 4.2 }] },
      UMCSENT: { observations: [{ value: 70 }] },
      NFIBBUSI: { observations: [{ value: 95 }] }
    },
    updated_at: "2026-08-16T00:00:00Z",
    stale: false
  });
  assert.ok(national.score >= 0 && national.score <= 100);
  assert.ok(national.components.fed_policy > 0);
});

test("climate: state score is macro only — no fake approval rollup", () => {
  const scored = computeStateScore(
    { state_code: "AZ", unemployment_rate_pct: 3.5, delinquency_rate_pct: 1.1 },
    [],
    95,
    []
  );
  assert.equal(scored.state, "AZ");
  assert.ok(scored.business_conditions > 50);
  assert.equal(scored.avg_approval_odds, undefined);
  assert.equal(scored.approval_odds, undefined);
});

test("climate: public lender map drops staff fields and invented odds", () => {
  const pub = mapClimateLender({
    id: "l1",
    name: "Example Bank",
    product_name: "LOC",
    lender_table: "banks",
    eligible_states: "AZ, CA",
    application_url: "https://example.com/apply",
    logo_path: "/logos/x.png",
    priority_tier: 2,
    bureaus_pulled: "Experian",
    insider_tips: "secret",
    notes: "staff only",
    stated_requirements: "700+ FICO",
    approval_rate: 0.88
  });
  assert.equal(pub.name, "Example Bank");
  assert.equal(pub.insider_tips, undefined);
  assert.equal(pub.notes, undefined);
  assert.equal(pub.approval_rate, undefined);
  assert.equal(pub.approval_odds, undefined);
});

test("climate: CRM pull uses default org lender query", async () => {
  let lenderSql = "";
  const db = {
    query: async (sql) => {
      if (/is_default/.test(sql)) return { rows: [{ id: "00000000-0000-0000-0000-000000000099" }] };
      if (/demo_mode_enabled/.test(sql)) return { rows: [{ demo_mode_enabled: false }] };
      if (/FROM lenders/.test(sql)) {
        lenderSql = sql;
        return {
          rows: [{
            id: "00000000-0000-0000-0000-000000000001",
            org_id: "00000000-0000-0000-0000-000000000099",
            lender_table: "banks",
            name: "Mock Lender",
            product_name: null,
            logo_path: null,
            application_url: null,
            eligible_states: "TX",
            bureaus_pulled: null,
            priority_tier: null,
            active: true,
            is_demo: false
          }]
        };
      }
      return { rows: [] };
    }
  };
  const pack = await pullCrmLenders(db);
  assert.match(lenderSql, /FROM lenders/);
  assert.match(lenderSql, /active = \$2 AND COALESCE\(is_demo, false\) = false/);
  const selected = lenderSql.match(/SELECT\s+([\s\S]*?)\s+FROM lenders/i)?.[1]
    .split(",").map((column) => column.trim());
  assert.deepEqual(selected, [
    "id", "lender_table", "name", "product_name", "eligible_states",
    "application_url", "logo_path", "priority_tier", "bureaus_pulled"
  ]);
  assert.equal(pack.lenders.length, 1);
  assert.equal(pack.lenders[0].name, "Mock Lender");
  assert.equal(pack.lenders[0].logo_path, "/assets/lenders/placeholder.svg");
  assert.equal(pack.lenders[0].approval_rate, undefined);
});

test("climate: weightedComposite ignores missing keys", () => {
  assert.equal(weightedComposite({ a: 100 }, { a: 1, b: 1 }, 0), 50);
});

test("climate: geocode falls back to state centroid without a maps key", async () => {
  const hit = await geocode("AZ");
  assert.equal(hit.stateCode, "AZ");
  assert.ok(Number.isFinite(hit.lat));
});

test("climate: business conditions invert unemployment", () => {
  const open = computeBusinessConditions({ nfibIndex: 100, unemployment_rate_pct: 3, delinquency_rate_pct: 0.8 });
  const tight = computeBusinessConditions({ nfibIndex: 85, unemployment_rate_pct: 9, delinquency_rate_pct: 5 });
  assert.ok(open > tight);
});
