// Sample payloads for GET /api/money/banks?view=local_banks (Finance OS unit LOC),
// built by the REAL back end: attachLocalBanks() on the real FDIC and NCUA files
// in the bundle, and the real logo picker (findLogos) on a stub bank book.
//
// The person is the engine sample file's Alex Sample (public/app/blueprint-demo-data.json:
// home ZIP 85004, Arizona) with the demo's first business, Cedar Grove LLC, at a
// sample Tempe ZIP (85281). Giovanni's banks are the three the demo shows for
// Arizona: Chase and Bank of America with the bank book's $5,000, Wells Fargo
// with no amount in the book. Sample data only; no real client.
import { attachLocalBanks } from "../../finance/local-banks.mjs";
import { findLogos } from "../../banking/institution-logos.mjs";

const ORG = "a0000000-0000-4000-8000-000000000001";
const CLIENT = "a0000000-0000-4000-8000-000000000002";
const ID = { chase: "a0000000-0000-4000-8000-0000000000a1", boa: "a0000000-0000-4000-8000-0000000000a2", wf: "a0000000-0000-4000-8000-0000000000a3" };

/* The bank book's own logo files for these names (public/assets/lenders/). */
const BOOK = [
  { id: ID.chase, name_key: "chase", logo_path: "/assets/lenders/chase.png" },
  { id: ID.boa, name_key: "bankofamerica", logo_path: "/assets/lenders/bank-of-america.png" },
  { id: ID.wf, name_key: "wellsfargo", logo_path: "/assets/lenders/wells-fargo.png" },
  { id: "a0000000-0000-4000-8000-0000000000b1", name_key: "desertfinancialcu", logo_path: "/assets/lenders/desert-financial-cu.png" },
  { id: "a0000000-0000-4000-8000-0000000000b2", name_key: "vantagewest", logo_path: "/assets/lenders/vantage-west.png" },
  { id: "a0000000-0000-4000-8000-0000000000b3", name_key: "westernalliance", logo_path: "/assets/lenders/western-alliance.png" }
];

const logoDb = {
  query: async (sql, params) => {
    if (/FROM plaid_institutions/.test(sql)) return { rows: [] };
    if (/FROM lenders/.test(sql)) {
      const ids = new Set(params[1] || []);
      const keys = new Set(params[2] || []);
      return { rows: BOOK.filter((b) => ids.has(b.id) || keys.has(b.name_key)) };
    }
    return { rows: [] };
  }
};

function bookBank(id, name, depositCents, seasonDays, quote) {
  return {
    lender_id: id, name, kind: "bank", products: ["Business credit card (apply in a branch)"], lender_table: "InBranchBizCC",
    minimum_deposit_cents: depositCents, seasoning_days: seasonDays, logo: null,
    why: quote ? [{ text: quote, source: { label: `Bank book · ${name}`, ref: "lenders.stated_requirements · sample" } }] : [],
    relationship_steps: [], source: { label: `Bank book · ${name}`, ref: "lenders.external_row_id · sample" }
  };
}

function bankRead(asOf) {
  return {
    ok: true,
    client: { id: CLIENT, name: "Alex Sample" },
    as_of: `${asOf}T12:00:00.000Z`,
    recommended_banks: [
      bookBank(ID.chase, "Chase", 500000, 30, "Season $5K+ for 30+ days."),
      bookBank(ID.boa, "Bank of America", 500000, 30, "Checking account + 30-day seasoning required."),
      bookBank(ID.wf, "Wells Fargo", null, null, null)
    ],
    banks_left_out: [{ name: "Navy Federal Credit Union", reason: "book_says_membership_client_may_not_meet" }],
    relationships: [],
    deposit_plan: []
  };
}

const HOME = { kind: "home", label: "Home", zip: "85004", city: "PHOENIX", state: "AZ" };
const BIZ = { kind: "business", label: "Cedar Grove LLC", zip: "85281", city: "TEMPE", state: "AZ" };

function view(p) {
  return { ok: true, client: p.client, as_of: p.as_of, local_banks: p.local_banks, deposit_plan: p.deposit_plan };
}

async function build(asOf, { places = [HOME, BIZ], read = null, data } = {}) {
  const payload = await attachLocalBanks(logoDb, {
    orgId: ORG, clientId: CLIENT, payload: bankRead(asOf), now: new Date(`${asOf}T12:00:00Z`),
    read: read || (async () => places), find: findLogos, ...(data ? { data } : {})
  });
  return view(payload);
}

/** samplePayloads(today) → { full, needsAddress, noneNear, unavailable } as the view sends them. */
export async function samplePayloads(today) {
  const quiet = console.error;
  console.error = () => {};
  try {
    return {
      full: await build(today),
      needsAddress: await build(today, { places: [] }),
      noneNear: await build(today, { data: { banks: { institutions: {}, branches: [] }, creditUnions: { institutions: {}, branches: [] }, centroids: {}, membership: {} } }),
      unavailable: await build(today, { read: async () => { throw new Error("sample: address read failed"); } })
    };
  } finally {
    console.error = quiet;
  }
}

export default samplePayloads;
