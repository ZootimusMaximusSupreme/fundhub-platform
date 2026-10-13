const EVIDENCE = "src/pulse/catalog/proofs/door-flow-read-contracts-2.test.mjs";

function key(sourceFile, surface, control) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  return `${file}::${String(surface || "").trim()}::${String(control || "").trim()}`;
}

function exactContract(definition, depth) {
  const rowKey = key(definition.sourceFile, definition.surface, definition.control);
  return Object.freeze({
    ...definition,
    key: rowKey,
    proof: Object.freeze({ depth, evidence: EVIDENCE, asserts: definition.control }),
  });
}

export const DOOR_FLOW_READ_DOOR_CONTRACTS = Object.freeze([
  exactContract({
    generatedId: "3f10909053357bb5ba2a",
    sourceFile: "routes-2.json",
    family: "route",
    surface: "route:finance/entities",
    control: "GET/POST /api/finance/entities — a client's wallets: GET list; POST create (personal or business), rename, archive. Caller: ROLE_SETS.STAFF, client in the session org.",
  }, "deep"),
]);

// The remaining monitored Flow rows do not yet have a complete, safe final
// result proof. Keeping this list empty prevents metadata from looking green.
export const DOOR_FLOW_READ_FLOW_CONTRACTS = Object.freeze([]);

export const DOOR_FLOW_READ_READ_CONTRACTS = Object.freeze([
  exactContract({
    generatedId: "b79b6c45d9c1a7d5928e",
    sourceFile: "desks-a.json",
    family: "read",
    surface: "campaign-manager.html",
    control: "Creative fatigue panel (CM-06: frequency, CTR, ROAS, recommendation, label)",
  }, "deep"),
]);

function proofFor(contracts, sourceFile, row) {
  const wanted = key(sourceFile, row?.surface, row?.control);
  return contracts.find((entry) => entry.key === wanted)?.proof || null;
}

export const doorFlowReadDoorProof = (sourceFile, row) =>
  proofFor(DOOR_FLOW_READ_DOOR_CONTRACTS, sourceFile, row);
export const doorFlowReadFlowProof = (sourceFile, row) =>
  proofFor(DOOR_FLOW_READ_FLOW_CONTRACTS, sourceFile, row);
export const doorFlowReadReadProof = (sourceFile, row) =>
  proofFor(DOOR_FLOW_READ_READ_CONTRACTS, sourceFile, row);

export function doorFlowReadRowKey(sourceFile, row) {
  return key(sourceFile, row?.surface, row?.control);
}
