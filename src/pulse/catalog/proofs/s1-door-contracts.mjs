// Slice 1 (money routes): the exact route rows that now have a real-handler
// test with fake data. A row appears here only when a test calls the real api/
// handler and judges the named result. The guard test next to this file checks
// every row against the coverage map, every test file, and every test title.
//
// Not here on purpose: closer-deck send_ebook. The handler refuses that action
// (unknown_action), so the row's described result does not exist.

export const S1_DOOR_GUARD_TEST = "src/pulse/catalog/proofs/s1-door-contracts.test.mjs";

const ENTRIES = [
  {
    sourceFile: "routes-0.json",
    surface: "route:commissions",
    control: "action=approve: moves staff commission ledger rows from pending to approved.",
    tests: ["src/http/commissions-handler.test.mjs"],
    titles: ["approve: only earned rows in this company move to approved"],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:content/tiles",
    control: "Content screen save: changes locked-tile name, copy, on/off and the display price clients see, and the tier-to-video map.",
    tests: ["src/pulse/catalog/proofs/s1-door-ladder.test.mjs"],
    titles: ["content/tiles save writes the tile name","content/tiles save refuses a fractional price"],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:finance/cards",
    control: "add / attach / remove a payment-instrument token on a client's file and point the live subscription at it. Stores no card number; charges nothing.",
    tests: ["src/http/subscriptions-endpoints.test.mjs"],
    titles: ["attach points the live subscription at the card","a token reference is stored, with brand, last four and expiry","remove retires the card and reports the removal date"],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:finance/subscriptions",
    control: "start / change / cancel: records the plan, tier and price a client is on (versioned). Records only; no processor charge.",
    tests: ["src/http/subscriptions-endpoints.test.mjs"],
    titles: ["start converts DOLLARS to integer cents once, at the boundary","change closes the old version and opens the new one in ONE statement","cancel passes BOTH dates through"],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:partner-addons",
    control: "activate: manual reconcile of a paid payment link whose webhook never came back; refuses anything not already marked paid.",
    tests: ["src/pulse/catalog/proofs/s1-door-partner-addons.test.mjs"],
    titles: ["partner-addons activate starts the monthly add-on","partner-addons is for owners and admins only"],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:partner-addons",
    control: "buy: mints a Commas hosted-checkout link for a partner add-on ($99 per unit) and records the ask. The subscription appears when the payment webhook lands.",
    tests: ["src/pulse/catalog/proofs/s1-door-partner-addons.test.mjs"],
    titles: ["partner-addons buy mints one checkout link","partner-addons buy refuses a missing unit count"],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:partner-addons",
    control: "cancel: ends a partner add-on subscription at a date.",
    tests: ["src/pulse/catalog/proofs/s1-door-partner-addons.test.mjs"],
    titles: ["partner-addons cancel ends that one add-on","partner-addons is for owners and admins only"],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:pipeline-cards",
    control: "Kanban board move: puts a client card on a stage of a pipeline. Moving onto Funded needs a funded amount (the basis a client is billed from) and emits round.* events that start the money chain.",
    tests: ["src/pulse/catalog/proofs/s1-door-money-moves.test.mjs"],
    titles: ["pipeline-cards: a Funded move saves the dollar amount","pipeline-cards: a Funded move with no dollar amount is refused 400"],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:products",
    control: "Product ladder edits: save or create a product's default price, min and max price, success-fee percent.",
    tests: ["src/pulse/catalog/proofs/s1-door-ladder.test.mjs"],
    titles: ["products save writes the default, minimum, maximum","products refuse a minimum above the maximum"],
  },
  {
    sourceFile: "routes-0.json",
    surface: "route:repair/enroll",
    control: "Enroll a client in the credit-repair program (trial or full): records price and amount paid, grants the letter-pack entitlement, emits repair.enrolled, moves the card, queues the welcome email.",
    tests: ["src/pulse/catalog/proofs/s1-door-money-moves.test.mjs"],
    titles: ["repair/enroll records price and amount paid","repair/enroll refuses a bad program"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:campaigns/write",
    control: "POST action=resume_ad {ad_id} turn ONE ad on at Meta (owner/admin and only staff ids on MARKETING_AD_SWITCH_STAFF_IDS)",
    tests: ["src/pulse/catalog/proofs/s1-door-money-moves.test.mjs"],
    titles: ["campaigns/write resume_ad turns exactly one ad ON","campaigns/write resume_ad refuses a staff id that is not on the list"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:closer-deck",
    control: "POST action=send_pay_link {client_id, offer_key} (mint a Commas checkout link for an offer and text it to the client)",
    tests: ["src/pulse/catalog/proofs/s1-door-closer-deck.test.mjs"],
    titles: ["closer-deck send_pay_link mints a checkout link","closer-deck sends nothing for another company's client"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:closer-deck",
    control: "POST action=send_soft_pull {client_id} (closer cockpit sends the fixed $32 soft-pull approve link by text and email)",
    tests: ["src/pulse/catalog/proofs/s1-door-closer-deck.test.mjs"],
    titles: ["closer-deck send_soft_pull mints the fixed $32 pay link","closer-deck sends nothing for another company's client"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:dashboard/kpis",
    control: "GET ?period=today|7d|30d|qtd (cash collected, funded count and amount, close and show rates, cost per funded)",
    tests: ["src/pulse/catalog/proofs/s1-door-staff-reads.test.mjs"],
    titles: ["dashboard/kpis turns dollars into cents once"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:dashboard/seed",
    control: "POST dev tool: inject one sample client through the real event bus (lead to booked to $32 paid to analysis to $3,000 deposit to sale)",
    tests: ["src/http/dashboard-seed-handler.test.mjs"],
    titles: ["an admin run fires the ten steps in order, every one marked as a sample"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:money/payments",
    control: "POST action=add_plan|record_payment|mark_settled (staff: set up what a client owes Fundhub, record a payment staff saw land, close a plan)",
    tests: ["src/http/money-payments.test.mjs"],
    titles: ["staff adds a plan for a client in their org","staff records a payment; the amount goes through as cents","staff marks a plan settled"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:money/transfers",
    control: "POST action=approve (the account owner's own login says yes; a move dated today is sent at once through Plaid Transfer, sandbox unless PLAID_ENV=production and FINANCE_OS_TRANSFERS_LIVE=1)",
    tests: ["src/http/money-transfers.test.mjs"],
    titles: ["the client says yes: approved, sent at once because it is dated today","a changed amount is refused in plain words"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:money/transfers",
    control: "POST action=propose|cancel (staff propose a move through the seam, nothing moves; client or staff cancel a move that has not reached the bank)",
    tests: ["src/http/money-transfers.test.mjs"],
    titles: ["staff set up a move: proposeTransfer gets a staff request","the client says not now","staff take it off the list"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:payment-links",
    control: "GET ?client_id= (payment links on a client)",
    tests: ["src/pulse/catalog/proofs/s1-door-payment-links.test.mjs"],
    titles: ["payment-links GET lists this client's links","payment-links GET refuses another company's client"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:payment-links",
    control: "POST action=create {client_id, purpose, price} (mint a payable Commas checkout link; closers may create)",
    tests: ["src/pulse/catalog/proofs/s1-door-payment-links.test.mjs"],
    titles: ["payment-links POST create turns dollars into cents once","payment-links POST create refuses a missing amount"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:payment-links",
    control: "POST action=create purpose=invoice (writes an invoices row for the amount instead of a link; draft, nothing sent)",
    tests: ["src/pulse/catalog/proofs/s1-door-payment-links.test.mjs"],
    titles: ["payment-links POST create purpose=invoice writes a DRAFT invoice row"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:public/optimize",
    control: "POST {email, name, phone} mint the $32 Audit checkout on Commas (keep title Consulting Services Assessment)",
    tests: ["src/pulse/catalog/proofs/s1-door-client-money.test.mjs"],
    titles: ["public/optimize POST mints the $32 checkout"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:public/slo-pull",
    control: "OPTIONS preflight and CORS headers: apply.fundhub.ai may POST JSON here (a wrong answer makes the browser block the paying buyer with no error on the page)",
    tests: ["src/pulse/catalog/proofs/s1-door-slo-pull.test.mjs"],
    titles: ["slo-pull OPTIONS from the widget origin is answered"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:public/slo-pull",
    control: "SLO_DEMO_PAY env switch: when on, the form is checked and answered ok but NOTHING is stored and no pull starts (a paying buyer would get nothing if it were left on)",
    tests: ["src/pulse/catalog/proofs/s1-door-slo-pull.test.mjs"],
    titles: ["SLO_DEMO_PAY=1 checks the form, answers ok and stores NOTHING"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:read/affiliate-portal",
    control: "GET (an affiliate or light-affiliate client reads their own referrals, rates, payouts and license and tax gates; staff may name affiliate_id)",
    tests: ["src/pulse/catalog/proofs/s1-door-money-reads.test.mjs"],
    titles: ["read/affiliate-portal shows an affiliate their own referrals","read/affiliate-portal ignores a named affiliate"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:trials/convert",
    control: "POST {partner_id, decision convert|decline, agreement_signed_at} day-8 decision: convert flips the partner active and stamps the agreement (opens the payout gate); decline pauses the partner",
    tests: ["src/pulse/catalog/proofs/s1-door-trials.test.mjs"],
    titles: ["trials/convert flips the partner active from a SIGNED licence","trials/convert decline pauses the partner","trials/convert refuses with no signed licence"],
  },
  {
    sourceFile: "routes-1.json",
    surface: "route:trials/provision",
    control: "POST {trial signup} day 0: provision everything the $297 Live Trial buys (partner row, affiliate row, login, brand, pages)",
    tests: ["src/pulse/catalog/proofs/s1-door-trials.test.mjs"],
    titles: ["trials/provision stands up the partner, affiliate, login","trials/provision refuses a held sale"],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:affiliates/refer",
    control: "POST /api/affiliates/refer — 'Refer a friend': turns the signed-in client into a light affiliate, mints the share code, sets the upline (recruited_by) from the client's own referral row so the 5% tier-2 commission can pay. Idempotent (row lock + unique index). Caller: client session only (staff refused). Moves no money itself but fixes who earns commission.",
    tests: ["src/pulse/catalog/proofs/s1-door-client-money.test.mjs"],
    titles: ["affiliates/refer makes the client an affiliate","affiliates/refer is idempotent, writes no upline for a stranger, and refuses staff"],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:commission-rules",
    control: "GET/POST /api/commission-rules — GET lists effective-dated commission rules with tiers; POST supersedes one rule: closes the old row at effective_from and inserts a new row with the new rate and a required reason (tiered rules refused). Caller: owner, admin, sales_manager (ROLE_SETS.FINANCE). Changes what every future commission pays.",
    tests: ["src/pulse/catalog/proofs/s1-door-staff-reads.test.mjs"],
    titles: ["commission-rules GET lists only this company's effective-dated rules","commission-rules POST closes the old rate","commission-rules POST will not change another company's rule"],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:dashboard/seed",
    control: "POST /api/dashboard/seed — dev tool that injects a sample client through the real event bus: entry.captured, survey.submitted, booking.created, payment.received $32, diagnostic.paid, analysis.completed, decision.rendered, and (unless REPAIR_ONLY) payment.received $3,000, deposit.paid, sale.closed. Caller: staff admin session, or the shared x-dashboard-key header. The handler sets no demo flag; the email is sample+<stamp>@fundhub.demo.",
    tests: ["src/http/dashboard-seed-handler.test.mjs"],
    titles: ["an admin run fires the ten steps in order, every one marked as a sample"],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:paid-services",
    control: "GET/POST /api/paid-services — the client's paid 'do it for me' dispute round: GET the price list and whether this client may buy and whether one is in flight; POST prices the round (creditor letter, escalation filings), records the request (idempotent by client and round number) and mints a hosted checkout link at the processor. Charges nothing itself. Caller: client (own file) or staff ROLE_SETS.STAFF naming a client.",
    tests: ["src/pulse/catalog/proofs/s1-door-client-money.test.mjs"],
    titles: ["paid-services POST prices the round","paid-services lets staff name a client","paid-services refuses a client off the offer path"],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:public/funnel-checkout",
    control: "GET/POST /api/public/funnel-checkout — self-serve till for the /partner/ funnel pages: GET the catalogue and prices; POST {item, email, name, track} records a funnel.checkout_started event and mints a real Commas checkout for the self-serve items (trial, monthly board subscription; autopsy delegates to runAutopsyCheckout). The $10,000 partner entry is refused with 409. No auth.",
    tests: ["src/http/funnel-checkout.test.mjs"],
    titles: ["POST partner is refused with 409 and the apply URL","board: records the ask BEFORE minting","GET answers the catalogue"],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:public/slo-repair-checkout",
    control: "POST/OPTIONS /api/public/slo-repair-checkout — the repair plan a $297 buyer picks in the /roadmap widget after the pull, repair path only: body {ref, client_id, plan: REPAIR_TRIAL $200 | REPAIR_DFY $1,000}; refused unless slo-status would show the repair offer; demo mode records a demo payment link and never calls Commas, otherwise mints a payable checkout. Credential is ref plus client_id. No auth.",
    tests: ["src/http/slo-repair-checkout.test.mjs"],
    titles: ["refused unless the pull is done AND the buyer is on the repair path","DEMO: records a demo row at the catalogue price, never calls Commas","LIVE: Commas link at the catalogue price"],
  },
  {
    sourceFile: "routes-2.json",
    surface: "route:slo-connections",
    control: "POST /api/slo-connections — owner map of ClickFunnels funnel and product ids to a Fundhub product: what a paid ClickFunnels webhook is allowed to unlock. 409 on a duplicate map. Caller: owner, admin (ROLE_SETS.OPS), org from the session.",
    tests: ["src/pulse/catalog/proofs/s1-door-ladder.test.mjs"],
    titles: ["slo-connections POST maps the funnel and product ids","slo-connections POST answers 409 for a duplicate map"],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:marketing/meta/load",
    control: "POST {request_id, ad_video_id | all:true} queues jobs that load approved ad videos into Meta PAUSED. This route never calls Meta itself; it writes the jobs.",
    tests: ["src/pulse/catalog/proofs/s1-door-money-reads.test.mjs"],
    titles: ["marketing/meta/load queues one load job","marketing/meta/load all:true queues exactly the approved ads","marketing/meta/load all:true with nothing approved","marketing/meta/load refuses a missing choice"],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:read/finance-command",
    control: "GET ?days= the roll-up dashboard: total cash, credit available and owed, utilization, investments, cash in versus out, and marketing spend, across the org or one client or entity.",
    tests: ["src/pulse/catalog/proofs/s1-door-money-reads.test.mjs"],
    titles: ["read/finance-command rolls up this company's cash","read/finance-command scoped to one client","read/finance-command lets every staff role read it"],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:read/funding-rounds",
    control: "GET funding rounds: submitted, approved and funded amounts, status, hold reason, conditions. Optional ?include_matches=1 with a client adds lender matches.",
    tests: ["src/pulse/catalog/proofs/s1-door-staff-reads.test.mjs"],
    titles: ["read/funding-rounds lists submitted, approved and funded amounts"],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:read/partners",
    control: "GET white-label partners with accrued balance (rate is per-partner config). Partners are confined to their own row through src/partners/scope.mjs.",
    tests: ["src/pulse/catalog/proofs/s1-door-staff-reads.test.mjs"],
    titles: ["read/partners shows each partner's accrued balance"],
  },
  {
    sourceFile: "routes-3.json",
    surface: "route:read/sales-floor",
    control: "GET the sales manager floor view: call outcomes, deposits and totals across closers.",
    tests: ["src/pulse/catalog/proofs/s1-door-staff-reads.test.mjs"],
    titles: ["read/sales-floor totals the month's cash"],
  },
];

export function s1DoorKey(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  return [file, String(row?.surface || "").trim(), String(row?.control || "").trim()].join("\0");
}

export const S1_DOOR_CONTRACTS = Object.freeze(ENTRIES.map((entry) => Object.freeze({
  ...entry,
  key: s1DoorKey(entry.sourceFile, entry),
  proof: Object.freeze({
    depth: "deep",
    evidence: [S1_DOOR_GUARD_TEST, ...entry.tests].join(" "),
    asserts: entry.control,
  }),
})));

const BY_KEY = new Map(S1_DOOR_CONTRACTS.map((entry) => [entry.key, entry.proof]));

export function s1DoorContractsProof(sourceFile, row) {
  return BY_KEY.get(s1DoorKey(sourceFile, row)) || null;
}
