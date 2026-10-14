// Slice 2 (customer messages): flow rows proved by a test that exercises the
// exact named result. Two kinds so far:
//
//   - the role journeys' "should be able to reach" and "should stay blocked"
//     rows, proved by a signed-in probe of every route through the real adapter
//     (s2-role-route-reach.test.mjs).
//
// A surface listed here leaves the Flow gap monitor (flow-gap-cases.mjs) and its
// row carries the proof below instead.
const ROLE_ROW =
  /^journey:(?:role-owner|role-sales-manager|role-closer|role-funding-advisor|role-inquiry-remover|client|affiliate|white-label)-intended#(?:reach-.+|stays-blocked)$/;

export const S2_ROLE_REACH_TEST = "src/pulse/catalog/proofs/s2-role-route-reach.test.mjs";

function basename(sourceFile) {
  return String(sourceFile || "").split(/[\\/]/).at(-1);
}

export function isS2RoleRow(row) {
  return ROLE_ROW.test(String(row?.surface || ""));
}

/** True when a slice-2 test owns this Flow row, so no gap monitor should. */
export function isS2ProvedFlowRow(row) {
  return isS2RoleRow(row);
}

export function s2FlowProof(sourceFile, row) {
  if (basename(sourceFile) === "journeys.json" && isS2RoleRow(row)) {
    return {
      depth: "deep",
      evidence: `${S2_ROLE_REACH_TEST} src/pulse/catalog/proofs/s2-role-probe.mjs`,
      asserts: row.control,
    };
  }
  return null;
}
