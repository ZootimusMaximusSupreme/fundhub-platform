// Exact read-only red checks for route rows that still lack business-result proof.
// Handler presence and the separate refusal test are context only. Neither makes
// the named route result green.

import routes0 from "../../../ops/workflows/coverage-every-surface-2026-10-10/routes-0.json" with { type: "json" };
import routes1 from "../../../ops/workflows/coverage-every-surface-2026-10-10/routes-1.json" with { type: "json" };
import routes2 from "../../../ops/workflows/coverage-every-surface-2026-10-10/routes-2.json" with { type: "json" };
import routes3 from "../../../ops/workflows/coverage-every-surface-2026-10-10/routes-3.json" with { type: "json" };
import { ROUTES } from "../../../netlify/functions/api.mjs";
import { makeRecipe } from "../catalog/door-recipes.mjs";
import { routeKeyForDoor } from "../catalog/proofs/door-batch-route-result.mjs";

export const EXPECTED_ROUTE_GAP_COUNTS = Object.freeze({
  "routes-0.json": 98,
  "routes-1.json": 113,
  "routes-2.json": 65,
  "routes-3.json": 41,
});

const MAPS = Object.freeze([
  ["routes-0.json", routes0],
  ["routes-1.json", routes1],
  ["routes-2.json", routes2],
  ["routes-3.json", routes3],
]);

function usesExactRouteGap(sourceFile, row) {
  return makeRecipe(sourceFile, row).proof?.evidence.includes("gap-door-batch-routes.mjs");
}

function resultId(sourceFile, row) {
  return `catalog-route:${sourceFile}:${row.surface}:${row.control}`;
}

export const ROUTE_GAP_ROWS = Object.freeze(MAPS.flatMap(([sourceFile, rows]) => rows
  .filter((row) => usesExactRouteGap(sourceFile, row))
  .map((row) => Object.freeze({
    id: resultId(sourceFile, row),
    sourceFile,
    surface: row.surface,
    control: row.control,
    route: routeKeyForDoor(row),
    methods: Array.isArray(row.methods) ? row.methods.map((method) => String(method).toUpperCase()) : [],
    kind: row.kind,
    impact: row.impact,
  }))));

export const CHECK_IDS = Object.freeze(ROUTE_GAP_ROWS.map((row) => row.id));

const counts = ROUTE_GAP_ROWS.reduce((out, row) => {
  out[row.sourceFile] = (out[row.sourceFile] || 0) + 1;
  return out;
}, {});
for (const [sourceFile, expected] of Object.entries(EXPECTED_ROUTE_GAP_COUNTS)) {
  if (counts[sourceFile] !== expected) {
    throw new Error(`Route gap monitor drifted: expected ${expected} rows in ${sourceFile}, found ${counts[sourceFile] || 0}.`);
  }
}

function intendedMethod(row) {
  if (row.methods.length) return row.methods.join("|");
  return String(row.kind || "intended method");
}

export function judgeRouteGap(row, routes = ROUTES) {
  const handlerPresent = typeof routes?.[row.route] === "function";
  const context = handlerPresent
    ? `the ${row.route} handler is registered; its separate safe-refusal probe is context only`
    : `the ${row.route} handler is not registered`;
  return {
    id: row.id,
    status: "FAIL",
    detail: `${row.surface} — ${row.control}: ${context}. No fake-data check calls ${intendedMethod(row)} and judges this named business result, so this route stays red.`,
    suggestedFix: `Add a fake-data ${intendedMethod(row)} test for ${row.surface} that calls the real handler and judges this exact result.`,
  };
}

export async function gapChecks() {
  return ROUTE_GAP_ROWS.map((row) => judgeRouteGap(row));
}
