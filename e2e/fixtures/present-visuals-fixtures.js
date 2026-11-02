// Fixture ctx objects for the W3 slide visuals (public/app/present-visuals.js).
// Shape: the 10.8 slot contract on ops/workflows/weekend-2026-10-24.md, minus
// the two functions (money, esc) that the harness and the test add.
//
// EVERY AMOUNT IS THE ENGINE'S OWN. These are not typed-in guesses. They were
// printed on 2026-10-29 by W1's buildDeckVisualData (src/sales/deck-visual-data.mjs)
// running the vendored UnderwriteIQ CRS engine on the repo's own files:
//
//   * "full", "sample" and "revenue": the FinanceOS sample person
//     (src/finance/sample-credit-file.mjs: one Visa at 40% use, one old 30-day
//     late on a paid-off car loan) with the sim business scenario "two_clean"
//     (scripts/sim/crs-scenarios.mjs) attached. Today 96,524 = personal 24,749 +
//     Cedar Mesa 59,400 + Bright Mesa 12,375. Pay the cards down projects to
//     104,775; clean the file re-checks the tier and projects to 174,625.
//   * "mismatch": the vendor's sandbox bureau reports (Barbara Doty), the one
//     repo file whose name and address differ across the bureaus.
//   * "repair": the sim profile "repair-full" — $0 today, the cleaned file
//     routes up to 8,250.
//
// Each fixture is one person and one file (sample-clients-consistent). The
// survey answers are the apply survey's own option labels
// (marketing/landing-pages/apply-survey.html); the setter's two sentences are
// fictional. Used by src/ui/present-visuals.test.mjs and e2e/present-visuals.spec.mjs.
(function (root) {
  "use strict";

  var SAMPLE_PERSON_VISUAL = {
    source: "engine",
    pulledOn: "2026-03-02",
    todayTotal: 96524,
    availableCredit: 6000,
    lenderReach: { now: 6, after: 9 },
    levers: [
      { key: "paydown", label: "Pay the cards down", applies: true, totalAfter: 104775 },
      { key: "clean", label: "Clean the file", applies: true, totalAfter: 174625 },
      { key: "accounts", label: "Add accounts", applies: false, totalAfter: 174625 }
    ],
    optimizedTotal: 174625,
    tierNow: "FUNDING_PLUS_REPAIR",
    tierAfter: "FULL_FUNDING",
    cards: [{ creditor: "FIRST PLATYPUS BANK", limit: 10000, balance: 4000, target: 1000, usePct: 40 }],
    items: [{ creditor: "TOYOTA MOTOR CREDIT", kind: "late", bureaus: ["EX", "TU", "EQ"] }],
    mismatches: [],
    companies: [
      { name: "Cedar Mesa Consulting LLC", incorporatedDate: "2022-09", ageMonths: 42, amount: 59400 },
      { name: "Bright Mesa Marketing LLC", incorporatedDate: "2025-07", ageMonths: 8, amount: 12375 },
      { name: "No Report Yet LLC", incorporatedDate: null, ageMonths: null, amount: null }
    ],
    newCompany: { year1: 27500, year2: 55000, after2: 110000 },
    fundability: null
  };

  var SAMPLE_PERSON_BUSINESSES = [
    { id: "fx-b1", name: "Cedar Mesa Consulting LLC", age_months: 42, incorporated_date: "2022-09" },
    { id: "fx-b2", name: "Bright Mesa Marketing LLC", age_months: 8, incorporated_date: "2025-07" },
    { id: "fx-b3", name: "No Report Yet LLC", age_months: null, incorporated_date: null }
  ];

  var SAMPLE_PERSON_SURVEY = {
    name: "Test Sample",
    target: "$100k - $200k",
    use: "Growth (marketing, inventory, hiring)",
    hasBiz: "Yes, 2-5 years",
    revenue: "$100k-$199k",
    income: null,
    capital: "$5k - $25k",
    motivation: "Grow faster (more customers / more reach)"
  };

  var SAMPLE_PERSON_HANDOFF = {
    problem: "Two banks turned me down this year and never said why.",
    goal: "About $150,000 to open a second location.",
    complete_at: "2026-10-28T17:10:00.000Z"
  };

  function samplePerson(clientId, extra) {
    var ctx = {
      clientId: clientId,
      engine: { available: true, total: 96524, outcome: "FUNDING_PLUS_REPAIR", tier: "FUNDING_PLUS_REPAIR", fico: { ex: 702, eq: 709, tu: 706 }, reasons: [] },
      visual: JSON.parse(JSON.stringify(SAMPLE_PERSON_VISUAL)),
      survey: JSON.parse(JSON.stringify(SAMPLE_PERSON_SURVEY)),
      handoff: JSON.parse(JSON.stringify(SAMPLE_PERSON_HANDOFF)),
      businesses: JSON.parse(JSON.stringify(SAMPLE_PERSON_BUSINESSES)),
      tier: "FUNDING_PLUS_REPAIR",
      door: "fund_plus_optimize",
      sample: false
    };
    Object.keys(extra || {}).forEach(function (k) { ctx[k] = extra[k]; });
    return ctx;
  }

  var full = samplePerson("fx-visuals-full");

  var sample = samplePerson("fx-visuals-sample", { sample: true });
  sample.visual.source = "sample";
  sample.engine.sample = true;

  var revenue = samplePerson("fx-visuals-revenue", { door: "revenue" });

  /* No pull yet: the setter's answers exist, the engine has nothing. */
  var nodata = {
    clientId: "fx-visuals-nodata",
    engine: { available: false, reason: "no credit pull on this file yet", fico: {}, reasons: [] },
    visual: null,
    survey: JSON.parse(JSON.stringify(SAMPLE_PERSON_SURVEY)),
    handoff: JSON.parse(JSON.stringify(SAMPLE_PERSON_HANDOFF)),
    businesses: JSON.parse(JSON.stringify(SAMPLE_PERSON_BUSINESSES)),
    tier: null,
    door: null,
    sample: false
  };

  /* Bad data: wrong types everywhere. The visuals never throw on it. */
  var bad = {
    clientId: "fx-visuals-bad",
    engine: "nope",
    visual: {
      source: 7,
      todayTotal: "lots",
      levers: "not a list",
      optimizedTotal: {},
      tierNow: ["FULL_FUNDING"],
      tierAfter: 12,
      cards: null,
      items: "x",
      mismatches: { field: "name" },
      companies: 5,
      newCompany: [],
      fundability: "none"
    },
    survey: "a string",
    handoff: 42,
    businesses: "x",
    tier: 99,
    door: { fund: true },
    sample: "yes"
  };

  /* The vendor sandbox person: a name and an address that differ across the
     three reports. The engine prints no dollar amount for that. */
  var mismatch = {
    clientId: "fx-visuals-mismatch",
    engine: { available: true, total: 7936, outcome: "FUNDING_PLUS_REPAIR", tier: "FUNDING_PLUS_REPAIR", fico: {}, reasons: [] },
    visual: {
      source: "engine",
      todayTotal: 7936,
      levers: [
        { key: "paydown", label: "Pay the cards down", applies: true, totalAfter: 19841 },
        { key: "clean", label: "Clean the file", applies: true, totalAfter: 33069 },
        { key: "accounts", label: "Add accounts", applies: false, totalAfter: 33069 }
      ],
      optimizedTotal: 33069,
      tierNow: "FUNDING_PLUS_REPAIR",
      tierAfter: "FULL_FUNDING",
      cards: [
        { creditor: "SYNCB/LEVITZ", limit: 1894, balance: 1762, target: 189, usePct: 93 },
        { creditor: "CITIBANK SD NA", limit: 624, balance: 429, target: 62, usePct: 69 }
      ],
      items: [
        { creditor: "SIGNET BANK/VIRGINIA", kind: "charge_off", bureaus: ["EX"] },
        { creditor: "CONNECTICUT CHILD SU", kind: "late", bureaus: ["EQ"] },
        { creditor: "SALLIE MAE STUDENT L", kind: "late", bureaus: ["EQ"] }
      ],
      mismatches: [
        { field: "name", values: { EX: "WILLIE L BOOZE", TU: "BARBARA M DOTY", EQ: null } },
        { field: "address", values: {
          EX: "5815 KNOLL KREST ST, SAN ANTONIO, TX 78242 / 5470 W MILITARY DR APT 2104, SAN ANTONIO, TX 78242 / RR 4, ROBSTOWN, TX 78380",
          TU: "1100 LYNHURST LN, DENTON, TX 76205",
          EQ: "2224 AHAMAKA APT B, WAHIAWA, HI 96786"
        } }
      ],
      companies: [],
      newCompany: null,
      fundability: null
    },
    survey: { target: "Less than $50k", use: "Debt consolidation", hasBiz: "No, personal funding only", motivation: "Pay off pressure (wipe out high-interest debt)" },
    handoff: null,
    businesses: [],
    tier: "FUNDING_PLUS_REPAIR",
    door: "fund_plus_optimize",
    sample: false
  };

  /* A repair-only file: $0 today, the cleaned file routes up. The deck's own
     headline is null (the portal reader drops $0); the engine's is 0. */
  var repair = {
    clientId: "fx-visuals-repair",
    engine: { available: true, total: null, outcome: "REPAIR_ONLY", tier: "REPAIR_ONLY", fico: { ex: 541, eq: 566, tu: 552 }, reasons: [] },
    visual: {
      source: "engine",
      pulledOn: "2026-03-02",
      todayTotal: 0,
      availableCredit: 140,
      lenderReach: { now: 0, after: 15 },
      levers: [
        { key: "paydown", label: "Pay the cards down", applies: false, totalAfter: 0 },
        { key: "clean", label: "Clean the file", applies: true, totalAfter: 8250 },
        { key: "accounts", label: "Add accounts", applies: false, totalAfter: 8250 }
      ],
      optimizedTotal: 8250,
      tierNow: "REPAIR_ONLY",
      tierAfter: "FULL_FUNDING",
      cards: [
        { creditor: "CREDIT ONE BANK", limit: 1500, balance: 1490, target: 150, usePct: 99 },
        { creditor: "CAPITAL ONE", limit: 3000, balance: 2870, target: 300, usePct: 96 }
      ],
      items: [
        { creditor: "CAPITAL ONE", kind: "late", bureaus: ["EX", "TU", "EQ"] },
        { creditor: "MIDLAND CREDIT MGMT", kind: "collection", bureaus: ["EX", "TU"] },
        { creditor: "PORTFOLIO RECOVERY", kind: "collection", bureaus: ["TU", "EQ"] },
        { creditor: "SYNCB/CARE CREDIT", kind: "charge_off", bureaus: ["EX", "EQ"] }
      ],
      mismatches: [{ field: "name", values: { EX: "TEST SAMPLE / TEST SAMPL", TU: "TEST SAMPLE", EQ: "TEST SAMPLE" } }],
      companies: [],
      newCompany: { year1: 4125, year2: 8250, after2: 16500 },
      fundability: null
    },
    survey: { target: "$50k - $100k", use: "Equipment or buildout", hasBiz: "Yes, 6-12 months", motivation: "Fresh start (new business / startup launch)" },
    handoff: { problem: "A collection from a hospital bill is stuck on my report.", goal: "A truck for the business by spring.", complete_at: "2026-10-27T15:00:00.000Z" },
    businesses: [],
    tier: "REPAIR_ONLY",
    door: "blueprint",
    sample: false
  };

  /* The same sample person, but only TransUnion answered: a thin file. Card use
     moves the amount, cleaning alone does not lift the thin-file cut, adding
     accounts does. So the levers on the slide are paydown and accounts. */
  var thin = samplePerson("fx-visuals-thin", { businesses: [] });
  thin.engine.total = 14849;
  thin.visual = {
    source: "engine",
    todayTotal: 14849,
    levers: [
      { key: "paydown", label: "Pay the cards down", applies: true, totalAfter: 19800 },
      { key: "clean", label: "Clean the file", applies: false, totalAfter: 19800 },
      { key: "accounts", label: "Add accounts", applies: true, totalAfter: 55000 }
    ],
    optimizedTotal: 55000,
    tierNow: "FUNDING_PLUS_REPAIR",
    tierAfter: "FULL_FUNDING",
    cards: [{ creditor: "FIRST PLATYPUS BANK", limit: 10000, balance: 4000, target: 1000, usePct: 40 }],
    items: [{ creditor: "TOYOTA MOTOR CREDIT", kind: "late", bureaus: ["TU"] }],
    mismatches: [],
    companies: [],
    newCompany: { year1: 27500, year2: 55000, after2: 110000 },
    fundability: null
  };

  /* The engine withheld the money (the file is in review, or the stored headline
     disagrees with the engine's fresh run): every lever null and off, no tier, no
     new-company price. The deck's own headline and the lists still come through.
     Person: the sim profile "fundable" with one company that has no report. */
  var withheld = {
    clientId: "fx-visuals-withheld",
    engine: { available: true, total: 212000, outcome: "MANUAL_REVIEW", tier: null, fico: { ex: 771, eq: 778, tu: 766 }, reasons: [] },
    visual: {
      source: "engine",
      todayTotal: 212000,
      levers: [
        { key: "paydown", label: "Pay the cards down", applies: false, totalAfter: null },
        { key: "clean", label: "Clean the file", applies: false, totalAfter: null },
        { key: "accounts", label: "Add accounts", applies: false, totalAfter: null }
      ],
      optimizedTotal: null,
      tierNow: null,
      tierAfter: null,
      cards: [
        { creditor: "CAPITAL ONE", limit: 10000, balance: 700, target: 1000, usePct: 7 },
        { creditor: "CHASE CARD SERVICES", limit: 20000, balance: 1200, target: 2000, usePct: 6 },
        { creditor: "AMEX", limit: 15000, balance: 850, target: 1500, usePct: 6 }
      ],
      items: [],
      mismatches: [{ field: "name", values: { EX: "TEST SAMPLE / TEST SAMPL", TU: "TEST SAMPLE", EQ: "TEST SAMPLE" } }],
      companies: [{ name: "Cedar Mesa Consulting LLC", incorporatedDate: "2022-09", ageMonths: 42, amount: null }],
      newCompany: null,
      fundability: null
    },
    survey: { target: "$200k - $400k", use: "Equipment or buildout", hasBiz: "Yes, 2-5 years", motivation: "Grow faster (more customers / more reach)" },
    handoff: null,
    businesses: [{ id: "fx-w1", name: "Cedar Mesa Consulting LLC", age_months: 42, incorporated_date: "2022-09" }],
    tier: null,
    door: null,
    sample: false
  };

  root.FHV_FIXTURES = {
    full: full, sample: sample, nodata: nodata, bad: bad,
    mismatch: mismatch, repair: repair, revenue: revenue, thin: thin, withheld: withheld
  };
})(typeof window !== "undefined" ? window : globalThis);
