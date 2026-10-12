export const COVERAGE_DEPTH = Object.freeze({ none: 0, ping: 1, e2e: 2, deep: 3 });
export const RECIPE_MODES = Object.freeze(["read-only", "test", "receipt", "manual-red"]);
export const IMPACTS = Object.freeze(["money", "customerMessage", "customerData", "staffOnly", "none"]);

export function requiredDepth(row) {
  return ["money", "customerMessage", "customerData"].includes(row?.impact) ? 3 : 2;
}

export function validateMappedRow(row, sourceFile = "unknown") {
  const problems = [];
  for (const key of ["surface", "control", "kind", "calls", "tables", "impact", "coverage", "evidence"]) {
    if (!(key in (row || {}))) problems.push(`missing ${key}`);
  }
  if (!String(row?.surface || "").trim()) problems.push("surface is empty");
  if (!Array.isArray(row?.calls) && typeof row?.calls !== "string") problems.push("calls is not a list or text");
  if (!Array.isArray(row?.tables) && typeof row?.tables !== "string") problems.push("tables is not a list or text");
  if (!IMPACTS.includes(row?.impact)) problems.push(`unknown impact ${String(row?.impact)}`);
  if (!(row?.coverage in COVERAGE_DEPTH)) problems.push(`unknown coverage ${String(row?.coverage)}`);
  if (problems.length) throw new TypeError(`${sourceFile} ${row?.surface || "unknown row"}: ${problems.join(", ")}`);
  return row;
}

export function validateRecipe(recipe, sourceFile, row) {
  const problems = [];
  for (const key of ["family", "mode", "target", "expected", "schedule", "safe", "sourceFile", "surface"]) {
    if (!(key in (recipe || {}))) problems.push(`missing ${key}`);
  }
  if (!RECIPE_MODES.includes(recipe?.mode)) problems.push(`unknown mode ${String(recipe?.mode)}`);
  if (typeof recipe?.safe !== "boolean") problems.push("safe must be true or false");
  if (recipe?.surface !== row?.surface) problems.push("surface does not match the map row");
  if (recipe?.sourceFile !== sourceFile) problems.push("sourceFile does not match the map file");
  if (problems.length) throw new TypeError(`${sourceFile} ${row?.surface}: bad recipe: ${problems.join(", ")}`);
  return recipe;
}

export function mappedState(row, recipe, proofTargets = {}) {
  const have = COVERAGE_DEPTH[row.coverage];
  const need = requiredDepth(row);
  if (recipe.mode === "manual-red") {
    return { state: "red", reason: `No executable ${need === 3 ? "result" : "control"} proof is mapped yet.` };
  }
  if (have < need) {
    return { state: "red", reason: `${row.coverage} coverage is below required level L${need}.` };
  }
  const targets = [
    ...(proofTargets.tests || []),
    ...(proofTargets.lanes || []),
    ...(proofTargets.beats || []),
    ...(proofTargets.pings || [])
  ];
  if (!targets.length) return { state: "red", reason: `The map says ${row.coverage}, but names no executable proof target.` };
  return { state: "wired", reason: `Mapped to ${targets.length} executable proof target${targets.length === 1 ? "" : "s"}.` };
}
