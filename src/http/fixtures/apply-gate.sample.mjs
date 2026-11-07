// Test inputs for the apply gate screen tests (src/ui/apply-gate.test.mjs and
// e2e/apply-gate.spec.mjs). Every payload is built by the REAL back end
// (buildApplyGate in src/finance/apply-gate.mjs) from rows, so the screen is
// tested against the API's own shape, never a hand-typed guess.
//
// ONE sample person, one story (sample-clients-consistent): a fundable file with
// no inquiries, a Chase business checking account opened 40 days ago (seasoned),
// a Bank of America account opened 12 days ago (still seasoning), and two Bank
// of America card approvals in the last 30 days. The bank book words are the
// book's own text for each bank. Test files only, never shown to anyone.
import { buildApplyGate, bankKey } from "../../finance/apply-gate.mjs";

const BOOK = {
  chase: { id: "c4a5e000-0000-4000-8000-000000000001", name: "Chase", lender_table: "OnlineBizCC",
    product_name: "Ink Business Unlimited", requires_account_opening: "yes",
    stated_requirements: "Giovanni list: Experian.\n30+ days of liquidity seasoning strongly improves odds",
    logo_path: "/assets/lenders/chase.png", external_row_id: "LEGACY-ONLINEBIZCC-CHASE" },
  boa: { id: "b0a00000-0000-4000-8000-000000000001", name: "Bank of America", lender_table: "OnlineBizCC",
    product_name: "Business Advantage Unlimited Cash", requires_account_opening: "yes",
    stated_requirements: "Giovanni list: TransUnion.\nChecking account is required with liquidity seasoned 30+ days.; " +
      "Max of 2 card approvals within 30 days.; Max of 3 card approvals within a year.; Max of 4 card approvals within 2 years.",
    logo_path: "/assets/lenders/bank-of-america.png", external_row_id: "LEGACY-ONLINEBIZCC-BANK-OF-AMERICA" },
  amex: { id: "a3e40000-0000-4000-8000-000000000001", name: "American Express", lender_table: "OnlineBizCC",
    product_name: "Blue Business Cash", stated_requirements: "No business checking required.",
    logo_path: "/assets/lenders/american-express.png" },
  citi: { id: "c1710000-0000-4000-8000-000000000001", name: "Citi", lender_table: "PersonalCC",
    product_name: "Double Cash", logo_path: "/assets/lenders/citi.png",
    insider_tips: "Citi card approval every eight days, with no more than two approvals within a rolling 65-day window." }
};

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fund({ pull = true, inquiries = 0 } = {}) {
  const f = (key, label, passed, value = null) => ({ key, label, passed, value });
  return {
    ok: true, has_pull: pull, sample: true, client: { id: "sample-client", name: "Pat Test" },
    now: {
      tier: pull ? "fundable" : null,
      factors: [
        f("score_700", "Credit score 700 or higher", pull ? true : null),
        f("utilization_30", "Cards used 30% or less", pull ? true : null),
        f("no_negatives", "No negative items", pull ? true : null),
        f("anchor_card", "A card 2+ years old with a $5,000+ limit", pull ? true : null),
        f("no_inquiries", "No hard inquiries", pull ? inquiries === 0 : null, pull ? inquiries : null),
        f("file_depth", "3 or more accounts in good standing", pull ? true : null)
      ]
    }
  };
}

function rel(bank, opened, kind = "business") {
  return { id: `rel-${bankKey(bank).replace(/\s+/g, "-")}`, bank, bank_key: bankKey(bank), account_kind: kind,
    status: opened ? "seasoning" : "planned", opened_on: opened, lender_id: null };
}

/** The payloads the screen paints, as of `today` (YYYY-MM-DD). */
export function samplePayloads(today = new Date().toISOString().slice(0, 10)) {
  const matches = [BOOK.chase, BOOK.boa, BOOK.amex, BOOK.citi];
  /* Four more banks on the list so the "Show all" control has work to do. */
  for (let i = 1; i <= 4; i++) {
    matches.push({ id: `00000000-0000-4000-8000-00000000000${i}`, name: `Sample Credit Union ${i}`, lender_table: "OnlineBizCC",
      stated_requirements: "No business checking required." });
  }
  const relationships = [rel("Chase", addDays(today, -40)), rel("Bank of America", addDays(today, -12)), rel("Wells Fargo", null)];
  const approvals = [
    { lender_id: BOOK.boa.id, bank: "Bank of America", lender_table: "OnlineBizCC", decided_on: addDays(today, -9) },
    { lender_id: BOOK.boa.id, bank: "Bank of America", lender_table: "OnlineBizCC", decided_on: addDays(today, -3) }
  ];
  const base = { today, asOf: `${today}T17:00:00.000Z`, matches, extra: Object.values(BOOK), relationships, approvals };
  return {
    full: buildApplyGate({ ...base, fundability: fund(), viewer: "client", client: { id: "sample-client", name: "Pat Test" } }),
    staff: buildApplyGate({ ...base, fundability: fund(), viewer: "staff", client: { id: "sample-client", name: "Pat Test" } }),
    staffAllowed: buildApplyGate({ ...base, fundability: fund(), viewer: "staff",
      overrides: [{ bank_key: "bank of america", bank_name: "Bank of America", allow_more: true, note: "Large deposit",
        created_at: `${today}T16:00:00.000Z` }] }),
    locked: buildApplyGate({ ...base, fundability: fund({ inquiries: 3 }), viewer: "client" }),
    empty: buildApplyGate({ today, fundability: fund({ pull: false }), matches: [], relationships: [], viewer: "client" })
  };
}
