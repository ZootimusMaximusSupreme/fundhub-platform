// Shared recipe for low-risk display controls whose original map evidence
// already names an exact local browser test. This never upgrades page-load,
// live, database, or vague smoke evidence to green.

export const DISPLAY_EVIDENCE_TEST = "src/pulse/catalog/proofs/display-evidence-result.test.mjs";

const LOW_RISK_IMPACTS = new Set(["none", "staffOnly"]);
const PAGE_ONLY_KINDS = new Set(["page", "page-load"]);
const NON_DISPLAY_KINDS = new Set([
  "dependency", "effect", "external-dependency", "guard", "job", "poll",
  "read", "read-panel", "system",
]);

const TEST_REFERENCE_RE = /\b(?:(?:src|api|netlify|scripts|e2e)\/)?[A-Za-z0-9_./[\]-]+\.(?:test|spec)\.mjs\b/g;
const BROWSER_SPEC_RE = /\be2e\/[A-Za-z0-9_./[\]-]+\.spec\.mjs\b/g;

const UNSAFE_TEST_RE = /(?:^|\/)(?:live-|launch-proof-live)|e2e\/(?:cc-tab-shoot|teleprompter-take-flow)\.spec\.mjs$|\.pg\.test\.mjs$|\.test\.db\.mjs$|hole\d|comprehensive|demo-journey|prove|\.paused\.spec\.mjs$/i;
const WEAK_EVIDENCE_RE = /page load|smoke|no spec|does not|not tested|not covered|only (?:opens|loads|checks)|opens? (?:it|the page)|can open|saved only through/i;

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function kindOf(row) {
  return String(row?.kind || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function displayEvidenceTestReferences(row) {
  return unique(String(row?.evidence || "").match(TEST_REFERENCE_RE) || []);
}

export function exactSafeBrowserSpecs(row) {
  const evidence = String(row?.evidence || "");
  const references = displayEvidenceTestReferences(row);
  if (!references.length) return [];
  if (references.some((reference) => !reference.includes("/") || UNSAFE_TEST_RE.test(reference))) return [];

  return unique(evidence
    .split(/[;\n]+/)
    .filter((segment) => !WEAK_EVIDENCE_RE.test(segment))
    .flatMap((segment) => segment.match(BROWSER_SPEC_RE) || [])
    .filter((reference) => !UNSAFE_TEST_RE.test(reference)));
}

export function displayEvidenceResultProof(row) {
  if (!LOW_RISK_IMPACTS.has(String(row?.impact || ""))) return null;
  const kind = kindOf(row);
  if (PAGE_ONLY_KINDS.has(kind) || NON_DISPLAY_KINDS.has(kind)) return null;
  if (!exactSafeBrowserSpecs(row).length) return null;
  return Object.freeze({
    depth: "e2e",
    evidence: DISPLAY_EVIDENCE_TEST,
    asserts: String(row.control || ""),
  });
}
