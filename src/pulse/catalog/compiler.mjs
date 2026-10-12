import { createHash } from "node:crypto";

import { mappedState, validateMappedRow, validateRecipe } from "./contract.mjs";
import { proofTargets } from "./evidence.mjs";

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
