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
// It carries a fundability count so the meter path is covered.
//
// SAMPLE is the deck's own sample file (src/finance/sample-credit-file.mjs and
// bank v3, src/banking/plaid-sandbox-user.mjs): the Personal Visa at First
// Platypus Bank, $3,142 of $8,000 on 2026-10-29, target $800; the paid-off
// Toyota loan with its one old 30-day late; Fundhub LLC. The amounts are W1's
// real engine.visual for that file: today $24,749, paid down $33,000, cleaned
// $55,000. Like every real file today it has fundability null and, here,
// newCompany null.
//
// REPAIR is a repair-only file: the engine prints $0 today and the climb is the
// pitch. HOLD is a file where the engine withholds the money (review or hold):
// every lever applies false with totalAfter null, so no qualify amount shows,
// while the steps and the cards still work.
//
// NONE is a file with no pull yet (visual null). BAD is broken data the visual
// must survive without throwing.

export const CLIENT_ID = "aaaaaaaa-1111-4111-8111-111111111111";

const LEVERS_OFF = [
  { key: "paydown", label: "Pay the cards down", applies: false, totalAfter: null },
  { key: "clean", label: "Clean the file", applies: false, totalAfter: null },
  { key: "accounts", label: "Add accounts", applies: false, totalAfter: null }
];

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
  engine: {
    available: true, tier: "FUNDING_PLUS_REPAIR", total: 24749,
    fico: { experian: 702, equifax: 709, transunion: 706 }, reasons: [], sample: true
  },
  visual: {
    source: "sample",
    todayTotal: 24749,
    levers: [
      { key: "paydown", label: "Pay the cards down", applies: true, totalAfter: 33000 },
      { key: "clean", label: "Clean the file", applies: true, totalAfter: 55000 },
      { key: "accounts", label: "Add accounts", applies: false, totalAfter: null }
    ],
    optimizedTotal: 55000,
    tierNow: "FUNDING_PLUS_REPAIR",
    tierAfter: "FULL_FUNDING",
    cards: [
      { creditor: "First Platypus Bank Visa", limit: 8000, balance: 3142, target: 800, usePct: 39 }
    ],
    items: [
      { creditor: "Toyota Motor Credit", kind: "late", bureaus: ["EX", "EQ", "TU"] }
    ],
    mismatches: [],
    companies: [],
    newCompany: null,
    fundability: null
  },
  survey: {},
  handoff: {},
  businesses: [{ id: "biz-sample", name: "Fundhub LLC", age_months: null, incorporated_date: null }],
  tier: "FUNDING_PLUS_REPAIR",
  door: "blueprint",
  sample: true,
  clientId: "sample-financeos"
};

export const REPAIR = {
  engine: {
    available: true, tier: "REPAIR_ONLY", total: 0,
    fico: { experian: 588, equifax: 596, transunion: 602 }, reasons: [], sample: false
  },
  visual: {
    source: "engine",
    todayTotal: 0,
    levers: [
      { key: "paydown", label: "Pay the cards down", applies: false, totalAfter: null },
      { key: "clean", label: "Clean the file", applies: true, totalAfter: 41000 },
      { key: "accounts", label: "Add accounts", applies: false, totalAfter: null }
    ],
    optimizedTotal: 41000,
    tierNow: "REPAIR_ONLY",
    tierAfter: "FUNDING_PLUS_REPAIR",
    cards: [
      { creditor: "Credit One Bank", limit: 1500, balance: 1380, target: 150, usePct: 92 }
    ],
    items: [
      { creditor: "Portfolio Recovery Associates", kind: "collection", bureaus: ["EX", "EQ", "TU"] },
      { creditor: "Synchrony Bank", kind: "charge_off", bureaus: ["EX", "TU"] }
    ],
    mismatches: [],
    companies: [],
    newCompany: null,
    fundability: null
  },
  survey: { capital: "about $1,500" },
  handoff: {},
  businesses: [],
  tier: "REPAIR_ONLY",
  door: "blueprint",
  sample: false,
  clientId: "repair-only"
};

export const HOLD = {
  engine: {
    available: true, tier: "MANUAL_REVIEW", total: null,
    fico: { experian: 681, equifax: 677, transunion: 690 }, reasons: ["NAME_MISMATCH"], sample: false
  },
  visual: {
    source: "engine",
    todayTotal: null,
    levers: LEVERS_OFF,
    optimizedTotal: null,
    tierNow: null,
    tierAfter: null,
    cards: [
      { creditor: "Chase Freedom", limit: 12000, balance: 5100, target: 1200, usePct: 43 },
      { creditor: "Wells Fargo Active Cash", limit: 7000, balance: 900, target: 700, usePct: 13 }
    ],
    items: [
      { creditor: "LVNV Funding", kind: "collection", bureaus: ["EQ"] }
    ],
    mismatches: [],
    companies: [],
    newCompany: null,
    fundability: null
  },
  survey: {},
  handoff: {},
  businesses: [],
  tier: null,
  door: "blueprint",
  sample: false,
  clientId: "engine-hold"
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

/** The one dollar sign on the dashboard that is not a client amount: the
 *  engine's own check threshold (src/finance/fundability.mjs PERSONAL_CHECKS). */
export const THRESHOLD_LABEL = "$5,000+ limit";

/** Words the owner banned from the slides (10.8 shared build rules). */
export const BANNED = [
  "number", "pre-approved", "Funding gap", "Funding Snapshot", "credit repair", "guaranteed",
  "your score will go up", "0%", "we think", "might", "maybe", "could", "probably", "CSM"
];
