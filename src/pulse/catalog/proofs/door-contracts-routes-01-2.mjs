export const DOOR_CONTRACTS_ROUTES_01_2_EVIDENCE =
  "src/pulse/catalog/proofs/door-contracts-routes-01-2.test.mjs";

export function doorContractsRoutes012RowKey(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  const surface = String(row?.surface || "").trim();
  const control = String(row?.control || "").trim();
  return `${file}::${surface}::${control}`;
}

const DEFINITIONS = [
  {
    generatedId: "b8bc5824add2ef89a113",
    sourceFile: "routes-1.json",
    surface: "route:applications",
    control: "GET ?application_id= or ?client_id= (decision history, applications on a client)",
  },
  {
    generatedId: "503556c4e0d1f1a71fe5",
    sourceFile: "routes-1.json",
    surface: "route:applications",
    control: "POST set application status or log a bank decision with approved_amount (Apply / Approved / Declined ...)",
  },
  {
    generatedId: "8541087a66a369d274ce",
    sourceFile: "routes-1.json",
    surface: "route:applications",
    control: "POST action=exclude_approval|reinstate_approval (take an approval out of or back into the Funded count and fee basis)",
  },
  {
    generatedId: "c76b671aba949673a18a",
    sourceFile: "routes-1.json",
    surface: "route:finance/entities",
    control: "GET ?client_id= (personal and business wallets under a client)",
  },
  {
    generatedId: "c180bdefaa3962cb17fc",
    sourceFile: "routes-1.json",
    surface: "route:finance/entities",
    control: "POST action=create|rename|archive (group accounts into a personal or business wallet)",
  },
  {
    generatedId: "23bcc39b8ed2cbbdec9e",
    sourceFile: "routes-1.json",
    surface: "route:money/setup",
    control: "GET ?client_id= (where this client stands on Finance OS setup: fee, checkout link, soft pull)",
  },
  {
    generatedId: "72c056b2b1e085c4765d",
    sourceFile: "routes-1.json",
    surface: "route:money/setup",
    control: "POST action=start_checkout (mint the Finance OS setup-fee Commas checkout link; 409 price_not_set when no fee is configured)",
  },
  {
    generatedId: "1bf2cfb2dc11f077194e",
    sourceFile: "routes-1.json",
    surface: "route:money/setup",
    control: "POST action=request_soft_pull (hand back the signed soft-pull approval form link; writes nothing)",
  },
  {
    generatedId: "2d05a35a927e5c821ad7",
    sourceFile: "routes-1.json",
    surface: "route:finance/bank-accounts",
    control: "GET ?client_id= (hand-entered bank accounts with entity grouping)",
  },
  {
    generatedId: "9f6241af887043ee66ba",
    sourceFile: "routes-1.json",
    surface: "route:finance/bank-accounts",
    control: "POST action=add|classify|close (type in a balance, mark personal or business, close an account)",
  },
];

export const DOOR_CONTRACTS_ROUTES_01_2_PROOFS = Object.freeze(
  DEFINITIONS.map((definition) => {
    const key = doorContractsRoutes012RowKey(definition.sourceFile, definition);
    return Object.freeze({
      key,
      generatedId: definition.generatedId,
      sourceFile: definition.sourceFile,
      surface: definition.surface,
      control: definition.control,
      proof: Object.freeze({
        depth: "deep",
        evidence: DOOR_CONTRACTS_ROUTES_01_2_EVIDENCE,
        asserts: definition.control,
      }),
    });
  }),
);

export const DOOR_CONTRACTS_ROUTES_01_2_ROW_KEYS = Object.freeze(
  DOOR_CONTRACTS_ROUTES_01_2_PROOFS.map((entry) => entry.key),
);

const PROOF_BY_KEY = new Map(
  DOOR_CONTRACTS_ROUTES_01_2_PROOFS.map((entry) => [entry.key, entry.proof]),
);

export function doorContractsRoutes012Proof(sourceFile, row) {
  return PROOF_BY_KEY.get(doorContractsRoutes012RowKey(sourceFile, row)) || null;
}
