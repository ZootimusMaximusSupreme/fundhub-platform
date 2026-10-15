import { createHash } from "node:crypto";

import { mappedState, validateMappedRow, validateRecipe } from "./contract.mjs";
import { proofTargets } from "./evidence.mjs";

const DISPLAY_SOURCES = [
  "desks-a.json", "desks-b.json", "desks-c.json", "desks-d.json",
  "desks-e.json", "desks-f.json", "public-pages.json"
];

export function compileHourlyUncoveredSurfaces(tripwires, beats) {
  const covered = new Set(beats.flatMap((beat) => beat.covers));
  return Object.keys(tripwires).filter((surface) => !covered.has(surface)).sort();
}

// Build-time input only. Live checks consume these saved arrays without loading
// the proof builders, which read the repository's map files on a laptop.
export function compileDisplayRuntimeData(sources, { proofCases, staffProofCases, contractFor, isTracked }) {
  const maps = new Map(sources.map((source) => [source.sourceFile, source.rows]));
  const keyFor = (entry) => `${entry.sourceFile}\0${entry.surface}\0${entry.control}`;
  const resultCases = staffProofCases.filter((entry) => entry.depth === "deep").map((entry) => {
    const matches = (maps.get(entry.sourceFile) || []).filter((row) => row.surface === entry.surface && row.control === entry.control);
    if (matches.length !== 1) throw new Error(`Expected one display result row for ${entry.sourceFile} / ${entry.surface} / ${entry.control}, found ${matches.length}`);
    const contract = contractFor(matches[0]);
    if (!contract) return null;
    return { id: `catalog-display:${entry.sourceFile}:${entry.surface}:${entry.control}`, sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control, contract };
  }).filter(Boolean);
  // fin-b19: a tracked display row whose impact is not money or customer data (staff only, or none) that
  // owns a registered saved-result contract is judged even when no browser spec names it. Without this its
  // SQL would never be read and its contract would never run.
  const judgedKeys = new Set(resultCases.map(keyFor));
  for (const sourceFile of DISPLAY_SOURCES) {
    for (const row of maps.get(sourceFile) || []) {
      if (row.repeats_row_in || !isTracked(row) || ["money", "customerData", "customerMessage"].includes(row.impact)) continue;
      const entry = { sourceFile, surface: row.surface, control: row.control };
      if (judgedKeys.has(keyFor(entry))) continue;
      const contract = contractFor(row);
      if (!contract) continue;
      judgedKeys.add(keyFor(entry));
      resultCases.push({ id: `catalog-display:${sourceFile}:${row.surface}:${row.control}`, ...entry, contract });
    }
  }
  const resultsByKey = new Map(resultCases.map((entry) => [keyFor(entry), entry]));
  const directKeys = new Set(proofCases.map(keyFor));
  const laneKeys = new Set(proofCases.filter((entry) => String(entry.evidence || "").includes("gap-catalog-display.mjs")).map(keyFor));
  const trackingCases = [...new Map(DISPLAY_SOURCES.flatMap((sourceFile) => (maps.get(sourceFile) || [])
    .filter((row) => !row.repeats_row_in && (isTracked(row) || resultsByKey.has(keyFor({ ...row, sourceFile }))))
    .map((row) => {
      const key = keyFor({ ...row, sourceFile });
      if (directKeys.has(key) && !laneKeys.has(key) && !resultsByKey.has(key)) return null;
      return [key, {
        id: `catalog-display:${sourceFile}:${row.surface}:${row.control}`,
        sourceFile, surface: row.surface, control: row.control, expected: row.control,
        contract: resultsByKey.get(key)?.contract || null,
        retired: String(row.page || "") === "public/partner/autopsy/index.html"
      }];
    })).filter(Boolean)).values()];
  return { displayResultCases: resultCases, displayTrackingCases: trackingCases };
}

function idFor(sourceFile, row) {
  return createHash("sha256")
    .update(`${sourceFile}\0${row.surface}\0${row.control}`)
    .digest("hex")
    .slice(0, 20);
}

export function compileCatalog(sources, recipeModules, { resolve = (reference) => [reference] } = {}) {
  const items = [];
  let repeats = 0;
  for (const source of sources) {
    if (!source || !String(source.sourceFile || "").endsWith(".json") || !Array.isArray(source.rows)) {
      throw new TypeError("Each catalog source needs sourceFile and rows.");
    }
    for (const row of source.rows) {
      validateMappedRow(row, source.sourceFile);
      if (row.repeats_row_in) {
        repeats += 1;
        continue;
      }
      const matches = recipeModules.filter((mod) => mod.supports(source.sourceFile, row));
      if (matches.length !== 1) {
        throw new Error(`${source.sourceFile} ${row.surface}: expected one recipe owner, found ${matches.length}`);
      }
      const recipe = validateRecipe(matches[0].makeRecipe(source.sourceFile, row), source.sourceFile, row);
      const mappedProof = proofTargets(row.evidence, resolve);
      const recipeProof = proofTargets(recipe?.proof?.evidence, resolve);
      const proof = recipe?.proof?.verdict === "red"
        ? recipeProof
        : Object.fromEntries(Object.keys(mappedProof).map((key) => [
          key,
          [...new Set([...(mappedProof[key] || []), ...(recipeProof[key] || [])])].sort()
        ]));
      const status = mappedState(row, recipe, proof, recipeProof);
      items.push({
        id: idFor(source.sourceFile, row),
        surface: row.surface,
        sourceFile: source.sourceFile,
        impact: row.impact,
        coverage: row.coverage,
        ...(recipe?.proof ? {
          proofDepth: recipe.proof.depth,
          ...(recipe.proof.verdict ? { proofVerdict: recipe.proof.verdict } : {}),
          proofAsserts: recipe.proof.asserts
        } : {}),
        family: recipe.family,
        mode: recipe.mode,
        target: recipe.target,
        expected: recipe.expected,
        schedule: recipe.schedule,
        safe: recipe.safe,
        proof,
        state: status.state,
        reason: status.reason
      });
    }
  }
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) throw new Error("Catalog ids are not unique.");
  const counts = items.reduce((out, item) => {
    out[item.state] = (out[item.state] || 0) + 1;
    return out;
  }, { wired: 0, red: 0 });
  return { version: 1, rows: sources.reduce((n, source) => n + source.rows.length, 0), repeats, unique: items.length, counts, items };
}
