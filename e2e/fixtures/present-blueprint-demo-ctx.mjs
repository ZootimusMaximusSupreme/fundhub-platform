// Fixture ctx objects for the Blueprint dashboard visual (visual C), in the
// exact shape of the 10.8 slot and data contracts
// (ops/workflows/weekend-2026-10-24.md). Plain data only: the node test and the
// browser harness each add ctx.money and ctx.esc themselves.
//
// FULL is Dana Whitfield, the e2e harness's standing fixture client
// (e2e/harness.mjs CLIENT_ROW, Whitfield Freight LLC). One person, one file:
// two revolving cards, a collection and one late, a company with no company
// report yet. Targets are 10% of each limit; the levers climb in order; the
// new-company amounts follow the engine's age rule (0.5x, 1x, 2x of one base).
//
// SAMPLE is the deck's labeled sample, the /roadmap sample file
// (ops/workflows/2026-10-02-roadmap-sample-content/w1-samples.json): $199,350
// today, $221,500 once the cards are paid down, American Express Blue Business
// Cash $4,800 of $25,000 to $2,500, Chase Sapphire Preferred $2,100 of $12,000
// to $1,200, no negative items, no business entity yet.
//
// NONE is a file with no pull yet (visual null). BAD is broken data the visual
// must survive without throwing.

export const CLIENT_ID = "aaaaaaaa-1111-4111-8111-111111111111";

export const FULL = {
  engine: {
    available: true, tier: "FUNDING_PLUS_REPAIR", total: 64000,
    fico: { experian: 640, equifax: 632, transunion: 651 }, reasons: [], sample: false
  },
  visual: {
    source: "engine",
    todayTotal: 64000,
    levers: [
      { key: "paydown", label: "Pay the cards down", applies: true, totalAfter: 88000 },
      { key: "clean", label: "Clean the file", applies: true, totalAfter: 121000 },
      { key: "accounts", label: "Add accounts", applies: false, totalAfter: null }
    ],
    optimizedTotal: 121000,
    tierNow: "FUNDING_PLUS_REPAIR",
    tierAfter: "FULL_FUNDING",
    cards: [
      { creditor: "Capital One Quicksilver", limit: 16000, balance: 9100, target: 1600, usePct: 57 },
      { creditor: "Discover it", limit: 9000, balance: 3300, target: 900, usePct: 37 }
    ],
    items: [
      { creditor: "Midland Credit Management", kind: "collection", bureaus: ["EX", "EQ"] },
      { creditor: "Ally Financial", kind: "late", bureaus: ["EX", "EQ", "TU"] }
    ],
    mismatches: [],
    companies: [{ name: "Whitfield Freight LLC", incorporatedDate: "2021-03-01", ageMonths: 67, amount: null }],
    newCompany: { year1: 44000, year2: 88000, after2: 176000 },
    fundability: { now: { passed: 2, total: 6 }, after: { passed: 5, total: 6 } }
  },
  survey: {
    target: "$75,000", use: "two more trucks", capital: "$6,000",
    motivation: "I stop turning down loads I cannot haul."
  },
  handoff: { problem: "Two banks said no in the spring and never said why.", goal: "Add two trucks by next season." },
  businesses: [{ id: "biz-1", name: "Whitfield Freight LLC", age_months: 67, incorporated_date: "2021-03-01" }],
  tier: "FUNDING_PLUS_REPAIR",
  door: "blueprint",
  sample: false,
  clientId: CLIENT_ID
};

export const SAMPLE = {
  engine: { available: true, tier: "FULL_FUNDING", total: 199350, fico: { experian: 762, equifax: 770, transunion: 758 }, reasons: [], sample: true },
  visual: {
    source: "sample",
    todayTotal: 199350,
    levers: [
      { key: "paydown", label: "Pay the cards down", applies: true, totalAfter: 221500 },
      { key: "clean", label: "Clean the file", applies: false, totalAfter: null },
      { key: "accounts", label: "Add accounts", applies: false, totalAfter: null }
    ],
    optimizedTotal: 221500,
    tierNow: "FULL_FUNDING",
    tierAfter: "FULL_FUNDING",
    cards: [
      { creditor: "American Express Blue Business Cash", limit: 25000, balance: 4800, target: 2500, usePct: 19 },
      { creditor: "Chase Sapphire Preferred", limit: 12000, balance: 2100, target: 1200, usePct: 18 }
    ],
    items: [],
    mismatches: [],
    companies: [],
    newCompany: null,
    fundability: { now: { passed: 5, total: 6 }, after: { passed: 6, total: 6 } }
  },
  survey: {},
  handoff: {},
  businesses: [],
  tier: "FULL_FUNDING",
  door: "blueprint",
  sample: true,
  clientId: "sample-roadmap"
};

export const NONE = {
  engine: { available: false, tier: null, fico: null, reasons: [], total: null },
  visual: null,
  survey: { target: "$40,000", use: "a second location" },
  handoff: {},
  businesses: [],
  tier: null,
  door: "blueprint",
  sample: false,
  clientId: "no-pull-yet"
};

/* Broken on purpose: strings where lists go, a lever with no key, a card with
   no limit, a bureau code nobody has. */
export const BAD = {
  engine: "nope",
  visual: {
    source: "engine", todayTotal: "a lot", levers: "paydown", optimizedTotal: undefined,
    cards: [{ creditor: null, limit: null, balance: 500, target: null, usePct: "high" }, 7],
    items: [{ creditor: "Who", kind: "mystery", bureaus: "EX" }],
    companies: "none", newCompany: { year1: "soon" }, fundability: { now: {} }
  },
  survey: null,
  handoff: 4,
  businesses: "Whitfield",
  tier: 9,
  door: null,
  sample: "yes",
  clientId: "bad-data"
};

/* The deck's own formatters (public/app/present.js money() and esc()). */
export function deckMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return "$" + Number(n).toLocaleString("en-US");
}
export function deckEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/** Words the owner banned from the slides (10.8 shared build rules). */
export const BANNED = [
  "number", "pre-approved", "Funding gap", "Funding Snapshot", "credit repair", "guaranteed",
  "your score will go up", "0%", "we think", "might", "maybe", "could", "probably", "CSM"
];
