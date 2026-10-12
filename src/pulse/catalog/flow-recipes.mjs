import { proofForFlowRow } from "./proofs/flow-result-proofs.mjs";

const SOURCE_FAMILIES = Object.freeze({
  "messages.json": "message",
  "journeys.json": "journey",
  "agents.json": "agent",
});

const AGENT_MODES = Object.freeze({
  deep: "read-only",
  e2e: "test",
  ping: "read-only",
  none: "manual-red",
});

function basename(sourceFile) {
  return String(sourceFile || "").split(/[\\/]/).at(-1);
}

function isRow(row) {
  return Boolean(row && typeof row === "object" && typeof row.surface === "string" && row.surface.trim());
}

export function supports(sourceFile, row) {
  return Boolean(SOURCE_FAMILIES[basename(sourceFile)] && isRow(row));
}

function modeFor(sourceFile, row, proof) {
  if (proof) return "test";

  if (sourceFile === "messages.json") {
    return "manual-red";
  }

  if (sourceFile === "journeys.json") {
    return row.coverage === "deep" ? "read-only" : "manual-red";
  }

  return AGENT_MODES[row.coverage] || "manual-red";
}

function expectedFor(family, mode) {
  if (mode === "manual-red") return "executable proof is still required";
  if (family === "message") return "the mapped delivery receipt stays healthy";
  if (family === "journey") return "the mapped deep journey check stays healthy";
  if (mode === "test") return "the mapped agent test stays green";
  return "the mapped agent read stays healthy";
}

export function makeRecipe(sourceFile, row) {
  const file = basename(sourceFile);
  if (!supports(file, row)) {
    throw new TypeError(`Unsupported flow recipe row from ${file || "unknown source"}`);
  }

  const family = SOURCE_FAMILIES[file];
  const proof = proofForFlowRow(file, row);
  const mode = modeFor(file, row, proof);

  const recipe = {
    family,
    mode,
    target: row.surface,
    expected: expectedFor(family, mode),
    schedule: "daily",
    safe: true,
    sourceFile: file,
    surface: row.surface,
  };

  if (proof) recipe.proof = proof;
  return recipe;
}
