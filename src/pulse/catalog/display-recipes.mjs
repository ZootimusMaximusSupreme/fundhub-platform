import { displayProofFor } from "./proofs/display-proof-cases.mjs";

const SOURCE_FILES = new Set([
  "desks-a.json",
  "desks-b.json",
  "desks-c.json",
  "desks-d.json",
  "desks-e.json",
  "desks-f.json",
  "public-pages.json",
]);

const FAMILY_BY_KIND = new Map([
  ["api-action", "button"],
  ["asset", "screen"],
  ["board-column", "screen"],
  ["bulk-action", "button"],
  ["bulk-select", "form"],
  ["button", "button"],
  ["canvas", "screen"],
  ["card-action", "button"],
  ["chart", "screen"],
  ["checkbox", "form"],
  ["dependency", "read"],
  ["details", "screen"],
  ["disclosure", "screen"],
  ["display", "screen"],
  ["drag", "form"],
  ["drag-drop", "form"],
  ["effect", "read"],
  ["external-dependency", "read"],
  ["feed", "screen"],
  ["file-input", "form"],
  ["file-upload", "form"],
  ["filter", "form"],
  ["form", "form"],
  ["form-submit", "button"],
  ["gate", "screen"],
  ["gesture", "button"],
  ["guard", "read"],
  ["input", "form"],
  ["job", "read"],
  ["kanban-column", "screen"],
  ["keyboard", "button"],
  ["link", "link"],
  ["menu-item", "button"],
  ["modal", "screen"],
  ["nav", "link"],
  ["nav-link", "link"],
  ["page", "screen"],
  ["page-load", "screen"],
  ["page-state", "screen"],
  ["pager", "button"],
  ["panel", "screen"],
  ["poll", "read"],
  ["prompt", "form"],
  ["read", "read"],
  ["read-panel", "read"],
  ["redirect", "link"],
  ["row-expand", "button"],
  ["select", "form"],
  ["sort-control", "form"],
  ["stage-button", "button"],
  ["stage-column", "screen"],
  ["stat-tile", "screen"],
  ["state", "screen"],
  ["system", "read"],
  ["tab", "screen"],
  ["table", "screen"],
  ["table-row", "screen"],
  ["toggle", "form"],
]);

const PAGE_KINDS = new Set(["page", "page-load"]);
const COVERED = new Set(["deep", "e2e"]);

function baseName(sourceFile) {
  return String(sourceFile || "").split(/[\\/]/).at(-1);
}

function normalizedKind(row) {
  return String(row?.kind || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function hasReceiptProof(row) {
  if (normalizedKind(row) !== "job") return false;
  return /\bheartbeat|\bjob:/i.test(String(row?.evidence || ""));
}

function modeFor(row, family, proof) {
  const coverage = String(row.coverage || "").toLowerCase();
  const kind = normalizedKind(row);

  if (proof && (coverage === "none" || coverage === "ping")) return "test";
  if (coverage === "none") return "manual-red";
  if (hasReceiptProof(row)) return "receipt";

  if (coverage === "ping") {
    return family === "screen" && PAGE_KINDS.has(kind)
      ? "read-only"
      : "manual-red";
  }

  if (!COVERED.has(coverage)) return "manual-red";
  if (family === "read" || (family === "screen" && PAGE_KINDS.has(kind))) {
    return "read-only";
  }
  return "test";
}

function firstCall(row) {
  if (Array.isArray(row.calls)) {
    return row.calls.find((value) => typeof value === "string" && value.trim());
  }
  if (typeof row.calls === "string" && row.calls.trim()) return row.calls;
  return null;
}

function targetFor(row) {
  return firstCall(row)
    || row.page
    || row.file
    || row.surface;
}

export function supports(sourceFile, row) {
  return SOURCE_FILES.has(baseName(sourceFile))
    && Boolean(row && typeof row === "object")
    && FAMILY_BY_KIND.has(normalizedKind(row));
}

export function makeRecipe(sourceFile, row) {
  if (!supports(sourceFile, row)) {
    throw new TypeError(`Unsupported display row: ${baseName(sourceFile)} / ${row?.kind || "missing kind"}`);
  }

  const family = FAMILY_BY_KIND.get(normalizedKind(row));
  const proof = displayProofFor(baseName(sourceFile), row);
  const mode = modeFor(row, family, proof);

  const recipe = {
    family,
    mode,
    target: String(targetFor(row)),
    expected: String(row.control),
    schedule: mode === "test" ? "on-demand" : "daily",
    safe: proof ? true : mode !== "test",
    sourceFile: baseName(sourceFile),
    surface: String(row.surface),
  };

  if (proof) recipe.proof = proof;
  return recipe;
}
