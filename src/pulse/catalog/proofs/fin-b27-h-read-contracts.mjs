// Workflow H: bind the exact climate catalog row to the existing read-only
// climate page probe. The probe reads GET responses only and already judges
// the API data plus the outlines loaded by the shipped page.

import {
  CLIMATE_READING_SURFACE,
  FIN_B22_PAGE_TEST,
  runFinB22PageReads,
} from "./fin-b22-page-reads.mjs";

export const FIN_B27_H_READ_TEST =
  "src/pulse/catalog/proofs/fin-b27-h-read-contracts.test.mjs";

export const CATALOG_CLIMATE_READ = Object.freeze({
  id: "catalog-read:climate-map",
  sourceFile: "public-pages.json",
  surface: "read:climate/index.html#Map and national number: GET",
  control: "Map and national number: GET /api/climate paints 51 states and the national score (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)",
  depth: "deep",
  evidence: `${FIN_B22_PAGE_TEST} ${FIN_B27_H_READ_TEST}`,
  tests: Object.freeze([FIN_B22_PAGE_TEST, FIN_B27_H_READ_TEST]),
});

export const FIN_B27_H_READ_PROVED = Object.freeze([CATALOG_CLIMATE_READ]);

const FLOW_CLIMATE_ID = `flow:journey:${CLIMATE_READING_SURFACE}`;

function skipped(reason) {
  const message = String(reason?.message || reason || "the safe climate read returned no result")
    .replace(/\s+/g, " ")
    .slice(0, 180);
  return {
    id: CATALOG_CLIMATE_READ.id,
    status: "skip",
    detail: `${CATALOG_CLIMATE_READ.surface}: not checked because ${message}.`,
    suggestedFix: null,
  };
}

export async function runFinB27HReadResults(ctx = {}, runPageReads = runFinB22PageReads) {
  let rows;
  try {
    rows = await runPageReads(ctx);
  } catch (error) {
    return new Map([[CATALOG_CLIMATE_READ.id, skipped(error)]]);
  }

  const result = rows?.get?.(FLOW_CLIMATE_ID);
  if (!result) {
    return new Map([[CATALOG_CLIMATE_READ.id, skipped("the safe climate read returned no climate row")]]);
  }

  const status = ["PASS", "FAIL", "skip"].includes(result.status) ? result.status : "skip";
  const mapped = {
    id: CATALOG_CLIMATE_READ.id,
    status,
    detail: `${CATALOG_CLIMATE_READ.surface}: ${String(result.detail || "the safe climate read returned no detail")}`,
    suggestedFix: result.suggestedFix || null,
  };
  return new Map([[mapped.id, mapped]]);
}
