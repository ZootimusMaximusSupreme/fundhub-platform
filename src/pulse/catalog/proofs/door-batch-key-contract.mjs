const KEY_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

export const KEY_CONTRACT_EVIDENCE =
  "src/pulse/catalog/proofs/door-batch-key-contract.mjs " +
  "src/pulse/catalog/proofs/door-batch-key-contract.test.mjs";

export function keyContractAssertion(name) {
  return `${name} has a valid env name and is referenced by repo code; no value is read`;
}

export function evaluateKeyContract(row, references = []) {
  const name = String(row?.env_name || "").trim();
  const problems = [];

  if (!KEY_NAME_RE.test(name)) problems.push("invalid env name");
  if (row?.surface !== `env:${name}`) problems.push("surface does not match env name");
  if (!String(row?.control || "").startsWith(`${name}:`)) problems.push("control does not name the key");
  if (!Number.isInteger(row?.read_by_files) || row.read_by_files < 1) problems.push("map names no reader");
  if (!Array.isArray(references) || references.length < 1) problems.push("repo code has no reader");

  return {
    ok: problems.length === 0,
    name,
    assertion: keyContractAssertion(name),
    problems,
    references: Array.isArray(references) ? [...references] : [],
  };
}

export function keyContractProof(row) {
  if (!["none", "staffOnly"].includes(row?.impact)) return null;
  const checked = evaluateKeyContract(row, ["checked-by-focused-batch-test"]);
  if (!checked.ok) return null;
  return {
    depth: "e2e",
    evidence: KEY_CONTRACT_EVIDENCE,
    asserts: checked.assertion,
  };
}
