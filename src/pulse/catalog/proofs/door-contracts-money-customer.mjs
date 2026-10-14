export const DOOR_CONTRACTS_MONEY_CUSTOMER_EVIDENCE =
  "src/pulse/catalog/proofs/door-contracts-money-customer.test.mjs";

export function doorContractsMoneyCustomerKey(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  const surface = String(row?.surface || "").trim();
  const control = String(row?.control || "").trim();
  return `${file}::${surface}::${control}`;
}

const DEFINITIONS = [
  {
    generatedId: "65a96e92d29a37b8b402",
    sourceFile: "routes-0.json",
    surface: "route:commissions",
    control: "action=mark_paid: stamps commission ledger rows paid with a payout ref (records a payout, sends no money).",
    handlerTest: "src/http/commissions-handler.test.mjs",
  },
  {
    generatedId: "511dad3d24c8d0995730",
    sourceFile: "routes-1.json",
    surface: "route:campaigns/write",
    control: "POST action=pause|resume|update_budget (push a campaign pause, resume or budget change to Meta)",
    handlerTest: "src/http/campaigns-write-handler.test.mjs",
  },
  {
    generatedId: "92472ae82f67fee4e8a6",
    sourceFile: "routes-1.json",
    surface: "route:finance/paydown-simulator",
    control: "POST {client_id, cash_on_hand} (split cash across cards and project the new pre-approval; needs finance-os entitlement)",
    handlerTest: "src/http/paydown-simulator-handler.test.mjs",
  },
  {
    generatedId: "1c35047de64dda1f731b",
    sourceFile: "routes-1.json",
    surface: "route:read/invoices",
    control: "GET ?client_id=&status= (invoices with balance due, days overdue, aging bucket from v_invoice_aging; open filter orders oldest first)",
    handlerTest: "src/http/read-invoices-handler.test.mjs",
  },
  {
    generatedId: "440f7767bf7df2d7494b",
    sourceFile: "routes-2.json",
    surface: "route:social/schedule",
    control: "POST /api/social/schedule {channel_id, caption, offer_type, scheduled_for, asset_id} — queues an organic post: writes the post, screens the caption for compliance (blocked posts get reasons), refuses when the partner's marketing suite is off. Caller: partner (own) or staff naming ?partner_id.",
    handlerTest: "src/http/social-schedule-handler.test.mjs",
  },
  {
    generatedId: "715c7b74d0c20d7ee1bc",
    sourceFile: "routes-3.json",
    surface: "route:read/partner-home-tiles",
    control: "GET the three Partner Home tiles with a real source: cash collected today (partner_revenue share), funded today (the production-floor definition), and cost.",
    handlerTest: "src/http/partner-home-tiles.test.mjs",
  },
];

export const DOOR_CONTRACTS_MONEY_CUSTOMER_PROOFS = Object.freeze(
  DEFINITIONS.map((definition) => {
    const key = doorContractsMoneyCustomerKey(definition.sourceFile, definition);
    return Object.freeze({
      key,
      generatedId: definition.generatedId,
      sourceFile: definition.sourceFile,
      surface: definition.surface,
      control: definition.control,
      handlerTest: definition.handlerTest,
      proof: Object.freeze({
        depth: "deep",
        evidence: `${DOOR_CONTRACTS_MONEY_CUSTOMER_EVIDENCE} ${definition.handlerTest}`,
        asserts: definition.control,
      }),
    });
  }),
);

export const DOOR_CONTRACTS_MONEY_CUSTOMER_KEYS = Object.freeze(
  DOOR_CONTRACTS_MONEY_CUSTOMER_PROOFS.map((entry) => entry.key),
);

const PROOF_BY_KEY = new Map(
  DOOR_CONTRACTS_MONEY_CUSTOMER_PROOFS.map((entry) => [entry.key, entry.proof]),
);

export function doorContractsMoneyCustomerProof(sourceFile, row) {
  return PROOF_BY_KEY.get(doorContractsMoneyCustomerKey(sourceFile, row)) || null;
}
