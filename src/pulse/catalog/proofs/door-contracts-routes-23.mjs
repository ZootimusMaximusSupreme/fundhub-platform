export const DOOR_CONTRACTS_ROUTES_23_EVIDENCE =
  "src/pulse/catalog/proofs/door-contracts-routes-23.test.mjs";

const PROOFS = [
  {
    key: "route:hiring/apply (GET open roles)",
    sourceFile: "routes-2.json",
    family: "route",
    depth: "e2e",
    asserts: "GET /api/hiring/apply — public careers door: lists open roles (key, name, brief only). No auth.",
  },
  {
    key: "route:read/eeo-aggregate",
    sourceFile: "routes-2.json",
    family: "route",
    depth: "e2e",
    asserts: "GET /api/read/eeo-aggregate — bias-audit aggregates from v_eeo_aggregate only (cells under 5 suppressed), optional ?role=. Read-only; never the raw eeo_responses. Caller: owner, admin (ROLE_SETS.COMPLIANCE).",
  },
  {
    key: "route:hiring/bench",
    sourceFile: "routes-3.json",
    family: "route",
    depth: "e2e",
    asserts: "GET the always-on recruiting bench per role (candidates past the group interview).",
  },
  {
    key: "route:hiring/decisions",
    sourceFile: "routes-3.json",
    family: "route",
    depth: "e2e",
    asserts: "GET ?state=&role=&days= the AEDT audit trail: what the tool recommended and what the human decided, with the override flag. Protected characteristics are never included.",
  },
  {
    key: "route:read/deal-math",
    sourceFile: "routes-3.json",
    family: "route",
    depth: "deep",
    asserts: "GET ?deposit=&fee=&debts=&min=&drawn= net cash and monthly payment from the closer's typed numbers. No table; pure math behind the staff gate.",
  },
  {
    key: "route:read/inquiries",
    sourceFile: "routes-3.json",
    family: "route",
    depth: "deep",
    asserts: "GET the inquiry-removal work queue from the local inquiry_log, with the client's name joined in.",
  },
  {
    key: "route:read/staff",
    sourceFile: "routes-3.json",
    family: "route",
    depth: "e2e",
    asserts: "GET staff directory (password_hash stripped). hiddenCount says how many test, demo and owner rows are kept off screen.",
  },
  {
    key: "workflow:hiring-outreach-cadence",
    sourceFile: "jobs.json",
    family: "job",
    depth: "deep",
    asserts: "hiring-outreach-cadence (src/workflows/hiring-outreach-cadence.mjs): trigger cron */30 * * * *. every 30 minutes queues the next follow-up email or text to a job applicant (4 touches over 10 days) | sends or calls: queues messages | writes: messages, candidate_outreach",
  },
];

export const DOOR_CONTRACTS_ROUTES_23_PROOFS = Object.freeze(
  PROOFS.map((proof) => Object.freeze({
    ...proof,
    evidence: DOOR_CONTRACTS_ROUTES_23_EVIDENCE,
  }))
);

export const DOOR_CONTRACTS_ROUTES_23_KEYS = Object.freeze(
  DOOR_CONTRACTS_ROUTES_23_PROOFS.map((proof) => proof.key)
);

const BY_KEY = new Map(DOOR_CONTRACTS_ROUTES_23_PROOFS.map((proof) => [proof.key, proof]));

export function doorContractsRoutes23Proof(row) {
  const proof = BY_KEY.get(row?.surface);
  if (!proof || proof.asserts !== row?.control) return null;
  return proof;
}
