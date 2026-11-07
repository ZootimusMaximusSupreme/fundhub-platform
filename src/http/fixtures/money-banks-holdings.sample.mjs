// The Banks tab with the client's own accounts applied (Finance OS wave 4, unit
// TL). Sample rows only, one fictional client: a Chase Ink Business Cash and a
// Chase business checking account in one business, a Chase Sapphire Preferred
// of their own, and all three American Express business cards. The bank plan
// is the real GET /api/money/banks sample read (money-banks.sample.json) run
// through the real applyHoldingsToBankPlan(), so the screen and the read are
// checked against one contract.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInventory, holdingsOf, applyHoldingsToBankPlan } from "../../finance/tradeline-inventory.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAN = JSON.parse(fs.readFileSync(path.join(HERE, "money-banks.sample.json"), "utf8"));

const ME = "aaaaaaaa-0000-4000-8000-0000000000a1";
const BIZ = "aaaaaaaa-0000-4000-8000-0000000000b1";
const card = (id, name, inst, entity, kind, limit) => ({
  id, name, account_type: "credit", account_subtype: "credit card", credit_limit_cents: limit, mask: null,
  entity_id: entity, entity_kind: kind, plaid_item_id: `item-${inst}`, institution_name: inst, closed_at: null
});

export function sampleHoldings() {
  return holdingsOf(buildInventory({
    entities: [
      { id: ME, kind: "personal", name: "Sample Person (personal)", archived_at: null },
      { id: BIZ, kind: "business", name: "Sample LLC", archived_at: null }
    ],
    accounts: [
      card("c1", "Ink Business Cash", "Chase", BIZ, "business", 1000000),
      { id: "c2", name: "Total Business Checking", account_type: "depository", account_subtype: "checking", entity_id: BIZ,
        entity_kind: "business", plaid_item_id: "item-Chase", institution_name: "Chase", closed_at: null },
      card("c3", "Chase Sapphire Preferred", "Chase", ME, "personal", 900000),
      card("a1", "Business Gold Card", "American Express", BIZ, "business", null),
      card("a2", "Blue Business Cash", "American Express", BIZ, "business", 1500000),
      card("a3", "Blue Business Plus", "American Express", BIZ, "business", 1200000)
    ]
  }));
}

/* Each bank's own logo, as attachBankLogos() and the wrapper hand them in:
   the bank book's files for the four book banks here, else none. */
const BOOK = {
  "Bank of America": "/assets/lenders/bank-of-america.png", Chase: "/assets/lenders/chase.png",
  "Wells Fargo": "/assets/lenders/wells-fargo.png", "American Express": "/assets/lenders/american-express.png"
};
const dress = (name) => (BOOK[name] ? { logo: BOOK[name], logo_source: "bank_book" } : { logo: null, logo_source: null });

export function taggedBanks() {
  const out = applyHoldingsToBankPlan(JSON.parse(JSON.stringify(PLAN)), sampleHoldings());
  out.recommended_banks = out.recommended_banks.map((b) => ({ ...b, ...dress(b.name) }));
  out.card_stacking.items = out.card_stacking.items.map((s) => ({ ...s, ...dress(s.issuer) }));
  out.card_stacking.already_have = out.card_stacking.already_have.map((h) => ({ ...h, ...dress(h.issuer) }));
  return out;
}
